// The progress photos of a weigh-in: the list on the record (add, remove, pose, cap, stamp), what
// the media system counts as referenced, what the sync merge keeps, and the weight a before/after
// shows beside each photo.
import { describe, expect, it } from 'vitest'
import { addBwPhoto, removeBwPhoto, setBwPhotoPose, bwPhotosOf, hasBwPhoto, weightOn, compareSummary, BW_PHOTOS_MAX } from './bodyweight-photos.js'
import { referencedHashes, referencedFiles } from './media-refs.js'
import { mergeStates } from './sync-merge.js'
import { bwTime, bwChartPoint } from './bodyweight.js'

const H = n => String(n).repeat(64).slice(0, 64)
const photo = (h, poster) => ({ kind: 'image', hash: h, mime: 'image/webp', size: 1000, width: 800, height: 1000, ...(poster ? { poster: { hash: poster, mime: 'image/webp', size: 100, width: 320, height: 400 } } : {}), at: 1 })
const clip = h => ({ kind: 'video', hash: h, mime: 'video/mp4', size: 500000, width: 720, height: 1280, dur: 8, codec: 'avc1', at: 2 })
const state = (...bw) => ({ unit: 'kg', workouts: [], routines: [], customEx: [], exWeights: {}, bodyweight: bw, active: null })

describe('addBwPhoto / removeBwPhoto / setBwPhotoPose', () => {
  it('adds a normalised ref with its pose and stamps the weigh-in', () => {
    const S = state({ d: '2026-10-01', w: 82, t: 5 })
    expect(addBwPhoto(S, '2026-10-01', { ...photo(H(1)), name: 'IMG.HEIC' }, 'front', 900)).toBe('added')
    expect(S.bodyweight[0].photos).toEqual([{ pose: 'front', m: photo(H(1)) }])
    expect(S.bodyweight[0].t).toBe(900)
    expect(S.bodyweight[0].w).toBe(82)
  })

  it('keeps an unknown pose as none', () => {
    const S = state({ d: '2026-10-01', w: 82, t: 5 })
    addBwPhoto(S, '2026-10-01', photo(H(1)), 'upside-down', 9)
    expect(S.bodyweight[0].photos[0].pose).toBe(null)
  })

  it('says why not: no weigh-in, not a still, the same file, full', () => {
    const S = state({ d: '2026-10-01', w: 82, t: 5 })
    expect(addBwPhoto(S, '2026-10-02', photo(H(1)), 'front')).toBe('gone')
    expect(addBwPhoto(S, '2026-10-01', clip(H(1)), 'front')).toBe('invalid')
    expect(addBwPhoto(S, '2026-10-01', { hash: 'nope' }, 'front')).toBe('invalid')
    expect(addBwPhoto(S, '2026-10-01', photo(H(1)), 'front')).toBe('added')
    expect(addBwPhoto(S, '2026-10-01', photo(H(1)), 'back')).toBe('dup')
    for (let i = 2; i <= BW_PHOTOS_MAX; i++) expect(addBwPhoto(S, '2026-10-01', photo(H(i)), 'side')).toBe('added')
    expect(addBwPhoto(S, '2026-10-01', photo('a'.repeat(64)), 'side')).toBe('full')
    expect(S.bodyweight[0].t).not.toBe(5)
  })

  it('removes one file, drops the empty list and stamps only on a change', () => {
    const S = state({ d: '2026-10-01', w: 82, t: 5, photos: [{ pose: 'front', m: photo(H(1)) }] })
    expect(removeBwPhoto(S, '2026-10-01', H(2), 7)).toBe(false)
    expect(S.bodyweight[0].t).toBe(5)
    expect(removeBwPhoto(S, '2026-10-01', H(1), 8)).toBe(true)
    expect(S.bodyweight[0]).toEqual({ d: '2026-10-01', w: 82, t: 8 })
  })

  it('leaves an entry this version cannot read on the record', () => {
    const odd = { pose: 'front', m: { kind: 'hologram', hash: H(9) } }
    const S = state({ d: '2026-10-01', w: 82, t: 5, photos: [odd, { pose: 'side', m: photo(H(1)) }] })
    removeBwPhoto(S, '2026-10-01', H(1), 6)
    expect(S.bodyweight[0].photos).toEqual([odd])
  })

  it('changes a pose', () => {
    const S = state({ d: '2026-10-01', w: 82, t: 5, photos: [{ pose: 'front', m: photo(H(1)) }] })
    expect(setBwPhotoPose(S, '2026-10-01', H(1), 'front', 6)).toBe(false)
    expect(setBwPhotoPose(S, '2026-10-01', H(1), 'back', 7)).toBe(true)
    expect(S.bodyweight[0].photos[0].pose).toBe('back')
    expect(S.bodyweight[0].t).toBe(7)
  })
})

describe('bwPhotosOf', () => {
  it('shows stills only, once per file, and nothing for junk', () => {
    const e = { d: 'x', photos: [null, 3, { pose: 'side', m: photo(H(1)) }, { pose: 'front', m: photo(H(1)) }, { pose: 'back', m: clip(H(2)) }, { m: photo(H(3)) }] }
    expect(bwPhotosOf(e)).toEqual([{ pose: 'side', m: photo(H(1)) }, { pose: null, m: photo(H(3)) }])
    expect(bwPhotosOf({ photos: 'nope' })).toEqual([])
    expect(bwPhotosOf(null)).toEqual([])
    expect(hasBwPhoto(e)).toBe(true)
    expect(hasBwPhoto({ d: 'x' })).toBe(false)
  })
})

describe('the media system sees weigh-in photos', () => {
  it('counts each photo and its poster as referenced, so neither GC sweeps them', () => {
    const S = state({ d: '2026-10-01', w: 82, t: 5, photos: [{ pose: 'front', m: photo(H(1), H(2)) }] })
    expect([...referencedHashes(S)].sort()).toEqual([H(1), H(2)])
    expect(referencedFiles(S).map(f => f.hash)).toEqual([H(2), H(1)])
  })

  it('keeps the photo added on one device when the other only has the bare weigh-in', () => {
    const base = { d: '2026-10-01', w: 82, t: 5 }
    const phone = state({ ...base, t: 9, photos: [{ pose: 'front', m: photo(H(1)) }] })
    const desk = state({ ...base })
    const merged = mergeStates(desk, phone)
    expect(merged.bodyweight.find(e => e.d === '2026-10-01').photos).toEqual([{ pose: 'front', m: photo(H(1)) }])
  })
})

describe('bwTime / bwChartPoint', () => {
  it('keeps a weigh-in on its own day after a later edit moved its stamp', () => {
    const at7 = new Date(2026, 6, 12, 7, 30).getTime()
    expect(bwTime({ d: '2026-07-12', w: 86, t: at7 })).toBe(at7)
    const weekOn = new Date(2026, 6, 19, 21, 0).getTime()
    expect(bwTime({ d: '2026-07-12', w: 86, t: weekOn })).toBe(Date.parse('2026-07-12T12:00:00'))
    expect(bwTime({ d: '2026-07-12', w: 86 })).toBe(Date.parse('2026-07-12T12:00:00'))
  })

  it('rings the point of a weigh-in with a photo', () => {
    expect(bwChartPoint({ d: '2026-07-12', w: 86, t: 0 }).photo).toBe(undefined)
    expect(bwChartPoint({ d: '2026-07-12', w: 86, t: 0, photos: [{ pose: 'front', m: photo(H(1)) }] }).photo).toBe(true)
  })
})

describe('weightOn / compareSummary', () => {
  const S = {
    bodyweight: [{ d: '2026-07-12', w: 86.2, t: 1 }, { d: '2026-10-23', w: 81.4, t: 2 }],
    workouts: [{ d: '2026-08-01', bw: 84.5 }, { d: '2026-10-23', bw: 99 }]
  }

  it('takes the weigh-in of the day, then a workout\'s logged body weight, never a neighbour', () => {
    expect(weightOn(S, '2026-10-23')).toBe(81.4)
    expect(weightOn(S, '2026-08-01')).toBe(84.5)
    expect(weightOn(S, '2026-07-13')).toBe(null)
  })

  it('orders the two days and rounds the change to one decimal', () => {
    expect(compareSummary(S, '2026-10-23', '2026-07-12')).toEqual({ from: '2026-07-12', to: '2026-10-23', days: 103, wFrom: 86.2, wTo: 81.4, delta: -4.8 })
    expect(compareSummary(S, '2026-07-12', '2026-07-13').delta).toBe(null)
  })
})
