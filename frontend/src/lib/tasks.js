// A trainer's own to-do list (the Personal module, phase 9): call a student back, send the new
// plan, renew a contract — each with a day when it is due and, when it is about a student, their
// record. Kept in the trainer's own profile and synced like any list of theirs.
//
//   S.tasks [{ id, title, due, recordId, note, done, created, _ts }]
//     due 'YYYY-MM-DD' | null (some day); recordId: the student it is about, or null;
//     done: when it was ticked off (ms), null while open.
import { uid } from './format.js'

const list = v => (Array.isArray(v) ? v : [])
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
const DONE_DAYS = 30

/** A task as stored, from the form; { error: 'title' } without one. Keeps id, done and created. */
export function normalizeTask(input, { prev = null, now = Date.now() } = {}) {
  const title = String(input?.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 140)
  if (!title) return { error: 'title' }
  return {
    ...(prev || {}),
    id: prev?.id || input?.id || uid(),
    title,
    due: DAY_RE.test(input?.due || '') ? input.due : null,
    recordId: typeof input?.recordId === 'string' && input.recordId ? input.recordId : null,
    note: String(input?.note ?? '').replace(/\r/g, '').trim().slice(0, 1000),
    done: prev?.done || null,
    created: prev?.created || now
  }
}
export const addTask = (tasks, task) => [...list(tasks).filter(x => x?.id !== task.id), task]
export const removeTask = (tasks, id) => list(tasks).filter(x => x?.id !== id)
/** The task `id` ticked off now, or open again. */
export const toggleTask = (tasks, id, now = Date.now()) => list(tasks).map(x => (x?.id === id ? { ...x, done: x.done ? null : now } : x))

const byDue = (a, b) => (a.due && b.due ? (a.due < b.due ? -1 : a.due > b.due ? 1 : 0) : a.due ? -1 : b.due ? 1 : 0) || (a.created || 0) - (b.created || 0)
/**
 * The list as the screen reads it on `today`: overdue, today, upcoming (a day ahead), someday (no
 * day), each soonest first, and done — the ones ticked off in the last 30 days, latest first.
 * `recordId` narrows it to one student's.
 */
export function taskGroups(tasks, today, { recordId = null, now = Date.now() } = {}) {
  const all = list(tasks).filter(x => x && typeof x.title === 'string' && (!recordId || x.recordId === recordId))
  const open = all.filter(x => !x.done).sort(byDue)
  return {
    overdue: open.filter(x => x.due && x.due < today),
    today: open.filter(x => x.due === today),
    upcoming: open.filter(x => x.due && x.due > today),
    someday: open.filter(x => !x.due),
    done: all.filter(x => x.done && x.done > now - DONE_DAYS * 86400000).sort((a, b) => b.done - a.done)
  }
}

/** How many open tasks are due by `today` (the overdue ones and today's): the badge on Today. */
export const dueCount = (tasks, today) => list(tasks).filter(x => x && !x.done && x.due && x.due <= today).length
