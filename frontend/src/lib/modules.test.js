import { describe, expect, it } from 'vitest'
import { MODULES, healthOn, moduleOn } from './modules.js'

describe('modules', () => {
  it('are on unless switched off, and training alone when all are off', () => {
    expect(moduleOn({}, 'food')).toBe(true)
    expect(moduleOn({ modules: { food: false } }, 'food')).toBe(false)
    expect(healthOn({ modules: { food: false } })).toBe(true)
    expect(healthOn({ modules: Object.fromEntries(MODULES.map(k => [k, false])) })).toBe(false)
  })
})
