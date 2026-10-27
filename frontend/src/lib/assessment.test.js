import { describe, expect, it } from 'vitest'
import { addAssessmentPhoto, ageOn, assessmentDraft, assessmentsOf, compareAssessments, foldSites, normalizeAssessment, removeAssessmentPhoto, resultsOf } from './assessment.js'

const H = c => c.repeat(64)
const still = h => ({ kind: 'image', hash: H(h), mime: 'image/webp', size: 1000, width: 800, height: 1000, at: 1 })

describe('an assessment from the form', () => {
  it('needs a student and a day, and keeps only plausible readings', () => {
    expect(normalizeAssessment({ d: '2026-10-26' }).error).toBe('student')
    expect(normalizeAssessment({ recordId: 'a' }).error).toBe('day')
    const a = normalizeAssessment({ recordId: 'a', d: '2026-10-26', sex: 'f', age: '31', height: '165', weight: '62,4', protocol: 'p3',
      folds: { triceps: '18', suprailiac: 14.25, thigh: 180, bogus: 3 }, circ: { waist: 70, hips: '98' }, bio: { fat: 26, bmr: 99 }, flex: { sitReach: '-4' } }, { now: 1 })
    expect(a).toMatchObject({ recordId: 'a', sex: 'f', age: 31, height: 165, weight: 62.4, protocol: 'p3', created: 1 })
    expect(a.folds).toEqual({ triceps: 18, suprailiac: 14.3 })
    expect(a.circ).toEqual({ waist: 70, hips: 98 })
    expect(a.bio).toEqual({ fat: 26 })
    expect(a.flex).toEqual({ sitReach: -4 })
    expect(normalizeAssessment({ recordId: 'a', d: '2026-10-26', protocol: 'x' }).protocol).toBe(null)
  })

  it('knows the sites of each protocol and a birthday’s age on a day', () => {
    expect(foldSites('p3', 'm')).toEqual(['chest', 'abdomen', 'thigh'])
    expect(foldSites('p3', 'f')).toEqual(['triceps', 'suprailiac', 'thigh'])
    expect(foldSites('p7', 'f')).toHaveLength(7)
    expect(foldSites(null, 'm')).toEqual([])
    expect(ageOn('1990-10-27', '2026-10-26')).toBe(35)
    expect(ageOn('1990-10-26', '2026-10-26')).toBe(36)
    expect(ageOn(null, '2026-10-26')).toBe(null)
  })
})

describe('what an assessment works out to', () => {
  it('fat from Pollock 3 by Siri, with fat and lean mass, BMI and waist-to-hip', () => {
    const r = resultsOf({ sex: 'm', age: 30, weight: 80, height: 180, protocol: 'p3', folds: { chest: 15, abdomen: 25, thigh: 20 }, circ: { waist: 90, hips: 100 } })
    expect(r).toMatchObject({ sum: 60, fat: 17.9, fatSource: 'folds', fatMass: 14.3, leanMass: 65.7, bmi: 24.7, bmiClass: 'normal', whr: 0.9, whrHigh: true })
  })

  it('fat from Pollock 7 for a woman', () => {
    const folds = { chest: 10, midaxillary: 10, triceps: 20, subscapular: 15, abdomen: 25, suprailiac: 15, thigh: 25 }
    const r = resultsOf({ sex: 'f', age: 40, weight: 60, protocol: 'p7', folds })
    expect(r.sum).toBe(120)
    // 1.097 − 0.00046971·120 + 0.00000056·120² − 0.00012828·40 = 1.04366 → Siri 24.3%
    expect(r.fat).toBe(24.3)
  })

  it('falls back on the scale’s fat when the skinfolds are incomplete or the age unknown', () => {
    expect(resultsOf({ sex: 'm', protocol: 'p3', folds: { chest: 15, abdomen: 25 }, bio: { fat: 21 }, weight: 70 })).toMatchObject({ fat: 21, fatSource: 'bio', fatMass: 14.7 })
    const noAge = resultsOf({ sex: 'm', protocol: 'p3', folds: { chest: 15, abdomen: 25, thigh: 20 } })
    expect(noAge.sum).toBe(60)
    expect(noAge.fat).toBeUndefined()
    expect(resultsOf({})).toEqual({})
  })
})

describe('a student’s assessments over time', () => {
  const a1 = { id: '1', recordId: 'r', d: '2026-07-01', sex: 'm', age: 30, weight: 84, height: 180, protocol: 'p3', folds: { chest: 20, abdomen: 30, thigh: 25 }, circ: { waist: 95, armR: 35 }, bio: {}, flex: { sitReach: 10 } }
  const a2 = { id: '2', recordId: 'r', d: '2026-10-01', sex: 'm', age: 30, weight: 80, height: 180, protocol: 'p3', folds: { chest: 15, abdomen: 25, thigh: 20 }, circ: { waist: 90, armR: 36, hips: 100 }, bio: {}, flex: { sitReach: 14 } }

  it('lists them oldest first, and compares one with the one before', () => {
    expect(assessmentsOf({ assessments: [a2, { ...a1, recordId: 'x' }, a1] }, 'r').map(a => a.id)).toEqual(['1', '2'])
    const rows = compareAssessments(a2, a1)
    const get = (g, k) => rows.find(x => x.group === g && x.key === k)
    expect(get('result', 'weight')).toMatchObject({ now: 80, before: 84, delta: -4 })
    expect(get('result', 'sum')).toMatchObject({ now: 60, before: 75, delta: -15 })
    expect(get('circ', 'waist').delta).toBe(-5)
    expect(get('circ', 'hips')).toMatchObject({ now: 100, before: null, delta: null })
    expect(get('flex', 'sitReach').delta).toBe(4)
    expect(get('circ', 'neck')).toBeUndefined()
    expect(compareAssessments(a2, null).every(r => r.delta === null)).toBe(true)
    const p7 = { ...a1, protocol: 'p7', folds: { chest: 20, midaxillary: 10, triceps: 15, subscapular: 15, abdomen: 30, suprailiac: 15, thigh: 25 } }
    expect(compareAssessments(a2, p7).find(x => x.key === 'sum')).toMatchObject({ now: 60, before: null, delta: null })
  })

  it('a new one starts from the record and the last one', () => {
    expect(assessmentDraft({ id: 'r', sex: 'f', birth: '1995-01-10' }, a2, '2026-10-26')).toMatchObject({ recordId: 'r', d: '2026-10-26', sex: 'f', age: 31, height: 180, weight: null, protocol: 'p3' })
    expect(assessmentDraft({ id: 'r' }, null, '2026-10-26')).toMatchObject({ sex: null, age: null, protocol: 'p7' })
  })

  it('keeps photos as a weigh-in does: stills, one of each, at most six', () => {
    const S = { assessments: [{ ...a1 }] }
    expect(addAssessmentPhoto(S, '1', still('a'), 'front')).toBe('added')
    expect(addAssessmentPhoto(S, '1', still('a'), 'side')).toBe('dup')
    expect(addAssessmentPhoto(S, '1', { ...still('b'), kind: 'video' }, 'side')).toBe('invalid')
    expect(addAssessmentPhoto(S, 'nope', still('c'), 'side')).toBe('gone')
    for (const c of 'bcdef') addAssessmentPhoto(S, '1', still(c), 'back')
    expect(addAssessmentPhoto(S, '1', still('9'), 'back')).toBe('full')
    expect(S.assessments[0].photos[0]).toMatchObject({ pose: 'front', m: { hash: H('a') } })
    removeAssessmentPhoto(S, '1', H('a'))
    expect(S.assessments[0].photos).toHaveLength(5)
  })
})
