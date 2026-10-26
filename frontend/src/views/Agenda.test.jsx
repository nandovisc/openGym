// @vitest-environment happy-dom
// The Personal module, phase 5: a trainer's agenda — a class added once or every week, marked
// done or cancelled, moved; Today lists the day's classes.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Agenda from './Agenda.jsx'
import { DEF, useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { todayISO } from '../lib/format.js'
import { occurrences } from '../lib/agenda.js'

vi.mock('../lib/api.js', () => ({ api: vi.fn(async () => ({ classes: [] })) }))

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const mounted = []
const render = el => { const c = document.createElement('div'); document.body.appendChild(c); const r = createRoot(c); act(() => r.render(el)); mounted.push([r, c]); return c }
const topSheet = () => { const s = useUI.getState().sheets.at(-1); return render(s.render(() => useUI.getState().closeSheet(s.id))) }
const button = (el, text) => [...el.querySelectorAll('button')].find(b => b.textContent.trim() === text)
const S = () => useStore.getState().S
const today = todayISO()

beforeEach(() => {
  useUI.setState({ sheets: [], toastMsg: '' })
  const s = JSON.parse(JSON.stringify(DEF))
  s.students = [{ id: 'r1', name: 'Marília', status: 'active', studentId: 'm' }, { id: 'r2', name: 'João', status: 'invited' }]
  useStore.setState({ S: s, user: { id: 'pt', name: 'Ricardo', trainer: true } })
})
afterEach(() => { for (const [r, c] of mounted.splice(0)) { act(() => r.unmount()); c.remove() } })

describe('a trainer’s agenda', () => {
  it('adds a class today, marks it done, and a weekly class shows on its days', () => {
    const p = render(<MemoryRouter><Agenda /></MemoryRouter>)
    expect(p.textContent).toContain('No classes this day.')
    act(() => p.querySelector('[aria-label="New class"]').click())
    const sheet = topSheet()
    act(() => button(sheet, 'Add class').click())
    expect(S().sessions).toEqual([expect.objectContaining({ recordId: 'r1', d: today, time: '07:00', dur: 60, status: 'scheduled' })])
    expect(S().agendaPrefs.tz).toBeTruthy()
    expect(p.textContent).toContain('Marília')
    act(() => p.querySelector('.agenda-row').click())
    const cs = topSheet()
    act(() => button(cs, 'Mark as done').click())
    expect(occurrences(S(), today, today)[0].status).toBe('done')
    act(() => p.querySelector('[aria-label="New class"]').click())
    const weekly = topSheet()
    act(() => weekly.querySelector('select').dispatchEvent(Object.assign(new Event('change', { bubbles: true }))))
    act(() => button(weekly, 'Every week').click())
    act(() => button(weekly, 'Add class').click())
    expect(S().sessionSeries).toHaveLength(1)
    const in7 = new Date(Date.parse(today + 'T12:00:00Z') + 7 * 86400000).toISOString().slice(0, 10)
    expect(occurrences(S(), in7, in7)).toHaveLength(1)
  })
  it('cancels a class of a series and moves another', () => {
    useStore.getState().update(s => { s.sessionSeries = [{ id: 's', recordId: 'r1', days: [0, 1, 2, 3, 4, 5, 6], time: '07:00', dur: 60, from: today }] })
    const p = render(<MemoryRouter><Agenda /></MemoryRouter>)
    act(() => p.querySelector('.agenda-row').click())
    const cs2 = topSheet()
    act(() => button(cs2, 'Cancel class').click())
    expect(occurrences(S(), today, today)[0].status).toBe('canceled')
    expect(p.querySelector('.agenda-row.canceled')).not.toBe(null)
    act(() => p.querySelector('.agenda-row').click())
    const sheet = topSheet()
    act(() => button(sheet, 'Reschedule').click())
    const time = sheet.querySelector('input[type="time"]')
    act(() => { Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(time, '18:30'); time.dispatchEvent(new Event('input', { bubbles: true })) })
    act(() => button(sheet, 'Move class').click())
    expect(occurrences(S(), today, today)[0]).toMatchObject({ time: '18:30', status: 'scheduled', moved: true })
  })
})
