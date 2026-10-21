import { describe, expect, it } from 'vitest'
import {
  adherence, daysBefore, doseId, doseState, dosesOn, extraDosesOn, history, isScheduledOn, logExtraDose,
  markDose, normalizeMed, normalizeTimes, unmark, weekdayOf
} from './meds.js'
import { mergeStates, stampChange } from './sync-merge.js'

const med = (over = {}) => ({ id: 'm1', name: 'Losartana', dose: '50', unit: 'mg', times: ['08:00', '20:00'], days: null, start: '2026-10-01', end: null, active: true, notes: '', ...over })

describe('normalizeMed', () => {
  it('needs a name, keeps valid times once and in order, and every weekday means every day', () => {
    expect(normalizeMed({ name: '  ' })).toEqual({ error: 'name' })
    const m = normalizeMed({ name: ' Vitamina D ', times: ['20:00', '08:00', '08:00', '25:00', 'x'], days: [0, 1, 2, 3, 4, 5, 6], unit: 'drops' }, { today: '2026-10-21' })
    expect(m.name).toBe('Vitamina D')
    expect(m.times).toEqual(['08:00', '20:00'])
    expect(m.days).toBeNull()
    expect(m.start).toBe('2026-10-21')
    expect(m.active).toBe(true)
    expect(m.unit).toBe('drops')
    expect(typeof m.id).toBe('string')
  })
  it('refuses an end before the start, and keeps the id and sync stamps of the entry it edits', () => {
    expect(normalizeMed({ name: 'A', start: '2026-10-10', end: '2026-10-01' })).toEqual({ error: 'end' })
    const prev = { ...med(), _ts: 5, _f: { dose: 5 } }
    const m = normalizeMed({ name: 'Losartana', dose: '100', unit: 'mg', times: ['09:00'], days: [1, 3] }, { prev })
    expect(m.id).toBe('m1')
    expect(m._ts).toBe(5)
    expect(m.dose).toBe('100')
    expect(m.days).toEqual([1, 3])
    expect(m.start).toBe('2026-10-01')
  })
  it('caps the number of times a day', () => {
    expect(normalizeTimes(Array.from({ length: 12 }, (_, i) => `${String(i).padStart(2, '0')}:00`))).toHaveLength(8)
  })
})

describe('the doses of a day', () => {
  it('follows the weekdays, the start and end, and a pause', () => {
    expect(weekdayOf('2026-10-21')).toBe(3)   // a Wednesday
    expect(isScheduledOn(med({ days: [3] }), '2026-10-21')).toBe(true)
    expect(isScheduledOn(med({ days: [1] }), '2026-10-21')).toBe(false)
    expect(isScheduledOn(med(), '2026-09-30')).toBe(false)
    expect(isScheduledOn(med({ end: '2026-10-20' }), '2026-10-21')).toBe(false)
    expect(isScheduledOn(med({ active: false }), '2026-10-21')).toBe(false)
  })
  it('lists each time of each medication in the order of the day, with its record', () => {
    const meds = [med(), med({ id: 'm2', name: 'Atenolol', times: ['08:00'] })]
    const log = [{ id: doseId('m1', '2026-10-21', '08:00'), medId: 'm1', d: '2026-10-21', time: '08:00', status: 'taken', at: 1 }]
    const ds = dosesOn(meds, log, '2026-10-21')
    expect(ds.map(x => `${x.time} ${x.med.name}`)).toEqual(['08:00 Atenolol', '08:00 Losartana', '20:00 Losartana'])
    expect(ds[1].entry.status).toBe('taken')
  })
  it('keeps a recorded dose of a medication paused since', () => {
    const log = [{ id: doseId('m1', '2026-10-21', '08:00'), medId: 'm1', d: '2026-10-21', time: '08:00', status: 'taken', at: 1 }]
    expect(dosesOn([med({ active: false })], log, '2026-10-21').map(x => x.time)).toEqual(['08:00'])
  })
  it('tells upcoming, due, late, taken and skipped apart', () => {
    const [d8, d20] = dosesOn([med()], [], '2026-10-21')
    expect(doseState(d8, { d: '2026-10-21', hhmm: '07:59' })).toBe('upcoming')
    expect(doseState(d8, { d: '2026-10-21', hhmm: '08:10' })).toBe('due')
    expect(doseState(d8, { d: '2026-10-21', hhmm: '08:31' })).toBe('late')
    expect(doseState(d20, { d: '2026-10-22', hhmm: '00:01' })).toBe('late')
    expect(doseState({ ...d8, entry: { status: 'skipped' } }, { d: '2026-10-21', hhmm: '07:00' })).toBe('skipped')
  })
})

describe('marking doses', () => {
  it('marks, re-marks and unmarks one entry per dose', () => {
    const [d8] = dosesOn([med()], [], '2026-10-21')
    let log = markDose([], d8, 'taken', 10)
    log = markDose(log, d8, 'skipped', 20)
    expect(log).toEqual([{ id: d8.id, medId: 'm1', d: '2026-10-21', time: '08:00', status: 'skipped', at: 20 }])
    expect(unmark(log, d8.id)).toEqual([])
  })
  it('logs an extra dose of its own', () => {
    const at = new Date(2026, 9, 21, 15, 4).getTime()
    const log = logExtraDose([], med(), at)
    expect(extraDosesOn(log, '2026-10-21')).toHaveLength(1)
    expect(log[0]).toMatchObject({ medId: 'm1', d: '2026-10-21', time: '15:04', status: 'taken', extra: true })
  })
})

describe('adherence', () => {
  it('counts taken, skipped and missed doses, not the ones still to come', () => {
    const meds = [med()]
    const days = ['2026-10-20', '2026-10-21']
    let log = []
    for (const dose of dosesOn(meds, [], days[0])) log = markDose(log, dose, dose.time === '08:00' ? 'taken' : 'skipped', 1)
    const [today8] = dosesOn(meds, log, days[1])
    log = markDose(log, today8, 'taken', 2)
    // 20 Oct: one taken, one skipped; 21 Oct at noon: 08:00 taken, 20:00 still to come.
    const a = adherence(meds, log, days[0], days[1], { d: '2026-10-21', hhmm: '12:00' })
    expect(a).toMatchObject({ counted: 3, taken: 2, skipped: 1, missed: 0, pct: 67 })
    expect(a.days.map(x => x.d)).toEqual(days)
    // a day later with nothing marked on the 21st's evening dose: it is missed
    expect(adherence(meds, log, days[0], days[1], { d: '2026-10-22', hhmm: '09:00' }).missed).toBe(1)
  })
  it('does not count as missed a dose that was past before the medication was added', () => {
    const added = new Date('2026-10-21T12:00:00').getTime()
    const a = adherence([med({ created: added })], [], '2026-10-21', '2026-10-21', { d: '2026-10-22', hhmm: '09:00' })
    expect(a).toMatchObject({ counted: 1, missed: 1 })   // the 08:00 dose went uncounted, the 20:00 one was missed
  })
  it('says nothing when nothing was due', () => {
    expect(adherence([], [], '2026-10-01', '2026-10-07', { d: '2026-10-21', hhmm: '12:00' }).pct).toBeNull()
    expect(daysBefore('2026-10-01', 1)).toBe('2026-09-30')
    expect(daysBefore('2026-10-31', -1)).toBe('2026-11-01')
  })
})

describe('history', () => {
  it('joins each record with its medication, newest first, and drops records of removed ones', () => {
    const log = [
      { id: 'a', medId: 'm1', d: '2026-10-20', time: '08:00', status: 'taken', at: 1 },
      { id: 'b', medId: 'm1', d: '2026-10-21', time: '08:00', status: 'skipped', at: 2 },
      { id: 'c', medId: 'gone', d: '2026-10-21', time: '09:00', status: 'taken', at: 3 }
    ]
    expect(history([med()], log).map(e => `${e.id} ${e.med.name}`)).toEqual(['b Losartana', 'a Losartana'])
  })
})

describe('across devices (lib/sync-merge.js)', () => {
  const T = 1_800_000_000_000
  const base = () => ({ _ts: T, unit: 'kg', workouts: [], routines: [], meds: [{ ...med(), _ts: T }], medLog: [] })
  const change = (prev, wall, mut) => { const n = JSON.parse(JSON.stringify(prev)); mut(n); n._ts = stampChange(prev, n, wall); return n }

  it('keeps the doses marked offline on both devices, and the same dose once', () => {
    const b0 = base()
    const [d8, d20] = dosesOn(b0.meds, [], '2026-10-21')
    const phone = change(b0, T + 10, s => { s.medLog = markDose(s.medLog, d8, 'taken', T + 10) })
    const desk = change(b0, T + 20, s => { s.medLog = markDose(markDose(s.medLog, d20, 'skipped', T + 20), d8, 'taken', T + 20) })
    const m = mergeStates(desk, phone)
    expect(m.medLog.map(e => e.id).sort()).toEqual([d20.id, d8.id].sort())
    expect(mergeStates(phone, desk).medLog).toHaveLength(2)
  })
  it('a medication removed on one device stays removed; one edited on the other keeps its edit', () => {
    const b0 = base()
    const desk = change(b0, T + 10, s => { s.meds = [] })
    const phone = change(b0, T + 5, s => { s.meds[0].dose = '100' })
    expect(mergeStates(phone, desk).meds).toEqual([])
    const later = change(b0, T + 30, s => { s.meds[0].dose = '100' })
    expect(mergeStates(later, desk).meds.map(x => x.dose)).toEqual(['100'])
  })
  it('two fields of one medication changed on two devices are both kept', () => {
    const b0 = base()
    const a = change(b0, T + 10, s => { s.meds[0].dose = '100' })
    const b = change(b0, T + 20, s => { s.meds[0].times = ['09:00'] })
    const m = mergeStates(b, a).meds[0]
    expect(m.dose).toBe('100')
    expect(m.times).toEqual(['09:00'])
  })
})
