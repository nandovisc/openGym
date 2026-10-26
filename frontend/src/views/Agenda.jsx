import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { addClass, addSeries, endSeries, occurrences, recordOf, removeClass, setClass, tally } from '../lib/agenda.js'
import { DAYN, DAYS, fmtDate, localTZ, todayISO } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import Icon from '../components/Icon.jsx'
import { Button, NumberField, Segmented } from '../components/ui.jsx'
import { confirmSheet } from '../sheets.jsx'
import { studentFormSheet } from './StudentRecord.jsx'

// The Personal module, phase 5: a trainer's agenda (lib/agenda.js) — which student's class comes
// when, by day or by week; each one marked done or cancelled, moved, noted; classes added one at a
// time or every week on some weekdays. Kept in the trainer's own profile, synced like any list.

const ui = () => useUI.getState()
const toast = m => ui().toast(m)
const update = fn => useStore.getState().update(fn)
const addDays = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10)
const weekStartOf = (d, ws) => addDays(d, -((new Date(d + 'T12:00:00Z').getUTCDay() - (ws === 0 ? 0 : 1) + 7) % 7))
const STATUS = { scheduled: { label: 'Scheduled', tone: '' }, done: { label: 'Done (class)', tone: 'ok' }, canceled: { label: 'Cancelled', tone: 'bad' } }
const endOf = o => { const [h, m] = o.time.split(':').map(Number); const e = h * 60 + m + (o.dur || 60); return String(Math.floor(e / 60) % 24).padStart(2, '0') + ':' + String(e % 60).padStart(2, '0') }
// The agenda's zone, for the reminders the server sends, stamped the first time it is used.
const stampTz = s => { if (!s.agendaPrefs?.tz) s.agendaPrefs = { ...(s.agendaPrefs || { remindMin: 30 }), tz: localTZ() } }

function ClassSheet({ o, close }) {
  // A sheet renders above the routes: the student opens by the address, not the router.
  const nav = path => { location.hash = '#' + path }
  const S = useStore(s => s.S)
  const rec = recordOf(S, o)
  const [note, setNote] = useState(o.note || '')
  const [moving, setMoving] = useState(false)
  const [d, setD] = useState(o.d)
  const [time, setTime] = useState(o.time)
  const set = (patch, msg) => { update(s => { s.sessions = setClass(s.sessions, o, { note, ...patch }); stampTz(s) }); if (msg) toast(msg); close() }
  return <>
    <h3>{rec?.name || t('Class')}</h3>
    <div className="muted small" style={{ marginBottom: 10 }}>{fmtDate(o.d, true)} · {o.time}–{endOf(o)}{o.seriesId ? ' · ' + t('every week') : ''}{o.moved ? ' · ' + t('moved') : ''}</div>
    {moving ? <div className="agenda-move">
      <label><span className="small dim">{t('Day')}</span><input className="input" type="date" value={d} onChange={e => setD(e.target.value)} /></label>
      <label><span className="small dim">{t('Time')}</span><input className="input" type="time" value={time} onChange={e => setTime(e.target.value)} /></label>
      <Button variant="primary" onClick={() => set({ d, time, status: 'scheduled' }, t('Class moved'))}>{t('Move class')}</Button>
    </div> : <>
      <div className="agenda-actions">
        <Button variant={o.status === 'done' ? 'plain' : 'primary'} icon="check" onClick={() => set({ status: o.status === 'done' ? 'scheduled' : 'done' }, o.status === 'done' ? null : t('Class done'))}>{o.status === 'done' ? t('Not done') : t('Mark as done')}</Button>
        <Button icon="xmark" className={o.status === 'canceled' ? '' : 'danger'} onClick={() => set({ status: o.status === 'canceled' ? 'scheduled' : 'canceled' }, o.status === 'canceled' ? null : t('Class cancelled'))}>{o.status === 'canceled' ? t('Not cancelled') : t('Cancel class')}</Button>
      </div>
      <Button icon="calendar" onClick={() => setMoving(true)}>{t('Reschedule')}</Button>
    </>}
    <label className="rec-field" style={{ marginTop: 10 }}><span className="small dim">{t('Note')}</span>
      <textarea className="input" rows={2} maxLength={500} value={note} onChange={e => setNote(e.target.value)} onBlur={() => note !== (o.note || '') && update(s => { s.sessions = setClass(s.sessions, o, { note }) })} /></label>
    {rec && <Button variant="ghost" icon="person" onClick={() => { close(); nav(rec.studentId ? '/students/' + rec.studentId : '/students/record/' + rec.id) }}>{t('Open student')}</Button>}
    {o.seriesId ? <Button variant="ghost" className="danger" onClick={() => confirmSheet({ title: t('End this weekly class?'), message: t('This class and the ones after it go. The ones before stay as they were.'), confirmText: t('End'), danger: true,
      onConfirm: () => { update(s => { s.sessionSeries = endSeries(s.sessionSeries, o.seriesId, o.d) }); close() } })}>{t('End weekly class from here')}</Button>
      : <Button variant="ghost" className="danger" onClick={() => { update(s => { s.sessions = removeClass(s.sessions, o.id) }); close() }}>{t('Delete class')}</Button>}
  </>
}
export const classSheet = o => ui().openSheet(close => <ClassSheet o={o} close={close} />)

function NewClass({ day, close }) {
  const all = useStore(s => s.S.students)
  const records = (all || []).filter(r => r && r.status !== 'ended')
  const [recordId, setRecordId] = useState(records[0]?.id || '')
  const [d, setD] = useState(day)
  const [time, setTime] = useState('07:00')
  const [dur, setDur] = useState(60)
  const [weekly, setWeekly] = useState(false)
  const [days, setDays] = useState(() => [new Date(day + 'T12:00:00Z').getUTCDay()])
  const save = () => {
    if (!recordId) { toast(t('Choose a student')); return }
    update(s => {
      if (weekly) s.sessionSeries = addSeries(s.sessionSeries, { recordId, days, time, dur, from: d })
      else s.sessions = addClass(s.sessions, { recordId, d, time, dur })
      stampTz(s)
    })
    toast(weekly ? t('Weekly class added') : t('Class added')); close()
  }
  if (!records.length) return <>
    <h3>{t('New class')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{t('Classes are for your students: add the first one, then schedule.')}</div>
    <Button variant="primary" icon="plus" onClick={() => { close(); studentFormSheet(null) }}>{t('New student')}</Button>
  </>
  return <>
    <h3>{t('New class')}</h3>
    <label className="rec-field"><span className="small dim">{t('Student')}</span>
      <select className="input" value={recordId} onChange={e => setRecordId(e.target.value)}>{records.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
    <div className="agenda-move">
      <label><span className="small dim">{weekly ? t('Starting on') : t('Day')}</span><input className="input" type="date" value={d} onChange={e => setD(e.target.value)} /></label>
      <label><span className="small dim">{t('Time')}</span><input className="input" type="time" value={time} onChange={e => setTime(e.target.value)} /></label>
      <label><span className="small dim">{t('Minutes')}</span><NumberField className="field" decimal={false} value={dur} onChange={v => setDur(Math.max(10, Math.round(v || 60)))} aria-label={t('Minutes')} /></label>
    </div>
    <Segmented value={weekly ? 'weekly' : 'once'} onChange={v => setWeekly(v === 'weekly')} options={[{ value: 'once', label: t('Once') }, { value: 'weekly', label: t('Every week') }]} />
    {weekly && <div className="chips agenda-days">{[1, 2, 3, 4, 5, 6, 0].map(w => <button key={w} className={'chip' + (days.includes(w) ? ' on' : '')} aria-pressed={days.includes(w)}
      onClick={() => setDays(x => (x.includes(w) ? (x.length > 1 ? x.filter(y => y !== w) : x) : [...x, w]))}>{t(DAYS[w])}</button>)}</div>}
    <div style={{ height: 12 }} />
    <Button variant="primary" onClick={save}>{t('Add class')}</Button>
  </>
}
export const newClassSheet = (day = todayISO()) => ui().openSheet(close => <NewClass day={day} close={close} />)

/** One class in a list: the time, the student, how it went; a tap opens it. */
export function ClassRow({ o, S }) {
  const rec = recordOf(S, o)
  const st = STATUS[o.status] || STATUS.scheduled
  return <button className={'item agenda-row ' + o.status} onClick={() => classSheet(o)}>
    <div className="agenda-time"><b>{o.time}</b><span className="small dim">{o.dur} min</span></div>
    <div className="grow"><div className="tt">{rec?.name || t('Student')}</div><div className="ss">{[o.seriesId ? t('every week') : null, o.moved ? t('moved') : null, o.note || null].filter(Boolean).join(' · ') || ' '}</div></div>
    {o.status !== 'scheduled' && <span className={'tag ' + st.tone}>{t(st.label)}</span>}
  </button>
}

export default function Agenda() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const today = todayISO()
  const [view, setView] = useState('day')
  const [day, setDay] = useState(today)
  const ws = weekStartOf(day, S.weekStart)
  const week = Array.from({ length: 7 }, (_, i) => addDays(ws, i))
  const occ = occurrences(S, week[0], week[6])
  const dayOcc = occ.filter(o => o.d === day)
  const wk = tally(occ)
  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav(-1)} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 10 }}><h1>{t('Agenda')}</h1><div className="sub">{t('{0} classes this week · {1} done · {2} cancelled', wk.total, wk.done, wk.canceled)}</div></div>
      <button className="iconbtn" onClick={() => newClassSheet(day)} aria-label={t('New class')}><Icon name="plus" /></button>
    </div>
    <Segmented value={view} onChange={setView} options={[{ value: 'day', label: t('Day') }, { value: 'week', label: t('Week') }]} />
    <div className="agenda-strip">
      <button className="iconbtn" onClick={() => setDay(addDays(day, -7))} aria-label={t('Previous week')}><Icon name="chevronLeft" /></button>
      {week.map(d => { const n = occ.filter(o => o.d === d && o.status !== 'canceled').length; return <button key={d} className={'agenda-day' + (d === day ? ' sel' : '') + (d === today ? ' today' : '')} onClick={() => { setDay(d); setView('day') }} aria-label={fmtDate(d, true)}>
        <span className="small">{t(DAYS[new Date(d + 'T12:00:00Z').getUTCDay()])}</span><b>{Number(d.slice(8))}</b><span className="agenda-dots">{n ? '•'.repeat(Math.min(n, 4)) : ' '}</span>
      </button> })}
      <button className="iconbtn" onClick={() => setDay(addDays(day, 7))} aria-label={t('Next week')}><Icon name="chevronRight" /></button>
    </div>
    {view === 'day' ? <>
      <h4 className="sec" style={{ margin: '6px 2px 8px' }}>{day === today ? t('Today') : t(DAYN[new Date(day + 'T12:00:00Z').getUTCDay()]) + ', ' + fmtDate(day, true)}</h4>
      {dayOcc.length ? <div className="list">{dayOcc.map(o => <ClassRow key={o.id} o={o} S={S} />)}</div>
        : <div className="card muted small">{t('No classes this day.')} <button className="linkbtn" onClick={() => newClassSheet(day)}>{t('Add one')}</button></div>}
    </> : week.map(d => { const xs = occ.filter(o => o.d === d); return xs.length ? <div key={d}>
      <h4 className="sec" style={{ margin: '10px 2px 6px' }}>{t(DAYN[new Date(d + 'T12:00:00Z').getUTCDay()])}, {fmtDate(d, true)}</h4>
      <div className="list">{xs.map(o => <ClassRow key={o.id} o={o} S={S} />)}</div>
    </div> : null })}
    {view === 'week' && !occ.length && <div className="card muted small">{t('No classes this week.')}</div>}
  </div>
}
