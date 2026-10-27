// A trainer's documents of a student (the Personal module, phase 9): a contract, a diet, a medical
// certificate — a PDF or a photo each, kept in the trainer's own profile (the file in their media,
// media-refs.js walks documents[].m) and synced like any list of theirs. One the trainer shares,
// the student reads and opens in their own app (api/trainer.js documentsFor).
//
//   S.documents [{ id, recordId, kind, title, d, m, shared, note, created, _ts }]
//     kind: contract | diet | certificate | other; d: the document's day; m: a MediaRef of kind
//     'doc' or 'image'; shared: the student sees it too.
import { normalizeMediaRef } from './media-refs.js'
import { uid } from './format.js'

const list = v => (Array.isArray(v) ? v : [])
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
export const DOC_KINDS = ['contract', 'diet', 'certificate', 'other']

/** A document as stored, from the form; { error } without a student ('student') or a file ('file'). */
export function normalizeDocument(input, { prev = null, now = Date.now(), today = null } = {}) {
  if (!input?.recordId) return { error: 'student' }
  const m = normalizeMediaRef(input.m)
  if (!m || (m.kind !== 'doc' && m.kind !== 'image')) return { error: 'file' }
  const kind = DOC_KINDS.includes(input.kind) ? input.kind : 'other'
  return {
    ...(prev || {}),
    id: prev?.id || input.id || uid(),
    recordId: String(input.recordId),
    kind,
    title: String(input.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 100),
    d: DAY_RE.test(input.d || '') ? input.d : prev?.d || today,
    m,
    shared: input.shared === true,
    note: String(input.note ?? '').replace(/\r/g, '').trim().slice(0, 500),
    created: prev?.created || now
  }
}
export const addDocument = (docs, doc) => [...list(docs).filter(x => x?.id !== doc.id), doc]
export const removeDocument = (docs, id) => list(docs).filter(x => x?.id !== id)

/** A student's documents, newest first. */
export const documentsOf = (S, recordId) => list(S?.documents).filter(x => x && x.recordId === recordId && normalizeMediaRef(x.m))
  .sort((a, b) => (a.d < b.d ? 1 : a.d > b.d ? -1 : (b.created || 0) - (a.created || 0)))
