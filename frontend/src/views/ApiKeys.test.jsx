// @vitest-environment happy-dom
// Settings → API keys: a key made with its areas (the students' records only for a trainer),
// shown once with a line to try it, listed afterwards, and revoked.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiKeysSheet } from './ApiKeys.jsx'
import { useUI } from '../store/useUI.js'
import { useStore } from '../store/useStore.js'
import { api } from '../lib/api.js'

vi.mock('../lib/api.js', () => ({ api: vi.fn(), apiUrl: p => p }))
vi.mock('../lib/clipboard.js', () => ({ copyText: vi.fn(async () => true) }))

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const mounted = []
const render = el => { const c = document.createElement('div'); document.body.appendChild(c); const r = createRoot(c); act(() => r.render(el)); mounted.push([r, c]); return c }
const topSheet = () => { const s = useUI.getState().sheets.at(-1); return render(s.render(() => useUI.getState().closeSheet(s.id))) }
const button = (el, text) => [...el.querySelectorAll('button')].find(b => b.textContent.trim() === text)
async function until(ok) { for (let i = 0; i < 100 && !ok(); i++) await act(async () => { await new Promise(r => setTimeout(r, 10)) }) }
const KEY = 'ogk_0123456789ab_' + 'x'.repeat(43)

beforeEach(() => { useUI.setState({ sheets: [], toastMsg: '' }); api.mockReset() })
afterEach(() => { for (const [r, c] of mounted.splice(0)) { act(() => r.unmount()); c.remove() } })

describe('API keys', () => {
  it('makes a key with its areas, shows it once, lists it and revokes it', async () => {
    useStore.setState({ user: { id: 'u', name: 'Ana' } })
    let keys = []
    api.mockImplementation(async (path, opts) => {
      if (path === '/api/account/api-keys' && !opts) return { keys, max: 10 }
      if (path === '/api/account/api-keys' && opts.method === 'POST') {
        const b = JSON.parse(opts.body)
        keys = [{ id: '0123456789ab', name: b.name, scopes: b.scopes, write: b.write, created: 1, last: null }]
        return { key: KEY, ...keys[0] }
      }
      if (path.startsWith('/api/account/api-keys?id=')) { keys = []; return { ok: true } }
      return {}
    })
    apiKeysSheet()
    const sheet = topSheet()
    await until(() => sheet.textContent.includes('No keys yet.'))
    act(() => button(sheet, 'New API key').click())
    expect(sheet.textContent).not.toContain('Personal trainer')
    expect(button(sheet, 'Make the key').disabled).toBe(true)
    const input = sheet.querySelector('input')
    act(() => { Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, 'App de dieta'); input.dispatchEvent(new Event('input', { bubbles: true })) })
    const switches = [...sheet.querySelectorAll('[role="switch"], input[type="checkbox"]')]
    act(() => switches[2].click())    // Health
    await act(async () => { button(sheet, 'Make the key').click() })
    expect(JSON.parse(api.mock.calls.find(c => c[1]?.method === 'POST')[1].body)).toEqual({ name: 'App de dieta', scopes: ['health'], write: false })
    await until(() => sheet.textContent.includes(KEY))
    expect(sheet.textContent).toContain(`curl -H "Authorization: Bearer ${KEY}"`)
    act(() => button(sheet, 'Done').click())
    await until(() => sheet.textContent.includes('App de dieta'))
    expect(sheet.textContent).toContain('Health · reads only · last used: never')
    expect(sheet.textContent).not.toContain(KEY)
    act(() => button(sheet, 'Revoke').click())
    const confirm = topSheet()
    await act(async () => { button(confirm, 'Revoke').click() })
    await until(() => sheet.textContent.includes('No keys yet.'))
  })

  it('offers a trainer the students’ records, with a warning', async () => {
    useStore.setState({ user: { id: 'u', name: 'Ana', trainer: true } })
    api.mockImplementation(async () => ({ keys: [], max: 10 }))
    apiKeysSheet()
    const sheet = topSheet()
    await until(() => button(sheet, 'New API key') && !button(sheet, 'New API key').disabled)
    act(() => button(sheet, 'New API key').click())
    expect(sheet.textContent).toContain('Your students’ records, classes and payments')
    const switches = [...sheet.querySelectorAll('[role="switch"], input[type="checkbox"]')]
    act(() => switches[4].click())
    expect(sheet.textContent).toContain('Only do it if they agreed.')
  })
})
