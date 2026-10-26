import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { api } from '../lib/api.js'
import { copyText } from '../lib/clipboard.js'
import { fmtDate } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import Icon from '../components/Icon.jsx'
import { Button, Row, Section, Switch } from '../components/ui.jsx'
import { confirmSheet } from '../sheets.jsx'

// The Personal module (api/trainer.js), phase 1: the link between a trainer and a student.
// A student enters the trainer's code here, seeing what is shared before agreeing; a trainer
// hands out the code and sees who linked. Either side can end a link, at once.

const ui = () => useUI.getState()
const toast = m => ui().toast(m)
const dayOf = ms => new Date(ms).toISOString().slice(0, 10)

/** What a link shares, said the same on both sides. */
export function SharedList({ body }) {
  return <ul className="small trainer-share">
    <li>{t('Your routines and plan, which the trainer can see')}</li>
    <li>{t('Your workouts: exercises, sets, loads and notes (no photos or videos)')}</li>
    {body && <li>{t('Your weigh-ins and body measurements')}</li>}
    <li className="dim">{t('Never: food, sleep, medications, exams, habits or water')}</li>
    <li className="dim">{t('If the link ends, the trainer keeps a copy of your workouts up to that day')}</li>
  </ul>
}

function MyTrainers({ close, invite }) {
  const [links, setLinks] = useState(null)
  // From an invite link (views/StudentRecord.jsx JoinInvite): the code in, and the trainer's
  // record of this student, so the trainer's app puts the two together.
  const [code, setCode] = useState(invite?.code || '')
  const [body, setBody] = useState(false)
  const [busy, setBusy] = useState(false)
  const load = () => api('/api/trainer/mine').then(r => setLinks(r.trainers)).catch(e => { setLinks([]); toast(e.message) })
  useEffect(() => { load() }, [])
  const link = async () => {
    if (!code.trim()) return
    setBusy(true)
    try { const r = await api('/api/trainer/link', { method: 'POST', body: JSON.stringify({ code: code.trim(), body, ...(invite?.ref ? { ref: invite.ref } : {}) }) }); setCode(''); toast(t('Linked to {0}', r.link.trainer.name)); load() }
    catch (e) { toast(e.message) }
    finally { setBusy(false) }
  }
  const scope = (l, v) => api('/api/trainer/scope', { method: 'POST', body: JSON.stringify({ id: l.id, body: v }) }).then(load).catch(e => toast(e.message))
  const end = l => confirmSheet({ title: t('Stop sharing with {0}?', l.trainer.name), message: t('They lose access to your training at once. Nothing of yours is deleted.'), confirmText: t('Stop sharing'), danger: true,
    onConfirm: () => api('/api/trainer/unlink', { method: 'POST', body: JSON.stringify({ id: l.id }) }).then(() => { toast(t('Link ended')); load() }).catch(e => toast(e.message)) })
  return <>
    <h3>{t('My personal trainer')}</h3>
    {links === null ? <div className="muted small">{t('Loading…')}</div> : <>
      {links.map(l => <div key={l.id} className="card" style={{ marginBottom: 10 }}>
        <div className="row between"><b>{l.trainer.name}</b><span className="small dim">{t('since {0}', fmtDate(dayOf(l.created), true))}</span></div>
        <SharedList body={l.scope?.body} />
        <Row title={t('Share weigh-ins and measurements too')}><Switch checked={!!l.scope?.body} onChange={v => scope(l, v)} aria-label={t('Share weigh-ins and measurements too')} /></Row>
        <Button variant="ghost" className="danger" onClick={() => end(l)}>{t('Stop sharing')}</Button>
      </div>)}
      <div className="card">
        <div className="muted small" style={{ marginBottom: 8 }}>{links.length ? t('Another trainer? Enter their code.') : t('Enter the code your personal trainer gave you. They will see:')}</div>
        {!links.length && <SharedList body={body} />}
        <input className="input" placeholder="PT-XXXXXXXX" value={code} maxLength={16} onChange={e => setCode(e.target.value.toUpperCase())} style={{ letterSpacing: '.12em', fontWeight: 600, textAlign: 'center' }} />
        <Row title={t('Share weigh-ins and measurements too')}><Switch checked={body} onChange={setBody} aria-label={t('Share weigh-ins and measurements too')} /></Row>
        <Button variant="primary" icon="link" disabled={busy || !code.trim()} onClick={link}>{t('Link to my trainer')}</Button>
      </div>
    </>}
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Close')}</Button>
  </>
}
export const myTrainersSheet = invite => ui().openSheet(close => <MyTrainers close={close} invite={invite?.code ? invite : null} />)

function MyStudents({ close }) {
  const [code, setCode] = useState(undefined)
  const [students, setStudents] = useState(null)
  const load = () => {
    api('/api/trainer/code').then(setCode).catch(() => setCode({ code: null }))
    api('/api/trainer/students').then(r => setStudents(r.students)).catch(e => { setStudents([]); toast(e.message) })
  }
  useEffect(() => { load() }, [])
  const make = () => api('/api/trainer/code', { method: 'POST' }).then(async r => { setCode(r); if (await copyText(r.code)) toast(t('Code copied')) }).catch(e => toast(e.message))
  const end = l => confirmSheet({ title: t('Stop following {0}?', l.student.name), message: t('You lose access to their training. They can link again with a code.'), confirmText: t('End link'), danger: true,
    onConfirm: () => api('/api/trainer/unlink', { method: 'POST', body: JSON.stringify({ id: l.id }) }).then(() => { toast(t('Link ended')); load() }).catch(e => toast(e.message)) })
  return <>
    <h3>{t('My students')}</h3>
    <div className="card">
      <div className="muted small" style={{ marginBottom: 8 }}>{t('Hand this code to a student. In Settings → My personal trainer they enter it and choose what to share. It works for any number of students for a week.')}</div>
      {code?.code ? <div className="row between trainer-code">
        <code>{code.code}</code>
        <button className="iconbtn" aria-label={t('Copy')} onClick={async () => toast((await copyText(code.code)) ? t('Copied') : t('Could not copy'))}><Icon name="copy" /></button>
      </div> : null}
      {code?.code && <div className="small dim" style={{ margin: '4px 0 10px' }}>{t('Valid until {0}', fmtDate(dayOf(code.exp), true))}</div>}
      <Button variant={code?.code ? 'plain' : 'primary'} icon="key" disabled={code === undefined} onClick={make}>{code?.code ? t('Make a new code') : t('Make a code')}</Button>
    </div>
    <h4 className="sec" style={{ margin: '16px 2px 8px' }}>{t('Students')}</h4>
    {students === null ? <div className="muted small">{t('Loading…')}</div>
      : students.length ? <Section>{students.map(l => <Row key={l.id} icon="person" iconTint="var(--teal)" title={l.student.name}
        subtitle={[t('since {0}', fmtDate(dayOf(l.created), true)), l.scope?.body ? t('shares weigh-ins') : null].filter(Boolean).join(' · ')}>
        <button className="iconbtn" aria-label={t('End link')} onClick={() => end(l)}><Icon name="xmark" /></button>
      </Row>)}</Section>
        : <div className="muted small">{t('No students yet.')}</div>}
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Close')}</Button>
  </>
}
export const myStudentsSheet = () => ui().openSheet(close => <MyStudents close={close} />)

/** The rows in Settings → Account: a trainer's students, anyone's trainer. */
export function TrainerRows() {
  const user = useStore(s => s.user)
  const nav = useNavigate()
  if (!user) return null
  return <>
    {user.trainer && <Row icon="star" iconTint="var(--orange)" title={t('My students')} subtitle={t('Your code, and who shares their training with you')} accessory="chevron" onClick={() => nav('/students')} />}
    <Row icon="link" iconTint="var(--teal)" title={t('My personal trainer')} subtitle={t('Share your training with your trainer')} accessory="chevron" onClick={myTrainersSheet} />
  </>
}
