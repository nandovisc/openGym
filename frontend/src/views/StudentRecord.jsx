import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { api } from '../lib/api.js'
import { copyText } from '../lib/clipboard.js'
import { inviteLink, normalizeStudent, whatsappUrl } from '../lib/students.js'
import { fmtDate, fmtNum, todayISO } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import Icon from '../components/Icon.jsx'
import { Button, NumberField, Row, Section, Segmented } from '../components/ui.jsx'
import { confirmSheet } from '../sheets.jsx'
import { myTrainersSheet } from './Trainer.jsx'

// The Personal module, phase 4: a trainer's own record of each student (lib/students.js) — who
// they are, what they train for, what to keep in mind, what they pay — and the invite that brings
// a student in: a link with the trainer's code and the record, sent by WhatsApp, opened by the
// student to join already linked (JoinInvite below).

const ui = () => useUI.getState()
const toast = m => ui().toast(m)
const update = fn => useStore.getState().update(fn)
const BILLING_LABEL = { monthly: 'Monthly fee', package: 'Package of classes', single: 'Per class' }
const STATUS_LABEL = { active: 'Active', paused: 'Paused', invited: 'Invited', ended: 'Link ended' }
const money = n => (Number(n) > 0 ? Number(n).toLocaleString(undefined, { style: 'currency', currency: 'BRL' }) : '–')

/** What a student pays, in a line: "R$ 350,00 a month, due on the 5th". */
export function billingText(b) {
  if (!b?.kind) return t('Not set')
  if (b.kind === 'monthly') return t('{0} a month, due on day {1}', money(b.amount), b.dueDay || 5)
  if (b.kind === 'package') return t('{0} for {1} classes', money(b.amount), b.classes || 8)
  return t('{0} a class', money(b.amount))
}

function StudentForm({ prev, onSaved, close }) {
  const [f, setF] = useState(() => ({
    name: prev?.name || '', phone: prev?.phone || '', email: prev?.email || '', goal: prev?.goal || '',
    notes: prev?.notes || '', restrictions: prev?.restrictions || '', start: prev?.start || todayISO(),
    status: prev?.status || '', billing: { kind: prev?.billing?.kind || '', amount: prev?.billing?.amount ?? null, dueDay: prev?.billing?.dueDay ?? 5, classes: prev?.billing?.classes ?? 8 }
  }))
  const set = patch => setF(x => ({ ...x, ...patch }))
  const setB = patch => setF(x => ({ ...x, billing: { ...x.billing, ...patch } }))
  const save = () => {
    const r = normalizeStudent({ ...f, status: f.status || undefined, billing: f.billing.kind ? f.billing : null }, { prev })
    if (r.error) { toast(t('Enter the student’s name')); return }
    update(s => { s.students = [...(s.students || []).filter(x => x?.id !== r.id), r] })
    close(); onSaved?.(r)
  }
  const field = (key, label, props = {}) => <label className="rec-field"><span className="small dim">{label}</span>
    <input className="input" value={f[key]} onChange={e => set({ [key]: e.target.value })} {...props} /></label>
  return <>
    <h3>{prev ? t('Edit record') : t('New student')}</h3>
    {field('name', t('Name'), { maxLength: 60, autoComplete: 'name' })}
    {field('phone', t('Phone (WhatsApp)'), { inputMode: 'tel', autoComplete: 'tel', placeholder: '(11) 98888-7777' })}
    {field('email', t('E-mail'), { inputMode: 'email', autoComplete: 'email' })}
    {field('goal', t('Goal'), { maxLength: 120, placeholder: t('Gain muscle, lose fat, run 10 km…') })}
    <label className="rec-field"><span className="small dim">{t('Health history and notes')}</span>
      <textarea className="input" rows={3} maxLength={2000} value={f.notes} onChange={e => set({ notes: e.target.value })} placeholder={t('Past injuries, medications, how they train, what they like…')} /></label>
    <label className="rec-field"><span className="small dim">{t('Restrictions')}</span>
      <textarea className="input" rows={2} maxLength={1000} value={f.restrictions} onChange={e => set({ restrictions: e.target.value })} placeholder={t('What to avoid or adapt')} /></label>
    {field('start', t('Started on'), { type: 'date' })}
    <div className="rec-field"><span className="small dim">{t('How they pay')}</span>
      <Segmented value={f.billing.kind || 'none'} onChange={v => setB({ kind: v === 'none' ? '' : v })}
        options={[{ value: 'none', label: '–' }, { value: 'monthly', label: t('Monthly') }, { value: 'package', label: t('Package') }, { value: 'single', label: t('Per class') }]} /></div>
    {f.billing.kind && <div className="rec-pay">
      <label className="rec-field"><span className="small dim">{t('Amount (R$)')}</span><NumberField className="field" nullable value={f.billing.amount} onChange={v => setB({ amount: v })} aria-label={t('Amount (R$)')} /></label>
      {f.billing.kind === 'monthly' && <label className="rec-field"><span className="small dim">{t('Due day')}</span><NumberField className="field" decimal={false} value={f.billing.dueDay} onChange={v => setB({ dueDay: v })} aria-label={t('Due day')} /></label>}
      {f.billing.kind === 'package' && <label className="rec-field"><span className="small dim">{t('Classes')}</span><NumberField className="field" decimal={false} value={f.billing.classes} onChange={v => setB({ classes: v })} aria-label={t('Classes')} /></label>}
    </div>}
    {prev?.studentId && prev.status !== 'ended' && <div className="rec-field"><span className="small dim">{t('Status')}</span>
      <Segmented value={f.status || 'active'} onChange={v => set({ status: v })} options={[{ value: 'active', label: t('Active') }, { value: 'paused', label: t('Paused') }]} /></div>}
    <div style={{ height: 12 }} />
    <Button variant="primary" onClick={save}>{t('Save')}</Button>
  </>
}
/** The form of a student's record; `onSaved(record)` once kept. */
export const studentFormSheet = (prev, onSaved) => ui().openSheet(close => <StudentForm prev={prev} onSaved={onSaved} close={close} />)

function Invite({ record, close }) {
  const [code, setCode] = useState(null)
  useEffect(() => {
    api('/api/trainer/code').then(r => (r.code ? r : api('/api/trainer/code', { method: 'POST' }))).then(r => setCode(r.code)).catch(e => toast(e.message))
  }, [])
  const trainer = useStore(s => s.user?.name) || ''
  const link = code ? inviteLink(location.href, code, record.id) : ''
  const message = t('Hi {0}! I’m {1}, your personal trainer. I’ll follow and plan your workouts in openGym: create your account with this link — {2}', record.name.split(' ')[0], trainer, link)
  const share = async () => {
    try { if (navigator.share) { await navigator.share({ text: message }); return } } catch { return }
    toast((await copyText(message)) ? t('Copied') : t('Could not copy'))
  }
  return <>
    <h3>{t('Invite {0}', record.name)}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{t('The student opens the link, creates an account or signs in, and joins you with one tap, seeing what they share.')}</div>
    {code ? <>
      <div className="card small rec-invite">{message}</div>
      <a className="btn primary" href={whatsappUrl(record.phone, message)} target="_blank" rel="noopener"><Icon name="chat" /><span>{record.phone ? t('Send on WhatsApp to {0}', record.phone) : t('Send on WhatsApp')}</span></a>
      <div style={{ height: 8 }} />
      <Button icon="copy" onClick={async () => toast((await copyText(link)) ? t('Link copied') : t('Could not copy'))}>{t('Copy link')}</Button>
      <div style={{ height: 8 }} />
      <Button variant="ghost" onClick={share}>{t('Share another way')}</Button>
    </> : <div className="muted small">{t('Loading…')}</div>}
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Close')}</Button>
  </>
}
export const inviteSheet = record => ui().openSheet(close => <Invite record={record} close={close} />)

/**
 * The record tab of a student: what the trainer keeps about them, to edit, and the invite while
 * they have not joined. `studentId` when the student has joined and there is no record yet: one
 * is made with their name.
 */
export function RecordTab({ record, name, studentId }) {
  const nav = useNavigate()
  if (!record) return <div className="card">
    <div className="muted small" style={{ marginBottom: 10 }}>{t('No record yet: their contact, goal, health notes and what they pay, kept for you only.')}</div>
    <Button variant="primary" icon="plus" onClick={() => studentFormSheet({ name, studentId, status: 'active' })}>{t('Make a record')}</Button>
  </div>
  const remove = () => confirmSheet({ title: t('Delete the record of {0}?', record.name), message: t('Your notes about them go. Their account and workouts are theirs and stay.'), confirmText: t('Delete'), danger: true,
    onConfirm: () => { update(s => { s.students = (s.students || []).filter(x => x?.id !== record.id) }); nav('/students') } })
  return <>
    <Section>
      <Row title={t('Status')} value={t(STATUS_LABEL[record.status] || 'Active')} />
      {record.phone && <Row title={t('Phone')} value={record.phone} />}
      {record.email && <Row title={t('E-mail')} value={record.email} />}
      {record.goal && <Row title={t('Goal')} subtitle={record.goal} />}
      <Row title={t(BILLING_LABEL[record.billing?.kind] || 'Payment')} subtitle={billingText(record.billing)} />
      {record.start && <Row title={t('Started on')} value={fmtDate(record.start, true)} />}
    </Section>
    {(record.notes || record.restrictions) && <div className="card small rec-notes">
      {record.notes && <><b>{t('Health history and notes')}</b><p>{record.notes}</p></>}
      {record.restrictions && <><b>{t('Restrictions')}</b><p>{record.restrictions}</p></>}
    </div>}
    <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
      <Button icon="pencil" onClick={() => studentFormSheet(record)}>{t('Edit record')}</Button>
      {(record.status === 'invited' || record.status === 'ended') && <Button variant="primary" icon="chat" onClick={() => inviteSheet(record)}>{record.status === 'ended' ? t('Invite again') : t('Send invite')}</Button>}
      <Button variant="ghost" className="danger" onClick={remove}>{t('Delete record')}</Button>
    </div>
    <div className="small dim" style={{ marginTop: 10 }}>{t('Only you see this record. {0}', record.history ? t('The workouts above are a copy kept when the link ended.') : '')}</div>
  </>
}

/**
 * The invite link's page (#/join?code=…&ref=…): signed in, it opens My personal trainer with the
 * code in (the student still sees what is shared and agrees); not signed in, the sign-in screen
 * says who invited them (views/Login.jsx) and this page runs once they are in.
 */
export function JoinInvite() {
  const nav = useNavigate()
  const loc = useLocation()
  useEffect(() => {
    const q = new URLSearchParams(loc.search)
    const code = q.get('code') || '', ref = q.get('ref') || ''
    nav('/home', { replace: true })
    if (code) myTrainersSheet({ code, ref })
  }, [])
  return null
}
