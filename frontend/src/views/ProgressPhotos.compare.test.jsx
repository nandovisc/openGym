// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { useUI } from '../store/useUI.js'
import { useStore } from '../store/useStore.js'
import { openProgressCompare } from './ProgressPhotos.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const photo = (d, n) => ({ d, m: { kind: 'image', hash: String(n).padStart(64, '0'), mime: 'image/jpeg' } })

describe('before/after compare in a right-to-left language', () => {
  let root, host
  afterEach(() => {
    act(() => root?.unmount())
    host?.remove()
    document.documentElement.removeAttribute('dir')
    useUI.getState().closeAll()
  })

  it('keeps the stage left-to-right so the handle follows the finger and "before" sits on the before photo', () => {
    document.documentElement.setAttribute('dir', 'rtl')
    openProgressCompare(photo('2026-01-01', 1), photo('2026-03-01', 2))
    const sheet = useUI.getState().sheets.at(-1)
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    act(() => root.render(sheet.render(() => {})))
    const stage = host.querySelector('.pp-compare')
    expect(stage).not.toBeNull()
    expect(stage.getAttribute('dir')).toBe('ltr')
  })

  it('shows each day\'s weight and the change between them, side by side too', () => {
    useStore.setState(s => ({ S: { ...s.S, unit: 'kg', targetW: null, bodyweight: [{ d: '2026-01-01', w: 86.2, t: 1 }, { d: '2026-03-01', w: 81.4, t: 2 }] } }))
    openProgressCompare(photo('2026-03-01', 2), photo('2026-01-01', 1))
    const sheet = useUI.getState().sheets.at(-1)
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    act(() => root.render(sheet.render(() => {})))
    const sum = host.querySelector('.pp-sum').textContent
    expect(sum).toContain('86.2 kg')
    expect(sum).toContain('81.4 kg')
    expect(sum).toContain('−4.8 kg')
    act(() => [...host.querySelectorAll('button')].find(b => b.textContent === 'Side by side').click())
    expect(host.querySelector('.pp-side')).not.toBeNull()
    expect(host.querySelector('.pp-compare')).toBeNull()
  })
})
