// The report for a doctor's or a dietitian's appointment (Health → Report, views/HealthReport.jsx):
// what the modules hold over a period, put together to be printed or saved as a PDF. The screen
// only draws what this returns.
//
// healthReport(S, { months, today, now }) → { from, to, person, meds, exams, weight, sleep, food,
//   water, training } — a section null when its module is off or it has nothing in the period.
import { adherence } from './meds.js'
import { analytes, examsByDate, seriesOf } from './exams.js'
import { summary as sleepSummary, goalOf as sleepGoal } from './sleep.js'
import { dayTotal, goalOf as waterGoal } from './water.js'
import { moduleOn } from './modules.js'

const list = v => (Array.isArray(v) ? v : [])
const back = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') - n * 86400000).toISOString().slice(0, 10)
const r1 = n => Math.round(n * 10) / 10
const OUT = new Set(['low', 'high', 'abnormal'])

/** The first day of a period of `months` months ending `today`. */
export function periodFrom(today, months) {
  const [y, m, d] = today.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1 - months, d, 12))
  return back(dt.toISOString().slice(0, 10), -1)
}

function person(S, user, today) {
  const n = S.nutrition || {}
  const age = Number(n.birthYear) > 1900 ? Number(today.slice(0, 4)) - Number(n.birthYear) : null
  return { name: user?.name || '', age, heightCm: Number(n.heightCm) > 0 ? Number(n.heightCm) : null }
}

function medsSection(S, from, to, now) {
  const meds = list(S.meds).filter(m => m?.id && m.active !== false && (!m.end || m.end >= from))
  if (!meds.length) return null
  const rows = meds.map(m => {
    const a = adherence([m], S.medLog, from, to, now)
    return { name: m.name, dose: [m.dose, m.unit].filter(Boolean).join(' '), times: list(m.times), days: Array.isArray(m.days) ? m.days : null, since: m.start || null, notes: m.notes || '', taken: a.taken, counted: a.counted, pct: a.pct }
  })
  const all = adherence(meds, S.medLog, from, to, now)
  return { rows, pct: all.pct, taken: all.taken, counted: all.counted }
}

function examsSection(S, from, to) {
  const inPeriod = examsByDate(S.exams).filter(e => e.d >= from && e.d <= to)
  if (!inPeriod.length) return null
  // Every marker measured in the period, its latest value; the ones out of range first, each with
  // its values over the period.
  const all = analytes(inPeriod)
  const rows = all.map(a => ({ key: a.key, name: a.name, unit: a.unit, value: a.last.valueText || (a.last.value ?? ''), d: a.last.d, flag: a.last.flag, refLow: a.last.refLow, refHigh: a.last.refHigh, out: OUT.has(a.last.flag) }))
  rows.sort((a, b) => (b.out - a.out) || 0)
  const trends = rows.filter(r => r.out).map(r => ({ key: r.key, name: r.name, ...seriesOf(examsByDate(S.exams).filter(e => e.d <= to), r.key) })).filter(x => x.points.length > 1)
  return { count: inPeriod.length, dates: inPeriod.map(e => e.d), rows, outCount: rows.filter(r => r.out).length, trends }
}

function weightSection(S, from, to) {
  const ws = list(S.bodyweight).filter(e => e?.d >= from && e.d <= to && Number(e.w) > 0).sort((a, b) => (a.d < b.d ? -1 : 1))
  if (!ws.length) return null
  const ys = ws.map(e => Number(e.w))
  return { unit: S.unit === 'lb' ? 'lb' : 'kg', first: ys[0], last: ys.at(-1), change: r1(ys.at(-1) - ys[0]), min: Math.min(...ys), max: Math.max(...ys), count: ws.length, points: ws.map(e => ({ t: Date.parse(e.d + 'T12:00:00'), y: Number(e.w), d: e.d })) }
}

function foodSection(S, from, to) {
  const byDay = new Map()
  for (const m of list(S.meals)) {
    if (!(m?.d >= from && m.d <= to) || !list(m.items).length) continue
    const t = byDay.get(m.d) || { kcal: 0, p: 0, c: 0, f: 0 }
    for (const x of list(m.items)) { t.kcal += Number(x?.kcal) || 0; t.p += Number(x?.p ?? x?.protein) || 0; t.c += Number(x?.c ?? x?.carbs) || 0; t.f += Number(x?.f ?? x?.fat) || 0 }
    byDay.set(m.d, t)
  }
  if (!byDay.size) return null
  const xs = [...byDay.values()], mean = k => Math.round(xs.reduce((s, x) => s + x[k], 0) / xs.length)
  return { days: byDay.size, kcal: mean('kcal'), p: mean('p'), c: mean('c'), f: mean('f'), targets: S.nutrition?.targets || null }
}

function waterSection(S, from, to) {
  const ds = [...new Set(list(S.water).filter(e => e?.d >= from && e.d <= to).map(e => e.d))]
  if (!ds.length) return null
  const goal = waterGoal(S), totals = ds.map(d => dayTotal(S, d))
  return { days: ds.length, avgMl: Math.round(totals.reduce((s, x) => s + x, 0) / totals.length), onGoal: totals.filter(x => x >= goal).length, goalMl: goal }
}

function trainingSection(S, from, to) {
  const ws = list(S.workouts).filter(w => w?.d >= from && w.d <= to)
  if (!ws.length) return null
  const weeks = Math.max(1, Math.round((Date.parse(to) - Date.parse(from)) / (7 * 86400000)))
  return { workouts: ws.length, perWeek: r1(ws.length / weeks), kcal: Math.round(ws.reduce((s, w) => s + (Number(w.health?.kcal) || 0), 0)) }
}

/** The report over the `months` months up to `today`. */
export function healthReport(S, { months = 3, today, now, user = null } = {}) {
  const to = today, from = periodFrom(today, months)
  const nowAt = now || { d: today, hhmm: '23:59' }
  const sleep = moduleOn(S, 'sleep') ? sleepSummary(S.sleep, from, to, sleepGoal(S)) : null
  return {
    from, to, months,
    person: person(S, user, today),
    meds: moduleOn(S, 'meds') ? medsSection(S, from, to, nowAt) : null,
    exams: moduleOn(S, 'exams') ? examsSection(S, from, to) : null,
    weight: weightSection(S, from, to),
    sleep: sleep ? { ...sleep, goalMin: sleepGoal(S) } : null,
    food: moduleOn(S, 'food') ? foodSection(S, from, to) : null,
    water: moduleOn(S, 'water') ? waterSection(S, from, to) : null,
    training: trainingSection(S, from, to)
  }
}
