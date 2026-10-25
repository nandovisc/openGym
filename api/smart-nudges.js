// Smart reminders (Settings → Reminders → Smart reminders): pushes that come from what the person
// usually does rather than a fixed time, each switched on by itself, each at most once a day.
//
//   S.smartReminders { dose, weight, water, sleep, tz }   all off unless set
//
//   dose    a dose still unmarked an hour after the time it is usually marked (the median of the
//           last two weeks' marks, else its scheduled time) — a second, later word than medTick's
//   weight  no weigh-in for twice the usual gap between them (at least 3 days), at the hour the
//           person usually weighs in (else 08:00)
//   water   at 15:00 and 19:00, when the day's water is under 70% of where it should be by then
//   sleep   the Shortcut usually sends last night (5 of the last 7) and it has not by 11:00
//
// smartDue(S, now, { tz, windowMin, sleepLast }) → [{ key, kind, … }], what is owed at `now`
// ({ date, hhmm }); server.js smartTick sends them, once a key a day (user.smartSent).
const list = v => (Array.isArray(v) ? v : []);
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const toMin = v => { const m = /^(\d{2}):(\d{2})$/.exec(v || ''); return m ? +m[1] * 60 + +m[2] : NaN; };
const toHm = m => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(Math.round(m) % 60).padStart(2, '0')}`;
const back = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') - n * 86400000).toISOString().slice(0, 10);
const weekdayOf = d => new Date(d + 'T12:00:00Z').getUTCDay();
const median = xs => { if (!xs.length) return null; const s = xs.slice().sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
export const DOSE_LATE_MIN = 60;
export const WATER_TIMES = ['15:00', '19:00'];
export const WATER_SHARE = 0.7;
export const SLEEP_BY = '11:00';

/** The local 'HH:MM' of instant `ms` in zone `tz`, or null. */
export function localHm(ms, tz) {
  if (!(Number(ms) > 0)) return null;
  try {
    const p = new Intl.DateTimeFormat('en-GB', { timeZone: tz || 'UTC', hour12: false, hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(Number(ms)));
    const h = p.find(x => x.type === 'hour')?.value, m = p.find(x => x.type === 'minute')?.value;
    return h && m ? `${h === '24' ? '00' : h}:${m}` : null;
  } catch { return null; }
}

const due = (at, now, windowMin) => { const late = toMin(now.hhmm) - toMin(at); return late >= 0 && late <= windowMin; };

function doses(S, now, { tz, windowMin }) {
  const out = [];
  const log = new Map(list(S.medLog).filter(e => e?.id != null).map(e => [e.id, e]));
  for (const m of list(S.meds)) {
    if (!m?.id || m.active === false || (m.start && now.date < m.start) || (m.end && now.date > m.end)) continue;
    if (Array.isArray(m.days) && !m.days.includes(weekdayOf(now.date))) continue;
    for (const time of new Set(list(m.times).filter(x => TIME_RE.test(x || '')))) {
      const id = `${m.id}|${now.date}|${time}`;
      if (log.has(id)) continue;
      // When this dose is usually marked: the median of its marks in the last 14 days.
      const marks = [];
      for (let i = 1; i <= 14; i++) {
        const e = log.get(`${m.id}|${back(now.date, i)}|${time}`);
        const hm = e?.status === 'taken' ? localHm(e.at, tz) : null;
        if (hm) marks.push(toMin(hm));
      }
      const usual = marks.length >= 3 ? Math.max(toMin(time), median(marks)) : toMin(time);
      if (due(toHm(usual + DOSE_LATE_MIN), now, windowMin)) out.push({ key: 'dose:' + id, kind: 'dose', med: { id: m.id, name: m.name }, time });
    }
  }
  return out;
}

function weight(S, now, { tz, windowMin }) {
  const ws = list(S.bodyweight).filter(e => e?.d && Number(e.w) > 0).map(e => e.d).sort();
  const days = [...new Set(ws)];
  if (days.length < 3) return [];
  const gaps = [];
  for (let i = Math.max(1, days.length - 10); i < days.length; i++) gaps.push((Date.parse(days[i]) - Date.parse(days[i - 1])) / 86400000);
  const wait = Math.max(3, Math.round(2 * median(gaps)));
  const since = Math.round((Date.parse(now.date) - Date.parse(days.at(-1))) / 86400000);
  if (since < wait) return [];
  const hms = list(S.bodyweight).slice(-14).map(e => localHm(e?.t, tz)).filter(Boolean).map(toMin);
  const at = hms.length >= 3 ? toHm(median(hms)) : '08:00';
  return due(at, now, windowMin) ? [{ key: 'weight:' + now.date, kind: 'weight', days: since }] : [];
}

function water(S, now, { windowMin }) {
  const goal = (() => {
    const set = Number(S.waterPrefs?.goalMl);
    if (set > 0) return Math.round(set);
    const bw = list(S.bodyweight).filter(e => Number(e?.w) > 0).at(-1);
    if (!bw) return 2000;
    const kg = S.unit === 'lb' ? Number(bw.w) * 0.45359237 : Number(bw.w);
    return Math.max(1000, Math.round(kg * 35 / 50) * 50);
  })();
  const total = list(S.water).filter(e => e?.d === now.date).reduce((n, e) => n + (Math.round(Number(e.ml)) || 0), 0);
  const out = [];
  for (const at of WATER_TIMES) {
    if (!due(at, now, windowMin)) continue;
    const pace = Math.round(goal * Math.min(1, Math.max(0, (toMin(at) - 480) / (1320 - 480))));
    if (total < pace * WATER_SHARE) out.push({ key: 'water:' + at, kind: 'water', total, goal });
  }
  return out;
}

function sleep(S, now, { windowMin, sleepLast }) {
  if (!sleepLast || !due(SLEEP_BY, now, windowMin)) return [];
  const health = new Set(list(S.sleep).filter(n => n?.src === 'health').map(n => n.d));
  if (health.has(now.date)) return [];
  let usual = 0;
  for (let i = 1; i <= 7; i++) if (health.has(back(now.date, i))) usual++;
  return usual >= 5 ? [{ key: 'sleep:' + now.date, kind: 'sleep' }] : [];
}

/** What the smart reminders switched on owe at `now`. */
export function smartDue(S, now, { tz = 'UTC', windowMin = 15, sleepLast = null } = {}) {
  const on = S?.smartReminders || {};
  const ctx = { tz, windowMin, sleepLast };
  return [
    ...(on.dose ? doses(S, now, ctx) : []),
    ...(on.weight ? weight(S, now, ctx) : []),
    ...(on.water && S?.modules?.water !== false ? water(S, now, ctx) : []),
    ...(on.sleep ? sleep(S, now, ctx) : [])
  ];
}
