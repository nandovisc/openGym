// What an Apple Watch measured during a workout (w.health, written by POST /api/workouts/ingest:
// api/workouts-ingest.js) and the workouts that came from the watch alone (src 'health', no
// exercises), as the history, the workout sheet and Today show them.
import { fmtNum } from './format.js'
import { t } from './i18n.js'

/** Whether `w` is a workout the watch sent with nothing logged in openGym. */
export const watchOnly = w => w?.src === 'health' && !(w.entries || []).length

/** "410 kcal", "avg HR 132", "max 168" for what is there; [] when the watch measured nothing. */
export function healthParts(w) {
  const h = w?.health
  if (!h || typeof h !== 'object') return []
  const out = []
  if (Number(h.kcal) > 0) out.push(t('{0} kcal', fmtNum(Math.round(h.kcal))))
  if (Number(h.avgHr) > 0) out.push(t('avg HR {0}', Math.round(h.avgHr)))
  if (Number(h.maxHr) > 0) out.push(t('max {0}', Math.round(h.maxHr)))
  return out
}

/** Active calories of the workouts of day `d` that the watch measured, or 0. */
export function kcalOn(workouts, d) {
  return (Array.isArray(workouts) ? workouts : []).reduce((n, w) => n + (w?.d === d && Number(w.health?.kcal) > 0 ? Math.round(w.health.kcal) : 0), 0)
}
