import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { healthReport } from '../lib/health-report.js'
import { DAYS, fmtDate, fmtDur, fmtNum, todayISO } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import Icon from '../components/Icon.jsx'
import LineChart from '../components/LineChart.jsx'
import { Button, Segmented, Switch } from '../components/ui.jsx'
import { mlText } from './Water.jsx'

const SECTIONS = ['meds', 'exams', 'weight', 'sleep', 'food', 'water', 'training']
const LABEL = { meds: 'Medications', exams: 'Medical exams', weight: 'Body weight', sleep: 'Sleep', food: 'Nutrition', water: 'Water', training: 'Training' }
const signed = (n, unit) => `${n > 0 ? '+' : n < 0 ? '−' : '±'}${fmtNum(Math.abs(n))} ${unit}`

function Meds({ s }) {
  return <>
    <table className="report-table"><thead><tr><th>{t('Medication')}</th><th>{t('Dose')}</th><th>{t('Times')}</th><th>{t('Doses taken')}</th></tr></thead>
      <tbody>{s.rows.map(r => <tr key={r.name}>
        <td><b>{r.name}</b>{r.notes ? <div className="small">{r.notes}</div> : null}</td>
        <td>{r.dose || '–'}</td>
        <td>{r.times.join(', ')}{r.days ? ` (${r.days.map(d => t(DAYS[d])).join(', ')})` : ''}</td>
        <td>{r.pct == null ? '–' : `${r.pct}% (${r.taken}/${r.counted})`}</td>
      </tr>)}</tbody></table>
    {s.pct != null && <p className="small">{t('Taken overall: {0}% of the scheduled doses in the period.', s.pct)}</p>}
  </>
}

function Exams({ s }) {
  return <>
    <p className="small">{t('{0} exams in the period ({1}).', s.count, s.dates.map(d => fmtDate(d, true)).join(', '))} {s.outCount ? t('{0} markers out of range.', s.outCount) : t('Every marker within range.')}</p>
    <table className="report-table"><thead><tr><th>{t('Marker')}</th><th>{t('Latest')}</th><th>{t('Reference')}</th><th>{t('Date')}</th></tr></thead>
      <tbody>{s.rows.map(r => <tr key={r.key} className={r.out ? 'out' : ''}>
        <td>{r.out ? '⚠︎ ' : ''}{r.name}</td><td><b>{r.value}</b> {r.unit}</td>
        <td>{r.refLow != null && r.refHigh != null ? `${fmtNum(r.refLow)}–${fmtNum(r.refHigh)}` : r.refHigh != null ? `< ${fmtNum(r.refHigh)}` : r.refLow != null ? `> ${fmtNum(r.refLow)}` : '–'}</td><td>{fmtDate(r.d, true)}</td>
      </tr>)}</tbody></table>
    {s.trends.map(x => <div key={x.key} className="report-chart"><div className="small"><b>{x.name}</b> · {x.points.map(p => `${fmtNum(p.y)} (${fmtDate(p.d, true)})`).join(' → ')}</div>
      <LineChart points={x.points} h={110} unit={x.unit} axes /></div>)}
  </>
}

function Weight({ s }) {
  return <>
    <p>{t('From {0} to {1}: {2}. Lowest {3}, highest {4}, in {5} weigh-ins.', `${fmtNum(s.first)} ${s.unit}`, `${fmtNum(s.last)} ${s.unit}`, signed(s.change, s.unit), fmtNum(s.min), fmtNum(s.max), s.count)}</p>
    {s.points.length > 1 && <div className="report-chart"><LineChart points={s.points} h={130} unit={s.unit} /></div>}
  </>
}

export default function HealthReport() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const user = useStore(s => s.user)
  const [months, setMonths] = useState(3)
  const [on, setOn] = useState(() => Object.fromEntries(SECTIONS.map(k => [k, true])))
  const [notes, setNotes] = useState('')
  const r = healthReport(S, { months, today: todayISO(), user })
  const has = k => on[k] && r[k]
  const body = {
    meds: () => <Meds s={r.meds} />,
    exams: () => <Exams s={r.exams} />,
    weight: () => <Weight s={r.weight} />,
    sleep: () => <p>{t('{0} nights logged: {1} a night on average, in bed around {2}, up around {3}. {4} of them reached the goal of {5}.', r.sleep.nights, fmtDur(r.sleep.avgMin * 60000), r.sleep.avgBed, r.sleep.avgWake, r.sleep.goalHit, fmtDur(r.sleep.goalMin * 60000))}</p>,
    food: () => <p>{t('{0} days logged: {1} kcal a day on average — protein {2} g, carbohydrate {3} g, fat {4} g.', r.food.days, fmtNum(r.food.kcal), r.food.p, r.food.c, r.food.f)}{r.food.targets?.kcal ? ' ' + t('Target: {0} kcal, protein {1} g.', fmtNum(r.food.targets.kcal), r.food.targets.p) : ''}</p>,
    water: () => <p>{t('{0} days logged: {1} a day on average; {2} of them reached the goal of {3}.', r.water.days, mlText(r.water.avgMl), r.water.onGoal, mlText(r.water.goalMl))}</p>,
    training: () => <p>{t('{0} workouts, {1} a week on average.', r.training.workouts, fmtNum(r.training.perWeek))}{r.training.kcal ? ' ' + t('{0} kcal measured by the watch.', fmtNum(r.training.kcal)) : ''}</p>
  }
  return <div className="narrow report">
    <div className="hdr no-print">
      <button className="iconbtn" onClick={() => nav('/health')} aria-label={t('Health')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 10 }}><h1>{t('Report for an appointment')}</h1><div className="sub">{t('To print or save as PDF and take to your doctor or dietitian')}</div></div>
    </div>
    <div className="card no-print">
      <Segmented value={months} onChange={setMonths} options={[1, 3, 6, 12].map(m => ({ value: m, label: t(m === 1 ? '1 month' : '{0} months', m) }))} />
      <div className="report-picks">{SECTIONS.filter(k => r[k]).map(k => <label key={k} className="row" style={{ gap: 8 }}>
        <Switch checked={on[k]} onChange={v => setOn(o => ({ ...o, [k]: v }))} aria-label={t(LABEL[k])} /><span>{t(LABEL[k])}</span>
      </label>)}</div>
      <Button variant="primary" icon="download" onClick={() => window.print()}>{t('Print or save as PDF')}</Button>
    </div>

    <div className="report-page">
      <header className="report-head">
        <h2>{t('Health report')}</h2>
        <div>{[r.person.name, r.person.age ? t('{0} years', r.person.age) : null, r.person.heightCm ? `${r.person.heightCm} cm` : null].filter(Boolean).join(' · ')}</div>
        <div className="small">{t('Period: {0} – {1}', fmtDate(r.from, true), fmtDate(r.to, true))} · {t('Made with openGym')}</div>
      </header>
      {SECTIONS.filter(has).map(k => <section key={k} className="report-sec"><h3>{t(LABEL[k])}</h3>{body[k]()}</section>)}
      {!SECTIONS.some(has) && <p className="muted">{t('Nothing logged in this period.')}</p>}
      <section className="report-sec">
        <h3>{t('Notes')}</h3>
        <textarea className="input no-print" rows={3} value={notes} onChange={e => setNotes(e.target.value)} placeholder={t('Questions for the appointment, symptoms, what changed…')} />
        <div className="report-notes print-only">{notes || ' '}</div>
      </section>
    </div>
  </div>
}
