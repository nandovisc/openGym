// The week across the modules (server.js habitTick sends it the first morning of the week; the app
// shows it on Today and in Health → Your week). The app's copy is frontend/src/lib/health-week.js
// the two must agree (frontend/src/lib/health-week-parity.test.js runs both). Change one, change
// the other. Self-contained like habits.js: everything is read straight off the profile.
//
// healthWeek(S, from, to) → { from, to, sleep, training, weight, meds, food, water, habits }, each
// null when its module is off or there is nothing that week:
//   sleep    { nights, avgMin, onGoal, goalMin }
//   training { workouts, minutes, kcal }            kcal: what an Apple Watch measured (w.health)
//   weight   { first, last, change, unit }          the first and last weigh-in of the week
//   meds     { taken, counted, pct }                past doses: taken, or missed (skipped excluded)
//   food     { days, kcal, p, pTarget, lowP }       averages of the days logged; lowP: days under 90%
//   water    { days, avgMl, onGoal, goalMl }        averages of the days logged
//   habits   { done, total, rate }                  habits.js weekSummary
import { weekSummary } from './habits-core.js'

const list = v => (Array.isArray(v) ? v : [])
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/
const next = d => new Date(Date.parse(d + 'T12:00:00Z') + 86400000).toISOString().slice(0, 10)
const back = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') - n * 86400000).toISOString().slice(0, 10)
const days = (from, to) => { const out = []; for (let d = from; d <= to && out.length < 400; d = next(d)) out.push(d); return out; }
const weekdayOf = d => new Date(d + 'T12:00:00Z').getUTCDay()
const r1 = n => Math.round(n * 10) / 10
const FIRST = ['habits', 'food', 'sleep', 'meds', 'exams']
/** Whether module `key` is on (lib/modules.js moduleOn). */
export function moduleOn(S, key) {
  if (key === 'water' && S?.modules?.water === undefined) return FIRST.some(k => S?.modules?.[k] !== false)
  return S?.modules?.[key] !== false
}

function waterGoal(S) {
  const set = Number(S.waterPrefs?.goalMl)
  if (set > 0) return Math.round(set)
  const bw = list(S.bodyweight).filter(e => Number(e?.w) > 0).at(-1)
  if (!bw) return 2000
  const kg = S.unit === 'lb' ? Number(bw.w) * 0.45359237 : Number(bw.w)
  return Math.max(1000, Math.round(kg * 35 / 50) * 50)
}

function sleepWeek(S, from, to) {
  const nights = list(S.sleep).filter(n => n?.d >= from && n.d <= to && Number(n.asleepMin) > 0)
  if (!nights.length) return null
  const goalMin = Number(S.sleepPrefs?.goalMin) > 0 ? Number(S.sleepPrefs.goalMin) : 480
  const avgMin = Math.round(nights.reduce((s, n) => s + Number(n.asleepMin), 0) / nights.length)
  return { nights: nights.length, avgMin, onGoal: nights.filter(n => Number(n.asleepMin) >= goalMin).length, goalMin }
}

function trainingWeek(S, from, to) {
  const ws = list(S.workouts).filter(w => w?.d >= from && w.d <= to)
  const minutes = Math.round(ws.reduce((s, w) => s + (Number(w.end) > Number(w.start) ? (w.end - w.start) / 60000 : 0), 0))
  const kcal = Math.round(ws.reduce((s, w) => s + (Number(w.health?.kcal) > 0 ? Number(w.health.kcal) : 0), 0))
  return { workouts: ws.length, minutes, kcal }
}

function weightWeek(S, from, to) {
  const ws = list(S.bodyweight).filter(e => e?.d >= from && e.d <= to && Number(e.w) > 0).sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0))
  if (!ws.length) return null
  const first = Number(ws[0].w), last = Number(ws.at(-1).w)
  return { first, last, change: ws.length > 1 ? r1(last - first) : null, unit: S.unit === 'lb' ? 'lb' : 'kg' }
}

// Past doses only (the week is over): a dose of a medication active then, at each of its times.
function medsWeek(S, from, to) {
  const log = new Map(list(S.medLog).filter(e => e?.id != null && !e.extra).map(e => [e.id, e.status]))
  let taken = 0, counted = 0
  for (const d of days(from, to)) {
    for (const m of list(S.meds)) {
      if (!m?.id || m.active === false || (m.start && d < m.start) || (m.end && d > m.end)) continue
      if (Array.isArray(m.days) && !m.days.includes(weekdayOf(d))) continue
      for (const t of new Set(list(m.times).filter(x => TIME_RE.test(x || '')))) {
        const st = log.get(`${m.id}|${d}|${t}`)
        if (st === 'skipped') continue
        if (st !== 'taken' && Number(m.created) > Date.parse(`${d}T${t}:00Z`)) continue
        counted++
        if (st === 'taken') taken++
      }
    }
  }
  return counted ? { taken, counted, pct: Math.round((taken / counted) * 100) } : null
}

function foodWeek(S, from, to) {
  const byDay = new Map()
  for (const m of list(S.meals)) {
    if (!(m?.d >= from && m.d <= to) || !list(m.items).length) continue
    const t = byDay.get(m.d) || { kcal: 0, p: 0 }
    for (const x of list(m.items)) { t.kcal += Number(x?.kcal) || 0; t.p += Number(x?.p ?? x?.protein) || 0; }
    byDay.set(m.d, t)
  }
  if (!byDay.size) return null
  const xs = [...byDay.values()]
  const pTarget = Number(S.nutrition?.targets?.p) > 0 ? Number(S.nutrition.targets.p) : null
  return {
    days: xs.length,
    kcal: Math.round(xs.reduce((s, x) => s + x.kcal, 0) / xs.length),
    p: Math.round(xs.reduce((s, x) => s + x.p, 0) / xs.length),
    pTarget,
    lowP: pTarget ? xs.filter(x => x.p < pTarget * 0.9).length : null
  }
}

function waterWeek(S, from, to) {
  const byDay = new Map()
  for (const e of list(S.water)) if (e?.d >= from && e.d <= to && Number(e.ml) > 0) byDay.set(e.d, (byDay.get(e.d) || 0) + Math.round(Number(e.ml)))
  if (!byDay.size) return null
  const goalMl = waterGoal(S), xs = [...byDay.values()]
  return { days: xs.length, avgMl: Math.round(xs.reduce((s, x) => s + x, 0) / xs.length), onGoal: xs.filter(x => x >= goalMl).length, goalMl }
}

/** The week from `from` to `to` (ISO days) across the modules on. */
export function healthWeek(S, from, to) {
  if (!DAY_RE.test(from || '') || !DAY_RE.test(to || '') || from > to) return null
  const hs = moduleOn(S, 'habits') ? weekSummary(S, from, to) : null
  return {
    from, to,
    sleep: moduleOn(S, 'sleep') ? sleepWeek(S, from, to) : null,
    training: trainingWeek(S, from, to),
    weight: weightWeek(S, from, to),
    meds: moduleOn(S, 'meds') ? medsWeek(S, from, to) : null,
    food: moduleOn(S, 'food') ? foodWeek(S, from, to) : null,
    water: moduleOn(S, 'water') ? waterWeek(S, from, to) : null,
    habits: hs && hs.total ? { done: hs.done, total: hs.total, rate: hs.rate } : null
  }
}

/** The first day of the week holding `d` (weekStart 0 = Sunday, otherwise Monday). */
export function weekOf(d, weekStart) {
  const wd = weekdayOf(d), ws = weekStart === 0 ? 0 : 1
  return back(d, (wd - ws + 7) % 7)
}

/**
 * The last full week before the one holding `today`, and the week before it: { week, previous }.
 * What the recap on the first morning of the week tells.
 */
export function lastWeeks(S, today) {
  const start = weekOf(today, S?.weekStart)
  const from = back(start, 7), to = back(start, 1)
  return { week: healthWeek(S, from, to), previous: healthWeek(S, back(from, 7), back(from, 1)) }
}

/** Whether a week has anything to tell. */
export const hasNews = w => !!w && ['sleep', 'weight', 'meds', 'food', 'water', 'habits'].some(k => w[k]) || (w?.training?.workouts > 0)
