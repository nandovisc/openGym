// @vitest-environment happy-dom
// The Personal module, phase 4: a trainer's records of their students — made from the form,
// listed beside the students who joined, an invite sent by WhatsApp, a record whose link ended
// with its workouts kept — and the student's side of the invite link.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RecordView, StudentsList } from './Students.jsx'
import { JoinInvite } from './StudentRecord.jsx'
import { DEF, useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { api } from '../lib/api.js'

vi.mock('../lib/api.js', () => ({ api: vi.fn() }))
vi.mock('../lib/clipboard.js', () => ({ copyText: vi.fn(async () => true) }))

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const mounted = []
const render = el => { const c = document.createElement('div'); document.body.appendChild(c); const r = createRoot(c); act(() => r.render(el)); mounted.push([r, c]); return c }
const topSheet = () => { const s = useUI.getState().sheets.at(-1); return render(s.render(() => useUI.getState().closeSheet(s.id))) }
const button = (el, text) => [...el.querySelectorAll('button')].find(b => b.textContent.trim() === text)
const type = (input, value) => act(() => { Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value').set.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })) })
async function until(ok) { for (let i = 0; i < 100 && !ok(); i++) await act(async () => { await new Promise(r => setTimeout(r, 10)) }) }

beforeEach(() => { useUI.setState({ sheets: [], toastMsg: '' }); api.mockReset(); useStore.setState({ S: JSON.parse(JSON.stringify(DEF)), user: { id: 'pt', name: 'Ricardo', trainer: true } }) })
afterEach(() => { for (const [r, c] of mounted.splice(0)) { act(() => r.unmount()); c.remove() } })

describe('a trainer’s records', () => {
  it('a new student from the form shows in the list, invited, and the invite goes by WhatsApp', async () => {
    api.mockImplementation(async path => (path === '/api/trainer/students' ? { students: [] } : { code: 'PT-ABCD2345', exp: 1 }))
    const p = render(<MemoryRouter><StudentsList /></MemoryRouter>)
    await until(() => p.textContent.includes('New student'))
    act(() => p.querySelector('[aria-label="New student"]').click())
    const form = topSheet()
    const [name, phone] = form.querySelectorAll('input')
    type(name, 'Ana Paula'); type(phone, '11 97777-6666')
    act(() => button(form, 'Save').click())
    const rec = useStore.getState().S.students[0]
    expect(rec).toMatchObject({ name: 'Ana Paula', phone: '11 97777-6666', status: 'invited' })
    await until(() => p.textContent.includes('Ana Paula'))
    expect(p.textContent).toContain('Invite not accepted yet')
    const view = render(<MemoryRouter initialEntries={['/students/record/' + rec.id]}><Routes><Route path="/students/record/:id" element={<RecordView />} /></Routes></MemoryRouter>)
    act(() => button(view, 'Send invite').click())
    const invite = topSheet()
    await until(() => invite.querySelector('a[href^="https://wa.me/"]'))
    const href = invite.querySelector('a[href^="https://wa.me/"]').getAttribute('href')
    expect(href).toContain('https://wa.me/5511977776666?text=')
    expect(decodeURIComponent(href)).toContain('#/join?code=PT-ABCD2345&ref=' + rec.id)
  })
  it('a record whose link ended keeps the workouts, read-only', async () => {
    useStore.getState().update(s => { s.students = [{ id: 'r1', name: 'Bruno', status: 'ended', studentId: 'b', history: { unit: 'kg', until: '2026-10-20', customEx: [], workouts: [{ id: 'w', d: '2026-10-18', name: 'Pernas', entries: [] }] } }] })
    const view = render(<MemoryRouter initialEntries={['/students/record/r1']}><Routes><Route path="/students/record/:id" element={<RecordView />} /></Routes></MemoryRouter>)
    expect(view.textContent).toContain('Link ended · workouts kept up to')
    act(() => button(view, 'Workouts').click())
    expect(view.textContent).toContain('Pernas')
  })
  it('the invite link opens My personal trainer with the code in, and links with the record', async () => {
    api.mockImplementation(async (path, opts) => (path === '/api/trainer/mine' ? { trainers: [] } : { ok: true, link: { id: 'l', trainer: { id: 'pt', name: 'Ricardo' }, scope: { body: false }, created: 1 }, opts }))
    useStore.setState({ user: { id: 'mari', name: 'Marília' } })
    render(<MemoryRouter initialEntries={['/join?code=PT-ABCD2345&ref=r1']}><Routes><Route path="/join" element={<JoinInvite />} /><Route path="/home" element={<div>home</div>} /></Routes></MemoryRouter>)
    const sheet = topSheet()
    await until(() => sheet.querySelector('input'))
    expect(sheet.querySelector('input').value).toBe('PT-ABCD2345')
    expect(sheet.textContent).toContain('If the link ends, the trainer keeps a copy of your workouts up to that day')
    await act(async () => { button(sheet, 'Link to my trainer').click() })
    expect(JSON.parse(api.mock.calls.find(c => c[0] === '/api/trainer/link')[1].body)).toEqual({ code: 'PT-ABCD2345', body: false, ref: 'r1' })
  })
})
