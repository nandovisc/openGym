// Which medication doses a reminder is owed for (server.js medTick). The app's own copy of these
// rules is frontend/src/lib/meds.js — the shapes of S.meds and S.medLog are described there; the
// two must agree on when a dose is scheduled and on a dose's id (test/meds.test.js pins both).

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const list = v => (Array.isArray(v) ? v : []);

export const doseId = (medId, d, time) => `${medId}|${d}|${time}`;
const weekdayOf = d => new Date(d + 'T12:00:00Z').getUTCDay();
const minutesOf = hhmm => +hhmm.slice(0, 2) * 60 + +hhmm.slice(3);

/** Whether `med` has doses due on day `d`: active, within its start and end, on one of its days. */
export function isScheduledOn(med, d) {
  if (!med || med.active === false || !DAY_RE.test(d || '')) return false;
  if (med.start && d < med.start) return false;
  if (med.end && d > med.end) return false;
  return !Array.isArray(med.days) || med.days.includes(weekdayOf(d));
}

/**
 * The doses of today whose time has come within the last `windowMin` minutes on the user's clock
 * (`now` from server.js userNow) and that nobody has marked yet, grouped by time:
 * [{ time, meds: [...] }], in the order of the day.
 */
export function medsDue(S, now, windowMin) {
  const marked = new Set(list(S?.medLog).map(e => e?.id));
  const byTime = new Map();
  for (const med of list(S?.meds)) {
    if (!med?.id || !isScheduledOn(med, now.date)) continue;
    for (const time of new Set(list(med.times).filter(x => TIME_RE.test(x || '')))) {
      const late = minutesOf(now.hhmm) - minutesOf(time);
      if (!(late >= 0 && late <= windowMin)) continue;
      if (marked.has(doseId(med.id, now.date, time))) continue;
      byTime.set(time, [...(byTime.get(time) || []), med]);
    }
  }
  return [...byTime].sort(([a], [b]) => a.localeCompare(b)).map(([time, meds]) => ({ time, meds }));
}
