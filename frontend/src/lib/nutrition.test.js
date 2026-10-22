import { describe, expect, it } from 'vitest'
import {
  dailySeries, dayOf, foodFromOff, itemOf, itemsFromReading, normalizeFood, normalizeItem, normalizeMeal, recentFoods, rescale,
  searchFoods, suggestTargets, tacoFood
} from './nutrition.js'
import { TACO } from './taco-data.js'
import { mergeStates, stampChange } from './sync-merge.js'
import { referencedHashes } from './media-refs.js'

const row = name => TACO.find(r => r[1] === name)

describe('the TACO table', () => {
  it('has the whole table, with the published values', () => {
    expect(TACO.length).toBe(597)
    expect(row('Arroz, integral, cozido').slice(3, 7)).toEqual([124, 2.6, 25.8, 1])
    expect(row('Frango, peito, sem pele, grelhado').slice(3, 7)).toEqual([159, 32, 0, 2.5])
    expect(row('Feijão, carioca, cozido').slice(3, 7)).toEqual([76, 4.8, 13.6, 0.5])
  })
})

describe('amounts', () => {
  it('scales a food per 100 g to the grams eaten, and an item to a new amount', () => {
    const it150 = itemOf(tacoFood(row('Frango, peito, sem pele, grelhado')), 150)
    expect(it150).toMatchObject({ grams: 150, kcal: 239, p: 48, c: 0, f: 3.8, src: 'taco', ref: 'taco:' + row('Frango, peito, sem pele, grelhado')[0] })
    expect(rescale(it150, 100)).toMatchObject({ grams: 100, kcal: 159, p: 32, f: 2.5 })
  })
  it('takes a quick item with a name and energy, macros optional', () => {
    expect(normalizeItem({ name: 'Café com leite', kcal: '80' })).toMatchObject({ name: 'Café com leite', kcal: 80, p: 0, src: 'quick' })
    expect(normalizeItem({ name: '', kcal: 10 })).toBeNull()
    expect(normalizeItem({ name: 'x' })).toBeNull()
  })
  it('needs a day for a meal, and keeps its id and stamps when edited', () => {
    expect(normalizeMeal({ slot: 'lunch' })).toEqual({ error: 'date' })
    const m = normalizeMeal({ d: '2026-10-21', slot: 'lunch', items: [{ name: 'Arroz', kcal: 130 }] }, { prev: { id: 'm1', created: 3, _ts: 9 } })
    expect(m).toMatchObject({ id: 'm1', created: 3, _ts: 9, slot: 'lunch' })
    expect(normalizeMeal({ d: '2026-10-21', slot: 'brunch' }).slot).toBe('snack')
  })
})

describe('the day and the weeks', () => {
  const meals = [
    { id: 'a', d: '2026-10-21', slot: 'lunch', time: '12:30', items: [{ kcal: 500, p: 30, c: 50, f: 15 }, { kcal: 100, p: 2, c: 20, f: 1 }] },
    { id: 'b', d: '2026-10-21', slot: 'breakfast', time: '07:00', items: [{ kcal: 300, p: 15, c: 40, f: 8 }] },
    { id: 'c', d: '2026-10-19', slot: 'dinner', items: [{ kcal: 700, p: 40, c: 60, f: 30 }] }
  ]
  it('adds up a day by meal and in total', () => {
    const day = dayOf(meals, '2026-10-21')
    expect(day.total).toEqual({ kcal: 900, p: 47, c: 110, f: 24 })
    expect(day.bySlot.lunch.kcal).toBe(600)
    expect(day.meals.breakfast.map(m => m.id)).toEqual(['b'])
  })
  it('gives each day of a range and averages only the days logged', () => {
    const s = dailySeries(meals, '2026-10-19', '2026-10-21')
    expect(s.days.map(d => [d.d, d.kcal, d.logged])).toEqual([['2026-10-19', 700, true], ['2026-10-20', 0, false], ['2026-10-21', 900, true]])
    expect(s.avg.kcal).toBe(800)
    expect(dailySeries([], '2026-10-01', '2026-10-02').avg).toBeNull()
  })
})

describe('targets', () => {
  it('works out energy by Mifflin-St Jeor and splits the macros', () => {
    // man, 80 kg, 180 cm, 35 years: 10·80 + 6.25·180 − 5·35 + 5 = 1755 kcal at rest
    const t = suggestTargets({ sex: 'male', weightKg: 80, heightCm: 180, birthYear: 1991, year: 2026, activity: 'moderate', objective: 'maintain' })
    expect(t.bmr).toBe(1755)
    expect(t.kcal).toBe(2720)               // 1755 × 1.55, to the nearest 10
    expect(t.p).toBe(144)                   // 1.8 g per kg
    expect(t.f).toBe(76)                    // 25 % of the energy
    expect(t.c).toBe(Math.round((2720 - 144 * 4 - 76 * 9) / 4))
    expect(suggestTargets({ sex: 'female', weightKg: 60, heightCm: 165, birthYear: 1996, year: 2026, activity: 'sedentary', objective: 'lose' }).kcal).toBe(1270)   // (600 + 1031.25 − 150 − 161) × 1.2 × 0.8
    expect(suggestTargets({ weightKg: 80 })).toBeNull()
  })
})

describe('finding foods', () => {
  it('finds TACO foods by every word, accents aside, those starting with the word first', () => {
    const names = searchFoods('feijao cozido', { taco: TACO }).map(f => f.name)
    expect(names.length).toBeGreaterThan(3)
    expect(names.every(n => /feij[aã]o/i.test(n) && /cozido/i.test(n))).toBe(true)
    expect(names[0].startsWith('Feijão')).toBe(true)
  })
  it('puts the person\'s own foods first', () => {
    const mine = [{ id: 'f1', name: 'Feijão da vó', per100: { kcal: 90, p: 5, c: 14, f: 1 }, src: 'mine' }]
    expect(searchFoods('feijao', { taco: TACO, mine })[0].id).toBe('f1')
  })
  it('lists the foods eaten last, once each', () => {
    const t = row('Arroz, integral, cozido')
    const meals = [
      { id: 'a', d: '2026-10-20', items: [{ ref: 'taco:' + t[0] }] },
      { id: 'b', d: '2026-10-21', items: [{ ref: 'f1' }, { ref: 'taco:' + t[0] }] }
    ]
    const foods = [{ id: 'f1', name: 'Whey', per100: { kcal: 400, p: 80, c: 8, f: 6 } }]
    expect(recentFoods(meals, foods, { taco: TACO }).map(f => f.id)).toEqual(['f1', 'taco:' + t[0]])
  })
})

describe('Open Food Facts', () => {
  it('reads a product per 100 g with its serving', () => {
    const f = foodFromOff({ status: 1, product: { product_name: 'Iogurte natural', brands: 'Nestlé, Molico', serving_quantity: 170, serving_size: '1 pote (170 g)',
      nutriments: { 'energy-kcal_100g': 51, proteins_100g: 4.1, carbohydrates_100g: 5.2, fat_100g: 1.5 } } }, '7891000100103')
    expect(f).toEqual({ id: 'off:7891000100103', name: 'Iogurte natural', brand: 'Nestlé', per100: { kcal: 51, p: 4.1, c: 5.2, f: 1.5 },
      serving: { g: 170, label: '1 pote (170 g)' }, barcode: '7891000100103', src: 'off' })
  })
  it('turns kJ into kcal when kcal is missing, and refuses a product without a name or energy', () => {
    expect(foodFromOff({ status: 1, product: { product_name: 'X', nutriments: { energy_100g: 418.4 } } }, '1').per100.kcal).toBe(100)
    expect(foodFromOff({ status: 0 }, '1')).toBeNull()
    expect(foodFromOff({ status: 1, product: { product_name: 'X', nutriments: {} } }, '1')).toBeNull()
  })
  it('keeps a food typed in by hand', () => {
    expect(normalizeFood({ name: 'Pão da padaria', per100: { kcal: '270', p: '8' }, serving: { g: 50, label: '1 pão' } }))
      .toMatchObject({ name: 'Pão da padaria', per100: { kcal: 270, p: 8, c: 0, f: 0 }, serving: { g: 50, label: '1 pão' }, src: 'mine' })
    expect(normalizeFood({ name: 'x' })).toBeNull()
  })
})

describe('the AI\'s estimate, sync and media', () => {
  it('turns the reading of a plate into items marked as estimated', () => {
    expect(itemsFromReading({ items: [{ name: 'Arroz branco', grams: 150, kcal: 192, protein: 3.8, carbs: 42, fat: 0.3 }, { name: '' }] }))
      .toEqual([expect.objectContaining({ name: 'Arroz branco', grams: 150, kcal: 192, p: 3.8, c: 42, f: 0.3, src: 'ai' })])
  })
  it('keeps the meals logged on two devices, and a meal\'s photo', () => {
    const T = 1_800_000_000_000
    const base = { _ts: T, unit: 'kg', workouts: [], routines: [], meals: [], foods: [] }
    const change = (prev, wall, mut) => { const n = JSON.parse(JSON.stringify(prev)); mut(n); n._ts = stampChange(prev, n, wall); return n }
    const phone = change(base, T + 10, s => { s.meals.push({ id: 'p', d: '2026-10-21', slot: 'lunch', items: [] }) })
    const desk = change(base, T + 20, s => { s.meals.push({ id: 'd', d: '2026-10-21', slot: 'dinner', items: [] }); s.foods.push({ id: 'f', name: 'Whey' }) })
    const m = mergeStates(desk, phone)
    expect(m.meals.map(x => x.id).sort()).toEqual(['d', 'p'])
    expect(m.foods.map(x => x.id)).toEqual(['f'])
    const photo = { kind: 'image', hash: '9'.repeat(64), mime: 'image/webp', size: 10, width: 10, height: 10, at: 1 }
    expect([...referencedHashes({ meals: [{ id: 'x', d: '2026-10-21', photo }] })]).toEqual([photo.hash])
  })
})
