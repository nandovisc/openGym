// A trainer's notices to students (the Personal module, phase 9): a holiday, a change of hours, a
// word to the morning group — to every student, to a group (the record's `group`), or to one.
// Kept in the trainer's own profile and synced like any list of theirs; each student reads the
// ones meant for them from it (api/trainer.js noticesFor, the same rule as noticeReaches here —
// notices-parity.test.js holds both), and a push tells them when it is sent.
//
//   S.notices [{ id, title, body, to, at, sent, _ts }]
//     to: { kind: 'all' } | { kind: 'group', group } | { kind: 'student', recordId }
//     at: when it was sent (ms); sent: how many students the push went to.
import { uid } from './format.js'

const list = v => (Array.isArray(v) ? v : [])
const KINDS = ['all', 'group', 'student']

/** A notice as stored, from the form; { error } without a title ('title') or someone to reach ('to'). */
export function normalizeNotice(input, { now = Date.now() } = {}) {
  const title = String(input?.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 100)
  if (!title) return { error: 'title' }
  const t = input?.to || {}
  const kind = KINDS.includes(t.kind) ? t.kind : null
  const group = String(t.group ?? '').replace(/\s+/g, ' ').trim().slice(0, 40)
  if (!kind || (kind === 'group' && !group) || (kind === 'student' && !t.recordId)) return { error: 'to' }
  return {
    id: input.id || uid(),
    title,
    body: String(input?.body ?? '').replace(/\r/g, '').trim().slice(0, 2000),
    to: kind === 'all' ? { kind } : kind === 'group' ? { kind, group } : { kind, recordId: String(t.recordId) },
    at: now
  }
}

/**
 * Whether `notice` is for the student of `record`: every student, the students of a group (the
 * record's `group`, compared without case or spaces around), or this one. Never a record whose
 * link ended.
 */
export function noticeReaches(notice, record) {
  if (!notice || !record || record.status === 'ended') return false
  const to = notice.to || {}
  if (to.kind === 'all') return true
  if (to.kind === 'group') return !!to.group && String(record.group || '').trim().toLowerCase() === String(to.group).trim().toLowerCase()
  if (to.kind === 'student') return to.recordId === record.id
  return false
}

/** The records a notice reaches. Only those with an account (`studentId`) read it in the app. */
export const reachedBy = (records, notice) => list(records).filter(r => r && noticeReaches(notice, r))

/** The groups the records name, each once (the first spelling), in alphabetical order. */
export function groupsOf(records) {
  const seen = new Map()
  for (const r of list(records)) {
    const g = String(r?.group || '').trim()
    if (g && r.status !== 'ended' && !seen.has(g.toLowerCase())) seen.set(g.toLowerCase(), g)
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b))
}

/** The trainer's notices, newest first. */
export const noticesNewest = S => list(S?.notices).filter(n => n && typeof n.title === 'string').sort((a, b) => (b.at || 0) - (a.at || 0))
