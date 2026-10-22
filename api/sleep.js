// Nights of sleep from the samples a watch or a ring writes to Apple Health, for
// POST /api/sleep/ingest (an iPhone Shortcut sends them every morning). The app's copy of these
// rules is frontend/src/lib/sleep-samples.js, used by the export.xml import; the two must turn the
// same samples into the same nights (frontend/src/lib/sleep-parity.test.js runs both).
//
// A sample: { start, end, value, source }. start/end as the Shortcut or export.xml writes them,
// "2026-10-22T06:50:00-03:00" or "2026-10-22 06:50:00 -0300": the wall clock of the place it was
// recorded is what a night is filed under, the offset is what its length is worked out from.
// value: Apple's name for the stage, its number, or the label the Shortcut shows in the phone's
// language. A night (S.sleep, described in frontend/src/lib/sleep.js):
//   { id: 'hk:' + d, d, bed, wake, asleepMin, inBedMin, stages: { deep, rem, core, awake } | null, src, source }

const DAY_MS = 86400000;
// Samples further apart than this are two sleeps, not one night with a long wake.
export const SESSION_GAP_MS = 2 * 3600000;
export const SAMPLES_MAX = 5000;

const TIME_RE = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?\s*(Z|[+-]\d{2}:?\d{2})?$/;

/** { ms, local: 'YYYY-MM-DDTHH:MM' } of a time as written, or null. No offset reads as UTC. */
export function parseTime(v) {
  const m = TIME_RE.exec(String(v ?? '').trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s = '0', z] = m;
  let off = 0;
  if (z && z !== 'Z') { const n = z.replace(':', ''); off = (n[0] === '-' ? -1 : 1) * (+n.slice(1, 3) * 60 + +n.slice(3, 5)); }
  const wall = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s);
  if (!Number.isFinite(wall) || +mo < 1 || +mo > 12 || +d < 1 || +d > 31 || +h > 23 || +mi > 59) return null;
  return { ms: wall - off * 60000, local: `${y}-${mo}-${d}T${h}:${mi}` };
}

const fold = v => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const KINDS = ['inbed', 'asleep', 'awake', 'core', 'deep', 'rem'];
const WORDS = {
  inbed: 'inbed', nacama: 'inbed', emcama: 'inbed', bed: 'inbed',
  asleep: 'asleep', unspecified: 'asleep', asleepunspecified: 'asleep', dormindo: 'asleep', adormir: 'asleep', sono: 'asleep', naoespecificado: 'asleep', sleep: 'asleep',
  awake: 'awake', acordado: 'awake', desperto: 'awake', vigilia: 'awake',
  core: 'core', asleepcore: 'core', essencial: 'core', principal: 'core', leve: 'core', light: 'core', sonoleve: 'core',
  deep: 'deep', asleepdeep: 'deep', profundo: 'deep', sonoprofundo: 'deep',
  rem: 'rem', asleeprem: 'rem', sonorem: 'rem'
};
/** 'inbed' | 'asleep' | 'awake' | 'core' | 'deep' | 'rem' for a stage however it is named, or null. */
export function kindOf(value) {
  const raw = fold(value).trim();
  if (/^[0-5]$/.test(raw)) return KINDS[+raw];
  const w = raw.replace(/^hkcategoryvaluesleepanalysis/, '').replace(/[^a-z]/g, '');
  return WORDS[w] || null;
}

/**
 * Samples from what the Shortcut sends: a JSON array (or { samples }, an array or the text below) of
 * { start, end, value, source }, or text with one sample a line, `start;end;value;source`
 * (a tab or `|` works as well as `;`). What cannot be read is skipped.
 */
export function parseSamples(body) {
  let rows = null;
  if (typeof body === 'string') {
    const t = body.trim();
    if (t.startsWith('[') || t.startsWith('{')) { try { body = JSON.parse(t); } catch { body = t; } }
  }
  if (Array.isArray(body)) rows = body;
  else if (body && typeof body === 'object' && Array.isArray(body.samples)) rows = body.samples;
  else if (body && typeof body === 'object' && typeof body.samples === 'string') return parseSamples(body.samples);
  else if (typeof body === 'string') {
    rows = body.split(/\r?\n/).map(line => {
      const [start, end, value, ...source] = line.split(/[;\t|]/).map(x => x.trim());
      return { start, end, value, source: source.join(' ') };
    });
  } else rows = [];
  return rows.slice(0, SAMPLES_MAX).filter(r => r && typeof r === 'object')
    .map(r => ({ start: r.start ?? r.startDate, end: r.end ?? r.endDate, value: r.value, source: r.source ?? r.sourceName ?? '' }));
}

// Minutes covered by the union of [s, e) intervals.
function unionMin(iv) {
  const xs = iv.slice().sort((a, b) => a[0] - b[0]);
  let total = 0, cs = -Infinity, ce = -Infinity;
  for (const [s, e] of xs) {
    if (s > ce) { if (ce > cs) total += ce - cs; cs = s; ce = e; } else if (e > ce) ce = e;
  }
  if (ce > cs) total += ce - cs;
  return Math.round(total / 60000);
}
const SLEEP = new Set(['asleep', 'core', 'deep', 'rem']);

function sessionNight(xs, source) {
  let first = xs[0], last = xs[0];
  for (const x of xs) { if (x.s < first.s) first = x; if (x.e > last.e) last = x; }
  const sum = k => Math.round(xs.filter(x => x.kind === k).reduce((a, x) => a + (x.e - x.s), 0) / 60000);
  const asleepMin = unionMin(xs.filter(x => SLEEP.has(x.kind)).map(x => [x.s, x.e]));
  const staged = xs.some(x => x.kind === 'core' || x.kind === 'deep' || x.kind === 'rem');
  const stages = staged ? { deep: sum('deep'), rem: sum('rem'), core: sum('core'), awake: sum('awake') } : null;
  const d = last.el.slice(0, 10);
  return { id: 'hk:' + d, d, bed: first.sl, wake: last.el, asleepMin, inBedMin: Math.round((last.e - first.s) / 60000), stages, src: 'health', source: String(source || '').slice(0, 60) };
}
const stagedMin = n => (n.stages ? n.stages.deep + n.stages.rem + n.stages.core : 0);

/**
 * The nights in `samples`, one a day, in order. Per source, samples less than SESSION_GAP_MS apart
 * are one sleep; a day's night is the longest sleep that ends on it (a nap is not the night). When
 * two sources (a watch and a ring) recorded the same night, the one with more staged minutes is
 * kept, so the night is not counted twice.
 */
export function nightsFrom(samples) {
  const bySource = new Map();
  for (const r of Array.isArray(samples) ? samples : []) {
    const kind = kindOf(r?.value), a = parseTime(r?.start), b = parseTime(r?.end);
    if (!kind || !a || !b || b.ms <= a.ms || b.ms - a.ms > DAY_MS) continue;
    const src = String(r.source ?? '').trim();
    if (!bySource.has(src)) bySource.set(src, []);
    bySource.get(src).push({ s: a.ms, e: b.ms, sl: a.local, el: b.local, kind });
  }
  const best = new Map();
  for (const [source, xs] of bySource) {
    xs.sort((p, q) => p.s - q.s || p.e - q.e);
    const sessions = [];
    let cur = [], end = -Infinity;
    for (const x of xs) {
      if (cur.length && x.s - end > SESSION_GAP_MS) { sessions.push(cur); cur = []; end = -Infinity; }
      cur.push(x); end = Math.max(end, x.e);
    }
    if (cur.length) sessions.push(cur);
    const mine = new Map();
    for (const s of sessions) {
      const n = sessionNight(s, source);
      if (n.asleepMin <= 0) continue;
      const had = mine.get(n.d);
      if (!had || n.asleepMin > had.asleepMin) mine.set(n.d, n);
    }
    for (const n of mine.values()) {
      const had = best.get(n.d);
      if (!had || stagedMin(n) > stagedMin(had) || (stagedMin(n) === stagedMin(had) && n.asleepMin > had.asleepMin)) best.set(n.d, n);
    }
  }
  return [...best.values()].sort((p, q) => (p.d < q.d ? -1 : p.d > q.d ? 1 : 0));
}

/**
 * `list` (S.sleep) with `nights` put in: a night from Health replaces the one it sent before (same
 * id), keeping what the person added to it (quality, note). A day the person logged by hand, or a
 * Health night they edited (`edited`), is left as it is. { list, put: [days written] }.
 */
export function mergeNights(list, nights, { src = 'health', now = Date.now() } = {}) {
  const out = Array.isArray(list) ? list.slice() : [];
  const put = [];
  for (const n of nights) {
    if (out.some(x => x && x.d === n.d && x.id !== n.id && x.src === 'manual')) continue;
    const i = out.findIndex(x => x && x.id === n.id);
    const prev = i >= 0 ? out[i] : null;
    if (prev?.edited) continue;
    const next = { ...(prev || {}), ...n, src, created: prev?.created || now };
    if (prev && ['bed', 'wake', 'asleepMin', 'inBedMin', 'source', 'src'].every(k => prev[k] === next[k]) && JSON.stringify(prev.stages ?? null) === JSON.stringify(next.stages ?? null)) continue;
    if (i >= 0) out[i] = next; else out.push(next);
    put.push(n.d);
  }
  return { list: out, put };
}
