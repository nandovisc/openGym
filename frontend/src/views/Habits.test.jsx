// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Habits, { habitFormSheet, habitSheet, habitSettingsSheet, habitsToday } from './Habits.jsx'
import { DEF, useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { todayISO } from '../lib/format.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const clone = v => JSON.parse(JSON.stringify(v))
const mounted = []
function render(el) {
  const c = document.createElement('div'); document.body.appendChild(c)
  const root = createRoot(c); act(() => root.render(el)); mounted.push([root, c]); return c
}
const topSheet = () => { const s = useUI.getState().sheets.at(-1); return render(s.render(() => useUI.getState().closeSheet(s.id))) }
const button = (el, text) => [...el.querySelectorAll('button')].find(b => b.textContent.trim() === text)
const byLabel = (el, label) => el.querySelector(`[aria-label="${label}"]`)
const setInput = (input, value) => {
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  act(() => { set.call(input, String(value)); input.dispatchEvent(new Event('input', { bubbles: true })) })
}
const today = todayISO()
const day = n => new Date(Date.parse(today + 'T12:00:00Z') - n * 86400000).toISOString().slice(0, 10)
const S = () => useStore.getState().S
const page = () => render(<MemoryRouter><Habits /></MemoryRouter>)
const habit = (extra) => ({ id: 'h', kind: 'check', name: 'Meditar', schedules: [{ from: day(30), type: 'daily' }], start: day(30), groups: [], reminders: [], order: 1, ...extra })
const withState = extra => useStore.setState({ S: { ...clone(DEF), ...extra }, user: null, config: null })

beforeEach(() => { useUI.setState({ sheets: [], toastMsg: '' }) })
afterEach(() => { for (const [root, c] of mounted.splice(0)) { act(() => root.unmount()); c.remove() } })

describe('the day', () => {
  it('creates a habit and marks it done', () => {
    withState({})
    habitFormSheet()
    const sheet = topSheet()
    setInput(sheet.querySelector('.med-form input'), 'Ler')
    act(() => button(sheet, 'Save').click())
    expect(S().habits).toHaveLength(1)
    const p = page()
    expect(p.textContent).toContain('0 of 1 done')
    act(() => byLabel(p, 'Mark as done').click())
    expect(S().habitLog).toMatchObject([{ habitId: S().habits[0].id, d: today, done: true }])
    expect(habitsToday(S())).toEqual({ done: 1, total: 1 })
  })

  it('adds to an amount, runs a timer, logs a slip', () => {
    withState({ habits: [
      habit({ id: 'w', kind: 'quantity', name: 'Água', goal: { value: 2000, unit: 'ml' } }),
      habit({ id: 't', kind: 'timer', name: 'Ler', goal: { value: 30, unit: 'min' }, timer: { stopAtGoal: true } }),
      habit({ id: 'a', kind: 'avoid', name: 'Açúcar' })
    ] })
    const p = page()
    act(() => byLabel(p, 'Add 250 ml').click())
    act(() => byLabel(p, 'Add 250 ml').click())
    expect(S().habitLog.find(e => e.habitId === 'w').value).toBe(500)
    expect(p.textContent).toContain('500 ml / 2,000 ml')
    act(() => byLabel(p, 'Start the timer').click())
    expect(S().habitLog.find(e => e.habitId === 't').timer.since).toBeGreaterThan(0)
    act(() => byLabel(p, 'Stop the timer').click())
    expect(S().habitLog.find(e => e.habitId === 't')?.timer).toBeUndefined()
    act(() => byLabel(p, 'Log a slip').click())
    expect(S().habitLog.find(e => e.habitId === 'a').slips).toBe(1)
    expect(p.textContent).toContain('Failed')
  })

  it('a task leaves the list once done on another day', () => {
    withState({ habits: [habit({ id: 'k', kind: 'task', name: 'Dentista', schedules: [], due: null })], habitLog: [{ id: `k|${day(1)}`, habitId: 'k', d: day(1), done: true }] })
    expect(page().textContent).not.toContain('Dentista')
  })

  it('marks itself from a workout and a weigh-in', () => {
    withState({
      habits: [habit({ id: 'w', kind: 'auto', name: 'Treino', auto: { source: 'workout' } }), habit({ id: 'p', kind: 'auto', name: 'Pesagem', auto: { source: 'weight' } })],
      workouts: [{ id: 'x', d: today, name: 'Pernas', start: 1, end: 2, entries: [] }], bodyweight: [{ d: today, w: 94.8, t: 1 }]
    })
    const p = page()
    expect(p.textContent).toContain('Workout · Pernas')
    expect(p.textContent).toContain('Weigh-in · 94.8 kg')
    expect(p.textContent).toContain('2 of 2 done')
  })

  it('hides done habits when asked', () => {
    withState({ habits: [habit({}), habit({ id: 'h2', name: 'Ler' })], habitLog: [{ id: `h|${today}`, habitId: 'h', d: today, done: true }], habitPrefs: { ...DEF.habitPrefs, hideDone: true } })
    const text = page().textContent
    expect(text).not.toContain('Meditar')
    expect(text).toContain('Ler')
  })
})

describe('one habit', () => {
  it('duplicates, skips today, archives and restores with its history', () => {
    withState({ habits: [habit({})], habitLog: [{ id: `h|${day(1)}`, habitId: 'h', d: day(1), done: true }] })
    habitSheet('h')
    let sheet = topSheet()
    expect(sheet.textContent).toContain('Streak')
    act(() => [...sheet.querySelectorAll('button')].find(b => b.textContent.includes('Duplicate')).click())
    expect(S().habits.map(h => h.name)).toEqual(['Meditar', 'Meditar (copy)'])
    act(() => [...sheet.querySelectorAll('button')].find(b => b.textContent.includes('Skip today')).click())
    expect(S().habitLog.find(e => e.d === today)).toMatchObject({ state: 'skipped' })
    act(() => [...sheet.querySelectorAll('button')].find(b => b.textContent.includes('Archive')).click())
    expect(S().habits.find(h => h.id === 'h').archived).toBe(true)
    habitSettingsSheet()
    sheet = topSheet()
    act(() => button(sheet, 'Restore').click())
    expect(S().habits.find(h => h.id === 'h').archived).toBe(false)
    expect(S().habitLog.some(e => e.habitId === 'h' && e.d === day(1))).toBe(true)
  })
})

describe('habits from the other modules', () => {
  it('are made on the first visit, already marked by what was logged', () => {
    withState({ meds: [{ id: 'm', name: 'Losartana', times: ['08:00'], active: true, start: day(10) }], medLog: [{ id: `m|${today}|08:00`, medId: 'm', d: today, time: '08:00', status: 'taken' }] })
    const p = page()
    expect(S().habits.map(h => [h.id, h.name])).toEqual([['auto-meds', 'Medications']])
    expect(S().habitPrefs.seeded).toBe(true)
    expect(p.textContent).toContain('1 of 1 doses')
    expect(p.textContent).toContain('1 of 1 done')
  })
  it('are offered later when a module gets data, and can be dismissed', () => {
    withState({ habits: [habit({})], habitPrefs: { ...DEF.habitPrefs, seeded: true }, bodyweight: [{ d: today, w: 90 }] })
    const p = page()
    expect(p.textContent).toContain('From what you already log')
    act(() => button(p, 'Add').click())
    expect(S().habits.map(h => h.id)).toEqual(['h', 'auto-weight'])
    expect(p.textContent).not.toContain('From what you already log')
  })
})
