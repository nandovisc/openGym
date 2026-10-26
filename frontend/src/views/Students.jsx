import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useUI } from '../store/useUI.js'
import { DEF, useStore } from '../store/useStore.js'
import { api } from '../lib/api.js'
import { EXIDX } from '../lib/exercises.js'
import { setLabel, setsDone } from '../lib/history.js'
import { best1RM, e1rmSeries } from '../lib/onerm.js'
import { hasCompletedWork, isWarmupRow } from '../lib/workout-model.js'
import { speedUnitOf } from '../lib/speed.js'
import { durPart, fmtDate, fmtNum, todayISO } from '../lib/format.js'
import { t, exerciseNameFor } from '../lib/i18n.js'
import Icon from '../components/Icon.jsx'
import LineChart from '../components/LineChart.jsx'
import { Button, Row, Section, Segmented } from '../components/ui.jsx'
import { myStudentsSheet } from './Trainer.jsx'
import { RecordTab, studentFormSheet } from './StudentRecord.jsx'
import { attachLinks, roster } from '../lib/students.js'
import { PlanTab } from './StudentPlan.jsx'
import { CoachOutbox, trainNowSheet } from './TrainNow.jsx'

// The Personal module, phase 2: a trainer's students and, for each, their training as the link
// shares it (GET /api/trainer/student) — the workouts, how each exercise moves, the plan, the body
// when shared. Read-only: the student's profile is loaded into a copy of its own here, never into
// the trainer's store, so nothing of it is saved or synced from this screen.

const ui = () => useUI.getState()
const clone = v => JSON.parse(JSON.stringify(v))
const daysAgo = d => Math.round((Date.parse(todayISO() + 'T12:00:00Z') - Date.parse(d + 'T12:00:00Z')) / 86400000)
const lastText = d => (!d ? t('No workouts yet') : daysAgo(d) === 0 ? t('Trained today') : daysAgo(d) === 1 ? t('Last workout yesterday') : t('Last workout {0} days ago', daysAgo(d)))

/** The trainer's students, with how each trains lately. */
export function StudentsList() {
  const nav = useNavigate()
  const records = useStore(s => s.S.students)
  const [students, setStudents] = useState(null)
  useEffect(() => { api('/api/trainer/students').then(r => setStudents(r.students)).catch(e => { setStudents([]); ui().toast(e.message) }) }, [])
  // A record a student joined through takes their id (lib/students.js attachLinks).
  useEffect(() => {
    if (!students) return
    const next = attachLinks(useStore.getState().S.students, students)
    if (next) useStore.getState().update(s => { s.students = next })
  }, [students])
  const rows = students ? roster(records, students) : null
  const sub = r => {
    if (r.link) return [lastText(r.link.training?.last), t('{0} in 7 days', r.link.training?.week ?? 0), t('{0} in 28 days', r.link.training?.month ?? 0)].join(' · ')
    if (r.record.status === 'invited') return t('Invite not accepted yet')
    if (r.record.status === 'ended') return t('Link ended · workouts kept up to {0}', r.record.history?.until ? fmtDate(r.record.history.until, true) : '–')
    return t('Paused')
  }
  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav(-1)} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 10 }}><h1>{t('Students')}</h1><div className="sub">{t('Their training, as they share it with you')}</div></div>
      <button className="iconbtn" onClick={myStudentsSheet} aria-label={t('Your code for students')}><Icon name="key" /></button>
      <button className="iconbtn" onClick={() => studentFormSheet(null, r => nav('/students/record/' + r.id))} aria-label={t('New student')}><Icon name="plus" /></button>
    </div>
    <CoachOutbox />
    {rows === null ? <div className="muted small">{t('Loading…')}</div>
      : rows.length ? <div className="list">{rows.map(r => <button key={r.key} className="item student-row" onClick={() => nav(r.link ? '/students/' + r.link.student.id : '/students/record/' + r.record.id)}>
        <span className="lrow-i" style={{ '--tint': r.link ? 'var(--teal)' : 'var(--grey)' }}><Icon name="figureStrength" /></span>
        <div className="grow"><div className="tt">{r.record?.name || r.link.student.name}</div>
          <div className="ss">{sub(r)}</div></div>
        {r.link?.training?.last && daysAgo(r.link.training.last) > 7 && <span className="tag warn">{t('Quiet')}</span>}
        {!r.link && r.record.status === 'invited' && <span className="tag">{t('Invited')}</span>}
        <Icon name="chevronRight" className="chev" />
      </button>)}</div>
        : <div className="card muted small">{t('No students yet. Add one and send them the invite link, or hand them your code (the key above).')}
          <div style={{ height: 10 }} /><Button variant="primary" icon="plus" onClick={() => studentFormSheet(null, r => nav('/students/record/' + r.id))}>{t('New student')}</Button></div>}
  </div>
}

export const nameIn = Ss => entryOrId => {
  const id = typeof entryOrId === 'string' ? entryOrId : entryOrId.id
  if (EXIDX[id]) return exerciseNameFor(EXIDX[id])
  return (Ss.customEx || []).find(c => c.id === id)?.name || entryOrId?.n || id
}

function WorkoutSheet({ w, Ss, close }) {
  const nameOf = nameIn(Ss)
  return <>
    <h3>{w.name || t('Workout')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{[fmtDate(w.d, true), ...durPart((w.end || 0) - (w.start || 0)), t('{0} sets', setsDone(w))].join(' · ')}</div>
    {(w.entries || []).map((e, i) => {
      const sets = (e.sets || []).filter(s => hasCompletedWork(s))
      return <div key={i} className="student-ex">
        <b>{nameOf(e)}</b>
        <div className="small">{sets.map(s => (isWarmupRow(s) ? t('warm-up') + ' ' : '') + setLabel(e.id, s, e.target, speedUnitOf(Ss))).join('  ·  ') || t('no sets')}</div>
        {e.note && <div className="small dim">{e.note}</div>}
      </div>
    })}
    {w.note && <div className="small" style={{ marginTop: 10 }}><b>{t('Session note')}:</b> {w.note}</div>}
    <div style={{ height: 12 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Close')}</Button>
  </>
}

function ExerciseSheet({ id, Ss, close }) {
  const pts = e1rmSeries(Ss, id)
  const best = best1RM(Ss, id)
  return <>
    <h3>{nameIn(Ss)(id)}</h3>
    {best && <div className="muted small" style={{ marginBottom: 10 }}>{t('Best estimated 1RM: {0} {1} (from {2} × {3}, {4})', fmtNum(Math.round(best.est * 10) / 10), Ss.unit, fmtNum(best.w), best.r, fmtDate(best.d, true))}</div>}
    {pts.length > 1 ? <div className="chart"><LineChart points={pts} h={160} unit={Ss.unit} /></div> : <div className="muted small">{t('Not enough sessions for a curve yet.')}</div>}
    <div style={{ height: 12 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Close')}</Button>
  </>
}

export const sortedWorkouts = Ss => (Ss.workouts || []).slice().sort((a, b) => (a.d < b.d ? 1 : a.d > b.d ? -1 : (b.start || 0) - (a.start || 0)))

/** A student's workouts, newest first, each opening on its exercises and sets. */
export function WorkoutsTab({ Ss }) {
  const workouts = sortedWorkouts(Ss)
  return workouts.length ? <div className="list">{workouts.slice(0, 120).map(w => <button key={w.id} className="item" onClick={() => ui().openSheet(close => <WorkoutSheet w={w} Ss={Ss} close={close} />)}>
    <div className="grow"><div className="tt">{w.name || t('Workout')}</div>
      <div className="ss">{[fmtDate(w.d, true), ...durPart((w.end || 0) - (w.start || 0)), t('{0} sets', setsDone(w)), w.health?.kcal ? t('{0} kcal', fmtNum(w.health.kcal)) : null].filter(Boolean).join(' · ')}</div></div>
    <Icon name="chevronRight" className="chev" />
  </button>)}</div> : <div className="card muted small">{t('No workouts yet.')}</div>
}

/** How each exercise of the last 90 days moved, the most trained first. */
export function ProgressTab({ Ss, until }) {
  const end = until || todayISO()
  const since = new Date(Date.parse(end + 'T12:00:00Z') - 90 * 86400000).toISOString().slice(0, 10)
  const counts = new Map()
  for (const w of sortedWorkouts(Ss)) if (w.d >= since) for (const e of w.entries || []) if ((e.sets || []).some(hasCompletedWork)) counts.set(e.id, (counts.get(e.id) || 0) + 1)
  const exercises = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 30)
  return exercises.length ? <Section footer={t('The exercises of the last 90 days, the most trained first.')}>{exercises.map(([exId, n]) => {
    const best = best1RM(Ss, exId)
    return <Row key={exId} title={nameIn(Ss)(exId)} subtitle={t('{0} sessions', n)} value={best ? `${fmtNum(Math.round(best.est))} ${Ss.unit}` : undefined} accessory="chevron"
      onClick={() => ui().openSheet(close => <ExerciseSheet id={exId} Ss={Ss} close={close} />)} />
  })}</Section> : <div className="card muted small">{t('No workouts in the last 90 days.')}</div>
}

/** One student's training: workouts, how each exercise moves, the plan, the body when shared. */
export function StudentView() {
  const nav = useNavigate()
  const { id } = useParams()
  const [d, setD] = useState(null)
  const [tab, setTab] = useState('workouts')
  const records = useStore(s => s.S.students)
  const load = () => api('/api/trainer/student?id=' + encodeURIComponent(id)).then(setD).catch(e => { setD({ error: e.message }) })
  useEffect(() => { load() }, [id])
  // The student's training on the defaults the app's own helpers read, in a copy of its own.
  const Ss = useMemo(() => (d?.training ? Object.assign(clone(DEF), d.training) : null), [d])
  if (!d) return <div className="narrow"><div className="muted small" style={{ marginTop: 40 }}>{t('Loading…')}</div></div>
  if (d.error) return <div className="narrow"><div className="hdr"><button className="iconbtn" onClick={() => nav('/students')} aria-label={t('Back')}><Icon name="chevronLeft" /></button></div><div className="card muted">{d.error}</div></div>
  const workouts = sortedWorkouts(Ss)
  const body = d.link?.scope?.body
  const record = (records || []).find(r => r && (r.id === d.link?.ref || r.studentId === d.student.id)) || null
  const bw = (Ss.bodyweight || []).filter(b => Number(b.w) > 0)
  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/students')} aria-label={t('Students')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 10 }}><h1>{d.student.name}</h1>
        <div className="sub">{[lastText(workouts[0]?.d), t('{0} workouts', workouts.length)].join(' · ')}</div></div>
    </div>
    <Button variant="primary" icon="play" onClick={() => trainNowSheet({ studentId: d.student.id, recordId: record?.id || null })}>{t('Train now')}</Button>
    <div style={{ height: 12 }} />
    <Segmented value={tab} onChange={setTab} options={[{ value: 'workouts', label: t('Workouts') }, { value: 'progress', label: t('Progress') }, { value: 'plan', label: t('Plan') }, { value: 'record', label: t('Record') }, ...(body ? [{ value: 'body', label: t('Body') }] : [])]} />
    <div style={{ height: 12 }} />
    {tab === 'workouts' && <WorkoutsTab Ss={Ss} />}
    {tab === 'progress' && <ProgressTab Ss={Ss} />}
    {tab === 'record' && <RecordTab record={record} name={d.student.name} studentId={d.student.id} />}
    {tab === 'plan' && <PlanTab studentId={d.student.id} Ss={Ss} nameOf={nameIn(Ss)} reload={load} />}
    {tab === 'body' && body && (bw.length ? <div className="card">
      <div className="muted small">{t('Body weight')}</div>
      <div className="big" style={{ margin: '4px 0 8px' }}>{fmtNum(bw.at(-1).w)} {Ss.unit}</div>
      {bw.length > 1 && <div className="chart"><LineChart points={bw.map(b => ({ t: Date.parse(b.d + 'T12:00:00'), y: Number(b.w), d: b.d }))} h={150} unit={Ss.unit} /></div>}
    </div> : <div className="card muted small">{t('No weigh-ins yet.')}</div>)}
  </div>
}

/**
 * A record with no link (lib/students.js): a student invited who has not joined yet, one paused,
 * or one whose link ended — then with their training up to that day, read-only, the trainer's.
 */
export function RecordView() {
  const nav = useNavigate()
  const { id } = useParams()
  const record = useStore(s => (s.S.students || []).find(r => r?.id === id))
  const [tab, setTab] = useState('record')
  const Ss = useMemo(() => (record?.history ? Object.assign(clone(DEF), { unit: record.history.unit, workouts: record.history.workouts, customEx: record.history.customEx }) : null), [record])
  if (!record) return <div className="narrow"><div className="hdr"><button className="iconbtn" onClick={() => nav('/students')} aria-label={t('Students')}><Icon name="chevronLeft" /></button></div><div className="card muted">{t('This record is not here anymore.')}</div></div>
  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/students')} aria-label={t('Students')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 10 }}><h1>{record.name}</h1>
        <div className="sub">{record.status === 'ended' ? t('Link ended · workouts kept up to {0}', record.history?.until ? fmtDate(record.history.until, true) : '–') : record.status === 'invited' ? t('Invite not accepted yet') : t('Paused')}</div></div>
    </div>
    {Ss && <><Segmented value={tab} onChange={setTab} options={[{ value: 'record', label: t('Record') }, { value: 'workouts', label: t('Workouts') }, { value: 'progress', label: t('Progress') }]} /><div style={{ height: 12 }} /></>}
    {tab === 'record' && <RecordTab record={record} name={record.name} />}
    {tab === 'workouts' && Ss && <WorkoutsTab Ss={Ss} />}
    {tab === 'progress' && Ss && <ProgressTab Ss={Ss} until={record.history?.until} />}
  </div>
}
