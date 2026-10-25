import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { effectiveRoutines, effectiveRoutineIds, nextTrainingDay, streakWeeks, lastBW } from '../lib/history.js'
import { weekTally } from '../lib/queue.js'
import { moduleOn } from '../lib/modules.js'
import { activeHabits, dailyProgress, statusOn, todayOf } from '../lib/habits.js'
import { dayOf } from '../lib/nutrition.js'
import { dosesOn, doseState, hhmmOf, markDose } from '../lib/meds.js'
import { goalOf, lastNight, stageShares } from '../lib/sleep.js'
import { examsByDate, outOfRange } from '../lib/exams.js'
import { kcalOn } from '../lib/workout-health.js'
import { DAYN, fmtDate, fmtDur, fmtNum, todayISO } from '../lib/format.js'
import { bwChartPoint } from '../lib/bodyweight.js'
import { t, dateLocale } from '../lib/i18n.js'
import { bwSheet, startFlow } from '../sheets.jsx'
import { addFoodSheet } from './Food.jsx'
import { HabitRow, useMedHabits, useNow } from './Habits.jsx'
import { drink, mlText, useWaterMigration } from './Water.jsx'
import { WeekCard } from './WeekReport.jsx'
import { dayTotal, glassOf, goalOf as waterGoal } from '../lib/water.js'
import Icon from '../components/Icon.jsx'
import LineChart from '../components/LineChart.jsx'
import { useConnectionTrouble } from '../components/SyncBanner.jsx'
import { Button, Switch } from '../components/ui.jsx'

const update = fn => useStore.getState().update(fn)
const ui = () => useUI.getState()
const list = v => (Array.isArray(v) ? v : [])

// Today (Home with the modules beside training on): the day across them, each card with the one
// thing to do about it — start the workout, add food, mark a habit, take a dose, weigh in.
export const CARDS = ['training', 'food', 'water', 'habits', 'meds', 'sleep', 'weight', 'exams']
const CARD_LABEL = { training: 'Today’s workout', food: 'Nutrition', water: 'Water', habits: 'Habits to do', meds: 'Medications', sleep: 'Sleep', weight: 'Body weight', exams: 'Medical exams' }
const CARD_MODULE = { food: 'food', water: 'water', habits: 'habits', meds: 'meds', sleep: 'sleep', exams: 'exams' }

/** The meal of the hour, for adding food from Today or the ＋ button. */
export function slotByHour(date = new Date()) {
  const m = date.getHours() * 60 + date.getMinutes()
  return m < 630 ? 'breakfast' : m < 900 ? 'lunch' : m < 1110 ? 'snack' : 'dinner'
}

/**
 * The cards in the order to show them: the person's own order when they set one, otherwise by
 * the hour — in the morning the night, the scale and the doses first; in the evening what is
 * still open. Hidden ones and those of modules switched off are left out.
 */
export function cardOrder(S, hour = new Date().getHours()) {
  const own = list(S.homeCards?.order).filter(k => CARDS.includes(k))
  const auto = hour < 11 ? ['sleep', 'weight', 'meds', 'water', 'training', 'food', 'habits', 'exams']
    : hour >= 18 ? ['habits', 'food', 'water', 'meds', 'training', 'sleep', 'weight', 'exams'] : CARDS
  const order = own.length ? [...own, ...CARDS.filter(k => !own.includes(k))] : auto
  const hidden = new Set(list(S.homeCards?.hidden))
  return order.filter(k => !hidden.has(k) && (!CARD_MODULE[k] || moduleOn(S, CARD_MODULE[k])))
}

function Card({ title, action, children, onClick, tone }) {
  return <div className={'card today-card' + (onClick ? ' tappable' : '') + (tone ? ' ' + tone : '')} onClick={onClick}>
    <div className="row between today-head"><span className="today-title">{title}</span>{action}</div>
    {children}
  </div>
}

function TrainingCard({ S, nav }) {
  const today = todayISO()
  const routines = effectiveRoutines(S, today)
  const done = S.workouts.filter(w => w.d === today)
  if (S.active) return <Card title={t('Today’s workout')}>
    <div className="today-big">{t('Workout in progress')}</div>
    <Button variant="primary" icon="play" onClick={() => nav('/workout')}>{t('Resume')}</Button>
  </Card>
  if (done.length) return <Card title={t('Today’s workout')} onClick={() => nav('/training')}>
    <div className="today-big"><Icon name="checkCircle" style={{ color: 'var(--acc)' }} /> {done.map(w => w.name).filter(Boolean).join(' + ') || t('Workout')}</div>
    <div className="small dim">{kcalOn(done, today) > 0 ? t('Trained today · {0} kcal burned', fmtNum(kcalOn(done, today))) : t('Trained today')}</div>
  </Card>
  if (routines.length) return <Card title={t('Today’s workout')}>
    <div className="today-big">{routines.map(r => r.name).join(' + ')}</div>
    <div className="small dim">{t('{0} exercises', routines.reduce((n, r) => n + list(r.ex).length, 0))}</div>
    <div style={{ height: 8 }} />
    <Button variant="primary" icon="play" onClick={() => startFlow(effectiveRoutineIds(S, today))}>{t('Start workout')}</Button>
  </Card>
  const next = nextTrainingDay(S, today)
  return <Card title={t('Today’s workout')} onClick={() => nav('/training')}>
    <div className="today-big">{t('Rest Day')}</div>
    <div className="small dim">{next ? t('Next: {0}, {1}', t(DAYN[next.weekday]), next.routines.map(r => r.name).join(' + ')) : t('Nothing planned')}</div>
  </Card>
}

function Bar({ label, value, target, color }) {
  const pct = target > 0 ? Math.min(100, (value / target) * 100) : 0
  return <div className="today-macro"><span className="small dim">{label}</span><span className="small">{fmtNum(Math.round(value))}{target ? `/${fmtNum(target)}` : ''} g</span>
    <div className="today-track"><div style={{ width: pct + '%', background: color }} /></div></div>
}
function FoodCard({ S, nav }) {
  const day = dayOf(S.meals, todayISO()).total
  const tg = S.nutrition?.targets || {}
  const left = tg.kcal ? tg.kcal - day.kcal : null
  return <Card title={t('Nutrition')} onClick={() => nav('/health/food')}
    action={<button className="iconbtn today-plus" aria-label={t('Add food')} onClick={e => { e.stopPropagation(); addFoodSheet(todayISO(), slotByHour()) }}><Icon name="plus" /></button>}>
    <div className="today-big">{left != null ? (left >= 0 ? t('{0} kcal left', fmtNum(left)) : t('{0} kcal over', fmtNum(-left))) : t('{0} kcal today', fmtNum(day.kcal))}</div>
    {tg.kcal ? <div className="small dim">{t('{0} of {1} kcal', fmtNum(day.kcal), fmtNum(tg.kcal))}</div> : null}
    <div className="today-macros">
      <Bar label={t('Protein')} value={day.p} target={tg.p} color="var(--blue)" />
      <Bar label={t('Carbs')} value={day.c} target={tg.c} color="var(--orange)" />
      <Bar label={t('Fat')} value={day.f} target={tg.f} color="var(--purple)" />
    </div>
  </Card>
}

function HabitsCard({ S, nav }) {
  const today = todayOf(S)
  const running = list(S.habitLog).some(e => e?.timer && e.d === today)
  const now = useNow(running)
  const open = activeHabits(S).filter(h => h.kind !== 'auto' && h.kind !== 'task' && ['pending', 'partial'].includes(statusOn(h, today, S, today, now).state))
    .sort((a, b) => (a.order || 0) - (b.order || 0))
  if (!open.length) return null
  return <Card title={t('Habits to do')} action={<button className="linkbtn" onClick={() => nav('/habits')}>{t('See all')}</button>}>
    <div className="hab-list">{open.slice(0, 4).map(h => <HabitRow key={h.id} h={h} d={today} S={S} today={today} now={now} />)}</div>
  </Card>
}

function MedsCard({ S, nav }) {
  const now = { d: todayISO(), hhmm: hhmmOf() }
  const doses = dosesOn(S.meds, S.medLog, now.d)
  if (!doses.length) return null
  const taken = doses.filter(x => x.entry?.status === 'taken').length
  const next = doses.find(x => !x.entry)
  return <Card title={t('Medications')} onClick={() => nav('/health/meds')}>
    {next ? <>
      <div className="today-big">{next.med.name}</div>
      <div className={'small ' + (doseState(next, now) === 'late' ? 'today-warn' : 'dim')}>{t('Next dose at {0}', next.time)} · {t('{0} of {1} today', taken, doses.length)}</div>
      <div style={{ height: 8 }} />
      <Button icon="check" onClick={e => { e.stopPropagation(); update(s => { s.medLog = markDose(s.medLog, next, 'taken') }); ui().toast(t('{0} taken', next.med.name)) }}>{t('Taken')}</Button>
    </> : <div className="today-big"><Icon name="checkCircle" style={{ color: 'var(--acc)' }} /> {t('All doses taken today')}</div>}
  </Card>
}

function SleepCard({ S, nav }) {
  const n = lastNight(S.sleep)
  if (!n || n.d < new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10)) return null
  const goal = goalOf(S), diff = n.asleepMin - goal
  return <Card title={t('Sleep')} onClick={() => nav('/health/sleep')}>
    <div className="today-big">{fmtDur(n.asleepMin * 60000)}</div>
    <div className={'small ' + (diff < 0 ? 'today-warn' : 'dim')}>{diff < 0 ? t('{0} short of your goal', fmtDur(-diff * 60000)) : t('Goal reached')} · {n.bed.slice(11, 16)} → {n.wake.slice(11, 16)}</div>
    {n.stages && <div className="sleep-stages">{stageShares(n.stages).map(p => <div key={p.k} className={'sleep-' + p.k} style={{ width: p.pct + '%' }} />)}</div>}
  </Card>
}

function WaterCard({ S, nav }) {
  const total = dayTotal(S, todayISO()), goal = waterGoal(S), glass = glassOf(S)
  return <Card title={t('Water')} onClick={() => nav('/health/water')}
    action={<Button size="xs" icon="drop" onClick={e => { e.stopPropagation(); drink(glass) }}>+{mlText(glass)}</Button>}>
    <div className="today-big">{mlText(total)} <span className="small dim">/ {mlText(goal)}</span></div>
    <div className="today-track"><div style={{ width: Math.min(100, goal ? (total / goal) * 100 : 0) + '%', background: 'var(--blue)' }} /></div>
  </Card>
}

function WeightCard({ S }) {
  const bw = lastBW(S)
  const week = S.bodyweight.filter(b => b.d >= new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10))
  const delta = week.length > 1 ? Math.round((week.at(-1).w - week[0].w) * 10) / 10 : null
  return <Card title={t('Body weight')} action={<Button size="xs" icon="plus" onClick={() => bwSheet()}>{t('Weigh in')}</Button>}>
    {bw ? <>
      <div className="today-big">{fmtNum(bw.w)} {S.unit} {delta ? <span className="small" style={{ color: delta < 0 ? 'var(--acc)' : 'var(--orange)' }}>{delta > 0 ? '+' : '−'}{fmtNum(Math.abs(delta))} {t('in 7 days')}</span> : null}</div>
      <div className="small dim">{fmtDate(bw.d, true)}</div>
      {S.bodyweight.length > 1 && <div className="chart" style={{ marginTop: 6 }}><LineChart points={S.bodyweight.slice(-14).map(bwChartPoint)} h={70} axes={false} unit={S.unit} /></div>}
    </> : <div className="small dim">{t('No weigh-ins yet. Log your weight to start the curve.')}</div>}
  </Card>
}

function ExamsCard({ S, nav }) {
  const last = [...examsByDate(S.exams)].sort((a, b) => (a.d < b.d ? 1 : -1))[0]
  const n = last ? outOfRange(last) : 0
  if (!n) return null
  return <Card title={t('Medical exams')} tone="today-alert" onClick={() => nav('/health/exams')}>
    <div className="row" style={{ gap: 8 }}><Icon name="warning" /><span>{t('Exam of {0}: {1} out of range', fmtDate(last.d, true), n)}</span></div>
  </Card>
}

function Customize({ close }) {
  const S = useStore(s => s.S)
  const order = list(S.homeCards?.order).length ? [...S.homeCards.order.filter(k => CARDS.includes(k)), ...CARDS.filter(k => !S.homeCards.order.includes(k))] : CARDS
  const hidden = new Set(list(S.homeCards?.hidden))
  const save = patch => update(s => { s.homeCards = { ...(s.homeCards || {}), ...patch } })
  const move = (k, dir) => { const o = [...order], i = o.indexOf(k), j = i + dir; if (j < 0 || j >= o.length) return; [o[i], o[j]] = [o[j], o[i]]; save({ order: o }) }
  return <>
    <h3>{t('Customize Today')}</h3>
    <div className="small dim" style={{ marginBottom: 10 }}>{t('Choose the cards and their order. With no order of your own, they follow the time of day.')}</div>
    <div className="section">{order.map(k => <div key={k} className="lrow">
      <span className="lrow-m"><span className="lrow-t">{t(CARD_LABEL[k])}</span></span>
      <button className="iconbtn" aria-label={t('Move up')} onClick={() => move(k, -1)}><Icon name="chevronUp" /></button>
      <button className="iconbtn" aria-label={t('Move down')} onClick={() => move(k, 1)}><Icon name="chevronDown" /></button>
      <Switch checked={!hidden.has(k)} onChange={v => save({ hidden: v ? [...hidden].filter(x => x !== k) : [...hidden, k] })} aria-label={t(CARD_LABEL[k])} />
    </div>)}</div>
    <div style={{ height: 10 }} />
    <Button variant="ghost" onClick={() => save({ order: [] })}>{t('Order by the time of day')}</Button>
    <div style={{ height: 6 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Close')}</Button>
  </>
}

export default function Today() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  useMedHabits()
  useWaterMigration()
  const user = useStore(s => s.user)
  const trouble = useConnectionTrouble()
  const hToday = todayOf(S)
  const p = moduleOn(S, 'habits') ? dailyProgress(S, hToday, hToday) : null
  const { done, planned } = weekTally(S, todayISO())
  const sw = streakWeeks(S)
  const render = {
    training: () => <TrainingCard key="training" S={S} nav={nav} />,
    food: () => <FoodCard key="food" S={S} nav={nav} />,
    water: () => <WaterCard key="water" S={S} nav={nav} />,
    habits: () => <HabitsCard key="habits" S={S} nav={nav} />,
    meds: () => <MedsCard key="meds" S={S} nav={nav} />,
    sleep: () => <SleepCard key="sleep" S={S} nav={nav} />,
    weight: () => (S.showWeightCard !== false ? <WeightCard key="weight" S={S} /> : null),
    exams: () => <ExamsCard key="exams" S={S} nav={nav} />
  }
  return <div className="narrow">
    <div className="hdr">
      <div><div className="sub">{new Date().toLocaleDateString(dateLocale(), { weekday: 'long', day: 'numeric', month: 'long' })}</div><h1>{user ? t('Hi {0}', user.name) : t('Today')}</h1></div>
      <button className="iconbtn" onClick={() => nav('/settings')} aria-label={trouble ? t('Settings') + ', ' + t('Connection problem') : t('Settings')}><Icon name="gear" />{trouble && <span className="tab-dot" aria-hidden="true" />}</button>
    </div>
    <div className="card today-top">
      {p && p.total > 0 && <button className="today-ring" style={{ '--p': p.done / p.total }} onClick={() => nav('/habits')} aria-label={t('{0} of {1} done today', p.done, p.total)}><b>{p.done}/{p.total}</b></button>}
      <div className="today-chips">
        {p && p.total > 0 && <div className="today-top-title">{t('Habits today')}</div>}
        <span className="today-chip">{t('Workouts {0}', `${done}${planned ? '/' + planned : ''}`)} · {t('this week')}</span>
        {sw > 0 && <span className="today-chip">{t('{0} week streak', sw)}</span>}
      </div>
    </div>
    <WeekCard S={S} nav={nav} />
    {cardOrder(S).map(k => render[k]())}
    <button className="linkbtn today-custom" onClick={() => ui().openSheet(close => <Customize close={close} />)}>{t('Customize Today')}</button>
  </div>
}
