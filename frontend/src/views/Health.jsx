import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { doseState, dosesOn, hhmmOf } from '../lib/meds.js'
import { examsByDate, outOfRange } from '../lib/exams.js'
import { foodToday } from './Food.jsx'
import { sleepLast } from './Sleep.jsx'
import { mlText } from './Water.jsx'
import { Patterns } from './WeekReport.jsx'
import { dayTotal, goalOf as waterGoal } from '../lib/water.js'
import { lastBW } from '../lib/history.js'
import { fmtDate, fmtDur, fmtNum, todayISO } from '../lib/format.js'
import { bwChartPoint } from '../lib/bodyweight.js'
import { t } from '../lib/i18n.js'
import Icon from '../components/Icon.jsx'
import LineChart from '../components/LineChart.jsx'
import { moduleOn } from '../lib/modules.js'
import { dailySeries } from '../lib/nutrition.js'
import { weighInsSheet } from '../sheets.jsx'

/** "2 of 3 doses taken today", or what is next, for the Health hub and the Home card. */
export function medsToday(S, now = { d: todayISO(), hhmm: hhmmOf() }) {
  const doses = dosesOn(S.meds, S.medLog, now.d)
  const taken = doses.filter(x => x.entry?.status === 'taken').length
  const open = doses.filter(x => !x.entry)
  const late = open.filter(x => doseState(x, now) === 'late').length
  return { total: doses.length, taken, late, next: open[0] || null }
}

// Health: every record of the body that is not a workout, one place to reach them from. Body
// weight and measurements are the screens that were there already; medications and exams are
// new, and so is nutrition.
export default function Health() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const meds = medsToday(S)
  const bw = lastBW(S)
  const lastMeasure = (S.measurements || []).at(-1)
  const lastExam = examsByDate(S.exams)[0]
  const food = foodToday(S)
  const sleep = sleepLast(S)
  const medsSub = !(S.meds || []).length ? t('Add what you take and get reminded')
    : !meds.total ? t('Nothing scheduled today')
      : [t('{0} of {1} doses taken today', meds.taken, meds.total), meds.late ? t('{0} late', meds.late) : null].filter(Boolean).join(' · ')

  const on = k => moduleOn(S, k)
  const tile = (icon, tint, title, sub, to, warn) => <button key={title} className="health-tile" onClick={to}>
    <span className="lrow-i" style={{ '--tint': tint }}><Icon name={icon} /></span>
    <b>{title}</b><span className={'small ' + (warn ? 'warn' : 'dim')}>{sub}</span>
  </button>
  // Thirty days of weight against what was eaten: how much it moved, and the calories behind it.
  const today = todayISO()
  const from = new Date(Date.parse(today + 'T12:00:00Z') - 29 * 86400000).toISOString().slice(0, 10)
  const weights = (S.bodyweight || []).filter(b => b?.d >= from && b.d <= today)
  const eaten = on('food') ? dailySeries(S.meals, from, today) : null
  const moved = weights.length > 1 ? Math.round((weights.at(-1).w - weights[0].w) * 10) / 10 : null
  const target = S.nutrition?.targets?.kcal
  const progress = [
    moved != null ? (moved === 0 ? t('Weight steady in 30 days') : t(moved < 0 ? 'Weight down {0} in 30 days' : 'Weight up {0} in 30 days', `${fmtNum(Math.abs(moved))} ${S.unit}`)) : null,
    eaten?.avg ? (target ? t('{0} kcal a day on average, {1} the target', fmtNum(eaten.avg.kcal), eaten.avg.kcal <= target ? t('{0} under', fmtNum(target - eaten.avg.kcal)) : t('{0} over', fmtNum(eaten.avg.kcal - target))) : t('{0} kcal a day on average', fmtNum(eaten.avg.kcal))) : null
  ].filter(Boolean)
  return <div className="narrow">
    <div className="hdr">
      <div><h1>{t('Health')}</h1><div className="sub">{t('Food, sleep, medications, exams and body')}</div></div>
    </div>
    <div className="health-grid">
      {on('food') && tile('flame', 'var(--orange)', t('Nutrition'), food.logged ? (food.target ? t('{0} of {1} kcal today', fmtNum(food.kcal), fmtNum(food.target)) : t('{0} kcal today', fmtNum(food.kcal))) : t('Meals, calories and macros'), () => nav('/health/food'))}
      {on('sleep') && tile('moon', 'var(--indigo)', t('Sleep'), sleep ? `${fmtDur(sleep.min * 60000)} · ${sleep.bed} → ${sleep.wake}` : t('No nights yet'), () => nav('/health/sleep'))}
      {on('water') && tile('drop', 'var(--blue)', t('Water'), t('{0} of {1} today', mlText(dayTotal(S, today)), mlText(waterGoal(S))), () => nav('/health/water'))}
      {on('meds') && tile('pill', 'var(--teal)', t('Medications'), medsSub, () => nav('/health/meds'), meds.late > 0)}
      {on('exams') && tile('doc', 'var(--red)', t('Medical exams'), lastExam ? (outOfRange(lastExam) ? t('{0} out of range', outOfRange(lastExam)) : fmtDate(lastExam.d, true)) : t('No exams yet'), () => nav('/health/exams'), !!(lastExam && outOfRange(lastExam)))}
      {tile('scale', 'var(--blue)', t('Body weight'), bw ? `${fmtNum(bw.w)} ${S.unit} · ${fmtDate(bw.d, true)}` : t('No weigh-ins yet'), weighInsSheet)}
      {tile('ruler', 'var(--purple)', t('Body measurements'), lastMeasure ? fmtDate(lastMeasure.d, true) : t('No measurements yet'), () => nav('/measurements'))}
    </div>
    {(weights.length > 1 || progress.length > 0) && <div className="card" style={{ marginTop: 12 }}>
      <div className="muted small">{t('Progress · 30 days')}</div>
      {weights.length > 1 && <div className="chart" style={{ marginTop: 8 }}><LineChart points={weights.map(bwChartPoint)} h={120} unit={S.unit} goal={S.targetW} /></div>}
      {progress.map((x, i) => <div key={i} className="small" style={{ marginTop: 6 }}>{x}</div>)}
    </div>}
    {/* The week across the modules, and what goes together (views/WeekReport.jsx). */}
    <button className="card tappable health-week" onClick={() => nav('/health/week')} style={{ marginTop: 12 }}>
      <span className="lrow-i" style={{ '--tint': 'var(--purple)' }}><Icon name="calendar" /></span>
      <span><b>{t('Your week')}</b><span className="small dim">{t('Sleep, training, weight, doses, water and habits, against the week before')}</span></span>
      <Icon name="chevronRight" className="chev" />
    </button>
    <button className="card tappable health-week" onClick={() => nav('/health/report')} style={{ marginTop: 12 }}>
      <span className="lrow-i" style={{ '--tint': 'var(--red)' }}><Icon name="doc" /></span>
      <span><b>{t('Report for an appointment')}</b><span className="small dim">{t('Medications, exams, weight, sleep and food in one page to print')}</span></span>
      <Icon name="chevronRight" className="chev" />
    </button>
    <div className="card" style={{ marginTop: 12 }}>
      <div className="muted small" style={{ marginBottom: 8 }}>{t('Patterns')}</div>
      <Patterns S={S} today={today} limit={3} />
    </div>
  </div>
}
