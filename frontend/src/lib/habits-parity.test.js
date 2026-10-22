// api/habits.js (the reminders the server sends) and lib/habits-core.js (what the app shows) are
// two copies of one set of rules: the same profile must give the same day on both sides.
import { describe, expect, it } from 'vitest'
import * as api from '../../../api/habits.js'
import * as app from './habits-core.js'

const T = '2026-10-22'
const S = {
  habits: [
    { id: 'c', kind: 'check', name: 'Ler', schedules: [{ from: '2026-10-01', type: 'weekdays', days: [1, 3, 4] }], start: '2026-10-01', reminders: ['21:00'] },
    { id: 'q', kind: 'quantity', name: 'Água', goal: { value: 2000, unit: 'ml' }, schedules: [{ from: '2026-10-01', type: 'daily' }], start: '2026-10-01', reminders: ['10:00'] },
    { id: 'a', kind: 'avoid', name: 'Açúcar', schedules: [{ type: 'daily' }], start: '2026-10-01' },
    { id: 'w', kind: 'auto', name: 'Treino', auto: { source: 'workout' }, schedules: [{ type: 'perWeek', times: 3 }], start: '2026-10-01', reminders: ['18:00'] },
    { id: 'p', kind: 'auto', name: 'Peso', auto: { source: 'weight' }, schedules: [{ type: 'daily' }], start: '2026-10-01' },
    { id: 'm', kind: 'auto', name: 'Remédios', auto: { source: 'meds' }, schedules: [{ type: 'daily' }], start: '2026-10-01', reminders: ['08:30'] },
    { id: 'f', kind: 'auto', name: 'Refeições', auto: { source: 'meals', slots: ['lunch'] }, schedules: [{ type: 'daily' }], start: '2026-10-01', reminders: ['12:30'] },
    { id: 's', kind: 'auto', name: 'Sono', auto: { source: 'sleep', mode: 'bedBy', bedBy: '23:30' }, schedules: [{ type: 'daily' }], start: '2026-10-01' },
    { id: 't', kind: 'task', name: 'Marcar dentista', due: T, reminders: ['09:00'] }
  ],
  habitLog: [{ id: `q|${T}`, habitId: 'q', d: T, value: 500 }, { id: 'a|2026-10-20', habitId: 'a', d: '2026-10-20', slips: 1 }, { id: 'c|2026-10-21', habitId: 'c', d: '2026-10-21', state: 'skipped' }],
  habitPrefs: { vacations: [{ from: '2026-10-10', to: '2026-10-12', habitIds: ['q'] }] },
  workouts: [{ d: '2026-10-20', name: 'A' }], bodyweight: [{ d: T, w: 90 }],
  meds: [{ id: 'm1', times: ['08:00'], active: true }], medLog: [],
  meals: [{ d: T, slot: 'lunch', items: [{ kcal: 700 }] }],
  sleep: [{ d: T, bed: '2026-10-22T00:10', asleepMin: 400 }]
}

describe('the server and the app read habits alike', () => {
  it('exports the same rules', () => expect(Object.keys(app).sort()).toEqual(Object.keys(api).sort()))
  it('every habit, every day of October', () => {
    for (const h of S.habits) for (let i = 1; i <= 25; i++) {
      const d = `2026-10-${String(i).padStart(2, '0')}`
      expect(app.dayStatus(h, d, S, T)).toEqual(api.dayStatus(h, d, S, T))
    }
  })
  it('the reminders owed through the day', () => {
    for (let m = 0; m < 1440; m += 5) {
      const hhmm = String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0')
      const ids = x => x.map(r => r.habit.id + '@' + r.time)
      expect(ids(app.habitsDue(S, { date: T, hhmm }, 15))).toEqual(ids(api.habitsDue(S, { date: T, hhmm }, 15)))
    }
    expect(api.habitsDue(S, { date: T, hhmm: '12:40' }, 15)).toEqual([])                    // lunch logged
    expect(api.habitsDue(S, { date: T, hhmm: '10:05' }, 15).map(r => r.habit.id)).toEqual(['q'])
  })
  it('group reminders, the usual time and the week summary', () => {
    const G = { ...S, habitGroups: [{ id: 'g', name: 'Manhã', reminders: ['07:30'], muted: true }],
      habits: S.habits.map(h => (h.id === 'q' || h.id === 'c' ? { ...h, groups: ['g'] } : h)),
      habitLog: [...S.habitLog, ...[1, 2, 3, 4].map(i => ({ id: `c|2026-10-0${i}`, habitId: 'c', d: `2026-10-0${i}`, done: true, at: Date.parse(`2026-10-0${i}T10:${10 + i}:00Z`) }))] }
    const ids = x => x.map(r => (r.group || r.habit).id + '@' + r.time)
    for (const hhmm of ['07:30', '07:40', '10:05', '21:00']) {
      expect(ids(app.groupsDue(G, { date: T, hhmm }, 15))).toEqual(ids(api.groupsDue(G, { date: T, hhmm }, 15)))
      expect(ids(app.habitsDue(G, { date: T, hhmm }, 15))).toEqual(ids(api.habitsDue(G, { date: T, hhmm }, 15)))
    }
    expect(api.groupsDue(G, { date: T, hhmm: '07:35' }, 15).map(r => r.habits.map(h => h.id))).toEqual([['c', 'q']])
    expect(api.habitsDue(G, { date: T, hhmm: '10:05' }, 15).map(r => r.habit.id)).toEqual([])          // muted: the group reminds
    expect(app.typicalTime(G.habits.find(h => h.id === 'c'), G, 'America/Sao_Paulo')).toBe(api.typicalTime(G.habits.find(h => h.id === 'c'), G, 'America/Sao_Paulo'))
    expect(api.typicalTime(G.habits.find(h => h.id === 'c'), G, 'UTC')).toBe('10:13')
    expect(app.weekSummary(G, '2026-10-15', '2026-10-21')).toEqual(api.weekSummary(G, '2026-10-15', '2026-10-21'))
  })
})
