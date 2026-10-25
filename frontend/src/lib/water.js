// Water (Health → Water): each glass or bottle drunk, against a daily goal.
//
//   S.water [{ id, d: 'YYYY-MM-DD', t: ms, ml }]   one entry a drink, synced like the health lists
//   S.waterPrefs { goalMl: number | null, glassMl: 250 }
//
// The goal, when the person sets none, is 35 ml per kg of the last weigh-in, rounded to 50 ml
// (2,000 ml without one). The automatic habit `water` (habits-core.js autoValue) is done on a day
// that reaches it.
import { isoOf, uid } from './format.js'

const list = v => (Array.isArray(v) ? v : [])
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
export const ML_PER_KG = 35
export const DEFAULT_GOAL = 2000
export const GLASS = 250
export const BOTTLE = 500
export const ML_MAX = 3000
// The waking hours a day's water is spread over, for "behind pace" (lib smart reminders).
export const PACE_FROM = 8 * 60, PACE_TO = 22 * 60

const kgOf = (w, unit) => (unit === 'lb' ? w * 0.45359237 : w)

/** The daily goal in ml: the one set, else 35 ml per kg of the last weigh-in (rounded to 50). */
export function goalOf(S) {
  const set = Number(S?.waterPrefs?.goalMl)
  if (set > 0) return Math.round(set)
  const bw = list(S?.bodyweight).filter(e => Number(e?.w) > 0).at(-1)
  if (!bw) return DEFAULT_GOAL
  return Math.max(1000, Math.round(kgOf(Number(bw.w), S?.unit) * ML_PER_KG / 50) * 50)
}

/** The glass the "+" buttons add, in ml. */
export const glassOf = S => (Number(S?.waterPrefs?.glassMl) > 0 ? Math.round(S.waterPrefs.glassMl) : GLASS)

/** The drinks of day `d`, oldest first. */
export const drinksOn = (S, d) => list(S?.water).filter(e => e?.d === d && Number(e.ml) > 0).sort((a, b) => (a.t || 0) - (b.t || 0))

/** How much was drunk on day `d`, in ml. */
export const dayTotal = (S, d) => drinksOn(S, d).reduce((n, e) => n + Math.round(Number(e.ml)), 0)

/** `water` with a drink of `ml` at `at` (its day the local day then). */
export function addWater(water, ml, at = Date.now()) {
  const n = Math.round(Number(ml))
  if (!(n > 0)) return list(water)
  return [...list(water), { id: uid(), d: isoOf(new Date(at)), t: at, ml: Math.min(n, ML_MAX) }]
}

/** `water` without the drink `id`. */
export const removeWater = (water, id) => list(water).filter(e => e?.id !== id)

/** Days in a row, up to `today`, that reached the goal; today counts once it does. */
export function streakDays(S, today) {
  const goal = goalOf(S)
  let n = 0
  for (let i = 0; i < 400; i++) {
    const d = isoOf(new Date(Date.parse(today + 'T12:00:00') - i * 86400000))
    if (dayTotal(S, d) >= goal) n++
    else if (i > 0 || dayTotal(S, d) > 0 || n > 0) break
  }
  return n
}

/** The totals of the `days` days up to `today`: [{ d, ml }], oldest first. */
export function series(S, today, days = 30) {
  return Array.from({ length: days }, (_, i) => {
    const d = isoOf(new Date(Date.parse(today + 'T12:00:00') - (days - 1 - i) * 86400000))
    return { d, ml: dayTotal(S, d) }
  })
}

const minutesOf = hhmm => { const [h, m] = String(hhmm).split(':').map(Number); return h * 60 + m }

/** How much should have been drunk by `hhmm` to reach the goal by 22:00, spread from 08:00. */
export function paceAt(S, hhmm) {
  const m = minutesOf(hhmm)
  const share = Math.min(1, Math.max(0, (m - PACE_FROM) / (PACE_TO - PACE_FROM)))
  return Math.round(goalOf(S) * share)
}

const WATER_NAME = /^(agua|água|water|hidrata[cç][aã]o|hydration)\b/i
const ML_UNIT = /^(ml|mililitros?|millilit(er|re)s?)$/i

/**
 * The habit "Água" a person kept by hand (an amount in ml) moved onto the water module: its days
 * become drinks (one a day, with the day's total) and the habit an automatic one of source
 * `water`, keeping its id, groups and history. { water, habits } changed, or null when there is
 * no such habit or it was moved already.
 */
export function migrateWaterHabit(S) {
  const h = list(S?.habits).find(x => x && !x.archived && x.kind === 'quantity' && WATER_NAME.test(String(x.name || '').trim()) && ML_UNIT.test(String(x.goal?.unit || '').trim()))
  if (!h) return null
  const had = new Set(list(S.water).map(e => e?.d))
  const drinks = list(S.habitLog).filter(e => e?.habitId === h.id && DAY_RE.test(e.d || '') && Number(e.value) > 0 && !had.has(e.d))
    .map(e => ({ id: 'mig-' + h.id + '-' + e.d, d: e.d, t: Number(e.at) || Date.parse(e.d + 'T12:00:00'), ml: Math.round(Number(e.value)) }))
  const goalMl = Number(h.goal?.value) > 0 ? Math.round(h.goal.value) : null
  const habits = list(S.habits).map(x => (x === h ? { ...x, kind: 'auto', auto: { source: 'water' }, goal: null } : x))
  return { water: [...list(S.water), ...drinks], habits, goalMl }
}
