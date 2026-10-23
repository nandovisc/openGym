import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import {
  KINDS, MEAL_SLOTS, MILESTONES, SCHEDULE_TYPES, SOURCES, UNITS, activeHabits, addDays, addSlip, addValue, dailyProgress, duplicateHabit,
  exportHabits, icsFor, logId, milestones, normalizeHabit, reorder, scheduleFor, series, setState, setValue, startTimer, stats, statusOn, stopTimer,
  streak, timerExtra, timerReached, todayOf, toggleDone, typicalTime, undoSlip, weekdayMisses, weeklyRecap, suggestedHabits
} from '../lib/habits.js'
import { adherence } from '../lib/meds.js'
import { pushPermission } from '../lib/push.js'
import { useWakeLock } from '../lib/wakelock.js'
import { DAYN, fmtDate, fmtNum, localTZ, uid } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import Icon from '../components/Icon.jsx'
import LineChart from '../components/LineChart.jsx'
import { Button, Row, Section, Segmented, SelectRow, Switch, TextField, NumberField } from '../components/ui.jsx'
import { confirmSheet } from '../sheets.jsx'

const update = fn => useStore.getState().update(fn)
const ui = () => useUI.getState()
const toast = message => ui().toast(message)
const list = v => (Array.isArray(v) ? v : [])

const KIND_LABEL = { check: 'Yes / no', quantity: 'Amount with a goal', timer: 'Time with a timer', avoid: 'Avoid (bad habit)', auto: 'Automatic (from the app)', task: 'One-off task' }
const SOURCE_LABEL = { workout: 'Workout', weight: 'Weigh-in', meds: 'Medications', meals: 'Meals', sleep: 'Sleep', photo: 'Progress photo' }
const SLOT_LABEL = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snacks' }
const SCHED_LABEL = { daily: 'Every day', weekdays: 'Days of the week', monthdays: 'Days of the month', perWeek: 'Times a week' }
const STATE_LABEL = { done: 'Done', partial: 'In progress', missed: 'Missed', failed: 'Failed', skipped: 'Skipped', pending: 'To do', off: 'Not today' }
const COLORS = ['#30d158', '#0a84ff', '#ff9f0a', '#ff453a', '#bf5af2', '#64d2ff', '#ffd60a', '#ff375f']
const ICONS = ['✅', '💧', '📖', '🧘', '🏃', '🏋️', '⚖️', '💊', '🍽️', '😴', '🚭', '🍬', '📵', '🦷', '🌿', '✍️']
const WEEK = [0, 1, 2, 3, 4, 5, 6]
const iconOf = h => h.icon || { check: '✅', quantity: '💧', timer: '⏱️', avoid: '🚫', task: '📝', auto: { workout: '🏋️', weight: '⚖️', meds: '💊', meals: '🍽️', sleep: '😴', photo: '📸' }[h.auto?.source] || '🔄' }[h.kind]
const unitText = u => (u ? t(u) : '')
const valueText = (v, h) => (h.kind === 'timer' ? `${fmtNum(Math.floor(v))} min` : `${fmtNum(Math.round(v * 10) / 10)} ${unitText(h.goal?.unit)}`.trim())
const stepOf = h => (h.goal?.unit === 'ml' ? 250 : h.goal?.unit === 'g' ? 50 : h.goal?.unit === 'steps' ? 1000 : h.goal?.value >= 20 ? Math.round(h.goal.value / 8) : 1)

const download = (text, name, type) => {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}
const downloadIcs = (habits, name) => download(icsFor(habits), name.replace(/[^\p{L}\p{N} _-]/gu, '').trim().replace(/\s+/g, '-').toLowerCase() + '.ics', 'text/calendar')

// The last seven days in the list: bars of the amount, a grid of the days, or a line.
function MiniChart({ h, S, today }) {
  const days = series(h, S, addDays(today, -6), today, today)
  const max = Math.max(1, ...days.map(x => (h.kind === 'check' || h.kind === 'task' ? 1 : x.goal || x.value)), ...days.map(x => x.value))
  const color = h.color || 'var(--acc)'
  if (h.listChart === 'grid') return <div className="hab-mini grid">{days.map(x => <i key={x.d} className={'s-' + x.state} style={x.state === 'done' ? { background: color } : undefined} />)}</div>
  if (h.listChart === 'line') {
    const pts = days.map((x, i) => `${i * 10},${20 - (Math.min(x.value, max) / max) * 18}`).join(' ')
    return <svg className="hab-mini" viewBox="0 0 60 22" width="60" height="22" aria-hidden="true"><polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" /></svg>
  }
  return <div className="hab-mini bars">{days.map(x => <i key={x.d} style={{ height: 3 + (Math.min(x.value, max) / max) * 17, background: x.state === 'done' ? color : 'var(--surface-3)' }} />)}</div>
}

/* ---------- the day's actions ---------- */

const logOf = (S, h, d) => list(S.habitLog).find(e => e?.id === logId(h.id, d)) || null
// Marks, then celebrates a milestone the streak has just reached.
function act(h, d, fn) {
  const S0 = useStore.getState().S
  const today = todayOf(S0)
  const before = milestones(h, S0, today).length
  update(s => { s.habitLog = fn(list(s.habitLog)) })
  const after = milestones(h, useStore.getState().S, today)
  if (after.length > before) toast(t('🏆 {0}: {1} in a row!', h.name, t(after.at(-1).unit === 'weeks' ? '{0} weeks' : '{0} days', after.at(-1).days)))
}

export function useNow(running) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => { if (!running) return; const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id) }, [running])
  return now
}

function QuantityBar({ h, d, st }) {
  const ref = useRef(null)
  const pct = Math.min(100, (st.value / (st.goal || 1)) * 100)
  // Dragging along the bar sets the amount (in steps of the habit's step).
  const setFrom = e => {
    const r = ref.current.getBoundingClientRect()
    const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
    const step = stepOf(h)
    act(h, d, log => setValue(log, h, d, Math.round((x * st.goal) / step) * step))
  }
  return <div ref={ref} className="hab-bar" onPointerDown={e => { e.currentTarget.setPointerCapture?.(e.pointerId); setFrom(e) }}
    onPointerMove={e => { if (e.buttons) setFrom(e) }} role="slider" aria-valuemin={0} aria-valuemax={st.goal} aria-valuenow={st.value} aria-label={h.name}>
    <div className={'hab-fill' + (st.state === 'done' ? ' done' : '')} style={{ width: pct + '%', background: h.color || undefined }} />
  </div>
}

function TimerButton({ h, d, entry, now }) {
  const running = !!entry?.timer
  const alerted = useRef(0)
  useEffect(() => {
    if (!running) { alerted.current = 0; return }
    if (timerReached(h, entry, now)) { act(h, d, log => stopTimer(log, h, d, now)); try { navigator.vibrate?.(300) } catch { /* no vibration */ } toast(t('{0}: goal reached', h.name)); return }
    const every = h.timer?.intervalMin
    if (every > 0) {
      const n = Math.floor(timerExtra(entry, now) / every)
      if (n > alerted.current) { alerted.current = n; try { navigator.vibrate?.([120, 80, 120]) } catch { /* no vibration */ } }
    }
  }, [now, running]) // eslint-disable-line react-hooks/exhaustive-deps
  return <button className={'hab-act' + (running ? ' on' : '')} aria-label={running ? t('Stop the timer') : t('Start the timer')}
    onClick={e => { e.stopPropagation(); act(h, d, log => (running ? stopTimer(log, h, d) : startTimer(log, h, d))) }}>
    <Icon name={running ? 'pause' : 'play'} />
  </button>
}

export function HabitRow({ h, d, S, today, now, drag }) {
  const entry = logOf(S, h, d)
  const st = statusOn(h, d, S, today, now)
  const sk = h.showStreak !== false && !S.habitPrefs?.hideStreaks && h.kind !== 'task' ? streak(h, S, today) : null
  const sub = (() => {
    if (st.state === 'skipped' || st.state === 'failed') return t(STATE_LABEL[st.state])
    if (h.kind === 'avoid') return t('{0} days without', sk?.current ?? 0)
    if (h.kind === 'quantity' || h.kind === 'timer') return `${valueText(st.value, h)} / ${valueText(st.goal, h)}`
    if (h.kind === 'auto') return autoText(h, st)
    if (h.kind === 'task') return h.due ? (h.due < today ? t('Overdue since {0}', fmtDate(h.due, true)) : fmtDate(h.due, true)) : t('Task')
    return t(STATE_LABEL[st.state])
  })()
  const done = st.state === 'done'
  return <div className={'hab-row' + (done ? ' done' : '') + (st.state === 'failed' || st.state === 'missed' ? ' miss' : '') + (drag?.active ? ' dragging' : '')} data-habit={h.id}>
    {drag && <span className="hab-handle" onPointerDown={drag.start} aria-label={t('Drag to reorder')} role="button"><Icon name="list" /></span>}
    <button className="hab-main" onClick={() => habitSheet(h.id)}>
      <span className="hab-icon" style={{ background: h.color ? h.color + '33' : undefined }}>{iconOf(h)}</span>
      <span className="hab-text">
        <span className="hab-name">{h.name}</span>
        <span className="small dim">{sub}{sk && sk.current > 1 && h.kind !== 'avoid' ? ` · 🔥 ${sk.current}` : ''}</span>
        {h.kind === 'quantity' && st.state !== 'skipped' && <QuantityBar h={h} d={d} st={st} />}
      </span>
    </button>
    {h.listChart && !drag && <MiniChart h={h} S={S} today={today} />}
    {drag ? null : <>
    {(h.kind === 'check' || h.kind === 'task') && st.state !== 'skipped' && <button className={'hab-act' + (done ? ' on' : '')} aria-label={done ? t('Mark as not done') : t('Mark as done')}
      onClick={() => act(h, d, log => toggleDone(log, h, d))}><Icon name="check" /></button>}
    {h.kind === 'quantity' && st.state !== 'skipped' && <button className="hab-act" aria-label={t('Add {0}', valueText(stepOf(h), h))}
      onClick={() => act(h, d, log => addValue(log, h, d, stepOf(h)))}><Icon name="plus" /></button>}
    {h.kind === 'timer' && st.state !== 'skipped' && <TimerButton h={h} d={d} entry={entry} now={now} />}
    {h.kind === 'avoid' && <button className="hab-act slip" aria-label={t('Log a slip')} onClick={() => act(h, d, log => addSlip(log, h, d))}><Icon name="xmark" /></button>}
    {h.kind === 'auto' && <span className={'hab-auto ' + st.state}>{done ? <Icon name="check" /> : st.state === 'partial' ? `${fmtNum(st.value)}/${fmtNum(st.goal)}` : '–'}</span>}
    </>}
  </div>
}

function autoText(h, st) {
  const src = t(SOURCE_LABEL[h.auto?.source])
  if (st.state === 'off') return `${src} · ${t('Nothing due today')}`
  if (h.auto?.source === 'workout') return [src, st.detail || null].filter(Boolean).join(' · ')
  if (h.auto?.source === 'weight') return st.detail ? `${src} · ${fmtNum(+st.detail)} kg` : src
  if (h.auto?.source === 'meds') return `${src} · ${t('{0} of {1} doses', st.value, st.goal)}`
  if (h.auto?.source === 'meals') return h.auto.mode === 'target' ? `${src} · ${fmtNum(st.value)} / ${fmtNum(st.goal)} kcal` : `${src} · ${t('{0} of {1} meals', st.value, st.goal)}`
  if (h.auto?.source === 'sleep') return h.auto.mode === 'bedBy' ? `${src} · ${t('in bed by {0}', h.auto.bedBy)}${st.detail ? ' · ' + st.detail : ''}` : `${src} · ${fmtNum(Math.floor(st.value / 60))}h${String(st.value % 60).padStart(2, '0')} / ${fmtNum(st.goal / 60)}h`
  return src
}

/* ---------- the screen ---------- */

function WeekStrip({ S, d, setD, today }) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6))
  return <div className="hab-week">{days.map(x => {
    const p = dailyProgress(S, x, today)
    const pct = p.total ? p.done / p.total : 0
    return <button key={x} className={'hab-day' + (x === d ? ' sel' : '')} onClick={() => setD(x)} aria-label={fmtDate(x, true)}>
      <span className="small dim">{t(DAYN[new Date(x + 'T12:00:00').getDay()]).slice(0, 3)}</span>
      <span className="hab-ring" style={{ '--p': pct }}><b>{+x.slice(8)}</b></span>
    </button>
  })}</div>
}

// Dragging a habit by its handle along its list: the rows below or above make room, the new
// order is saved on release. Pointer events, so it works with a finger as with a mouse.
function useDragOrder(ids, onDone) {
  const [state, setState] = useState(null)   // { id, order }
  const start = id => e => {
    e.preventDefault()
    const list0 = [...ids]
    let order = list0
    setState({ id, order })
    const move = ev => {
      const rows = [...document.querySelectorAll('[data-habit]')].filter(el => list0.includes(el.dataset.habit))
      const over = rows.find(el => { const r = el.getBoundingClientRect(); return ev.clientY >= r.top && ev.clientY <= r.bottom })
      if (!over || over.dataset.habit === id) return
      const without = order.filter(x => x !== id)
      without.splice(without.indexOf(over.dataset.habit) + (order.indexOf(over.dataset.habit) > order.indexOf(id) ? 1 : 0), 0, id)
      order = without
      setState({ id, order })
    }
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); setState(null); onDone(order) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  return { state, start }
}

const SOURCE_NAME = () => ({ meds: t('Medications'), workout: t('Workout'), weight: t('Weigh-in'), meals: t('Meals'), sleep: t('Sleep'), photo: t('Progress photo') })
const addHabits = hs => update(s => { s.habits = [...list(s.habits).filter(x => !hs.some(h => h.id === x.id)), ...hs] })

// The habits the app's own data asks for (lib/habits.js suggestedHabits): made on the first visit,
// offered here afterwards when a module gets data of its own (a first medication, say).
function Suggestions({ S, today }) {
  const dismissed = list(S.habitPrefs?.dismissed)
  const hs = suggestedHabits(S, today, SOURCE_NAME()).filter(h => !dismissed.includes(h.auto.source))
  if (!hs.length) return null
  const dismiss = src => update(s => { s.habitPrefs = { ...(s.habitPrefs || {}), dismissed: [...list(s.habitPrefs?.dismissed), src] } })
  return <div className="card hab-suggest">
    <div className="muted small" style={{ marginBottom: 6 }}>{t('From what you already log')}</div>
    {hs.map(h => <div key={h.id} className="row between" style={{ gap: 8, padding: '6px 0' }}>
      <span>{iconOf(h)} <b>{h.name}</b> <span className="small dim">· {t(SCHED_LABEL[h.schedules[0].type])}{h.schedules[0].times ? ` (${h.schedules[0].times}×)` : ''}</span></span>
      <span className="row" style={{ gap: 4 }}>
        <Button size="xs" onClick={() => { addHabits([h]); toast(t('Habit created')) }}>{t('Add')}</Button>
        <button className="iconbtn" aria-label={t('Not now')} onClick={() => dismiss(h.auto.source)}><Icon name="xmark" /></button>
      </span>
    </div>)}
    {hs.length > 1 && <Button size="sm" variant="primary" onClick={() => { addHabits(hs); toast(t('{0} habits created', hs.length)) }}>{t('Add all')}</Button>}
  </div>
}

function Today({ S, today }) {
  const [d, setD] = useState(today)
  const [ordering, setOrdering] = useState(false)
  const [q, setQ] = useState('')
  const [group, setGroup] = useState(null)
  const prefs = S.habitPrefs || {}
  const groups = list(S.habitGroups).slice().sort((a, b) => (a.order || 0) - (b.order || 0))
  const anyTimer = list(S.habitLog).some(e => e?.timer && e.d === d)
  const now = useNow(anyTimer)
  useWakeLock(anyTimer)
  const fold = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  const shown = activeHabits(S).filter(h => {
    if (h.kind === 'task' && logOf(S, h, d)?.done && d === today && h.due !== d) return false
    if (q && !fold(h.name).includes(fold(q))) return false
    if (group && !list(h.groups).includes(group)) return false
    const st = statusOn(h, d, S, today, now).state
    if (h.kind === 'task') { const doneDay = list(S.habitLog).find(e => e?.habitId === h.id && e.done); if (doneDay && doneDay.d !== d) return false }
    if (st === 'off' && scheduleFor(h, d).type !== 'perWeek' && h.kind !== 'auto') return false
    if (prefs.hideDone && st === 'done') return false
    if (prefs.hideFailed && (st === 'failed' || st === 'missed')) return false
    if (prefs.hideSkipped && st === 'skipped') return false
    return true
  }).sort((a, b) => (a.order || 0) - (b.order || 0))
  const byGroup = list0 => [...groups.map(g => [g, list0.filter(h => list(h.groups)[0] === g.id)]), [null, list0.filter(h => !groups.some(g => g.id === list(h.groups)[0]))]].filter(([, xs]) => xs.length)
  const p = dailyProgress(S, d, today)
  const drag = useDragOrder(shown.map(h => h.id), order => update(s => { s.habits = reorder(s.habits, order) }))
  const ordered = drag.state ? drag.state.order.map(id => shown.find(h => h.id === id)).filter(Boolean) : shown
  return <>
    <WeekStrip S={S} d={d} setD={setD} today={today} />
    <div className="row between" style={{ margin: '4px 2px 10px' }}>
      <div><b>{d === today ? t('Today') : fmtDate(d, true)}</b> <span className="small dim">· {t('{0} of {1} done', p.done, p.total)}</span></div>
      {shown.length > 1 && <Button size="xs" variant="ghost" icon={ordering ? 'check' : 'list'} onClick={() => setOrdering(!ordering)}>{ordering ? t('Done') : t('Reorder')}</Button>}
    </div>
    <div className="exam-search" style={{ marginBottom: 8 }}>
      <Icon name="magnifier" />
      <input type="search" value={q} placeholder={t('Search habits')} aria-label={t('Search habits')} onChange={e => setQ(e.target.value)} />
    </div>
    {groups.length > 0 && <div className="row hab-chips">
      <button className={'exam-chip' + (!group ? ' on' : '')} onClick={() => setGroup(null)}>{t('All')}</button>
      {groups.map(g => <button key={g.id} className={'exam-chip' + (group === g.id ? ' on' : '')} onClick={() => setGroup(group === g.id ? null : g.id)}>{g.name}</button>)}
    </div>}
    <Suggestions S={S} today={today} />
    {!activeHabits(S).length && <div className="card">
      <div className="muted small">{t('Create your first habit. Workouts, weigh-ins, medications, meals and sleep can mark themselves from what you log in the app.')}</div>
      <div style={{ height: 10 }} /><Button variant="primary" icon="plus" onClick={() => habitFormSheet()}>{t('New habit')}</Button>
    </div>}
    <div className="hab-groups">
      {byGroup(ordered).map(([g, xs]) => {
        const collapsed = g?.collapsed
        return <div key={g?.id || 'none'} className="hab-group">
          {g && <button className="hab-ghead" onClick={() => update(s => { const x = s.habitGroups.find(y => y.id === g.id); if (x) x.collapsed = !x.collapsed })}>
            <Icon name={collapsed ? 'chevronRight' : 'chevronDown'} /> {g.name} <span className="small dim">{xs.filter(h => statusOn(h, d, S, today, now).state === 'done').length}/{xs.length}</span>
          </button>}
          {(!collapsed || ordering) && <div className="hab-list">{xs.map(h => <HabitRow key={h.id} h={h} d={d} S={S} today={today} now={now}
            drag={ordering ? { start: drag.start(h.id), active: drag.state?.id === h.id } : null} />)}</div>}
        </div>
      })}
    </div>
  </>
}

function Bars({ values, labels, color = 'var(--red)' }) {
  const max = Math.max(1, ...values)
  return <div className="hab-bars">{values.map((v, i) => <div key={i} className="hab-bcol" title={`${labels[i]}: ${v}`}>
    <div className="hab-bval small dim">{v || ''}</div>
    <div className="hab-b" style={{ height: (v / max) * 70 + 2, background: color }} />
    <div className="small dim">{labels[i]}</div>
  </div>)}</div>
}

function Recap({ S, today }) {
  const r = weeklyRecap(S, today)
  if (!r.week.total) return null
  const best = r.week.habits.filter(x => x.done === x.total).map(x => x.habit)
  const weak = r.week.habits.filter(x => x.done / x.total < 0.5).map(x => x.habit)
  return <div className="card hab-recap">
    <div className="muted small">{t('Your week')} · {fmtDate(r.from, true)} – {fmtDate(r.to, true)}</div>
    <div className="big">{Math.round(r.week.rate * 100)}% <span className="muted" style={{ fontSize: '1rem' }}>{t('{0} of {1} done', r.week.done, r.week.total)}</span></div>
    {r.change != null && <div className="small" style={{ color: r.change >= 0 ? 'var(--acc)' : 'var(--orange)' }}>{r.change >= 0 ? t('{0} points better than the week before', r.change) : t('{0} points below the week before', -r.change)}</div>}
    {best.length > 0 && <div className="small" style={{ marginTop: 6 }}>✅ {t('Every day: {0}', best.map(h => h.name).join(', '))}</div>}
    {weak.length > 0 && <div className="small dim" style={{ marginTop: 2 }}>⚠️ {t('Fell behind: {0}', weak.map(h => h.name).join(', '))}</div>}
  </div>
}

function Stats({ S, today }) {
  const [range, setRange] = useState(30)
  const from = addDays(today, -(range - 1))
  const rows = activeHabits(S).filter(h => h.kind !== 'task').map(h => ({ h, st: stats(h, S, from, today, today), sk: streak(h, S, today) }))
  const daily = Array.from({ length: range }, (_, i) => addDays(from, i)).map(d => { const p = dailyProgress(S, d, today); return { t: Date.parse(d + 'T12:00:00'), y: p.total ? Math.round((p.done / p.total) * 100) : null, d } }).filter(x => x.y != null)
  const misses = weekdayMisses(S, from, today, today)
  const ws = S.weekStart === 0 ? 0 : 1
  const order = WEEK.map(i => (i + ws) % 7)
  const worst = rows.filter(r => r.st.missed + r.st.failed > 0).sort((a, b) => (b.st.missed + b.st.failed) - (a.st.missed + a.st.failed)).slice(0, 5)
  return <>
    <Recap S={S} today={today} />
    <Segmented className="seg-range" value={range} onChange={setRange} options={[{ value: 7, label: '7D' }, { value: 30, label: '30D' }, { value: 90, label: '90D' }]} />
    <div className="card" style={{ marginTop: 12 }}>
      <div className="muted small">{t('Habits done per day')}</div>
      {daily.length > 1 ? <div className="chart" style={{ marginTop: 8 }}><LineChart points={daily} h={150} unit="%" color="var(--acc)" goal={100} /></div> : <div className="muted small">{t('Nothing logged in this period.')}</div>}
    </div>
    <h4 className="sec" style={{ margin: '16px 2px 8px' }}>{t('Each habit')}</h4>
    <Section>{rows.sort((a, b) => (b.st.rate ?? -1) - (a.st.rate ?? -1)).map(({ h, st, sk }) => <Row key={h.id} title={`${iconOf(h)} ${h.name}`}
      subtitle={[t('{0} done', st.done), st.missed + st.failed ? t('{0} missed', st.missed + st.failed) : null, st.skipped ? t('{0} skipped', st.skipped) : null, sk.best ? t('best {0}', sk.best) : null].filter(Boolean).join(' · ')}
      value={st.rate == null ? '–' : `${Math.round(st.rate * 100)}%`} accessory="chevron" onClick={() => habitSheet(h.id)} />)}</Section>
    {worst.length > 0 && <><h4 className="sec" style={{ margin: '16px 2px 8px' }}>{t('Missed the most')}</h4>
      <Section>{worst.map(({ h, st }) => <Row key={h.id} title={`${iconOf(h)} ${h.name}`} value={t('{0} missed', st.missed + st.failed)} />)}</Section></>}
    <div className="card" style={{ marginTop: 16 }}>
      <div className="muted small">{t('Misses by weekday')}</div>
      <Bars values={order.map(i => misses[i])} labels={order.map(i => t(DAYN[i]).slice(0, 3))} />
    </div>
  </>
}

export default function Habits() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const loc = useLocation()
  const [tab, setTab] = useState(() => (/recap=1/.test(loc.search) ? 'stats' : 'today'))
  const today = todayOf(S)
  // The first visit: the habits the app's data asks for are made at once, already marked by it.
  useEffect(() => {
    const st = useStore.getState().S
    if (st.habitPrefs?.seeded) return
    const hs = suggestedHabits(st, todayOf(st), SOURCE_NAME())
    update(s => { if (hs.length) s.habits = [...list(s.habits).filter(x => !hs.some(h => h.id === x.id)), ...hs]; s.habitPrefs = { ...(s.habitPrefs || {}), seeded: true } })
    if (hs.length) toast(t('{0} habits made from what you already log: {1}', hs.length, hs.map(h => h.name).join(', ')))
  }, [])
  return <div className="narrow wide-ok">
    <div className="hdr">
      {loc.pathname.startsWith('/health') && <button className="iconbtn" onClick={() => nav('/health')} aria-label={t('Health')}><Icon name="chevronLeft" /></button>}
      <div style={{ flex: 1, marginLeft: loc.pathname.startsWith('/health') ? 10 : 0 }}><h1>{t('Habits')}</h1><div className="sub">{t('Habits and tasks, with what the app already logs')}</div></div>
      <button className="iconbtn" onClick={habitSettingsSheet} aria-label={t('Habit settings')}><Icon name="gear" /></button>
      <button className="iconbtn" onClick={() => habitFormSheet()} aria-label={t('New habit')}><Icon name="plus" /></button>
    </div>
    <Segmented value={tab} onChange={setTab} options={[{ value: 'today', label: t('Today') }, { value: 'stats', label: t('Statistics') }]} />
    <div style={{ height: 12 }} />
    {tab === 'today' ? <Today S={S} today={today} /> : <Stats S={S} today={today} />}
  </div>
}

/** Today's habits done, for the Health hub and Home: { done, total } or null without habits. */
export function habitsToday(S) {
  if (!activeHabits(S).length) return null
  const today = todayOf(S)
  return dailyProgress(S, today, today)
}

/* ---------- one habit: detail ---------- */

function YearGrid({ h, S, today }) {
  const ref = useRef(null)
  useEffect(() => { if (ref.current) ref.current.scrollLeft = ref.current.scrollWidth }, [])
  const ws = S.weekStart === 0 ? 0 : 1
  const end = addDays(today, 6 - ((new Date(today + 'T12:00:00').getDay() - ws + 7) % 7))
  const start = addDays(end, -(53 * 7 - 1))
  const days = series(h, S, start, end, today)
  const cols = []
  for (let i = 0; i < days.length; i += 7) cols.push(days.slice(i, i + 7))
  const cls = x => (x.d > today ? 'future' : x.state === 'done' ? 'l4' : x.state === 'partial' ? 'l2' : x.state === 'missed' || x.state === 'failed' ? 'miss' : x.state === 'skipped' ? 'skip' : 'l0')
  return <div className="hm-wrap" ref={ref}><div className="hm-grid hab-year">{cols.map((c, i) => <div key={i} className="hm-col">{c.map(x =>
    <div key={x.d} className={'hm-c ' + cls(x) + (x.d === today ? ' today' : '')} title={`${x.d} · ${t(STATE_LABEL[x.state])}`} />)}</div>)}</div></div>
}

function HabitDetail({ id, close }) {
  const S = useStore(s => s.S)
  const h = list(S.habits).find(x => x.id === id)
  const [range, setRange] = useState(30)
  if (!h) return <><h3>{t('Habit')}</h3><div className="muted small">{t('This habit was removed.')}</div><Button onClick={close}>{t('Close')}</Button></>
  const today = todayOf(S)
  const sk = streak(h, S, today)
  const from = addDays(today, -(range - 1))
  const st = stats(h, S, from, today, today)
  const ms = milestones(h, S, today)
  const st0 = statusOn(h, today, S, today)
  const pts = h.kind === 'quantity' || h.kind === 'timer' || (h.kind === 'auto' && ['sleep', 'meals'].includes(h.auto?.source))
    ? series(h, S, from, today, today).filter(x => x.state !== 'off').map(x => ({ t: Date.parse(x.d + 'T12:00:00'), y: h.auto?.source === 'sleep' ? Math.round(x.value / 6) / 10 : x.value, d: x.d })) : []
  const medRows = h.auto?.source === 'meds' ? list(S.meds).filter(m => m.active !== false).map(m => ({ m, a: adherence([m], S.medLog, from, today, { d: today, hhmm: '23:59' }) })) : []
  const skipToday = st0.state === 'skipped'
  return <>
    <div className="row" style={{ gap: 10, alignItems: 'center' }}>
      <span className="hab-icon big" style={{ background: h.color ? h.color + '33' : undefined }}>{iconOf(h)}</span>
      <div style={{ flex: 1 }}><h3 style={{ margin: 0 }}>{h.name}</h3><div className="small dim">{t(KIND_LABEL[h.kind])}{h.kind === 'auto' ? ' · ' + t(SOURCE_LABEL[h.auto.source]) : ''} · {t(SCHED_LABEL[scheduleFor(h, today).type])}</div></div>
    </div>
    {h.kind !== 'task' && <>
      {h.showStreak !== false && !S.habitPrefs?.hideStreaks && <div className="tiles" style={{ marginTop: 12 }}>
        <div className="tile"><div className="l">{t('Streak')}</div><div className="v">{sk.current} <span className="small dim">{t(sk.unit)}</span></div></div>
        <div className="tile"><div className="l">{t('Best')}</div><div className="v">{sk.best} <span className="small dim">{t(sk.unit)}</span></div></div>
        <div className="tile"><div className="l">{t('Success')}</div><div className="v">{st.rate == null ? '–' : `${Math.round(st.rate * 100)}%`}</div></div>
      </div>}
      <Segmented className="seg-range" value={range} onChange={setRange} options={[{ value: 7, label: '7D' }, { value: 30, label: '30D' }, { value: 90, label: '90D' }]} />
      <div className="small dim" style={{ margin: '8px 2px' }}>{[t('{0} done', st.done), st.partial ? t('{0} partial', st.partial) : null, t('{0} missed', st.missed + st.failed), st.skipped ? t('{0} skipped', st.skipped) : null].filter(Boolean).join(' · ')}</div>
      {pts.length > 1 && <div className="chart"><LineChart points={pts} h={140} unit={h.auto?.source === 'sleep' ? 'h' : h.auto?.source === 'meals' ? 'kcal' : h.kind === 'timer' ? 'min' : unitText(h.goal?.unit)} color={h.color || 'var(--acc)'}
        goal={h.kind === 'auto' ? (h.auto.source === 'sleep' ? (S.sleepPrefs?.goalMin || 480) / 60 : S.nutrition?.targets?.kcal) : h.goal?.value} /></div>}
      <h4 className="sec" style={{ margin: '14px 2px 6px' }}>{t('The year')}</h4>
      <YearGrid h={h} S={S} today={today} />
      {medRows.length > 0 && <><h4 className="sec" style={{ margin: '14px 2px 6px' }}>{t('Regularity of each medication')}</h4>
        <Section>{medRows.map(({ m, a }) => <Row key={m.id} title={m.name} subtitle={[t('{0} taken', a.taken), a.missed ? t('{0} missed', a.missed) : null, a.skipped ? t('{0} skipped', a.skipped) : null].filter(Boolean).join(' · ')}
          value={a.pct == null ? '–' : `${Math.round(a.pct)}%`} />)}</Section></>}
      <h4 className="sec" style={{ margin: '14px 2px 6px' }}>{t('Milestones')}</h4>
      <div className="row hab-chips">{MILESTONES.map(m => <span key={m} className={'exam-chip' + (ms.some(x => x.days === m) ? ' on hab-won' : '')}>{ms.some(x => x.days === m) ? '🏆 ' : ''}{t(sk.unit === 'weeks' ? '{0} weeks' : '{0} days', m)}</span>)}</div>
    </>}
    {(h.rule?.cue || h.rule?.routine || h.rule?.reward) && <div className="card" style={{ marginTop: 12 }}>
      <div className="muted small" style={{ marginBottom: 6 }}>{t('Golden rule')}</div>
      {h.rule.cue && <div className="small"><b>{t('Cue')}:</b> {h.rule.cue}</div>}
      {h.rule.routine && <div className="small"><b>{t('Routine')}:</b> {h.rule.routine}</div>}
      {h.rule.reward && <div className="small"><b>{t('Reward')}:</b> {h.rule.reward}</div>}
    </div>}
    <div style={{ height: 12 }} />
    <Section>
      <Row icon="pencil" title={t('Edit')} onClick={() => habitFormSheet(h.id)} accessory="chevron" />
      {h.kind !== 'avoid' && <Row icon="calendar" title={t('Add to my calendar (.ics)')} subtitle={t('Events at its reminder times, repeating as it does')} onClick={() => downloadIcs([h], h.name)} />}
      <Row icon="copy" title={t('Duplicate')} onClick={() => { const c = duplicateHabit(h, t('{0} (copy)', h.name), { today }); update(s => { s.habits = [...list(s.habits), c] }); toast(t('Habit duplicated')) }} />
      <Row icon="history" title={skipToday ? t('Undo skip today') : t('Skip today')} onClick={() => act(h, today, log => setState(log, h, today, skipToday ? null : 'skipped'))} />
      {h.kind !== 'auto' && <Row icon="xmark" title={st0.state === 'failed' ? t('Undo failed today') : t('Mark today as failed')} onClick={() => act(h, today, log => setState(log, h, today, st0.state === 'failed' ? null : 'failed'))} />}
      {h.kind === 'avoid' && logOf(S, h, today)?.slips > 0 && <Row icon="history" title={t('Undo the last slip')} onClick={() => act(h, today, log => undoSlip(log, h, today))} />}
      <Row icon="folder" title={t('Archive')} onClick={() => { update(s => { const x = s.habits.find(y => y.id === h.id); if (x) x.archived = true }); close(); toast(t('Habit archived. Its history is kept.')) }} />
    </Section>
    <div style={{ height: 10 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Close')}</Button>
  </>
}
export const habitSheet = id => ui().openSheet(close => <HabitDetail id={id} close={close} />)

/* ---------- one habit: create, edit ---------- */

function DayChips({ values, options, labels, onChange }) {
  const set = new Set(values)
  return <div className="row hab-chips">{options.map((v, i) => <button key={v} type="button" className={'exam-chip' + (set.has(v) ? ' on' : '')}
    onClick={() => { const n = new Set(set); if (n.has(v)) n.delete(v); else n.add(v); onChange([...n]) }}>{labels[i]}</button>)}</div>
}

function HabitForm({ id, preset, close }) {
  const S = useStore(s => s.S)
  const prev = id ? list(S.habits).find(x => x.id === id) : null
  const today = todayOf(S)
  const [f, setF] = useState(() => {
    const s = prev ? scheduleFor(prev, today) : { type: 'daily' }
    return {
      name: prev?.name || '', kind: prev?.kind || preset?.kind || 'check', icon: prev?.icon || '', color: prev?.color || '',
      goal: { value: prev?.goal?.value || null, unit: prev?.goal?.unit || 'ml' },
      auto: { source: prev?.auto?.source || 'workout', mode: prev?.auto?.mode || '', slots: prev?.auto?.slots || ['breakfast', 'lunch', 'dinner'], bedBy: prev?.auto?.bedBy || '23:30' },
      schedule: { type: s.type, days: s.days || [], times: s.times || 3 }, start: prev?.start || today, end: prev?.end || '', due: prev?.due || '',
      groups: prev?.groups || [], reminders: prev?.reminders || [], timer: prev?.timer || { stopAtGoal: true, intervalMin: 0, tapStarts: true },
      rule: prev?.rule || { cue: '', routine: '', reward: '' }, excludeFromDaily: !!prev?.excludeFromDaily, showStreak: prev?.showStreak !== false,
      smartReminder: !!prev?.smartReminder, listChart: prev?.listChart || ''
    }
  })
  const set = (k, v) => setF(x => ({ ...x, [k]: v }))
  const groups = list(S.habitGroups)
  const save = () => {
    const h = normalizeHabit({ ...f, end: f.end || null, due: f.due || null }, { prev, today })
    if (h.error) { toast(t({ name: 'Give the habit a name.', goal: 'Set the goal.', source: 'Choose where it comes from.', days: 'Choose at least one day.', end: 'The end is before the start.' }[h.error])); return }
    update(s => { s.habits = [...list(s.habits).filter(x => x.id !== h.id), h] })
    close()
    toast(prev ? t('Habit saved') : t('Habit created'))
  }
  const addGroup = () => {
    const name = window.prompt(t('Name of the group'))?.trim()
    if (!name) return
    const g = { id: uid(), name: name.slice(0, 40), order: Date.now() }
    update(s => { s.habitGroups = [...list(s.habitGroups), g] })
    set('groups', [...f.groups, g.id])
  }
  const k = f.kind
  return <>
    <h3>{prev ? t('Edit habit') : t('New habit')}</h3>
    <div className="med-form">
      <label><span>{t('Name')}</span><TextField value={f.name} maxLength={60} placeholder={t('e.g. Drink water')} onChange={e => set('name', e.target.value)} /></label>
      <div className="sect-b"><SelectRow title={t('Type')} sheetTitle={t('Type')} value={k} onChange={v => set('kind', v)} options={KINDS.map(x => ({ value: x, label: t(KIND_LABEL[x]) }))} /></div>
      {k === 'auto' && <>
        <div className="sect-b"><SelectRow title={t('Comes from')} sheetTitle={t('Comes from')} value={f.auto.source} onChange={v => set('auto', { ...f.auto, source: v, mode: '' })} options={SOURCES.map(x => ({ value: x, label: t(SOURCE_LABEL[x]) }))} /></div>
        <div className="small dim">{t({ workout: 'Done on a day with a finished workout.', weight: 'Done on a day with a weigh-in.', meds: 'Done when every dose of the day is taken. Days without a dose do not count.', meals: 'Done when the meals you choose are logged, or when the day is within your calorie target.', sleep: 'Done when the night reaches your sleep goal, or when you were in bed by a time.', photo: 'Done on a day with a progress photo, kept with the weigh-in or a workout. Set it to once a week for a weekly reminder.' }[f.auto.source])}</div>
        {f.auto.source === 'meals' && <>
          <Segmented value={f.auto.mode === 'target' ? 'target' : 'slots'} onChange={v => set('auto', { ...f.auto, mode: v })} options={[{ value: 'slots', label: t('Meals logged') }, { value: 'target', label: t('Calorie target') }]} />
          {f.auto.mode !== 'target' && <DayChips values={f.auto.slots} options={MEAL_SLOTS} labels={MEAL_SLOTS.map(x => t(SLOT_LABEL[x]))} onChange={v => set('auto', { ...f.auto, slots: v })} />}
        </>}
        {f.auto.source === 'sleep' && <>
          <Segmented value={f.auto.mode === 'bedBy' ? 'bedBy' : 'goal'} onChange={v => set('auto', { ...f.auto, mode: v })} options={[{ value: 'goal', label: t('Sleep goal') }, { value: 'bedBy', label: t('In bed by') }]} />
          {f.auto.mode === 'bedBy' && <input className="field" type="time" value={f.auto.bedBy} onChange={e => set('auto', { ...f.auto, bedBy: e.target.value })} />}
        </>}
      </>}
      {(k === 'quantity' || k === 'timer') && <div className="food-macro-grid">
        <label><span>{k === 'timer' ? t('Goal (minutes)') : t('Goal')}</span><NumberField className="field" nullable value={f.goal.value} onChange={v => set('goal', { ...f.goal, value: v })} /></label>
        {k === 'quantity' && <label><span>{t('Unit')}</span><select className="field" value={f.goal.unit} onChange={e => set('goal', { ...f.goal, unit: e.target.value })}>{UNITS.map(u => <option key={u} value={u}>{t(u)}</option>)}</select></label>}
      </div>}
      {k === 'timer' && <>
        <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={f.timer.stopAtGoal} onChange={e => set('timer', { ...f.timer, stopAtGoal: e.target.checked })} /><span className="small">{t('Stop the timer at the goal')}</span></label>
        <label><span>{t('Vibrate every (minutes, 0 = never)')}</span><NumberField className="field" decimal={false} value={f.timer.intervalMin} onChange={v => set('timer', { ...f.timer, intervalMin: v })} /></label>
      </>}
      {k === 'task' ? <label><span>{t('Due (optional)')}</span><input className="field" type="date" value={f.due} onChange={e => set('due', e.target.value)} /></label> : <>
        <div className="sect-b"><SelectRow title={t('Repeat')} sheetTitle={t('Repeat')} value={f.schedule.type} onChange={v => set('schedule', { ...f.schedule, type: v, days: [] })} options={SCHEDULE_TYPES.map(x => ({ value: x, label: t(SCHED_LABEL[x]) }))} /></div>
        {f.schedule.type === 'weekdays' && <DayChips values={f.schedule.days} options={WEEK} labels={WEEK.map(i => t(DAYN[i]).slice(0, 3))} onChange={v => set('schedule', { ...f.schedule, days: v })} />}
        {f.schedule.type === 'monthdays' && <DayChips values={f.schedule.days} options={Array.from({ length: 31 }, (_, i) => i + 1)} labels={Array.from({ length: 31 }, (_, i) => String(i + 1))} onChange={v => set('schedule', { ...f.schedule, days: v })} />}
        {f.schedule.type === 'perWeek' && <label><span>{t('Times a week')}</span><NumberField className="field" decimal={false} value={f.schedule.times} onChange={v => set('schedule', { ...f.schedule, times: v })} /></label>}
        {prev && <div className="small dim">{t('A new schedule counts from today on; the days before keep the one they had.')}</div>}
        <div className="food-macro-grid">
          <label><span>{t('Starts')}</span><input className="field" type="date" value={f.start} onChange={e => set('start', e.target.value)} /></label>
          <label><span>{t('Ends (optional)')}</span><input className="field" type="date" value={f.end} onChange={e => set('end', e.target.value)} /></label>
        </div>
      </>}
      <div>
        <div className="small" style={{ color: 'var(--label-2)', marginBottom: 5 }}>{t('Groups (the first is where it shows)')}</div>
        <div className="row hab-chips">
          {groups.map(g => <button key={g.id} type="button" className={'exam-chip' + (f.groups.includes(g.id) ? ' on' : '')}
            onClick={() => set('groups', f.groups.includes(g.id) ? f.groups.filter(x => x !== g.id) : [...f.groups, g.id])}>{f.groups[0] === g.id ? '★ ' : ''}{g.name}</button>)}
          <button type="button" className="exam-chip" onClick={addGroup}>+ {t('Group')}</button>
        </div>
      </div>
      {k !== 'avoid' && <div>
        <div className="small" style={{ color: 'var(--label-2)', marginBottom: 5 }}>{t('Reminders (only if not done yet)')}</div>
        {f.reminders.map((r, i) => <div key={i} className="row" style={{ gap: 8, marginBottom: 6 }}>
          <input className="field" type="time" value={r} onChange={e => set('reminders', f.reminders.map((x, j) => (j === i ? e.target.value : x)))} />
          <button type="button" className="iconbtn" aria-label={t('Remove')} onClick={() => set('reminders', f.reminders.filter((_, j) => j !== i))}><Icon name="xmark" /></button>
        </div>)}
        {f.reminders.length < 6 && <Button size="sm" icon="bell" onClick={() => set('reminders', [...f.reminders, '09:00'])}>{t('Add reminder')}</Button>}
        {!f.reminders.length && (k === 'check' || k === 'quantity' || k === 'timer') && <label className="row" style={{ gap: 8, marginTop: 8 }}>
          <input type="checkbox" checked={f.smartReminder} onChange={e => set('smartReminder', e.target.checked)} />
          <span className="small">{(() => { const tt = prev && typicalTime(prev, S, S.habitPrefs?.tz || localTZ()); return tt ? t('Remind me at the time I usually do it ({0})', tt) : t('Remind me at the time I usually do it (after three marks)') })()}</span>
        </label>}
      </div>}
      <div>
        <div className="small" style={{ color: 'var(--label-2)', marginBottom: 5 }}>{t('Icon and colour')}</div>
        <div className="row hab-chips">{ICONS.map(x => <button key={x} type="button" className={'exam-chip' + (f.icon === x ? ' on' : '')} onClick={() => set('icon', f.icon === x ? '' : x)}>{x}</button>)}</div>
        <div className="row hab-chips">{COLORS.map(c => <button key={c} type="button" className={'hab-color' + (f.color === c ? ' on' : '')} style={{ background: c }} aria-label={c} onClick={() => set('color', f.color === c ? '' : c)} />)}</div>
      </div>
      <details className="hab-more"><summary className="small">{t('Golden rule and options')}</summary>
        <label><span>{t('Cue (what triggers it)')}</span><TextField value={f.rule.cue} maxLength={120} onChange={e => set('rule', { ...f.rule, cue: e.target.value })} /></label>
        <label><span>{t('Routine (what you do)')}</span><TextField value={f.rule.routine} maxLength={120} onChange={e => set('rule', { ...f.rule, routine: e.target.value })} /></label>
        <label><span>{t('Reward')}</span><TextField value={f.rule.reward} maxLength={120} onChange={e => set('rule', { ...f.rule, reward: e.target.value })} /></label>
        <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={f.excludeFromDaily} onChange={e => set('excludeFromDaily', e.target.checked)} /><span className="small">{t('Leave out of the daily progress')}</span></label>
        <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={f.showStreak} onChange={e => set('showStreak', e.target.checked)} /><span className="small">{t('Show the streak')}</span></label>
        <label><span>{t('Chart in the list')}</span><select className="field" value={f.listChart} onChange={e => set('listChart', e.target.value)}>
          {[['', 'None'], ['bars', 'Bars'], ['grid', 'Grid'], ['line', 'Line']].map(([v, l]) => <option key={v} value={v}>{t(l)}</option>)}</select></label>
      </details>
    </div>
    <div style={{ height: 12 }} />
    <Button variant="primary" onClick={save}>{t('Save')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
  </>
}
export const habitFormSheet = (id, preset) => ui().openSheet(close => <HabitForm id={id} preset={preset} close={close} />)

/* ---------- settings ---------- */

function HabitSettings({ close }) {
  const S = useStore(s => s.S)
  const prefs = S.habitPrefs || {}
  const setPref = patch => update(s => { s.habitPrefs = { ...(s.habitPrefs || {}), ...patch } })
  const [vac, setVac] = useState({ from: '', to: '' })
  const archived = list(S.habits).filter(h => h.archived)
  const groups = list(S.habitGroups).slice().sort((a, b) => (a.order || 0) - (b.order || 0))
  const pushOff = pushPermission() !== 'granted'
  const moveGroup = (g, dir) => update(s => {
    const gs = list(s.habitGroups).slice().sort((a, b) => (a.order || 0) - (b.order || 0))
    const i = gs.findIndex(x => x.id === g.id), j = i + dir
    if (j < 0 || j >= gs.length) return
    const a = gs[i].order || i, b = gs[j].order || j
    gs[i].order = b; gs[j].order = a === b ? b + dir : a
    s.habitGroups = gs
  })
  const exportFile = () => {
    const blob = new Blob([JSON.stringify(exportHabits(S), null, 2)], { type: 'application/json' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'opengym-habits.json'; a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }
  return <>
    <h3>{t('Habit settings')}</h3>
    <Section>
      <Row icon="bell" title={t('Habit reminders')} subtitle={pushOff ? t('Turn notifications on in Settings → Reminders first.') : t('At each reminder time, only if not done yet.')}>
        <Switch checked={!!prefs.on} onChange={() => setPref({ on: !prefs.on, tz: localTZ() })} />
      </Row>
      <Row icon="clock" title={t('The day starts at')} subtitle={t('Before this time, it is still yesterday.')}>
        <input type="time" className="timef" value={prefs.dayStartsAt || '00:00'} onChange={e => setPref({ dayStartsAt: e.target.value || '00:00' })} />
      </Row>
      <Row title={t('Hide done')}><Switch checked={!!prefs.hideDone} onChange={() => setPref({ hideDone: !prefs.hideDone })} /></Row>
      <Row title={t('Hide failed and missed')}><Switch checked={!!prefs.hideFailed} onChange={() => setPref({ hideFailed: !prefs.hideFailed })} /></Row>
      <Row title={t('Hide skipped')}><Switch checked={!!prefs.hideSkipped} onChange={() => setPref({ hideSkipped: !prefs.hideSkipped })} /></Row>
      <Row title={t('Hide streaks')}><Switch checked={!!prefs.hideStreaks} onChange={() => setPref({ hideStreaks: !prefs.hideStreaks })} /></Row>
      <Row icon="calendar" title={t('Weekly recap')} subtitle={t('A notification on the first morning of the week, with how the week went.')}>
        <Switch checked={prefs.recap !== false} onChange={() => setPref({ recap: prefs.recap === false })} />
      </Row>
    </Section>
    <h4 className="sec" style={{ margin: '14px 2px 6px' }}>{t('Vacation')}</h4>
    <div className="small dim" style={{ marginBottom: 6 }}>{t('Every habit pauses in this period: the days count as skipped.')}</div>
    {list(prefs.vacations).map((v, i) => <Row key={i} title={`${fmtDate(v.from, true)} → ${fmtDate(v.to, true)}`} accessory="none"
      onClick={() => confirmSheet({ title: t('Remove this vacation?'), confirmText: t('Remove'), danger: true, onConfirm: () => setPref({ vacations: list(prefs.vacations).filter((_, j) => j !== i) }) })} />)}
    <div className="food-macro-grid">
      <input className="field" type="date" value={vac.from} onChange={e => setVac({ ...vac, from: e.target.value })} aria-label={t('From')} />
      <input className="field" type="date" value={vac.to} onChange={e => setVac({ ...vac, to: e.target.value })} aria-label={t('To')} />
    </div>
    <div style={{ height: 6 }} />
    <Button size="sm" disabled={!vac.from || !vac.to || vac.to < vac.from} onClick={() => { setPref({ vacations: [...list(prefs.vacations), { from: vac.from, to: vac.to, habitIds: null }] }); setVac({ from: '', to: '' }) }}>{t('Add vacation')}</Button>
    {groups.length > 0 && <><h4 className="sec" style={{ margin: '14px 2px 6px' }}>{t('Groups')}</h4>
      <Section>{groups.map(g => <Row key={g.id} title={g.name} subtitle={[list(g.reminders).length ? '🔔 ' + g.reminders.join(', ') : null, g.muted ? t('Only the group reminds') : null].filter(Boolean).join(' · ')}>
        <button className="iconbtn" aria-label={t('Edit group')} onClick={() => groupFormSheet(g.id)}><Icon name="pencil" /></button>
        <button className="iconbtn" aria-label={t('Move up')} onClick={() => moveGroup(g, -1)}><Icon name="chevronUp" /></button>
        <button className="iconbtn" aria-label={t('Move down')} onClick={() => moveGroup(g, 1)}><Icon name="chevronDown" /></button>
        <button className="iconbtn" aria-label={t('Delete')} onClick={() => confirmSheet({ title: t('Delete the group {0}?', g.name), message: t('Its habits stay, without this group.'), confirmText: t('Delete'), danger: true,
          onConfirm: () => update(s => { s.habitGroups = list(s.habitGroups).filter(x => x.id !== g.id); s.habits = list(s.habits).map(h => (list(h.groups).includes(g.id) ? { ...h, groups: h.groups.filter(x => x !== g.id) } : h)) }) })}><Icon name="trash" /></button>
      </Row>)}</Section></>}
    {archived.length > 0 && <><h4 className="sec" style={{ margin: '14px 2px 6px' }}>{t('Archived')}</h4>
      <Section>{archived.map(h => <Row key={h.id} title={`${iconOf(h)} ${h.name}`}>
        <Button size="sm" onClick={() => { update(s => { const x = s.habits.find(y => y.id === h.id); if (x) x.archived = false }); toast(t('Habit restored')) }}>{t('Restore')}</Button>
        <button className="iconbtn" aria-label={t('Delete')} onClick={() => confirmSheet({ title: t('Delete {0} for good?', h.name), message: t('Its history goes too.'), confirmText: t('Delete'), danger: true,
          onConfirm: () => update(s => { s.habits = list(s.habits).filter(x => x.id !== h.id); s.habitLog = list(s.habitLog).filter(e => e?.habitId !== h.id) }) })}><Icon name="trash" /></button>
      </Row>)}</Section></>}
    <div style={{ height: 12 }} />
    <Button icon="share" onClick={exportFile}>{t('Export habits (JSON)')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Close')}</Button>
  </>
}
export const habitSettingsSheet = () => ui().openSheet(close => <HabitSettings close={close} />)

function GroupForm({ id, close }) {
  const S = useStore(s => s.S)
  const g = list(S.habitGroups).find(x => x.id === id)
  const [f, setF] = useState(() => ({ name: g?.name || '', reminders: list(g?.reminders), muted: !!g?.muted }))
  if (!g) return <><h3>{t('Group')}</h3><Button onClick={close}>{t('Close')}</Button></>
  const habits = list(S.habits).filter(h => !h.archived && list(h.groups).includes(g.id))
  const save = () => {
    const name = f.name.trim()
    if (!name) return
    update(s => { const x = s.habitGroups.find(y => y.id === id); if (x) Object.assign(x, { name: name.slice(0, 40), reminders: [...new Set(f.reminders.filter(r => /^([01]\d|2[0-3]):[0-5]\d$/.test(r)))].sort(), muted: f.muted }) })
    close(); toast(t('Group saved'))
  }
  return <>
    <h3>{t('Edit group')}</h3>
    <div className="med-form">
      <label><span>{t('Name')}</span><TextField value={f.name} maxLength={40} onChange={e => setF({ ...f, name: e.target.value })} /></label>
      <div>
        <div className="small" style={{ color: 'var(--label-2)', marginBottom: 5 }}>{t('Group reminders (if any of its habits is still to do)')}</div>
        {f.reminders.map((r, i) => <div key={i} className="row" style={{ gap: 8, marginBottom: 6 }}>
          <input className="field" type="time" value={r} onChange={e => setF({ ...f, reminders: f.reminders.map((x, j) => (j === i ? e.target.value : x)) })} />
          <button type="button" className="iconbtn" aria-label={t('Remove')} onClick={() => setF({ ...f, reminders: f.reminders.filter((_, j) => j !== i) })}><Icon name="xmark" /></button>
        </div>)}
        <Button size="sm" icon="bell" onClick={() => setF({ ...f, reminders: [...f.reminders, '07:00'] })}>{t('Add reminder')}</Button>
      </div>
      <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={f.muted} onChange={e => setF({ ...f, muted: e.target.checked })} /><span className="small">{t('Silence the reminders of each habit: only the group reminds')}</span></label>
    </div>
    <div className="small dim" style={{ margin: '10px 2px' }}>{habits.map(h => h.name).join(', ') || t('No habit in this group yet.')}</div>
    {habits.length > 0 && <Button icon="calendar" onClick={() => downloadIcs(habits, g.name)}>{t('Add the group to my calendar (.ics)')}</Button>}
    <div style={{ height: 12 }} />
    <Button variant="primary" onClick={save}>{t('Save')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
  </>
}
export const groupFormSheet = id => ui().openSheet(close => <GroupForm id={id} close={close} />)
