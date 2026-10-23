// Weigh-ins read back week by week (Discord 'Weight'). From one morning to the next, body weight
// moves with water, salt and the last meal by more than it moves in a month, so the number worth
// following is the week's mean — the one a single weigh-in on the card cannot give you.
import { weekKey, isoOf } from './format.js'
import { hasBwPhoto } from './bodyweight-photos.js'

/**
 * When a weigh-in sits on a time axis. `t` is the entry's edit stamp: it is the moment of the
 * weigh-in for one logged and left alone, but a later edit (a photo added a week on) moves it, and
 * the point must not move with it. So `t` counts only while it falls on the entry's own day;
 * otherwise the day's noon.
 */
export function bwTime(b) {
  const noon = Date.parse(b.d + 'T12:00:00')
  const t = Number(b.t)
  return t > 0 && isoOf(new Date(t)) === b.d ? t : noon
}

/** A weigh-in as a LineChart point, ringed when it has a progress photo. */
export const bwChartPoint = b => ({ t: bwTime(b), y: b.w, d: b.d, ...(hasBwPhoto(b) ? { photo: true } : {}) })

/**
 * The weigh-ins grouped into weeks, newest week first. Each week carries its mean, how many
 * weigh-ins it holds, the change of its mean from the week before it that has any (null for the
 * first), and its entries newest first. `ws` is the first day of the week (weekStartOf), so the
 * weeks are the ones the calendar and the week strip show. The stored order is not relied on,
 * and an entry with no day or no weight is skipped rather than averaged in as 0.
 * Returns [{ key, avg, n, delta, entries }], `key` being the iso date the week starts on.
 */
export function weeklyWeights(bodyweight, ws) {
  const byWeek = new Map()
  for (const b of Array.isArray(bodyweight) ? bodyweight : []) {
    if (!b?.d || !(Number(b.w) > 0)) continue
    const key = weekKey(b.d, ws)
    if (!byWeek.has(key)) byWeek.set(key, [])
    byWeek.get(key).push(b)
  }
  const weeks = [...byWeek.keys()].sort().map(key => {
    const entries = byWeek.get(key).slice().sort((a, b) => (a.d < b.d ? 1 : a.d > b.d ? -1 : 0))
    return { key, n: entries.length, avg: entries.reduce((sum, b) => sum + Number(b.w), 0) / entries.length, entries }
  })
  weeks.forEach((week, i) => { week.delta = i ? week.avg - weeks[i - 1].avg : null })
  return weeks.reverse()
}
