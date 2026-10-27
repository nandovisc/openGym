// A student's physical assessment (the Personal module, phase 8): skinfolds (Jackson & Pollock,
// 3 or 7 sites), circumferences, a bioimpedance scale's readings, flexibility and photos, taken by
// the trainer on a day and kept in the trainer's own profile, synced like any list of theirs.
//
//   S.assessments [{ id, recordId, d, sex, age, height, weight, protocol, folds, circ, bio, flex,
//                    photos, note, created, _ts }]
//     sex: 'm' | 'f' (the equations differ); age in years on the day; height in cm; weight in kg.
//     protocol: 'p3' | 'p7' | null — folds: { chest, midaxillary, triceps, subscapular, abdomen,
//       suprailiac, thigh } in mm, only the sites measured.
//     circ: { neck, shoulders, … } in cm. bio: { fat %, muscle kg, water %, visceral (level),
//       bmr kcal }. flex: { sitReach cm } (Wells' bench).
//     photos: [{ pose, m }], the same shape as a weigh-in's (lib/bodyweight-photos.js), so the
//       media system keeps, syncs and sweeps them the same way (media-refs.js walks them).
import { normalizeMediaRef } from './media-refs.js'
import { bwPhotosOf, BW_PHOTOS_MAX, POSES } from './bodyweight-photos.js'
import { uid } from './format.js'

const list = v => (Array.isArray(v) ? v : [])
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v)
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
const r1 = n => Math.round(n * 10) / 10
const r2 = n => Math.round(n * 100) / 100

export const FOLDS = ['chest', 'midaxillary', 'triceps', 'subscapular', 'abdomen', 'suprailiac', 'thigh']
export const CIRC = ['neck', 'shoulders', 'chest', 'waist', 'abdomen', 'hips', 'armR', 'armL', 'armFlexR', 'armFlexL', 'forearmR', 'forearmL', 'thighR', 'thighL', 'calfR', 'calfL']
export const BIO = ['fat', 'muscle', 'water', 'visceral', 'bmr']
export const FLEX = ['sitReach']
export const PROTOCOLS = ['p3', 'p7']

// What a plausible reading is, so a typo (180 mm of skinfold) is left out rather than kept.
const RANGE = { fold: [1, 90], circ: [5, 250], fat: [2, 75], muscle: [5, 150], water: [20, 80], visceral: [1, 60], bmr: [500, 6000], sitReach: [-40, 80], height: [80, 240], weight: [15, 350], age: [5, 110] }
const num = (v, [lo, hi]) => {
  if (v === '' || v == null) return null
  const n = Number(String(v).replace(',', '.'))
  return Number.isFinite(n) && n >= lo && n <= hi ? r1(n) : null
}
const pick = (raw, keys, range) => {
  const out = {}
  for (const k of keys) { const v = num(raw?.[k], typeof range === 'function' ? range(k) : range); if (v != null) out[k] = v }
  return out
}

/** The sites a protocol measures: Pollock 3 differs between men and women; 7 is the same. */
export function foldSites(protocol, sex) {
  if (protocol === 'p7') return FOLDS
  if (protocol === 'p3') return sex === 'f' ? ['triceps', 'suprailiac', 'thigh'] : ['chest', 'abdomen', 'thigh']
  return []
}

/** Age in whole years on day `d` of someone born on `birth` (both 'YYYY-MM-DD'); null unknown. */
export function ageOn(birth, d) {
  if (!DAY_RE.test(birth || '') || !DAY_RE.test(d || '')) return null
  const [by, bm, bd] = birth.split('-').map(Number)
  const [y, m, dd] = d.split('-').map(Number)
  const age = y - by - (m < bm || (m === bm && dd < bd) ? 1 : 0)
  return age >= 0 ? age : null
}

/** An assessment as stored, from the form; { error } without a student or a day. */
export function normalizeAssessment(input, { prev = null, now = Date.now() } = {}) {
  if (!input?.recordId) return { error: 'student' }
  if (!DAY_RE.test(input?.d || '')) return { error: 'day' }
  const sex = input.sex === 'f' ? 'f' : input.sex === 'm' ? 'm' : null
  const protocol = PROTOCOLS.includes(input.protocol) ? input.protocol : null
  return {
    ...(prev || {}),
    id: prev?.id || input.id || uid(),
    recordId: String(input.recordId),
    d: input.d,
    sex,
    age: num(input.age, RANGE.age) == null ? null : Math.round(num(input.age, RANGE.age)),
    height: num(input.height, RANGE.height),
    weight: num(input.weight, RANGE.weight),
    protocol,
    folds: pick(input.folds, FOLDS, RANGE.fold),
    circ: pick(input.circ, CIRC, RANGE.circ),
    bio: pick(input.bio, BIO, k => RANGE[k]),
    flex: pick(input.flex, FLEX, k => RANGE[k]),
    note: String(input.note ?? '').replace(/\r/g, '').trim().slice(0, 1000),
    created: prev?.created || now
  }
}
export const addAssessment = (list_, a) => [...list(list_).filter(x => x?.id !== a.id), a]
export const removeAssessment = (list_, id) => list(list_).filter(x => x?.id !== id)

/** A student's assessments, oldest first. */
export const assessmentsOf = (S, recordId) => list(S?.assessments).filter(a => a && a.recordId === recordId && DAY_RE.test(a.d || ''))
  .sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : (a.created || 0) - (b.created || 0)))

// Body density from the sum of skinfolds (Jackson & Pollock 1978, 1980), then fat by Siri (1961).
const DENSITY = {
  p3: { m: (s, a) => 1.10938 - 0.0008267 * s + 0.0000016 * s * s - 0.0002574 * a, f: (s, a) => 1.0994921 - 0.0009929 * s + 0.0000023 * s * s - 0.0001392 * a },
  p7: { m: (s, a) => 1.112 - 0.00043499 * s + 0.00000055 * s * s - 0.00028826 * a, f: (s, a) => 1.097 - 0.00046971 * s + 0.00000056 * s * s - 0.00012828 * a },
}
export const siri = density => (4.95 / density - 4.5) * 100

/** BMI class (WHO): under | normal | over | obese1 | obese2 | obese3. */
export const bmiClass = bmi => (bmi < 18.5 ? 'under' : bmi < 25 ? 'normal' : bmi < 30 ? 'over' : bmi < 35 ? 'obese1' : bmi < 40 ? 'obese2' : 'obese3')

/**
 * What an assessment works out to:
 *   sum (mm) and density from the skinfolds, when every site of the protocol was measured and the
 *   sex and age are known; fat (%) from them, else from the bioimpedance; fatSource 'folds' | 'bio';
 *   fatMass and leanMass (kg) with the weight; bmi and its class; whr (waist ÷ hips) and whether it
 *   is high for the sex (WHO: 0.90 men, 0.85 women).
 */
export function resultsOf(a) {
  const out = {}
  const sites = foldSites(a?.protocol, a?.sex)
  const folds = a?.folds || {}
  if (sites.length && sites.every(k => Number(folds[k]) > 0)) {
    out.sum = r1(sites.reduce((s, k) => s + Number(folds[k]), 0))
    if (a.sex && Number(a.age) > 0) {
      const density = DENSITY[a.protocol][a.sex](out.sum, Number(a.age))
      out.density = Math.round(density * 10000) / 10000
      out.fat = r1(Math.max(1, siri(density)))
      out.fatSource = 'folds'
    }
  }
  if (out.fat == null && Number(a?.bio?.fat) > 0) { out.fat = r1(Number(a.bio.fat)); out.fatSource = 'bio' }
  const w = Number(a?.weight)
  if (out.fat != null && w > 0) { out.fatMass = r1(w * out.fat / 100); out.leanMass = r1(w - out.fatMass) }
  const h = Number(a?.height) / 100
  if (w > 0 && h > 0) { out.bmi = r1(w / (h * h)); out.bmiClass = bmiClass(out.bmi) }
  const waist = Number(a?.circ?.waist), hips = Number(a?.circ?.hips)
  if (waist > 0 && hips > 0) {
    out.whr = r2(waist / hips)
    if (a.sex) out.whrHigh = out.whr >= (a.sex === 'f' ? 0.85 : 0.9)
  }
  return out
}

/**
 * One reading against the same of an earlier assessment: [{ group, key, now, before, delta }] for
 * every reading `cur` has, `before` and `delta` null where `prev` lacks it (or, for the sum of
 * skinfolds, took it by another protocol). Groups: result
 * (weight, fat, fatMass, leanMass, bmi, whr, sum), circ, bio, flex, folds.
 */
export function compareAssessments(cur, prev) {
  const rc = resultsOf(cur), rp = prev ? resultsOf(prev) : {}
  const rows = []
  const add = (group, key, now, before) => {
    if (now == null) return
    const b = before == null ? null : before
    rows.push({ group, key, now, before: b, delta: b == null ? null : r2(now - b) })
  }
  add('result', 'weight', cur?.weight ?? null, prev?.weight ?? null)
  for (const k of ['fat', 'fatMass', 'leanMass', 'bmi', 'whr']) add('result', k, rc[k] ?? null, rp[k] ?? null)
  // A sum of 3 sites against one of 7 says nothing: compared only within the same protocol.
  add('result', 'sum', rc.sum ?? null, cur?.protocol === prev?.protocol ? rp.sum ?? null : null)
  for (const [group, keys] of [['circ', CIRC], ['bio', BIO], ['flex', FLEX], ['folds', FOLDS]]) {
    for (const k of keys) add(group, k, cur?.[group]?.[k] ?? null, prev?.[group]?.[k] ?? null)
  }
  return rows
}

/** What the form starts from for a new assessment: today, and what the record and the last one know. */
export function assessmentDraft(record, last, today) {
  return {
    recordId: record?.id, d: today,
    sex: record?.sex || last?.sex || null,
    age: ageOn(record?.birth, today) ?? last?.age ?? null,
    height: last?.height ?? null,
    weight: null,
    protocol: last?.protocol || 'p7',
    folds: {}, circ: {}, bio: {}, flex: {}, note: ''
  }
}

// ---- photos: the same { pose, m } list as a weigh-in's, on an assessment found by id.
const byId = (state, id) => list(state?.assessments).find(x => isObj(x) && x.id === id) || null
export const assessmentPhotos = a => bwPhotosOf(a)

/**
 * Adds the still `ref` with `pose` to assessment `id` inside `state` (mutates — for useStore's
 * update()). 'added', or why not: 'gone', 'invalid', 'dup', 'full'.
 */
export function addAssessmentPhoto(state, id, ref, pose) {
  const a = byId(state, id)
  if (!a) return 'gone'
  const m = normalizeMediaRef(ref)
  if (!m || m.kind === 'video' || m.kind === 'doc') return 'invalid'
  const shown = bwPhotosOf(a)
  if (shown.some(p => p.m.hash === m.hash)) return 'dup'
  if (shown.length >= BW_PHOTOS_MAX) return 'full'
  a.photos = [...list(a.photos), { pose: POSES.includes(pose) ? pose : null, m }]
  return 'added'
}
/** Takes the photo `hash` off assessment `id` (mutates). */
export function removeAssessmentPhoto(state, id, hash) {
  const a = byId(state, id)
  if (!a) return
  const rest = list(a.photos).filter(p => !(isObj(p) && isObj(p.m) && p.m.hash === hash))
  if (rest.length) a.photos = rest
  else delete a.photos
}
