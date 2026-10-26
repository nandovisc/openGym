// api/agenda.js (the reminders the server sends) and lib/agenda.js (what the app shows) are two
// copies of one set of rules: the same classes on both sides.
import { describe, expect, it } from 'vitest'
import * as api from '../../../api/agenda.js'
import * as app from './agenda.js'

const S = {
  students: [{ id: 'r1', name: 'Marília' }, { id: 'r2', name: 'João' }],
  sessionSeries: [{ id: 's', recordId: 'r1', days: [1, 3, 5], time: '07:00', dur: 60, from: '2026-10-19', until: null }],
  sessions: [
    { id: 's|2026-10-21', seriesId: 's', recordId: 'r1', d: '2026-10-21', time: '07:00', status: 'done' },
    { id: 's|2026-10-23', seriesId: 's', recordId: 'r1', d: '2026-10-24', time: '09:00', status: 'scheduled' },
    { id: 'x', recordId: 'r2', d: '2026-10-22', time: '18:30', dur: 45, status: 'scheduled' }
  ]
}

describe('the agenda, read alike on both sides', () => {
  it('a week of classes: the series, what changed of it, the single ones', () => {
    const week = app.occurrences(S, '2026-10-19', '2026-10-25')
    expect(week).toEqual(api.occurrences(S, '2026-10-19', '2026-10-25'))
    expect(week.map(o => [o.d, o.time, o.status, o.moved])).toEqual([
      ['2026-10-19', '07:00', 'scheduled', false],
      ['2026-10-21', '07:00', 'done', false],
      ['2026-10-22', '18:30', 'scheduled', false],
      ['2026-10-24', '09:00', 'scheduled', true]
    ])
    expect(app.occurrences(S, '2026-10-24', '2026-10-24').map(o => o.id)).toEqual(['s|2026-10-23'])
  })
  it('the classes to remind of, half an hour before', () => {
    const now = { date: '2026-10-26', hhmm: '06:35' }
    expect(app.agendaDue(S, now)).toEqual(api.agendaDue(S, now))
    expect(app.agendaDue(S, now).map(o => o.id)).toEqual(['s|2026-10-26'])
    expect(app.agendaDue(S, { date: '2026-10-26', hhmm: '05:00' })).toEqual([])
  })
  it('what a tap writes: done, moved, a new class, a series ended', () => {
    const [o] = app.occurrences(S, '2026-10-26', '2026-10-26')
    const done = app.setClass(S.sessions, o, { status: 'done' })
    expect(app.occurrences({ ...S, sessions: done }, '2026-10-26', '2026-10-26')[0].status).toBe('done')
    const added = app.addClass([], { recordId: 'r2', d: '2026-10-27', time: '12:00' })
    expect(added[0]).toMatchObject({ recordId: 'r2', status: 'scheduled', dur: 60 })
    const ended = app.endSeries(S.sessionSeries, 's', '2026-10-28')
    expect(app.occurrences({ ...S, sessionSeries: ended }, '2026-10-26', '2026-11-01').map(o => o.d)).toEqual(['2026-10-26'])
    expect(app.tally(app.occurrences(S, '2026-10-19', '2026-10-25'))).toEqual({ total: 4, done: 1, canceled: 0, left: 3 })
  })
})
