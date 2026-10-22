// The Apple Health export (export.xml): body weight and sleep out of a file that is often hundreds
// of megabytes, most of it step counts and heart rate. Read in slices, never whole — a string that
// size can be more than the browser will make — and only the records wanted are kept: what is left
// is small enough for parseBodyweight (lib/import-csv.js) and the sleep reader below.
import { nightsFrom } from './sleep-samples.js'

export const CHUNK = 8 * 1048576
const WANTED = /<Record\b[^>]*type="(?:HKQuantityTypeIdentifierBodyMass|HKCategoryTypeIdentifierSleepAnalysis)"[^>]*>/g

/** The body-weight and sleep record tags of `text`, one a line. */
export const pickRecords = text => (String(text).match(WANTED) || []).join('\n')

/** Whether a file is an Apple Health export rather than a CSV, by its name or its first bytes. */
export async function isHealthExport(file) {
  if (/\.xml$/i.test(file?.name || '')) return true
  const head = await file.slice(0, 512).text()
  return /^\s*</.test(head) && /HealthData|<\?xml/.test(head)
}

/**
 * The wanted records of an export, read `chunk` bytes at a time. A tag cut by the end of a slice
 * is carried over to the next, and so is a character cut in half (the decoder streams).
 * onProgress(0..1) after each slice.
 */
export async function scanHealthExport(file, { chunk = CHUNK, onProgress } = {}) {
  const dec = new TextDecoder('utf-8')
  const out = []
  let carry = ''
  for (let at = 0; at < file.size; at += chunk) {
    const last = at + chunk >= file.size
    const text = carry + dec.decode(await file.slice(at, at + chunk).arrayBuffer(), { stream: !last })
    // Everything up to the last '>' is whole tags; the rest waits for the next slice.
    const cut = last ? text.length : text.lastIndexOf('>') + 1
    const part = pickRecords(text.slice(0, cut))
    if (part) out.push(part)
    carry = text.slice(cut)
    // A megabyte with no '>' in it is no tag worth waiting for.
    if (carry.length > 1048576) carry = ''
    onProgress?.(Math.min(1, (at + chunk) / file.size))
  }
  return out.join('\n')
}

const attr = (tag, name) => {
  const m = new RegExp(`\\b${name}="([^"]*)"`).exec(tag)
  return m ? m[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>') : ''
}

/** The nights in the sleep records of `text`: { kind: 'sleep', source, nights, from, to }, or { error }. */
export function parseSleepExport(text) {
  const tags = String(text).match(/<Record\b[^>]*type="HKCategoryTypeIdentifierSleepAnalysis"[^>]*>/g) || []
  const nights = nightsFrom(tags.map(tag => ({ start: attr(tag, 'startDate'), end: attr(tag, 'endDate'), value: attr(tag, 'value'), source: attr(tag, 'sourceName') })))
  if (!nights.length) return { error: 'unrecognised' }
  return { kind: 'sleep', source: 'Apple Health', nights, from: nights[0].d, to: nights[nights.length - 1].d }
}
