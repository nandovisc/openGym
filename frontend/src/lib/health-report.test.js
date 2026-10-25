import { describe, expect, it } from 'vitest'
import { healthReport, periodFrom } from './health-report.js'

const T = '2026-10-25'

describe('the report for an appointment', () => {
  it('a period of months ends today and starts the day after the same date that many months back', () => {
    expect(periodFrom(T, 3)).toBe('2026-07-26')
    expect(periodFrom(T, 12)).toBe('2025-10-26')
  })
  it('puts each module of the period together, and leaves out what has nothing', () => {
    const S = {
      unit: 'kg', nutrition: { birthYear: 1985, heightCm: 178, targets: { kcal: 2200, p: 170 } },
      meds: [{ id: 'm', name: 'Losartana', dose: '50', unit: 'mg', times: ['08:00'], active: true, start: '2026-01-01', created: 0 }],
      medLog: [{ id: 'm|2026-10-24|08:00', status: 'taken' }],
      exams: [
        { id: 'e1', d: '2026-05-10', results: [{ key: 'ldl', name: 'LDL', value: 160, valueText: '160', unit: 'mg/dL', flag: 'high' }] },
        { id: 'e2', d: '2026-09-10', results: [{ key: 'ldl', name: 'LDL', value: 150, valueText: '150', unit: 'mg/dL', flag: 'high' }, { key: 'hb', name: 'Hemoglobina', value: 15, valueText: '15', unit: 'g/dL', flag: 'normal' }] }
      ],
      bodyweight: [{ d: '2026-08-01', w: 97 }, { d: '2026-10-20', w: 94.8 }],
      sleep: [{ d: '2026-10-20', bed: '2026-10-19T23:30', wake: '2026-10-20T07:00', asleepMin: 420 }],
      meals: [{ d: '2026-10-20', items: [{ kcal: 2000, p: 150, c: 200, f: 60 }] }],
      water: [{ id: 'w', d: '2026-10-20', ml: 3000 }],
      workouts: [{ id: 'a', d: '2026-10-01' }, { id: 'b', d: '2026-10-08', health: { kcal: 400 } }]
    }
    const r = healthReport(S, { months: 3, today: T, user: { name: 'Fernando' } })
    expect(r.person).toEqual({ name: 'Fernando', age: 41, heightCm: 178 })
    expect(r.meds.rows[0]).toMatchObject({ name: 'Losartana', dose: '50 mg', times: ['08:00'] })
    expect(r.exams).toMatchObject({ count: 1, outCount: 1 })
    expect(r.exams.rows.map(x => [x.name, x.value, x.out])).toEqual([['LDL', '150', true], ['Hemoglobina', '15', false]])
    expect(r.exams.trends[0].points.map(p => p.y)).toEqual([160, 150])
    expect(r.weight).toMatchObject({ first: 97, last: 94.8, change: -2.2, count: 2 })
    expect(r.sleep).toMatchObject({ nights: 1, avgMin: 420 })
    expect(r.food).toMatchObject({ days: 1, kcal: 2000, p: 150 })
    expect(r.water).toMatchObject({ days: 1, avgMl: 3000 })
    expect(r.training).toMatchObject({ workouts: 2, kcal: 400 })
    const off = healthReport({ ...S, modules: { exams: false, food: false } }, { months: 1, today: T })
    expect([off.exams, off.food]).toEqual([null, null])
    expect(healthReport({}, { months: 1, today: T })).toMatchObject({ meds: null, exams: null, weight: null, sleep: null, training: null })
  })
})
