// A trainer's own record of each student (the Personal module, phase 4): who they are, what they
// train for, what to keep in mind, what they pay — the trainer's notes, kept in the trainer's own
// profile and synced like any list of theirs. The student's training stays in the student's
// profile; a record points at it through the link (`studentId`) once the student has joined.
//
//   S.students [{ id, name, phone, email, goal, notes, restrictions, start, status,
//                 billing: { kind, amount, dueDay, classes }, studentId, history, created, _ts }]
//     status: active | paused | invited (no account linked yet) | ended (the link ended)
//     billing.kind: monthly | package | single; amount in the trainer's currency; dueDay 1..28
//       for a monthly fee; classes how many a package holds.
//     history: { workouts, customEx, unit, until } — the student's training up to the day a link
//       ended (copied by the server, api/server.js POST /api/trainer/unlink), read-only.
import { uid } from './format.js'

const list = v => (Array.isArray(v) ? v : [])
const text = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
const longText = (v, max) => String(v ?? '').replace(/\r/g, '').trim().slice(0, max)
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
export const STATUSES = ['active', 'paused', 'invited', 'ended']
export const BILLING = ['monthly', 'package', 'single']

/** A record as stored, from the form; { error } without a name. Keeps id and history of `prev`. */
export function normalizeStudent(input, { prev = null, now = Date.now() } = {}) {
  const name = text(input?.name, 60)
  if (!name) return { error: 'name' }
  const b = input?.billing || {}
  const kind = BILLING.includes(b.kind) ? b.kind : null
  const amount = Number(b.amount) > 0 ? Math.round(Number(b.amount) * 100) / 100 : null
  return {
    ...(prev || {}),
    id: prev?.id || input?.id || uid(),
    name,
    phone: text(input?.phone, 30).replace(/[^\d+() -]/g, '').trim(),
    email: text(input?.email, 80),
    goal: text(input?.goal, 120),
    notes: longText(input?.notes, 2000),
    restrictions: longText(input?.restrictions, 1000),
    start: DAY_RE.test(input?.start || '') ? input.start : prev?.start || null,
    status: STATUSES.includes(input?.status) ? input.status : prev?.status || (prev?.studentId ? 'active' : 'invited'),
    billing: kind ? { kind, amount, ...(kind === 'monthly' ? { dueDay: Math.min(28, Math.max(1, Math.round(Number(b.dueDay) || 5))) } : {}), ...(kind === 'package' ? { classes: Math.max(1, Math.round(Number(b.classes) || 8)) } : {}) } : null,
    studentId: prev?.studentId || null,
    created: prev?.created || now
  }
}

/** The address a student opens to join: the app's own, with the trainer's code and this record. */
export function inviteLink(base, code, recordId) {
  const root = String(base || '').replace(/[#?].*$/, '').replace(/\/$/, '')
  return `${root}/#/join?code=${encodeURIComponent(code)}&ref=${encodeURIComponent(recordId)}`
}

/** A WhatsApp link with `message`, to `phone` when there is one (digits, country code first). */
export function whatsappUrl(phone, message) {
  let digits = String(phone || '').replace(/\D/g, '')
  if (digits && digits.length <= 11) digits = '55' + digits   // a Brazilian number written without +55
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`
}

/**
 * The trainer's roster: every link (a student who joined) beside their record, and every record
 * with no link (invited, or a link that ended). A link finds its record by the record's id the
 * invite carried (`ref`), else by the student's id. Sorted: active first, then by name.
 * [{ key, record, link }] — either side may be null.
 */
export function roster(records, links) {
  const recs = list(records).filter(r => r && r.id)
  const used = new Set()
  const rows = list(links).map(l => {
    const record = recs.find(r => !used.has(r.id) && (r.id === l.ref || (r.studentId && r.studentId === l.student?.id))) || null
    if (record) used.add(record.id)
    return { key: 'l:' + l.id, record, link: l }
  })
  for (const r of recs) if (!used.has(r.id)) rows.push({ key: 'r:' + r.id, record: r, link: null })
  const rank = x => (x.link ? 0 : x.record?.status === 'invited' ? 1 : x.record?.status === 'paused' ? 2 : 3)
  const nameOf = x => x.record?.name || x.link?.student?.name || ''
  return rows.sort((a, b) => rank(a) - rank(b) || nameOf(a).localeCompare(nameOf(b), undefined, { sensitivity: 'base' }))
}

/**
 * The records with what the links say put in: a record a student joined through gets their id and
 * turns active; a record whose link is gone stays as it is (the server writes `ended` and the
 * history when a link ends). null when nothing changes.
 */
export function attachLinks(records, links) {
  let changed = false
  const out = list(records).map(r => {
    const l = list(links).find(x => x.ref === r.id || (r.studentId && x.student?.id === r.studentId))
    if (l && (r.studentId !== l.student.id || r.status === 'invited' || r.status === 'ended')) { changed = true; return { ...r, studentId: l.student.id, status: 'active' } }
    return r
  })
  return changed ? out : null
}
