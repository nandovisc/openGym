// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Exams, { examFormSheet } from './Exams.jsx'
import { DEF, useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { api } from '../lib/api.js'

vi.mock('../lib/api.js', () => ({ api: vi.fn() }))
vi.mock('../lib/media-store.js', () => {
  const blobs = new Map()
  return {
    mediaStore: {
      hold: () => () => {},
      put: vi.fn(async (hash, blob) => { blobs.set(hash, blob) }),
      get: vi.fn(async hash => (blobs.has(hash) ? { blob: blobs.get(hash), mime: 'application/pdf' } : null)),
      url: vi.fn(async () => null),
      release: () => {},
      subscribe: () => () => {},
      ready: async () => true
    }
  }
})

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const clone = value => JSON.parse(JSON.stringify(value))
const mounted = []
const flush = () => act(async () => { for (let i = 0; i < 5; i++) await new Promise(r => setTimeout(r, 0)) })
// The ingest is loaded on first use (a dynamic import), so the first pick can take a while.
async function until(ok) { for (let i = 0; i < 100 && !ok(); i++) await act(async () => { await new Promise(r => setTimeout(r, 20)) }) }

function render(el) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => root.render(el))
  mounted.push([root, container])
  return container
}
const topSheet = () => { const s = useUI.getState().sheets.at(-1); return render(s.render(() => useUI.getState().closeSheet(s.id))) }
const button = (el, text) => [...el.querySelectorAll('button')].find(b => b.textContent.trim() === text)
const type = (input, value) => {
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  act(() => { set.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })) })
}
const pdfFile = () => new File([new TextEncoder().encode('%PDF-1.7\n' + 'x'.repeat(100))], 'laudo.pdf', { type: 'application/pdf' })

beforeEach(() => { useUI.setState({ sheets: [], toastMsg: '' }); api.mockReset() })
afterEach(() => { for (const [root, c] of mounted.splice(0)) { act(() => root.unmount()); c.remove() } })

describe('Exams', () => {
  it('adds an exam by hand, with a result flagged against its range', () => {
    useStore.setState({ S: clone(DEF), user: null, config: null })
    const page = render(<MemoryRouter><Exams /></MemoryRouter>)
    act(() => button(page, 'Add exam').click())
    const form = topSheet()
    act(() => button(form, 'Add result').click())
    const [name, value, , range] = [...form.querySelectorAll('.exam-edit-row input')]
    type(name, 'Glicose')
    type(value, '104')
    type(range, '70 a 99')
    act(() => button(form, 'Save').click())
    const [exam] = useStore.getState().S.exams
    expect(exam.results[0]).toMatchObject({ name: 'Glicose', value: 104, refLow: 70, refHigh: 99, flag: 'high' })
    expect(page.textContent).toContain('1 out of range')
  })

  it('reads a PDF with AI when the server offers it, and the values wait to be checked', async () => {
    useStore.setState({ S: clone(DEF), user: { id: 'u1', name: 'One' }, config: { exams_ai: true, media: { docMB: 10 } } })
    api.mockResolvedValue({ date: '2026-09-30', lab: 'Lab Central', title: 'Lipídios', results: [
      { key: 'ldl_cholesterol', name: 'Colesterol LDL', value: 142, valueText: '142', unit: 'mg/dL', refLow: null, refHigh: 130, refText: 'inferior a 130', flag: 'high', section: '' }
    ] })
    examFormSheet()
    const form = topSheet()
    const input = form.querySelector('input[type=file]')
    Object.defineProperty(input, 'files', { value: [pdfFile()], configurable: true })
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })) })
    await until(() => button(form, 'Read with AI'))
    expect(useUI.getState().toastMsg).toBe('')
    expect(button(form, 'Read with AI')).toBeTruthy()
    await act(async () => { button(form, 'Read with AI').click() })
    await until(() => api.mock.calls.length && useUI.getState().toastMsg)
    const [path, opts] = api.mock.calls[0]
    expect(path).toBe('/api/exams/read')
    expect(opts.body.files[0].mime).toBe('application/pdf')
    expect(atob(opts.body.files[0].data).startsWith('%PDF-')).toBe(true)
    expect(useStore.getState().S.exams).toEqual([])          // nothing saved until confirmed
    act(() => button(form, 'Save').click())
    const [exam] = useStore.getState().S.exams
    expect(exam).toMatchObject({ d: '2026-09-30', lab: 'Lab Central', title: 'Lipídios' })
    expect(exam.files[0]).toMatchObject({ kind: 'doc', mime: 'application/pdf' })
    expect(exam.results[0]).toMatchObject({ key: 'ldl_cholesterol', value: 142, flag: 'high' })
  })

  it('hides the AI button without a server that offers it', async () => {
    useStore.setState({ S: clone(DEF), user: { id: 'u1', name: 'One' }, config: { media: {} } })
    examFormSheet()
    const form = topSheet()
    expect(button(form, 'Read with AI')).toBeFalsy()
  })

  it('shows each test over time', () => {
    const S = clone(DEF)
    S.exams = [
      { id: 'a', d: '2026-01-10', title: 'Rotina', results: [{ id: 'r1', key: 'glucose', name: 'Glicose', value: 92, valueText: '92', unit: 'mg/dL', flag: 'normal' }] },
      { id: 'b', d: '2026-06-10', title: 'Rotina', results: [{ id: 'r2', key: 'glucose', name: 'Glicemia', value: 104, valueText: '104', unit: 'mg/dL', flag: 'high' }] }
    ]
    useStore.setState({ S, user: null, config: null })
    const page = render(<MemoryRouter><Exams /></MemoryRouter>)
    act(() => button(page, 'Over time').click())
    expect(page.textContent).toContain('Glicemia')
    expect(page.textContent).toContain('2 results')
  })
})
