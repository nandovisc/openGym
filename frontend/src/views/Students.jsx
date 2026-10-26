import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useUI } from '../store/useUI.js'
import { DEF } from '../store/useStore.js'
import { api } from '../lib/api.js'
import { EXIDX } from '../lib/exercises.js'
import { effectiveRoutines, setLabel, setsDone } from '../lib/history.js'
import { best1RM, e1rmSeries } from '../lib/onerm.js'
import { hasCompletedWork, isWarmupRow } from '../lib/workout-model.js'
import { speedUnitOf } from '../lib/speed.js'
import { durPart, fmtDate, fmtNum, todayISO } from '../lib/format.js'
import { t, exerciseNameFor } from '../lib/i18n.js'
import Icon from '../components/Icon.jsx'
import LineChart from '../components/LineChart.jsx'
import { Button, Row, Section, Segmented } from '../components/ui.jsx'
import { myStudentsSheet } from './Trainer.jsx'

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
  const [students, setStudents] = useState(null)
  useEffect(() => { api('/api/trainer/students').then(r => setStudents(r.students)).catch(e => { setStudents([]); ui().toast(e.message) }) }, [])
  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav(-1)} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 10 }}><h1>{t('Students')}</h1><div className="sub">{t('Their training, as they share it with you')}</div></div>
      <button className="iconbtn" onClick={myStudentsSheet} aria-label={t('Your code for students')}><Icon name="key" /></button>
    </div>
    {students === null ? <div className="muted small">{t('Loading…')}</div>
      : students.length ? <div className="list">{students.map(s => <button key={s.id} className="item student-row" onClick={() => nav('/students/' + s.student.id)}>
        <span className="lrow-i" style={{ '--tint': 'var(--teal)' }}><Icon name="figureStrength" /></span>
        <div className="grow"><div className="tt">{s.student.name}</div>
          <div className="ss">{[lastText(s.training?.last), t('{0} in 7 days', s.training?.week ?? 0), t('{0} in 28 days', s.training?.month ?? 0)].join(' · ')}</div></div>
        {s.training?.last && daysAgo(s.training.last) > 7 && <span className="tag warn">{t('Quiet')}</span>}
        <Icon name="chevronRight" className="chev" />
      </button>)}</div>
        : <div className="card muted small">{t('No students yet. Hand them your code (the key above); in Settings → My personal trainer they enter it.')}
          <div style={{ height: 10 }} /><Button icon="key" onClick={myStudentsSheet}>{t('Your code for students')}</Button></div>}
  </div>
}

const nameIn = Ss => entryOrId => {
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

// A routine's exercise as its target reads: "3 × 8–12 · 40 kg".
function targetText(x, unit) {
  const reps = x.repsMin && x.repsMax ? `${x.repsMin}–${x.repsMax}` : x.reps ?? (x.sec ? `${x.sec} s` : x.min ? `${x.min} min` : '')
  return [x.sets ? `${x.sets} × ${reps}` : reps, Number(x.weight) > 0 ? `${fmtNum(x.weight)} ${unit}` : null].filter(Boolean).join(' · ')
}

/** One student's training: workouts, how each exercise moves, the plan, the body when shared. */
export function StudentView() {
  const nav = useNavigate()
  const { id } = useParams()
  const [d, setD] = useState(null)
  const [tab, setTab] = useState('workouts')
  useEffect(() => { api('/api/trainer/student?id=' + encodeURIComponent(id)).then(setD).catch(e => { setD({ error: e.message }) }) }, [id])
  // The student's training on the defaults the app's own helpers read, in a copy of its own.
  const Ss = useMemo(() => (d?.training ? Object.assign(clone(DEF), d.training) : null), [d])
  if (!d) return <div className="narrow"><div className="muted small" style={{ marginTop: 40 }}>{t('Loading…')}</div></div>
  if (d.error) return <div className="narrow"><div className="hdr"><button className="iconbtn" onClick={() => nav('/students')} aria-label={t('Back')}><Icon name="chevronLeft" /></button></div><div className="card muted">{d.error}</div></div>
  const workouts = (Ss.workouts || []).slice().sort((a, b) => (a.d < b.d ? 1 : a.d > b.d ? -1 : (b.start || 0) - (a.start || 0)))
  const since = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10)
  const counts = new Map()
  for (const w of workouts) if (w.d >= since) for (const e of w.entries || []) if ((e.sets || []).some(hasCompletedWork)) counts.set(e.id, (counts.get(e.id) || 0) + 1)
  const exercises = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 30)
  const today = todayISO()
  const todays = effectiveRoutines(Ss, today)
  const body = d.link?.scope?.body
  const bw = (Ss.bodyweight || []).filter(b => Number(b.w) > 0)
  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/students')} aria-label={t('Students')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 10 }}><h1>{d.student.name}</h1>
        <div className="sub">{[lastText(workouts[0]?.d), t('{0} workouts', workouts.length)].join(' · ')}</div></div>
    </div>
    <Segmented value={tab} onChange={setTab} options={[{ value: 'workouts', label: t('Workouts') }, { value: 'progress', label: t('Progress') }, { value: 'plan', label: t('Plan') }, ...(body ? [{ value: 'body', label: t('Body') }] : [])]} />
    <div style={{ height: 12 }} />
    {tab === 'workouts' && (workouts.length ? <div className="list">{workouts.slice(0, 120).map(w => <button key={w.id} className="item" onClick={() => ui().openSheet(close => <WorkoutSheet w={w} Ss={Ss} close={close} />)}>
      <div className="grow"><div className="tt">{w.name || t('Workout')}</div>
        <div className="ss">{[fmtDate(w.d, true), ...durPart((w.end || 0) - (w.start || 0)), t('{0} sets', setsDone(w)), w.health?.kcal ? t('{0} kcal', fmtNum(w.health.kcal)) : null].filter(Boolean).join(' · ')}</div></div>
      <Icon name="chevronRight" className="chev" />
    </button>)}</div> : <div className="card muted small">{t('No workouts yet.')}</div>)}
    {tab === 'progress' && (exercises.length ? <Section footer={t('The exercises of the last 90 days, the most trained first.')}>{exercises.map(([exId, n]) => {
      const best = best1RM(Ss, exId)
      return <Row key={exId} title={nameIn(Ss)(exId)} subtitle={t('{0} sessions', n)} value={best ? `${fmtNum(Math.round(best.est))} ${Ss.unit}` : undefined} accessory="chevron"
        onClick={() => ui().openSheet(close => <ExerciseSheet id={exId} Ss={Ss} close={close} />)} />
    })}</Section> : <div className="card muted small">{t('No workouts in the last 90 days.')}</div>)}
    {tab === 'plan' && <>
      <div className="card small"><b>{t('Today')}:</b> {todays.length ? todays.map(r => r.name).join(' + ') : t('Rest Day')}</div>
      {(Ss.routines || []).length ? (Ss.routines || []).map(r => <div key={r.id} className="card student-routine">
        <b>{r.name}</b>
        {(r.ex || []).map((x, i) => <div key={i} className="row between small"><span>{nameIn(Ss)(x.id)}</span><span className="dim">{targetText(x, Ss.unit)}</span></div>)}
      </div>) : <div className="card muted small">{t('No routines yet.')}</div>}
    </>}
    {tab === 'body' && body && (bw.length ? <div className="card">
      <div className="muted small">{t('Body weight')}</div>
      <div className="big" style={{ margin: '4px 0 8px' }}>{fmtNum(bw.at(-1).w)} {Ss.unit}</div>
      {bw.length > 1 && <div className="chart"><LineChart points={bw.map(b => ({ t: Date.parse(b.d + 'T12:00:00'), y: Number(b.w), d: b.d }))} h={150} unit={Ss.unit} /></div>}
    </div> : <div className="card muted small">{t('No weigh-ins yet.')}</div>)}
  </div>
}
