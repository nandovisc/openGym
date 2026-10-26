// Nutrition: what was eaten, against daily targets (Health → Food, views/Food.jsx). Framework-free.
//
//   S.meals [{ id, d, slot, time, items: [Item], photo?: MediaRef, ai?, created }]
//     slot: breakfast | morningSnack | lunch | snack (the afternoon one) | dinner | supper. photo: the plate, kept by the media store
//     (lib/media-refs.js walks it). ai: when its items were estimated from the photo.
//   Item { id, name, grams, kcal, p, c, f, src, ref }
//     p/c/f: grams of protein, carbohydrate and fat in this amount. src: taco | usda | off | mine |
//     ai | quick. ref: the food it came from ('taco:<id>', or the id of one of S.foods), to scale again.
//   S.foods [{ id, name, brand?, per100: { kcal, p, c, f }, serving?: { g, label }, barcode?, src }]
//     the person's own foods: a product found by its barcode, one typed in and kept, one the AI
//     estimated from a photo (src 'ai', kept by foodsFromItems).
//   S.savedMeals [{ id, name, items: [Item], src, fromMeal?, used?, created }]  (savedMealFrom below)
//   S.nutrition { birthYear, heightCm, activity, objective, targets: { kcal, p, c, f }, custom }
// meals, foods and saved meals merge across devices entry by entry (lib/sync-merge.js HEALTH_LISTS).
import { uid } from './format.js'
import { SYNONYMS } from './food-synonyms.js'

export const SLOTS = ['breakfast', 'morningSnack', 'lunch', 'snack', 'dinner', 'supper']
export const ACTIVITY = { sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725, very: 1.9 }
export const OBJECTIVE = { lose: -0.2, maintain: 0, gain: 0.1 }
const list = v => (Array.isArray(v) ? v : [])
const r1 = n => Math.round(n * 10) / 10
// A non-negative number, from a number or text with either decimal mark; null for nothing at all.
const num = v => {
  if (v == null || (typeof v === 'string' && !v.trim())) return null
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'))
  return Number.isFinite(n) && n >= 0 ? n : null
}
const text = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

/** Text folded for a search: no accents, no capitals. */
export const fold = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

/** A TACO row ([id, name, category, kcal, p, c, f, fibre]) as a food. */
export const tacoFood = row => ({ id: 'taco:' + row[0], name: row[1], per100: { kcal: row[3] ?? 0, p: row[4] ?? 0, c: row[5] ?? 0, f: row[6] ?? 0 }, src: 'taco' })

/** `grams` of `food` as an item of a meal. */
export function itemOf(food, grams) {
  const g = Math.max(0, Math.round(num(grams) ?? 0))
  const k = g / 100
  const per = food.per100 || {}
  return {
    id: uid(), name: text(food.brand ? `${food.name} (${food.brand})` : food.name, 120), grams: g,
    kcal: Math.round((per.kcal || 0) * k), p: r1((per.p || 0) * k), c: r1((per.c || 0) * k), f: r1((per.f || 0) * k),
    src: ['taco', 'off', 'usda'].includes(food.src) ? food.src : 'mine', ref: food.id
  }
}

/** The same item at another amount: scaled by the grams, whatever it came from. */
export function rescale(item, grams) {
  const g = Math.max(0, Math.round(num(grams) ?? 0))
  if (!item.grams) return { ...item, grams: g }
  const k = g / item.grams
  return { ...item, grams: g, kcal: Math.round(item.kcal * k), p: r1(item.p * k), c: r1(item.c * k), f: r1(item.f * k) }
}

/** An item typed in by hand (a quick add, or an AI estimate as the form holds it), or null. */
export function normalizeItem(x, src = 'quick') {
  if (!x || typeof x !== 'object') return null
  const name = text(x.name, 120)
  const kcal = num(x.kcal)
  if (!name || kcal == null) return null
  return { id: typeof x.id === 'string' && x.id ? x.id : uid(), name, grams: Math.round(num(x.grams) ?? 0), kcal: Math.round(kcal),
    p: r1(num(x.p ?? x.protein) ?? 0), c: r1(num(x.c ?? x.carbs) ?? 0), f: r1(num(x.f ?? x.fat) ?? 0), src: x.src || src, ...(x.ref ? { ref: x.ref } : {}) }
}

/** A meal as stored; `{ error }` without a day or a slot. Keeps the id and stamps of `prev`. */
export function normalizeMeal(input, { prev = null } = {}) {
  const d = DAY_RE.test(input?.d || '') ? input.d : null
  if (!d) return { error: 'date' }
  const slot = SLOTS.includes(input?.slot) ? input.slot : 'snack'
  return {
    ...(prev || {}),
    id: prev?.id || input?.id || uid(),
    d, slot,
    time: /^\d{2}:\d{2}$/.test(input?.time || '') ? input.time : (prev?.time || ''),
    items: list(input?.items).map(x => normalizeItem(x, x?.src)).filter(Boolean),
    ...(input?.photo ? { photo: input.photo } : {}),
    ai: Number(input?.ai) || 0,
    created: Number(prev?.created) || Date.now()
  }
}

const sum = items => items.reduce((t, x) => ({ kcal: t.kcal + (x.kcal || 0), p: t.p + (x.p || 0), c: t.c + (x.c || 0), f: t.f + (x.f || 0) }), { kcal: 0, p: 0, c: 0, f: 0 })
const tidy = t => ({ kcal: Math.round(t.kcal), p: r1(t.p), c: r1(t.c), f: r1(t.f) })

/** The day's meals by slot, in order of time, and the totals: { meals: { slot: [meal] }, bySlot, total }. */
export function dayOf(meals, d) {
  const day = list(meals).filter(m => m && m.d === d)
  const out = { meals: {}, bySlot: {}, total: tidy(sum(day.flatMap(m => list(m.items)))) }
  for (const s of SLOTS) {
    out.meals[s] = day.filter(m => m.slot === s).sort((a, b) => (a.time || '').localeCompare(b.time || '') || (a.created || 0) - (b.created || 0))
    out.bySlot[s] = tidy(sum(out.meals[s].flatMap(m => list(m.items))))
  }
  return out
}

/** Calories and macros per day from `from` to `to` (ISO, inclusive), and the averages over the
 *  days that have anything logged: { days: [{ d, kcal, p, c, f, logged }], avg }. */
export function dailySeries(meals, from, to) {
  const by = new Map()
  for (const m of list(meals)) if (m?.d >= from && m.d <= to) by.set(m.d, [...(by.get(m.d) || []), ...list(m.items)])
  const days = []
  for (let d = from; d <= to; d = new Date(Date.parse(d + 'T12:00:00Z') + 86400000).toISOString().slice(0, 10)) {
    const items = by.get(d) || []
    days.push({ d, ...tidy(sum(items)), logged: items.length > 0 })
  }
  const logged = days.filter(x => x.logged)
  const avg = logged.length ? tidy(Object.fromEntries(['kcal', 'p', 'c', 'f'].map(k => [k, logged.reduce((t, x) => t + x[k], 0) / logged.length]))) : null
  return { days, avg }
}

/**
 * Daily targets from the body: resting energy by Mifflin-St Jeor, times the activity factor, moved
 * by the objective; protein 1.8 g per kg, fat 25 % of the energy, carbohydrate the rest. null
 * without weight, height and age.
 */
export function suggestTargets({ sex = 'male', weightKg, heightCm, birthYear, activity = 'moderate', objective = 'maintain', year = new Date().getFullYear() } = {}) {
  const w = num(weightKg), h = num(heightCm), age = birthYear ? year - Number(birthYear) : null
  if (!w || !h || !(age > 0 && age < 120)) return null
  const bmr = 10 * w + 6.25 * h - 5 * age + (sex === 'female' ? -161 : 5)
  const kcal = Math.round((bmr * (ACTIVITY[activity] || ACTIVITY.moderate) * (1 + (OBJECTIVE[objective] ?? 0))) / 10) * 10
  const p = Math.round(1.8 * w)
  const f = Math.round((kcal * 0.25) / 9)
  const c = Math.max(0, Math.round((kcal - p * 4 - f * 9) / 4))
  return { kcal, p, c, f, bmr: Math.round(bmr) }
}

// A word as the search compares it: no accents, no capitals, no plural — pães and pão, feijões
// and feijão, nuggets and nugget, ovos and ovo are one word each.
export function stemWord(w) {
  w = fold(w)
  if (w.length <= 3) return w
  if (/(oes|aes)$/.test(w)) return w.slice(0, -3) + 'ao'
  if (/ais$/.test(w)) return w.slice(0, -3) + 'al'
  if (/eis$/.test(w)) return w.slice(0, -3) + 'el'
  if (/ois$/.test(w)) return w.slice(0, -3) + 'ol'
  if (/ns$/.test(w)) return w.slice(0, -2) + 'm'
  if (/(res|zes)$/.test(w)) return w.slice(0, -2)
  if (/[^s]s$/.test(w)) return w.slice(0, -1)
  return w
}
export const wordsOf = s => fold(s).split(/[^a-z0-9]+/).filter(Boolean).map(stemWord)

// The query and the other ways of saying it (lib/food-synonyms.js): each a list of stemmed words.
// The query itself first; then, for each group one of whose names is in the query, the query with
// that name swapped for each other one. At most eight.
const SYN = SYNONYMS.map(g => g.map(wordsOf))
export function queryVariants(query) {
  const base = wordsOf(query)
  if (!base.length) return []
  const out = [base]
  const at = (ws, p) => ws.findIndex((_, i) => p.every((w, j) => ws[i + j] === w))
  for (const group of SYN) for (const name of group) {
    const i = at(base, name)
    if (i < 0) continue
    for (const other of group) if (other !== name) out.push([...base.slice(0, i), ...other, ...base.slice(i + name.length)])
  }
  const seen = new Set()
  return out.filter(v => { const k = v.join(' '); return !seen.has(k) && seen.add(k) }).slice(0, 8)
}

/**
 * How well `name` matches the query's variants: -1 for not at all. Every word of a variant has to
 * begin a word of the name ("frang" finds "frango"); a name that starts with the first word, words
 * matched whole and a shorter name score higher; the query as typed always beats a synonym.
 */
export function matchScore(variants, name) {
  const ws = wordsOf(name)
  let best = -1
  variants.forEach((v, vi) => {
    if (!v.every(q => ws.some(w => w.startsWith(q)))) return
    let s = 0
    if (ws[0]?.startsWith(v[0])) s += 4
    s += v.filter(q => ws.includes(q)).length
    const score = s * 1000 - ws.join(' ').length + (vi ? 0 : 100000)
    if (score > best) best = score
  })
  return best
}

/** A row of the translated USDA table ([fdcId, name, kcal, p, c, f, fibre]) as a food. */
export const usdaFood = row => ({ id: 'usda:' + row[0], name: row[1], per100: { kcal: row[2] ?? 0, p: row[3] ?? 0, c: row[4] ?? 0, f: row[5] ?? 0 }, src: 'usda' })

/** How many times each food (by `ref`) was eaten: the person's most used first. */
export function usageCounts(meals) {
  const n = new Map()
  for (const m of list(meals)) for (const x of list(m?.items)) if (x?.ref) n.set(x.ref, (n.get(x.ref) || 0) + 1)
  return n
}

/**
 * Foods matching `query`, in groups: the person's own (the most used first), then TACO, then the
 * translated USDA table; within a group, by matchScore. Accents, plurals and synonyms aside. With
 * no query, the person's own, most used first. At most `limit`.
 */
export function searchFoods(query, { taco = [], usda = [], mine = [], uses = new Map(), limit = 40 } = {}) {
  const variants = queryVariants(query)
  const used = f => Math.min(uses.get(f.id) || 0, 99)
  if (!variants.length) return mine.slice().sort((a, b) => used(b) - used(a)).slice(0, limit)
  const ranked = (xs, group) => xs.map(f => [f, matchScore(variants, f.name + (f.brand ? ' ' + f.brand : ''))])
    .filter(([, s]) => s >= 0).map(([f, s]) => [f, group * 1e9 + used(f) * 1e6 + s])
  return [...ranked(mine, 3), ...ranked(taco.map(tacoFood), 2), ...ranked(usda.map(usdaFood), 1)]
    .sort((a, b) => b[1] - a[1]).slice(0, limit).map(([f]) => f)
}

/** The saved meals matching `query` (their name or a food in them), the most recent first. */
export function searchSavedMeals(query, saved, { limit = 10 } = {}) {
  const variants = queryVariants(query)
  const all = list(saved).filter(m => m?.name && list(m.items).length).sort((a, b) => (b.used || b.created || 0) - (a.used || a.created || 0))
  if (!variants.length) return all.slice(0, limit)
  return all.map(m => [m, Math.max(matchScore(variants, m.name), ...list(m.items).map(x => matchScore(variants, x.name) - 2000))])
    .filter(([, s]) => s >= 0).sort((a, b) => b[1] - a[1]).slice(0, limit).map(([m]) => m)
}

/** The foods most recently eaten, newest first, as foods to pick again (from the items' refs). */
export function recentFoods(meals, foods, { limit = 12, taco = [], usda = [] } = {}) {
  const mine = new Map(list(foods).map(f => [f.id, f]))
  const tacoBy = new Map(taco.map(r => ['taco:' + r[0], r]))
  const usdaBy = new Map(usda.map(r => ['usda:' + r[0], r]))
  const seen = new Set(), out = []
  const items = list(meals).slice().sort((a, b) => (b.d + (b.time || '')).localeCompare(a.d + (a.time || '')) || (b.created || 0) - (a.created || 0)).flatMap(m => list(m.items))
  for (const x of items) {
    if (!x?.ref || seen.has(x.ref)) continue
    const f = mine.get(x.ref) || (tacoBy.has(x.ref) ? tacoFood(tacoBy.get(x.ref)) : usdaBy.has(x.ref) ? usdaFood(usdaBy.get(x.ref)) : null)
    if (!f) continue
    seen.add(x.ref); out.push(f)
    if (out.length >= limit) break
  }
  return out
}

/** A product from Open Food Facts (GET /api/v2/product/<code>) as one of the person's foods, or
 *  null when it has no name or no energy. kJ becomes kcal when the kcal field is missing. */
export function foodFromOff(json, barcode) {
  const p = json?.product
  if (!p || json.status === 0) return null
  const n = p.nutriments || {}
  // A "kcal" above what pure fat has (900 per 100 g) is a value typed in kJ; kJ alone becomes kcal.
  const kj = num(n['energy-kj_100g']) ?? num(n.energy_100g)
  let kcal = num(n['energy-kcal_100g'])
  if (kcal != null && kcal > 900) kcal = kj != null && kj <= 3800 ? kj / 4.184 : kcal / 4.184
  if (kcal == null && kj != null) kcal = kj / 4.184
  const name = text(p.product_name_pt || p.product_name || p.generic_name, 100)
  if (!name || kcal == null) return null
  // A serving in grams or millilitres only: one in ounces says nothing a Brazilian label would.
  const unit = String(p.serving_quantity_unit || 'g').toLowerCase()
  const g = ['g', 'ml'].includes(unit) ? num(p.serving_quantity) : null
  return {
    id: 'off:' + barcode, name, ...(p.brands ? { brand: text(String(p.brands).split(',')[0], 60) } : {}),
    per100: { kcal: Math.round(kcal), p: r1(num(n.proteins_100g) ?? 0), c: r1(num(n.carbohydrates_100g) ?? 0), f: r1(num(n.fat_100g) ?? 0) },
    ...(g ? { serving: { g: Math.round(g), label: /oz|cup|lb|tbsp|tsp/i.test(p.serving_size || '') || !p.serving_size ? `${Math.round(g)} ${unit}` : text(p.serving_size, 40) } } : {}),
    barcode: String(barcode), src: 'off'
  }
}

/** A food typed in by hand, per 100 g, or null without a name and its energy. */
export function normalizeFood(x) {
  const name = text(x?.name, 100)
  const kcal = num(x?.per100?.kcal ?? x?.kcal)
  if (!name || kcal == null) return null
  const per = x.per100 || x
  const g = num(x?.serving?.g)
  return { id: x.id || uid(), name, per100: { kcal: Math.round(kcal), p: r1(num(per.p) ?? 0), c: r1(num(per.c) ?? 0), f: r1(num(per.f) ?? 0) },
    ...(g ? { serving: { g: Math.round(g), label: text(x.serving.label, 40) } } : {}), ...(x.barcode ? { barcode: String(x.barcode) } : {}), src: x.src || 'mine' }
}

/** The AI's estimate of a plate (POST /api/meals/read) as the items of a meal. */
export const itemsFromReading = reading => list(reading?.items)
  .map(x => normalizeItem({ name: x.name, grams: x.grams, kcal: x.kcal, protein: x.protein, carbs: x.carbs, fat: x.fat, src: 'ai' }, 'ai'))
  .filter(Boolean)

/**
 * The items of a photo estimate kept among the person's foods, so the next time the food is found
 * by searching instead of photographed again: { foods: the new ones to add, items: each linked to
 * its food by `ref` }. A food is the item per 100 g, with the amount on the plate as its serving.
 * A name already among `foods` (accents and capitals aside) links to that one and adds nothing —
 * a food the person saved or corrected stays as it is. An item with no grams has no per 100 g.
 */
export function foodsFromItems(items, foods) {
  const byName = new Map(list(foods).filter(f => f?.name).map(f => [fold(f.name), f]))
  const added = []
  const linked = list(items).map(it => {
    if (!it?.name || !(it.grams > 0)) return it
    const key = fold(it.name)
    let food = byName.get(key)
    if (!food) {
      const k = 100 / it.grams
      food = normalizeFood({ name: it.name, per100: { kcal: it.kcal * k, p: it.p * k, c: it.c * k, f: it.f * k }, serving: { g: it.grams, label: `${Math.round(it.grams)} g` }, src: 'ai' })
      if (!food) return it
      byName.set(key, food); added.push(food)
    }
    return { ...it, ref: food.id }
  })
  return { foods: added, items: linked }
}

/**
 * Photo estimates from before foodsFromItems existed: their AI items with no `ref`, kept among
 * the foods the same way. { meals, foods, changed }; nothing changes once every one is linked,
 * so it can run every time the screen opens.
 */
export function keepEstimatedFoods(meals, foods) {
  let all = list(foods), changed = false
  const out = list(meals).map(m => {
    if (!list(m?.items).some(x => x?.src === 'ai' && !x.ref && x.grams > 0)) return m
    const kept = foodsFromItems(m.items.map(x => (x?.src === 'ai' && !x.ref ? x : null)), all)
    all = [...all, ...kept.foods]
    changed = true
    return { ...m, items: m.items.map((x, i) => kept.items[i] || x) }
  })
  return { meals: out, foods: all, changed }
}

/** The products of an Open Food Facts search (cgi/search.pl) as foods, those without energy left out. */
export const foodsFromOffSearch = json => list(json?.products).map(p => (p?.code ? foodFromOff({ status: 1, product: p }, p.code) : null)).filter(Boolean)

/**
 * A food typed in from a portion's values ("1 unit = 18 g, 50 kcal"), kept per 100 g with that
 * portion as its serving; unit 'g' or 'ml'. Null without a name, the energy or the portion's size.
 */
export function foodFromPortion({ name, grams, unit = 'g', kcal, p, c, f, id, src }) {
  const g = num(grams), e = num(kcal)
  if (!(g > 0) || e == null) return null
  const k = 100 / g
  return normalizeFood({ id, name, src, per100: { kcal: e * k, p: (num(p) ?? 0) * k, c: (num(c) ?? 0) * k, f: (num(f) ?? 0) * k }, serving: { g, label: `${Math.round(g)} ${unit === 'ml' ? 'ml' : 'g'}` } })
}

/*
 * Saved meals, to eat again: a plate the AI estimated from a photo, or any meal kept by hand.
 *   S.savedMeals [{ id, name, items: [Item], src: 'ai' | 'manual', fromMeal?, used?, created }]
 * The items are copies (the meal they came from can change or go); `used` is when it was last
 * added, for the most recent first.
 */
const ITEM_FIELDS = ['name', 'grams', 'kcal', 'p', 'c', 'f', 'src', 'ref']
const copyItem = x => Object.fromEntries(ITEM_FIELDS.filter(k => x[k] !== undefined).map(k => [k, x[k]]))

/** A meal of the day as a saved meal named `name`, or null when it has no items. */
export function savedMealFrom(meal, name, { src = 'manual', now = Date.now() } = {}) {
  const items = list(meal?.items).filter(x => x?.name).map(copyItem)
  if (!items.length) return null
  return { id: uid(), name: text(name || meal.title, 80) || items.map(x => x.name).join(', ').slice(0, 80), items, src, ...(meal.id ? { fromMeal: meal.id } : {}), created: now }
}

/** The saved meals the photo estimates of `meals` should have and do not: one per estimated plate. */
export function savedFromEstimates(meals, saved, { now = Date.now() } = {}) {
  const have = new Set(list(saved).map(x => x?.fromMeal).filter(Boolean))
  return list(meals).filter(m => m?.ai > 0 && list(m.items).length && !have.has(m.id))
    .map(m => savedMealFrom(m, m.title, { src: 'ai', now })).filter(Boolean)
}

/**
 * The items of a saved meal to add to a day: all of them, or those at the indexes in `picked`,
 * each times `factor` (½ of the plate, 2 of it…). Fresh ids, so the same meal can be added twice.
 */
export function itemsOfSaved(saved, { picked = null, factor = 1 } = {}) {
  return list(saved?.items).filter((_, i) => !picked || picked.has(i)).map(x => {
    const it = { ...x, id: uid() }
    if (factor === 1) return it
    if (it.grams > 0) return rescale(it, it.grams * factor)
    return { ...it, kcal: Math.round(it.kcal * factor), p: r1(it.p * factor), c: r1(it.c * factor), f: r1(it.f * factor) }
  })
}

/** Totals of some items: { kcal, p, c, f }. */
export const totalsOf = items => list(items).reduce((t, x) => ({ kcal: t.kcal + (x.kcal || 0), p: r1(t.p + (x.p || 0)), c: r1(t.c + (x.c || 0)), f: r1(t.f + (x.f || 0)) }), { kcal: 0, p: 0, c: 0, f: 0 })

/** What part of the target has been eaten, 0..1+ (null without a target). */
export const share = (value, target) => (target > 0 ? value / target : null)
