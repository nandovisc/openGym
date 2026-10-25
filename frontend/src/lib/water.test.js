import { describe, expect, it } from 'vitest'
import { addWater, dayTotal, goalOf, migrateWaterHabit, paceAt, removeWater, series, streakDays } from './water.js'

const at = (d, hh = '10:00') => new Date(`${d}T${hh}:00`).getTime()

describe('water', () => {
  it('the goal: the one set, else 35 ml per kg of the last weigh-in, else 2 litres', () => {
    expect(goalOf({})).toBe(2000)
    expect(goalOf({ bodyweight: [{ d: '2026-10-01', w: 80 }, { d: '2026-10-20', w: 94.8 }], unit: 'kg' })).toBe(3300)
    expect(goalOf({ bodyweight: [{ d: '2026-10-20', w: 200 }], unit: 'lb' })).toBe(3200)
    expect(goalOf({ bodyweight: [{ d: '2026-10-20', w: 94.8 }], waterPrefs: { goalMl: 2500 } })).toBe(2500)
  })
  it('adds drinks to their day, totals it, and takes one back', () => {
    let w = addWater([], 250, at('2026-10-24'))
    w = addWater(w, 500, at('2026-10-24', '15:00'))
    w = addWater(w, 300, at('2026-10-23'))
    w = addWater(w, 0, at('2026-10-24'))
    expect(dayTotal({ water: w }, '2026-10-24')).toBe(750)
    expect(dayTotal({ water: removeWater(w, w[0].id) }, '2026-10-24')).toBe(500)
    expect(series({ water: w }, '2026-10-24', 2)).toEqual([{ d: '2026-10-23', ml: 300 }, { d: '2026-10-24', ml: 750 }])
  })
  it('days in a row on goal, today counted once reached', () => {
    const S = { waterPrefs: { goalMl: 1000 }, water: [
      { id: 'a', d: '2026-10-21', ml: 1000 }, { id: 'b', d: '2026-10-22', ml: 1200 }, { id: 'c', d: '2026-10-23', ml: 1000 }, { id: 'd', d: '2026-10-24', ml: 200 }
    ] }
    expect(streakDays(S, '2026-10-24')).toBe(0)
    expect(streakDays({ ...S, water: S.water.slice(0, 3) }, '2026-10-24')).toBe(3)
    expect(streakDays({ ...S, water: [...S.water, { id: 'e', d: '2026-10-24', ml: 900 }] }, '2026-10-24')).toBe(4)
  })
  it('the pace: none before 8:00, all of it by 22:00, in between in proportion', () => {
    const S = { waterPrefs: { goalMl: 2800 } }
    expect(paceAt(S, '07:00')).toBe(0)
    expect(paceAt(S, '15:00')).toBe(1400)
    expect(paceAt(S, '23:00')).toBe(2800)
  })
  it('the habit "Água" kept by hand becomes the water module and an automatic habit', () => {
    const habit = { id: 'h1', kind: 'quantity', name: 'Água', goal: { value: 2000, unit: 'ml' }, groups: ['g'] }
    const S = { habits: [habit, { id: 'h2', kind: 'check', name: 'Meditar' }], habitLog: [
      { id: 'h1|2026-10-22', habitId: 'h1', d: '2026-10-22', value: 1500 }, { id: 'h1|2026-10-23', habitId: 'h1', d: '2026-10-23', value: 2250 }, { id: 'h2|2026-10-23', habitId: 'h2', d: '2026-10-23', done: true }
    ], water: [] }
    const out = migrateWaterHabit(S)
    expect(out.goalMl).toBe(2000)
    expect(out.water.map(e => [e.d, e.ml])).toEqual([['2026-10-22', 1500], ['2026-10-23', 2250]])
    expect(out.habits[0]).toMatchObject({ id: 'h1', kind: 'auto', auto: { source: 'water' }, groups: ['g'] })
    expect(migrateWaterHabit({ ...S, habits: out.habits, water: out.water })).toBe(null)
    expect(migrateWaterHabit({ habits: [{ ...habit, goal: { value: 8, unit: 'copos' } }] })).toBe(null)
  })
})

describe('the water habit reads the same goal (habits-core.js, also on the server)', () => {
  it('agrees with goalOf', async () => {
    const { autoValue } = await import('./habits-core.js')
    for (const S of [{}, { bodyweight: [{ w: 94.8 }], unit: 'kg' }, { bodyweight: [{ w: 200 }], unit: 'lb' }, { waterPrefs: { goalMl: 2500 } }]) {
      expect(autoValue({ auto: { source: 'water' } }, '2026-10-24', S).goal).toBe(goalOf(S))
    }
    const S = { waterPrefs: { goalMl: 1000 }, water: [{ id: 'a', d: '2026-10-24', ml: 600 }, { id: 'b', d: '2026-10-24', ml: 400 }] }
    expect(autoValue({ auto: { source: 'water' } }, '2026-10-24', S)).toMatchObject({ value: 1000, done: true })
  })
})
