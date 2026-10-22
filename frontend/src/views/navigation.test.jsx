// @vitest-environment happy-dom
// The navigation by modules (lib/modules.js): Health shows a tile per module on, the Training
// tab's own tabs only with the new navigation, and Home is the training Home again with every
// module off.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import Health from './Health.jsx'
import Home from './Home.jsx'
import Training from './Training.jsx'
import { DEF, useStore } from '../store/useStore.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const mounted = []
function render(el) {
  const c = document.createElement('div'); document.body.appendChild(c)
  const root = createRoot(c); act(() => root.render(<MemoryRouter>{el}</MemoryRouter>)); mounted.push([root, c]); return c
}
afterEach(() => { for (const [root, c] of mounted.splice(0)) { act(() => root.unmount()); c.remove() } })
const withModules = modules => useStore.setState({ S: { ...JSON.parse(JSON.stringify(DEF)), modules }, user: { id: 'u', name: 'Ana' }, config: null })
const OFF = { habits: false, food: false, sleep: false, meds: false, exams: false }

describe('navigation by modules', () => {
  it('Health shows a tile for each module on', () => {
    withModules({})
    const all = [...render(<Health />).querySelectorAll('.health-tile b')].map(b => b.textContent)
    expect(all).toEqual(['Nutrition', 'Sleep', 'Medications', 'Medical exams', 'Body weight', 'Body measurements'])
    withModules({ food: false, exams: false })
    expect([...render(<Health />).querySelectorAll('.health-tile b')].map(b => b.textContent)).toEqual(['Sleep', 'Medications', 'Body weight', 'Body measurements'])
  })

  it('the Training tab has its own tabs, which training-only does not need', () => {
    withModules({})
    const tr = render(<Training />)
    expect([...tr.querySelectorAll('.training-nav button')].map(b => b.textContent)).toEqual(['Week', 'Plan', 'Exercises', 'Stats'])
    expect(tr.textContent).toContain('Training')
    withModules(OFF)
    expect(render(<Training />).querySelector('.training-nav')).toBeNull()
  })

  it('Home is the training Home with every module off, and leaves the week to Training otherwise', () => {
    withModules(OFF)
    const legacy = render(<Home />)
    expect(legacy.textContent).toContain('Hi Ana')
    expect(legacy.textContent).toContain('week streak')
    withModules({})
    const home = render(<Home />)
    expect(home.textContent).toContain('Hi Ana')
    expect(home.textContent).not.toContain('week streak')
    expect(home.textContent).toContain('Health')
  })
})
