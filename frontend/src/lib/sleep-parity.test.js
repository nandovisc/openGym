// api/sleep.js (what the iPhone Shortcut sends) and lib/sleep-samples.js (the export.xml import)
// are two copies of one set of rules: the same samples must make the same nights on both sides.
import { describe, expect, it } from 'vitest'
import * as api from '../../../api/sleep.js'
import * as app from './sleep-samples.js'
import { WATCH_NIGHT } from './sleep.fixture.js'

const CASES = {
  watch: WATCH_NIGHT,
  ring: [{ start: '2026-10-21 23:10:00 -0300', end: '2026-10-22 06:50:00 -0300', value: 'HKCategoryValueSleepAnalysisAsleepUnspecified', source: 'Oura' }],
  both: [...WATCH_NIGHT, { start: '2026-10-21T23:10:00-03:00', end: '2026-10-22T06:50:00-03:00', value: 'Asleep', source: 'Oura' }],
  nap: [...WATCH_NIGHT, { start: '2026-10-22T14:00:00-03:00', end: '2026-10-22T14:40:00-03:00', value: '1', source: 'Apple Watch de Fernando' }],
  junk: [{ start: 'x', end: 'y', value: 'Deep' }, { start: '2026-10-22T06:00:00Z', end: '2026-10-22T05:00:00Z', value: 'Deep' }, null]
}

describe('the server and the app read sleep samples alike', () => {
  it('exports the same rules', () => expect(Object.keys(app).sort()).toEqual(Object.keys(api).sort()))
  for (const [name, samples] of Object.entries(CASES)) {
    it(name, () => {
      expect(app.nightsFrom(samples)).toEqual(api.nightsFrom(samples))
      expect(app.mergeNights([], app.nightsFrom(samples), { now: 1 })).toEqual(api.mergeNights([], api.nightsFrom(samples), { now: 1 }))
    })
  }
  it('parses the Shortcut text alike', () => {
    const text = WATCH_NIGHT.map(s => [s.start, s.end, s.value, s.source].join('|')).join('\r\n')
    expect(app.parseSamples(text)).toEqual(api.parseSamples(text))
  })
})
