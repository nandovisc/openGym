import { describe, expect, it } from 'vitest'
import { kindOf, mergeNights, nightsFrom, parseSamples, parseTime } from './sleep-samples.js'
import { dailySeries, normalizeNight, stageShares, summary } from './sleep.js'
import { WATCH_NIGHT } from './sleep.fixture.js'

describe('samples', () => {
  it('reads a time with its offset, in either way Apple writes it', () => {
    expect(parseTime('2026-10-22T06:55:00-03:00')).toEqual({ ms: Date.parse('2026-10-22T09:55:00Z'), local: '2026-10-22T06:55' })
    expect(parseTime('2026-10-22 06:55:00 -0300')).toEqual(parseTime('2026-10-22T06:55:00-03:00'))
    expect(parseTime('ontem')).toBeNull()
  })

  it('knows a stage by its Apple name, its number, or the Shortcut label in Portuguese or English', () => {
    expect(['HKCategoryValueSleepAnalysisAsleepDeep', '4', 'Profundo', 'Deep'].map(kindOf)).toEqual(['deep', 'deep', 'deep', 'deep'])
    expect(['HKCategoryValueSleepAnalysisInBed', 'Na cama', 'In Bed'].map(kindOf)).toEqual(['inbed', 'inbed', 'inbed'])
    expect(['Essencial', 'Core', 'REM', 'Acordado', 'Dormindo', 'Asleep'].map(kindOf)).toEqual(['core', 'core', 'rem', 'awake', 'asleep', 'asleep'])
    expect(kindOf('Mindful')).toBeNull()
  })

  it('takes text lines or JSON', () => {
    const text = WATCH_NIGHT.map(s => [s.start, s.end, s.value, s.source].join(';')).join('\n')
    expect(parseSamples(text)).toEqual(WATCH_NIGHT)
    expect(parseSamples(JSON.stringify({ samples: WATCH_NIGHT }))).toEqual(WATCH_NIGHT)
    expect(parseSamples(WATCH_NIGHT.map(s => ({ startDate: s.start, endDate: s.end, value: s.value, sourceName: s.source })))).toEqual(WATCH_NIGHT)
  })
})

describe('nights', () => {
  it('turns a night across midnight into one night, filed under the day woken up on', () => {
    const [n] = nightsFrom(WATCH_NIGHT)
    expect(n).toEqual({ id: 'hk:2026-10-22', d: '2026-10-22', bed: '2026-10-21T23:05', wake: '2026-10-22T06:55', asleepMin: 430, inBedMin: 470,
      stages: { deep: 70, rem: 100, core: 260, awake: 10 }, src: 'health', source: 'Apple Watch de Fernando' })
  })

  it('works the length out across a change of offset', () => {
    const [n] = nightsFrom([{ start: '2026-11-01T23:00:00-03:00', end: '2026-11-02T07:00:00-02:00', value: 'Asleep', source: 'x' }])
    expect(n).toMatchObject({ asleepMin: 420, stages: null, wake: '2026-11-02T07:00' })
  })

  it('leaves a nap out of the night', () => {
    const nap = { start: '2026-10-22T14:00:00-03:00', end: '2026-10-22T14:40:00-03:00', value: 'Dormindo', source: 'Apple Watch de Fernando' }
    expect(nightsFrom([...WATCH_NIGHT, nap])).toHaveLength(1)
    expect(nightsFrom([...WATCH_NIGHT, nap])[0].asleepMin).toBe(430)
  })

  it('counts a night recorded by a watch and a ring once, from the one with stages', () => {
    const ring = [{ start: '2026-10-21T23:10:00-03:00', end: '2026-10-22T06:50:00-03:00', value: 'Dormindo', source: 'Oura' }]
    const nights = nightsFrom([...ring, ...WATCH_NIGHT])
    expect(nights).toHaveLength(1)
    expect(nights[0].source).toBe('Apple Watch de Fernando')
  })

  it('keeps a night logged by hand, and a Health night the person edited', () => {
    const [n] = nightsFrom(WATCH_NIGHT)
    const manual = { id: 'm1', d: n.d, src: 'manual', bed: '2026-10-21T23:00', wake: '2026-10-22T07:00', asleepMin: 480 }
    expect(mergeNights([manual], [n]).put).toEqual([])
    expect(mergeNights([{ ...n, edited: true, asleepMin: 400 }], [n]).put).toEqual([])
    const again = mergeNights([{ ...n, quality: 4, created: 5 }], [{ ...n, asleepMin: 431 }])
    expect(again.list).toEqual([{ ...n, asleepMin: 431, quality: 4, created: 5 }])
    expect(mergeNights(again.list, [{ ...n, asleepMin: 431 }]).put).toEqual([])
  })
})

describe('logging and reading nights', () => {
  it('logs a night by hand, bedtime the evening before', () => {
    const n = normalizeNight({ d: '2026-10-22', bed: '23:30', wake: '07:00', quality: 4 }, { now: 1 })
    expect(n).toMatchObject({ d: '2026-10-22', bed: '2026-10-21T23:30', wake: '2026-10-22T07:00', asleepMin: 450, inBedMin: 450, src: 'manual', quality: 4, stages: null })
    expect(normalizeNight({ d: '2026-10-22', bed: '01:00', wake: '08:00' }).bed).toBe('2026-10-22T01:00')
    expect(normalizeNight({ d: '2026-10-22', bed: '25:00', wake: '08:00' })).toEqual({ error: 'time' })
  })

  it('marks a Health night the person edits, and drops its stages when the times change', () => {
    const [n] = nightsFrom(WATCH_NIGHT)
    expect(normalizeNight({ d: n.d, bed: '23:05', wake: '06:55', quality: 3 }, { prev: n })).toMatchObject({ edited: true, quality: 3, asleepMin: 430, stages: n.stages, id: n.id })
    expect(normalizeNight({ d: n.d, bed: '23:00', wake: '06:55' }, { prev: n })).toMatchObject({ edited: true, asleepMin: 475, stages: null })
  })

  it('sums a period: average length, bed and wake times across midnight, regularity', () => {
    const night = (d, bed, wake, asleepMin) => ({ d, bed, wake, asleepMin })
    const sleep = [night('2026-10-20', '2026-10-19T23:30', '2026-10-20T07:00', 420), night('2026-10-21', '2026-10-21T00:30', '2026-10-21T07:30', 480)]
    expect(summary(sleep, '2026-10-15', '2026-10-21', 450)).toEqual({ nights: 2, avgMin: 450, avgBed: '00:00', avgWake: '07:15', spreadMin: 30, goalHit: 1 })
    expect(summary(sleep, '2026-10-01', '2026-10-02')).toBeNull()
    expect(dailySeries(sleep, '2026-10-19', '2026-10-21').map(x => x.min)).toEqual([null, 420, 480])
  })

  it('shares the stages out for the bar', () => {
    expect(stageShares({ deep: 60, rem: 60, core: 120, awake: 0 }).map(x => [x.k, x.pct])).toEqual([['deep', 25], ['core', 50], ['rem', 25]])
    expect(stageShares(null)).toEqual([])
  })
})
