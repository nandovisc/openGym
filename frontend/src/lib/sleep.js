// Sleep: the nights, logged by hand or sent from Apple Health (an iPhone Shortcut → api/sleep.js,
// or the export.xml import → lib/sleep-samples.js). Framework-free; the screen is views/Sleep.jsx.
//
//   S.sleep       [{ id, d, bed, wake, asleepMin, inBedMin, stages, src, source, quality?, note?, edited?, created }]
//                 d: the day woken up on. bed/wake: the wall clock, 'YYYY-MM-DDTHH:MM'. stages:
//                 { deep, rem, core, awake } in minutes, null when the device did not say.
//                 src: 'health' (id 'hk:' + d, so a night sent again replaces itself) or 'manual'.
//                 edited: a Health night the person changed, which Health no longer overwrites.
//   S.sleepPrefs  { goalMin }
import { uid } from './format.js'

export const GOAL_DEFAULT = 480
export const NOTE_MAX = 200
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/
const list = v => (Array.isArray(v) ? v : [])

const wallMs = local => Date.parse(local + ':00Z')
const addDays = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10)
/** Minutes past midnight of a 'YYYY-MM-DDTHH:MM'. */
export const clockMin = local => +local.slice(11, 13) * 60 + +local.slice(14, 16)
export const hhmm = min => { const m = ((Math.round(min) % 1440) + 1440) % 1440; return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0') }
export const goalOf = S => (S?.sleepPrefs?.goalMin > 0 ? S.sleepPrefs.goalMin : GOAL_DEFAULT)

/**
 * A night as stored from the form: woke up on `d`, went to bed at `bed` and got up at `wake`
 * ('HH:MM'); a bedtime later in the clock than the wake time was the evening before. `{ error }`
 * when it cannot be a night. Editing a night from Health marks it `edited`; changing its times
 * drops its stages, which no longer describe it.
 */
export function normalizeNight(input, { prev = null, now = Date.now() } = {}) {
  const d = String(input?.d || '')
  if (!DAY_RE.test(d)) return { error: 'day' }
  if (!TIME_RE.test(input?.bed || '') || !TIME_RE.test(input?.wake || '')) return { error: 'time' }
  const bedDay = input.bed < input.wake ? d : addDays(d, -1)
  const bed = `${bedDay}T${input.bed}`, wake = `${d}T${input.wake}`
  const len = Math.round((wallMs(wake) - wallMs(bed)) / 60000)
  if (!(len > 0) || len > 20 * 60) return { error: 'length' }
  const q = Math.round(+input.quality)
  const quality = q >= 1 && q <= 5 ? q : null
  const note = String(input.note ?? '').trim().slice(0, NOTE_MAX)
  const same = prev && prev.bed === bed && prev.wake === wake
  if (prev && prev.src === 'health') {
    return { ...prev, d, bed, wake, quality, note, edited: true,
      ...(same ? {} : { asleepMin: len, inBedMin: len, stages: null }), ...(prev.d !== d ? { id: uid(), src: 'manual' } : {}) }
  }
  return { ...(prev || {}), id: prev?.id || uid(), d, bed, wake, asleepMin: same ? prev.asleepMin : len, inBedMin: len,
    stages: same ? prev.stages ?? null : null, src: 'manual', source: '', quality, note, created: prev?.created || now }
}

/** Nights in order of the day, newest first. */
export const byDay = sleep => list(sleep).filter(x => x && DAY_RE.test(x.d || '')).sort((a, b) => (a.d < b.d ? 1 : a.d > b.d ? -1 : 0))
export const lastNight = sleep => byDay(sleep)[0] || null
export const nightOn = (sleep, d) => list(sleep).find(x => x && x.d === d) || null

/** [{ d, min }] for each day from `from` to `to`, min null on a day without a night. */
export function dailySeries(sleep, from, to) {
  const by = new Map(list(sleep).filter(x => x?.d).map(x => [x.d, x]))
  const out = []
  for (let d = from; d <= to; d = addDays(d, 1)) out.push({ d, min: by.has(d) ? by.get(d).asleepMin ?? null : null })
  return out
}

// A bedtime after noon is that evening, before noon the small hours of the next day: on one line
// from noon to noon, so 23:30 and 00:30 average to midnight and not to noon.
const bedLine = local => { const m = clockMin(local); return m < 720 ? m + 1440 : m }

/**
 * Over the nights from `from` to `to`: { nights, avgMin, avgBed, avgWake, spreadMin, goalHit }.
 * avgBed/avgWake 'HH:MM'; spreadMin how far bedtimes stray from their average (standard
 * deviation, minutes), the regularity. null when there is no night.
 */
export function summary(sleep, from, to, goalMin = GOAL_DEFAULT) {
  const xs = list(sleep).filter(x => x && x.d >= from && x.d <= to && x.asleepMin > 0)
  if (!xs.length) return null
  const mean = a => a.reduce((s, v) => s + v, 0) / a.length
  const beds = xs.map(x => bedLine(x.bed))
  const mb = mean(beds)
  return {
    nights: xs.length,
    avgMin: Math.round(mean(xs.map(x => x.asleepMin))),
    avgBed: hhmm(mb),
    avgWake: hhmm(mean(xs.map(x => clockMin(x.wake)))),
    spreadMin: Math.round(Math.sqrt(mean(beds.map(b => (b - mb) ** 2)))),
    goalHit: xs.filter(x => x.asleepMin >= goalMin).length
  }
}

/** Share of each stage in a night's staged time, for the bar: [{ k, min, pct }]. */
export function stageShares(stages) {
  if (!stages) return []
  const ks = ['deep', 'core', 'rem', 'awake']
  const total = ks.reduce((s, k) => s + (stages[k] || 0), 0)
  return total > 0 ? ks.filter(k => stages[k] > 0).map(k => ({ k, min: stages[k], pct: (stages[k] / total) * 100 })) : []
}
