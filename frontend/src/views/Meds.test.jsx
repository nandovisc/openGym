// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Meds from './Meds.jsx'
import { DEF, useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { doseId } from '../lib/meds.js'
import { todayISO } from '../lib/format.js'

vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.resolve({})) }))

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const clone = value => JSON.parse(JSON.stringify(value))
const mounted = []

function render(el) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => root.render(el))
  mounted.push([root, container])
  return container
}
function topSheet() {
  const sheet = useUI.getState().sheets.at(-1)
  return render(sheet.render(() => useUI.getState().closeSheet(sheet.id)))
}
const button = (el, text) => [...el.querySelectorAll('button')].find(b => b.textContent.trim() === text)
const type = (input, value) => {
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  act(() => { set.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })) })
}

function mount(over = {}) {
  useStore.setState({ S: Object.assign(clone(DEF), over), user: null })
  return render(<MemoryRouter><Meds /></MemoryRouter>)
}

beforeEach(() => { useUI.setState({ sheets: [], toastMsg: '' }) })
afterEach(() => { for (const [root, c] of mounted.splice(0)) { act(() => root.unmount()); c.remove() } })

describe('Medications', () => {
  it('starts empty, and a medication added through the form shows its doses today', () => {
    const page = mount()
    expect(page.textContent).toContain('Add medication')
    act(() => button(page, 'Add medication').click())
    const form = topSheet()
    type(form.querySelector('input:not([type])') || form.querySelector('input'), 'Losartana')
    act(() => button(form, 'Save').click())
    const S = useStore.getState().S
    expect(S.meds).toHaveLength(1)
    expect(S.meds[0]).toMatchObject({ name: 'Losartana', times: ['08:00'], days: null, active: true })
    expect(page.textContent).toContain('Losartana')
    expect(page.textContent).toContain('08:00')
  })

  it('marks a dose taken, and a tap on the mark undoes it', () => {
    const med = { id: 'm1', name: 'Atenolol', dose: '25', unit: 'mg', times: ['07:00'], days: null, start: '2020-01-01', end: null, active: true, notes: '' }
    const page = mount({ meds: [med] })
    act(() => button(page, 'Taken').click())
    const id = doseId('m1', todayISO(), '07:00')
    expect(useStore.getState().S.medLog).toEqual([expect.objectContaining({ id, status: 'taken', medId: 'm1' })])
    act(() => page.querySelector('button[aria-label="Undo"]').click())
    expect(useStore.getState().S.medLog).toEqual([])
  })

  it('goes back a day to mark a dose that was not marked on its day', () => {
    const med = { id: 'm1', name: 'Mounjaro', dose: '5', unit: 'mg', times: ['09:00'], days: null, start: '2020-01-01', end: null, active: true, notes: '' }
    const page = mount({ meds: [med] })
    const yesterday = new Date(Date.parse(todayISO() + 'T12:00:00Z') - 86400000).toISOString().slice(0, 10)
    act(() => page.querySelector('button[aria-label="Previous day"]').click())
    expect(page.querySelector('button[aria-label="Next day"]')).not.toBe(null)
    act(() => button(page, 'Taken').click())
    expect(useStore.getState().S.medLog).toEqual([expect.objectContaining({ id: doseId('m1', yesterday, '09:00'), d: yesterday, status: 'taken' })])
    act(() => page.querySelector('button[aria-label="Next day"]').click())
    expect(page.querySelector('button[aria-label="Next day"]')).toBe(null)
  })

  it('refuses a medication with no name', () => {
    const page = mount()
    act(() => button(page, 'Add medication').click())
    const form = topSheet()
    act(() => button(form, 'Save').click())
    expect(useStore.getState().S.meds).toEqual([])
    expect(useUI.getState().toastMsg).toBe('Enter the name of the medication')
  })
})
