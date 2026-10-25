import { describe, expect, it } from 'vitest'
import { insights } from './insights.js'

const T = '2026-10-25'
const back = n => new Date(Date.parse(T + 'T12:00:00Z') - n * 86400000).toISOString().slice(0, 10)

describe('patterns across the modules', () => {
  it('says nothing without enough days on each side', () => {
    expect(insights({}, T)).toEqual([])
    expect(insights({ sleep: [{ d: back(1), asleepMin: 300 }], workouts: [] }, T)).toEqual([])
  })
  it('short nights alongside fewer workouts that day', () => {
    const sleep = [], workouts = []
    for (let i = 1; i <= 20; i++) {
      const short = i % 2 === 0
      sleep.push({ d: back(i), asleepMin: short ? 330 : 450 })
      if (!short || i % 4 === 0) workouts.push({ id: 'w' + i, d: back(i) })
    }
    const [p] = insights({ sleep, workouts }, T)
    expect(p).toMatchObject({ id: 'sleep-training', args: [50], n: 20 })
  })
  it('the night after a day on the water goal', () => {
    const water = [], sleep = []
    for (let i = 2; i <= 22; i++) {
      const on = i % 2 === 0
      water.push({ id: 'w' + i, d: back(i), ml: on ? 3000 : 1200 })
      sleep.push({ d: back(i - 1), asleepMin: on ? 450 : 400 })
    }
    const p = insights({ water, sleep, waterPrefs: { goalMl: 2500 } }, T).find(x => x.id === 'water-sleep')
    expect(p).toMatchObject({ key: 'On days you reached your water goal you slept {0} more that night.', args: ['50 min'] })
  })
  it('weeks with 3+ workouts alongside a different weight change', () => {
    const workouts = [], bodyweight = []
    // Eight weeks from Monday 2026-08-24: busy weeks lose 0.5 kg, quiet weeks gain 0.3.
    for (let w = 0; w < 8; w++) {
      const mon = new Date(Date.parse('2026-08-24T12:00:00Z') + w * 7 * 86400000).toISOString().slice(0, 10)
      const day = n => new Date(Date.parse(mon + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10)
      const busy = w % 2 === 0
      if (busy) workouts.push({ id: 'a' + w, d: day(0) }, { id: 'b' + w, d: day(2) }, { id: 'c' + w, d: day(4) })
      bodyweight.push({ d: day(0), w: 95 }, { d: day(6), w: busy ? 94.5 : 95.3 })
    }
    const p = insights({ workouts, bodyweight, weekStart: 1, unit: 'kg' }, T).find(x => x.id === 'workouts-weight')
    expect(p).toMatchObject({ args: ['-0.5 kg', '+0.3 kg'], n: 8 })
  })
})
