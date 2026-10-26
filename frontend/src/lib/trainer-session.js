// The Personal module, phase 6: a trainer runs a workout with a student on the trainer's own phone
// — the same workout screen, its clock and rest timer — and the workout goes to the student's
// history (POST /api/trainer/student/workout), not the trainer's. The running session carries
// `coach: { id, name, recordId?, cls? }`; what it is built from and held against ("last time", the
// best set, the prescription) is the student's training, read from the server and kept here in
// memory only: a student's history is not written into the trainer's profile.
import { bestWeightFor, bestWeightForEntry } from './history.js'
import { beatsWeight, betterWeight } from './exercises.js'
import { isWarmupRow } from './workout-model.js'
import { entryDbLoad } from './dumbbells.js'
import { api } from './api.js'

const list = v => (Array.isArray(v) ? v : [])
const trainings = new Map()

/** The student's training (GET /api/trainer/student), kept for the session run with them. */
export const setCoachTraining = (id, training) => { if (id && training) trainings.set(id, training) }
export const coachTrainingOf = id => trainings.get(id) || null

/**
 * The trainer's state read as the student's training: the trainer's settings, the student's
 * workouts, best loads, routines and custom exercises. `S` itself when the training is not here.
 */
export function coachView(S, training) {
  if (!training) return S
  return {
    ...S,
    workouts: list(training.workouts),
    exWeights: training.exWeights && typeof training.exWeights === 'object' ? training.exWeights : {},
    routines: list(training.routines),
    customEx: list(training.customEx),
    unit: training.unit || S.unit,
  }
}

/**
 * What a finished session with a student set, held against the student's history `H`: the
 * exercises whose top load is a record (`prs`), and the best loads that moved (`best`, exercise
 * id → { w, d }), which the server writes into the student's exWeights.
 */
export function coachRecords(H, entries, d) {
  const prs = [], best = {}
  for (const e of list(entries)) {
    const loads = list(e?.sets).filter(s => s?.done && !isWarmupRow(s)).map(s => s.w).filter(w => w > 0)
    if (!loads.length) continue
    const mx = loads.reduce((a, b) => betterWeight(e.id, a, b))
    if (beatsWeight(e.id, mx, bestWeightFor(H, e.id, entryDbLoad(e)))) prs.push(e.id)
    const top = bestWeightForEntry(e)
    if (top > 0 && beatsWeight(e.id, top, (H.exWeights?.[e.id] || {}).w || 0)) best[e.id] = { w: top, d }
  }
  return { prs, best }
}

// The workouts finished with a student that have not reached the server yet (no signal at the
// gym): this device's own, never synced — the student's training does not ride in the trainer's
// profile. Each { id, name, workout, best, error? }; `error` when the server refused it (the link
// ended), kept so the trainer sees it instead of losing a workout.
const KEY = 'gym_coach_outbox_v1'
export function readOutbox(store = globalThis.localStorage) {
  try { const v = JSON.parse(store?.getItem(KEY) || '[]'); return Array.isArray(v) ? v.filter(x => x?.workout?.id) : [] } catch { return [] }
}
function writeOutbox(xs, store = globalThis.localStorage) {
  try { if (xs.length) store?.setItem(KEY, JSON.stringify(xs)); else store?.removeItem(KEY) } catch { /* private mode: the send just happened or did not */ }
}
export function queueCoach(item, store) {
  writeOutbox([...readOutbox(store).filter(x => x.workout.id !== item.workout.id), item], store)
}
export const dropCoach = (wid, store) => writeOutbox(readOutbox(store).filter(x => x.workout.id !== wid), store)

/**
 * Sends what is waiting, oldest first, with `send(item)` (a promise). A sent one leaves the
 * outbox; one the server refused (4xx) stays marked with the reason; a network failure stays as
 * it was, for the next try. Resolves { sent, failed, left }.
 */
export async function flushOutbox(send, store) {
  let sent = 0, failed = 0
  for (const it of readOutbox(store)) {
    try {
      await send(it)
      dropCoach(it.workout.id, store)
      sent++
    } catch (e) {
      if (e?.status >= 400 && e.status < 500) {
        writeOutbox(readOutbox(store).map(x => (x.workout.id === it.workout.id ? { ...x, error: e.message || String(e.status) } : x)), store)
        failed++
      }
    }
  }
  return { sent, failed, left: readOutbox(store).length }
}

/** The outbox sent to the server (POST /api/trainer/student/workout), one send at a time. */
let sending = null
export const sendCoachOutbox = () => (sending ||= flushOutbox(it => api('/api/trainer/student/workout', { method: 'POST', body: JSON.stringify({ id: it.id, workout: it.workout, best: it.best }) }))
  .finally(() => { sending = null }))
