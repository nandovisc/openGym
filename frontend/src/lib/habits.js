// Habits (Health → Habits, views/Habits.jsx): making and editing them, marking a day, streaks,
// statistics and milestones. Framework-free. Whether a habit was done on a day is decided by
// lib/habits-core.js, the rules the server's reminders share (api/habits.js); the shapes of
// S.habits, S.habitLog and S.habitPrefs are described there.
//
//   S.habitGroups [{ id, name, collapsed, order }]
import { dayStatus, logId, scheduleFor, weekSummary, SOURCES, MEAL_SLOTS } from './habits-core.js'
import { isoOf, uid } from './format.js'

export * from './habits-core.js'

export const KINDS = ['check', 'quantity', 'timer', 'avoid', 'auto', 'task']
export const SCHEDULE_TYPES = ['daily', 'weekdays', 'monthdays', 'perWeek']
export const MILESTONES = [7, 21, 30, 66, 100, 365]
export const UNITS = ['ml', 'l', 'g', 'kg', 'km', 'min', 'pages', 'times', 'steps']
export const NAME_MAX = 60
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/
const list = v => (Array.isArray(v) ? v : [])
const text = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
export const addDays = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10)
const weekdayOf = d => new Date(d + 'T12:00:00Z').getUTCDay()

/** The person's day at `date`: before `dayStartsAt` ('HH:MM') it is still the day before. */
export function logicalDay(date = new Date(), dayStartsAt = '00:00') {
  const m = TIME_RE.test(dayStartsAt || '') ? +dayStartsAt.slice(0, 2) * 60 + +dayStartsAt.slice(3) : 0
  return isoOf(new Date(date.getTime() - m * 60000))
}
export const todayOf = (S, now = new Date()) => logicalDay(now, S?.habitPrefs?.dayStartsAt)

const sameSchedule = (a, b) => a.type === b.type && JSON.stringify(list(a.days).slice().sort()) === JSON.stringify(list(b.days).slice().sort()) && (a.times || 0) === (b.times || 0)

/**
 * A habit as stored, from the form. `{ error }` when it cannot be one: no name, no goal for a
 * quantity or a timer, no days for a schedule by days, no source for an automatic one. Editing
 * keeps the id and the rest of `prev`; a new schedule is added as a version starting `today`, so
 * the days before keep the schedule they had.
 */
export function normalizeHabit(input, { prev = null, today = isoOf(new Date()), now = Date.now() } = {}) {
  const name = text(input?.name, NAME_MAX)
  if (!name) return { error: 'name' }
  const kind = KINDS.includes(input?.kind) ? input.kind : 'check'
  const goalValue = Number(input?.goal?.value)
  if ((kind === 'quantity' || kind === 'timer') && !(goalValue > 0)) return { error: 'goal' }
  const auto = kind === 'auto' ? {
    source: SOURCES.includes(input?.auto?.source) ? input.auto.source : null,
    ...(input.auto?.source === 'meals' ? { mode: input.auto.mode === 'target' ? 'target' : 'slots', slots: list(input.auto.slots).filter(x => MEAL_SLOTS.includes(x)) } : {}),
    ...(input.auto?.source === 'sleep' ? { mode: input.auto.mode === 'bedBy' ? 'bedBy' : 'goal', ...(TIME_RE.test(input.auto.bedBy || '') ? { bedBy: input.auto.bedBy } : {}) } : {})
  } : null
  if (kind === 'auto' && !auto.source) return { error: 'source' }
  const sIn = input?.schedule || { type: 'daily' }
  const type = SCHEDULE_TYPES.includes(sIn.type) ? sIn.type : 'daily'
  const schedule = { type,
    ...(type === 'weekdays' ? { days: [...new Set(list(sIn.days).map(Number).filter(n => n >= 0 && n <= 6))].sort() } : {}),
    ...(type === 'monthdays' ? { days: [...new Set(list(sIn.days).map(Number).filter(n => n >= 1 && n <= 31))].sort((a, b) => a - b) } : {}),
    ...(type === 'perWeek' ? { times: Math.min(7, Math.max(1, Math.round(Number(sIn.times) || 1))) } : {}) }
  if ((type === 'weekdays' || type === 'monthdays') && !schedule.days.length) return { error: 'days' }
  const start = DAY_RE.test(input?.start || '') ? input.start : prev?.start || today
  const end = DAY_RE.test(input?.end || '') ? input.end : null
  if (end && end < start) return { error: 'end' }
  let schedules = list(prev?.schedules)
  const last = schedules.length ? scheduleFor({ schedules }, today) : null
  if (kind !== 'task' && (!last || !sameSchedule(last, schedule))) {
    // Changed today: the version that started today is replaced, an older one kept for its days.
    schedules = [...schedules.filter(v => (v.from || '') < (prev ? today : start)), { from: prev ? today : start, ...schedule }]
  }
  return {
    ...(prev || {}),
    id: prev?.id || uid(), kind, name,
    icon: text(input.icon, 8) || prev?.icon || '',
    color: /^#[0-9a-f]{6}$/i.test(input.color || '') ? input.color : prev?.color || '',
    groups: [...new Set(list(input.groups).map(x => String(x)).filter(Boolean))].slice(0, 5),
    goal: kind === 'quantity' || kind === 'timer' ? { value: goalValue, unit: kind === 'timer' ? 'min' : text(input.goal?.unit, 12) || 'times' } : null,
    auto,
    schedules: kind === 'task' ? [] : schedules,
    ...(kind === 'task' ? { due: DAY_RE.test(input.due || '') ? input.due : null } : {}),
    start, end,
    reminders: [...new Set(list(input.reminders).filter(t => TIME_RE.test(t || '')))].sort().slice(0, 6),
    timer: kind === 'timer' ? { stopAtGoal: input.timer?.stopAtGoal !== false, intervalMin: Math.max(0, Math.round(Number(input.timer?.intervalMin) || 0)), tapStarts: input.timer?.tapStarts !== false } : null,
    rule: { cue: text(input.rule?.cue, 120), routine: text(input.rule?.routine, 120), reward: text(input.rule?.reward, 120) },
    excludeFromDaily: !!input.excludeFromDaily,
    smartReminder: !!input.smartReminder,
    listChart: ['bars', 'grid', 'line'].includes(input.listChart) ? input.listChart : null,
    showStreak: input.showStreak !== false,
    archived: !!prev?.archived,
    order: Number.isFinite(prev?.order) ? prev.order : now,
    created: prev?.created || now
  }
}

/** A copy of `habit` to start afresh: a new id, no history, `name` as given. */
export const duplicateHabit = (habit, name, { today = isoOf(new Date()), now = Date.now() } = {}) =>
  ({ ...habit, id: uid(), name: text(name, NAME_MAX) || habit.name, archived: false, start: today, schedules: [{ ...scheduleFor(habit, today), from: today }], order: now, created: now })

/* ---------- marking a day ---------- */

const entryOf = (log, habit, d) => list(log).find(e => e?.id === logId(habit.id, d)) || null
// `log` with the day's entry of `habit` changed by `fn` (a fresh one if it had none); an entry
// left with nothing in it is dropped.
function withEntry(log, habit, d, fn, at = Date.now()) {
  const prev = entryOf(log, habit, d)
  const next = { ...(prev || { id: logId(habit.id, d), habitId: habit.id, d }), ...fn(prev || {}), at }
  for (const k of ['value', 'slips']) if (!next[k]) delete next[k]
  for (const k of ['done', 'state', 'timer']) if (!next[k]) delete next[k]
  const empty = !next.value && !next.slips && !next.done && !next.state && !next.timer
  const rest = list(log).filter(e => e?.id !== next.id)
  return empty ? rest : [...rest, next]
}
export const toggleDone = (log, habit, d, at) => withEntry(log, habit, d, e => ({ done: !e.done, state: null }), at)
export const addValue = (log, habit, d, delta, at) => withEntry(log, habit, d, e => ({ value: Math.max(0, Math.round(((Number(e.value) || 0) + delta) * 100) / 100), state: null }), at)
export const setValue = (log, habit, d, value, at) => withEntry(log, habit, d, () => ({ value: Math.max(0, Math.round((Number(value) || 0) * 100) / 100), state: null }), at)
export const addSlip = (log, habit, d, at) => withEntry(log, habit, d, e => ({ slips: (Number(e.slips) || 0) + 1 }), at)
export const undoSlip = (log, habit, d, at) => withEntry(log, habit, d, e => ({ slips: Math.max(0, (Number(e.slips) || 0) - 1) }), at)
/** The day marked skipped or failed by hand, or (state null) the mark taken off. */
export const setState = (log, habit, d, state, at) => withEntry(log, habit, d, () => ({ state: state === 'skipped' || state === 'failed' ? state : null }), at)

/** Minutes a running timer has added so far (`entry.timer.since` a time in ms). */
export const timerExtra = (entry, now = Date.now()) => (entry?.timer?.since ? Math.max(0, (now - entry.timer.since) / 60000) : 0)
export const startTimer = (log, habit, d, now = Date.now()) => withEntry(log, habit, d, e => ({ timer: e.timer || { since: now } }), now)
/** The timer stopped: its minutes added to the day, at most up to the goal when it stops there. */
export function stopTimer(log, habit, d, now = Date.now()) {
  return withEntry(log, habit, d, e => {
    let value = (Number(e.value) || 0) + timerExtra(e, now)
    if (habit.timer?.stopAtGoal && habit.goal?.value) value = Math.min(value, Math.max(Number(e.value) || 0, habit.goal.value))
    return { value: Math.round(value * 10) / 10, timer: null }
  }, now)
}
/** Whether a running timer has reached its goal (to stop it on its own). */
export const timerReached = (habit, entry, now = Date.now()) =>
  !!(habit.timer?.stopAtGoal && entry?.timer && (Number(entry.value) || 0) + timerExtra(entry, now) >= (habit.goal?.value || Infinity))

/* ---------- reading the days ---------- */

/** How `habit` went on `d` (lib/habits-core.js dayStatus), a running timer counted until `now`. */
export function statusOn(habit, d, S, today, now = Date.now()) {
  const e = habit.kind === 'timer' ? entryOf(S.habitLog, habit, d) : null
  return dayStatus(habit, d, S, today, { extra: timerExtra(e, now) })
}

const weekStartOf = S => (S?.weekStart === 0 ? 0 : 1)
const weekOf = (d, ws) => addDays(d, -((weekdayOf(d) - ws + 7) % 7))

/**
 * The streak of `habit` at `today`: { current, best, unit: 'days' | 'weeks' }. A day counts when
 * done; skipped days and days with nothing asked neither count nor break it; a missed, failed or
 * short (partial) day breaks it; today still open does not. A perWeek habit counts weeks that reached their
 * number, the week under way not breaking it.
 */
export function streak(habit, S, today) {
  const from = habit.start && habit.start <= today ? habit.start : addDays(today, -400)
  if (scheduleFor(habit, today).type === 'perWeek') {
    const ws = weekStartOf(S)
    const weeks = []
    for (let w = weekOf(from, ws); w <= today; w = addDays(w, 7)) {
      let done = 0, skipped = 0
      for (let i = 0; i < 7; i++) {
        const d = addDays(w, i)
        if (d > today || d < from) continue
        const st = dayStatus(habit, d, S, today).state
        if (st === 'done') done++; else if (st === 'skipped') skipped++
      }
      const times = scheduleFor(habit, w).times || 1
      weeks.push({ w, ok: done >= times, open: addDays(w, 6) >= today, skip: skipped >= 7 - times + 1 && done < times })
    }
    return runs(weeks.map(x => (x.ok ? 'done' : x.skip ? 'skip' : x.open ? 'open' : 'miss')), 'weeks')
  }
  const days = []
  for (let d = from; d <= today; d = addDays(d, 1)) {
    const st = dayStatus(habit, d, S, today).state
    // A past day only partly done fell short of the goal: it breaks the streak like a miss.
    days.push(st === 'done' ? 'done' : d === today ? 'open' : st === 'missed' || st === 'failed' || st === 'partial' ? 'miss' : 'skip')
  }
  return runs(days, 'days')
}
function runs(marks, unit) {
  let best = 0, run = 0
  for (const m of marks) { if (m === 'done') { run++; best = Math.max(best, run) } else if (m === 'miss') run = 0 }
  return { current: run, best, unit }
}

/**
 * How `habit` went from `from` to `to`: { done, partial, missed, failed, skipped, rate } — rate is
 * done over the days that counted (null with none). A perWeek habit is counted in weeks.
 */
export function stats(habit, S, from, to, today) {
  const out = { done: 0, partial: 0, missed: 0, failed: 0, skipped: 0, rate: null }
  const start = habit.start && habit.start > from ? habit.start : from
  const end = to < today ? to : today
  for (let d = start; d <= end; d = addDays(d, 1)) {
    const st = dayStatus(habit, d, S, today).state
    if (st in out) out[st]++
  }
  if (scheduleFor(habit, end).type === 'perWeek') {
    const ws = weekStartOf(S), times = scheduleFor(habit, end).times || 1
    let ok = 0, n = 0
    for (let w = weekOf(start, ws); w <= end; w = addDays(w, 7)) {
      if (addDays(w, 6) >= today) continue
      let done = 0
      for (let i = 0; i < 7; i++) if (dayStatus(habit, addDays(w, i), S, today).state === 'done') done++
      n++; if (done >= times) ok++
    }
    out.rate = n ? ok / n : null
    return out
  }
  const counted = out.done + out.partial + out.missed + out.failed
  out.rate = counted ? out.done / counted : null
  return out
}

/** The habits that count today: not archived, not a task, not left out of the daily progress. */
export const activeHabits = S => list(S.habits).filter(h => h && !h.archived)

/** The day's progress over the habits it asks for: { done, total } (tasks and exclusions aside). */
export function dailyProgress(S, d, today) {
  let done = 0, total = 0
  for (const h of activeHabits(S)) {
    if (h.kind === 'task' || h.excludeFromDaily) continue
    const st = dayStatus(h, d, S, today).state
    if (st === 'off' || st === 'skipped') continue
    total++
    if (st === 'done') done++
  }
  return { done, total }
}

/** Misses (missed or failed) by weekday over a period, 0 = Sunday: where the week is weak. */
export function weekdayMisses(S, from, to, today) {
  const out = [0, 0, 0, 0, 0, 0, 0]
  for (const h of activeHabits(S)) {
    if (h.kind === 'task') continue
    for (let d = from; d <= to && d < today; d = addDays(d, 1)) {
      const st = dayStatus(h, d, S, today).state
      if (st === 'missed' || st === 'failed') out[weekdayOf(d)]++
    }
  }
  return out
}

/** The milestones (MILESTONES) the best streak has reached. */
export const milestones = (habit, S, today) => { const { best, unit } = streak(habit, S, today); return MILESTONES.filter(m => best >= m).map(m => ({ days: m, unit })) }

/** The value of each day from `from` to `to`, for a chart or the year map: [{ d, value, state }]. */
export function series(habit, S, from, to, today) {
  const out = []
  for (let d = from; d <= to; d = addDays(d, 1)) { const st = dayStatus(habit, d, S, today); out.push({ d, value: st.value, goal: st.goal, state: st.state }) }
  return out
}

/** The habits as a file of their own: what the app keeps of them, for another tool. */
export const exportHabits = S => ({ exported: new Date().toISOString(), habits: list(S.habits), groups: list(S.habitGroups), log: list(S.habitLog), prefs: { ...(S.habitPrefs || {}), tz: undefined } })

/**
 * The week just over and the one before it, for the recap: { from, to, week, previous, change }
 * — change: the rate's difference in points, null without both weeks.
 */
export function weeklyRecap(S, today) {
  const ws = weekStartOf(S)
  const start = weekOf(today, ws)
  const from = addDays(start, -7), to = addDays(start, -1)
  const week = weekSummary(S, from, to), previous = weekSummary(S, addDays(from, -7), addDays(from, -1))
  const change = week.rate != null && previous.rate != null ? Math.round((week.rate - previous.rate) * 100) : null
  return { from, to, week, previous, change }
}

/* ---------- the calendar (.ics) ---------- */

const ICS_DAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']
const icsText = s => String(s || '').replace(/\\/g, '\\\\').replace(/[,;]/g, m => '\\' + m).replace(/\n/g, '\\n')
const icsDate = d => d.replace(/-/g, '')
/**
 * A calendar file (iCalendar) with an event repeating at each reminder time of `habits`, as their
 * schedule repeats: every day, on its weekdays or days of the month (N times a week: every day).
 * Floating local times, fifteen minutes long, until its end.
 */
export function icsFor(habits, { today = isoOf(new Date()), now = new Date() } = {}) {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '')
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//openGym//Habits//EN', 'CALSCALE:GREGORIAN']
  for (const h of list(habits)) {
    if (!h?.id || h.archived || h.kind === 'avoid') continue
    const times = list(h.reminders).length ? list(h.reminders) : ['09:00']
    const s = scheduleFor(h, today)
    const start = h.kind === 'task' ? h.due || today : (h.start && h.start > today ? h.start : today)
    let rule = 'FREQ=DAILY'
    if (s.type === 'weekdays') rule = 'FREQ=WEEKLY;BYDAY=' + list(s.days).map(i => ICS_DAY[i]).join(',')
    if (s.type === 'monthdays') rule = 'FREQ=MONTHLY;BYMONTHDAY=' + list(s.days).join(',')
    if (h.end) rule += ';UNTIL=' + icsDate(h.end) + 'T235959'
    for (const t of times) {
      const hm = t.replace(':', '')
      const endMin = (+t.slice(0, 2) * 60 + +t.slice(3) + 15) % 1440
      const endHm = String(Math.floor(endMin / 60)).padStart(2, '0') + String(endMin % 60).padStart(2, '0')
      lines.push('BEGIN:VEVENT', `UID:${h.id}-${hm}@opengym`, `DTSTAMP:${stamp}`, `DTSTART:${icsDate(start)}T${hm}00`, `DTEND:${icsDate(start)}T${endHm}00`,
        ...(h.kind === 'task' ? [] : [`RRULE:${rule}`]), `SUMMARY:${icsText(h.name)}`, ...(h.rule?.routine ? [`DESCRIPTION:${icsText(h.rule.routine)}`] : []), 'END:VEVENT')
    }
  }
  lines.push('END:VCALENDAR')
  return lines.join('\r\n') + '\r\n'
}

/** `habits` with the ids of `ordered` moved to that order (each `order` set from its place). */
export function reorder(habits, ordered) {
  const pos = new Map(ordered.map((id, i) => [id, i]))
  return list(habits).map(h => (pos.has(h.id) ? { ...h, order: pos.get(h.id) + 1 } : h))
}

/* ---------- habits the app already has the data for ---------- */

// How far back a habit made from existing data starts: its history shows at once, and the days
// read for its streak stay few.
export const SEED_DAYS = 90

/**
 * The automatic habits the profile's own data asks for and does not have yet (an archived one
 * counts as had): medications taken daily, the workouts at the person's usual weekly rate, the
 * weigh-ins (daily when they are near daily, else weekly), the meals and the sleep logged lately.
 * Each starts at the first day of its data within SEED_DAYS, so its streak and rates show at
 * once. `names` gives each its name in the person's language.
 */
export function suggestedHabits(S, today, names = {}) {
  const have = new Set(list(S.habits).filter(h => h?.kind === 'auto').map(h => h.auto?.source))
  const floor = addDays(today, -(SEED_DAYS - 1))
  const since = ds => { const xs = ds.filter(d => DAY_RE.test(d || '') && d >= floor && d <= today).sort(); return xs[0] || null }
  const last = (ds, n) => ds.filter(d => DAY_RE.test(d || '') && d > addDays(today, -n) && d <= today)
  const out = []
  const add = (source, extra, start) => out.push({ name: names[source] || source, kind: 'auto', auto: { source, ...extra.auto }, schedule: extra.schedule || { type: 'daily' }, start: start || today, groups: [] })

  const meds = list(S.meds).filter(m => m?.id && m.active !== false && list(m.times).length)
  if (meds.length && !have.has('meds')) {
    const starts = meds.map(m => m.start || (m.created ? isoOf(new Date(m.created)) : today))
    add('meds', {}, starts.sort()[0] < floor ? floor : starts.sort()[0])
  }
  const wDays = [...new Set(list(S.workouts).map(w => w?.d))]
  if (last(wDays, 28).length && !have.has('workout')) {
    const perWeek = Math.min(7, Math.max(1, Math.round(last(wDays, 28).length / 4)))
    add('workout', { schedule: { type: 'perWeek', times: perWeek } }, since(wDays))
  }
  const bDays = list(S.bodyweight).map(e => e?.d)
  if (last(bDays, 28).length && !have.has('weight')) {
    const daily = last(bDays, 14).length >= 10
    add('weight', { schedule: daily ? { type: 'daily' } : { type: 'perWeek', times: Math.min(7, Math.max(1, Math.round(last(bDays, 28).length / 4))) } }, since(bDays))
  }
  const mDays = [...new Set(list(S.meals).filter(m => list(m?.items).length).map(m => m.d))]
  if (last(mDays, 14).length >= 3 && !have.has('meals')) add('meals', { auto: { mode: 'slots', slots: ['breakfast', 'lunch', 'dinner'] } }, since(mDays))
  const sDays = list(S.sleep).map(n => n?.d)
  if (last(sDays, 14).length >= 3 && !have.has('sleep')) add('sleep', { auto: { mode: 'goal' } }, since(sDays))
  // One id per source: two phones making them before they sync make the same habit, not two.
  return out.map((x, i) => normalizeHabit(x, { today, now: Date.now() + i })).filter(h => !h.error).map(h => ({ ...h, id: 'auto-' + h.auto.source }))
}
