// The Personal module, phase 9: a trainer's tasks, notices, documents and the AI draft of a
// student's plan, as the app keeps and reads them.
import { describe, expect, it } from 'vitest'
import { addTask, dueCount, normalizeTask, removeTask, taskGroups, toggleTask } from './tasks.js'
import { groupsOf, normalizeNotice, noticeReaches, noticesNewest, reachedBy } from './notices.js'
import * as server from '../../../api/trainer.js'
import { addDocument, documentsOf, normalizeDocument, removeDocument } from './trainer-docs.js'
import { draftForStudent, draftIntake } from './trainer-draft.js'

const H = c => c.repeat(64)
const pdf = h => ({ kind: 'doc', hash: H(h), mime: 'application/pdf', size: 2000, at: 1 })
const NOW = Date.parse('2026-10-27T12:00:00')

describe('a trainer’s tasks', () => {
  it('need a title; keep a day, a student and a note', () => {
    expect(normalizeTask({ title: '   ' }).error).toBe('title')
    const t = normalizeTask({ title: ' Ligar  para a Marília ', due: '2026-10-28', recordId: 'r1', note: 'renovar pacote' }, { now: 1 })
    expect(t).toMatchObject({ title: 'Ligar para a Marília', due: '2026-10-28', recordId: 'r1', note: 'renovar pacote', done: null, created: 1 })
    expect(normalizeTask({ title: 'x', due: '28/10' }).due).toBe(null)
    expect(normalizeTask({ title: 'novo' }, { prev: { ...t, done: 5 } })).toMatchObject({ id: t.id, done: 5, created: 1 })
  })

  it('fall into overdue, today, upcoming, some day and done', () => {
    const mk = (id, due, extra = {}) => ({ id, title: id, due, created: 1, done: null, ...extra })
    let tasks = [mk('late', '2026-10-20'), mk('now', '2026-10-27'), mk('soon2', '2026-11-02'), mk('soon1', '2026-10-30'), mk('any', null), mk('old', null, { done: NOW - 40 * 86400000 }), mk('ok', '2026-10-25', { done: NOW - 3600000 })]
    const g = taskGroups(tasks, '2026-10-27', { now: NOW })
    expect([g.overdue, g.today, g.upcoming, g.someday, g.done].map(x => x.map(t => t.id))).toEqual([['late'], ['now'], ['soon1', 'soon2'], ['any'], ['ok']])
    expect(dueCount(tasks, '2026-10-27')).toBe(2)
    tasks = toggleTask(tasks, 'late', NOW)
    expect(dueCount(tasks, '2026-10-27')).toBe(1)
    expect(toggleTask(tasks, 'late').find(t => t.id === 'late').done).toBe(null)
    expect(taskGroups([...tasks, mk('mari', null, { recordId: 'r1' })], '2026-10-27', { recordId: 'r1', now: NOW }).someday.map(t => t.id)).toEqual(['mari'])
    expect(removeTask(addTask(tasks, mk('x', null)), 'x')).toHaveLength(tasks.length)
  })
})

describe('a trainer’s notices', () => {
  const records = [
    { id: 'r1', name: 'Marília', studentId: 'mari', status: 'active', group: 'Manhã' },
    { id: 'r2', name: 'João', status: 'invited', group: ' manhã ' },
    { id: 'r3', name: 'Ana', studentId: 'ana', status: 'ended', group: 'Noite' },
    { id: 'r4', name: 'Bia', studentId: 'bia', status: 'paused', group: 'Online' }
  ]

  it('need a title and someone to reach', () => {
    expect(normalizeNotice({ to: { kind: 'all' } }).error).toBe('title')
    expect(normalizeNotice({ title: 'x', to: { kind: 'group', group: ' ' } }).error).toBe('to')
    expect(normalizeNotice({ title: 'x', to: { kind: 'student' } }).error).toBe('to')
    expect(normalizeNotice({ title: 'x', to: { kind: 'everyone' } }).error).toBe('to')
    expect(normalizeNotice({ title: ' Feriado ', body: 'Sem aulas.\r\n', to: { kind: 'group', group: 'Manhã', recordId: 'r1' } }, { now: 5 }))
      .toMatchObject({ title: 'Feriado', body: 'Sem aulas.', to: { kind: 'group', group: 'Manhã' }, at: 5 })
  })

  it('reach every student, a group, or one — never a link that ended', () => {
    const all = { to: { kind: 'all' } }, morning = { to: { kind: 'group', group: 'MANHÃ' } }, one = { to: { kind: 'student', recordId: 'r4' } }
    expect(reachedBy(records, all).map(r => r.id)).toEqual(['r1', 'r2', 'r4'])
    expect(reachedBy(records, morning).map(r => r.id)).toEqual(['r1', 'r2'])
    expect(reachedBy(records, one).map(r => r.id)).toEqual(['r4'])
    expect(groupsOf(records)).toEqual(['Manhã', 'Online'])
    expect(noticesNewest({ notices: [{ id: 'a', title: 'a', at: 1 }, { id: 'b', title: 'b', at: 3 }, null] }).map(n => n.id)).toEqual(['b', 'a'])
  })

  it('the server reads them by the same rule (api/trainer.js)', () => {
    const notices = [{ to: { kind: 'all' } }, { to: { kind: 'group', group: 'manhã' } }, { to: { kind: 'group', group: '' } }, { to: { kind: 'student', recordId: 'r2' } }, { to: {} }, null]
    for (const n of notices) for (const r of [...records, null, { id: 'x' }]) expect(server.noticeReaches(n, r)).toBe(noticeReaches(n, r))
  })
})

describe('a trainer’s documents of a student', () => {
  it('need a student and a PDF or a photo; shared only when said so', () => {
    expect(normalizeDocument({ m: pdf('a') }).error).toBe('student')
    expect(normalizeDocument({ recordId: 'r1' }).error).toBe('file')
    expect(normalizeDocument({ recordId: 'r1', m: { ...pdf('a'), kind: 'video', mime: 'video/mp4', width: 1, height: 1 } }).error).toBe('file')
    const d = normalizeDocument({ recordId: 'r1', kind: 'diet', title: ' Dieta  de outubro ', m: pdf('a'), shared: 'yes' }, { now: 1, today: '2026-10-27' })
    expect(d).toMatchObject({ recordId: 'r1', kind: 'diet', title: 'Dieta de outubro', d: '2026-10-27', shared: false, created: 1, m: { hash: H('a') } })
    expect(normalizeDocument({ recordId: 'r1', kind: 'x', m: pdf('b'), shared: true }).kind).toBe('other')
  })

  it('a student’s, newest first; gone when removed', () => {
    const docs = [{ id: '1', recordId: 'r1', d: '2026-09-01', m: pdf('a') }, { id: '2', recordId: 'r1', d: '2026-10-01', m: pdf('b') }, { id: '3', recordId: 'r2', d: '2026-10-05', m: pdf('c') }, { id: '4', recordId: 'r1', d: '2026-10-09', m: { hash: 'bad' } }]
    expect(documentsOf({ documents: docs }, 'r1').map(d => d.id)).toEqual(['2', '1'])
    expect(removeDocument(addDocument(docs, { id: '5' }), '5')).toHaveLength(4)
  })
})

describe('the AI draft of a student’s plan', () => {
  it('asks with the record’s restrictions and goal, and the trainer’s answers', () => {
    const rec = { goal: 'Correr uma meia maratona', restrictions: 'Joelho direito operado', notes: 'Prefere treinos curtos' }
    const i = draftIntake(rec, { goal: 'endurance', experience: 'returning', preferredDays: [5, 1, 3, 3], sessionMin: 45, notes: 'Treina em academia completa' })
    expect(i).toMatchObject({ goal: 'endurance', experience: 'returning', daysPerWeek: 3, preferredDays: [1, 3, 5], sessionMin: 45, limitations: 'Joelho direito operado', equipment: [] })
    expect(i.notes.split('\n')).toEqual(['Goal in their words: Correr uma meia maratona', 'Prefere treinos curtos', 'Treina em academia completa'])
    expect(draftIntake(null, { goal: 'x', daysPerWeek: 9 })).toMatchObject({ goal: 'general', experience: 'regular', daysPerWeek: 7, sessionMin: 60, limitations: '' })
  })

  it('sends new routines and a week by their ids, without the AI’s reasons or inventions', () => {
    const plan = {
      week: { 1: 'r1', 4: 'r2' },
      routines: [
        { id: 'r1', name: 'A', emoji: 'barbell', prog: 'linear', why: 'porque', ex: [{ id: '1064', sets: 3, mode: 'reps', reps: 8, why: 'base' }, { id: 'cx1', sets: 2, mode: 'reps', reps: 10 }] },
        { id: 'r2', name: 'B', ex: [{ id: 'cx1', sets: 3, mode: 'reps', reps: 10 }] }
      ],
      customEx: [{ id: 'cx1', n: 'Invenção', bp: 'back' }]
    }
    const out = draftForStudent(plan, 'kg')
    expect(out.routines).toHaveLength(1)
    const [a] = out.routines
    expect(a.id).not.toBe('r1')
    expect(a).toMatchObject({ name: 'A', emoji: 'barbell', prog: 'linear' })
    expect(a.why).toBeUndefined()
    expect(a.ex).toEqual([{ id: '1064', sets: 3, mode: 'reps', reps: 8 }])
    expect(out.week).toEqual({ 1: [a.id] })
    expect(draftForStudent(plan, 'kg', { schedule: false }).week).toBeUndefined()
  })
})
