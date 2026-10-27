import { useEffect, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { api, apiUrl } from '../lib/api.js'
import { copyText } from '../lib/clipboard.js'
import { t } from '../lib/i18n.js'
import Icon from '../components/Icon.jsx'
import { Button, Row, Section, Switch, TextField } from '../components/ui.jsx'
import { confirmSheet } from '../sheets.jsx'

// Settings → API keys: the person's own keys for another app to read their data — and write it,
// when the key says so — one area at a time (api/api-keys.js, server.js /api/v1/*). A key is
// shown once, when it is made; the server keeps only its hash.

const ui = () => useUI.getState()
const toast = m => ui().toast(m)
// Literal t() calls, so scripts/check-source-strings.mjs sees every label.
export const AREAS = [
  ['training', () => t('Training'), () => t('Workouts, routines, the week')],
  ['body', () => t('Body'), () => t('Weigh-ins and measurements')],
  ['health', () => t('Health'), () => t('Sleep, water, food, medications, habits')],
  ['exams', () => t('Medical exams'), () => t('Exams and their results')],
  ['personal', () => t('Personal trainer'), () => t('Your students’ records, classes and payments')]
]
const areaName = k => (AREAS.find(a => a[0] === k)?.[1] || (() => k))()
const when = ms => (ms ? new Date(ms).toLocaleDateString() : t('never'))

function NewKey({ trainer, onMade, back }) {
  const [f, setF] = useState({ name: '', scopes: [], write: false })
  const [busy, setBusy] = useState(false)
  const toggle = k => setF(x => ({ ...x, scopes: x.scopes.includes(k) ? x.scopes.filter(s => s !== k) : [...x.scopes, k] }))
  const make = async () => {
    setBusy(true)
    try { onMade(await api('/api/account/api-keys', { method: 'POST', body: JSON.stringify(f) })) }
    catch (e) { toast(e?.message || t('Something went wrong. Try again.')) }
    finally { setBusy(false) }
  }
  return <>
    <h3>{t('New API key')}</h3>
    <TextField placeholder={t('Name, e.g. Diet app')} value={f.name} maxLength={60} onChange={e => setF(x => ({ ...x, name: e.target.value }))} />
    <Section title={t('What it can see')}>
      {AREAS.filter(([k]) => k !== 'personal' || trainer).map(([k, label, sub]) => <Row key={k} title={label()} subtitle={sub()}>
        <Switch checked={f.scopes.includes(k)} onChange={() => toggle(k)} aria-label={label()} />
      </Row>)}
    </Section>
    {f.scopes.includes('personal') && <div className="small today-warn" style={{ margin: '-4px 4px 10px' }}>{t('This shares your students’ data with the other app. Only do it if they agreed.')}</div>}
    <Section footer={t('Without it, the app only reads.')}>
      <Row title={t('Allow writing')} subtitle={t('Add, change and remove entries in these areas')}>
        <Switch checked={f.write} onChange={v => setF(x => ({ ...x, write: v }))} aria-label={t('Allow writing')} />
      </Row>
    </Section>
    <Button variant="primary" icon="key" disabled={busy || !f.name.trim() || !f.scopes.length} onClick={make}>{t('Make the key')}</Button>
    <div style={{ height: 6 }} />
    <Button variant="ghost" className="dim" onClick={back}>{t('Cancel')}</Button>
  </>
}

function MadeKey({ made, back }) {
  // Absolute: on the web apiUrl is a path of this origin, and the other app runs elsewhere.
  const base = new URL(apiUrl('/api/v1'), location.href).href
  const sample = `curl -H "Authorization: Bearer ${made.key}" ${base}/me`
  const copy = async v => toast((await copyText(v)) ? t('Copied') : t('Could not copy'))
  return <>
    <h3>{t('Key “{0}” made', made.name)}</h3>
    <div className="muted small" style={{ marginBottom: 10 }}>{t('Copy it now: it is shown only this once. Anyone with it can reach the areas it opens.')}</div>
    <div className="sleep-secret">
      <div className="small dim">{t('The key')}</div>
      <div className="row between"><code>{made.key}</code><button className="iconbtn" aria-label={t('Copy')} onClick={() => copy(made.key)}><Icon name="copy" /></button></div>
    </div>
    <div style={{ height: 8 }} />
    <div className="sleep-secret">
      <div className="small dim">{t('Server address')}</div>
      <div className="row between"><code>{base}</code><button className="iconbtn" aria-label={t('Copy')} onClick={() => copy(base)}><Icon name="copy" /></button></div>
    </div>
    <div style={{ height: 8 }} />
    <div className="sleep-secret">
      <div className="small dim">{t('Try it')}</div>
      <div className="row between"><code>{sample}</code><button className="iconbtn" aria-label={t('Copy')} onClick={() => copy(sample)}><Icon name="copy" /></button></div>
    </div>
    <div style={{ height: 12 }} />
    <Button variant="primary" onClick={back}>{t('Done')}</Button>
  </>
}

function ApiKeys({ close }) {
  const trainer = useStore(s => !!s.user?.trainer)
  const [st, setSt] = useState(null)
  const [step, setStep] = useState('list')
  const [made, setMade] = useState(null)
  const load = () => api('/api/account/api-keys').then(setSt).catch(e => setSt({ keys: [], failed: e?.message || true }))
  useEffect(() => { load() }, [])
  if (step === 'new') return <NewKey trainer={trainer} back={() => setStep('list')} onMade={r => { setMade(r); setStep('made'); load() }} />
  if (step === 'made' && made) return <MadeKey made={made} back={() => { setMade(null); setStep('list') }} />
  const keys = st?.keys || []
  const revoke = k => confirmSheet({ title: t('Revoke “{0}”?', k.name), message: t('The app using it stops reaching your data at once.'), confirmText: t('Revoke'), danger: true,
    onConfirm: async () => { try { await api('/api/account/api-keys?id=' + encodeURIComponent(k.id), { method: 'DELETE' }); load() } catch (e) { toast(e?.message || t('Something went wrong. Try again.')) } } })
  return <>
    <h3>{t('API keys')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{t('A key lets another app read your data — and write it, if you allow — in the areas you choose. You can revoke it anytime.')}</div>
    {st?.failed && <div className="card muted small">{t('Could not load your keys.')}</div>}
    {keys.length > 0 && <Section>
      {keys.map(k => <Row key={k.id} icon="key" iconTint="var(--acc)" title={k.name}
        subtitle={`${k.scopes.map(areaName).join(', ')} · ${k.write ? t('reads and writes') : t('reads only')} · ${t('last used: {0}', when(k.last))}`}>
        <button className="linkbtn danger" onClick={() => revoke(k)}>{t('Revoke')}</button>
      </Row>)}
    </Section>}
    {st && !keys.length && !st.failed && <div className="small dim" style={{ marginBottom: 10 }}>{t('No keys yet.')}</div>}
    <Button variant="primary" icon="plus" disabled={!st || keys.length >= (st.max || 10)} onClick={() => setStep('new')}>{t('New API key')}</Button>
    <div style={{ height: 6 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Close')}</Button>
  </>
}

export const apiKeysSheet = () => ui().openSheet(close => <ApiKeys close={close} />)
