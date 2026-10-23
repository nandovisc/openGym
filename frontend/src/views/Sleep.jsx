import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { byDay, dailySeries, goalOf, lastNight, normalizeNight, stageShares, summary } from '../lib/sleep.js'
import { api, apiUrl } from '../lib/api.js'
import { copyText } from '../lib/clipboard.js'
import { fmtDate, fmtDur, todayISO } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import Icon from '../components/Icon.jsx'
import LineChart from '../components/LineChart.jsx'
import { Button, Row, Section, Segmented, SelectRow, TextField } from '../components/ui.jsx'
import { confirmSheet } from '../sheets.jsx'

const update = fn => useStore.getState().update(fn)
const ui = () => useUI.getState()
const toast = message => ui().toast(message)

const dur = min => fmtDur((min || 0) * 60000)
const clock = local => (local ? local.slice(11, 16) : '')
const addDays = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10)
const STAGE_LABEL = { deep: 'Deep', core: 'Core sleep', rem: 'REM', awake: 'Awake' }
const sourceText = n => (n.src === 'manual' ? t('Logged by hand') : n.source || t('Apple Health'))
// 5 h to 10 h, half an hour apart.
const GOALS = Array.from({ length: 11 }, (_, i) => 300 + i * 30)

/* ---------- a night: log, edit ---------- */

function NightForm({ id, close }) {
  const prev = useStore(s => (id ? (s.S.sleep || []).find(x => x.id === id) : null))
  const [f, setF] = useState(() => ({
    d: prev?.d || todayISO(), bed: prev ? clock(prev.bed) : '23:00', wake: prev ? clock(prev.wake) : '07:00',
    quality: prev?.quality || null, note: prev?.note || ''
  }))
  const set = (k, v) => setF(x => ({ ...x, [k]: v }))
  const save = () => {
    const n = normalizeNight(f, { prev })
    if (n.error) { toast(n.error === 'length' ? t('Check the times: a night is up to 20 hours.') : t('Fill in the date and both times.')); return }
    const other = (useStore.getState().S.sleep || []).find(x => x.d === n.d && x.id !== n.id)
    const write = () => {
      update(s => {
        const rest = (s.sleep || []).filter(x => x.id !== n.id && !(other && x.id === other.id))
        s.sleep = [...rest, n]
      })
      close()
      toast(prev ? t('Night saved') : t('Night logged'))
    }
    if (other) confirmSheet({ title: t('Replace the night of {0}?', fmtDate(n.d, true)), message: t('That day already has a night ({0}).', dur(other.asleepMin)), confirmText: t('Replace'), onConfirm: write })
    else write()
  }
  const remove = () => confirmSheet({ title: t('Delete this night?'), confirmText: t('Delete'), danger: true,
    onConfirm: () => { update(s => { s.sleep = (s.sleep || []).filter(x => x.id !== id) }); close(); toast(t('Night deleted')) } })
  if (id && !prev) return <><h3>{t('Night')}</h3><div className="muted small">{t('This night was removed.')}</div><Button onClick={close}>{t('Close')}</Button></>
  return <>
    <h3>{prev ? t('Night of {0}', fmtDate(prev.d, true)) : t('Log a night')}</h3>
    {prev?.src === 'health' && <div className="small dim" style={{ marginBottom: 10 }}>{t('From {0}. Changing the times keeps your version: Apple Health will not overwrite it.', sourceText(prev))}</div>}
    <div className="med-form">
      <label><span>{t('Woke up on')}</span><input className="field" type="date" value={f.d} max={todayISO()} onChange={e => set('d', e.target.value)} /></label>
      <div className="food-macro-grid">
        <label><span>{t('Went to bed')}</span><input className="field" type="time" value={f.bed} onChange={e => set('bed', e.target.value)} /></label>
        <label><span>{t('Woke up')}</span><input className="field" type="time" value={f.wake} onChange={e => set('wake', e.target.value)} /></label>
      </div>
      <div>
        <div className="small" style={{ color: 'var(--label-2)', marginBottom: 5 }}>{t('How did you sleep?')}</div>
        <div className="sleep-stars">{[1, 2, 3, 4, 5].map(q => <button key={q} className={'iconbtn' + (f.quality >= q ? ' on' : '')} aria-label={t('{0} of 5', q)}
          onClick={() => set('quality', f.quality === q ? null : q)}><Icon name={f.quality >= q ? 'starFill' : 'star'} /></button>)}</div>
      </div>
      <label><span>{t('Note')}</span><TextField value={f.note} maxLength={200} placeholder={t('e.g. Coffee late, woke up at 3')} onChange={e => set('note', e.target.value)} /></label>
    </div>
    <div style={{ height: 12 }} />
    <Button variant="primary" onClick={save}>{t('Save')}</Button>
    {prev && <><div style={{ height: 8 }} /><Button variant="ghost" className="danger" icon="trash" onClick={remove}>{t('Delete night')}</Button></>}
  </>
}
export const nightSheet = id => ui().openSheet(close => <NightForm id={id} close={close} />)

/* ---------- the goal ---------- */

function GoalForm({ close }) {
  const S = useStore(s => s.S)
  return <>
    <h3>{t('Sleep goal')}</h3>
    <div className="sect-b"><SelectRow title={t('Each night')} sheetTitle={t('Sleep goal')} value={goalOf(S)}
      onChange={v => { update(s => { s.sleepPrefs = { ...(s.sleepPrefs || {}), goalMin: v } }); close() }}
      options={GOALS.map(m => ({ value: m, label: dur(m) }))} /></div>
  </>
}
const goalSheet = () => ui().openSheet(close => <GoalForm close={close} />)

/* ---------- Apple Health through the Shortcut ---------- */

function SyncForm({ close }) {
  const user = useStore(s => s.user)
  const [st, setSt] = useState(null)
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!user) return
    let alive = true
    api('/api/sleep/token').then(r => { if (alive) setSt(r) }).catch(() => { if (alive) setSt({ on: false, failed: true }) })
    return () => { alive = false }
  }, [user])
  if (!user) return <><h3>{t('Sleep from Apple Health')}</h3><div className="muted small">{t('Sign in to your server to sync sleep from Apple Health.')}</div><Button onClick={close}>{t('Close')}</Button></>
  // Absolute: on the web apiUrl is a path of this origin, and the Shortcut runs outside the app.
  const url = new URL(apiUrl('/api/sleep/ingest'), location.href).href
  // The one line the shortcut takes: its first Text, split on the space (scripts/sleep-shortcut.mjs).
  const line = token ? `${url} ${token}` : ''
  const copy = async v => toast((await copyText(v)) ? t('Copied') : t('Could not copy'))
  const make = async () => {
    setBusy(true)
    try {
      const r = await api('/api/sleep/token', { method: 'POST' })
      setToken(r.token); setSt(r)
      // Copied straight away, ready to paste into the shortcut; the button below copies it again.
      if (await copyText(`${url} ${r.token}`)) toast(t('Copied. Paste it into the Shortcut.'))
    }
    catch (e) { toast(e?.message || t('Something went wrong. Try again.')) }
    finally { setBusy(false) }
  }
  const askMake = () => (st?.on ? confirmSheet({ title: t('Make a new token?'), message: t('The Shortcut stops working until you paste the new one into it.'), confirmText: t('New token'), onConfirm: make }) : make())
  const revoke = () => confirmSheet({ title: t('Turn off the sync?'), message: t('The token stops working. The nights already here stay.'), confirmText: t('Turn off'), danger: true,
    onConfirm: async () => { try { setSt(await api('/api/sleep/token', { method: 'DELETE' })); setToken('') } catch (e) { toast(e?.message || t('Something went wrong. Try again.')) } } })
  return <>
    <h3>{t('Sleep from Apple Health')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{t('An iPhone Shortcut reads last night from the Health app (Apple Watch, Oura, RingConn…) and sends it here every morning.')}</div>
    {st?.on && <div className="small dim" style={{ marginBottom: 10 }}>{st.last ? t('Last sync: {0} · {1} nights', new Date(st.last).toLocaleString(), st.nights ?? 0) : t('Token made, no sync yet.')}</div>}
    {line ? <div className="sleep-secret">
      <div className="small dim">{t('Line for the Shortcut (shown only now)')}</div>
      <div className="row between"><code>{line}</code><button className="iconbtn" aria-label={t('Copy')} onClick={() => copy(line)}><Icon name="copy" /></button></div>
    </div> : <Button variant="primary" icon="key" disabled={busy || !st} onClick={askMake}>{st?.on ? t('Make a new token') : t('Make a token')}</Button>}
    <div style={{ height: 8 }} />
    <a className="btn plain" href={apiUrl('/shortcuts/opengym-sleep.shortcut')} download="openGym Sono.shortcut"><Icon name="download" /><span>{t('Download the Shortcut')}</span></a>
    <h4 className="sec" style={{ margin: '16px 2px 6px' }}>{t('Set up the Shortcut')}</h4>
    <ol className="sleep-steps small">
      <li>{t('Make a token: the app copies a line with your server and the token.')}</li>
      <li>{t('Download the Shortcut and add it, on the iPhone or on a Mac with the same iCloud.')}</li>
      <li>{t('Open it in Shortcuts and paste the line into the first Text, in place of COLE_AQUI_A_LINHA_DO_OPENGYM.')}</li>
      <li>{t('Run it once and allow it to read your sleep and to reach your server.')}</li>
      <li>{t('In Automation, run it every day after you wake up (for example at 10:00), without asking.')}</li>
    </ol>
    {/* The same token and line send the workout that just ended on the watch
        (POST /api/workouts/ingest, scripts/workout-shortcut.mjs). */}
    <h4 className="sec" style={{ margin: '16px 2px 6px' }}>{t('Workouts from the Apple Watch')}</h4>
    <div className="muted small" style={{ marginBottom: 10 }}>{t('A second Shortcut sends the calories and duration of each workout when it ends on the watch. It joins the workout you logged here, or adds one of its own, and marks the workout habit.')}</div>
    {st?.on && st.lastWorkout && <div className="small dim" style={{ marginBottom: 10 }}>{t('Last workout received: {0}', new Date(st.lastWorkout).toLocaleString())}</div>}
    <a className="btn plain" href={apiUrl('/shortcuts/opengym-workout.shortcut')} download="openGym Treino.shortcut"><Icon name="download" /><span>{t('Download the workout Shortcut')}</span></a>
    <ol className="sleep-steps small">
      <li>{t('Paste the same line into its first Text.')}</li>
      <li>{t('In Automation, choose Apple Watch Workout, then Ends and any workout, run it immediately, without asking.')}</li>
      <li>{t('Optional: one automation per kind of workout, each with its name in the second Text (Run, Strength…).')}</li>
    </ol>
    {st?.on && <><div style={{ height: 8 }} /><Button variant="ghost" className="danger" onClick={revoke}>{t('Turn off the sync')}</Button></>}
  </>
}
export const sleepSyncSheet = () => ui().openSheet(close => <SyncForm close={close} />)

/* ---------- the screen ---------- */

function Stages({ stages }) {
  const parts = stageShares(stages)
  if (!parts.length) return null
  return <>
    <div className="sleep-stages">{parts.map(p => <div key={p.k} className={'sleep-' + p.k} style={{ width: p.pct + '%' }} />)}</div>
    <div className="sleep-legend small">{parts.map(p => <span key={p.k}><i className={'sleep-' + p.k} />{t(STAGE_LABEL[p.k])} {dur(p.min)}</span>)}</div>
  </>
}

function LastNight({ night, goal }) {
  if (!night) return <div className="card">
    <div className="muted small">{t('No nights yet. Log one by hand, or sync from Apple Health.')}</div>
    <div className="row" style={{ gap: 8, marginTop: 10 }}>
      <Button size="sm" icon="plus" onClick={() => nightSheet()}>{t('Log a night')}</Button>
      <Button size="sm" icon="moon" onClick={sleepSyncSheet}>{t('Apple Health')}</Button>
    </div>
  </div>
  const diff = night.asleepMin - goal
  return <div className="card tappable" style={{ cursor: 'pointer' }} onClick={() => nightSheet(night.id)}>
    <div className="muted small">{night.d === todayISO() ? t('Last night') : fmtDate(night.d, true)}</div>
    <div className="big">{dur(night.asleepMin)}</div>
    <div className="small" style={{ color: diff < 0 ? 'var(--orange)' : 'var(--label-2)' }}>
      {diff < 0 ? t('{0} short of your goal', dur(-diff)) : t('Goal reached')}
    </div>
    <div className="small dim" style={{ marginTop: 4 }}>
      {[`${clock(night.bed)} → ${clock(night.wake)}`, night.inBedMin > night.asleepMin ? t('{0} in bed', dur(night.inBedMin)) : null, sourceText(night)].filter(Boolean).join(' · ')}
    </div>
    <Stages stages={night.stages} />
  </div>
}

function Nights() {
  const S = useStore(s => s.S)
  const goal = goalOf(S)
  const nights = byDay(S.sleep)
  return <>
    <LastNight night={nights[0]} goal={goal} />
    {nights.length > 1 && <>
      <h4 className="sec" style={{ margin: '16px 2px 8px' }}>{t('Nights')}</h4>
      <Section>{nights.slice(1, 60).map(n => <Row key={n.id} title={fmtDate(n.d, true)}
        subtitle={[`${clock(n.bed)} → ${clock(n.wake)}`, sourceText(n), n.quality ? '★'.repeat(n.quality) : null].filter(Boolean).join(' · ')}
        value={dur(n.asleepMin)} onClick={() => nightSheet(n.id)} />)}</Section>
    </>}
  </>
}

function Trends() {
  const S = useStore(s => s.S)
  const [range, setRange] = useState(7)
  const goal = goalOf(S)
  const to = todayISO(), from = addDays(to, -(range - 1))
  const sum = summary(S.sleep, from, to, goal)
  const points = dailySeries(S.sleep, from, to).filter(x => x.min != null).map(x => ({ t: Date.parse(x.d + 'T12:00:00'), y: Math.round((x.min / 60) * 10) / 10, d: x.d }))
  return <>
    <Segmented className="seg-range" value={range} onChange={setRange} options={[{ value: 7, label: '7D' }, { value: 30, label: '30D' }, { value: 90, label: '90D' }]} />
    <div className="card" style={{ marginTop: 12 }}>
      <div className="muted small">{t('Average a night')}</div>
      {sum ? <>
        <div className="big">{dur(sum.avgMin)}</div>
        <div className="small dim">{t('Bed {0} · up {1}', sum.avgBed, sum.avgWake)} · {t('{0} of {1} nights on goal', sum.goalHit, sum.nights)}</div>
        <div className="small dim">{sum.spreadMin <= 30 ? t('Regular bedtime (±{0})', dur(sum.spreadMin)) : t('Bedtime varies ±{0}', dur(sum.spreadMin))}</div>
      </> : <div className="muted small" style={{ marginTop: 6 }}>{t('Nothing logged in this period.')}</div>}
      {points.length > 1 && <div className="chart" style={{ marginTop: 10 }}><LineChart points={points} h={170} unit="h" color="var(--indigo)" goal={goal / 60} /></div>}
    </div>
  </>
}

export default function Sleep() {
  const nav = useNavigate()
  const [tab, setTab] = useState('nights')
  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/health')} aria-label={t('Health')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 10 }}><h1>{t('Sleep')}</h1><div className="sub">{t('Your nights, from Apple Health or by hand')}</div></div>
      <button className="iconbtn" onClick={sleepSyncSheet} aria-label={t('Sleep from Apple Health')}><Icon name="link" /></button>
      <button className="iconbtn" onClick={goalSheet} aria-label={t('Sleep goal')}><Icon name="target" /></button>
      <button className="iconbtn" onClick={() => nightSheet()} aria-label={t('Log a night')}><Icon name="plus" /></button>
    </div>
    <Segmented value={tab} onChange={setTab} options={[{ value: 'nights', label: t('Nights') }, { value: 'trends', label: t('Over time') }]} />
    <div style={{ height: 12 }} />
    {tab === 'nights' ? <Nights /> : <Trends />}
  </div>
}

/** Last night, for the Health hub and the Home card: null when there is no night of the last two days. */
export function sleepLast(S, today = todayISO()) {
  const n = lastNight(S.sleep)
  if (!n || n.d < addDays(today, -1)) return null
  return { min: n.asleepMin, goal: goalOf(S), bed: clock(n.bed), wake: clock(n.wake), d: n.d }
}
