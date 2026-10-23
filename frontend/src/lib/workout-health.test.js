import { describe, it, expect } from 'vitest'
import { healthParts, kcalOn, watchOnly } from './workout-health.js'

describe('workout health', () => {
  it('lists what the watch measured, and nothing without it', () => {
    expect(healthParts({ health: { kcal: 410.4, avgHr: 132, maxHr: 168 } })).toEqual(['410 kcal', 'avg HR 132', 'max 168'])
    expect(healthParts({ health: { kcal: 300, avgHr: null, maxHr: null } })).toEqual(['300 kcal'])
    expect(healthParts({})).toEqual([])
  })
  it('a watch-only workout has no exercises; a logged one with health is not one', () => {
    expect(watchOnly({ src: 'health', entries: [] })).toBe(true)
    expect(watchOnly({ entries: [{ id: 'x', sets: [] }], health: { kcal: 1 } })).toBe(false)
  })
  it('adds up the calories of a day', () => {
    const ws = [{ d: '2026-10-22', health: { kcal: 300 } }, { d: '2026-10-22', health: { kcal: 110 } }, { d: '2026-10-21', health: { kcal: 99 } }, { d: '2026-10-22' }]
    expect(kcalOn(ws, '2026-10-22')).toBe(410)
    expect(kcalOn(null, '2026-10-22')).toBe(0)
  })
})
