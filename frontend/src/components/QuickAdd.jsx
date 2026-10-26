import { useRef } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { moduleOn } from '../lib/modules.js'
import { activeHabits, statusOn, todayOf } from '../lib/habits.js'
import { dosesOn, markDose } from '../lib/meds.js'
import { effectiveRoutines, lastBW } from '../lib/history.js'
import { fmtNum, todayISO } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { bwSheet } from '../sheets.jsx'
import { addFoodSheet } from '../views/Food.jsx'
import { nightSheet } from '../views/Sleep.jsx'
import { HabitRow, habitFormSheet } from '../views/Habits.jsx'
import { slotByHour } from '../views/Today.jsx'
import { drink, mlText } from '../views/Water.jsx'
import { dayTotal, glassOf, goalOf as waterGoal } from '../lib/water.js'
import Icon from './Icon.jsx'
import { Button } from './ui.jsx'

const ui = () => useUI.getState()
const update = fn => useStore.getState().update(fn)
const list = v => (Array.isArray(v) ? v : [])
const SLOT_LABEL = { breakfast: 'Breakfast', morningSnack: 'Morning snack', lunch: 'Lunch', snack: 'Afternoon snack', dinner: 'Dinner', supper: 'Supper' }

// The ＋ in the middle of the tab bar (the navigation with modules on, components/TabBar.jsx):
// a tap opens "Log" — a workout, a meal, a habit, a weigh-in, a dose, a night, a task — a press
// held half a second starts today's workout straight away, as the old ▶ did. With a session
// under way the bar shows that session's button instead (TabBar), so nothing here competes with it.
export function QuickAddButton({ onStartWorkout }) {
  const timer = useRef(null)
  const held = useRef(false)
  const down = () => { held.current = false; clearTimeout(timer.current); timer.current = setTimeout(() => { held.current = true; try { navigator.vibrate?.(30) } catch { /* no vibration */ } onStartWorkout() }, 500) }
  const up = () => clearTimeout(timer.current)
  return <button className="start quick-add" onPointerDown={down} onPointerUp={up} onPointerLeave={up} onPointerCancel={up}
    onClick={() => { if (held.current) { held.current = false; return } quickAddSheet(onStartWorkout) }} aria-label={t('Log')}
    onContextMenu={e => e.preventDefault()}>
    <span className="cir"><Icon name="plus" /></span><span>{t('Log')}</span>
  </button>
}

function Item({ icon, tint, title, sub, onClick }) {
  return <button className="qa-item" onClick={onClick}>
    <span className="lrow-i" style={{ '--tint': tint }}><Icon name={icon} /></span>
    <b>{title}</b>{sub && <span className="small dim">{sub}</span>}
  </button>
}

function PendingHabits({ close }) {
  const S = useStore(s => s.S)
  const today = todayOf(S)
  const open = activeHabits(S).filter(h => h.kind !== 'auto' && h.kind !== 'task' && ['pending', 'partial'].includes(statusOn(h, today, S, today).state))
  return <>
    <h3>{t('Habits to do')}</h3>
    {open.length ? <div className="hab-list">{open.map(h => <HabitRow key={h.id} h={h} d={today} S={S} today={today} now={Date.now()} />)}</div>
      : <div className="muted small">{t('Every habit of today is done.')}</div>}
    <div style={{ height: 12 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Close')}</Button>
  </>
}

function DosesToday({ close }) {
  const S = useStore(s => s.S)
  const doses = dosesOn(S.meds, S.medLog, todayISO())
  return <>
    <h3>{t('Medications')}</h3>
    {doses.length ? <div className="section">{doses.map(d => <div key={d.id} className="lrow">
      <span className="lrow-m"><span className="lrow-t">{d.med.name}</span><span className="lrow-s">{d.time}</span></span>
      {d.entry?.status === 'taken' ? <Icon name="checkCircle" style={{ color: 'var(--acc)' }} />
        : <Button size="sm" onClick={() => { update(s => { s.medLog = markDose(s.medLog, d, 'taken') }); ui().toast(t('{0} taken', d.med.name)) }}>{t('Taken')}</Button>}
    </div>)}</div> : <div className="muted small">{t('Nothing scheduled today')}</div>}
    <div style={{ height: 12 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Close')}</Button>
  </>
}

function QuickAdd({ close, onStartWorkout }) {
  const S = useStore(s => s.S)
  const today = todayISO()
  const routines = effectiveRoutines(S, today)
  const slot = slotByHour()
  const bw = lastBW(S)
  const next = dosesOn(S.meds, S.medLog, today).find(x => !x.entry)
  const go = fn => () => { close(); fn() }
  return <>
    <h3>{t('Log')}</h3>
    <button className="qa-start" onClick={go(onStartWorkout)}>
      <Icon name="play" />
      <span><b>{t('Start workout')}</b><span className="small">{routines.length ? routines.map(r => r.name).join(' + ') : t('Choose a workout')}</span></span>
    </button>
    <div className="qa-grid">
      {moduleOn(S, 'food') && <Item icon="flame" tint="var(--orange)" title={t('Meal')} sub={t(SLOT_LABEL[slot])} onClick={go(() => addFoodSheet(today, slot))} />}
      {moduleOn(S, 'water') && <Item icon="drop" tint="var(--blue)" title={t('Water') + ' · +' + mlText(glassOf(S))} sub={t('{0} of {1} today', mlText(dayTotal(S, today)), mlText(waterGoal(S)))} onClick={go(() => drink(glassOf(S)))} />}
      {moduleOn(S, 'habits') && <Item icon="checkCircle" tint="var(--green)" title={t('Habit')} sub={t('Mark what you did')} onClick={go(() => ui().openSheet(c => <PendingHabits close={c} />))} />}
      <Item icon="scale" tint="var(--blue)" title={t('Weigh-in')} sub={bw ? `${fmtNum(bw.w)} ${S.unit}` : undefined} onClick={go(() => bwSheet())} />
      {moduleOn(S, 'meds') && list(S.meds).length > 0 && <Item icon="pill" tint="var(--teal)" title={t('Dose taken')} sub={next ? `${next.med.name} · ${next.time}` : t('All doses taken today')} onClick={go(() => ui().openSheet(c => <DosesToday close={c} />))} />}
      {moduleOn(S, 'sleep') && <Item icon="moon" tint="var(--indigo)" title={t('Night of sleep')} sub={t('Bed and wake times')} onClick={go(() => nightSheet())} />}
      {moduleOn(S, 'habits') && <Item icon="note" tint="var(--purple)" title={t('Task')} sub={t('A one-off to-do')} onClick={go(() => habitFormSheet(null, { kind: 'task' }))} />}
    </div>
    <div className="small dim" style={{ textAlign: 'center', margin: '10px 0 4px' }}>{t('Hold ＋ to start today’s workout straight away.')}</div>
    <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
  </>
}
export const quickAddSheet = onStartWorkout => ui().openSheet(close => <QuickAdd close={close} onStartWorkout={onStartWorkout} />)
