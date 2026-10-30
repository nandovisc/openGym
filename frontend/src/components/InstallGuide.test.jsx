// @vitest-environment happy-dom
// "Add to Home Screen" on an iPhone, as a drawn phone running the steps (InstallGuide.jsx): only
// for an iPhone or iPad in its browser, and its steps can be walked by hand.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { InstallGuide, installGuideSheet, wantsInstallGuide } from './InstallGuide.jsx'
import { useUI } from '../store/useUI.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const mounted = []
const render = el => { const c = document.createElement('div'); document.body.appendChild(c); const r = createRoot(c); act(() => r.render(el)); mounted.push([r, c]); return c }
const button = (el, text) => [...el.querySelectorAll('button')].find(b => b.textContent.trim() === text)
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15'
const win = standalone => ({ matchMedia: () => ({ matches: standalone }) })

beforeEach(() => useUI.setState({ sheets: [] }))
afterEach(() => { for (const [r, c] of mounted.splice(0)) { act(() => r.unmount()); c.remove() } })

describe('the iPhone install guide', () => {
  it('is for an iPhone or iPad in its browser, never once opened from the Home Screen', () => {
    expect(wantsInstallGuide({ userAgent: IPHONE }, win(false))).toBe(true)
    expect(wantsInstallGuide({ userAgent: IPHONE, standalone: true }, win(false))).toBe(false)
    expect(wantsInstallGuide({ userAgent: IPHONE }, win(true))).toBe(false)
    expect(wantsInstallGuide({ userAgent: MAC, maxTouchPoints: 5 }, win(false))).toBe(true)   // iPadOS
    expect(wantsInstallGuide({ userAgent: MAC, maxTouchPoints: 0 }, win(false))).toBe(false)
    expect(wantsInstallGuide({ userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/120 Mobile' }, win(false))).toBe(false)
  })

  it('walks the five steps by hand, the phone showing each one', () => {
    const el = render(<InstallGuide close={() => {}} />)
    const title = () => el.querySelector('.ig-step b').textContent
    const shown = () => [...el.querySelectorAll('[data-view]')].findIndex(v => !v.classList.contains('ig-off'))
    expect(title()).toBe('Open openGym in Safari')
    expect(el.querySelector('.ig-url').textContent).toBe(location.host || 'opengym')
    act(() => button(el, 'Next').click())
    expect(title()).toBe('Tap Share')
    act(() => button(el, 'Next').click())
    expect(title()).toBe('Choose “Add to Home Screen”')
    expect(shown()).toBe(1)
    act(() => el.querySelectorAll('.ig-dots button')[3].click())
    expect(title()).toBe('Tap Add')
    expect(shown()).toBe(2)
    act(() => button(el, 'Next').click())
    expect(title()).toBe('Open it from the icon')
    expect(el.querySelector('[data-target="icon"]').classList.contains('ig-in')).toBe(true)
    act(() => button(el, 'Next').click())
    expect(title()).toBe('Open openGym in Safari')
    act(() => button(el, 'Back').click())
    expect(title()).toBe('Open it from the icon')
  })

  it('opens as a sheet', () => {
    installGuideSheet()
    const s = useUI.getState().sheets.at(-1)
    const el = render(s.render(() => {}))
    expect(el.querySelector('h3').textContent).toBe('Put openGym on your Home Screen')
  })
})
