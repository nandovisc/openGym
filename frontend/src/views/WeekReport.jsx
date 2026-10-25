import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { healthWeek, lastWeeks, weekOf } from '../lib/health-week.js'
import { insights } from '../lib/insights.js'
import { fmtDate, fmtDur, fmtNum, todayISO } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import Icon from '../components/Icon.jsx'
import { Row, Section } from '../components/ui.jsx'
import { mlText } from './Water.jsx'

const back = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') - n * 86400000).toISOString().slice(0, 10)
const signed = (n, unit = '') => `${n > 0 ? '+' : n < 0 ? '−' : '±'}${fmtNum(Math.abs(n))}${unit}`

// Each module's line: what the week was, and how it compares with the one before.
function lines(w, p, S) {
  const out = []
  if (w.sleep) out.push({ icon: 'moon', tint: 'var(--indigo)', title: t('Sleep'), value: fmtDur(w.sleep.avgMin * 60000),
    sub: [t('{0} of {1} nights on goal', w.sleep.onGoal, w.sleep.nights), p?.sleep ? t('{0} vs the week before', signed(Math.round((w.sleep.avgMin - p.sleep.avgMin)), ' min')) : null].filter(Boolean).join(' · ') })
  if (w.training) out.push({ icon: 'dumbbell', tint: 'var(--green)', title: t('Training'), value: String(w.training.workouts),
    sub: [w.training.minutes ? fmtDur(w.training.minutes * 60000) : null, w.training.kcal ? t('{0} kcal', fmtNum(w.training.kcal)) : null, p?.training ? t('{0} vs the week before', signed(w.training.workouts - p.training.workouts)) : null].filter(Boolean).join(' · ') })
  if (w.weight) out.push({ icon: 'scale', tint: 'var(--blue)', title: t('Body weight'), value: `${fmtNum(w.weight.last)} ${w.weight.unit}`,
    sub: w.weight.change != null ? t('{0} this week', signed(w.weight.change, ' ' + w.weight.unit)) : t('One weigh-in') })
  if (w.meds) out.push({ icon: 'pill', tint: 'var(--teal)', title: t('Medications'), value: w.meds.pct + '%',
    sub: [t('{0} of {1} doses', w.meds.taken, w.meds.counted), p?.meds ? t('{0} vs the week before', signed(w.meds.pct - p.meds.pct, ' pp')) : null].filter(Boolean).join(' · ') })
  if (w.food) out.push({ icon: 'flame', tint: 'var(--orange)', title: t('Nutrition'), value: t('{0} kcal', fmtNum(w.food.kcal)),
    sub: [t('{0} g protein a day', fmtNum(w.food.p)), w.food.pTarget ? t('protein under target on {0} of {1} days', w.food.lowP, w.food.days) : null].filter(Boolean).join(' · ') })
  if (w.water) out.push({ icon: 'drop', tint: 'var(--blue)', title: t('Water'), value: mlText(w.water.avgMl),
    sub: t('{0} of {1} days on goal', w.water.onGoal, w.water.days) })
  if (w.habits) out.push({ icon: 'checkCircle', tint: 'var(--green)', title: t('Habits'), value: Math.round(w.habits.rate * 100) + '%',
    sub: [t('{0} of {1} done', w.habits.done, w.habits.total), p?.habits ? t('{0} vs the week before', signed(Math.round((w.habits.rate - p.habits.rate) * 100), ' pp')) : null].filter(Boolean).join(' · ') })
  return out
}

/** The patterns, each said with the days behind it. */
export function Patterns({ S, today, limit }) {
  const ps = insights(S, today).slice(0, limit || undefined)
  if (!ps.length) return <div className="muted small">{t('Patterns show up here once there are a few weeks of data in two modules.')}</div>
  return <div className="patterns">{ps.map(p => <div key={p.id} className="pattern">
    <Icon name="sparkles" />
    <div><div>{t(p.key, ...p.args)}</div><div className="small dim">{t(p.id === 'workouts-weight' || p.id === 'protein-weight' ? 'Over {0} weeks' : 'Over {0} days', p.n)}</div></div>
  </div>)}</div>
}

/** The week just over across the modules, its numbers against the week before, and the patterns. */
export default function WeekReport() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const today = todayISO()
  const [ago, setAgo] = useState(1)
  const start = back(weekOf(today, S.weekStart), 7 * ago)
  const w = ago === 0 ? healthWeek(S, weekOf(today, S.weekStart), today) : healthWeek(S, start, back(start, -6))
  const p = healthWeek(S, back(w.from, 7), back(w.from, 1))
  const rows = lines(w, p, S)
  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/health')} aria-label={t('Health')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 10 }}><h1>{t('Your week')}</h1><div className="sub">{fmtDate(w.from, true)} – {fmtDate(w.to, true)}</div></div>
      <button className="iconbtn" onClick={() => setAgo(a => a + 1)} aria-label={t('Previous week')}><Icon name="chevronLeft" /></button>
      <button className="iconbtn" disabled={ago === 0} onClick={() => setAgo(a => Math.max(0, a - 1))} aria-label={t('Next week')}><Icon name="chevronRight" /></button>
    </div>
    {rows.length ? <Section>{rows.map(r => <Row key={r.title} icon={r.icon} iconTint={r.tint} title={r.title} subtitle={r.sub} value={r.value} />)}</Section>
      : <div className="card muted small">{t('Nothing logged that week.')}</div>}
    <h4 className="sec" style={{ margin: '18px 2px 10px' }}>{t('Patterns')}</h4>
    <div className="card"><Patterns S={S} today={today} /></div>
  </div>
}

/**
 * Today's card: the week in a line — the one just over on its first day, this one so far on the
 * others — to open in full (Health → Your week).
 */
export function WeekCard({ S, nav }) {
  const today = todayISO()
  const start = weekOf(today, S.weekStart)
  const first = start === today
  const week = first ? lastWeeks(S, today).week : healthWeek(S, start, today)
  const rows = week ? lines(week, null, S) : []
  return <div className="card today-card tappable" onClick={() => nav('/health/week')}>
    <div className="row between today-head"><span className="today-title">{t('Your week')}</span><Icon name="chevronRight" className="chev" /></div>
    {rows.length ? <>
      <div className="small dim" style={{ marginBottom: 4 }}>{first ? t('The week just over') : t('This week so far')}</div>
      <div className="week-chips">{rows.map(r => <span key={r.title} className="week-chip"><Icon name={r.icon} style={{ color: r.tint }} />{r.value}</span>)}</div>
    </> : <div className="small dim">{t('Sleep, training, weight, doses, water and habits, against the week before')}</div>}
  </div>
}

/** Today's card of the patterns across the modules, the two strongest; none, no card. */
export function PatternsCard({ S }) {
  const today = todayISO()
  if (!insights(S, today).length) return null
  return <div className="card today-card">
    <div className="row between today-head"><span className="today-title">{t('Patterns')}</span></div>
    <Patterns S={S} today={today} limit={2} />
  </div>
}
