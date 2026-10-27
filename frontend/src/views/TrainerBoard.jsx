import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { api, apiBlob } from '../lib/api.js'
import { getLang, t, tn } from '../lib/i18n.js'
import { DAYN, fmtDate, todayISO } from '../lib/format.js'
import { mediaStore } from '../lib/media-store.js'
import { limitsFrom } from '../lib/media-limits.js'
import { addTask, dueCount, normalizeTask, removeTask, taskGroups, toggleTask } from '../lib/tasks.js'
import { groupsOf, normalizeNotice, noticesNewest, reachedBy } from '../lib/notices.js'
import { DOC_KINDS, addDocument, documentsOf, normalizeDocument, removeDocument } from '../lib/trainer-docs.js'
import { DRAFT_GOALS, DRAFT_LEVELS, draftForStudent, draftIntake } from '../lib/trainer-draft.js'
import Icon from '../components/Icon.jsx'
import { useMediaUrl } from '../components/CustomMedia.jsx'
import { mediaErrorText } from '../components/CustomMediaField.jsx'
import { Button, NumberField, Row, Section, Segmented, Switch } from '../components/ui.jsx'
import { confirmSheet } from '../sheets.jsx'
import { myTrainersSheet } from './Trainer.jsx'

// The Personal module, phase 9: what is left of a trainer's day besides classes and money — their
// to-do list (lib/tasks.js), notices to students (lib/notices.js), documents of each student
// (lib/trainer-docs.js) and a first draft of a student's plan by AI (lib/trainer-draft.js,
// api/trainer-ai.js). And the student's side: the notices and documents meant for them.

const ui = () => useUI.getState()
const toast = m => ui().toast(m)
const update = fn => useStore.getState().update(fn)
const liveRecords = S => (S?.students || []).filter(r => r && r.status !== 'ended')
const namesOf = S => Object.fromEntries((S?.students || []).filter(Boolean).map(r => [r.id, r.name]))
const ago = ms => fmtDate(new Date(ms - new Date(ms).getTimezoneOffset() * 60000).toISOString().slice(0, 10), true)

/* ---------------------------------------------------------------- home */

// A trainer's way in, always on Today (and on Home when Today is off): a new trainer has no class,
// task or debt yet, so no other card of theirs shows, and the module looked absent.
export function TrainerCard({ S, nav }) {
  const due = dueCount(S.tasks, todayISO())
  const n = liveRecords(S).length
  const go = [['/students', 'star', 'Students'], ['/agenda', 'calendar', 'Agenda'], ['/tasks', 'checkCircle', 'Tasks'], ['/notices', 'bell', 'Notices'], ['/finance', 'chart', 'Finances']]
  return <div className="card today-card">
    <div className="row between today-head"><span className="today-title">{t('Personal trainer')}</span><span className="small dim">{tn('{0} student', '{0} students', n)}</span></div>
    <div className="trainer-links">{go.map(([to, icon, label]) => <button key={to} className="trainer-link" onClick={() => nav(to)}>
      <Icon name={icon} /><span>{t(label)}</span>{to === '/tasks' && due > 0 && <span className="tag warn">{due}</span>}
    </button>)}</div>
  </div>
}

/* ---------------------------------------------------------------- tasks */

function TaskForm({ prev, recordId, close }) {
  const S = useStore(s => s.S)
  const records = liveRecords(S)
  const [f, setF] = useState(() => ({ title: '', due: todayISO(), recordId: recordId || '', note: '', ...(prev || {}) }))
  const set = patch => setF(x => ({ ...x, ...patch }))
  const save = () => {
    const task = normalizeTask({ ...f, recordId: f.recordId || null }, { prev })
    if (task.error) { toast(t('Type what there is to do')); return }
    update(s => { s.tasks = addTask(s.tasks, task) })
    toast(prev ? t('Task changed') : t('Task added'))
    close()
  }
  return <>
    <h3>{prev ? t('Edit task') : t('New task')}</h3>
    <input className="input" autoFocus={!prev} maxLength={140} value={f.title} onChange={e => set({ title: e.target.value })} placeholder={t('Call Marília about the package')} aria-label={t('Task')} />
    <div className="rec-pay" style={{ marginTop: 10 }}>
      <label className="rec-field"><span className="small dim">{t('Due')}</span><input className="input" type="date" value={f.due || ''} onChange={e => set({ due: e.target.value || null })} /></label>
      <label className="rec-field"><span className="small dim">{t('Student')}</span>
        <select className="input" value={f.recordId || ''} onChange={e => set({ recordId: e.target.value })}>
          <option value="">{t('None')}</option>
          {records.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select></label>
    </div>
    <label className="rec-field"><span className="small dim">{t('Note')}</span><textarea className="input" rows={2} maxLength={1000} value={f.note} onChange={e => set({ note: e.target.value })} /></label>
    <div style={{ height: 10 }} />
    <Button variant="primary" icon="check" onClick={save}>{prev ? t('Save') : t('Add task')}</Button>
    {prev && <><div style={{ height: 8 }} /><Button variant="ghost" className="danger" onClick={() => confirmSheet({ title: t('Delete this task?'), confirmText: t('Delete'), danger: true,
      onConfirm: () => { update(s => { s.tasks = removeTask(s.tasks, prev.id) }); close() } })}>{t('Delete task')}</Button></>}
  </>
}
/** The task form: a new one (about `recordId`, when given), or `prev` to change or delete. */
export const taskSheet = ({ prev = null, recordId = null } = {}) => ui().openSheet(close => <TaskForm prev={prev} recordId={recordId} close={close} />)

function TaskRow({ task, names, today }) {
  const late = !task.done && task.due && task.due < today
  const sub = [task.due ? (task.due === today ? t('Today') : fmtDate(task.due, true)) : null, task.recordId ? names[task.recordId] : null, task.note].filter(Boolean).join(' · ')
  return <div className={'task-row' + (task.done ? ' done' : '')}>
    <button className={'task-check' + (task.done ? ' on' : '')} onClick={() => update(s => { s.tasks = toggleTask(s.tasks, task.id) })}
      aria-label={task.done ? t('Open again') : t('Mark done')} aria-pressed={!!task.done}>{task.done && <Icon name="check" />}</button>
    <button className="task-body" onClick={() => taskSheet({ prev: task })}>
      <div className="tt">{task.title}</div>
      {sub && <div className={'ss' + (late ? ' fin-danger' : '')}>{sub}</div>}
    </button>
  </div>
}

/** The trainer's to-do list: overdue, today, upcoming, some day, and what was done lately. */
export function TasksView() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const today = todayISO()
  const g = taskGroups(S.tasks, today)
  const names = namesOf(S)
  const [showDone, setShowDone] = useState(false)
  const open = g.overdue.length + g.today.length + g.upcoming.length + g.someday.length
  const group = (title, list, tone) => list.length > 0 && <Section title={<span className={tone}>{title}</span>}>{list.map(x => <TaskRow key={x.id} task={x} names={names} today={today} />)}</Section>
  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav(-1)} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 10 }}><h1>{t('Tasks')}</h1><div className="sub">{open ? tn('{0} to do', '{0} to do', open) : t('Nothing to do')}</div></div>
      <button className="iconbtn" onClick={() => taskSheet()} aria-label={t('New task')}><Icon name="plus" /></button>
    </div>
    {group(t('Overdue'), g.overdue, 'fin-danger')}
    {group(t('Today'), g.today)}
    {group(t('Upcoming'), g.upcoming)}
    {group(t('Some day'), g.someday)}
    {!open && <div className="card muted small">{t('Write down what you must not forget: a call, a plan to send, a contract to renew.')}
      <div style={{ height: 10 }} /><Button variant="primary" icon="plus" onClick={() => taskSheet()}>{t('New task')}</Button></div>}
    {g.done.length > 0 && (showDone ? group(t('Done'), g.done)
      : <button className="linkbtn" style={{ margin: '4px 2px' }} onClick={() => setShowDone(true)}>{tn('Show {0} done', 'Show {0} done', g.done.length)}</button>)}
  </div>
}

/** Today, for a trainer: the tasks due by today, each a tap from done. None due, no card. */
export function TasksCard({ S, nav, Card }) {
  const today = todayISO()
  if (!dueCount(S.tasks, today)) return null
  const g = taskGroups(S.tasks, today)
  const names = namesOf(S)
  const due = [...g.overdue, ...g.today]
  return <Card title={t('Tasks')} tone={g.overdue.length ? 'today-alert' : undefined} action={<button className="linkbtn" onClick={() => nav('/tasks')}>{t('All')}</button>}>
    {due.slice(0, 4).map(x => <TaskRow key={x.id} task={x} names={names} today={today} />)}
    {due.length > 4 && <div className="small dim">{t('and {0} more', due.length - 4)}</div>}
  </Card>
}

/** A student's open tasks, in their record. */
export function RecordTasks({ record }) {
  const tasks = useStore(s => s.S.tasks)
  const today = todayISO()
  const g = taskGroups(tasks, today, { recordId: record.id })
  const open = [...g.overdue, ...g.today, ...g.upcoming, ...g.someday]
  return <Section title={t('Tasks')}>
    {open.map(x => <TaskRow key={x.id} task={x} names={{}} today={today} />)}
    <Row title={<span className="accent">{t('New task')}</span>} onClick={() => taskSheet({ recordId: record.id })} />
  </Section>
}

/* ---------------------------------------------------------------- notices */

const audienceText = (n, names) => (n.to?.kind === 'all' ? t('All students') : n.to?.kind === 'group' ? t('Group {0}', n.to.group) : names[n.to?.recordId] || t('Student'))
// Rings the students' phones (POST /api/trainer/notify); those without an account read nothing.
const notify = (kind, title, records) => {
  const students = records.map(r => r.studentId).filter(Boolean)
  return students.length ? api('/api/trainer/notify', { method: 'POST', body: JSON.stringify({ kind, title, students }) }).then(r => r.sent || 0) : Promise.resolve(0)
}

function NoticeForm({ close, initial }) {
  const S = useStore(s => s.S)
  const records = liveRecords(S)
  const groups = groupsOf(records)
  const [f, setF] = useState(() => ({ title: '', body: '', kind: 'all', group: groups[0] || '', recordId: records[0]?.id || '', ...(initial || {}) }))
  const [busy, setBusy] = useState(false)
  const set = patch => setF(x => ({ ...x, ...patch }))
  const to = { kind: f.kind, group: f.group, recordId: f.recordId }
  const reach = f.kind === 'group' && !f.group ? [] : reachedBy(records, { to })
  const send = async () => {
    const n = normalizeNotice({ title: f.title, body: f.body, to })
    if (n.error) { toast(n.error === 'title' ? t('Type a title') : t('Choose who it is for')); return }
    setBusy(true)
    let sent = 0
    try { sent = await notify('notice', n.title, reachedBy(records, n)) } catch { /* saved anyway: the students read it in the app */ }
    update(s => { s.notices = [...(s.notices || []), { ...n, sent }] })
    toast(sent ? tn('Sent to {0} student', 'Sent to {0} students', sent) : t('Saved. Students read it in the app.'))
    setBusy(false)
    close()
  }
  return <>
    <h3>{t('New notice')}</h3>
    <input className="input" autoFocus maxLength={100} value={f.title} onChange={e => set({ title: e.target.value })} placeholder={t('No classes on Friday, it is a holiday')} aria-label={t('Title')} />
    <div style={{ height: 8 }} />
    <textarea className="input" rows={4} maxLength={2000} value={f.body} onChange={e => set({ body: e.target.value })} placeholder={t('Details (optional)')} aria-label={t('Details')} />
    <div className="small dim" style={{ margin: '10px 2px 6px' }}>{t('For')}</div>
    <Segmented value={f.kind} onChange={kind => set({ kind })} options={[{ value: 'all', label: t('Everyone') }, ...(groups.length ? [{ value: 'group', label: t('A group') }] : []), { value: 'student', label: t('One student') }]} />
    {f.kind === 'group' && <select className="input" style={{ marginTop: 8 }} value={f.group} onChange={e => set({ group: e.target.value })} aria-label={t('Group')}>{groups.map(g => <option key={g} value={g}>{g}</option>)}</select>}
    {f.kind === 'student' && <select className="input" style={{ marginTop: 8 }} value={f.recordId} onChange={e => set({ recordId: e.target.value })} aria-label={t('Student')}>{records.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select>}
    <div className="small dim" style={{ margin: '8px 2px' }}>{reach.length ? t('{0} of {1} have the app and get a notification.', reach.filter(r => r.studentId).length, reach.length) : t('Nobody in this group yet.')}</div>
    <Button variant="primary" icon="bell" disabled={busy || !f.title.trim() || !reach.length} onClick={send}>{busy ? t('Sending…') : t('Send notice')}</Button>
  </>
}
/** The form for a new notice; `initial` presets who it is for. */
export const noticeSheet = initial => ui().openSheet(close => <NoticeForm close={close} initial={initial} />)

function NoticeSheet({ n, names, close }) {
  return <>
    <h3>{n.title}</h3>
    <div className="muted small" style={{ marginBottom: 10 }}>{[ago(n.at), audienceText(n, names), n.sent ? tn('notified {0}', 'notified {0}', n.sent) : null].filter(Boolean).join(' · ')}</div>
    {n.body && <div className="notice-body">{n.body}</div>}
    <div style={{ height: 12 }} />
    <Button variant="ghost" className="danger" onClick={() => confirmSheet({ title: t('Delete this notice?'), message: t('Students no longer see it in the app.'), confirmText: t('Delete'), danger: true,
      onConfirm: () => { update(s => { s.notices = (s.notices || []).filter(x => x?.id !== n.id) }); close() } })}>{t('Delete notice')}</Button>
  </>
}

/** The notices a trainer sent, newest first, and a new one. */
export function NoticesView() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const list = noticesNewest(S)
  const names = namesOf(S)
  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav(-1)} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 10 }}><h1>{t('Notices')}</h1><div className="sub">{t('To every student, a group, or one')}</div></div>
      <button className="iconbtn" onClick={() => noticeSheet()} aria-label={t('New notice')}><Icon name="plus" /></button>
    </div>
    {list.length ? <Section footer={t('Students see the notices of the last 60 days in My personal trainer. A group is set in each student’s record.')}>
      {list.map(n => <Row key={n.id} icon="bell" iconTint="var(--orange)" title={n.title} subtitle={[ago(n.at), audienceText(n, names)].join(' · ')} accessory="chevron"
        onClick={() => ui().openSheet(close => <NoticeSheet n={n} names={names} close={close} />)} />)}
    </Section> : <div className="card muted small">{t('A holiday, a change of hours, a word to the morning group: write it once and every student it is for gets a notification.')}
      <div style={{ height: 10 }} /><Button variant="primary" icon="plus" onClick={() => noticeSheet()}>{t('New notice')}</Button></div>}
  </div>
}

/* ---------------------------------------------------------------- documents */

// Written out, so check-source-strings sees every key.
const DOC_LABEL = { contract: () => t('Contract'), diet: () => t('Diet'), certificate: () => t('Medical certificate'), other: () => t('Document') }
const docLabel = kind => (DOC_LABEL[kind] || DOC_LABEL.other)()
const docTitle = d => d.title || docLabel(d.kind)

/** A document's file: a PDF opened in a new tab, a photo shown and opened the same way. */
function DocFile({ m }) {
  const { url, status, load } = useMediaUrl(m, { auto: m.kind !== 'doc' })
  const open = () => { if (url) window.open(url, '_blank', 'noopener'); else load() }
  return m.kind === 'doc'
    ? <button className="exam-doc" onClick={open}><Icon name="doc" /><span>{status === 'loading' ? t('Loading…') : t('Open PDF')}</span></button>
    : <button className="exam-photo" onClick={open}>{url ? <img src={url} alt="" /> : <Icon name="image" />}</button>
}

function DocForm({ record, prev, close }) {
  const config = useStore(s => s.config)
  const [f, setF] = useState(() => ({ kind: 'contract', title: '', d: todayISO(), m: null, shared: false, note: '', ...(prev || {}) }))
  const [busy, setBusy] = useState(false)
  const set = patch => setF(x => ({ ...x, ...patch }))
  const onFile = async ev => {
    const file = ev.target.files?.[0]
    ev.target.value = ''
    if (!file) return
    setBusy(true)
    try {
      const { ingestMediaFile } = await import('../lib/media-ingest.js')
      const out = await ingestMediaFile(file, limitsFrom(config), {}, { docs: true })
      if (out.media.kind !== 'doc' && out.media.kind !== 'image') { toast(t('Use a PDF or a photo.')); return }
      for (const b of out.blobs) await mediaStore.put(b.hash, b.blob, { mime: b.mime, pending: true })
      set({ m: out.media })
    } catch (e) { toast(e?.code === 'type' ? t('Use a PDF or a photo.') : mediaErrorText(e)) } finally { setBusy(false) }
  }
  const save = () => {
    const doc = normalizeDocument({ ...f, recordId: record.id }, { prev, today: todayISO() })
    if (doc.error) { toast(t('Attach the file: a PDF or a photo')); return }
    update(s => { s.documents = addDocument(s.documents, doc) })
    if (doc.shared && !prev?.shared && record.studentId) notify('document', docTitle(doc), [record]).catch(() => {})
    toast(prev ? t('Document saved') : t('Document added'))
    close()
  }
  const serverKeeps = !useStore.getState().user || !!config?.media?.documents
  return <>
    <h3>{prev ? docTitle(prev) : t('New document')}</h3>
    <Segmented value={f.kind} onChange={kind => set({ kind })} options={DOC_KINDS.map(k => ({ value: k, label: k === 'certificate' ? t('Certificate') : docLabel(k) }))} />
    <div className="rec-pay" style={{ marginTop: 10 }}>
      <label className="rec-field"><span className="small dim">{t('Title')}</span><input className="input" maxLength={100} value={f.title} onChange={e => set({ title: e.target.value })} placeholder={docLabel(f.kind)} /></label>
      <label className="rec-field"><span className="small dim">{t('Date')}</span><input className="input" type="date" value={f.d || ''} onChange={e => set({ d: e.target.value })} /></label>
    </div>
    <div className="exam-files" style={{ margin: '10px 0' }}>
      {f.m && <div className="exam-file"><DocFile m={f.m} /></div>}
      {serverKeeps ? <label className="btn plain" style={{ cursor: 'pointer' }}><Icon name="plus" /> {busy ? t('Loading…') : f.m ? t('Replace file') : t('Attach PDF or photo')}
        <input type="file" accept="application/pdf,image/*" hidden onChange={onFile} disabled={busy} /></label>
        : <div className="small dim">{t('This server does not keep documents yet.')}</div>}
    </div>
    <Row title={t('Share with the student')} subtitle={record.studentId ? t('They see it and can open it in their app') : t('When they join with the invite')}>
      <Switch checked={!!f.shared} onChange={v => set({ shared: v })} aria-label={t('Share with the student')} /></Row>
    <label className="rec-field"><span className="small dim">{t('Note')}</span><input className="input" maxLength={500} value={f.note} onChange={e => set({ note: e.target.value })} /></label>
    <div style={{ height: 10 }} />
    <Button variant="primary" icon="check" disabled={busy || !f.m} onClick={save}>{t('Save')}</Button>
    {prev && <><div style={{ height: 8 }} /><Button variant="ghost" className="danger" onClick={() => confirmSheet({ title: t('Delete this document?'), message: prev.shared ? t('The student no longer sees it either.') : undefined, confirmText: t('Delete'), danger: true,
      onConfirm: () => { update(s => { s.documents = removeDocument(s.documents, prev.id) }); close() } })}>{t('Delete document')}</Button></>}
  </>
}
const docSheet = (record, prev = null) => ui().openSheet(close => <DocForm record={record} prev={prev} close={close} />)

/** A student's documents, in their record: contract, diet, certificate, each shared or not. */
export function RecordDocuments({ record }) {
  const S = useStore(s => s.S)
  const docs = documentsOf(S, record.id)
  return <Section title={t('Documents')}>
    {docs.map(d => <Row key={d.id} icon="doc" iconTint={d.shared ? 'var(--teal)' : 'var(--indigo)'} title={docTitle(d)}
      subtitle={[d.d ? fmtDate(d.d, true) : null, docLabel(d.kind), d.shared ? t('shared') : null].filter(Boolean).join(' · ')} accessory="chevron" onClick={() => docSheet(record, d)} />)}
    <Row title={<span className="accent">{t('Add document')}</span>} onClick={() => docSheet(record)} />
  </Section>
}

/* ---------------------------------------------------------------- the AI draft */

const GOAL_LABEL = { strength: () => t('Get stronger'), muscle: () => t('Build muscle'), general: () => t('General fitness'), fatloss: () => t('Lose fat'), endurance: () => t('Endurance') }
const LEVEL_LABEL = { new: () => t('New to lifting'), returning: () => t('Coming back after a break'), regular: () => t('Training regularly') }
function draftError(e) {
  const code = e?.data?.code || e?.code
  if (code === 'timeout') return t('The draft took too long. Try again.')
  if (code === 'locked') return t('Too many drafts in the last hour. Try again later.')
  if (code === 'config') return t('The server\'s AI key was not accepted. Check ANTHROPIC_API_KEY on the server.')
  if (code === 'unusable') return t('The AI answered a plan the app could not use. Try again.')
  return e?.message || t('The draft failed. Try again.')
}

function DraftForm({ studentId, record, Ss, nameOf, onSent, close }) {
  const [f, setF] = useState({ goal: 'general', experience: Ss.workouts?.length > 10 ? 'regular' : 'new', preferredDays: [1, 3, 5], sessionMin: 60, notes: '' })
  const [busy, setBusy] = useState('')
  const [plan, setPlan] = useState(null)
  const [schedule, setSchedule] = useState(true)
  const set = patch => setF(x => ({ ...x, ...patch }))
  const toggleDay = d => set({ preferredDays: f.preferredDays.includes(d) ? f.preferredDays.filter(x => x !== d) : [...f.preferredDays, d] })
  const ask = async () => {
    setBusy('draft')
    try {
      const r = await api('/api/trainer/student/draft', { method: 'POST', body: JSON.stringify({ id: studentId, intake: draftIntake(record, { ...f, daysPerWeek: f.preferredDays.length }), lang: getLang() }), timeout: 150000 })
      setPlan(r.plan)
    } catch (e) { toast(draftError(e)) } finally { setBusy('') }
  }
  const send = async () => {
    setBusy('send')
    try {
      await api('/api/trainer/student/plan', { method: 'PUT', body: JSON.stringify({ id: studentId, ...draftForStudent(plan, Ss.unit, { schedule }) }) })
      toast(t('Saved to the student’s plan'))
      onSent(); close()
    } catch (e) { toast(e.message) } finally { setBusy('') }
  }
  if (plan) return <>
    <h3>{plan.name || t('Draft plan')}</h3>
    {plan.summary && <div className="small" style={{ marginBottom: 10 }}>{plan.summary}</div>}
    {plan.routines.map(r => {
      const days = Object.entries(plan.week || {}).filter(([, v]) => [].concat(v).includes(r.id)).map(([d]) => t(DAYN[d]).slice(0, 3)).join(', ')
      return <div key={r.id} className="card student-routine">
        <div className="row between"><b>{r.name}</b>{days && <span className="small dim">{days}</span>}</div>
        {r.why && <div className="small dim">{r.why}</div>}
        {r.ex.map((x, i) => <div key={i} className="row between small"><span>{nameOf(x.id)}</span><span className="dim">{x.mode === 'time' ? `${x.sets} × ${x.sec}s` : x.mode === 'cardio' ? `${x.min} min` : `${x.sets} × ${x.repsMin && x.repsMin < x.reps ? x.repsMin + '–' : ''}${x.reps}`}</span></div>)}
      </div>
    })}
    <Row title={t('Put it on the days of the week')} subtitle={t('The student’s current days are replaced')}><Switch checked={schedule} onChange={setSchedule} aria-label={t('Put it on the days of the week')} /></Row>
    <div className="small dim" style={{ margin: '6px 2px 10px' }}>{t('The routines are added beside the student’s own; edit or take out any of them in the Plan tab afterwards.')}</div>
    <Button variant="primary" icon="check" disabled={!!busy} onClick={send}>{busy === 'send' ? t('Sending…') : t('Send to the student’s plan')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="plain" icon="reset" disabled={!!busy} onClick={() => setPlan(null)}>{t('Change the answers')}</Button>
  </>
  return <>
    <h3>{t('Draft a plan with AI')}</h3>
    <div className="muted small" style={{ marginBottom: 10 }}>{t('From the record and the student’s workouts. You check the draft before anything reaches them.')}</div>
    <div className="small dim" style={{ margin: '0 2px 6px' }}>{t('Goal')}</div>
    <div className="chips" style={{ flexWrap: 'wrap', marginBottom: 10 }}>{DRAFT_GOALS.map(g => <button key={g} className={'chip nocap' + (f.goal === g ? ' on' : '')} onClick={() => set({ goal: g })}>{GOAL_LABEL[g]()}</button>)}</div>
    <div className="small dim" style={{ margin: '0 2px 6px' }}>{t('Experience')}</div>
    <div className="chips" style={{ flexWrap: 'wrap', marginBottom: 10 }}>{DRAFT_LEVELS.map(l => <button key={l} className={'chip nocap' + (f.experience === l ? ' on' : '')} onClick={() => set({ experience: l })}>{LEVEL_LABEL[l]()}</button>)}</div>
    <div className="small dim" style={{ margin: '0 2px 6px' }}>{tn('Training days ({0})', 'Training days ({0})', f.preferredDays.length)}</div>
    <div className="chips" style={{ flexWrap: 'wrap', marginBottom: 10 }}>{[1, 2, 3, 4, 5, 6, 0].map(d => <button key={d} className={'chip nocap' + (f.preferredDays.includes(d) ? ' on' : '')} onClick={() => toggleDay(d)}>{t(DAYN[d]).slice(0, 3)}</button>)}</div>
    <label className="rec-field"><span className="small dim">{t('Minutes per session')}</span><NumberField className="field" decimal={false} value={f.sessionMin} onChange={v => set({ sessionMin: v })} aria-label={t('Minutes per session')} /></label>
    {record?.restrictions && <div className="card small" style={{ margin: '10px 0' }}><b>{t('Restrictions')}:</b> {record.restrictions}</div>}
    <label className="rec-field"><span className="small dim">{t('Anything else for the AI')}</span><textarea className="input" rows={2} maxLength={400} value={f.notes} onChange={e => set({ notes: e.target.value })} placeholder={t('Full gym, wants to focus on the legs…')} /></label>
    <div style={{ height: 10 }} />
    <Button variant="primary" icon="sparkles" disabled={!!busy || !f.preferredDays.length} onClick={ask}>{busy === 'draft' ? t('Drafting… this can take a minute') : t('Draft the plan')}</Button>
  </>
}
/** The AI draft of a linked student's plan, from their PlanTab. */
export const draftSheet = props => ui().openSheet(close => <DraftForm {...props} close={close} />)

/* ---------------------------------------------------------------- the student's side */

function useBoard() {
  const [board, setBoard] = useState(null)
  useEffect(() => { let on = true; api('/api/trainer/mine/board').then(r => on && setBoard(r)).catch(() => on && setBoard({ notices: [], documents: [] })); return () => { on = false } }, [])
  return board
}

// A shared document opened from the trainer's folder (GET /api/trainer/mine/document).
async function openShared(d) {
  try {
    const blob = await apiBlob(`/api/trainer/mine/document?link=${encodeURIComponent(d.link)}&id=${encodeURIComponent(d.id)}`, { expectSize: d.size })
    const url = URL.createObjectURL(new Blob([blob], { type: d.mime }))
    window.open(url, '_blank', 'noopener')
    setTimeout(() => URL.revokeObjectURL(url), 60000)
  } catch (e) { toast(e.message) }
}

/** My personal trainer, for a student: notices, documents shared with them, next classes, the link. */
export function MyTrainerView() {
  const nav = useNavigate()
  const board = useBoard()
  const [classes, setClasses] = useState([])
  useEffect(() => { api('/api/trainer/mine/classes').then(r => setClasses((r.classes || []).filter(c => c.status === 'scheduled'))).catch(() => {}) }, [])
  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav(-1)} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 10 }}><h1>{t('My personal trainer')}</h1><div className="sub">{t('Notices, documents and classes')}</div></div>
    </div>
    {board === null ? <div className="muted small">{t('Loading…')}</div> : <>
      {classes.length > 0 && <Section title={t('Your next classes')}>{classes.slice(0, 5).map((c, i) => <Row key={i} icon="calendar" iconTint="var(--teal)" title={`${fmtDate(c.d, true)} · ${c.time}`} subtitle={t('with {0}', c.trainer)} />)}</Section>}
      <Section title={t('Notices')} footer={board.notices.length ? undefined : t('No notices from your trainer.')}>
        {board.notices.map(n => <div key={n.id} className="notice-item"><div className="row between"><b>{n.title}</b><span className="small dim">{ago(n.at)}</span></div>
          {n.body && <div className="notice-body small">{n.body}</div>}<div className="small dim">{n.trainer}</div></div>)}
      </Section>
      <Section title={t('Documents')} footer={board.documents.length ? undefined : t('Your trainer has not shared a document with you.')}>
        {board.documents.map(d => <Row key={d.link + d.id} icon="doc" iconTint="var(--indigo)" title={d.title || docLabel(d.kind)}
          subtitle={[d.d ? fmtDate(d.d, true) : null, d.trainer].filter(Boolean).join(' · ')} accessory="chevron" onClick={() => openShared(d)} />)}
      </Section>
    </>}
    <Section><Row icon="link" iconTint="var(--teal)" title={t('Link with my trainer')} subtitle={t('What you share, a new code, ending it')} accessory="chevron" onClick={() => myTrainersSheet()} /></Section>
  </div>
}

/** Today, for a student: their trainer's notices of the last week. None, no card. */
export function StudentNoticesCard({ Card, nav }) {
  const board = useBoard()
  const week = (board?.notices || []).filter(n => n.at > Date.now() - 7 * 86400000)
  if (!week.length) return null
  return <Card title={t('From your trainer')} onClick={() => nav('/my-trainer')}>
    {week.slice(0, 2).map(n => <div key={n.id} style={{ padding: '2px 0' }}><b className="small">{n.title}</b>{n.body && <div className="small dim notice-clip">{n.body}</div>}</div>)}
  </Card>
}
