// api/health-week.js (the recap the server sends) and lib/health-week.js (what the app shows) are
// two copies of one set of rules: the same profile must give the same week on both sides.
import { describe, expect, it } from 'vitest'
import * as api from '../../../api/health-week.js'
import * as app from './health-week.js'

const S = {
  weekStart: 1, unit: 'kg', modules: {},
  sleep: [{ d: '2026-10-13', asleepMin: 420 }, { d: '2026-10-14', asleepMin: 360 }, { d: '2026-10-20', asleepMin: 500 }],
  workouts: [{ id: 'a', d: '2026-10-13', start: 1, end: 1 + 50 * 60000, health: { kcal: 410 } }, { id: 'b', d: '2026-10-15', start: 1, end: 1 + 40 * 60000 }],
  bodyweight: [{ d: '2026-10-12', w: 95.2 }, { d: '2026-10-18', w: 94.8 }],
  meds: [{ id: 'm', times: ['08:00'], active: true, start: '2026-10-01', created: 0 }],
  medLog: [{ id: 'm|2026-10-12|08:00', status: 'taken' }, { id: 'm|2026-10-13|08:00', status: 'taken' }, { id: 'm|2026-10-14|08:00', status: 'skipped' }],
  meals: [{ d: '2026-10-12', items: [{ kcal: 2000, p: 150 }] }, { d: '2026-10-13', items: [{ kcal: 1800, p: 120 }] }],
  nutrition: { targets: { kcal: 2100, p: 170 } },
  water: [{ id: 'w1', d: '2026-10-12', ml: 2500 }, { id: 'w2', d: '2026-10-13', ml: 3500 }],
  habits: [{ id: 'h', kind: 'check', name: 'Ler', schedules: [{ from: '2026-10-01', type: 'daily' }], start: '2026-10-01' }],
  habitLog: [{ id: 'h|2026-10-12', habitId: 'h', d: '2026-10-12', done: true }]
}

describe('the server and the app read the week alike', () => {
  it('gives the same week, and the same last weeks', () => {
    expect(app.healthWeek(S, '2026-10-12', '2026-10-18')).toEqual(api.healthWeek(S, '2026-10-12', '2026-10-18'))
    expect(app.lastWeeks(S, '2026-10-21')).toEqual(api.lastWeeks(S, '2026-10-21'))
    expect(app.lastWeeks({ ...S, weekStart: 0, modules: { water: false, food: false } }, '2026-10-21')).toEqual(api.lastWeeks({ ...S, weekStart: 0, modules: { water: false, food: false } }, '2026-10-21'))
  })
  it('a week across the modules', () => {
    const w = app.healthWeek(S, '2026-10-12', '2026-10-18')
    expect(w.sleep).toEqual({ nights: 2, avgMin: 390, onGoal: 0, goalMin: 480 })
    expect(w.training).toEqual({ workouts: 2, minutes: 90, kcal: 410 })
    expect(w.weight).toEqual({ first: 95.2, last: 94.8, change: -0.4, unit: 'kg' })
    expect(w.meds).toEqual({ taken: 2, counted: 6, pct: 33 })
    expect(w.food).toEqual({ days: 2, kcal: 1900, p: 135, pTarget: 170, lowP: 2 })
    expect(w.water).toEqual({ days: 2, avgMl: 3000, onGoal: 1, goalMl: 3300 })
    expect(w.habits).toEqual({ done: 1, total: 7, rate: 1 / 7 })
    expect(app.lastWeeks(S, '2026-10-21').week.from).toBe('2026-10-12')
  })
})
