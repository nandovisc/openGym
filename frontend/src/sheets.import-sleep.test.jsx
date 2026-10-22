// @vitest-environment happy-dom
// The Apple Health export with nothing but sleep in it (the records cut out of a huge export.xml):
// the summary has nights to bring in, and its button brings them.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { importFromApp } from './sheets.jsx'
import { DEF, useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const mounted = []
const topSheet = () => {
  const s = useUI.getState().sheets.at(-1)
  const c = document.createElement('div'); document.body.appendChild(c)
  const root = createRoot(c); act(() => root.render(s.render(() => useUI.getState().closeSheet(s.id)))); mounted.push([root, c]); return c
}
const rec = (start, end, value) => `<Record type="HKCategoryTypeIdentifierSleepAnalysis" sourceName="Apple Watch" startDate="${start}" endDate="${end}" value="${value}"/>`
const FILE = ['<?xml version="1.0" encoding="UTF-8"?>', '<HealthData>',
  rec('2026-10-20 23:00:00 -0300', '2026-10-21 06:30:00 -0300', 'HKCategoryValueSleepAnalysisAsleepCore'),
  rec('2026-10-21 23:30:00 -0300', '2026-10-22 07:00:00 -0300', 'HKCategoryValueSleepAnalysisAsleepCore'),
  '</HealthData>'].join('\n')

beforeEach(() => { useUI.setState({ sheets: [], toastMsg: '' }); useStore.setState({ S: JSON.parse(JSON.stringify(DEF)), user: null, config: null }) })
afterEach(() => { for (const [root, c] of mounted.splice(0)) { act(() => root.unmount()); c.remove() } })

it('imports the nights of an export that has only sleep in it', async () => {
  await act(async () => { await importFromApp(new File([FILE], 'sono-apple-health.xml', { type: 'text/xml' })) })
  const sheet = topSheet()
  const btn = [...sheet.querySelectorAll('button')].find(b => b.textContent.trim() === 'Import')
  expect(btn && !btn.disabled).toBe(true)
  act(() => btn.click())
  expect(useStore.getState().S.sleep.map(n => [n.d, n.asleepMin])).toEqual([['2026-10-21', 450], ['2026-10-22', 450]])
})
