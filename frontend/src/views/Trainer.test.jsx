// @vitest-environment happy-dom
// The Personal module, phase 1, from both sides: a student links with a trainer's code (seeing
// what they share) and can end it; a trainer makes a code and sees who linked.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { myStudentsSheet, myTrainersSheet } from './Trainer.jsx'
import { useUI } from '../store/useUI.js'
import { api } from '../lib/api.js'

vi.mock('../lib/api.js', () => ({ api: vi.fn() }))
vi.mock('../lib/clipboard.js', () => ({ copyText: vi.fn(async () => true) }))

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const mounted = []
const render = el => { const c = document.createElement('div'); document.body.appendChild(c); const r = createRoot(c); act(() => r.render(el)); mounted.push([r, c]); return c }
const topSheet = () => { const s = useUI.getState().sheets.at(-1); return render(s.render(() => useUI.getState().closeSheet(s.id))) }
const button = (el, text) => [...el.querySelectorAll('button')].find(b => b.textContent.trim() === text)
async function until(ok) { for (let i = 0; i < 100 && !ok(); i++) await act(async () => { await new Promise(r => setTimeout(r, 10)) }) }

beforeEach(() => { useUI.setState({ sheets: [], toastMsg: '' }); api.mockReset() })
afterEach(() => { for (const [r, c] of mounted.splice(0)) { act(() => r.unmount()); c.remove() } })

describe('the Personal module', () => {
  it('a student sees what is shared, links with the code, and can stop sharing', async () => {
    let trainers = []
    api.mockImplementation(async (path, opts) => {
      if (path === '/api/trainer/mine') return { trainers }
      if (path === '/api/trainer/link') { trainers = [{ id: 'l1', trainer: { id: 'pt', name: 'Ricardo' }, scope: { body: JSON.parse(opts.body).body }, created: Date.parse('2026-10-26') }]; return { ok: true, link: trainers[0] } }
      if (path === '/api/trainer/unlink') { trainers = []; return { ok: true } }
      return {}
    })
    myTrainersSheet()
    const sheet = topSheet()
    await until(() => sheet.querySelector('input'))
    expect(sheet.textContent).toContain('Never: food, sleep, medications, exams, habits or water')
    expect(sheet.textContent).not.toContain('Your weigh-ins and body measurements')
    const input = sheet.querySelector('input')
    act(() => { Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, 'pt-abcd2345'); input.dispatchEvent(new Event('input', { bubbles: true })) })
    await act(async () => { button(sheet, 'Link to my trainer').click() })
    expect(api.mock.calls.find(c => c[0] === '/api/trainer/link')[1].body).toBe(JSON.stringify({ code: 'PT-ABCD2345', body: false }))
    await until(() => sheet.textContent.includes('Ricardo'))
    expect(useUI.getState().toastMsg).toBe('Linked to Ricardo')
    act(() => button(sheet, 'Stop sharing').click())
    const confirm = topSheet()
    await act(async () => { button(confirm, 'Stop sharing').click() })
    expect(api.mock.calls.at(-2)[0]).toBe('/api/trainer/unlink')
  })

  it('a trainer makes a code and sees the students who linked', async () => {
    api.mockImplementation(async (path, opts) => {
      if (path === '/api/trainer/code') return opts?.method === 'POST' ? { code: 'PT-NEWC0DE2', exp: Date.parse('2026-11-02') } : { code: null }
      if (path === '/api/trainer/students') return { students: [{ id: 'l1', student: { id: 'm', name: 'Marília' }, scope: { body: true }, created: Date.parse('2026-10-20') }] }
      return {}
    })
    myStudentsSheet()
    const sheet = topSheet()
    await until(() => sheet.textContent.includes('Marília'))
    expect(sheet.textContent).toContain('shares weigh-ins')
    await act(async () => { button(sheet, 'Make a code').click() })
    await until(() => sheet.textContent.includes('PT-NEWC0DE2'))
    expect(useUI.getState().toastMsg).toBe('Code copied')
  })
})
