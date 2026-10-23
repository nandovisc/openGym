// The progress photos of a weigh-in: a front, side or back shot kept with the day's weight, so a
// before/after can say how much the scale moved between the two pictures.
//
//   S.bodyweight[i].photos = [{ pose: 'front'|'side'|'back'|null, m: MediaRef }]
//
// The pose sits beside the MediaRef, not inside it: normalizeMediaRef rebuilds a ref from its
// known fields only, so a `pose` on the ref would be dropped by the first reader. Everything else
// is the media system as it stands (lib/media-refs.js) — the same ingest, local store, sync and
// GC, which is why stateMediaRefs and api/media.js referencedHashes walk bodyweight[].photos[].m.
//
// Each edit stamps the weigh-in (`t`), the way a corrected weight does: the sync keeps the copy of
// a day edited last (lib/sync-merge.js), so a photo added on the phone is not lost to the desktop's
// copy. And, like lib/workout-media.js, both edits work on the list as it stands on the record —
// an entry this version cannot read stays there for the one that can.
import { normalizeMediaRef } from './media-refs.js'

export const POSES = ['front', 'side', 'back']
export const BW_PHOTOS_MAX = 6

const list = v => (Array.isArray(v) ? v : [])
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v)
const recordOf = (state, d) => list(state?.bodyweight).find(x => isObj(x) && x.d === d) || null

/**
 * The photos of one weigh-in as they can be shown: stills only, each a { pose, m } with a ref
 * normalizeMediaRef accepts and a pose from POSES (anything else reads as no pose), one per file,
 * at most BW_PHOTOS_MAX.
 */
export function bwPhotosOf(entry) {
  const out = []
  const seen = new Set()
  for (const p of list(entry?.photos)) {
    if (!isObj(p)) continue
    const m = normalizeMediaRef(p.m)
    if (!m || m.kind === 'video' || m.kind === 'doc' || seen.has(m.hash)) continue
    seen.add(m.hash)
    out.push({ pose: POSES.includes(p.pose) ? p.pose : null, m })
    if (out.length >= BW_PHOTOS_MAX) break
  }
  return out
}

/** Whether the weigh-in has a photo to show — the dot on the weight curve. */
export const hasBwPhoto = entry => bwPhotosOf(entry).length > 0

function write(rec, raw, now) {
  if (raw.length) rec.photos = raw
  else delete rec.photos
  rec.t = now
}

/**
 * Adds the still `ref` with `pose` to the weigh-in of day `d` inside `state`. Returns 'added', or
 * why not: 'gone' (no weigh-in that day any more), 'invalid' (not a still normalizeMediaRef
 * accepts), 'dup' (that very file is already on it) or 'full' (already shows BW_PHOTOS_MAX).
 * Mutates `state` — made for useStore's update().
 */
export function addBwPhoto(state, d, ref, pose, now = Date.now()) {
  const rec = recordOf(state, d)
  if (!rec) return 'gone'
  const m = normalizeMediaRef(ref)
  if (!m || m.kind === 'video' || m.kind === 'doc') return 'invalid'
  const raw = list(rec.photos)
  if (raw.some(p => isObj(p) && p.m?.hash === m.hash)) return 'dup'
  if (bwPhotosOf(rec).length >= BW_PHOTOS_MAX) return 'full'
  write(rec, [...raw, { pose: POSES.includes(pose) ? pose : null, m }], now)
  return 'added'
}

/** Takes the file `hash` off the weigh-in of day `d`. Returns whether anything changed. */
export function removeBwPhoto(state, d, hash, now = Date.now()) {
  const rec = recordOf(state, d)
  if (!rec) return false
  const raw = list(rec.photos)
  const left = raw.filter(p => !(isObj(p) && p.m?.hash === hash))
  if (left.length === raw.length) return false
  write(rec, left, now)
  return true
}

/** Gives the photo `hash` of day `d` the pose `pose` (null for none). Returns whether it changed. */
export function setBwPhotoPose(state, d, hash, pose, now = Date.now()) {
  const rec = recordOf(state, d)
  if (!rec) return false
  const want = POSES.includes(pose) ? pose : null
  let changed = false
  const raw = list(rec.photos).map(p => {
    if (!isObj(p) || p.m?.hash !== hash || (p.pose ?? null) === want) return p
    changed = true
    return { ...p, pose: want }
  })
  if (changed) write(rec, raw, now)
  return changed
}

/**
 * The weight to show beside a photo taken on day `d`: that day's weigh-in, else the body weight a
 * workout of that day logged (`bw`), else null. Never a neighbouring day's: a before/after says
 * how much the scale moved between the two pictures, and a weight from days away is not that.
 */
export function weightOn(S, d) {
  const e = list(S?.bodyweight).find(x => isObj(x) && x.d === d && Number(x.w) > 0)
  if (e) return Number(e.w)
  const w = list(S?.workouts).find(x => isObj(x) && x.d === d && Number(x.bw) > 0)
  return w ? Number(w.bw) : null
}

/**
 * What a before/after between days `a` and `b` says: the days between them and each day's weight,
 * with the change from the earlier to the later (null when either weight is unknown), in that
 * order whichever comes first.
 */
export function compareSummary(S, a, b) {
  const [from, to] = a <= b ? [a, b] : [b, a]
  const days = Math.abs(Math.round((new Date(to + 'T00:00:00') - new Date(from + 'T00:00:00')) / 86400000))
  const wFrom = weightOn(S, from)
  const wTo = weightOn(S, to)
  const delta = wFrom != null && wTo != null ? Math.round((wTo - wFrom) * 10) / 10 : null
  return { from, to, days, wFrom, wTo, delta }
}
