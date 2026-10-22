import { describe, expect, it } from 'vitest'
import { isHealthExport, parseSleepExport, pickRecords, scanHealthExport } from './health-export.js'
import { parseBodyweight, mergeImport } from './import-csv.js'

const rec = (type, start, end, extra) => ` <Record type="${type}" sourceName="Apple Watch de João" unit="" creationDate="${end}" startDate="${start}" endDate="${end}" ${extra}/>`
const SLEEP = 'HKCategoryTypeIdentifierSleepAnalysis'
const EXPORT = [
  '<?xml version="1.0" encoding="UTF-8"?>', '<HealthData locale="pt_BR">',
  rec('HKQuantityTypeIdentifierStepCount', '2026-10-21 10:00:00 -0300', '2026-10-21 10:05:00 -0300', 'value="300"'),
  rec('HKQuantityTypeIdentifierBodyMass', '2026-10-21 07:10:00 -0300', '2026-10-21 07:10:00 -0300', 'value="82.4" unit="kg"').replace('unit="" ', ''),
  rec(SLEEP, '2026-10-21 23:05:00 -0300', '2026-10-22 06:55:00 -0300', 'value="HKCategoryValueSleepAnalysisInBed"'),
  rec(SLEEP, '2026-10-21 23:20:00 -0300', '2026-10-22 02:00:00 -0300', 'value="HKCategoryValueSleepAnalysisAsleepCore"'),
  rec(SLEEP, '2026-10-22 02:00:00 -0300', '2026-10-22 03:00:00 -0300', 'value="HKCategoryValueSleepAnalysisAsleepDeep"'),
  rec(SLEEP, '2026-10-22 03:00:00 -0300', '2026-10-22 06:40:00 -0300', 'value="HKCategoryValueSleepAnalysisAsleepREM"'),
  rec('HKQuantityTypeIdentifierHeartRate', '2026-10-22 07:00:00 -0300', '2026-10-22 07:00:00 -0300', 'value="61"'),
  '</HealthData>'
].join('\n')

describe('the Apple Health export', () => {
  it('keeps only the weigh-ins and the sleep records', () => {
    const kept = pickRecords(EXPORT).split('\n')
    expect(kept).toHaveLength(5)
    expect(kept.every(l => /BodyMass|SleepAnalysis/.test(l))).toBe(true)
  })

  it('reads the file in slices, a tag or an accented letter cut between two of them included', async () => {
    const file = new File([EXPORT], 'exportar.xml', { type: 'text/xml' })
    expect(await isHealthExport(file)).toBe(true)
    expect(await isHealthExport(new File(['date,weight\n2026-10-21,82'], 'w.csv'))).toBe(false)
    let progress = 0
    for (const chunk of [7, 64, 1000, 1 << 20]) {
      expect(await scanHealthExport(file, { chunk, onProgress: p => { progress = p } })).toBe(pickRecords(EXPORT))
    }
    expect(progress).toBe(1)
  })

  it('turns the sleep records into nights and merges them with the weigh-ins', async () => {
    const records = pickRecords(EXPORT)
    const sleep = parseSleepExport(records)
    expect(sleep).toMatchObject({ kind: 'sleep', from: '2026-10-22', to: '2026-10-22' })
    expect(sleep.nights[0]).toMatchObject({ id: 'hk:2026-10-22', asleepMin: 440, source: 'Apple Watch de João', stages: { deep: 60, rem: 220, core: 160, awake: 0 } })
    const S = { bodyweight: [], sleep: [{ id: 'm', d: '2026-10-22', src: 'manual', asleepMin: 400 }] }
    const res = mergeImport(S, { ...parseBodyweight(records, { unit: 'kg' }), sleep })
    expect(res).toMatchObject({ added: 1, nights: { added: 0, skipped: 1 } })
    expect(S.sleep.map(x => x.id)).toEqual(['m'])
    const fresh = { bodyweight: [], sleep: [] }
    expect(mergeImport(fresh, sleep)).toEqual({ added: 1, skipped: 0 })
    expect(mergeImport(fresh, sleep)).toEqual({ added: 0, skipped: 1 })
    expect(parseSleepExport('<HealthData/>')).toEqual({ error: 'unrecognised' })
  })
})
