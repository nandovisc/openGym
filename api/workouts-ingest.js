// Workouts from Apple Health, for POST /api/workouts/ingest: an iPhone Shortcut, run by the
// automation "Apple Watch Workout → Ends", sends the samples of the last hours. The Health action
// of Shortcuts cannot read a workout itself (it has no Workouts type), so the workout is found in
// what it can read: Exercise Minutes, one sample a minute while a workout runs, mark when it began
// and ended; Active Energy and Heart Rate inside that span are what it burned and how hard.
//
// A sample: { start, end, value, kind, unit }, kind 'exercise' | 'energy' | 'hr'. Sent as text,
// one a line `start;end;value;kind;unit`, as a JSON array, or as lists side by side, one line per
// sample in each: { energy: { start, end, value, unit }, hr, exercise }, or flat as the Shortcut
// sends them, { energy_start, energy_end, energy_value, energy_unit, … }.
//
// What it writes into S.workouts: `health` on the workout logged in openGym at that time —
//   { kcal, avgHr, maxHr, from, to, source }   (from/to: ms, the span the watch recorded)
// — or, with none logged, a workout of its own: { id: 'hk-w:<local start>', d, start, end, name,
// entries: [], health, src: 'health' }. A workout logged in openGym later, over the same span, takes
// that one's `health` and the watch's entry goes (foldWatchWorkouts, on every write).
import { parseTime, SAMPLES_MAX } from './sleep.js';

// Exercise minutes further apart than this end one workout and begin another.
export const GAP_MS = 2 * 60000;
// A shorter run of exercise minutes is a brisk walk, not a workout.
export const MIN_MS = 5 * 60000;
// How far apart a logged workout and the watch's span may start or end and still be the same one.
export const NEAR_MS = 15 * 60000;
export const WATCH_PREFIX = 'hk-w:';
const KINDS = { exercise: 'exercise', exercicio: 'exercise', energy: 'energy', energia: 'energy', kcal: 'energy', hr: 'hr', heart: 'hr', fc: 'hr' };

const fold = v => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
// A number as a phone writes it: "410.5", or "1.234,5" on one set to Portuguese.
const num = v => {
  let t = String(v ?? '').replace(/[^\d.,-]/g, '');
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  const n = t ? Number(t) : NaN;
  return Number.isFinite(n) ? n : NaN;
};
const lines = v => String(v ?? '').split(/\r?\n/).map(x => x.trim());

/** The samples in what the Shortcut sent (any of the shapes above). What cannot be read is skipped. */
export function parseWorkoutSamples(body) {
  if (typeof body === 'string') {
    const t = body.trim();
    if (t.startsWith('[') || t.startsWith('{')) { try { body = JSON.parse(t); } catch { body = t; } }
  }
  let rows = [];
  if (Array.isArray(body)) rows = body;
  else if (typeof body === 'string') rows = lineRows(body);
  else if (body && typeof body === 'object') {
    if (Array.isArray(body.samples)) rows = body.samples;
    else if (typeof body.samples === 'string') rows = lineRows(body.samples);
    for (const kind of ['exercise', 'energy', 'hr']) {
      // As a group, or flat (`energy_start`…), the way the Shortcut's JSON form sends it.
      const g = body[kind] && typeof body[kind] === 'object' ? body[kind]
        : body[kind + '_start'] != null ? { start: body[kind + '_start'], end: body[kind + '_end'], value: body[kind + '_value'], unit: body[kind + '_unit'] } : null;
      if (!g) continue;
      const s = lines(g.start), e = lines(g.end), v = lines(g.value), u = lines(g.unit);
      for (let i = 0; i < s.length; i++) rows.push({ start: s[i], end: e[i], value: v[i], kind, unit: u[i] ?? u[0] });
    }
  }
  const out = [];
  for (const r of rows.slice(0, SAMPLES_MAX * 3)) {
    if (!r || typeof r !== 'object') continue;
    const kind = KINDS[fold(r.kind ?? r.type).replace(/[^a-z]/g, '')];
    const a = parseTime(r.start ?? r.startDate), b = parseTime(r.end ?? r.endDate ?? r.start ?? r.startDate);
    let v = num(r.value);
    if (!kind || !a || !b || b.ms < a.ms || !(v >= 0)) continue;
    // Energy in kilojoules (a phone set to them) is kept in kcal, as everything else is.
    if (kind === 'energy' && /kj|quilojoule|kilojoule/.test(fold(r.unit))) v = v / 4.184;
    out.push({ kind, s: a.ms, e: b.ms, sl: a.local, el: b.local, v });
  }
  return out;
}
function lineRows(text) {
  return lines(text).filter(Boolean).map(line => {
    const [start, end, value, kind, unit] = line.split(/[;\t|]/).map(x => x.trim());
    return { start, end, value, kind, unit };
  });
}

/** The last workout in `samples`: { s, e, sl, el } of its run of exercise minutes, or null. */
export function lastSession(samples) {
  const xs = samples.filter(x => x.kind === 'exercise' && x.v > 0).sort((p, q) => p.s - q.s);
  let best = null, cur = null;
  for (const x of xs) {
    if (cur && x.s - cur.e <= GAP_MS) { if (x.e > cur.e) { cur.e = x.e; cur.el = x.el; } continue; }
    if (cur && cur.e - cur.s >= MIN_MS) best = cur;
    cur = { s: x.s, e: Math.max(x.e, x.s + 60000), sl: x.sl, el: x.el };
  }
  if (cur && cur.e - cur.s >= MIN_MS) best = cur;
  return best;
}

/** { kcal, avgHr, maxHr } inside `span`: energy prorated by how much of a sample falls inside. */
export function measure(samples, span) {
  let kcal = 0;
  const hr = [];
  for (const x of samples) {
    if (x.kind === 'energy') {
      const len = x.e - x.s;
      const inside = Math.min(x.e, span.e) - Math.max(x.s, span.s);
      if (len <= 0) { if (x.s >= span.s && x.s <= span.e) kcal += x.v; }
      else if (inside > 0) kcal += x.v * inside / len;
    } else if (x.kind === 'hr' && x.v > 20 && x.v < 260) {
      const mid = (x.s + x.e) / 2;
      if (mid >= span.s && mid <= span.e) hr.push(x.v);
    }
  }
  return {
    kcal: Math.round(kcal),
    avgHr: hr.length ? Math.round(hr.reduce((a, b) => a + b, 0) / hr.length) : null,
    maxHr: hr.length ? Math.round(Math.max(...hr)) : null
  };
}

const startOf = w => Number(w?.start) || 0;
const endOf = w => Number(w?.end) || startOf(w);
const isWatch = w => typeof w?.id === 'string' && w.id.startsWith(WATCH_PREFIX);
// How much two spans overlap, and -Infinity when they are not within NEAR_MS of each other.
function nearness(w, s, e) {
  const ws = startOf(w), we = endOf(w);
  if (!ws || ws > e + NEAR_MS || we < s - NEAR_MS) return -Infinity;
  return Math.min(we, e) - Math.max(ws, s);
}
function closest(list, s, e, pick) {
  let best = -1, score = -Infinity;
  list.forEach((w, i) => { if (!w || !pick(w)) return; const n = nearness(w, s, e); if (n > score) { score = n; best = i; } });
  return best;
}
const sameHealth = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * `list` (S.workouts) with the workout in `span` put in: as `health` of the workout logged then, or
 * as the watch's own entry (one there already for that span is updated, never added twice).
 * { list, id, action: 'matched' | 'created' | 'updated' | 'unchanged' }. `list` is not changed.
 */
export function putWatchWorkout(list, span, m, { name = '', source = 'Apple Watch' } = {}) {
  const out = Array.isArray(list) ? list.slice() : [];
  const health = { kcal: m.kcal, avgHr: m.avgHr, maxHr: m.maxHr, from: span.s, to: span.e, source: String(source).slice(0, 60) };
  const logged = closest(out, span.s, span.e, w => !isWatch(w));
  if (logged >= 0) {
    const w = out[logged];
    if (sameHealth(w.health, health)) return { list: out, id: w.id, action: 'unchanged' };
    out[logged] = { ...w, health };
    return { list: out, id: w.id, action: 'matched' };
  }
  const label = String(name || '').trim().slice(0, 80) || 'Apple Watch';
  const mine = closest(out, span.s, span.e, isWatch);
  if (mine >= 0) {
    const w = out[mine];
    const next = { ...w, start: span.s, end: span.e, health, ...(name ? { name: label } : {}) };
    if (sameHealth(w.health, health) && w.start === next.start && w.end === next.end && w.name === next.name) return { list: out, id: w.id, action: 'unchanged' };
    out[mine] = next;
    return { list: out, id: w.id, action: 'updated' };
  }
  const id = WATCH_PREFIX + span.sl;
  out.push({ id, d: span.sl.slice(0, 10), start: span.s, end: span.e, routineIds: [], routineId: null, name: label, entries: [], prs: [], vol: 0, health, src: 'health' });
  return { list: out, id, action: 'created' };
}

/**
 * The watch's workouts that a workout logged in openGym covers, folded into it: the logged one
 * takes their `health` (unless it has its own) and they go, recorded in `deleted` like any removal
 * so no device brings them back. Mutates `state`; the ids changed, [] when nothing was.
 */
export function foldWatchWorkouts(state, now = Date.now(), stamp = () => {}) {
  const list = Array.isArray(state?.workouts) ? state.workouts : null;
  if (!list || !list.some(isWatch)) return [];
  const changed = [], drop = new Set();
  list.forEach(w => {
    if (!isWatch(w) || !w.health) return;
    const i = closest(list, startOf(w), endOf(w), x => !isWatch(x));
    if (i < 0) return;
    const logged = list[i];
    if (!logged.health) {
      const next = { ...logged, health: w.health };
      stamp(logged, next, now);
      list[i] = next;
      changed.push(logged.id);
    }
    drop.add(w.id);
  });
  if (!drop.size) return changed;
  const del = state.deleted && typeof state.deleted === 'object' && !Array.isArray(state.deleted) ? state.deleted : (state.deleted = {});
  const m = del.workouts && typeof del.workouts === 'object' ? del.workouts : (del.workouts = {});
  for (const w of list) if (w && drop.has(w.id)) m[w.id] = Math.max(now, (Number(w._ts) || Number(w.end) || 0) + 1);
  state.workouts = list.filter(w => !(w && drop.has(w.id)));
  return [...changed, ...drop];
}
