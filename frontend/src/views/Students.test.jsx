// @vitest-environment happy-dom
// The Personal module, phase 2: a trainer's students and one student's training, read-only, in a
// copy of its own — the trainer's own profile is never touched by it.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StudentsList, StudentView } from './Students.jsx'
import { DEF, useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { api } from '../lib/api.js'
import { todayISO } from '../lib/format.js'

vi.mock('../lib/api.js', () => ({ api: vi.fn() }))

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const mounted = []
const render = el => { const c = document.createElement('div'); document.body.appendChild(c); const r = createRoot(c); act(() => r.render(el)); mounted.push([r, c]); return c }
const topSheet = () => { const s = useUI.getState().sheets.at(-1); return render(s.render(() => useUI.getState().closeSheet(s.id))) }
async function until(ok) { for (let i = 0; i < 100 && !ok(); i++) await act(async () => { await new Promise(r => setTimeout(r, 10)) }) }
const back = n => new Date(Date.parse(todayISO() + 'T12:00:00Z') - n * 86400000).toISOString().slice(0, 10)

const training = {
  unit: 'kg',
  routines: [{ id: 'r', name: 'Pernas', ex: [{ id: '1064', sets: 3, repsMin: 8, reps: 12, weight: 20 }] }],
  workouts: [1, 8, 15].map((n, i) => ({ id: 'w' + i, d: back(n), name: 'Pernas', start: 0, end: 40 * 60000, entries: [{ id: '0043', sets: [{ w: 40 + i * 5, r: 8, done: true }] }] })),
  customEx: []
}

beforeEach(() => { useUI.setState({ sheets: [], toastMsg: '' }); api.mockReset(); useStore.setState({ S: JSON.parse(JSON.stringify(DEF)), user: { id: 'pt', trainer: true } }) })
afterEach(() => { for (const [r, c] of mounted.splice(0)) { act(() => r.unmount()); c.remove() } })

describe('a trainer and their students', () => {
  it('lists the students with how each trains lately', async () => {
    api.mockResolvedValue({ students: [{ id: 'l', student: { id: 'mari', name: 'Marília' }, scope: { body: false }, created: 1, training: { last: back(1), week: 1, month: 3, total: 3 } }] })
    const p = render(<MemoryRouter><StudentsList /></MemoryRouter>)
    await until(() => p.textContent.includes('Marília'))
    expect(p.textContent).toContain('Last workout yesterday · 1 in 7 days · 3 in 28 days')
  })
  it('shows one student’s workouts, progress and plan, and leaves the trainer’s own profile alone', async () => {
    api.mockResolvedValue({ link: { id: 'l', scope: { body: false } }, student: { id: 'mari', name: 'Marília' }, training })
    const before = JSON.stringify(useStore.getState().S)
    const p = render(<MemoryRouter initialEntries={['/students/mari']}><Routes><Route path="/students/:id" element={<StudentView />} /></Routes></MemoryRouter>)
    await until(() => p.textContent.includes('Marília'))
    expect(api).toHaveBeenCalledWith('/api/trainer/student?id=mari')
    expect(p.querySelectorAll('.list .item').length).toBe(3)
    act(() => p.querySelector('.list .item').click())
    expect(topSheet().textContent).toContain('40×8')
    act(() => [...p.querySelectorAll('button')].find(b => b.textContent === 'Progress').click())
    expect(p.textContent).toContain('3 sessions')
    act(() => [...p.querySelectorAll('button')].find(b => b.textContent === 'Plan').click())
    expect(p.textContent).toContain('3 × 8–12')
    expect([...p.querySelectorAll('button')].some(b => b.textContent === 'Body')).toBe(false)
    expect(JSON.stringify(useStore.getState().S)).toBe(before)
  })
  it('lets the trainer write a routine, take one out and set the days, on the student’s plan', async () => {
    const puts = []
    api.mockImplementation(async (path, opts) => {
      if (path.startsWith('/api/trainer/student/plan')) { puts.push(JSON.parse(opts.body)); return { ok: true, routines: 1 } }
      return { link: { id: 'l', scope: { body: false } }, student: { id: 'mari', name: 'Marília' }, training }
    })
    const p = render(<MemoryRouter initialEntries={['/students/mari']}><Routes><Route path="/students/:id" element={<StudentView />} /></Routes></MemoryRouter>)
    await until(() => p.textContent.includes('Marília'))
    act(() => [...p.querySelectorAll('button')].find(b => b.textContent === 'Plan').click())
    act(() => [...p.querySelectorAll('button')].find(b => b.textContent.trim() === 'New routine').click())
    const ed = topSheet()
    const name = ed.querySelector('input')
    act(() => { Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(name, 'Superiores'); name.dispatchEvent(new Event('input', { bubbles: true })) })
    await act(async () => { [...ed.querySelectorAll('button')].find(b => b.textContent.trim() === 'Save to the student’s plan').click() })
    expect(puts[0]).toMatchObject({ id: 'mari', routines: [{ name: 'Superiores', ex: [] }] })
    act(() => [...p.querySelectorAll('button')].find(b => b.textContent.trim() === 'Take it out').click())
    const confirm = topSheet()
    await act(async () => { [...confirm.querySelectorAll('button')].find(b => b.textContent.trim() === 'Take it out').click() })
    expect(puts[1]).toEqual({ id: 'mari', removed: ['r'] })
    act(() => [...p.querySelectorAll('button')].find(b => b.textContent.trim() === 'Days of the week').click())
    const week = topSheet()
    act(() => [...week.querySelectorAll('.plan-day')][0].querySelector('.chip').click())
    await act(async () => { [...week.querySelectorAll('button')].find(b => b.textContent.trim() === 'Save to the student’s plan').click() })
    expect(puts[2]).toEqual({ id: 'mari', week: { 1: ['r'] } })
  })
})
