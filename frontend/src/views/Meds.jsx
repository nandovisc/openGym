import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import {
  MED_UNITS, adherence, daysBefore, doseState, dosesOn, extraDosesOn, history, hhmmOf, logExtraDose, markDose,
  normalizeMed, unmark
} from '../lib/meds.js'
import { DAYS, fmtDate, todayISO } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import Icon from '../components/Icon.jsx'
import { Button, Row, Section, Segmented, SelectRow, Switch, TextField } from '../components/ui.jsx'
import { confirmSheet } from '../sheets.jsx'

const update = fn => useStore.getState().update(fn)
const ui = () => useUI.getState()
const toast = message => ui().toast(message)

// The labels of the units; mg, ml and the like are the same in every language.
const UNIT_LABEL = { drops: 'drops', pill: 'tablet', capsule: 'capsule', unit: 'unit', puff: 'puff' }
export const unitLabel = u => (UNIT_LABEL[u] ? t(UNIT_LABEL[u]) : u || '')
export const doseText = m => [m.dose, unitLabel(m.unit)].filter(Boolean).join(' ')
const WEEK = [1, 2, 3, 4, 5, 6, 0]
const daysText = m => (Array.isArray(m.days) ? WEEK.filter(d => m.days.includes(d)).map(d => t(DAYS[d])).join(' ') : t('Every day'))

// The clock, read again every minute, so a dose turns from upcoming to due to late on screen.
function useNow() {
  const read = () => ({ d: todayISO(), hhmm: hhmmOf() })
  const [now, setNow] = useState(read)
  useEffect(() => { const id = setInterval(() => setNow(read()), 60000); return () => clearInterval(id) }, [])
  return now
}

const STATE = {
  taken: { label: 'Taken', color: 'var(--green)', icon: 'checkCircle' },
  skipped: { label: 'Skipped', color: 'var(--label-3)', icon: 'xmark' },
  late: { label: 'Late', color: 'var(--red)', icon: 'clock' },
  due: { label: 'Now', color: 'var(--orange)', icon: 'bell' },
  upcoming: { label: 'Later', color: 'var(--label-3)', icon: 'clock' }
}

function MedForm({ id, close }) {
  const S = useStore(s => s.S)
  const prev = id ? (S.meds || []).find(m => m.id === id) : null
  const [f, setF] = useState(() => ({
    name: prev?.name || '', dose: prev?.dose || '', unit: prev?.unit || 'mg',
    times: prev?.times?.length ? [...prev.times] : ['08:00'],
    days: Array.isArray(prev?.days) ? [...prev.days] : [0, 1, 2, 3, 4, 5, 6],
    start: prev?.start || todayISO(), end: prev?.end || '', notes: prev?.notes || '', active: prev?.active !== false
  }))
  const set = (k, v) => setF(x => ({ ...x, [k]: v }))
  const toggleDay = d => set('days', f.days.includes(d) ? f.days.filter(x => x !== d) : [...f.days, d])

  const save = () => {
    if (!f.days.length) { toast(t('Choose at least one day')); return }
    const med = normalizeMed(f, { prev })
    if (med.error === 'name') { toast(t('Enter the name of the medication')); return }
    if (med.error === 'end') { toast(t('The end date is before the start date')); return }
    update(s => {
      const list = (s.meds || []).filter(m => m.id !== med.id)
      const at = (s.meds || []).findIndex(m => m.id === med.id)
      if (at >= 0) list.splice(at, 0, med); else list.push(med)
      s.meds = list
    })
    close()
    toast(prev ? t('Medication saved') : t('Medication added'))
  }
  const remove = () => confirmSheet({
    title: t('Delete medication?'),
    message: t('Deletes {0} and the record of its doses.', prev.name),
    confirmText: t('Delete'), danger: true,
    onConfirm: () => {
      update(s => { s.meds = (s.meds || []).filter(m => m.id !== prev.id); s.medLog = (s.medLog || []).filter(e => e.medId !== prev.id) })
      close()
      toast(t('Medication deleted'))
    }
  })

  return <>
    <h3>{prev ? t('Edit medication') : t('New medication')}</h3>
    <div className="med-form">
      <label><span>{t('Name')}</span><TextField value={f.name} maxLength={60} placeholder={t('e.g. Losartan')} onChange={e => set('name', e.target.value)} autoFocus={!prev} /></label>
      <label><span>{t('Dose')}</span><TextField value={f.dose} maxLength={20} inputMode="decimal" placeholder="50" onChange={e => set('dose', e.target.value)} /></label>
      <div className="sect-b"><SelectRow title={t('Unit')} sheetTitle={t('Unit')} value={MED_UNITS.includes(f.unit) ? f.unit : 'mg'}
        options={MED_UNITS.map(u => ({ value: u, label: unitLabel(u) }))} onChange={v => set('unit', v)} /></div>
      <div>
        <span className="med-label">{t('Times')}</span>
        {f.times.map((time, i) => <div className="row" key={i} style={{ gap: 8, marginBottom: 6 }}>
          <input className="field" type="time" value={time} onChange={e => set('times', f.times.map((x, j) => (j === i ? e.target.value : x)))} />
          {f.times.length > 1 && <button className="iconbtn" aria-label={t('Remove time')} onClick={() => set('times', f.times.filter((_, j) => j !== i))}><Icon name="xmark" /></button>}
        </div>)}
        {f.times.length < 8 && <Button size="sm" variant="ghost" icon="plus" onClick={() => set('times', [...f.times, '20:00'])}>{t('Add time')}</Button>}
      </div>
      <div>
        <span className="med-label">{t('Days')}</span>
        <div className="med-days">{WEEK.map(d => <button key={d} className={f.days.includes(d) ? 'on' : ''} aria-pressed={f.days.includes(d)} onClick={() => toggleDay(d)}>{t(DAYS[d])}</button>)}</div>
      </div>
      <div className="row" style={{ gap: 8 }}>
        <label style={{ flex: 1 }}><span>{t('Start')}</span><input className="field" type="date" value={f.start} onChange={e => set('start', e.target.value)} /></label>
        <label style={{ flex: 1 }}><span>{t('End (optional)')}</span><input className="field" type="date" value={f.end} min={f.start} onChange={e => set('end', e.target.value)} /></label>
      </div>
      <label><span>{t('Notes')}</span><TextField value={f.notes} maxLength={200} placeholder={t('e.g. after breakfast')} onChange={e => set('notes', e.target.value)} /></label>
      {prev && <div className="row between"><span>{t('Active')}</span><Switch checked={f.active} onChange={v => set('active', v)} aria-label={t('Active')} /></div>}
    </div>
    <div style={{ height: 14 }} />
    <Button variant="primary" onClick={save}>{t('Save')}</Button>
    <div style={{ height: 8 }} />
    {prev ? <Button variant="ghost" className="danger" icon="trash" onClick={remove}>{t('Delete medication')}</Button>
      : <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>}
  </>
}

export const medFormSheet = (id = null) => ui().openSheet(close => <MedForm id={id} close={close} />)

function ExtraDose({ close }) {
  const meds = useStore(s => s.S.meds || [])
  const take = med => { update(s => { s.medLog = logExtraDose(s.medLog, med) }); close(); toast(t('Dose of {0} recorded', med.name)) }
  return <>
    <h3>{t('Extra dose')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{t('A dose outside the schedule, recorded as taken now.')}</div>
    <Section>{meds.map(m => <Row key={m.id} icon="pill" iconTint="var(--teal)" title={m.name} subtitle={doseText(m)} accessory="chevron" onClick={() => take(m)} />)}</Section>
    <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
  </>
}

function DoseRow({ dose, now }) {
  const st = doseState(dose, now)
  const look = STATE[st]
  const mark = status => update(s => { s.medLog = markDose(s.medLog, dose, status) })
  const undo = () => update(s => { s.medLog = unmark(s.medLog, dose.id) })
  return <div className={'med-dose ' + st}>
    <div className="med-time">{dose.time}</div>
    <div className="med-what">
      <b>{dose.med.name}</b>
      <span className="small dim">{[doseText(dose.med), dose.med.notes].filter(Boolean).join(' · ')}</span>
    </div>
    {dose.entry ? <button className="med-chip" style={{ color: look.color }} onClick={undo} aria-label={t('Undo')}>
      <Icon name={look.icon} /> {t(look.label)}
    </button> : <div className="row" style={{ gap: 6 }}>
      <Button size="sm" variant="ghost" onClick={() => mark('skipped')}>{t('Skip')}</Button>
      <Button size="sm" variant={st === 'upcoming' ? 'plain' : 'primary'} icon="check" onClick={() => mark('taken')}>{t('Taken')}</Button>
    </div>}
  </div>
}

export default function Meds() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const now = useNow()
  const [range, setRange] = useState(30)
  const meds = S.meds || []
  const log = S.medLog || []
  const today = dosesOn(meds, log, now.d)
  const extras = extraDosesOn(log, now.d)
  const stats = adherence(meds, log, daysBefore(now.d, range - 1), now.d, now)
  const recent = history(meds, log, 30)
  const reminderOff = meds.length > 0 && !S.medReminder?.on

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/health')} aria-label={t('Health')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 10 }}><h1>{t('Medications')}</h1><div className="sub">{fmtDate(now.d, true)}</div></div>
      <button className="iconbtn" onClick={() => medFormSheet()} aria-label={t('New medication')}><Icon name="plus" /></button>
    </div>

    {!meds.length && <div className="card">
      <div className="muted small">{t('Add what you take and when. Each dose shows up here on its day, and a reminder can come at its time.')}</div>
      <div style={{ height: 10 }} /><Button variant="primary" icon="plus" onClick={() => medFormSheet()}>{t('Add medication')}</Button>
    </div>}

    {reminderOff && <div className="card tappable med-hint" onClick={() => nav('/settings/reminders')}>
      <Icon name="bell" /><span className="small">{t('Reminders for your doses are off. Turn them on in Settings → Reminders.')}</span>
    </div>}

    {meds.length > 0 && <div className="card">
      <div className="row between" style={{ marginBottom: 8 }}>
        <h2 style={{ margin: 0 }}>{t('Today')}</h2>
        <Button size="sm" icon="plus" onClick={() => ui().openSheet(close => <ExtraDose close={close} />)}>{t('Extra dose')}</Button>
      </div>
      {today.length ? today.map(dose => <DoseRow key={dose.id} dose={dose} now={now} />)
        : <div className="muted small">{t('Nothing scheduled today.')}</div>}
      {extras.map(e => {
        const med = meds.find(m => m.id === e.medId)
        return med && <div className="med-dose taken" key={e.id}>
          <div className="med-time">{e.time}</div>
          <div className="med-what"><b>{med.name}</b><span className="small dim">{t('Extra dose')} · {doseText(med)}</span></div>
          <button className="med-chip" onClick={() => update(s => { s.medLog = unmark(s.medLog, e.id) })} aria-label={t('Remove')}><Icon name="trash" /></button>
        </div>
      })}
    </div>}

    {meds.length > 0 && <div className="card">
      <div className="row between" style={{ marginBottom: 8 }}>
        <div>
          <div className="muted small">{t('Doses taken')}</div>
          <div className="big" style={{ marginTop: 3 }}>{stats.pct == null ? '–' : stats.pct + '%'}</div>
        </div>
        <div className="small dim" style={{ textAlign: 'end' }}>
          {t('{0} taken', stats.taken)}<br />{t('{0} skipped', stats.skipped)} · {t('{0} missed', stats.missed)}
        </div>
      </div>
      <Segmented className="seg-range" value={range} onChange={setRange}
        options={[{ value: 7, label: '7D' }, { value: 30, label: '30D' }, { value: 90, label: '90D' }]} />
      <div className="med-cal">{stats.days.map(day => {
        const tone = !day.counted ? 'none' : day.taken === day.counted ? 'all' : day.taken ? 'some' : 'missed'
        return <span key={day.d} className={'med-day ' + tone} title={`${fmtDate(day.d, true)}: ${day.taken}/${day.counted}`} />
      })}</div>
    </div>}

    {meds.length > 0 && <>
      <h4 className="sec" style={{ margin: '18px 2px 10px' }}>{t('My medications')}</h4>
      <Section>{meds.map(m => <Row key={m.id} icon="pill" iconTint={m.active === false ? 'var(--grey)' : 'var(--teal)'}
        title={m.name} subtitle={[doseText(m), (m.times || []).join(' · '), daysText(m), m.active === false ? t('Paused') : null].filter(Boolean).join(' — ')}
        accessory="chevron" onClick={() => medFormSheet(m.id)} />)}</Section>
    </>}

    {recent.length > 0 && <>
      <h4 className="sec" style={{ margin: '18px 2px 10px' }}>{t('Dose history')}</h4>
      <div className="list">{recent.map(e => <div className="med-dose" key={e.id}>
        <div className="med-time">{e.time}</div>
        <div className="med-what"><b>{e.med.name}</b><span className="small dim">{fmtDate(e.d, true)}{e.extra ? ' · ' + t('Extra dose') : ''}</span></div>
        <span className="med-chip" style={{ color: STATE[e.status]?.color }}><Icon name={STATE[e.status]?.icon || 'check'} /> {t(STATE[e.status]?.label || '')}</span>
      </div>)}</div>
    </>}
  </div>
}
