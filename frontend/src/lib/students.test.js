import { describe, expect, it } from 'vitest'
import { attachLinks, inviteLink, normalizeStudent, roster, whatsappUrl } from './students.js'

describe('a trainer’s records of their students', () => {
  it('a record from the form: a name required, billing kept to what its kind needs', () => {
    expect(normalizeStudent({ name: ' ' }).error).toBe('name')
    const r = normalizeStudent({ name: 'Marília', phone: '(11) 98888-7777 x', goal: 'Hipertrofia', billing: { kind: 'monthly', amount: '350', dueDay: 40, classes: 9 } }, { now: 1 })
    expect(r).toMatchObject({ name: 'Marília', phone: '(11) 98888-7777', status: 'invited', billing: { kind: 'monthly', amount: 350, dueDay: 28 }, studentId: null, created: 1 })
    expect(r.billing.classes).toBeUndefined()
    expect([r.birth, r.sex]).toEqual([null, null])
    expect(normalizeStudent({ name: 'Ana', birth: '1995-01-10', sex: 'f' })).toMatchObject({ birth: '1995-01-10', sex: 'f' })
    expect(normalizeStudent({ name: 'Ana', birth: '10/01/1995', sex: 'x' })).toMatchObject({ birth: null, sex: null })
    const p = normalizeStudent({ name: 'João', billing: { kind: 'package', amount: 600 } }, { now: Date.parse('2026-10-26T12:00:00') })
    expect(p.billing).toEqual({ kind: 'package', amount: 600, classes: 8, since: '2026-10' })
    // The month the billing started stays while its kind does, and starts again with a new kind.
    expect(normalizeStudent({ name: 'João', billing: { kind: 'package', amount: 700 } }, { prev: p, now: Date.parse('2027-01-10T12:00:00') }).billing.since).toBe('2026-10')
    expect(normalizeStudent({ name: 'João', billing: { kind: 'single', amount: 90 } }, { prev: p, now: Date.parse('2027-01-10T12:00:00') }).billing.since).toBe('2027-01')
    const kept = normalizeStudent({ name: 'Marília B.' }, { prev: { ...r, studentId: 'm', history: { until: '2026-10-01' } } })
    expect(kept).toMatchObject({ id: r.id, studentId: 'm', history: { until: '2026-10-01' } })
  })
  it('an invite: the app’s address with the code and the record, and a WhatsApp message', () => {
    expect(inviteLink('https://open-gym-tau.vercel.app/#/students', 'PT-ABC', 'r1')).toBe('https://open-gym-tau.vercel.app/#/join?code=PT-ABC&ref=r1')
    expect(whatsappUrl('(11) 98888-7777', 'Oi')).toBe('https://wa.me/5511988887777?text=Oi')
    expect(whatsappUrl('', 'Oi Marília')).toBe('https://wa.me/?text=Oi%20Mar%C3%ADlia')
  })
  it('the roster: each link beside its record, records with no link after, active first', () => {
    const records = [{ id: 'r1', name: 'Marília', status: 'invited' }, { id: 'r2', name: 'Ana', status: 'invited' }, { id: 'r3', name: 'Bruno', status: 'ended', studentId: 'b' }]
    const links = [{ id: 'l1', ref: 'r1', student: { id: 'm', name: 'Marília' } }, { id: 'l2', student: { id: 'z', name: 'Zeca' } }]
    expect(roster(records, links).map(x => [x.record?.name || null, x.link?.id || null])).toEqual([
      ['Marília', 'l1'], [null, 'l2'], ['Ana', null], ['Bruno', null]
    ])
    expect(attachLinks(records, links).find(r => r.id === 'r1')).toMatchObject({ studentId: 'm', status: 'active' })
    expect(attachLinks(attachLinks(records, links), links)).toBe(null)
  })
})
