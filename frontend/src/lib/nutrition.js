// Nutrition: what was eaten, against daily targets (Health → Food, views/Food.jsx). Framework-free.
//
//   S.meals [{ id, d, slot, time, items: [Item], photo?: MediaRef, ai?, created }]
//     slot: breakfast | lunch | dinner | snack. photo: the plate, kept by the media store
//     (lib/media-refs.js walks it). ai: when its items were estimated from the photo.
//   Item { id, name, grams, kcal, p, c, f, src, ref }
//     p/c/f: grams of protein, carbohydrate and fat in this amount. src: taco | off | mine | ai |
//     quick. ref: the food it came from ('taco:<id>', or the id of one of S.foods), to scale again.
//   S.foods [{ id, name, brand?, per100: { kcal, p, c, f }, serving?: { g, label }, barcode?, src }]
//     the person's own foods: a product found by its barcode, one typed in and kept, one the AI
//     estimated from a photo (src 'ai', kept by foodsFromItems).
//   S.nutrition { birthYear, heightCm, activity, objective, targets: { kcal, p, c, f }, custom }
// meals and foods merge across devices entry by entry (lib/sync-merge.js HEALTH_LISTS).
import { uid } from './format.js'

export const SLOTS = ['breakfast', 'lunch', 'dinner', 'snack']
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
    src: food.src === 'taco' ? 'taco' : food.src === 'off' ? 'off' : 'mine', ref: food.id
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

/**
 * Foods matching `query`, every word of it, accents aside: the person's own and recent ones
 * first, then TACO; within each, a name that starts with the query, then a word that does, then
 * the shorter name. At most `limit`.
 */
export function searchFoods(query, { taco = [], mine = [], limit = 40 } = {}) {
  const words = fold(query).split(/[\s,]+/).filter(Boolean)
  if (!words.length) return mine.slice(0, limit)
  const score = f => {
    const n = fold(f.name + (f.brand ? ' ' + f.brand : ''))
    if (!words.every(w => n.includes(w))) return -1
    let s = 0
    if (n.startsWith(words[0])) s += 4
    s += words.filter(w => new RegExp('(^|[\\s,(/-])' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(n)).length
    return s * 1000 - n.length
  }
  const ranked = (xs, bonus) => xs.map(f => [f, score(f)]).filter(([, s]) => s >= 0).map(([f, s]) => [f, s + bonus])
  return [...ranked(mine, 100000), ...ranked(taco.map(tacoFood), 0)]
    .sort((a, b) => b[1] - a[1]).slice(0, limit).map(([f]) => f)
}

/** The foods most recently eaten, newest first, as foods to pick again (from the items' refs). */
export function recentFoods(meals, foods, { limit = 12, taco = [] } = {}) {
  const mine = new Map(list(foods).map(f => [f.id, f]))
  const tacoBy = new Map(taco.map(r => ['taco:' + r[0], r]))
  const seen = new Set(), out = []
  const items = list(meals).slice().sort((a, b) => (b.d + (b.time || '')).localeCompare(a.d + (a.time || '')) || (b.created || 0) - (a.created || 0)).flatMap(m => list(m.items))
  for (const x of items) {
    if (!x?.ref || seen.has(x.ref)) continue
    const f = mine.get(x.ref) || (tacoBy.has(x.ref) ? tacoFood(tacoBy.get(x.ref)) : null)
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
  const kcal = num(n['energy-kcal_100g']) ?? (num(n.energy_100g) != null ? n.energy_100g / 4.184 : null)
  const name = text(p.product_name_pt || p.product_name || p.generic_name, 100)
  if (!name || kcal == null) return null
  const g = num(p.serving_quantity)
  return {
    id: 'off:' + barcode, name, ...(p.brands ? { brand: text(String(p.brands).split(',')[0], 60) } : {}),
    per100: { kcal: Math.round(kcal), p: r1(num(n.proteins_100g) ?? 0), c: r1(num(n.carbohydrates_100g) ?? 0), f: r1(num(n.fat_100g) ?? 0) },
    ...(g ? { serving: { g: Math.round(g), label: text(p.serving_size, 40) } } : {}),
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

/** What part of the target has been eaten, 0..1+ (null without a target). */
export const share = (value, target) => (target > 0 ? value / target : null)
