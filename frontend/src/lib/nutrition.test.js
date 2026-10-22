import { describe, expect, it } from 'vitest'
import {
  dailySeries, dayOf, foodFromOff, foodsFromItems, itemOf, keepEstimatedFoods, itemsFromReading, normalizeFood, normalizeItem, normalizeMeal, recentFoods, rescale,
  fold, foodFromPortion, foodsFromOffSearch, itemsOfSaved, savedFromEstimates, savedMealFrom, totalsOf,
  searchFoods, searchSavedMeals, stemWord, suggestTargets, tacoFood, usageCounts, usdaFood
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

describe('foods estimated from a photo', () => {
  it('are kept per 100 g among my foods, linked from the items, once per name', () => {
    const items = [
      { id: 'a', name: 'Arroz, tipo 1, cozido', grams: 150, kcal: 192, p: 3.8, c: 42.2, f: 0.3, src: 'ai' },
      { id: 'b', name: 'Feijão carioca', grams: 100, kcal: 76, p: 4.8, c: 13.6, f: 0.5, src: 'ai' },
      { id: 'c', name: 'Molho', grams: 0, kcal: 30, p: 0, c: 2, f: 2, src: 'ai' }
    ]
    const mine = [{ id: 'f1', name: 'feijao CARIOCA', per100: { kcal: 80, p: 5, c: 14, f: 0.5 }, src: 'mine' }]
    const { foods, items: linked } = foodsFromItems(items, mine)
    expect(foods).toHaveLength(1)
    expect(foods[0]).toMatchObject({ name: 'Arroz, tipo 1, cozido', per100: { kcal: 128, p: 2.5, c: 28.1, f: 0.2 }, serving: { g: 150, label: '150 g' }, src: 'ai' })
    expect(linked.map(x => x.ref)).toEqual([foods[0].id, 'f1', undefined])
    expect(linked[0]).toMatchObject({ src: 'ai', kcal: 192 })
    expect(searchFoods('arroz cozido', { mine: [...mine, ...foods] })[0].id).toBe(foods[0].id)
    expect(foodsFromItems(items, [...mine, ...foods]).foods).toEqual([])
  })
})

describe('photo estimates from before', () => {
  it('have their AI foods kept once, and nothing else is touched', () => {
    const meals = [
      { id: 'm1', items: [{ id: 'a', name: 'Arroz cozido', grams: 100, kcal: 128, p: 2.5, c: 28, f: 0.2, src: 'ai' }, { id: 'q', name: 'Café', grams: 0, kcal: 10, p: 0, c: 1, f: 0, src: 'quick' }] },
      { id: 'm2', items: [{ id: 'b', name: 'arroz COZIDO', grams: 200, kcal: 256, p: 5, c: 56, f: 0.4, src: 'ai' }] },
      { id: 'm3', items: [{ id: 'c', name: 'Pão', grams: 50, kcal: 150, p: 4, c: 29, f: 1.5, src: 'mine', ref: 'f9' }] }
    ]
    const r = keepEstimatedFoods(meals, [])
    expect(r.changed).toBe(true)
    expect(r.foods.map(f => f.name)).toEqual(['Arroz cozido'])
    expect(r.meals[0].items.map(x => x.ref)).toEqual([r.foods[0].id, undefined])
    expect(r.meals[1].items[0].ref).toBe(r.foods[0].id)
    expect(r.meals[2]).toBe(meals[2])
    expect(keepEstimatedFoods(r.meals, r.foods).changed).toBe(false)
  })
})

describe('a search that forgives', () => {
  const food = (id, name, src = 'mine') => ({ id, name, per100: { kcal: 100, p: 0, c: 0, f: 0 }, src })
  it('takes plurals and accents as the same word', () => {
    expect(['nuggets', 'pães', 'feijões', 'ovos', 'pudins', 'animais', 'pastéis', 'abacaxi'].map(stemWord)).toEqual(['nugget', 'pao', 'feijao', 'ovo', 'pudim', 'animal', 'pastel', 'abacaxi'])
    const mine = [food('a', 'Pão francês'), food('b', 'Ovo cozido')]
    expect(searchFoods('paes frances', { mine }).map(f => f.id)).toEqual(['a'])
    expect(searchFoods('OVOS', { mine }).map(f => f.id)).toEqual(['b'])
  })
  it('finds a food by another of its names, the name typed first', () => {
    const mine = [food('n', 'Nugget de frango'), food('e', 'Empanado de frango, assado'), food('m', 'Mandioca, cozida')]
    expect(searchFoods('nuggets', { mine }).map(f => f.id)).toEqual(['n', 'e'])
    expect(searchFoods('aipim', { mine }).map(f => f.id)).toEqual(['m'])
  })
  it('puts my most used foods first, then TACO, then USDA', () => {
    const mine = [food('x', 'Quinoa, cozida, da feira'), food('y', 'Quinoa em flocos')]
    const uses = usageCounts([{ items: [{ ref: 'y' }, { ref: 'y' }] }, { items: [{ ref: 'x' }] }])
    const usda = [[1, 'Quinoa, cozida', 120, 4.4, 21.3, 1.9, 2.8]]
    const taco = [[999, 'Quinoa, crua', 'Cereais', 368, 14, 64, 6, 7]]
    expect(searchFoods('quinoa', { mine, uses, taco, usda }).map(f => f.id)).toEqual(['y', 'x', 'taco:999', 'usda:1'])
    expect(usdaFood(usda[0])).toMatchObject({ id: 'usda:1', src: 'usda', per100: { kcal: 120 } })
    expect(itemOf(usdaFood(usda[0]), 200)).toMatchObject({ kcal: 240, src: 'usda', ref: 'usda:1' })
  })
  it('finds a saved meal by its name or a food in it', () => {
    const saved = [{ id: 's', name: 'Almoço de domingo', items: [{ name: 'Feijoada' }], created: 1 }]
    expect(searchSavedMeals('domingo', saved).map(m => m.id)).toEqual(['s'])
    expect(searchSavedMeals('feijoada', saved).map(m => m.id)).toEqual(['s'])
    expect(searchSavedMeals('pizza', saved)).toEqual([])
  })
})

describe('foods typed in and products searched', () => {
  it('turns a portion from a label into values per 100 g, in g or ml', () => {
    expect(foodFromPortion({ name: 'Nugget de frango', grams: 18, kcal: 50, p: 2.7, c: 2.9, f: 3.1 })).toMatchObject({ per100: { kcal: 278, p: 15, c: 16.1, f: 17.2 }, serving: { g: 18, label: '18 g' } })
    expect(foodFromPortion({ name: 'Iogurte', grams: 170, unit: 'ml', kcal: 100 }).serving).toEqual({ g: 170, label: '170 ml' })
    expect(foodFromPortion({ name: 'Sem porção', kcal: 100 })).toBeNull()
  })
  it('reads an Open Food Facts search; a serving in ounces is left out', () => {
    const foods = foodsFromOffSearch({ products: [
      { code: '7893000949270', product_name: 'Empanado de frango Sadia Nuggets', brands: 'Sadia', serving_quantity: 130, serving_quantity_unit: 'g', serving_size: '130 g (6 unidades)', nutriments: { 'energy-kcal_100g': 236, proteins_100g: 13, carbohydrates_100g: 16, fat_100g: 13 } },
      { code: '1', product_name: 'Chips', serving_quantity: 1, serving_quantity_unit: 'oz', serving_size: '1 oz', nutriments: { 'energy-kcal_100g': 530 } },
      { code: '2', product_name: 'Sem energia', nutriments: {} }
    ] })
    expect(foods.map(f => f.id)).toEqual(['off:7893000949270', 'off:1'])
    expect(foods[0]).toMatchObject({ brand: 'Sadia', per100: { kcal: 236 }, serving: { g: 130, label: '130 g (6 unidades)' } })
    expect(foods[1].serving).toBeUndefined()
    // A kcal field that holds kJ (above the 900 of pure fat) is read as kJ.
    expect(foodsFromOffSearch({ products: [{ code: '3', product_name: 'Nuggets', nutriments: { 'energy-kcal_100g': 1104 } }] })[0].per100.kcal).toBe(264)
  })
})

describe('saved meals', () => {
  const meal = { id: 'm1', title: 'Arroz, feijão e frango', ai: 5, items: [
    { id: 'a', name: 'Arroz', grams: 150, kcal: 192, p: 3.8, c: 42, f: 0.3, src: 'ai', ref: 'f1' },
    { id: 'b', name: 'Feijão', grams: 100, kcal: 76, p: 4.8, c: 13.6, f: 0.5, src: 'ai' },
    { id: 'c', name: 'Frango', grams: 120, kcal: 191, p: 38, c: 0, f: 3, src: 'ai' }
  ] }
  it('keeps a copy of the items, and adds all or some of them, scaled', () => {
    const s = savedMealFrom(meal, '', { src: 'ai', now: 1 })
    expect(s).toMatchObject({ name: 'Arroz, feijão e frango', src: 'ai', fromMeal: 'm1', created: 1 })
    expect(s.items[0]).toEqual({ name: 'Arroz', grams: 150, kcal: 192, p: 3.8, c: 42, f: 0.3, src: 'ai', ref: 'f1' })
    const two = itemsOfSaved(s, { picked: new Set([0, 2]), factor: 0.5 })
    expect(two.map(x => [x.name, x.grams, x.kcal])).toEqual([['Arroz', 75, 96], ['Frango', 60, 96]])
    expect(new Set(itemsOfSaved(s).map(x => x.id)).size).toBe(3)
    expect(totalsOf(itemsOfSaved(s)).kcal).toBe(459)
  })
  it('makes one for each photo estimate that has none', () => {
    const made = savedFromEstimates([meal, { id: 'm2', items: [{ name: 'x', kcal: 1 }] }], [])
    expect(made.map(x => x.fromMeal)).toEqual(['m1'])
    expect(savedFromEstimates([meal], made)).toEqual([])
  })
})

describe('the USDA table', () => {
  it('has no food the TACO table already has, and no name twice', async () => {
    const [{ USDA }, { TACO: taco }] = await Promise.all([import('./usda-data.js'), import('./taco-data.js')])
    const key = n => fold(n).replace(/[^a-z0-9]+/g, ' ').trim()
    const tacoNames = new Set(taco.map(r => key(r[1])))
    expect(USDA.length).toBeGreaterThan(1500)
    expect(USDA.filter(r => tacoNames.has(key(r[1])))).toEqual([])
    expect(new Set(USDA.map(r => key(r[1]))).size).toBe(USDA.length)
    expect(USDA.every(r => !/\b(oz|lb|cup|pint|gallon)\b/i.test(r[1]))).toBe(true)
  })
})
