import { describe, expect, it } from 'vitest'
import { addMonths, addPayment, dueDate, expectedIn, financeOf, normalizePayment, paymentsIn, removePayment, revenueByMonth, standingOf, suggestedPayment } from './finance.js'

const rec = (id, billing, extra = {}) => ({ id, name: id, status: 'active', billing, ...extra })
const pay = (recordId, d, amount, kind, extra = {}) => ({ id: recordId + d + kind + (extra.ref || ''), recordId, d, amount, kind, ...extra })
const done = (recordId, d) => ({ id: recordId + d, recordId, d, time: '07:00', dur: 60, status: 'done' })

describe('months', () => {
  it('counts months across a year and puts the due day in its month', () => {
    expect(addMonths('2026-11', 2)).toBe('2027-01')
    expect(addMonths('2026-01', -1)).toBe('2025-12')
    expect(dueDate('2026-10', 5)).toBe('2026-10-05')
    expect(dueDate('2026-02', 31)).toBe('2026-02-28')
  })
})

describe('a payment from the form', () => {
  it('needs a student, a day and an amount, and keeps what its kind needs', () => {
    expect(normalizePayment({ d: '2026-10-05', amount: 350 }).error).toBe('student')
    expect(normalizePayment({ recordId: 'a', amount: 350 }).error).toBe('day')
    expect(normalizePayment({ recordId: 'a', d: '2026-10-05', amount: 0 }).error).toBe('amount')
    const m = normalizePayment({ recordId: 'a', d: '2026-10-05', amount: '350.004', kind: 'monthly', classes: 3 }, { now: 1 })
    expect(m).toMatchObject({ recordId: 'a', amount: 350, kind: 'monthly', ref: '2026-10', created: 1 })
    expect(m.classes).toBeUndefined()
    expect(normalizePayment({ recordId: 'a', d: '2026-10-05', amount: 600, kind: 'package', classes: 8 })).toMatchObject({ kind: 'package', classes: 8 })
    expect(normalizePayment({ recordId: 'a', d: '2026-10-05', amount: 90, kind: 'x' }).kind).toBe('other')
    const list = addPayment([], m)
    expect(addPayment(list, { ...m, amount: 400 }).map(p => p.amount)).toEqual([400])
    expect(removePayment(list, m.id)).toEqual([])
  })
})

describe('a monthly fee', () => {
  const r = rec('mari', { kind: 'monthly', amount: 350, dueDay: 5, since: '2026-08' })

  it('owes every month since the billing started that has no payment, late past its due day', () => {
    const S = { students: [r], payments: [pay('mari', '2026-08-04', 350, 'monthly', { ref: '2026-08' })] }
    const s = standingOf(S, r, '2026-10-10')
    expect(s.state).toBe('overdue')
    expect(s.months.map(m => [m.month, m.late])).toEqual([['2026-09', true], ['2026-10', true]])
    expect(s.owed).toBe(700)
  })

  it('is upcoming before the due day and due on it, then points at the next month once paid', () => {
    const S = { students: [r], payments: ['08', '09'].map(m => pay('mari', `2026-${m}-05`, 350, 'monthly', { ref: `2026-${m}` })) }
    expect(standingOf(S, r, '2026-10-02')).toMatchObject({ state: 'upcoming', owed: 0, next: '2026-10-05' })
    expect(standingOf(S, r, '2026-10-05')).toMatchObject({ state: 'due', owed: 350 })
    const paid = { ...S, payments: [...S.payments, pay('mari', '2026-10-03', 350, 'monthly', { ref: '2026-10' })] }
    expect(standingOf(paid, r, '2026-10-03')).toMatchObject({ state: 'ok', owed: 0, next: '2026-11-05' })
  })

  it('owes nothing from before the billing was set', () => {
    const fresh = rec('ana', { kind: 'monthly', amount: 300, dueDay: 10, since: '2026-10' }, { start: '2025-01-01' })
    expect(standingOf({ students: [fresh] }, fresh, '2026-10-20').months.map(m => m.month)).toEqual(['2026-10'])
  })
})

describe('a package of classes', () => {
  const r = rec('joao', { kind: 'package', amount: 600, classes: 8, since: '2026-09' })

  it('counts the classes done since the first package against the ones bought', () => {
    const sessions = ['2026-09-30', '2026-10-01', '2026-10-03', '2026-10-06', '2026-10-08', '2026-10-10', '2026-10-13'].map(d => done('joao', d))
    const S = { students: [r], sessions, payments: [pay('joao', '2026-10-01', 600, 'package', { classes: 8 })] }
    expect(standingOf(S, r, '2026-10-14')).toMatchObject({ state: 'ok', bought: 8, used: 6, left: 2, owed: 0 })
    const one = { ...S, sessions: [...sessions, done('joao', '2026-10-15')] }
    expect(standingOf(one, r, '2026-10-16')).toMatchObject({ state: 'low', left: 1 })
    const none = { ...S, sessions: [...one.sessions, done('joao', '2026-10-17')] }
    expect(standingOf(none, r, '2026-10-18')).toMatchObject({ state: 'due', left: 0, owed: 600 })
  })

  it('is due before the first package is paid', () => {
    expect(standingOf({ students: [r] }, r, '2026-10-01')).toMatchObject({ state: 'due', owed: 600 })
  })
})

describe('classes paid one by one', () => {
  const r = rec('bia', { kind: 'single', amount: 90, since: '2026-10' })
  it('owes each class done and not yet paid; a cancelled one is not owed', () => {
    const sessions = [done('bia', '2026-10-02'), done('bia', '2026-10-09'), done('bia', '2026-10-16'), { ...done('bia', '2026-10-23'), status: 'canceled' }, done('bia', '2026-09-25')]
    const S = { students: [r], sessions, payments: [pay('bia', '2026-10-02', 90, 'single', { classes: 1 })] }
    expect(standingOf(S, r, '2026-10-24')).toMatchObject({ state: 'due', classes: 2, owed: 180 })
    expect(suggestedPayment(r, standingOf(S, r, '2026-10-24'), '2026-10-24')).toMatchObject({ kind: 'single', classes: 2, amount: 180 })
  })
})

describe('the whole picture', () => {
  const students = [
    rec('mari', { kind: 'monthly', amount: 350, dueDay: 5, since: '2026-10' }),
    rec('joao', { kind: 'package', amount: 600, classes: 8, since: '2026-10' }),
    rec('ana', { kind: 'monthly', amount: 300, dueDay: 20, since: '2026-10' }),
    rec('old', { kind: 'monthly', amount: 999, dueDay: 1, since: '2026-01' }, { status: 'ended' }),
    rec('free', null),
  ]
  const S = { students, sessions: [], payments: [pay('joao', '2026-10-01', 600, 'package', { classes: 8 }), pay('ana', '2026-09-20', 300, 'other'), pay('x', '2026-10-02', 50, 'other')] }

  it('lists who to act on first and what to collect, leaving out ended links and unbilled students', () => {
    const f = financeOf(S, '2026-10-10')
    expect(f.rows.map(r => [r.record.id, r.standing.state])).toEqual([['mari', 'overdue'], ['ana', 'upcoming'], ['joao', 'ok']])
    expect([f.pending, f.late, f.toCollect]).toEqual([350, 1, 1])
  })

  it('adds up what came in by month and what a month should bring', () => {
    expect(revenueByMonth(S, '2026-10-10', 3)).toEqual([{ month: '2026-08', total: 0, count: 0 }, { month: '2026-09', total: 300, count: 1 }, { month: '2026-10', total: 650, count: 2 }])
    expect(paymentsIn(S, '2026-10').map(p => p.recordId)).toEqual(['x', 'joao'])
    expect(expectedIn(S, '2026-10')).toBe(650)
    expect(expectedIn(S, '2026-09')).toBe(0)
  })
})
