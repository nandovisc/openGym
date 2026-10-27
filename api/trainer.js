// A personal trainer and their students (the Personal module). An admin marks an account as a
// trainer (user.trainer); the trainer hands a student a code (user.trainerCode); the student, who
// sees what they share, enters it and the link is made — the student agrees, never the trainer
// alone. Either side can end it, and the access goes with it at once.
//
//   db.trainerLinks [{ id, trainerId, clientId, scope: { body }, created }]
//     scope.body: weigh-ins and measurements shared too (off unless the student turns it on).
//     What a link always shares is the training: routines, workouts (without their photos and
//     videos), custom exercises, the unit. Nothing of the health modules, ever.
//   user.trainerCode { code, exp }   one code at a time, a week long, for any number of students
import crypto from 'node:crypto';

const list = v => (Array.isArray(v) ? v : []);
export const CODE_DAYS = 7;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // no 0/O, 1/I: read aloud or typed off a screen

/** A new code: 'PT-' and 8 characters a person can read to someone else. */
export function newCode() {
  const b = crypto.randomBytes(8);
  return 'PT-' + [...b].map(x => ALPHABET[x % ALPHABET.length]).join('');
}
export const cleanCode = v => String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^PT/, '');
const sameCode = (a, b) => !!a && !!b && cleanCode(a) === cleanCode(b);

/** The trainer whose live code `code` is, or null. */
export function trainerByCode(users, code, now = Date.now()) {
  return list(users).find(u => u?.trainer && !u.disabled && u.trainerCode && Number(u.trainerCode.exp) > now && sameCode(u.trainerCode.code, code)) || null;
}

/**
 * `links` with the link of `trainer` and `client` made (or its scope changed, when there is one):
 * { links, link, error }. error: 'self' (a trainer is not their own student).
 */
export function linkWith(links, trainer, client, { body = false, ref = null, now = Date.now() } = {}) {
  if (trainer.id === client.id) return { links: list(links), link: null, error: 'self' };
  const out = list(links).slice();
  const i = out.findIndex(l => l?.trainerId === trainer.id && l.clientId === client.id);
  // `ref`: the trainer's record of this student the invite carried (lib/students.js), so the
  // trainer's app puts the two together.
  const r = typeof ref === 'string' && /^[\w-]{1,64}$/.test(ref) ? { ref } : {};
  const link = i >= 0 ? { ...out[i], ...r, scope: { body: !!body } } : { id: crypto.randomBytes(8).toString('hex'), trainerId: trainer.id, clientId: client.id, ...r, scope: { body: !!body }, created: now };
  if (i >= 0) out[i] = link; else out.push(link);
  return { links: out, link, error: null };
}

/** `links` without the link `id` when `user` is one of its two sides: { links, link } (null: none). */
export function unlink(links, id, user) {
  const link = list(links).find(l => l?.id === id && (l.trainerId === user.id || l.clientId === user.id)) || null;
  return { links: link ? list(links).filter(l => l !== link) : list(links), link };
}

/** `links` without any link of user `uid` (an account deleted, or no longer a trainer). */
export const dropLinksOf = (links, uid, side = 'both') =>
  list(links).filter(l => !((side !== 'client' && l?.trainerId === uid) || (side !== 'trainer' && l?.clientId === uid)));

/** The students of `trainer`, as the trainer sees them. */
export function studentsOf(links, users, trainer) {
  const by = new Map(list(users).map(u => [u.id, u]));
  return list(links).filter(l => l?.trainerId === trainer.id && by.has(l.clientId))
    .map(l => ({ id: l.id, student: { id: l.clientId, name: by.get(l.clientId).name, disabled: !!by.get(l.clientId).disabled }, scope: l.scope || { body: false }, created: l.created, ...(l.ref ? { ref: l.ref } : {}) }));
}

/** The trainers of `client`, as the student sees them. */
export function trainersOf(links, users, client) {
  const by = new Map(list(users).map(u => [u.id, u]));
  return list(links).filter(l => l?.clientId === client.id && by.has(l.trainerId))
    .map(l => ({ id: l.id, trainer: { id: l.trainerId, name: by.get(l.trainerId).name }, scope: l.scope || { body: false }, created: l.created }));
}

// The training a link shares, out of a student's profile: routines and their plan, workouts
// without their photos and videos, custom exercises without their media, the settings that read
// them (unit, the 1RM formula, what a dumbbell weight means), and the body only when the student
// shares it. Nothing else of the profile leaves it.
export const TRAINING_KEYS = ['routines', 'week', 'dayPlan', 'queue', 'rotation', 'scheduleMode', 'unit', 'speedUnit', 'oneRmFormula', 'dbLoad', 'weekStart', 'exWeights'];
export function trainingOf(S, scope = {}) {
  const st = S && typeof S === 'object' ? S : {};
  const out = {};
  for (const k of TRAINING_KEYS) if (st[k] !== undefined) out[k] = st[k];
  out.workouts = list(st.workouts).filter(w => w && typeof w === 'object').map(({ media, ...w }) => w);
  out.customEx = list(st.customEx).filter(c => c && typeof c === 'object').map(({ media, url, ...c }) => c);
  if (scope.body) {
    out.bodyweight = list(st.bodyweight).filter(b => b && typeof b === 'object').map(({ photos, ...b }) => b);
    out.measurements = list(st.measurements).filter(m => m && typeof m === 'object');
  }
  return out;
}

const back = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') - n * 86400000).toISOString().slice(0, 10);
/** A line of how a student trains lately, for the trainer's list: last workout, last 7 and 28 days. */
export function trainingSummary(S, today) {
  const days = list(S?.workouts).map(w => w?.d).filter(d => typeof d === 'string').sort();
  const last = days.at(-1) || null;
  return { last, week: days.filter(d => d > back(today, 7) && d <= today).length, month: days.filter(d => d > back(today, 28) && d <= today).length, total: days.length };
}

const WEEK_DAYS = ['0', '1', '2', '3', '4', '5', '6'];
const clean = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
/**
 * A trainer's plan for a student put into the student's training: `routines` (whole, each new or
 * replacing the one of its id, marked with the trainer), the ids in `removed` taken out, and
 * `week` (weekday → routine ids) when given. { routines, week, error }. What the student keeps of
 * a routine the trainer rewrote: its order in the list; the trainer's version of everything else.
 */
export function planFor(cur, { routines = [], removed = [], week } = {}, trainer, now = Date.now()) {
  if (!Array.isArray(routines) || routines.length > 60 || !Array.isArray(removed)) return { error: 'routines' };
  const ok = r => r && typeof r === 'object' && typeof r.id === 'string' && r.id && r.id.length <= 64 && Array.isArray(r.ex) && r.ex.length <= 60
    && r.ex.every(x => x && typeof x === 'object' && typeof x.id === 'string' && x.id.length <= 64);
  if (!routines.every(ok)) return { error: 'routines' };
  const gone = new Set(removed.filter(id => typeof id === 'string'));
  const mark = { id: trainer.id, name: trainer.name, at: now };
  const out = list(cur?.routines).filter(r => r && !gone.has(r.id));
  for (const r of routines) {
    const strip = Object.fromEntries(Object.entries(r).filter(([k]) => !k.startsWith('_')));
    const next = { ...strip, name: clean(r.name, 80) || 'Treino', ex: r.ex.map(x => Object.fromEntries(Object.entries(x).filter(([k]) => !k.startsWith('_')))), trainer: mark };
    const i = out.findIndex(x => x?.id === r.id);
    if (i >= 0) out[i] = { ...out[i], ...next }; else out.push(next);
  }
  let nextWeek;
  if (week !== undefined) {
    if (!week || typeof week !== 'object' || Array.isArray(week)) return { error: 'week' };
    const ids = new Set(out.map(r => r.id));
    nextWeek = {};
    for (const d of WEEK_DAYS) {
      const v = [].concat(week[d] ?? []).filter(id => ids.has(id));
      if (v.length) nextWeek[d] = v;
    }
  } else if (gone.size && cur?.week && typeof cur.week === 'object') {
    // A routine taken out leaves the days it was on.
    nextWeek = {};
    for (const [d, v] of Object.entries(cur.week)) { const left = [].concat(v).filter(id => !gone.has(id)); if (left.length) nextWeek[d] = left; }
  }
  return { routines: out, ...(nextWeek ? { week: nextWeek } : {}), error: null };
}

/**
 * The trainer's records (S.students) with what a link that ended leaves them: the record of that
 * student (by the invite's `ref`, else by the student's id; one made when there is none) marked
 * ended and given the student's training up to `until` — read-only, the trainer's to keep, as the
 * student agreed when linking. The student keeps their own, untouched.
 */
export function archiveFor(records, link, student, S, until, id = crypto.randomBytes(8).toString('hex'), now = Date.now()) {
  const t = trainingOf(S || {});
  const history = { workouts: t.workouts, customEx: t.customEx, unit: t.unit || 'kg', until };
  const out = list(records).slice();
  const i = out.findIndex(r => r && (r.id === link.ref || r.studentId === student.id));
  if (i >= 0) out[i] = { ...out[i], status: 'ended', studentId: student.id, history };
  else out.push({ id, name: student.name, status: 'ended', studentId: student.id, history, created: now });
  return out;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const num = v => Number.isFinite(Number(v)) ? Number(v) : NaN;
/**
 * A workout a trainer ran with a student, from the trainer's phone, put into the student's
 * training: { workouts, exWeights, added, error }. Marked with the trainer (src 'trainer'); an id
 * the profile has already is left as it is, so a retry of the same send adds nothing. `best`
 * (exercise id → { w, d }) is what the trainer's app worked out the session set as the student's
 * best loads, held against what the student had: taken only when it is a number for a day.
 */
export function workoutFor(cur, workout, best, trainer, now = Date.now()) {
  const w = workout;
  const ok = w && typeof w === 'object' && !Array.isArray(w) && typeof w.id === 'string' && w.id && w.id.length <= 80 && DAY.test(w.d || '')
    && Array.isArray(w.entries) && w.entries.length <= 100
    && w.entries.every(e => e && typeof e === 'object' && typeof e.id === 'string' && e.id.length <= 64 && Array.isArray(e.sets) && e.sets.length <= 100);
  if (!ok) return { error: 'workout' };
  const workouts = list(cur?.workouts).slice();
  const exWeights = cur?.exWeights && typeof cur.exWeights === 'object' && !Array.isArray(cur.exWeights) ? { ...cur.exWeights } : {};
  if (workouts.some(x => x?.id === w.id)) return { workouts, exWeights, added: false, error: null };
  const strip = Object.fromEntries(Object.entries(w).filter(([k]) => !k.startsWith('_') && k !== 'media'));
  const next = { ...strip, name: clean(w.name, 80) || 'Treino', src: 'trainer', trainer: { id: trainer.id, name: trainer.name, at: now } };
  // Where its day and start put it, as History reads the list in order.
  let i = workouts.length;
  while (i > 0 && (workouts[i - 1]?.d > next.d || (workouts[i - 1]?.d === next.d && (num(workouts[i - 1]?.start) || 0) > (num(next.start) || 0)))) i--;
  workouts.splice(i, 0, next);
  if (best && typeof best === 'object' && !Array.isArray(best)) {
    for (const [id, b] of Object.entries(best).slice(0, 100)) {
      if (typeof id === 'string' && id.length <= 64 && b && num(b.w) > 0 && DAY.test(b.d || '')) exWeights[id] = { w: num(b.w), d: b.d };
    }
  }
  return { workouts, exWeights, added: true, error: null };
}

// ---- what a trainer's profile holds for a student to read (phase 9): notices and documents.
// The same rule as frontend/src/lib/notices.js noticeReaches (notices-parity.test.js holds both).

/** The trainer's record of the student a link joins: by the invite's `ref`, else by their id. */
export const recordOfLink = (S, link) => list(S?.students).find(r => r && (r.studentId === link.clientId || (link.ref && r.id === link.ref))) || null;

/**
 * Whether `notice` is for the student of `record`: every student, the students of a group (the
 * record's `group`, compared without case or spaces around), or this one. Never a record whose
 * link ended.
 */
export function noticeReaches(notice, record) {
  if (!notice || !record || record.status === 'ended') return false;
  const to = notice.to || {};
  if (to.kind === 'all') return true;
  if (to.kind === 'group') return !!to.group && String(record.group || '').trim().toLowerCase() === String(to.group).trim().toLowerCase();
  if (to.kind === 'student') return to.recordId === record.id;
  return false;
}

const NOTICE_DAYS = 60;
/** A trainer's notices a student of theirs reads, newest first: the last 60 days, at most 30. */
export function noticesFor(S, link, now = Date.now()) {
  const record = recordOfLink(S, link);
  if (!record) return [];
  return list(S?.notices).filter(n => n && typeof n.id === 'string' && Number(n.at) > now - NOTICE_DAYS * 86400000 && noticeReaches(n, record))
    .sort((a, b) => b.at - a.at).slice(0, 30)
    .map(n => ({ id: n.id, title: clean(n.title, 100), body: String(n.body ?? '').slice(0, 2000), at: Number(n.at) }));
}

const HASH = /^[0-9a-f]{64}$/;
/** The documents a trainer shared with a student, newest first: what the app lists, no file. */
export function documentsFor(S, link) {
  const record = recordOfLink(S, link);
  if (!record || record.status === 'ended') return [];
  return list(S?.documents).filter(d => d && d.recordId === record.id && d.shared === true && typeof d.id === 'string' && HASH.test(d.m?.hash || ''))
    .sort((a, b) => (a.d < b.d ? 1 : a.d > b.d ? -1 : 0))
    .map(d => ({ id: d.id, kind: d.kind || 'other', title: clean(d.title, 100), d: DAY.test(d.d || '') ? d.d : null, mime: d.m.mime, size: d.m.size }));
}

/** The one shared document `id` of the student's, with its file's hash, or null. */
export const sharedDocument = (S, link, id) => {
  const record = recordOfLink(S, link);
  if (!record || record.status === 'ended') return null;
  return list(S?.documents).find(d => d && d.id === id && d.recordId === record.id && d.shared === true && HASH.test(d.m?.hash || '')) || null;
};
