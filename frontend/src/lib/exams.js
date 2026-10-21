// Medical exams: the reports and the values read off them (Health → Exams, views/Exams.jsx).
// Framework-free; the AI's reading (POST /api/exams/read) and the form both come through here.
//
//   S.exams [{ id, d, title, lab, files: [MediaRef], results: [Result], notes, created }]
//     d: the day the sample was taken (ISO). files: the lab's PDF or photos of the paper, kept by
//     the media store (lib/media-refs.js walks them). Merged across devices entry by entry
//     (lib/sync-merge.js HEALTH_LISTS).
//   Result { id, key, name, value, valueText, unit, refLow, refHigh, refText, flag, section }
//     value: the number, null when the result is not one ("Negativo", "< 5"); valueText: the
//     result as written. key: what ties the same analyte across reports and labs ("glucose",
//     "ldl_cholesterol") — the AI's identifier, or the name folded. flag: low | high | normal |
//     abnormal, or null when nothing says.
import { uid } from './format.js'

export const FLAGS = ['low', 'high', 'normal', 'abnormal']
export const FILES_MAX = 6
export const RESULTS_MAX = 300
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
const list = v => (Array.isArray(v) ? v : [])
// Text copied out of a PDF often carries an accent as a separate spacing mark after its letter
// ("Magalha˜es", "Jose´"): put it back on the letter, then compose ("Magalhães", "José").
const SPACING_MARKS = { '\u02dc': '\u0303', '\u00b4': '\u0301', '`': '\u0300', '\u02c6': '\u0302', '\u00a8': '\u0308', '\u00b8': '\u0327' }
const fixMarks = s => s.replace(/([A-Za-z])([\u02dc\u00b4`\u02c6\u00a8\u00b8])/g, (m, ch, mark) => ch + SPACING_MARKS[mark]).normalize('NFC')
const text = (v, max) => fixMarks(String(v ?? '')).replace(/\s+/g, ' ').trim().slice(0, max)

/**
 * A number as a lab writes it, or null: "4,5" and "4.5" are 4.5, "1.234,5" and "1,234.5" are
 * 1234.5, "250.000" (platelets, Brazilian style) is 250000. A result that is a bound ("< 5",
 * "> 90") or a word is not a number.
 */
export function parseNumber(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  let s = String(v ?? '').trim().replace(/\s/g, '')
  if (!s || /^[<>≤≥]/.test(s)) return null
  if (!/^[-+]?[\d.,]+$/.test(s)) return null
  const comma = s.lastIndexOf(','), dot = s.lastIndexOf('.')
  if (comma >= 0 && dot >= 0) {
    s = comma > dot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '')
  } else if (comma >= 0) {
    s = /^[-+]?\d{1,3}(,\d{3})+$/.test(s) && s.split(',').length > 2 ? s.replace(/,/g, '') : s.replace(',', '.')
  } else if (/^[-+]?\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, '')
  }
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

/**
 * The bounds of a reference range as written: "70 a 99", "70 - 99", "3,5 – 5,0" → both;
 * "< 200", "até 200", "inferior a 200", "menor que 200" → high only; "> 40", "superior a 40",
 * "maior que 40", "acima de 40" → low only. { low, high }, each null when the text does not say.
 */
export function parseRange(raw) {
  const s = String(raw ?? '').toLowerCase().replace(/\s+/g, ' ').trim()
  const num = '([-+]?\\d[\\d.,]*)'
  const out = { low: null, high: null }
  if (!s) return out
  let m = new RegExp(`${num}\\s*(?:a|-|–|—|até|to)\\s*${num}`).exec(s)
  if (m) { out.low = parseNumber(m[1]); out.high = parseNumber(m[2]); return out }
  m = new RegExp(`(?:<|≤|até|inferior a|menor que|menor ou igual a|abaixo de|below|up to)\\s*(?:a\\s*)?${num}`).exec(s)
  if (m) { out.high = parseNumber(m[1]); return out }
  m = new RegExp(`(?:>|≥|superior a|maior que|maior ou igual a|acima de|above)\\s*(?:a\\s*)?${num}`).exec(s)
  if (m) { out.low = parseNumber(m[1]); return out }
  return out
}

/** low / high / normal from a value and its bounds, or null when there is nothing to compare. */
export function computeFlag(value, low, high) {
  if (value == null || (low == null && high == null)) return null
  if (low != null && value < low) return 'low'
  if (high != null && value > high) return 'high'
  return 'normal'
}

/** The name folded into an identifier: "Colesterol LDL" → "colesterol_ldl". */
export const keyOf = name => String(name ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60)

/** A result as stored, or null without a name. Keeps the id of the one it replaces. */
export function normalizeResult(r) {
  if (!r || typeof r !== 'object') return null
  const name = text(r.name, 80)
  if (!name) return null
  const valueText = text(r.valueText ?? (r.value != null ? String(r.value) : ''), 60)
  const value = r.value != null && r.value !== '' ? parseNumber(r.value) : parseNumber(valueText)
  const refText = text(r.refText, 120)
  const range = parseRange(refText)
  const refLow = r.refLow != null && r.refLow !== '' ? parseNumber(r.refLow) : range.low
  const refHigh = r.refHigh != null && r.refHigh !== '' ? parseNumber(r.refHigh) : range.high
  const given = FLAGS.includes(r.flag) ? r.flag : null
  return {
    id: typeof r.id === 'string' && r.id ? r.id : uid(),
    key: keyOf(r.key) || keyOf(name),
    name,
    value,
    valueText: valueText || (value != null ? String(value) : ''),
    unit: text(r.unit, 30),
    refLow,
    refHigh,
    refText,
    // What the report says wins (it may flag what no range here shows); else the range decides.
    flag: given || computeFlag(value, refLow, refHigh),
    section: text(r.section, 60)
  }
}

/**
 * An exam as stored, from the form (or the AI's reading as the form holds it). `{ error }`
 * instead when it cannot be one: no date. Keeps the id, the creation time and the sync stamps of
 * `prev` when editing.
 */
export function normalizeExam(input, { prev = null } = {}) {
  const d = DAY_RE.test(input?.d || '') ? input.d : null
  if (!d) return { error: 'date' }
  const results = list(input?.results).map(normalizeResult).filter(Boolean).slice(0, RESULTS_MAX)
  return {
    ...(prev || {}),
    id: prev?.id || input?.id || uid(),
    d,
    title: text(input?.title, 80),
    lab: text(input?.lab, 80),
    files: list(input?.files).filter(f => f && typeof f === 'object' && typeof f.hash === 'string').slice(0, FILES_MAX),
    results,
    notes: text(input?.notes, 500),
    created: Number(prev?.created) || Date.now(),
    // When its results were read with AI (POST /api/exams/read), 0 for typed in by hand.
    ai: Number(input?.ai) || 0
  }
}

/** The AI's reading (POST /api/exams/read) as the form's starting point. */
export function fromReading(reading) {
  return {
    d: DAY_RE.test(reading?.date || '') ? reading.date : '',
    title: text(reading?.title, 80),
    lab: text(reading?.lab, 80),
    results: list(reading?.results).map(normalizeResult).filter(Boolean)
  }
}

/** How many of an exam's results are out of their range (low, high or flagged abnormal). */
export const outOfRange = exam => list(exam?.results).filter(r => r && (r.flag === 'low' || r.flag === 'high' || r.flag === 'abnormal')).length

/** Exams newest first (by sample date, then by when they were added). */
export const examsByDate = exams => list(exams).filter(e => e && e.id && e.d)
  .sort((a, b) => b.d.localeCompare(a.d) || (b.created || 0) - (a.created || 0))

/**
 * Every analyte ever measured, by key: { key, name, unit, count, last: { value, valueText, d,
 * flag, refLow, refHigh } }, by name. `name` and `unit` are those of the latest result.
 */
export function analytes(exams) {
  const by = new Map()
  for (const e of [...examsByDate(exams)].reverse()) {
    for (const r of list(e.results)) {
      if (!r?.key) continue
      const a = by.get(r.key) || { key: r.key, count: 0 }
      a.count++
      a.name = r.name
      a.unit = r.unit
      a.last = { value: r.value, valueText: r.valueText, d: e.d, flag: r.flag, refLow: r.refLow, refHigh: r.refHigh }
      by.set(r.key, a)
    }
  }
  return [...by.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * The numeric results of one analyte over time, for the chart: { points: [{ t, y, d }], refLow,
 * refHigh, unit } — the range and unit of the latest result that has them.
 */
export function seriesOf(exams, key) {
  const points = []
  let refLow = null, refHigh = null, unit = ''
  for (const e of [...examsByDate(exams)].reverse()) {
    for (const r of list(e.results)) {
      if (r?.key !== key) continue
      if (r.value != null) points.push({ t: Date.parse(e.d + 'T12:00:00'), y: r.value, d: e.d })
      if (r.refLow != null || r.refHigh != null) { refLow = r.refLow; refHigh = r.refHigh }
      if (r.unit) unit = r.unit
    }
  }
  return { points, refLow, refHigh, unit }
}
