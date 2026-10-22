// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Food, { addFoodSheet, readMealInBackground, targetsSheet } from './Food.jsx'
import { DEF, useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { api } from '../lib/api.js'
import { todayISO } from '../lib/format.js'

vi.mock('../lib/api.js', () => ({ api: vi.fn() }))

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
const meals = () => useStore.getState().S.meals

beforeEach(() => { useUI.setState({ sheets: [], toastMsg: '', mealReads: {} }); api.mockReset() })
afterEach(() => { for (const [root, c] of mounted.splice(0)) { act(() => root.unmount()); c.remove() } vi.unstubAllGlobals() })

describe('adding food', () => {
  it('finds a TACO food as it is typed and adds the amount chosen', async () => {
    useStore.setState({ S: clone(DEF), user: null, config: null })
    addFoodSheet(todayISO(), 'lunch')
    let sheet = topSheet()
    await until(() => !sheet.textContent.includes('Loading…'))
    setInput(sheet.querySelector('input[type=search]'), 'frango peito grelhado')
    const hit = [...sheet.querySelectorAll('button')].find(b => b.textContent.includes('Frango, peito, sem pele, grelhado'))
    expect(hit).toBeTruthy()
    act(() => hit.click())
    setInput(sheet.querySelector('.food-grams input'), 150)
    expect(sheet.textContent).toContain('239 kcal')
    act(() => button(sheet, 'Add').click())
    const [meal] = meals()
    expect(meal).toMatchObject({ d: todayISO(), slot: 'lunch' })
    expect(meal.items[0]).toMatchObject({ grams: 150, kcal: 239, p: 48, src: 'taco' })
  })

  it('adds a quick item, and two adds to one meal go into the same meal', () => {
    useStore.setState({ S: clone(DEF), user: null, config: null })
    for (const name of ['Café com leite', 'Pão francês']) {
      addFoodSheet(todayISO(), 'breakfast')
      const sheet = topSheet()
      act(() => button(sheet, 'Quick').click())
      const [nameIn, kcal] = [...sheet.querySelectorAll('.med-form input')]
      setInput(nameIn, name)
      setInput(kcal, 120)
      act(() => button(sheet, 'Add').click())
    }
    expect(meals()).toHaveLength(1)
    expect(meals()[0].items.map(x => x.name)).toEqual(['Café com leite', 'Pão francês'])
  })

  it('looks a typed barcode up in Open Food Facts and keeps the product among my foods', async () => {
    useStore.setState({ S: clone(DEF), user: null, config: null })
    const fetchMock = vi.fn(async () => ({ json: async () => ({ status: 1, product: { product_name: 'Iogurte natural', brands: 'Molico', serving_quantity: 170, serving_size: '1 pote',
      nutriments: { 'energy-kcal_100g': 51, proteins_100g: 4.1, carbohydrates_100g: 5.2, fat_100g: 1.5 } } }) }))
    vi.stubGlobal('fetch', fetchMock)
    addFoodSheet(todayISO(), 'snack')
    const sheet = topSheet()
    act(() => button(sheet, 'Barcode').click())
    setInput(sheet.querySelector('input[inputmode=numeric]'), '7891000100103')
    await act(async () => { button(sheet, 'Look up').click() })
    await until(() => sheet.textContent.includes('Iogurte natural'))
    expect(fetchMock.mock.calls[0][0]).toContain('/api/v2/product/7891000100103.json')
    expect(useStore.getState().S.foods[0]).toMatchObject({ id: 'off:7891000100103', barcode: '7891000100103' })
    act(() => button(sheet, 'Add').click())
    expect(meals()[0].items[0]).toMatchObject({ grams: 170, kcal: 87, src: 'off' })
  })
})

describe('the photo of a plate', () => {
  const withMeal = items => {
    const S = clone(DEF)
    S.meals = [{ id: 'm', d: todayISO(), slot: 'lunch', items, photo: { kind: 'image', hash: 'a'.repeat(64), mime: 'image/webp', size: 10, width: 10, height: 10, at: 1 }, ai: 0, created: 1 }]
    useStore.setState({ S, user: { id: 'u1' }, config: { meals_ai: true } })
  }
  const reading = { title: 'Arroz, feijão e frango', items: [
    { name: 'Arroz, tipo 1, cozido', grams: 150, kcal: 192, protein: 3.8, carbs: 42.2, fat: 0.3 },
    { name: 'Feijão, carioca, cozido', grams: 100, kcal: 76, protein: 4.8, carbs: 13.6, fat: 0.5 }
  ] }

  it('can come from the camera or from the gallery', () => {
    useStore.setState({ S: clone(DEF), user: { id: 'u1' }, config: { meals_ai: true } })
    addFoodSheet(todayISO(), 'lunch')
    const sheet = topSheet()
    act(() => button(sheet, 'Photo').click())
    expect(button(sheet, 'Photo of the plate')).toBeTruthy()
    expect(button(sheet, 'From the gallery')).toBeTruthy()
    const inputs = [...sheet.querySelectorAll('input[type=file]')]
    expect(inputs.map(i => i.getAttribute('capture'))).toEqual(['environment', null])
  })

  it('is estimated in the background and the foods are saved into the meal', async () => {
    withMeal([])
    api.mockResolvedValue(reading)
    await act(async () => { readMealInBackground('m', [new Blob(['x'], { type: 'image/webp' })]) })
    await until(() => meals()[0].items.length)
    const [path, opts] = api.mock.calls[0]
    expect(path).toBe('/api/meals/read')
    expect(JSON.parse(opts.body).files[0].mime).toBe('image/webp')
    expect(meals()[0]).toMatchObject({ title: 'Arroz, feijão e frango' })
    expect(meals()[0].items.map(x => [x.name, x.kcal, x.src])).toEqual([['Arroz, tipo 1, cozido', 192, 'ai'], ['Feijão, carioca, cozido', 76, 'ai']])
    expect(meals()[0].ai).toBeGreaterThan(0)
    // Kept among my foods, so the next time it is found by searching instead of photographed.
    const foods = useStore.getState().S.foods
    expect(foods.map(f => [f.name, f.src, f.serving.g])).toEqual([['Arroz, tipo 1, cozido', 'ai', 150], ['Feijão, carioca, cozido', 'ai', 100]])
    expect(meals()[0].items.map(x => x.ref)).toEqual(foods.map(f => f.id))
    addFoodSheet(todayISO(), 'dinner')
    const sheet = topSheet()
    await until(() => !sheet.textContent.includes('Loading…'))
    setInput(sheet.querySelector('input[type=search]'), 'feijao')
    expect(sheet.querySelector('.lrow').textContent).toContain('Feijão, carioca, cozido')
  })

  it('never replaces food added by hand while the estimate was on its way', async () => {
    withMeal([])
    let answer
    api.mockReturnValue(new Promise(r => { answer = r }))
    await act(async () => { readMealInBackground('m', [new Blob(['x'], { type: 'image/webp' })]) })
    await until(() => api.mock.calls.length)
    useStore.getState().update(s => { s.meals[0].items = [{ id: 'i', name: 'Salada', grams: 50, kcal: 20, p: 1, c: 3, f: 0, src: 'quick' }] })
    await act(async () => { answer(reading) })
    await act(async () => { await new Promise(r => setTimeout(r, 30)) })
    expect(meals()[0].items.map(x => x.name)).toEqual(['Salada'])
  })
})

describe('photo estimates from before', () => {
  it('have their foods kept among my foods when the screen opens', () => {
    const S = clone(DEF)
    S.meals = [{ id: 'm', d: todayISO(), slot: 'lunch', ai: 1, created: 1, items: [{ id: 'i', name: 'Frango grelhado', grams: 120, kcal: 191, p: 38.4, c: 0, f: 3, src: 'ai' }] }]
    useStore.setState({ S, user: null, config: null })
    render(<MemoryRouter><Food /></MemoryRouter>)
    const after = useStore.getState().S
    expect(after.foods.map(f => [f.name, f.src, f.per100.kcal])).toEqual([['Frango grelhado', 'ai', 159]])
    expect(after.meals[0].items[0].ref).toBe(after.foods[0].id)
  })
})

describe('the day and the targets', () => {
  it('suggests targets from the last weight and saves them; the day shows what is left', () => {
    const S = clone(DEF)
    S.body = 'male'
    S.bodyweight = [{ d: '2026-10-01', w: 80, t: 1 }]
    S.meals = [{ id: 'm', d: todayISO(), slot: 'lunch', items: [{ id: 'i', name: 'Almoço', grams: 0, kcal: 720, p: 40, c: 80, f: 20, src: 'quick' }], created: 1 }]
    useStore.setState({ S, user: null, config: null })
    targetsSheet()
    const sheet = topSheet()
    const [birth, height] = [...sheet.querySelectorAll('.food-macro-grid input')]
    setInput(birth, new Date().getFullYear() - 35)
    setInput(height, 180)
    expect(sheet.textContent).toContain('Suggested: 2,720 kcal')
    act(() => button(sheet, 'Use').click())
    act(() => button(sheet, 'Save').click())
    expect(useStore.getState().S.nutrition.targets).toMatchObject({ kcal: 2720, p: 144, f: 76 })
    const page = render(<MemoryRouter><Food /></MemoryRouter>)
    expect(page.textContent).toContain('2,000 kcal left')
  })
})
