import { useEffect, useState } from 'react'
import { useUI } from '../store/useUI.js'
import { api } from '../lib/api.js'
import { dropCoach, readOutbox, sendCoachOutbox } from '../lib/trainer-session.js'
import { fmtDate, exCount } from '../lib/format.js'
import { t, tn } from '../lib/i18n.js'
import { glyphOf } from '../lib/glyphs.js'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'
import { beginCoachWorkout, confirmSheet } from '../sheets.jsx'

// The Personal module, phase 6: "Train now" — the trainer picks one of the student's routines and
// runs it on their own phone (sheets.jsx beginCoachWorkout); the finish sends it to the student
// (lib/trainer-session.js). And the workouts that have not reached a student yet, under Students.

const ui = () => useUI.getState()
const toast = m => ui().toast(m)

// The student's account behind a record of the agenda: its studentId, or the link the invite made.
async function studentOfRecord(recordId) {
  const { students } = await api('/api/trainer/students')
  return (students || []).find(l => l.ref === recordId)?.student?.id || null
}

function TrainNow({ studentId, recordId, cls, close }) {
  const [d, setD] = useState(null)
  useEffect(() => {
    let live = true
    ;(async () => {
      const id = studentId || (recordId ? await studentOfRecord(recordId) : null)
      if (!id) throw new Error(t('This student has no account linked yet: send them the invite first.'))
      return api('/api/trainer/student?id=' + encodeURIComponent(id))
    })().then(x => live && setD(x)).catch(e => live && setD({ error: e.message }))
    return () => { live = false }
  }, [])
  if (!d) return <><h3>{t('Train now')}</h3><div className="muted small">{t('Loading…')}</div></>
  if (d.error) return <><h3>{t('Train now')}</h3><div className="card muted small">{d.error}</div><Button variant="ghost" className="dim" onClick={close}>{t('Close')}</Button></>
  const routines = (d.training?.routines || []).filter(r => r && Array.isArray(r.ex))
  const today = String(new Date().getDay())
  const planned = new Set([].concat(d.training?.week?.[today] || []))
  const go = routine => { close(); beginCoachWorkout({ student: d.student, training: d.training, routine, recordId: recordId || d.link?.ref || null, cls }) }
  return <>
    <h3>{t('Train {0} now', d.student.name)}</h3>
    <div className="muted small" style={{ marginBottom: 10 }}>{t('Run it on your phone, with the clock and rest timer. When you finish, the workout goes to {0}’s history, not yours.', d.student.name)}</div>
    <div className="list">
      {[...routines].sort((a, b) => planned.has(b.id) - planned.has(a.id)).map(r => <button key={r.id} className="item" disabled={!r.ex.length} onClick={() => go(r)}>
        <span className="lrow-i"><Icon name={glyphOf(r.emoji)} /></span>
        <div className="grow"><div className="tt">{r.name}</div><div className="ss">{exCount(r.ex.length)}</div></div>
        {planned.has(r.id) && <span className="tag">{t('today')}</span>}
        <Icon name="chevronRight" className="chev" />
      </button>)}
      <button className="item" onClick={() => go(null)}>
        <span className="lrow-i"><Icon name="plus" /></span>
        <div className="grow"><div className="tt">{t('Freestyle')}</div><div className="ss">{t('Add the exercises as you go')}</div></div>
        <Icon name="chevronRight" className="chev" />
      </button>
    </div>
  </>
}
/** The routine picker of "Train now": `studentId` (a link's student) or the agenda's `recordId`. */
export const trainNowSheet = ({ studentId = null, recordId = null, cls = null } = {}) =>
  ui().openSheet(close => <TrainNow studentId={studentId} recordId={recordId} cls={cls} close={close} />)

/** The workouts finished with students that have not reached them yet, with a retry. */
export function CoachOutbox() {
  const [items, setItems] = useState(() => readOutbox())
  const [busy, setBusy] = useState(false)
  const retry = async () => {
    setBusy(true)
    const r = await sendCoachOutbox().catch(() => null)
    setBusy(false); setItems(readOutbox())
    if (r?.sent) toast(tn('{0} workout sent', '{0} workouts sent', r.sent))
    else if (r && r.left) toast(t('Still no connection to the server.'))
  }
  useEffect(() => { if (items.length) retry() }, [])
  if (!items.length) return null
  return <div className="card" style={{ marginBottom: 12 }}>
    <div className="row between"><b>{tn('{0} workout waiting to be sent', '{0} workouts waiting to be sent', items.length)}</b>
      <Button variant="plain" onClick={retry} disabled={busy}>{t('Try again')}</Button></div>
    {items.map(it => <div key={it.workout.id} className="row between small" style={{ marginTop: 6 }}>
      <span className="grow">{it.name} · {it.workout.name} · {fmtDate(it.workout.d, true)}{it.error ? <span className="danger"> · {it.error}</span> : null}</span>
      {it.error && <button className="iconbtn" aria-label={t('Discard')} onClick={() => confirmSheet({ title: t('Discard this workout?'), message: t('It never reached the student, and it goes from this phone too.'), confirmText: t('Discard'), danger: true,
        onConfirm: () => { dropCoach(it.workout.id); setItems(readOutbox()) } })}><Icon name="trash" /></button>}
    </div>)}
  </div>
}
