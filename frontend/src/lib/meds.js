// Medications and the doses taken or skipped. Framework-free; the screen (views/Meds.jsx) and the
// server's reminder (api/server.js medTick) read the same shapes.
//
//   S.meds    [{ id, name, dose, unit, times: ['08:00', …], days: null | [0..6], start, end, active, notes, created }]
//             days: the weekdays it is taken (0 = Sunday), null for every day. start/end: ISO days,
//             end null for no end. active false = paused: no doses due, nothing reminded.
//   S.medLog  [{ id, medId, d, time, status: 'taken' | 'skipped', at, extra? }]
//             one entry per dose. A scheduled dose's id is doseId(medId, d, time), so the same
//             dose marked on two devices is one entry (lib/sync-merge.js HEALTH_LISTS). An extra
//             dose ("as needed") has an id of its own and `extra: true`.
import { isoOf, uid } from './format.js'

export const MED_UNITS = ['mg', 'mcg', 'g', 'ml', 'drops', 'pill', 'capsule', 'unit', 'puff']
export const NAME_MAX = 60
export const NOTES_MAX = 200
export const TIMES_MAX = 8
// A dose still counts as on time this long after its time; past it, it is late.
export const LATE_AFTER_MIN = 30

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
const list = v => (Array.isArray(v) ? v : [])
const text = (v, max) => String(v ?? '').trim().slice(0, max)

export const doseId = (medId, d, time) => `${medId}|${d}|${time}`
export const weekdayOf = d => new Date(d + 'T12:00:00Z').getUTCDay()
export const hhmmOf = (date = new Date()) => String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0')
const minutesOf = hhmm => (TIME_RE.test(hhmm || '') ? +hhmm.slice(0, 2) * 60 + +hhmm.slice(3) : NaN)

/** The times of a form, as `HH:MM`, valid, once each, in order of the day. */
export function normalizeTimes(times) {
  return [...new Set(list(times).map(x => String(x || '').trim()).filter(x => TIME_RE.test(x)))].sort().slice(0, TIMES_MAX)
}

/**
 * A medication as stored, from what the form holds. `{ error }` instead when it cannot be one:
 * no name, or an end before its start. Keeps the id (and anything else the entry carries, a
 * `_ts` or `_f` of the sync) of `prev` when editing.
 */
export function normalizeMed(input, { prev = null, today = isoOf(new Date()) } = {}) {
  const name = text(input?.name, NAME_MAX)
  if (!name) return { error: 'name' }
  const days = [...new Set(list(input?.days).map(Number).filter(n => Number.isInteger(n) && n >= 0 && n <= 6))].sort()
  const start = DAY_RE.test(input?.start || '') ? input.start : (prev?.start || today)
  const end = DAY_RE.test(input?.end || '') ? input.end : null
  if (end && end < start) return { error: 'end' }
  const unit = MED_UNITS.includes(input?.unit) ? input.unit : text(input?.unit, 12)
  return {
    ...(prev || {}),
    id: prev?.id || input?.id || uid(),
    name,
    dose: text(input?.dose, 20),
    unit,
    times: normalizeTimes(input?.times),
    // Every weekday chosen is the same as none chosen: taken every day.
    days: days.length && days.length < 7 ? days : null,
    start,
    end,
    active: input?.active !== false,
    notes: text(input?.notes, NOTES_MAX),
    // When it was added: a dose of its first day that was already past then is not missed.
    created: Number(prev?.created) || Date.now()
  }
}

/** Whether `med` has doses due on day `d`: active, within its start and end, on one of its days. */
export function isScheduledOn(med, d) {
  if (!med || med.active === false || !DAY_RE.test(d || '')) return false
  if (med.start && d < med.start) return false
  if (med.end && d > med.end) return false
  return !Array.isArray(med.days) || med.days.includes(weekdayOf(d))
}

/** The state of one dose at `now` ({ d, hhmm }): taken, skipped, late, due (its time has come) or upcoming. */
export function doseState(dose, now) {
  if (dose.entry?.status === 'taken' || dose.entry?.status === 'skipped') return dose.entry.status
  if (dose.d < now.d) return 'late'
  if (dose.d > now.d) return 'upcoming'
  const late = minutesOf(now.hhmm) - minutesOf(dose.time)
  if (late > LATE_AFTER_MIN) return 'late'
  return late >= 0 ? 'due' : 'upcoming'
}

/**
 * Every scheduled dose of day `d`, in the order of the day (then by name): { id, med, d, time,
 * entry } — `entry` the log's record of it, or null. A medication paused or ended still shows the
 * doses it has a record of, so a day's history does not change when it is paused afterwards.
 */
export function dosesOn(meds, log, d) {
  const byId = new Map(list(log).filter(e => e?.id != null).map(e => [e.id, e]))
  const out = []
  for (const med of list(meds)) {
    if (!med?.id) continue
    const scheduled = isScheduledOn(med, d)
    for (const time of normalizeTimes(med.times)) {
      const id = doseId(med.id, d, time)
      const entry = byId.get(id) || null
      if (scheduled || entry) out.push({ id, med, d, time, entry })
    }
  }
  return out.sort((a, b) => a.time.localeCompare(b.time) || a.med.name.localeCompare(b.med.name))
}

/** The extra doses ("as needed") logged on day `d`, oldest first. */
export const extraDosesOn = (log, d) => list(log).filter(e => e?.extra && e.d === d).sort((a, b) => (a.at || 0) - (b.at || 0))

/** `log` with the scheduled dose marked `status` ('taken' | 'skipped'), replacing any earlier mark. */
export function markDose(log, dose, status, at = Date.now()) {
  const rest = list(log).filter(e => e?.id !== dose.id)
  return [...rest, { id: dose.id, medId: dose.med.id, d: dose.d, time: dose.time, status, at }]
}

/** `log` without the entry `id`: a mark undone, an extra dose removed. */
export const unmark = (log, id) => list(log).filter(e => e?.id !== id)

/** `log` with an extra dose of `med` taken at `at`. */
export function logExtraDose(log, med, at = Date.now()) {
  const when = new Date(at)
  return [...list(log), { id: uid(), medId: med.id, d: isoOf(when), time: hhmmOf(when), status: 'taken', at, extra: true }]
}

/**
 * How the doses scheduled from `from` to `to` (ISO days, inclusive) went, as of `now`. A dose
 * still upcoming or due today does not count yet; one past its late mark with no record counts as
 * missed. `pct` is taken over counted, null with nothing counted. `days`: the same per day.
 */
export function adherence(meds, log, from, to, now) {
  const out = { counted: 0, taken: 0, skipped: 0, missed: 0, pct: null, days: [] }
  if (!DAY_RE.test(from || '') || !DAY_RE.test(to || '')) return out
  for (let d = from; d <= to; d = daysBefore(d, -1)) {
    const day = { d, counted: 0, taken: 0, skipped: 0, missed: 0 }
    for (const dose of dosesOn(meds, log, d)) {
      const st = doseState(dose, now)
      if (st === 'taken') day.taken++
      else if (st === 'skipped') day.skipped++
      else if (st === 'late') {
        if (Number(dose.med.created) > new Date(`${d}T${dose.time}:00`).getTime()) continue
        day.missed++
      }
      else continue
      day.counted++
    }
    out.days.push(day)
    out.counted += day.counted; out.taken += day.taken; out.skipped += day.skipped; out.missed += day.missed
  }
  out.pct = out.counted ? Math.round((out.taken / out.counted) * 100) : null
  return out
}

/** The ISO day `n` days before `d`. */
export const daysBefore = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') - n * 86400000).toISOString().slice(0, 10)

/** The record of each medication's doses, newest first: the log entries joined with their medication. */
export function history(meds, log, limit = 200) {
  const byId = new Map(list(meds).filter(m => m?.id).map(m => [m.id, m]))
  return list(log)
    .filter(e => e && e.d && byId.has(e.medId))
    .sort((a, b) => (b.d + b.time).localeCompare(a.d + a.time) || (b.at || 0) - (a.at || 0))
    .slice(0, limit)
    .map(e => ({ ...e, med: byId.get(e.medId) }))
}
