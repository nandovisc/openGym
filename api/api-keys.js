// A person's own API keys: another app reads their data, and writes it too when the key says so
// (server.js /api/v1/*, made and revoked in Settings → API keys). Each key opens some areas of the
// profile only — `SCOPES` below — and is kept as a SHA-256 like the sleep Shortcut's token: shown
// once, never stored. The rules here are pure, so they are tested without booting the server.
//
//   user.apiKeys [{ id, name, h, scopes: ['training', …], write, created, last }]
//   a key on the wire: ogk_<id>_<secret>  (id: 12 hex characters, secret: 32 bytes base64url)
//
// A write lands in the profile the way an API script's PUT /api/data does: the server stamps what
// changed (commitState with overRead, sync-stamps.js), so every device keeps it on its next merge.
import crypto from 'node:crypto';
import { DEL_LISTS } from './sync-stamps.js';

const isMap = v => !!v && typeof v === 'object' && !Array.isArray(v);
const list = v => (Array.isArray(v) ? v : []);
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export const MAX_KEYS = 10;
export const ENTRY_MAX_BYTES = 32 * 1024;
export const PAGE_MAX = 500;
const PAGE_DEFAULT = 100;

/** The areas a key opens: the lists it reads (and writes), and the settings it reads. */
export const SCOPES = {
  training: { lists: ['workouts', 'routines', 'customEx'], settings: ['week', 'dayPlan', 'exWeights', 'queue'] },
  body: { lists: ['bodyweight', 'measurements'], settings: ['targetW', 'unit'] },
  health: { lists: ['sleep', 'water', 'meals', 'foods', 'savedMeals', 'meds', 'medLog', 'habits', 'habitLog', 'habitGroups'], settings: ['nutrition', 'sleepPrefs', 'waterPrefs'] },
  exams: { lists: ['exams'], settings: [] },
  // A trainer's records of their students: someone else's data, so only a trainer's key has it.
  personal: { lists: ['students', 'sessions', 'sessionSeries', 'payments', 'assessments', 'notices', 'documents', 'tasks'], settings: [], trainer: true }
};
export const SCOPE_NAMES = Object.keys(SCOPES);
export const scopeOfList = name => SCOPE_NAMES.find(s => SCOPES[s].lists.includes(name)) || null;

/* ---------------------------------------------------------------- keys */

export const hashKey = secret => crypto.createHash('sha256').update('opengym-api:' + secret).digest('hex');
const KEY_RE = /^ogk_([0-9a-f]{12})_([A-Za-z0-9_-]{43})$/;

/** A new key: what is shown once (`key`) and what is kept (`id`, `h`). */
export function mintKey() {
  const id = crypto.randomBytes(6).toString('hex');
  const secret = crypto.randomBytes(32).toString('base64url');
  return { id, key: `ogk_${id}_${secret}`, h: hashKey(secret) };
}

/** The key's id and secret from an Authorization header, or null. */
export function parseBearer(header) {
  const auth = String(header || '');
  const m = auth.startsWith('Bearer ') ? KEY_RE.exec(auth.slice(7).trim()) : null;
  return m ? { id: m[1], secret: m[2] } : null;
}

/** The user and key an Authorization header names, or null: an unknown, wrong or revoked key, or a disabled account. */
export function findKey(users, header) {
  const p = parseBearer(header);
  if (!p) return null;
  const want = Buffer.from(hashKey(p.secret), 'hex');
  for (const user of list(users)) {
    const key = list(user?.apiKeys).find(k => k?.id === p.id);
    if (!key) continue;
    if (user.disabled || typeof key.h !== 'string' || key.h.length !== 64) return null;
    return crypto.timingSafeEqual(Buffer.from(key.h, 'hex'), want) ? { user, key } : null;
  }
  return null;
}

/** A key as the owner sees it in Settings: never its hash. */
export const keyView = k => ({ id: k.id, name: k.name, scopes: list(k.scopes), write: !!k.write, created: k.created || null, last: k.last || null });

/** A new key's settings from the form; { error } without a name ('name') or an area ('scopes'). */
export function normalizeKeyInput(body, { trainer = false } = {}) {
  const name = String(body?.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
  if (!name) return { error: 'name' };
  const scopes = SCOPE_NAMES.filter(s => list(body?.scopes).includes(s) && (!SCOPES[s].trainer || trainer));
  if (!scopes.length) return { error: 'scopes' };
  return { name, scopes, write: body?.write === true };
}

/* ---------------------------------------------------------------- entries */

// The day an entry is about, for the ?from= &to= filter, and the key a day-keyed list uses.
const DAY_KEYED = new Set(['bodyweight', 'measurements']);
const str = v => typeof v === 'string' && v.trim() !== '';
const num = v => typeof v === 'number' && Number.isFinite(v);
const pos = v => num(v) && v > 0;
const arr = v => Array.isArray(v);

// What each list needs of an entry. Lists not named here take any object: the app's own
// normalizers read them defensively, as they do a backup or an older app's copy.
const REQUIRED = {
  workouts: { d: DAY_RE, start: num, entries: arr },
  routines: { name: str, ex: arr },
  customEx: { name: str },
  bodyweight: { d: DAY_RE, w: pos },
  measurements: { d: DAY_RE },
  sleep: { d: DAY_RE, bed: str, wake: str },
  water: { d: DAY_RE, ml: pos },
  meals: { d: DAY_RE, slot: str, items: arr },
  foods: { name: str, per100: isMap },
  savedMeals: { name: str, items: arr },
  meds: { name: str, times: arr },
  medLog: { medId: str, d: DAY_RE, time: HHMM_RE, status: v => v === 'taken' || v === 'skipped' },
  habits: { name: str, kind: str },
  habitLog: { habitId: str, d: DAY_RE },
  habitGroups: { name: str },
  exams: { d: DAY_RE },
  students: { name: str },
  sessions: { d: DAY_RE, time: HHMM_RE },
  payments: { d: DAY_RE, amount: num },
  tasks: { title: str },
  notices: { title: str }
};
// The lists whose ids the app builds from the entry itself, so a device that logs the same dose
// or check-in finds this one and does not add a second.
const DERIVED_ID = {
  medLog: e => `${e.medId}|${e.d}|${e.time}`,
  habitLog: e => `${e.habitId}|${e.d}`
};
const INTERNAL = ['_ts', '_f', '_u'];

/** An entry's key in its list: its day for bodyweight and measurements, its id for the rest. */
export const keyOf = (name, e) => (DAY_KEYED.has(name) ? e?.d : DEL_LISTS[name] ? DEL_LISTS[name](e) : e?.id);

/** An entry as the API hands it out: without the sync stamps. */
export function publicEntry(e) {
  if (!isMap(e)) return e;
  const out = { ...e };
  for (const k of INTERNAL) delete out[k];
  return out;
}

/** Whether `e` is a valid entry of `name`; { error, field } when not. */
export function checkEntry(name, e) {
  if (!isMap(e)) return { error: 'not an object' };
  let size;
  try { size = Buffer.byteLength(JSON.stringify(e)); } catch { return { error: 'not an object' }; }
  if (size > ENTRY_MAX_BYTES) return { error: 'too large' };
  for (const [field, rule] of Object.entries(REQUIRED[name] || {})) {
    const v = e[field];
    const ok = rule instanceof RegExp ? typeof v === 'string' && rule.test(v) : rule(v);
    if (!ok) return { error: 'invalid field', field };
  }
  if ('d' in e && !(typeof e.d === 'string' && DAY_RE.test(e.d))) return { error: 'invalid field', field: 'd' };
  return null;
}

/**
 * A new entry of `name` from a POST body: the client's id and stamps dropped, the id the server
 * gives (or the one the app derives), and the moment it was made. { error } when invalid.
 */
export function newEntry(name, body, { now = Date.now(), id = crypto.randomBytes(9).toString('base64url') } = {}) {
  if (!isMap(body)) return { error: 'not an object' };
  const e = publicEntry(body);
  delete e.id;
  if (name === 'water' && !num(e.t)) e.t = now;
  if ((name === 'bodyweight' || name === 'measurements') && !num(e.t)) e.t = now;
  const bad = checkEntry(name, e);
  if (bad) return bad;
  if (!DAY_KEYED.has(name)) e.id = DERIVED_ID[name] ? DERIVED_ID[name](e) : id;
  if (!DAY_KEYED.has(name) && name !== 'workouts' && !num(e.created)) e.created = now;
  return { entry: e };
}

/** `old` changed by a PATCH body: its key fields kept. { error } when the result is invalid. */
export function patchEntry(name, old, body) {
  if (!isMap(body)) return { error: 'not an object' };
  const e = { ...publicEntry(old), ...publicEntry(body) };
  e.id = old.id;
  if (old.id === undefined) delete e.id;
  if (DAY_KEYED.has(name)) e.d = old.d;
  if (DERIVED_ID[name]) for (const k of name === 'medLog' ? ['medId', 'd', 'time'] : ['habitId', 'd']) e[k] = old[k];
  const bad = checkEntry(name, e);
  return bad || { entry: e };
}

/* ---------------------------------------------------------------- reading */

const when = e => Number(e?.t) || Number(e?.start) || Number(e?.at) || Number(e?.created) || 0;

/**
 * One page of a list: entries of a day between `from` and `to` (both inclusive, for the lists
 * that have days), newest first, `limit` at a time from `cursor` (an offset the last page gave).
 */
export function pageOf(entries, { from = null, to = null, limit = PAGE_DEFAULT, cursor = null } = {}) {
  const n = Math.min(PAGE_MAX, Math.max(1, Math.round(Number(limit)) || PAGE_DEFAULT));
  const start = Math.max(0, parseInt(cursor, 10) || 0);
  const okFrom = typeof from === 'string' && DAY_RE.test(from) ? from : null;
  const okTo = typeof to === 'string' && DAY_RE.test(to) ? to : null;
  const all = list(entries).filter(isMap).filter(e => {
    if (!okFrom && !okTo) return true;
    if (typeof e.d !== 'string') return false;
    return (!okFrom || e.d >= okFrom) && (!okTo || e.d <= okTo);
  });
  const dated = all.some(e => typeof e.d === 'string');
  const sorted = dated ? all.map((e, i) => [e, i]).sort(([a, i], [b, j]) => (String(b.d || '').localeCompare(String(a.d || ''))) || (when(b) - when(a)) || (i - j)).map(([e]) => e) : all;
  const page = sorted.slice(start, start + n).map(publicEntry);
  return { items: page, total: sorted.length, next: start + n < sorted.length ? String(start + n) : null };
}

/** The settings a key's areas open. */
export function settingsFor(S, scopes) {
  const out = {};
  for (const s of list(scopes)) for (const k of SCOPES[s]?.settings || []) if (S?.[k] !== undefined) out[k] = S[k];
  return out;
}
