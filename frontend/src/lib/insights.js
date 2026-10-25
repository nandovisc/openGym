// Patterns across the modules (Health → Patterns, and the two strongest in Your week): how one
// thing went alongside another over the last weeks — sleep and training, workouts and weight,
// sleep and habits, water and sleep, protein and weight. Plain averages and counts over the
// person's own days, said only when there are enough days on each side and the gap is worth it.
// Never a claim of cause: "alongside", "on days when".
//
// insights(S, today) → [{ id, key, args, n, score }], strongest first. `key` is the sentence for
// t() with `args`; `n` how many days (or weeks) it rests on; `score` how big the gap is (0..1+).
import { dailyProgress } from './habits.js'
import { goalOf as waterGoal } from './water.js'
import { moduleOn } from './modules.js'

const list = v => (Array.isArray(v) ? v : [])
const back = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') - n * 86400000).toISOString().slice(0, 10)
const next = d => back(d, -1)
const avg = xs => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null)
const r1 = n => Math.round(n * 10) / 10
export const WINDOW_DAYS = 84
export const MIN_DAYS = 5
export const MIN_WEEKS = 3
const SHORT_NIGHT = 360, GOOD_NIGHT = 420

const weekdayOf = d => new Date(d + 'T12:00:00Z').getUTCDay()
const weekOf = (d, ws) => back(d, (weekdayOf(d) - (ws === 0 ? 0 : 1) + 7) % 7)

// After short nights, how often there was a workout that day, against after good ones.
function sleepAndTraining(S, from, today) {
  const trained = new Set(list(S.workouts).map(w => w?.d))
  const nights = list(S.sleep).filter(n => n?.d >= from && n.d <= today && Number(n.asleepMin) > 0)
  const short = nights.filter(n => n.asleepMin < SHORT_NIGHT), good = nights.filter(n => n.asleepMin >= GOOD_NIGHT)
  if (short.length < MIN_DAYS || good.length < MIN_DAYS) return null
  const rs = short.filter(n => trained.has(n.d)).length / short.length, rg = good.filter(n => trained.has(n.d)).length / good.length
  if (!(rg > 0) || rs >= rg) return null
  const less = Math.round((1 - rs / rg) * 100)
  if (less < 15) return null
  return { id: 'sleep-training', key: 'After nights under 6 hours, you trained {0}% less that day.', args: [less], n: short.length + good.length, score: less / 100 }
}

// The weight change of weeks with 3+ workouts against weeks with at most one.
function workoutsAndWeight(S, from, today) {
  const ws = S.weekStart
  const weeks = new Map()
  for (const w of list(S.workouts)) if (w?.d >= from && w.d <= today) { const k = weekOf(w.d, ws); weeks.set(k, { n: (weeks.get(k)?.n || 0) + 1 }) }
  const change = start => {
    const end = back(start, -6)
    const bw = list(S.bodyweight).filter(e => e?.d >= start && e.d <= end && Number(e.w) > 0).sort((a, b) => (a.d < b.d ? -1 : 1))
    return bw.length > 1 ? Number(bw.at(-1).w) - Number(bw[0].w) : null
  }
  const busy = [], quiet = []
  for (let k = weekOf(from, ws); k <= back(weekOf(today, ws), 7); k = back(k, -7)) {
    const c = change(k)
    if (c == null) continue
    const n = weeks.get(k)?.n || 0
    if (n >= 3) busy.push(c); else if (n <= 1) quiet.push(c)
  }
  if (busy.length < MIN_WEEKS || quiet.length < MIN_WEEKS) return null
  const a = avg(busy), b = avg(quiet)
  if (Math.abs(a - b) < 0.2) return null
  const unit = S.unit === 'lb' ? 'lb' : 'kg'
  return { id: 'workouts-weight', key: 'In weeks with 3 or more workouts your weight moved {0} on average, against {1} in weeks with one or none.', args: [`${a > 0 ? '+' : ''}${r1(a)} ${unit}`, `${b > 0 ? '+' : ''}${r1(b)} ${unit}`], n: busy.length + quiet.length, score: Math.min(1, Math.abs(a - b)) }
}

// How much of the day's habits got done after a night on the sleep goal, against after one short of it.
function sleepAndHabits(S, from, today) {
  if (!moduleOn(S, 'habits')) return null
  const goal = Number(S.sleepPrefs?.goalMin) > 0 ? Number(S.sleepPrefs.goalMin) : 480
  const on = [], off = []
  for (const n of list(S.sleep)) {
    if (!(n?.d >= from && n.d < today) || !(Number(n.asleepMin) > 0)) continue
    const p = dailyProgress(S, n.d, today)
    if (!p.total) continue
    ;(n.asleepMin >= goal ? on : off).push(p.done / p.total)
  }
  if (on.length < MIN_DAYS || off.length < MIN_DAYS) return null
  const a = Math.round(avg(on) * 100), b = Math.round(avg(off) * 100)
  if (a - b < 15) return null
  return { id: 'sleep-habits', key: 'After nights on your sleep goal you did {0}% of your habits, against {1}% after shorter ones.', args: [a, b], n: on.length + off.length, score: (a - b) / 100 }
}

// The night after a day on the water goal, against the night after a day short of it.
function waterAndSleep(S, from, today) {
  if (!moduleOn(S, 'water')) return null
  const goal = waterGoal(S)
  const byDay = new Map()
  for (const e of list(S.water)) if (e?.d >= from && e.d < today && Number(e.ml) > 0) byDay.set(e.d, (byDay.get(e.d) || 0) + Number(e.ml))
  const night = new Map(list(S.sleep).filter(n => Number(n?.asleepMin) > 0).map(n => [n.d, Number(n.asleepMin)]))
  const on = [], off = []
  for (const [d, ml] of byDay) { const m = night.get(next(d)); if (m != null) (ml >= goal ? on : off).push(m) }
  if (on.length < MIN_DAYS || off.length < MIN_DAYS) return null
  const diff = Math.round(avg(on) - avg(off))
  if (Math.abs(diff) < 20) return null
  return { id: 'water-sleep', key: diff > 0 ? 'On days you reached your water goal you slept {0} more that night.' : 'On days you reached your water goal you slept {0} less that night.', args: [`${Math.floor(Math.abs(diff) / 60) ? Math.floor(Math.abs(diff) / 60) + 'h' : ''}${Math.abs(diff) % 60} min`], n: on.length + off.length, score: Math.min(1, Math.abs(diff) / 60) }
}

// The weight change of weeks with protein on target most days, against the others.
function proteinAndWeight(S, from, today) {
  const target = Number(S.nutrition?.targets?.p)
  if (!(target > 0) || !moduleOn(S, 'food')) return null
  const ws = S.weekStart
  const pDay = new Map()
  for (const m of list(S.meals)) if (m?.d >= from && m.d <= today) pDay.set(m.d, (pDay.get(m.d) || 0) + list(m.items).reduce((s, x) => s + (Number(x?.p ?? x?.protein) || 0), 0))
  const hit = [], miss = []
  for (let k = weekOf(from, ws); k <= back(weekOf(today, ws), 7); k = back(k, -7)) {
    const ds = Array.from({ length: 7 }, (_, i) => back(k, -i))
    const logged = ds.filter(d => pDay.has(d))
    if (logged.length < 4) continue
    const bw = list(S.bodyweight).filter(e => e?.d >= k && e.d <= ds[6] && Number(e.w) > 0).sort((a, b) => (a.d < b.d ? -1 : 1))
    if (bw.length < 2) continue
    const c = Number(bw.at(-1).w) - Number(bw[0].w)
    ;(logged.filter(d => pDay.get(d) >= target * 0.9).length >= 4 ? hit : miss).push(c)
  }
  if (hit.length < MIN_WEEKS || miss.length < MIN_WEEKS) return null
  const a = avg(hit), b = avg(miss)
  if (Math.abs(a - b) < 0.2) return null
  const unit = S.unit === 'lb' ? 'lb' : 'kg'
  return { id: 'protein-weight', key: 'In weeks with protein on target your weight moved {0} on average, against {1} in the others.', args: [`${a > 0 ? '+' : ''}${r1(a)} ${unit}`, `${b > 0 ? '+' : ''}${r1(b)} ${unit}`], n: hit.length + miss.length, score: Math.min(1, Math.abs(a - b)) }
}

/** The patterns in the last WINDOW_DAYS days up to `today`, strongest first. */
export function insights(S, today) {
  const from = back(today, WINDOW_DAYS - 1)
  return [sleepAndTraining, workoutsAndWeight, sleepAndHabits, waterAndSleep, proteinAndWeight]
    .map(f => f(S, from, today)).filter(Boolean).sort((a, b) => b.score - a.score)
}
