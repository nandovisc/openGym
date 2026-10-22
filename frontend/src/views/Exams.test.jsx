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

  it('reads a new exam\'s PDF with AI in the background: the exam is saved at once, its results when they arrive', async () => {
    useStore.setState({ S: clone(DEF), user: { id: 'u1', name: 'One' }, config: { exams_ai: true, media: { docMB: 10 } } })
    let answer
    api.mockReturnValue(new Promise(r => { answer = r }))
    examFormSheet()
    const form = topSheet()
    const input = form.querySelector('input[type=file]')
    Object.defineProperty(input, 'files', { value: [pdfFile()], configurable: true })
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })) })
    await until(() => button(form, 'Read with AI'))
    expect(useUI.getState().toastMsg).toBe('')
    await act(async () => { button(form, 'Read with AI').click() })
    await until(() => api.mock.calls.length)
    // saved and closed before the reading is back
    expect(useStore.getState().S.exams).toHaveLength(1)
    expect(useStore.getState().S.exams[0].results).toEqual([])
    expect(useUI.getState().sheets.filter(Boolean)).toHaveLength(0)
    const [path, opts] = api.mock.calls[0]
    expect(path).toBe('/api/exams/read')
    // fetch sends the body as it gets it: it has to be the JSON text, not the object
    expect(typeof opts.body).toBe('string')
    const sent = JSON.parse(opts.body)
    expect(sent.files[0].mime).toBe('application/pdf')
    expect(atob(sent.files[0].data).startsWith('%PDF-')).toBe(true)
    await act(async () => { answer({ date: '2026-09-30', lab: 'Lab Central', title: 'Lipídios', results: [
      { key: 'ldl_cholesterol', name: 'Colesterol LDL', value: 142, valueText: '142', unit: 'mg/dL', refLow: null, refHigh: 130, refText: 'inferior a 130', flag: 'high', section: '' }
    ] }) })
    await until(() => useStore.getState().S.exams[0].results.length)
    const [exam] = useStore.getState().S.exams
    expect(exam).toMatchObject({ d: '2026-09-30', lab: 'Lab Central', title: 'Lipídios' })
    expect(exam.files[0]).toMatchObject({ kind: 'doc', mime: 'application/pdf' })
    expect(exam.results[0]).toMatchObject({ key: 'ldl_cholesterol', value: 142, flag: 'high' })
    expect(exam.ai).toBeGreaterThan(0)
    expect(useUI.getState().toastMsg).toBe('Lipídios: 1 results read and saved.')
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

describe('an exam waiting to be read', () => {
  const unread = () => {
    const S = clone(DEF)
    S.exams = [
      { id: 'u', d: '2026-01-09', title: 'Dr. Diego', files: [{ kind: 'doc', hash: 'a'.repeat(64), mime: 'application/pdf', size: 10, at: 1 }], results: [] },
      { id: 'r', d: '2026-02-13', title: 'Lido', files: [{ kind: 'doc', hash: 'b'.repeat(64), mime: 'application/pdf', size: 10, at: 1 }], results: [{ id: 'x', key: 'glucose', name: 'Glicose', value: 90, valueText: '90', unit: 'mg/dL', flag: 'normal' }] }
    ]
    return S
  }

  it('is marked in the list when the server reads with AI, and only then', () => {
    useStore.setState({ S: unread(), user: { id: 'u1' }, config: { exams_ai: true } })
    let page = render(<MemoryRouter><Exams /></MemoryRouter>)
    expect(page.querySelectorAll('.exam-ai')).toHaveLength(1)
    useStore.setState({ config: { media: {} } })
    page = render(<MemoryRouter><Exams /></MemoryRouter>)
    expect(page.querySelectorAll('.exam-ai')).toHaveLength(0)
  })

  it('offers reading in its detail, and saves the results without anyone waiting', async () => {
    useStore.setState({ S: unread(), user: { id: 'u1' }, config: { exams_ai: true } })
    const { mediaStore } = await import('../lib/media-store.js')
    await mediaStore.put('a'.repeat(64), new Blob(['%PDF-1.7']), { mime: 'application/pdf' })
    let answer
    api.mockReturnValue(new Promise(r => { answer = r }))
    const page = render(<MemoryRouter><Exams /></MemoryRouter>)
    act(() => [...page.querySelectorAll('button')].find(b => b.textContent.includes('Dr. Diego')).click())
    const detail = topSheet()
    await act(async () => { button(detail, 'Read with AI').click() })
    await until(() => api.mock.calls.length)
    // reading: the mark in the list pulses, and the sheet can be closed
    expect(page.querySelector('.exam-ai.busy')).toBeTruthy()
    act(() => button(detail, 'Close').click())
    await act(async () => { answer({ date: null, lab: 'Diagmax', title: null, results: [
      { key: 'tsh', name: 'TSH', value: 2.1, valueText: '2,1', unit: 'µUI/mL', refLow: 0.4, refHigh: 4, refText: '0,4 a 4,0', flag: 'normal', section: '' }
    ] }) })
    await until(() => useStore.getState().S.exams.find(e => e.id === 'u').results.length)
    const saved = useStore.getState().S.exams.find(e => e.id === 'u')
    expect(saved).toMatchObject({ lab: 'Diagmax', d: '2026-01-09', title: 'Dr. Diego' })
    expect(saved.results[0]).toMatchObject({ key: 'tsh', value: 2.1 })
    expect(saved.ai).toBeGreaterThan(0)
    expect(page.querySelectorAll('.exam-ai')).toHaveLength(0)
  })

  it('never replaces results typed in while the reading was on its way', async () => {
    useStore.setState({ S: unread(), user: { id: 'u1' }, config: { exams_ai: true } })
    const { mediaStore } = await import('../lib/media-store.js')
    await mediaStore.put('a'.repeat(64), new Blob(['%PDF-1.7']), { mime: 'application/pdf' })
    let answer
    api.mockReturnValue(new Promise(r => { answer = r }))
    const { readInBackground } = await import('./Exams.jsx')
    await act(async () => { readInBackground(useStore.getState().S.exams[0]) })
    await until(() => api.mock.calls.length)
    useStore.getState().update(s => { s.exams[0].results = [{ id: 'm', key: 'tsh', name: 'TSH', value: 3, valueText: '3', unit: '' }] })
    await act(async () => { answer({ date: null, lab: null, title: null, results: [{ key: 'tsh', name: 'TSH', value: 9, valueText: '9', unit: '', refLow: null, refHigh: null, refText: '', flag: null, section: '' }] }) })
    await flush()
    expect(useStore.getState().S.exams[0].results.map(r => r.value)).toEqual([3])
  })
})

describe('the doctor, the search and the filter', () => {
  const exams = () => {
    const S = clone(DEF)
    S.exams = [
      { id: 'u', d: '2026-01-09', title: 'DR. DIEGO BARROS', lab: '', files: [{ kind: 'doc', hash: 'c'.repeat(64), mime: 'application/pdf', size: 10, at: 1 }], results: [] },
      { id: 'r', d: '2026-02-13', title: 'Rotina', lab: 'Diagmax', doctor: 'Dra. Ana', results: [
        { id: 'x', key: 'uric_acid', name: 'ÁCIDO ÚRICO', value: 7.2, valueText: '7,2', unit: 'mg/dL', flag: 'high' },
        { id: 'y', key: 'albumin', name: 'Albumina', value: 4.4, valueText: '4,4', unit: 'g/dL', flag: 'normal' }
      ] }
    ]
    return S
  }

  it('narrows the list as the search is typed, and to what is out of range', () => {
    useStore.setState({ S: exams(), user: null, config: null })
    const page = render(<MemoryRouter><Exams /></MemoryRouter>)
    act(() => button(page, 'Over time').click())
    type(page.querySelector('input[type=search]'), 'acido')
    expect(page.textContent).toContain('ÁCIDO ÚRICO')
    expect(page.textContent).not.toContain('Albumina')
    type(page.querySelector('input[type=search]'), '')
    act(() => button(page, 'Out of range').click())
    expect(page.textContent).toContain('ÁCIDO ÚRICO')
    expect(page.textContent).not.toContain('Albumina')
    act(() => button(page, 'Exams').click())
    expect(page.textContent).toContain('Rotina')
    expect(page.textContent).not.toContain('DR. DIEGO')
  })

  it('a reading fills in the date, lab and doctor, and replaces a title that was the doctor\'s name', async () => {
    useStore.setState({ S: exams(), user: { id: 'u1' }, config: { exams_ai: true } })
    const { mediaStore } = await import('../lib/media-store.js')
    await mediaStore.put('c'.repeat(64), new Blob(['%PDF-1.7']), { mime: 'application/pdf' })
    api.mockResolvedValue({ date: '2026-01-08', lab: 'Diagmax', doctor: 'Dr. Diego Barros', title: 'Hemograma completo', results: [
      { key: 'hemoglobin', name: 'Hemoglobina', value: 14, valueText: '14', unit: 'g/dL', refLow: null, refHigh: null, refText: '', flag: null, section: '' }
    ] })
    const { readInBackground } = await import('./Exams.jsx')
    await act(async () => { readInBackground(useStore.getState().S.exams[0]) })
    await until(() => useStore.getState().S.exams[0].results.length)
    expect(useStore.getState().S.exams[0]).toMatchObject({ d: '2026-01-08', lab: 'Diagmax', doctor: 'Dr. Diego Barros', title: 'Hemograma completo' })
  })
})

describe('reading an exam again', () => {
  const read = () => {
    const S = clone(DEF)
    S.exams = [
      { id: 'a', d: '2026-01-09', title: 'DR. DIEGO BARROS', lab: 'Diagmax', ai: 1, files: [{ kind: 'doc', hash: 'd'.repeat(64), mime: 'application/pdf', size: 10, at: 1 }],
        results: [{ id: 'x', key: 'tsh', name: 'TSH', value: 2, valueText: '2', unit: '' }] },
      { id: 'b', d: '2026-02-13', title: 'Rotina', lab: 'Lab', files: [{ kind: 'doc', hash: 'e'.repeat(64), mime: 'application/pdf', size: 10, at: 1 }],
        results: [{ id: 'y', key: 'glucose', name: 'Glicose', value: 90, valueText: '90', unit: 'mg/dL' }] }
    ]
    return S
  }
  const reading = (title, value) => ({ date: '2026-01-08', lab: 'Diagmax', doctor: 'Dr. Diego Barros', title, results: [
    { key: 'tsh', name: 'TSH', value, valueText: String(value), unit: 'µUI/mL', refLow: null, refHigh: null, refText: '', flag: null, section: '' }
  ] })
  async function withFiles() {
    const { mediaStore } = await import('../lib/media-store.js')
    await mediaStore.put('d'.repeat(64), new Blob(['%PDF-1.7']), { mime: 'application/pdf' })
    await mediaStore.put('e'.repeat(64), new Blob(['%PDF-1.7']), { mime: 'application/pdf' })
  }

  it('from the detail, after asking, replaces the results and fills in the doctor and the title', async () => {
    useStore.setState({ S: read(), user: { id: 'u1' }, config: { exams_ai: true } })
    await withFiles()
    api.mockResolvedValue(reading('Tireoide', 2.4))
    const page = render(<MemoryRouter><Exams /></MemoryRouter>)
    act(() => [...page.querySelectorAll('button')].find(b => b.textContent.includes('DR. DIEGO')).click())
    const detail = topSheet()
    act(() => button(detail, 'Read again with AI').click())
    const ask = topSheet()
    expect(ask.textContent).toContain('Read again with AI?')
    await act(async () => { button(ask, 'Read again').click() })
    await until(() => useStore.getState().S.exams[0].doctor)
    expect(useStore.getState().S.exams[0]).toMatchObject({ title: 'Tireoide', doctor: 'Dr. Diego Barros', d: '2026-01-08' })
    expect(useStore.getState().S.exams[0].results.map(r => r.value)).toEqual([2.4])
  })

  it('reads all again, two at a time, and leaves alone an exam edited meanwhile', async () => {
    useStore.setState({ S: read(), user: { id: 'u1' }, config: { exams_ai: true } })
    await withFiles()
    const answers = []
    api.mockImplementation(() => new Promise(r => answers.push(r)))
    const page = render(<MemoryRouter><Exams /></MemoryRouter>)
    act(() => button(page, 'Read all again with AI').click())
    const ask = topSheet()
    expect(ask.textContent).toContain('Read 2 exams again with AI?')
    await act(async () => { button(ask, 'Read again').click() })
    await until(() => answers.length === 2)
    // exam b is edited by hand while its reading is on its way: that reading is not saved
    useStore.getState().update(s => { s.exams[1].results[0].valueText = '91'; s.exams[1].results[0].value = 91 })
    // newest first: the first reading asked is exam b's, the second exam a's
    await act(async () => { answers[0](reading('Outro', 5)); answers[1](reading('Tireoide', 2.4)) })
    await until(() => useStore.getState().S.exams[0].doctor)
    await flush()
    expect(useStore.getState().S.exams[0].results.map(r => r.value)).toEqual([2.4])
    expect(useStore.getState().S.exams[1].results.map(r => r.value)).toEqual([91])
  })
})
