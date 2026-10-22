// Habits: whether one was done on a day, and which reminders are owed (server.js habitTick). The
// app's copy of these rules is frontend/src/lib/habits-core.js; the two must agree on every day
// (frontend/src/lib/habits-parity.test.js runs both). Change one, change the other. Self-contained
// on purpose: the doses, workouts, weigh-ins, meals and nights are read straight off the profile.
//
//   S.habits [{ id, kind, name, goal: { value, unit }, auto: { source, slots, mode, bedBy },
//               schedules: [{ from, type, days, times }], start, end, reminders: ['HH:MM'],
//               archived, excludeFromDaily, created, … }]
//     kind: check | quantity | timer | avoid | auto | task. A task has `due` (a day or null) and
//     leaves the list once done. schedules: versions, each from its `from` day on; type daily |
//     weekdays (days 0..6, 0 = Sunday) | monthdays (days 1..31) | perWeek (times a week).
//   S.habitLog [{ id: habitId + '|' + d, habitId, d, value, slips, state: 'skipped' | 'failed',
//               done, timer: { since }, at }]  — one entry a habit and day.
//   S.habitPrefs { on, tz, dayStartsAt: 'HH:MM', vacations: [{ from, to, habitIds | null }], … }

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const list = v => (Array.isArray(v) ? v : []);
const minutesOf = hhmm => +hhmm.slice(0, 2) * 60 + +hhmm.slice(3, 5);
const weekdayOf = d => new Date(d + 'T12:00:00Z').getUTCDay();
const dayOfMonth = d => +d.slice(8, 10);

export const logId = (habitId, d) => `${habitId}|${d}`;
export const SOURCES = ['workout', 'weight', 'meds', 'meals', 'sleep'];
export const MEAL_SLOTS = ['breakfast', 'lunch', 'dinner', 'snack'];

/** The schedule of `habit` in force on day `d`: the last version starting on or before it. */
export function scheduleFor(habit, d) {
  const vs = list(habit?.schedules).filter(v => v && typeof v === 'object').slice().sort((a, b) => String(a.from || '').localeCompare(String(b.from || '')));
  let cur = vs[0] || { type: 'daily' };
  for (const v of vs) if (!v.from || v.from <= d) cur = v;
  return cur;
}

/** Whether a vacation (S.habitPrefs.vacations) pauses `habit` on `d`. */
export const onVacation = (habit, d, prefs) => list(prefs?.vacations).some(v =>
  v && DAY_RE.test(v.from || '') && DAY_RE.test(v.to || '') && v.from <= d && d <= v.to && (!Array.isArray(v.habitIds) || v.habitIds.includes(habit.id)));

/** Whether `habit` asks for anything on day `d` (a perWeek habit: every day of its weeks). */
export function scheduledOn(habit, d) {
  if (!habit || !DAY_RE.test(d || '')) return false;
  if (habit.kind === 'task') return !habit.due || habit.due <= d;
  if (habit.start && d < habit.start) return false;
  if (habit.end && d > habit.end) return false;
  const s = scheduleFor(habit, d);
  if (s.type === 'weekdays') return list(s.days).includes(weekdayOf(d));
  if (s.type === 'monthdays') return list(s.days).includes(dayOfMonth(d));
  return true;
}

// The doses of the day: scheduled for a medication active then, at each of its times.
function dosesOfDay(S, d) {
  const taken = new Map(list(S.medLog).filter(e => e?.d === d && !e.extra).map(e => [e.id, e.status]));
  let total = 0, done = 0;
  for (const m of list(S.meds)) {
    if (!m?.id || m.active === false || (m.start && d < m.start) || (m.end && d > m.end)) continue;
    if (Array.isArray(m.days) && !m.days.includes(weekdayOf(d))) continue;
    for (const t of new Set(list(m.times).filter(x => TIME_RE.test(x || '')))) {
      total++;
      if (taken.get(`${m.id}|${d}|${t}`) === 'taken') done++;
    }
  }
  return { total, done };
}
// A bedtime after noon is that evening; before noon, the small hours after it.
const bedLine = local => { const m = minutesOf(String(local).slice(11, 16)); return m < 720 ? m + 1440 : m; };

/**
 * What the modules say about an automatic habit on `d`: { value, goal, done, none, detail }.
 * none: nothing was asked that day (no dose due), so the day does not count.
 */
export function autoValue(habit, d, S) {
  const a = habit.auto || {};
  if (a.source === 'workout') {
    const n = list(S.workouts).filter(w => w?.d === d).length;
    return { value: n, goal: 1, done: n >= 1, detail: list(S.workouts).filter(w => w?.d === d).map(w => w.name).filter(Boolean).join(', ') };
  }
  if (a.source === 'weight') {
    const e = list(S.bodyweight).find(x => x?.d === d);
    return { value: e ? 1 : 0, goal: 1, done: !!e, detail: e ? String(e.w) : '' };
  }
  if (a.source === 'meds') {
    const { total, done } = dosesOfDay(S, d);
    return { value: done, goal: total, done: total > 0 && done >= total, none: total === 0, detail: `${done}/${total}` };
  }
  if (a.source === 'meals') {
    const meals = list(S.meals).filter(m => m?.d === d && list(m.items).length);
    if (a.mode === 'target') {
      const target = Number(S.nutrition?.targets?.kcal) || 0;
      const kcal = meals.reduce((s, m) => s + list(m.items).reduce((t, x) => t + (Number(x?.kcal) || 0), 0), 0);
      return { value: Math.round(kcal), goal: target, done: target > 0 && meals.length > 0 && Math.abs(kcal - target) <= target * 0.1, none: !target, detail: `${Math.round(kcal)}/${target}` };
    }
    const slots = list(a.slots).filter(x => MEAL_SLOTS.includes(x));
    const want = slots.length ? slots : ['breakfast', 'lunch', 'dinner'];
    const have = want.filter(slot => meals.some(m => m.slot === slot));
    return { value: have.length, goal: want.length, done: have.length >= want.length, detail: have.join(',') };
  }
  if (a.source === 'sleep') {
    const n = list(S.sleep).find(x => x?.d === d);
    if (!n) return { value: 0, goal: 1, done: false, detail: '' };
    if (a.mode === 'bedBy' && TIME_RE.test(a.bedBy || '')) {
      const limit = bedLine(`0000-00-00T${a.bedBy}`);
      return { value: 1, goal: 1, done: bedLine(n.bed) <= limit, detail: String(n.bed).slice(11, 16) };
    }
    const goal = Number(S.sleepPrefs?.goalMin) > 0 ? Number(S.sleepPrefs.goalMin) : 480;
    return { value: Number(n.asleepMin) || 0, goal, done: (Number(n.asleepMin) || 0) >= goal, detail: String(n.asleepMin || 0) };
  }
  return { value: 0, goal: 1, done: false, none: true, detail: '' };
}

/**
 * How `habit` went on day `d`, as of `today` (the person's day, dayStartsAt considered by the
 * caller), with `extra` minutes added to a timer still running:
 *   { state: 'done' | 'partial' | 'missed' | 'failed' | 'skipped' | 'pending' | 'off', value, goal, detail }
 * off: nothing asked (not scheduled, before its start, a day without a dose). A perWeek day not
 * done is 'off' rather than missed: its week is what counts. avoid: done for a past day without a
 * slip, pending today until the day is over.
 */
export function dayStatus(habit, d, S, today, { extra = 0 } = {}) {
  const goal0 = Number(habit?.goal?.value) || 1;
  if (!scheduledOn(habit, d)) return { state: 'off', value: 0, goal: goal0, detail: '' };
  const entry = list(S.habitLog).find(e => e?.id === logId(habit.id, d)) || null;
  if (entry?.state === 'skipped' || onVacation(habit, d, S.habitPrefs)) return { state: 'skipped', value: 0, goal: goal0, detail: '' };
  if (entry?.state === 'failed') return { state: 'failed', value: Number(entry.value) || 0, goal: goal0, detail: '' };
  let value = 0, goal = goal0, done = false, detail = '', none = false;
  if (habit.kind === 'auto') ({ value, goal, done, detail, none } = autoValue(habit, d, S));
  else if (habit.kind === 'avoid') {
    if ((Number(entry?.slips) || 0) > 0) return { state: 'failed', value: Number(entry.slips), goal: 0, detail: '' };
    return { state: d < today ? 'done' : 'pending', value: 0, goal: 0, detail: '' };
  }
  else if (habit.kind === 'check' || habit.kind === 'task') { done = !!entry?.done; value = done ? 1 : 0; goal = 1; }
  else { value = (Number(entry?.value) || 0) + (habit.kind === 'timer' ? extra : 0); done = value >= goal; }
  if (none) return { state: 'off', value, goal, detail };
  if (done) return { state: 'done', value, goal, detail };
  if (scheduleFor(habit, d).type === 'perWeek') return { state: value > 0 ? 'partial' : 'off', value, goal, detail };
  if (d >= today) return { state: value > 0 ? 'partial' : 'pending', value, goal, detail };
  return { state: value > 0 ? 'partial' : 'missed', value, goal, detail };
}

/**
 * The reminders owed at `now` ({ date, hhmm }): habits active today with a reminder time within
 * the last `windowMin` minutes and not yet done, skipped or failed. A medication habit is left to
 * the medication reminder when that is on. [{ habit, time, status }].
 */
export function habitsDue(S, now, windowMin) {
  const out = [];
  const at = minutesOf(now.hhmm);
  for (const h of list(S?.habits)) {
    if (!h?.id || h.archived || h.kind === 'avoid' || !list(h.reminders).length) continue;
    if (h.kind === 'auto' && h.auto?.source === 'meds' && S.medReminder?.on) continue;
    if (h.kind === 'task' && h.due && h.due !== now.date) continue;
    if (!scheduledOn(h, now.date)) continue;
    // Off on a scheduled day is a perWeek day not done yet (owed a reminder) or a day with no dose.
    const st = dayStatus(h, now.date, S, now.date);
    if (!['pending', 'partial', 'off'].includes(st.state)) continue;
    if (st.state === 'off' && scheduleFor(h, now.date).type !== 'perWeek') continue;
    for (const time of list(h.reminders)) {
      if (!TIME_RE.test(time || '')) continue;
      const late = at - minutesOf(time);
      if (late >= 0 && late <= windowMin) out.push({ habit: h, time, status: st });
    }
  }
  return out;
}
