import { useState } from 'react'
import { useUI } from '../store/useUI.js'
import { api } from '../lib/api.js'
import { defaultConfig, effectiveRoutines, exLine, modeOf } from '../lib/history.js'
import { speedUnitOf } from '../lib/speed.js'
import { DAYN, todayISO, uid } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import Icon from '../components/Icon.jsx'
import { Button, NumberField } from '../components/ui.jsx'
import { confirmSheet, exercisePicker } from '../sheets.jsx'

// The Personal module, phase 3: a trainer plans a student's training — routines written, changed
// or taken out, and which weekdays they fall on — saved to the student's profile through
// PUT /api/trainer/student/plan. Edited here in a copy; nothing of the trainer's own plan moves.

const ui = () => useUI.getState()
const toast = m => ui().toast(m)
const clone = v => JSON.parse(JSON.stringify(v))
const save = (id, body) => api('/api/trainer/student/plan', { method: 'PUT', body: JSON.stringify({ id, ...body }) })

function ExRow({ x, i, n, nameOf, set, move, remove }) {
  const mode = modeOf(x)
  return <div className="plan-ex">
    <div className="row between"><b className="grow">{nameOf(x.id)}</b>
      <span className="row" style={{ gap: 2 }}>
        <button className="iconbtn" disabled={i === 0} onClick={() => move(-1)} aria-label={t('Move up')}><Icon name="chevronUp" /></button>
        <button className="iconbtn" disabled={i === n - 1} onClick={() => move(1)} aria-label={t('Move down')}><Icon name="chevronDown" /></button>
        <button className="iconbtn" onClick={remove} aria-label={t('Remove')}><Icon name="trash" /></button>
      </span>
    </div>
    <div className="plan-ex-fields">
      <label><span className="small dim">{t('Sets')}</span><NumberField className="field" decimal={false} value={x.sets || 1} onChange={v => set({ sets: Math.max(1, Math.round(v || 1)) })} aria-label={t('Sets')} /></label>
      {mode === 'time' ? <label><span className="small dim">{t('Seconds')}</span><NumberField className="field" decimal={false} value={x.sec || 30} onChange={v => set({ sec: Math.max(1, Math.round(v || 1)) })} aria-label={t('Seconds')} /></label>
        : mode === 'cardio' ? <label><span className="small dim">{t('Minutes')}</span><NumberField className="field" decimal={false} value={x.min || 20} onChange={v => set({ min: Math.max(1, Math.round(v || 1)) })} aria-label={t('Minutes')} /></label>
          : <>
            <label><span className="small dim">{t('Reps from')}</span><NumberField className="field" decimal={false} nullable value={x.repsMin ?? null} onChange={v => set({ repsMin: v > 0 ? Math.round(v) : undefined })} aria-label={t('Reps from')} /></label>
            <label><span className="small dim">{t('Reps')}</span><NumberField className="field" decimal={false} value={x.reps || 10} onChange={v => set({ reps: Math.max(1, Math.round(v || 1)) })} aria-label={t('Reps')} /></label>
          </>}
      {mode !== 'cardio' && <label><span className="small dim">{t('Weight')}</span><NumberField className="field" value={x.weight || 0} onChange={v => set({ weight: Math.max(0, v || 0) })} aria-label={t('Weight')} /></label>}
    </div>
  </div>
}

function RoutineEditor({ studentId, routine, nameOf, onSaved, close }) {
  const [r, setR] = useState(() => routine ? clone(routine) : { id: uid(), name: t('New routine'), ex: [] })
  const [busy, setBusy] = useState(false)
  const edit = fn => setR(prev => { const next = clone(prev); fn(next); return next })
  const add = () => {
    const picker = exercisePicker(ex => { edit(x => { x.ex.push({ id: ex.id, ...defaultConfig(ex.id) }) }); picker?.close?.() }, { title: t('Add exercise') })
  }
  const submit = async () => {
    setBusy(true)
    try {
      const out = { ...r, ex: r.ex.map(x => Object.fromEntries(Object.entries(x).filter(([, v]) => v !== undefined))) }
      await save(studentId, { routines: [out] })
      toast(t('Saved to the student’s plan'))
      onSaved(); close()
    } catch (e) { toast(e.message) } finally { setBusy(false) }
  }
  return <>
    <h3>{routine ? t('Edit routine') : t('New routine')}</h3>
    <input className="input" value={r.name} maxLength={80} onChange={e => edit(x => { x.name = e.target.value })} aria-label={t('Name')} />
    <div style={{ height: 10 }} />
    {r.ex.map((x, i) => <ExRow key={i} x={x} i={i} n={r.ex.length} nameOf={nameOf}
      set={patch => edit(s => { Object.assign(s.ex[i], patch) })}
      move={dir => edit(s => { const [m] = s.ex.splice(i, 1); s.ex.splice(i + dir, 0, m) })}
      remove={() => edit(s => { s.ex.splice(i, 1) })} />)}
    <Button icon="plus" onClick={add}>{t('Add exercise')}</Button>
    <div style={{ height: 10 }} />
    <Button variant="primary" disabled={busy || !r.name.trim()} onClick={submit}>{t('Save to the student’s plan')}</Button>
  </>
}

function WeekEditor({ studentId, Ss, onSaved, close }) {
  const [week, setWeek] = useState(() => clone(Ss.week || {}))
  const toggle = (d, id) => setWeek(w => { const cur = [].concat(w[d] || []); const next = cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id]; return { ...w, [d]: next } })
  const submit = () => save(studentId, { week }).then(() => { toast(t('Saved to the student’s plan')); onSaved(); close() }).catch(e => toast(e.message))
  return <>
    <h3>{t('Days of the week')}</h3>
    <div className="muted small" style={{ marginBottom: 10 }}>{t('Which routine falls on each day. A day with none is a rest day.')}</div>
    {[1, 2, 3, 4, 5, 6, 0].map(d => <div key={d} className="plan-day">
      <span className="small" style={{ minWidth: 92 }}>{t(DAYN[d])}</span>
      <div className="chips" style={{ flexWrap: 'wrap' }}>{(Ss.routines || []).map(r => <button key={r.id} className={'chip nocap' + ([].concat(week[d] || []).includes(r.id) ? ' on' : '')} onClick={() => toggle(String(d), r.id)}>{r.name}</button>)}</div>
    </div>)}
    <div style={{ height: 10 }} />
    <Button variant="primary" onClick={submit}>{t('Save to the student’s plan')}</Button>
  </>
}

/** The student's plan, for their trainer to change: routines, their exercises, the weekdays. */
export function PlanTab({ studentId, Ss, nameOf, reload }) {
  const today = todayISO()
  const todays = effectiveRoutines(Ss, today)
  const routines = Ss.routines || []
  const days = d => [1, 2, 3, 4, 5, 6, 0].filter(w => [].concat(Ss.week?.[w] || []).includes(d)).map(w => t(DAYN[w]).slice(0, 3)).join(', ')
  const open = routine => ui().openSheet(close => <RoutineEditor studentId={studentId} routine={routine} nameOf={nameOf} onSaved={reload} close={close} />)
  const remove = r => confirmSheet({ title: t('Take “{0}” out of the plan?', r.name), message: t('It leaves the student’s routines and the days it was on. Their logged workouts stay.'), confirmText: t('Take it out'), danger: true,
    onConfirm: () => save(studentId, { removed: [r.id] }).then(() => { toast(t('Taken out of the plan')); reload() }).catch(e => toast(e.message)) })
  return <>
    <div className="card small"><b>{t('Today')}:</b> {todays.length ? todays.map(r => r.name).join(' + ') : t('Rest Day')}</div>
    <div className="row" style={{ gap: 8, margin: '10px 0' }}>
      <Button icon="plus" variant="primary" onClick={() => open(null)}>{t('New routine')}</Button>
      {routines.length > 0 && <Button icon="calendar" onClick={() => ui().openSheet(close => <WeekEditor studentId={studentId} Ss={Ss} onSaved={reload} close={close} />)}>{t('Days of the week')}</Button>}
    </div>
    {routines.length ? routines.map(r => <div key={r.id} className="card student-routine">
      <div className="row between"><b>{r.name}</b>{r.trainer && <span className="tag acc">{t('by {0}', r.trainer.name)}</span>}</div>
      {days(r.id) && <div className="small dim">{days(r.id)}</div>}
      {(r.ex || []).map((x, i) => <div key={i} className="row between small"><span>{nameOf(x.id)}</span><span className="dim">{exLine(x, Ss.unit, speedUnitOf(Ss))}</span></div>)}
      <div className="row" style={{ gap: 8, marginTop: 4 }}>
        <Button size="sm" icon="pencil" onClick={() => open(r)}>{t('Edit')}</Button>
        <Button size="sm" variant="ghost" className="danger" onClick={() => remove(r)}>{t('Take it out')}</Button>
      </div>
    </div>) : <div className="card muted small">{t('No routines yet. Make the first one for this student.')}</div>}
  </>
}
