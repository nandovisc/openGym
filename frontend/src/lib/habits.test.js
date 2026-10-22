import { describe, expect, it } from 'vitest'
import {
  addSlip, addValue, dailyProgress, dayStatus, duplicateHabit, habitsDue, icsFor, logicalDay, milestones, normalizeHabit, reorder, scheduledOn,
  setState, startTimer, stats, stopTimer, streak, timerReached, toggleDone, weekdayMisses, weeklyRecap
} from './habits.js'

const T = '2026-10-22'   // a Thursday
const base = extra => ({ habits: [], habitLog: [], habitPrefs: {}, ...extra })
const make = (input, today = '2026-10-01') => normalizeHabit({ name: 'x', ...input }, { today, now: 1 })
const back = n => new Date(Date.parse(T + 'T12:00:00Z') - n * 86400000).toISOString().slice(0, 10)

describe('making a habit', () => {
  it('checks what each kind needs', () => {
    expect(normalizeHabit({ name: '' })).toEqual({ error: 'name' })
    expect(normalizeHabit({ name: 'Água', kind: 'quantity' })).toEqual({ error: 'goal' })
    expect(normalizeHabit({ name: 'Treino', kind: 'auto', auto: {} })).toEqual({ error: 'source' })
    expect(normalizeHabit({ name: 'x', schedule: { type: 'weekdays', days: [] } })).toEqual({ error: 'days' })
    const water = make({ name: 'Água', kind: 'quantity', goal: { value: 2000, unit: 'ml' }, reminders: ['10:00', 'bad', '08:00'] })
    expect(water).toMatchObject({ kind: 'quantity', goal: { value: 2000, unit: 'ml' }, reminders: ['08:00', '10:00'], start: '2026-10-01', schedules: [{ from: '2026-10-01', type: 'daily' }] })
  })
  it('keeps the old schedule for the days before a change', () => {
    const h = make({ schedule: { type: 'weekdays', days: [1, 3, 5] } })
    const h2 = normalizeHabit({ ...h, schedule: { type: 'daily' } }, { prev: h, today: '2026-10-20' })
    expect(h2.schedules.map(v => [v.from, v.type])).toEqual([['2026-10-01', 'weekdays'], ['2026-10-20', 'daily']])
    expect(scheduledOn(h2, '2026-10-14')).toBe(true)    // a Wednesday, under the old rule
    expect(scheduledOn(h2, '2026-10-13')).toBe(false)   // a Tuesday, under the old rule
    expect(scheduledOn(h2, '2026-10-21')).toBe(true)    // a Wednesday, daily now
    expect(scheduledOn(h2, '2026-09-30')).toBe(false)   // before its start
  })
  it('schedules by days of the month, and copies a habit without its history', () => {
    const h = make({ schedule: { type: 'monthdays', days: [1, 15] } })
    expect([back(6), '2026-10-15', '2026-10-01'].map(d => scheduledOn(h, d))).toEqual([false, true, true])
    const c = duplicateHabit(h, 'x (cópia)', { today: T, now: 2 })
    expect(c).toMatchObject({ name: 'x (cópia)', start: T, schedules: [{ from: T, type: 'monthdays', days: [1, 15] }] })
    expect(c.id).not.toBe(h.id)
  })
  it('the day starts when the person says', () => {
    expect(logicalDay(new Date('2026-10-22T02:30:00'), '04:00')).toBe('2026-10-21')
    expect(logicalDay(new Date('2026-10-22T05:00:00'), '04:00')).toBe('2026-10-22')
  })
})

describe('marking and reading a day', () => {
  it('a check, a quantity and a timer that stops at its goal', () => {
    const c = make({ name: 'Ler' }), q = make({ kind: 'quantity', goal: { value: 2000, unit: 'ml' } }), tm = make({ kind: 'timer', goal: { value: 30 } })
    let log = toggleDone([], c, T)
    log = addValue(log, q, T, 750)
    const S = base({ habitLog: log })
    expect(dayStatus(c, T, S, T).state).toBe('done')
    expect(dayStatus(q, T, S, T)).toMatchObject({ state: 'partial', value: 750, goal: 2000 })
    expect(dayStatus(q, back(1), S, T).state).toBe('missed')
    expect(toggleDone(log, c, T).find(e => e.habitId === c.id)).toBeUndefined()   // unmarked: entry gone
    const t0 = Date.parse('2026-10-22T10:00:00')
    let tl = startTimer([], tm, T, t0)
    expect(timerReached(tm, tl[0], t0 + 29 * 60000)).toBe(false)
    expect(timerReached(tm, tl[0], t0 + 31 * 60000)).toBe(true)
    tl = stopTimer(tl, tm, T, t0 + 45 * 60000)
    expect(tl[0]).toMatchObject({ value: 30 })
    expect(tl[0].timer).toBeUndefined()
  })
  it('skipped, failed, vacation, and a habit to avoid', () => {
    const c = make({}), a = make({ kind: 'avoid', name: 'Açúcar' })
    const S = base({ habitLog: setState(addSlip([], a, back(1)), c, back(2), 'skipped'), habitPrefs: { vacations: [{ from: back(5), to: back(4), habitIds: null }] } })
    expect(dayStatus(c, back(2), S, T).state).toBe('skipped')
    expect(dayStatus(c, back(4), S, T).state).toBe('skipped')
    expect(dayStatus(c, back(3), S, T).state).toBe('missed')
    expect(dayStatus(a, back(1), S, T).state).toBe('failed')
    expect(dayStatus(a, back(2), S, T).state).toBe('done')
    expect(dayStatus(a, T, S, T).state).toBe('pending')
    const S2 = base({ habitLog: setState([], c, back(3), 'failed') })
    expect(dayStatus(c, back(3), S2, T).state).toBe('failed')
  })
})

describe('habits the other modules mark', () => {
  const auto = (source, extra = {}) => make({ kind: 'auto', name: source, auto: { source, ...extra } })
  it('a workout, a weigh-in and the doses of the day', () => {
    const S = base({
      workouts: [{ id: 'w', d: T, name: 'Peito e tríceps' }], bodyweight: [{ d: T, w: 94.8, t: 1 }],
      meds: [{ id: 'm1', name: 'A', times: ['08:00', '20:00'], days: null, active: true }, { id: 'm2', name: 'B', times: ['08:00'], days: [0], active: true }],
      medLog: [{ id: `m1|${T}|08:00`, medId: 'm1', d: T, time: '08:00', status: 'taken' }]
    })
    expect(dayStatus(auto('workout'), T, S, T)).toMatchObject({ state: 'done', detail: 'Peito e tríceps' })
    expect(dayStatus(auto('workout'), back(1), S, T).state).toBe('missed')
    expect(dayStatus(auto('weight'), T, S, T)).toMatchObject({ state: 'done', detail: '94.8' })
    expect(dayStatus(auto('meds'), T, S, T)).toMatchObject({ state: 'partial', value: 1, goal: 2 })
    expect(dayStatus(auto('meds'), T, { ...S, meds: [] }, T).state).toBe('off')
  })
  it('meals by the ones logged or by the calorie target, and sleep by its goal or bedtime', () => {
    const meals = [{ id: 'a', d: T, slot: 'breakfast', items: [{ kcal: 500 }] }, { id: 'b', d: T, slot: 'lunch', items: [{ kcal: 900 }] }]
    const S = base({ meals, nutrition: { targets: { kcal: 1500 } }, sleep: [{ d: T, bed: back(1) + 'T23:30', wake: T + 'T07:00', asleepMin: 420 }], sleepPrefs: { goalMin: 480 } })
    expect(dayStatus(auto('meals', { slots: ['breakfast', 'lunch'] }), T, S, T).state).toBe('done')
    expect(dayStatus(auto('meals'), T, S, T)).toMatchObject({ state: 'partial', value: 2, goal: 3 })
    expect(dayStatus(auto('meals', { mode: 'target' }), T, S, T).state).toBe('done')
    expect(dayStatus(auto('sleep'), T, S, T)).toMatchObject({ state: 'partial', value: 420, goal: 480 })
    expect(dayStatus(auto('sleep', { mode: 'bedBy', bedBy: '23:45' }), T, S, T).state).toBe('done')
    expect(dayStatus(auto('sleep', { mode: 'bedBy', bedBy: '23:00' }), T, S, T).state).toBe('partial')
  })
})

describe('streaks, statistics, milestones', () => {
  it('counts days, skips do not break, a miss does', () => {
    const h = make({}, back(20))
    let log = []
    for (let i = 0; i <= 20; i++) if (i !== 12) log = toggleDone(log, h, back(i))
    log = setState(log, h, back(5), 'skipped')
    const S = base({ habitLog: log })
    expect(streak(h, S, T)).toEqual({ current: 11, best: 11, unit: 'days' })
    expect(milestones(h, S, T).map(m => m.days)).toEqual([7])
    expect(stats(h, S, back(20), T, T)).toMatchObject({ done: 19, missed: 1, skipped: 1 })
  })
  it('counts weeks for a habit of N times a week', () => {
    const h = make({ schedule: { type: 'perWeek', times: 2 } }, '2026-09-28')
    let log = []
    for (const d of ['2026-09-29', '2026-10-01', '2026-10-06', '2026-10-08', '2026-10-13', '2026-10-21']) log = toggleDone(log, h, d)
    const S = base({ habitLog: log, weekStart: 1 })
    // weeks from Mondays 28/9 ✓, 5/10 ✓, 12/10 ✗ (one), 19/10 open (one so far)
    expect(streak(h, S, T)).toEqual({ current: 0, best: 2, unit: 'weeks' })
    expect(stats(h, S, '2026-09-28', T, T).rate).toBeCloseTo(2 / 3)
    expect(dayStatus(h, back(2), S, T).state).toBe('off')
  })
  it('the day progress, the weak weekdays, and the reminders owed', () => {
    const a = make({ name: 'Água', kind: 'quantity', goal: { value: 2000 }, reminders: ['12:00'] }), b = make({ name: 'Ler', reminders: ['12:00'] }), c = make({ name: 'Extra', excludeFromDaily: true })
    const S = base({ habits: [a, b, c], habitLog: toggleDone([], b, T) })
    expect(dailyProgress(S, T, T)).toEqual({ done: 1, total: 2 })
    expect(weekdayMisses(S, back(6), T, T).reduce((x, y) => x + y)).toBeGreaterThan(0)
    expect(habitsDue(S, { date: T, hhmm: '12:10' }, 15).map(x => x.habit.name)).toEqual(['Água'])
    expect(habitsDue(S, { date: T, hhmm: '12:20' }, 15)).toEqual([])
  })
})

describe('part B: the recap, the calendar, the order', () => {
  it('sums up the week just over against the one before', () => {
    const h = make({ name: 'Ler' }, '2026-09-28')
    let log = []
    for (const d of ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18']) log = toggleDone(log, h, d)   // all of the week of 12/10
    for (const d of ['2026-10-05', '2026-10-06']) log = toggleDone(log, h, d)
    const r = weeklyRecap(base({ habits: [h], habitLog: log, weekStart: 1 }), '2026-10-20')
    expect(r).toMatchObject({ from: '2026-10-12', to: '2026-10-18', week: { done: 7, total: 7, rate: 1 }, previous: { done: 2, total: 7 }, change: 71 })
  })
  it('writes a calendar file repeating as the habit does', () => {
    const h = make({ name: 'Ler, à noite', schedule: { type: 'weekdays', days: [1, 3] }, reminders: ['21:30'], end: '2026-12-31' })
    const ics = icsFor([h, make({ kind: 'avoid' })], { today: T, now: new Date('2026-10-22T12:00:00Z') })
    expect(ics).toContain('BEGIN:VCALENDAR\r\n')
    expect(ics).toContain('DTSTART:20261022T213000')
    expect(ics).toContain('DTEND:20261022T214500')
    expect(ics).toContain('RRULE:FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261231T235959')
    expect(ics).toContain('SUMMARY:Ler\\, à noite')
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1)
  })
  it('keeps the order a drag leaves', () => {
    const hs = [{ id: 'a', order: 1 }, { id: 'b', order: 2 }, { id: 'c', order: 3 }]
    expect(reorder(hs, ['c', 'a', 'b']).sort((x, y) => x.order - y.order).map(h => h.id)).toEqual(['c', 'a', 'b'])
  })
  it('keeps the list chart and the usual-time reminder', () => {
    expect(make({ listChart: 'bars', smartReminder: true })).toMatchObject({ listChart: 'bars', smartReminder: true })
    expect(make({ listChart: 'pie' }).listChart).toBeNull()
  })
})
