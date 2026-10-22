// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Today, { cardOrder, slotByHour } from './Today.jsx'
import { QuickAddButton, quickAddSheet } from '../components/QuickAdd.jsx'
import { DEF, useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { todayISO } from '../lib/format.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const mounted = []
function render(el) {
  const c = document.createElement('div'); document.body.appendChild(c)
  const root = createRoot(c); act(() => root.render(<MemoryRouter>{el}</MemoryRouter>)); mounted.push([root, c]); return c
}
const topSheet = () => { const s = useUI.getState().sheets.at(-1); return render(s.render(() => useUI.getState().closeSheet(s.id))) }
const button = (el, text) => [...el.querySelectorAll('button')].find(b => b.textContent.trim() === text)
const S = () => useStore.getState().S
const today = todayISO()
const withState = extra => useStore.setState({ S: { ...JSON.parse(JSON.stringify(DEF)), habitPrefs: { ...DEF.habitPrefs, seeded: true }, ...extra }, user: { id: 'u', name: 'Ana' }, config: null })
const titles = el => [...el.querySelectorAll('.today-title')].map(x => x.textContent)

beforeEach(() => useUI.setState({ sheets: [], toastMsg: '' }))
afterEach(() => { for (const [root, c] of mounted.splice(0)) { act(() => root.unmount()); c.remove() } })

describe('Today', () => {
  it('orders the cards by the hour, or by the person, and leaves out what is switched off', () => {
    expect(cardOrder({}, 8).slice(0, 3)).toEqual(['sleep', 'weight', 'meds'])
    expect(cardOrder({}, 20).slice(0, 2)).toEqual(['habits', 'food'])
    expect(cardOrder({}, 14)[0]).toBe('training')
    expect(cardOrder({ homeCards: { order: ['weight', 'food'], hidden: ['exams'] } }, 8)).toEqual(['weight', 'food', 'training', 'habits', 'meds', 'sleep'])
    expect(cardOrder({ modules: { food: false, sleep: false } }, 14)).toEqual(['training', 'habits', 'meds', 'weight', 'exams'])
    expect([slotByHour(new Date('2026-10-22T08:00')), slotByHour(new Date('2026-10-22T12:00')), slotByHour(new Date('2026-10-22T17:00')), slotByHour(new Date('2026-10-22T20:00'))]).toEqual(['breakfast', 'lunch', 'snack', 'dinner'])
  })

  it('takes a dose, marks a habit and offers the weigh-in where they show', () => {
    withState({
      meds: [{ id: 'm', name: 'Losartana', times: ['08:00', '20:00'], active: true, start: '2020-01-01' }], medLog: [],
      habits: [{ id: 'h', kind: 'check', name: 'Meditar', schedules: [{ from: '2020-01-01', type: 'daily' }], start: '2020-01-01', groups: [], order: 1 }], habitLog: []
    })
    const p = render(<Today />)
    expect(titles(p)).toEqual(expect.arrayContaining(['Medications', 'Habits to do', 'Body weight', 'Today’s workout', 'Nutrition']))
    act(() => button(p, 'Taken').click())
    expect(S().medLog).toMatchObject([{ id: `m|${today}|08:00`, status: 'taken' }])
    act(() => p.querySelector('[aria-label="Mark as done"]').click())
    expect(S().habitLog).toMatchObject([{ habitId: 'h', d: today, done: true }])
    act(() => button(p, 'Weigh in').click())
    expect(useUI.getState().sheets).toHaveLength(1)
  })

  it('a hidden card stays hidden, and an exam out of range is called out', () => {
    withState({ homeCards: { hidden: ['weight'] }, exams: [{ id: 'e', d: '2026-10-10', results: [{ name: 'LDL', flag: 'high' }] }] })
    const p = render(<Today />)
    expect(titles(p)).not.toContain('Body weight')
    expect(p.textContent).toContain('1 out of range')
  })
})

describe('the ＋ button', () => {
  it('offers what the modules on can log', () => {
    withState({ modules: { sleep: false } })
    quickAddSheet(() => {})
    const sheet = topSheet()
    const items = [...sheet.querySelectorAll('.qa-item b')].map(b => b.textContent)
    expect(items).toEqual(['Meal', 'Water / habit', 'Weigh-in', 'Task'])
    expect(sheet.textContent).toContain('Start workout')
  })
  it('a tap opens Log; a press held half a second starts the workout', () => {
    vi.useFakeTimers()
    try {
      withState({})
      const start = vi.fn()
      const p = render(<QuickAddButton onStartWorkout={start} />)
      const b = p.querySelector('button')
      act(() => { b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); vi.advanceTimersByTime(600); b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })); b.click() })
      expect(start).toHaveBeenCalledTimes(1)
      expect(useUI.getState().sheets).toHaveLength(0)
      act(() => { b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); vi.advanceTimersByTime(100); b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })); b.click() })
      expect(start).toHaveBeenCalledTimes(1)
      expect(useUI.getState().sheets).toHaveLength(1)
    } finally { vi.useRealTimers() }
  })
})
