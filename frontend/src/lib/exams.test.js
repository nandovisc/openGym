import { describe, expect, it } from 'vitest'
import {
  analytes, computeFlag, examsByDate, fromReading, keyOf, normalizeExam, normalizeResult, outOfRange, parseNumber,
  parseRange, seriesOf
} from './exams.js'
import { mergeStates, stampChange } from './sync-merge.js'
import { referencedHashes } from './media-refs.js'

describe('reading numbers and ranges as labs write them', () => {
  it('takes either decimal mark, thousands separators, and refuses bounds and words', () => {
    expect(parseNumber('4,5')).toBe(4.5)
    expect(parseNumber('4.5')).toBe(4.5)
    expect(parseNumber('1.234,5')).toBe(1234.5)
    expect(parseNumber('1,234.5')).toBe(1234.5)
    expect(parseNumber('250.000')).toBe(250000)
    expect(parseNumber(' 98 ')).toBe(98)
    expect(parseNumber(7.2)).toBe(7.2)
    expect(parseNumber('< 5')).toBeNull()
    expect(parseNumber('Negativo')).toBeNull()
    expect(parseNumber('')).toBeNull()
  })
  it('reads both bounds, an upper bound only or a lower bound only', () => {
    expect(parseRange('70 a 99 mg/dL')).toEqual({ low: 70, high: 99 })
    expect(parseRange('3,5 – 5,0')).toEqual({ low: 3.5, high: 5 })
    expect(parseRange('Desejável: inferior a 130')).toEqual({ low: null, high: 130 })
    expect(parseRange('< 200')).toEqual({ low: null, high: 200 })
    expect(parseRange('até 5,7%')).toEqual({ low: null, high: 5.7 })
    expect(parseRange('superior a 40')).toEqual({ low: 40, high: null })
    expect(parseRange('> 60')).toEqual({ low: 60, high: null })
    expect(parseRange('Não reagente')).toEqual({ low: null, high: null })
  })
  it('flags against the range', () => {
    expect(computeFlag(105, 70, 99)).toBe('high')
    expect(computeFlag(60, 70, 99)).toBe('low')
    expect(computeFlag(80, 70, 99)).toBe('normal')
    expect(computeFlag(80, null, null)).toBeNull()
    expect(computeFlag(null, 70, 99)).toBeNull()
  })
})

describe('results and exams', () => {
  it('normalises a result: the range from its text, the flag from the range, a key from the name', () => {
    const r = normalizeResult({ name: 'Glicose', valueText: '105', unit: 'mg/dL', refText: '70 a 99' })
    expect(r).toMatchObject({ key: 'glicose', value: 105, refLow: 70, refHigh: 99, flag: 'high', unit: 'mg/dL' })
    expect(normalizeResult({ name: '  ' })).toBeNull()
    // the report's own flag wins; the AI's key ties labs together
    expect(normalizeResult({ name: 'HIV', valueText: 'Reagente', flag: 'abnormal', key: 'hiv_1_2' })).toMatchObject({ value: null, flag: 'abnormal', key: 'hiv_1_2' })
    expect(keyOf('Colesterol LDL (calculado)')).toBe('colesterol_ldl_calculado')
    // accents copied out of a PDF as separate marks are put back on their letter
    expect(normalizeExam({ d: '2026-08-24', lab: 'Marcelo Magalha\u02dces', title: 'Jose\u00b4' }).lab).toBe('Marcelo Magalhães')
    expect(normalizeExam({ d: '2026-08-24', title: 'Jose\u00b4' }).title).toBe('José')
  })
  it('needs a date, and keeps id, creation and stamps of the exam it edits', () => {
    expect(normalizeExam({ results: [] })).toEqual({ error: 'date' })
    const prev = { id: 'e1', created: 5, _ts: 9, d: '2026-01-01' }
    const e = normalizeExam({ d: '2026-02-01', title: 'Check-up', results: [{ name: 'TSH', value: '2,1' }] }, { prev })
    expect(e).toMatchObject({ id: 'e1', created: 5, _ts: 9, d: '2026-02-01', title: 'Check-up' })
    expect(e.results[0].value).toBe(2.1)
  })
  it('turns the AI reading into the form', () => {
    const f = fromReading({ date: '2026-10-01', lab: 'Lab X', title: 'Hemograma', results: [{ key: 'hemoglobin', name: 'Hemoglobina', value: 14.2, valueText: '14,2', unit: 'g/dL', refLow: 13.5, refHigh: 17.5, refText: '13,5 a 17,5', flag: 'normal', section: 'Eritrograma' }] })
    expect(f.d).toBe('2026-10-01')
    expect(f.results[0]).toMatchObject({ key: 'hemoglobin', value: 14.2, flag: 'normal' })
    expect(fromReading({ date: 'ontem' }).d).toBe('')
  })
})

describe('over time', () => {
  const exams = [
    { id: 'a', d: '2026-01-10', created: 1, results: [{ key: 'glucose', name: 'Glicose', value: 92, unit: 'mg/dL', refLow: 70, refHigh: 99, flag: 'normal' }] },
    { id: 'b', d: '2026-06-10', created: 2, results: [
      { key: 'glucose', name: 'Glicemia de jejum', value: 104, unit: 'mg/dL', refLow: 70, refHigh: 99, flag: 'high' },
      { key: 'tsh', name: 'TSH', value: 2.1, unit: 'µUI/mL', flag: 'normal' }
    ] }
  ]
  it('orders exams newest first and counts what is out of range', () => {
    expect(examsByDate(exams).map(e => e.id)).toEqual(['b', 'a'])
    expect(outOfRange(exams[1])).toBe(1)
  })
  it('lists each analyte once with its latest result, whatever each lab called it', () => {
    const list = analytes(exams)
    expect(list.map(a => a.key)).toEqual(['glucose', 'tsh'])
    expect(list[0]).toMatchObject({ name: 'Glicemia de jejum', count: 2, last: { value: 104, d: '2026-06-10', flag: 'high' } })
  })
  it('gives the chart its points in order, with the latest range and unit', () => {
    const s = seriesOf(exams, 'glucose')
    expect(s.points.map(p => p.y)).toEqual([92, 104])
    expect(s).toMatchObject({ refLow: 70, refHigh: 99, unit: 'mg/dL' })
  })
})

describe('kept and synced', () => {
  const pdf = { kind: 'doc', hash: '1'.repeat(64), mime: 'application/pdf', size: 1000, at: 1 }
  it('the files of an exam are referenced, so the media store keeps and uploads them', () => {
    expect([...referencedHashes({ exams: [{ id: 'e', d: '2026-01-01', files: [pdf] }] })]).toEqual([pdf.hash])
  })
  it('an exam added on each device survives the merge, and one removed stays removed', () => {
    const T = 1_800_000_000_000
    const base = { _ts: T, unit: 'kg', workouts: [], routines: [], exams: [{ id: 'old', d: '2026-01-01', results: [], _ts: T }] }
    const change = (prev, wall, mut) => { const n = JSON.parse(JSON.stringify(prev)); mut(n); n._ts = stampChange(prev, n, wall); return n }
    const phone = change(base, T + 10, s => { s.exams.push({ id: 'p', d: '2026-02-01', results: [] }) })
    const desk = change(base, T + 20, s => { s.exams = [{ id: 'd', d: '2026-03-01', results: [] }] })
    expect(mergeStates(desk, phone).exams.map(e => e.id).sort()).toEqual(['d', 'p'])
  })
})

describe('finding results', () => {
  it('orders names as people read them: accents and capitals aside, numbers by value', async () => {
    const { byName } = await import('./exams.js')
    expect(['ÁCIDO ÚRICO', 'acido folico', 'Albumina', '17-alfa', '2-teste'].sort(byName)).toEqual(['2-teste', '17-alfa', 'acido folico', 'ÁCIDO ÚRICO', 'Albumina'])
  })
  it('narrows analytes as a search is typed, accents aside, and to the out-of-range ones', async () => {
    const { filterAnalytes } = await import('./exams.js')
    const list = [
      { key: 'uric_acid', name: 'ÁCIDO ÚRICO, soro', last: { flag: 'high' } },
      { key: 'folic_acid', name: 'Ácido fólico', last: { flag: 'normal' } },
      { key: 'albumin', name: 'Albumina', last: { flag: null } }
    ]
    expect(filterAnalytes(list, { query: 'acido' }).map(a => a.key)).toEqual(['uric_acid', 'folic_acid'])
    expect(filterAnalytes(list, { query: 'acido uri' }).map(a => a.key)).toEqual(['uric_acid'])
    expect(filterAnalytes(list, { out: true }).map(a => a.key)).toEqual(['uric_acid'])
    expect(filterAnalytes(list, { query: '' })).toHaveLength(3)
  })
  it('finds exams by title, lab, doctor or a result, and those with anything out of range', async () => {
    const { filterExams } = await import('./exams.js')
    const list = [
      { id: 'a', title: 'Rotina', lab: 'Marcelo Magalhães', doctor: 'Dr. Diego Barros', results: [{ name: 'Glicose', flag: 'high' }] },
      { id: 'b', title: 'Tireoide', lab: 'Diagmax', doctor: '', results: [{ name: 'TSH', flag: 'normal' }] }
    ]
    expect(filterExams(list, { query: 'magalhaes' }).map(e => e.id)).toEqual(['a'])
    expect(filterExams(list, { query: 'diego' }).map(e => e.id)).toEqual(['a'])
    expect(filterExams(list, { query: 'tsh' }).map(e => e.id)).toEqual(['b'])
    expect(filterExams(list, { out: true }).map(e => e.id)).toEqual(['a'])
  })
  it('keeps the doctor the reading found', () => {
    expect(fromReading({ date: '2026-01-09', lab: 'Diagmax', doctor: 'Dr. Diego Barros', title: 'Hemograma', results: [] }).doctor).toBe('Dr. Diego Barros')
    expect(normalizeExam({ d: '2026-01-09', doctor: ' Dra. Ana ' }).doctor).toBe('Dra. Ana')
  })
})
