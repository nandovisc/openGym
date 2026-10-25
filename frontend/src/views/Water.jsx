import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { BOTTLE, addWater, dayTotal, drinksOn, glassOf, goalOf, migrateWaterHabit, removeWater, series, streakDays } from '../lib/water.js'
import { moduleOn } from '../lib/modules.js'
import { fmtDate, fmtNum, todayISO } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import Icon from '../components/Icon.jsx'
import LineChart from '../components/LineChart.jsx'
import { Button, NumberField, Row, Section } from '../components/ui.jsx'

const update = fn => useStore.getState().update(fn)
const ui = () => useUI.getState()

/** ml as the app writes it: "750 ml", or "2,3 l" from a litre up. */
export const mlText = ml => (ml >= 1000 ? `${fmtNum(Math.round(ml / 100) / 10)} l` : `${fmtNum(ml)} ml`)

/** A drink of `ml` now, with a toast that says where the day stands. */
export function drink(ml) {
  update(s => { s.water = addWater(s.water, ml) })
  const S = useStore.getState().S
  ui().toast(t('+{0} · {1} of {2} today', mlText(ml), mlText(dayTotal(S, todayISO())), mlText(goalOf(S))))
}

/**
 * The habit "Água" a person kept by hand, moved onto this module once (lib/water.js
 * migrateWaterHabit): wherever the module shows (Today, Habits, this screen).
 */
export function useWaterMigration() {
  const on = useStore(s => moduleOn(s.S, 'water'))
  const habits = useStore(s => s.S.habits)
  useEffect(() => {
    if (!on) return
    const out = migrateWaterHabit(useStore.getState().S)
    if (!out) return
    update(s => {
      s.water = out.water
      s.habits = out.habits
      if (out.goalMl && !(Number(s.waterPrefs?.goalMl) > 0)) s.waterPrefs = { ...(s.waterPrefs || {}), goalMl: out.goalMl }
    })
    ui().toast(t('Your water habit now counts what you log in Water'))
  }, [on, habits])
}

function Ring({ value, goal }) {
  const p = goal > 0 ? Math.min(1, value / goal) : 0
  return <div className="water-ring" style={{ '--p': p }}>
    <div><b>{mlText(value)}</b><span className="small dim">{t('of {0}', mlText(goal))}</span></div>
  </div>
}

function OtherAmount({ close }) {
  const [ml, setMl] = useState(300)
  return <>
    <h3>{t('Another amount')}</h3>
    <NumberField className="field" decimal={false} value={ml} onChange={setMl} aria-label={t('Amount in ml')} />
    <div className="small dim" style={{ margin: '6px 2px 12px' }}>ml</div>
    <Button variant="primary" onClick={() => { if (ml > 0) { drink(ml); close() } }}>{t('Add')}</Button>
  </>
}

function GoalSheet({ close }) {
  const S = useStore(s => s.S)
  const [goal, setGoal] = useState(Number(S.waterPrefs?.goalMl) || null)
  const [glass, setGlass] = useState(glassOf(S))
  const auto = goalOf({ ...S, waterPrefs: { ...(S.waterPrefs || {}), goalMl: null } })
  const save = () => { update(s => { s.waterPrefs = { ...(s.waterPrefs || {}), goalMl: goal > 0 ? Math.round(goal) : null, glassMl: glass > 0 ? Math.round(glass) : 250 } }); close() }
  return <>
    <h3>{t('Water goal')}</h3>
    <div className="muted small" style={{ marginBottom: 10 }}>{t('Left empty, the goal is 35 ml per kg of your last weigh-in: {0} now.', mlText(auto))}</div>
    <div className="small dim" style={{ margin: '0 2px 4px' }}>{t('Daily goal (ml)')}</div>
    <NumberField className="field" decimal={false} nullable value={goal} onChange={setGoal} placeholder={String(auto)} aria-label={t('Daily goal (ml)')} />
    <div className="small dim" style={{ margin: '12px 2px 4px' }}>{t('Your glass (ml)')}</div>
    <NumberField className="field" decimal={false} value={glass} onChange={setGlass} aria-label={t('Your glass (ml)')} />
    <div style={{ height: 14 }} />
    <Button variant="primary" onClick={save}>{t('Save')}</Button>
  </>
}

export default function Water() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  useWaterMigration()
  const today = todayISO()
  const goal = goalOf(S), total = dayTotal(S, today), glass = glassOf(S)
  const drinks = drinksOn(S, today).slice().reverse()
  const days = series(S, today, 30)
  const logged = days.filter(x => x.ml > 0)
  const avg = logged.length ? Math.round(logged.reduce((n, x) => n + x.ml, 0) / logged.length) : 0
  const onGoal = days.filter(x => x.ml >= goal).length
  const streak = streakDays(S, today)
  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/health')} aria-label={t('Health')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 10 }}><h1>{t('Water')}</h1><div className="sub">{fmtDate(today, true)}</div></div>
      <button className="iconbtn" onClick={() => ui().openSheet(close => <GoalSheet close={close} />)} aria-label={t('Water goal')}><Icon name="target" /></button>
    </div>
    <div className="card water-today">
      <Ring value={total} goal={goal} />
      <div className="small dim" style={{ textAlign: 'center', margin: '8px 0 12px' }}>
        {total >= goal ? t('Goal reached') : t('{0} to go', mlText(goal - total))}{streak > 1 ? ` · 🔥 ${t('{0} days in a row', streak)}` : ''}
      </div>
      <div className="water-add">
        <Button variant="primary" icon="drop" onClick={() => drink(glass)}>{t('Glass')} · {mlText(glass)}</Button>
        <Button icon="drop" onClick={() => drink(BOTTLE)}>{t('Bottle')} · {mlText(BOTTLE)}</Button>
        <Button variant="ghost" onClick={() => ui().openSheet(close => <OtherAmount close={close} />)}>{t('Other')}</Button>
      </div>
    </div>
    {drinks.length > 0 && <Section title={t('Today')}>{drinks.map(e => <Row key={e.id} icon="drop" iconTint="var(--blue)" title={mlText(e.ml)}
      subtitle={new Date(e.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}>
      <button className="iconbtn" aria-label={t('Remove')} onClick={() => update(s => { s.water = removeWater(s.water, e.id) })}><Icon name="trash" /></button>
    </Row>)}</Section>}
    <div className="card">
      <div className="row between" style={{ marginBottom: 8 }}>
        <div><div className="muted small">{t('Average, 30 days')}</div><div className="big" style={{ marginTop: 3 }}>{avg ? mlText(avg) : '–'}</div></div>
        <div className="small dim" style={{ textAlign: 'end' }}>{t('{0} of 30 days on goal', onGoal)}</div>
      </div>
      {logged.length > 1 && <div className="chart"><LineChart points={days.filter(x => x.ml > 0).map(x => ({ t: Date.parse(x.d + 'T12:00:00'), y: Math.round(x.ml / 100) / 10, d: x.d }))} h={140} unit="l" color="var(--blue)" goal={Math.round(goal / 100) / 10} /></div>}
    </div>
  </div>
}
