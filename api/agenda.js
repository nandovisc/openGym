// A trainer's classes (the Personal module, phase 5): which student, when, how long, and whether
// it happened. The app's copy is frontend/src/lib/agenda.js; the two must agree (frontend/src/lib/
// agenda-parity.test.js runs both): the server reminds from the same classes the app shows.
// Self-contained on purpose: everything is read straight off the trainer's profile.
//
//   S.sessionSeries [{ id, recordId, days: [0..6], time: 'HH:MM', dur, from, until, created }]
//     a class every week on those weekdays (0 = Sunday), from `from` to `until` (null: open)
//   S.sessions [{ id, recordId, d, time, dur, status, note, seriesId, created }]
//     a single class (no seriesId), or what changed of one class of a series (its id is
//     `<seriesId>|<the day it was due>`): done or cancelled, a note, moved to another day or time.
//     status: scheduled | done | canceled
//   S.students — the trainer's records (lib/students.js); recordId points at one.
//
// occurrences(S, from, to) → every class from `from` to `to` (ISO days), in order:
//   { id, seriesId, recordId, d, time, at: 'YYYY-MM-DDTHH:MM', dur, status, note, moved }
const list = v => (Array.isArray(v) ? v : []);
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
export const STATUSES = ['scheduled', 'done', 'canceled'];
const next = d => new Date(Date.parse(d + 'T12:00:00Z') + 86400000).toISOString().slice(0, 10);
const weekdayOf = d => new Date(d + 'T12:00:00Z').getUTCDay();
const toMin = v => { const m = /^(\d{2}):(\d{2})$/.exec(v || ''); return m ? +m[1] * 60 + +m[2] : NaN; };

function shape(base, over) {
  const o = over || {};
  const d = DAY_RE.test(o.d || '') ? o.d : base.d;
  const time = TIME_RE.test(o.time || '') ? o.time : base.time;
  return {
    id: base.id, seriesId: base.seriesId || null, recordId: o.recordId || base.recordId || null,
    d, time, at: `${d}T${time}`, dur: Number(o.dur) > 0 ? Math.round(o.dur) : base.dur || 60,
    status: STATUSES.includes(o.status) ? o.status : 'scheduled', note: typeof o.note === 'string' ? o.note : '',
    moved: !!(over && (d !== base.d || time !== base.time))
  };
}

/** Every class from `from` to `to` (inclusive ISO days), series and single, in order. */
export function occurrences(S, from, to) {
  if (!DAY_RE.test(from || '') || !DAY_RE.test(to || '') || from > to) return [];
  const explicit = new Map(list(S?.sessions).filter(x => x && typeof x.id === 'string').map(x => [x.id, x]));
  const out = [], seen = new Set();
  for (const s of list(S?.sessionSeries)) {
    if (!s?.id || !TIME_RE.test(s.time || '') || !list(s.days).length) continue;
    const start = DAY_RE.test(s.from || '') && s.from > from ? s.from : from;
    const end = DAY_RE.test(s.until || '') && s.until < to ? s.until : to;
    for (let d = start, n = 0; d <= end && n < 400; d = next(d), n++) {
      if (!s.days.includes(weekdayOf(d))) continue;
      const id = `${s.id}|${d}`;
      seen.add(id);
      const o = shape({ id, seriesId: s.id, recordId: s.recordId, d, time: s.time, dur: s.dur }, explicit.get(id));
      if (o.d >= from && o.d <= to) out.push(o);
    }
  }
  // Single classes, and classes of a series moved into these days from a day outside them.
  for (const x of explicit.values()) {
    if (seen.has(x.id) || !DAY_RE.test(x.d || '') || !TIME_RE.test(x.time || '')) continue;
    if (x.seriesId && !list(S?.sessionSeries).some(s => s?.id === x.seriesId)) continue;
    const o = shape({ id: x.id, seriesId: x.seriesId || null, recordId: x.recordId, d: x.d, time: x.time, dur: x.dur }, x);
    if (o.d >= from && o.d <= to) out.push(o);
  }
  return out.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}

/**
 * The classes `remindMin` minutes from `now` ({ date, hhmm }) that are still on, within
 * `windowMin` (the tick's catch-up): what the reminder push says.
 */
export function agendaDue(S, now, { remindMin = 30, windowMin = 15 } = {}) {
  const nowMin = toMin(now.hhmm);
  return occurrences(S, now.date, now.date).filter(o => {
    if (o.status !== 'scheduled') return false;
    const late = nowMin - (toMin(o.time) - remindMin);
    return late >= 0 && late <= windowMin;
  });
}

/** The trainer's record of the student of class `o`, or null. */
export const recordOf = (S, o) => list(S?.students).find(r => r?.id === o.recordId) || null;
