// A trainer's money (the Personal module, phase 7): what each student pays — a monthly fee, a
// package of classes, or each class — what was received, and what is still owed. Payments are
// written down by hand; nothing here charges anyone. Kept in the trainer's own profile and synced
// like any list of theirs.
//
//   S.payments [{ id, recordId, d, amount, kind, ref, classes, note, created, _ts }]
//     kind: monthly (ref: the month it pays, 'YYYY-MM') | package (classes: how many it buys) |
//       single (classes: how many classes it pays) | other
//   A record's billing (lib/students.js): { kind, amount, dueDay, classes, since } — since, the
//     month the billing started, so a fee set today does not leave a year of months owed.
//   The classes counted against a package or owed one by one are the agenda's classes marked done
//   (S.sessions, lib/agenda.js) from the billing's start.
import { uid } from './format.js'

const list = v => (Array.isArray(v) ? v : [])
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
const MONTH_RE = /^\d{4}-\d{2}$/
export const PAY_KINDS = ['monthly', 'package', 'single', 'other']
const cents = n => Math.round((Number(n) || 0) * 100) / 100

export const monthOf = d => String(d || '').slice(0, 7)
/** The month `n` months after `m` ('YYYY-MM'); n may be negative. */
export function addMonths(m, n) {
  const [y, mo] = m.split('-').map(Number)
  const i = y * 12 + (mo - 1) + n
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`
}
/** The day a monthly fee of `month` falls due. */
export const dueDate = (month, dueDay = 5) => `${month}-${String(Math.min(28, Math.max(1, Number(dueDay) || 5))).padStart(2, '0')}`

/** A payment as stored, from the form; { error } without a student, a day or an amount. */
export function normalizePayment(input, { prev = null, now = Date.now() } = {}) {
  const amount = cents(input?.amount)
  if (!input?.recordId) return { error: 'student' }
  if (!DAY_RE.test(input?.d || '')) return { error: 'day' }
  if (!(amount > 0)) return { error: 'amount' }
  const kind = PAY_KINDS.includes(input?.kind) ? input.kind : 'other'
  return {
    ...(prev || {}),
    id: prev?.id || input?.id || uid(),
    recordId: String(input.recordId),
    d: input.d,
    amount,
    kind,
    ...(kind === 'monthly' ? { ref: MONTH_RE.test(input?.ref || '') ? input.ref : monthOf(input.d) } : {}),
    ...(kind === 'package' || kind === 'single' ? { classes: Math.max(1, Math.round(Number(input?.classes) || 1)) } : {}),
    note: String(input?.note ?? '').replace(/\s+/g, ' ').trim().slice(0, 200),
    created: prev?.created || now
  }
}
export const addPayment = (payments, p) => [...list(payments).filter(x => x?.id !== p.id), p]
export const removePayment = (payments, id) => list(payments).filter(x => x?.id !== id)

const doneClasses = (S, recordId, since) => list(S.sessions).filter(x => x && x.recordId === recordId && x.status === 'done' && (!since || x.d >= since))
const paymentsOf = (S, recordId) => list(S.payments).filter(p => p && p.recordId === recordId)
const billingSince = (rec, today) => {
  const b = rec?.billing || {}
  const start = MONTH_RE.test(b.since || '') ? b.since : monthOf(rec?.start) || monthOf(today)
  return start > monthOf(today) ? monthOf(today) : start
}

/**
 * Where one student's payments stand on `today`:
 *   { kind, state, owed, ... }   state: ok | upcoming | due | overdue | low | none
 *   monthly: months (the months unpaid up to this one, each { month, due, late }), next (the next
 *     due day when all is paid);
 *   package: bought, used, left (classes);
 *   single: classes (done and not yet paid).
 * owed: what to collect now, in money. A record without billing, or whose link ended, is 'none'.
 */
export function standingOf(S, rec, today) {
  const b = rec?.billing
  if (!b?.kind || !(Number(b.amount) > 0) || rec.status === 'ended') return { kind: b?.kind || null, state: 'none', owed: 0 }
  const since = billingSince(rec, today)
  const pays = paymentsOf(S, rec.id)
  if (b.kind === 'monthly') {
    const paid = new Set(pays.filter(p => p.kind === 'monthly').map(p => p.ref))
    const now = monthOf(today)
    const months = []
    for (let m = since, n = 0; m <= now && n < 24; m = addMonths(m, 1), n++) {
      if (paid.has(m)) continue
      const due = dueDate(m, b.dueDay)
      months.push({ month: m, due, late: due < today })
    }
    const late = months.filter(x => x.late)
    let next = dueDate(now, b.dueDay)
    if (paid.has(now) || next < today) next = dueDate(addMonths(now, 1), b.dueDay)
    const state = late.length ? 'overdue' : months.length ? (months[0].due === today ? 'due' : 'upcoming') : 'ok'
    return { kind: 'monthly', state, owed: cents((late.length || (state === 'due' ? 1 : 0)) * b.amount), months, next }
  }
  if (b.kind === 'package') {
    const packs = pays.filter(p => p.kind === 'package')
    const first = packs.map(p => p.d).sort()[0]
    const bought = packs.reduce((a, p) => a + (Number(p.classes) || Number(b.classes) || 0), 0)
    const used = doneClasses(S, rec.id, first || `${since}-01`).length
    const left = bought - used
    const state = !packs.length || left <= 0 ? 'due' : left <= 1 ? 'low' : 'ok'
    return { kind: 'package', state, owed: state === 'due' ? cents(b.amount) : 0, bought, used, left }
  }
  if (b.kind === 'single') {
    const done = doneClasses(S, rec.id, `${since}-01`).length
    const paidClasses = pays.filter(p => p.kind === 'single').reduce((a, p) => a + (Number(p.classes) || 1), 0)
    const classes = Math.max(0, done - paidClasses)
    return { kind: 'single', state: classes ? 'due' : 'ok', owed: cents(classes * b.amount), classes }
  }
  return { kind: b.kind, state: 'none', owed: 0 }
}

/** The payment the form starts from for a student: what their billing and standing ask for. */
export function suggestedPayment(rec, standing, today) {
  const b = rec?.billing || {}
  const base = { recordId: rec?.id, d: today, kind: b.kind || 'other', amount: Number(b.amount) || null }
  if (b.kind === 'monthly') return { ...base, ref: standing?.months?.[0]?.month || monthOf(today) }
  if (b.kind === 'package') return { ...base, classes: b.classes || 8 }
  if (b.kind === 'single') return { ...base, classes: Math.max(1, standing?.classes || 1), amount: cents((Number(b.amount) || 0) * Math.max(1, standing?.classes || 1)) || null }
  return base
}

const RANK = { overdue: 0, due: 1, low: 2, upcoming: 3, ok: 4, none: 5 }
/**
 * Every student's standing, the ones to act on first: [{ record, standing }], plus pending (what
 * to collect now, in money) and late (how many are overdue).
 */
export function financeOf(S, today) {
  const rows = list(S.students).filter(r => r && r.id && r.status !== 'ended' && r.billing?.kind)
    .map(record => ({ record, standing: standingOf(S, record, today) }))
    .sort((a, b) => RANK[a.standing.state] - RANK[b.standing.state] || a.record.name.localeCompare(b.record.name, undefined, { sensitivity: 'base' }))
  return {
    rows,
    pending: cents(rows.reduce((a, r) => a + r.standing.owed, 0)),
    late: rows.filter(r => r.standing.state === 'overdue').length,
    toCollect: rows.filter(r => r.standing.owed > 0).length,
  }
}

/** What came in, month by month, the last `n` months up to `today`'s: [{ month, total, count }]. */
export function revenueByMonth(S, today, n = 6) {
  const out = []
  for (let i = n - 1; i >= 0; i--) {
    const month = addMonths(monthOf(today), -i)
    const ps = list(S.payments).filter(p => p && monthOf(p.d) === month)
    out.push({ month, total: cents(ps.reduce((a, p) => a + (Number(p.amount) || 0), 0)), count: ps.length })
  }
  return out
}

/** The payments of `month`, newest first. */
export const paymentsIn = (S, month) => list(S.payments).filter(p => p && monthOf(p.d) === month)
  .sort((a, b) => (a.d < b.d ? 1 : a.d > b.d ? -1 : (b.created || 0) - (a.created || 0)))

/** What a month should bring: each active monthly fee once, and the classes done there at a class's price. */
export function expectedIn(S, month) {
  let total = 0
  for (const r of list(S.students)) {
    const b = r?.billing
    if (!r || r.status === 'ended' || !b?.kind || !(Number(b.amount) > 0)) continue
    if (b.kind === 'monthly' && (!b.since || b.since <= month)) total += Number(b.amount)
    if (b.kind === 'single') total += doneClasses(S, r.id).filter(x => monthOf(x.d) === month).length * Number(b.amount)
  }
  return cents(total)
}
