// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Sleep, { nightSheet, sleepLast, sleepSyncSheet } from './Sleep.jsx'
import { DEF, useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { api } from '../lib/api.js'
import { todayISO } from '../lib/format.js'

vi.mock('../lib/api.js', () => ({ api: vi.fn(), apiUrl: p => 'https://gym.example' + p }))

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const clone = v => JSON.parse(JSON.stringify(v))
const mounted = []
function render(el) {
  const c = document.createElement('div'); document.body.appendChild(c)
  const root = createRoot(c); act(() => root.render(el)); mounted.push([root, c]); return c
}
const topSheet = () => { const s = useUI.getState().sheets.at(-1); return render(s.render(() => useUI.getState().closeSheet(s.id))) }
const button = (el, text) => [...el.querySelectorAll('button')].find(b => b.textContent.trim() === text)
const setInput = (input, value) => {
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  act(() => { set.call(input, String(value)); input.dispatchEvent(new Event('input', { bubbles: true })) })
}
async function until(ok) { for (let i = 0; i < 100 && !ok(); i++) await act(async () => { await new Promise(r => setTimeout(r, 20)) }) }
const sleep = () => useStore.getState().S.sleep
const today = todayISO()
const yesterday = new Date(Date.parse(today + 'T12:00:00Z') - 86400000).toISOString().slice(0, 10)
const healthNight = { id: 'hk:' + today, d: today, bed: `${yesterday}T23:05`, wake: `${today}T06:55`, asleepMin: 430, inBedMin: 470,
  stages: { deep: 70, rem: 100, core: 260, awake: 10 }, src: 'health', source: 'Apple Watch', created: 1 }

beforeEach(() => { useUI.setState({ sheets: [], toastMsg: '' }); api.mockReset() })
afterEach(() => { for (const [root, c] of mounted.splice(0)) { act(() => root.unmount()); c.remove() } })

describe('nights', () => {
  it('logs a night by hand: bed the evening before, wake today', () => {
    useStore.setState({ S: clone(DEF), user: null, config: null })
    nightSheet()
    const sheet = topSheet()
    const [, bed, wake] = sheet.querySelectorAll('input')
    setInput(bed, '23:30')
    setInput(wake, '07:15')
    act(() => sheet.querySelectorAll('.sleep-stars button')[3].click())
    act(() => button(sheet, 'Save').click())
    expect(sleep()).toHaveLength(1)
    expect(sleep()[0]).toMatchObject({ d: today, bed: `${yesterday}T23:30`, wake: `${today}T07:15`, asleepMin: 465, src: 'manual', quality: 4 })
  })

  it('shows last night from Apple Health with its stages, and the goal it missed', () => {
    const S = clone(DEF); S.sleep = [healthNight]
    useStore.setState({ S, user: null, config: null })
    const page = render(<MemoryRouter><Sleep /></MemoryRouter>)
    expect(page.textContent).toContain('7h 10m')
    expect(page.textContent).toContain('50 min short of your goal')
    expect(page.textContent).toContain('23:05 → 06:55')
    expect(page.querySelectorAll('.sleep-stages > div')).toHaveLength(4)
    expect(sleepLast(S)).toMatchObject({ min: 430, bed: '23:05', wake: '06:55' })
  })

  it('an edited Health night is marked, so Health no longer overwrites it', () => {
    const S = clone(DEF); S.sleep = [healthNight]
    useStore.setState({ S, user: null, config: null })
    nightSheet(healthNight.id)
    const sheet = topSheet()
    setInput(sheet.querySelectorAll('input')[1], '22:50')
    act(() => button(sheet, 'Save').click())
    expect(sleep()[0]).toMatchObject({ id: healthNight.id, edited: true, asleepMin: 485, stages: null })
  })
})

describe('the sync with Apple Health', () => {
  it('makes a token and shows the line to paste into the Shortcut, next to the Shortcut to download', async () => {
    useStore.setState({ S: clone(DEF), user: { id: 'u1' }, config: {} })
    api.mockImplementation(async (path, opts) => (opts?.method === 'POST' ? { token: 'ogs_abc', on: true, at: 1, last: null, nights: null } : { on: false }))
    sleepSyncSheet()
    const sheet = topSheet()
    await until(() => button(sheet, 'Make a token') && !button(sheet, 'Make a token').disabled)
    await act(async () => { button(sheet, 'Make a token').click() })
    await until(() => sheet.textContent.includes('ogs_abc'))
    // One line for the Shortcut's first Text: the address and the token, split on the space.
    expect(sheet.querySelector('.sleep-secret code').textContent).toBe('https://gym.example/api/sleep/ingest ogs_abc')
    expect(api.mock.calls.at(-1)).toEqual(['/api/sleep/token', { method: 'POST' }])
    expect(sheet.querySelector('a[download]').getAttribute('href')).toBe('https://gym.example/shortcuts/opengym-sleep.shortcut')
  })
})
