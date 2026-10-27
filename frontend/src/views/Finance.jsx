import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { addMonths, addPayment, expectedIn, financeOf, monthOf, normalizePayment, paymentsIn, removePayment, revenueByMonth, standingOf, suggestedPayment } from '../lib/finance.js'
import { MONTHS_LONG, fmtDate, todayISO } from '../lib/format.js'
import { t, tn } from '../lib/i18n.js'
import Icon from '../components/Icon.jsx'
import { Button, NumberField, Row, Section, Segmented } from '../components/ui.jsx'
import { confirmSheet } from '../sheets.jsx'

// The Personal module, phase 7: a trainer's money — who pays what (a monthly fee, a package of
// classes, each class), what came in, what is still owed (lib/finance.js). Payments are written
// down by hand: nothing here charges anyone or talks to a bank.

const ui = () => useUI.getState()
const toast = m => ui().toast(m)
const update = fn => useStore.getState().update(fn)
export const money = n => Number(n || 0).toLocaleString(undefined, { style: 'currency', currency: 'BRL' })
const monthName = m => `${t(MONTHS_LONG[Number(m.slice(5, 7)) - 1])} ${m.slice(0, 4)}`
const shortMonth = m => t(MONTHS_LONG[Number(m.slice(5, 7)) - 1]).slice(0, 3)
const KIND_LABEL = { monthly: 'Monthly fee', package: 'Package of classes', single: 'Per class', other: 'Other' }
const KINDS = ['monthly', 'package', 'single', 'other']

/** One line of where a student's payments stand, and its tone. */
export function standingText(s) {
  if (!s || s.state === 'none') return { text: t('No payment set'), tone: 'dim' }
  if (s.kind === 'monthly') {
    const late = (s.months || []).filter(m => m.late)
    if (late.length) return { text: tn('{0} month overdue, since {1}', '{0} months overdue, since {1}', late.length, fmtDate(late[0].due, true)), tone: 'danger' }
    if (s.state === 'due') return { text: t('Due today'), tone: 'warn' }
    if (s.state === 'upcoming') return { text: t('Due on {0}', fmtDate(s.months[0].due, true)), tone: 'dim' }
    return { text: t('Paid up · next on {0}', fmtDate(s.next, true)), tone: 'ok' }
  }
  if (s.kind === 'package') {
    if (!s.bought) return { text: t('No package paid yet'), tone: 'warn' }
    if (s.left <= 0) return { text: t('Package used up ({0} of {1} classes)', s.used, s.bought), tone: 'danger' }
    if (s.left === 1) return { text: t('Last class of the package'), tone: 'warn' }
    return { text: t('{0} of {1} classes left', s.left, s.bought), tone: 'ok' }
  }
  if (s.kind === 'single') return s.classes ? { text: tn('{0} class to pay', '{0} classes to pay', s.classes), tone: 'warn' } : { text: t('Paid up'), tone: 'ok' }
  return { text: '', tone: 'dim' }
}

function PaymentForm({ initial, prev, close }) {
  const records = (useStore(s => s.S.students) || []).filter(r => r && (r.status !== 'ended' || r.id === (prev || initial)?.recordId))
  const [f, setF] = useState(() => ({ recordId: records[0]?.id || '', d: todayISO(), kind: 'monthly', amount: null, ref: monthOf(todayISO()), classes: 1, note: '', ...(initial || {}), ...(prev || {}) }))
  const set = patch => setF(x => ({ ...x, ...patch }))
  const pick = recordId => {
    const rec = records.find(r => r.id === recordId)
    const S = useStore.getState().S
    set(rec?.billing?.kind ? { ...suggestedPayment(rec, standingOf(S, rec, todayISO()), todayISO()), d: f.d } : { recordId })
  }
  const save = () => {
    const p = normalizePayment(f, { prev })
    if (p.error) { toast(p.error === 'student' ? t('Choose a student') : p.error === 'amount' ? t('Type the amount') : t('Choose the day')); return }
    update(s => { s.payments = addPayment(s.payments, p) })
    toast(prev ? t('Payment changed') : t('Payment recorded'))
    close()
  }
  if (!records.length) return <><h3>{t('Record a payment')}</h3><div className="muted small">{t('Payments are for your students: add the first one.')}</div></>
  return <>
    <h3>{prev ? t('Edit payment') : t('Record a payment')}</h3>
    <label className="rec-field"><span className="small dim">{t('Student')}</span>
      <select className="input" value={f.recordId} onChange={e => pick(e.target.value)}>{records.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
    <Segmented value={f.kind} onChange={kind => set({ kind })} options={KINDS.map(k => ({ value: k, label: t(k === 'monthly' ? 'Monthly' : k === 'package' ? 'Package' : k === 'single' ? 'Class' : 'Other') }))} />
    <div className="rec-pay" style={{ marginTop: 10 }}>
      <label className="rec-field"><span className="small dim">{t('Amount (R$)')}</span><NumberField className="field" nullable value={f.amount} onChange={v => set({ amount: v })} aria-label={t('Amount (R$)')} /></label>
      <label className="rec-field"><span className="small dim">{t('Paid on')}</span><input className="input" type="date" value={f.d} onChange={e => set({ d: e.target.value })} /></label>
      {f.kind === 'monthly' && <label className="rec-field"><span className="small dim">{t('Month it pays')}</span><input className="input" type="month" value={f.ref} onChange={e => set({ ref: e.target.value })} /></label>}
      {(f.kind === 'package' || f.kind === 'single') && <label className="rec-field"><span className="small dim">{t('Classes')}</span><NumberField className="field" decimal={false} value={f.classes} onChange={v => set({ classes: v })} aria-label={t('Classes')} /></label>}
    </div>
    <label className="rec-field"><span className="small dim">{t('Note')}</span><input className="input" maxLength={200} value={f.note} onChange={e => set({ note: e.target.value })} placeholder={t('Pix, cash, card…')} /></label>
    <div style={{ height: 10 }} />
    <Button variant="primary" icon="check" onClick={save}>{prev ? t('Save') : t('Record payment')}</Button>
    {prev && <><div style={{ height: 8 }} /><Button variant="ghost" className="danger" onClick={() => confirmSheet({ title: t('Delete this payment?'), message: t('What the student owes is worked out again without it.'), confirmText: t('Delete'), danger: true,
      onConfirm: () => { update(s => { s.payments = removePayment(s.payments, prev.id) }); close() } })}>{t('Delete payment')}</Button></>}
  </>
}
/** The payment form: a new one starting from `initial`, or `prev` to change or delete. */
export const paymentSheet = ({ initial = null, prev = null } = {}) => ui().openSheet(close => <PaymentForm initial={initial} prev={prev} close={close} />)
/** The form for one student, filled with what their billing asks for now. */
export function payFor(rec) {
  const S = useStore.getState().S
  paymentSheet({ initial: suggestedPayment(rec, standingOf(S, rec, todayISO()), todayISO()) })
}

function Bars({ data }) {
  const max = Math.max(1, ...data.map(x => x.total))
  return <div className="fin-bars" role="img" aria-label={data.map(x => `${monthName(x.month)}: ${money(x.total)}`).join(', ')}>
    {data.map(x => <div key={x.month} className="fin-bar"><div className="fin-bar-v" style={{ height: Math.max(2, (x.total / max) * 100) + '%' }} /><span>{shortMonth(x.month)}</span></div>)}
  </div>
}

function StandingRow({ row }) {
  const { record: r, standing: s } = row
  const line = standingText(s)
  return <Row title={r.name} subtitle={<span className={'fin-' + line.tone}>{line.text}</span>}
    value={s.owed > 0 ? money(s.owed) : undefined} accessory="chevron" onClick={() => payFor(r)} />
}

/** The trainer's money: the month's takings, who owes, what came in. */
export default function Finance() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const today = todayISO()
  const [month, setMonth] = useState(monthOf(today))
  const f = financeOf(S, today)
  const pays = paymentsIn(S, month)
  const got = pays.reduce((a, p) => a + p.amount, 0)
  const names = Object.fromEntries((S.students || []).filter(Boolean).map(r => [r.id, r.name]))
  const act = f.rows.filter(r => r.standing.owed > 0 || r.standing.state === 'low')
  const rest = f.rows.filter(r => !act.includes(r))
  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav(-1)} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 10 }}><h1>{t('Finances')}</h1><div className="sub">{f.toCollect ? t('{0} to collect · {1}', money(f.pending), tn('{0} student', '{0} students', f.toCollect)) : t('Nobody owes you anything right now')}</div></div>
      <button className="iconbtn" onClick={() => paymentSheet()} aria-label={t('Record a payment')}><Icon name="plus" /></button>
    </div>
    <div className="fin-month">
      <button className="iconbtn" onClick={() => setMonth(m => addMonths(m, -1))} aria-label={t('Previous month')}><Icon name="chevronLeft" /></button>
      <b>{monthName(month)}</b>
      <button className="iconbtn" disabled={month >= monthOf(today)} onClick={() => setMonth(m => addMonths(m, 1))} aria-label={t('Next month')}><Icon name="chevronRight" /></button>
    </div>
    <div className="tiles">
      <div className="tile"><div className="l">{t('Received')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{money(got)}</div></div>
      <div className="tile"><div className="l">{t('Expected')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{money(expectedIn(S, month))}</div></div>
    </div>
    <div className="card"><div className="muted small" style={{ marginBottom: 6 }}>{t('Received in the last 6 months')}</div><Bars data={revenueByMonth(S, month < monthOf(today) ? `${month}-28` : today, 6)} /></div>
    {month === monthOf(today) && act.length > 0 && <Section title={t('To collect')}>{act.map(r => <StandingRow key={r.record.id} row={r} />)}</Section>}
    {month === monthOf(today) && rest.length > 0 && <Section title={t('Paid up')}>{rest.map(r => <StandingRow key={r.record.id} row={r} />)}</Section>}
    {month === monthOf(today) && !f.rows.length && <div className="card muted small">{t('Set what each student pays in their record (Students → a student → Record), and who owes shows here.')}</div>}
    <Section title={t('Payments in {0}', monthName(month))} footer={pays.length ? undefined : t('No payments recorded in this month.')}>
      {pays.map(p => <Row key={p.id} title={names[p.recordId] || t('Student')} subtitle={[fmtDate(p.d, true), t(KIND_LABEL[p.kind] || 'Other'), p.kind === 'monthly' && p.ref ? monthName(p.ref) : null, p.note].filter(Boolean).join(' · ')}
        value={money(p.amount)} accessory="chevron" onClick={() => paymentSheet({ prev: p })} />)}
    </Section>
  </div>
}

/** A student's payments in their record: where they stand, the last ones, a button to add one. */
export function RecordPayments({ record }) {
  const S = useStore(s => s.S)
  if (!record?.billing?.kind) return null
  const s = standingOf(S, record, todayISO())
  const line = standingText(s)
  const pays = (S.payments || []).filter(p => p && p.recordId === record.id).sort((a, b) => (a.d < b.d ? 1 : -1)).slice(0, 6)
  return <Section title={t('Payments')}>
    <Row title={<span className={'fin-' + line.tone}>{line.text}</span>} value={s.owed > 0 ? money(s.owed) : undefined} />
    {pays.map(p => <Row key={p.id} title={money(p.amount)} subtitle={[fmtDate(p.d, true), p.kind === 'monthly' && p.ref ? monthName(p.ref) : t(KIND_LABEL[p.kind] || 'Other'), p.note].filter(Boolean).join(' · ')} accessory="chevron" onClick={() => paymentSheet({ prev: p })} />)}
    <Row title={<span className="accent">{t('Record a payment')}</span>} onClick={() => payFor(record)} />
  </Section>
}

/** Today, for a trainer: what is owed now, a tap away from Finances. Nothing owed, no card. */
export function FinanceCard({ S, nav, Card }) {
  const f = financeOf(S, todayISO())
  if (!f.toCollect) return null
  return <Card title={t('Finances')} tone={f.late ? 'today-alert' : undefined} onClick={() => nav('/finance')}>
    <div className="today-big">{money(f.pending)} <span className="small dim">{t('to collect')}</span></div>
    <div className="small dim">{[f.late ? tn('{0} overdue', '{0} overdue', f.late) : null, ...f.rows.filter(r => r.standing.owed > 0).slice(0, 3).map(r => r.record.name)].filter(Boolean).join(' · ')}</div>
  </Card>
}
