import { describe, expect, it } from 'vitest'
import { coachRecords, coachTrainingOf, coachView, dropCoach, flushOutbox, queueCoach, readOutbox, setCoachTraining } from './trainer-session.js'
import { sessionHistory } from './backfill.js'

const memory = () => {
  const m = new Map()
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }
}
const failing = status => Object.assign(new Error('nope'), { status })

describe('a session run with a student', () => {
  const training = { unit: 'kg', workouts: [{ id: 'w1', d: '2026-10-20', entries: [{ id: '0025', sets: [{ w: 60, r: 8, done: true }] }] }], exWeights: { '0025': { w: 60, d: '2026-10-20' } }, routines: [{ id: 'r', name: 'A', ex: [] }], customEx: [{ id: 'c1', name: 'Hers' }] }
  const S = { unit: 'kg', restSec: 90, workouts: [{ id: 'mine' }], exWeights: { '0025': { w: 100 } }, routines: [{ id: 'own' }], customEx: [] }

  it('reads the trainer’s settings with the student’s training', () => {
    const H = coachView(S, training)
    expect(H.restSec).toBe(90)
    expect(H.workouts.map(w => w.id)).toEqual(['w1'])
    expect(H.exWeights['0025'].w).toBe(60)
    expect(H.routines.map(r => r.id)).toEqual(['r'])
    expect(coachView(S, null)).toBe(S)
  })

  it('is what sessionHistory holds the session against, once the training is here', () => {
    const st = { ...S, active: { id: 'a', coach: { id: 'stu' }, entries: [] } }
    expect(sessionHistory(st)).toBe(st)
    setCoachTraining('stu', training)
    expect(coachTrainingOf('stu')).toBe(training)
    expect(sessionHistory(st).workouts.map(w => w.id)).toEqual(['w1'])
  })

  it('records against the student, not the trainer', () => {
    const H = coachView(S, training)
    const entries = [
      { id: '0025', sets: [{ w: 40, r: 10, done: true, type: 'warmup' }, { w: 65, r: 6, done: true }] },
      { id: '0043', sets: [{ w: 20, r: 10, done: false }] },
    ]
    const out = coachRecords(H, entries, '2026-10-26')
    expect(out.prs).toEqual(['0025'])
    expect(out.best).toEqual({ '0025': { w: 65, d: '2026-10-26' } })
    expect(coachRecords(H, [{ id: '0025', sets: [{ w: 50, r: 8, done: true }] }], '2026-10-26')).toEqual({ prs: [], best: {} })
  })
})

describe('the outbox of workouts for students', () => {
  const item = id => ({ id: 'stu', name: 'Ana', workout: { id, d: '2026-10-26', name: 'A', entries: [] }, best: {} })

  it('keeps one of each workout, oldest first', () => {
    const store = memory()
    queueCoach(item('a'), store); queueCoach(item('b'), store); queueCoach(item('a'), store)
    expect(readOutbox(store).map(x => x.workout.id)).toEqual(['b', 'a'])
    dropCoach('b', store)
    expect(readOutbox(store).map(x => x.workout.id)).toEqual(['a'])
  })

  it('drops what was sent, marks what the server refused, keeps what found no network', async () => {
    const store = memory()
    for (const id of ['ok', 'gone', 'offline']) queueCoach(item(id), store)
    const out = await flushOutbox(it => (it.workout.id === 'ok' ? Promise.resolve({}) : Promise.reject(it.workout.id === 'gone' ? failing(404) : new TypeError('Failed to fetch'))), store)
    expect(out).toEqual({ sent: 1, failed: 1, left: 2 })
    expect(readOutbox(store).map(x => [x.workout.id, x.error || null])).toEqual([['gone', 'nope'], ['offline', null]])
  })

  it('reads nothing out of a store that holds something else', () => {
    const store = memory()
    store.setItem('gym_coach_outbox_v1', '{bad')
    expect(readOutbox(store)).toEqual([])
    expect(readOutbox(null)).toEqual([])
  })
})
