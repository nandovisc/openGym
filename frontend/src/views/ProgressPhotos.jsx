// Every progress photo in one place, newest first — the ones kept with a weigh-in (front, side or
// back, WeighInPhotos.jsx) and the ones kept with a logged workout (WorkoutMedia.jsx) — a quick
// way to add one to today, and a before/after between any two: side by side or with a slider,
// with each day's weight and how much it moved.
//
// Nothing is stored here. A weigh-in's photos live on the weigh-in (lib/bodyweight-photos.js) and
// a workout's on the workout (lib/workout-media.js); both are files the media system already
// keeps, private to the account the same way everything else there is (DATA_DIR/uploads/<uid>/,
// api/media.js). What this view adds is lining every still up chronologically, a filter by pose,
// and the comparison.
import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t, tn } from '../lib/i18n.js'
import { fmtDate, fmtNum, todayISO } from '../lib/format.js'
import { workoutMediaOf, WORKOUT_MEDIA_MAX } from '../lib/media-refs.js'
import { addWorkoutMedia } from '../lib/workout-media.js'
import { bwPhotosOf, compareSummary, POSES } from '../lib/bodyweight-photos.js'
import { bwTime } from '../lib/bodyweight.js'
import { syncMedia } from '../lib/media-sync.js'
import { useMediaPicker } from '../components/CustomMediaField.jsx'
import { CustomThumb, MediaView, useMediaUrl } from '../components/CustomMedia.jsx'
import { weighInSheet, openBwPhotoViewer, poseText, POSE_LABEL } from '../components/WeighInPhotos.jsx'
import { bwSheet } from '../sheets.jsx'
import { Button, Segmented } from '../components/ui.jsx'
import Icon from '../components/Icon.jsx'

const toast = m => useUI.getState().toast(m)

/** Today's own logged workout, the latest one if there is more than one — where "Add to today's
 *  workout" attaches to, same as opening that workout and using WorkoutMedia.jsx there directly. */
export function todaysWorkout(S) {
  const today = (S.workouts || []).filter(w => w.d === todayISO())
  if (!today.length) return null
  return today.reduce((a, b) => (b.start || 0) > (a.start || 0) ? b : a)
}

/**
 * Every still photo (no video — the comparison wants two stills, not two clips) of every weigh-in
 * and every logged workout, newest first. Each entry carries its date, its pose (a weigh-in's;
 * null for a workout's) and where it came from (`bw`: the weigh-in's day, or `w`: the workout), so
 * the grid and the comparator can say when a photo was taken without re-deriving it.
 */
export function progressPhotosOf(S) {
  const out = []
  for (const w of (S && S.workouts) || []) {
    for (const m of workoutMediaOf(w)) {
      if (m.kind === 'video') continue
      // `key`: the same file can sit on two workouts (one hash), and each is its own photo here.
      out.push({ key: (w.id || w.start || w.d) + ':' + m.hash, d: w.d, start: w.start || 0, w, pose: null, m })
    }
  }
  for (const b of (S && S.bodyweight) || []) {
    if (!b || !b.d) continue
    for (const p of bwPhotosOf(b)) out.push({ key: 'bw:' + b.d + ':' + p.m.hash, d: b.d, start: bwTime(b), bw: b.d, pose: p.pose, m: p.m })
  }
  out.sort((a, b) => (a.d < b.d ? 1 : a.d > b.d ? -1 : b.start - a.start))
  return out
}

/** Runs an already-sorted progressPhotosOf() list into { d, items }[] groups of the same date. */
export function groupByDate(photos) {
  const out = []
  for (const p of photos) {
    const last = out[out.length - 1]
    if (last && last.d === p.d) last.items.push(p)
    else out.push({ d: p.d, items: [p] })
  }
  return out
}

/** Whole days between two ISO dates, always ≥ 0 regardless of which comes first. */
export function daysBetween(a, b) {
  const ms = new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')
  return Math.abs(Math.round(ms / 86400000))
}

function openPhotoView(p) {
  if (p.bw) { openBwPhotoViewer(p.bw, p.m.hash); return }
  useUI.getState().openSheet(close => (
    <div className="mviewer" role="dialog" aria-modal="true" aria-label={t('Photo')}>
      <div className="mviewer-bar">
        <button type="button" className="iconbtn" aria-label={t('Close')} onClick={close}><Icon name="xmark" /></button>
        <span className="mviewer-count">{fmtDate(p.d, true, true)}</span>
        <span style={{ width: 36 }} />
      </div>
      <div className="mviewer-stage"><MediaView m={p.m} cls="exmedia viewer" /></div>
    </div>
  ), { kind: 'viewer' })
}

// Toward the goal reads as progress, away from it as a warning; with no goal, no judgement.
function deltaColor(sum, goal) {
  if (!sum.delta || !(goal > 0)) return 'inherit'
  return (sum.delta > 0) === (goal > sum.wFrom) ? 'var(--acc)' : 'var(--red)'
}

/** The before/after between two progress photos `a` (earlier) and `b` (later). */
function ProgressCompare({ a, b, close }) {
  const S = useStore(s => s.S)
  const before = useMediaUrl(a.m)
  const after = useMediaUrl(b.m)
  const [mode, setMode] = useState('slide')
  const [pct, setPct] = useState(50)
  const stageRef = useRef(null)
  const dragging = useRef(false)

  const setFromClientX = x => {
    const el = stageRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    if (!rect.width) return
    setPct(Math.max(0, Math.min(100, ((x - rect.left) / rect.width) * 100)))
  }
  const onPointerDown = e => { dragging.current = true; e.currentTarget.setPointerCapture?.(e.pointerId); setFromClientX(e.clientX) }
  const onPointerMove = e => { if (dragging.current) setFromClientX(e.clientX) }
  const endDrag = () => { dragging.current = false }

  const sum = compareSummary(S, a.d, b.d)
  const unit = S.unit
  const wText = w => (w != null ? `${fmtNum(w)} ${unit}` : '–')

  return <div className="mviewer" role="dialog" aria-modal="true" aria-label={t('Compare photos')}>
    <div className="mviewer-bar">
      <button type="button" className="iconbtn" aria-label={t('Close')} onClick={close}><Icon name="xmark" /></button>
      <span className="mviewer-count">{sum.days > 0 ? tn('{0} day apart', '{0} days apart', sum.days) : t('Same day')}</span>
      <span style={{ width: 36 }} />
    </div>
    {/* A photo has no reading direction: before stays on the left and the finger drives the
        handle the same way in Arabic, so the stage is ltr like DurationWheel's wheel. */}
    {mode === 'slide'
      ? <div className="pp-compare" dir="ltr" ref={stageRef} data-swipe-ignore
          onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag}>
          {after.url && <img className="pp-img" src={after.url} alt="" draggable={false} />}
          {before.url && <img className="pp-img" src={before.url} alt="" draggable={false}
            style={{ clipPath: `inset(0 ${100 - pct}% 0 0)` }} />}
          <div className="pp-handle" style={{ insetInlineStart: pct + '%' }}><div className="pp-grip" /></div>
          <div className="pp-label pp-label-before">{fmtDate(a.d, true)}</div>
          <div className="pp-label pp-label-after">{fmtDate(b.d, true)}</div>
        </div>
      : <div className="pp-side" dir="ltr">
          <div>{before.url && <img className="pp-img" src={before.url} alt={fmtDate(a.d, true)} draggable={false} />}</div>
          <div>{after.url && <img className="pp-img" src={after.url} alt={fmtDate(b.d, true)} draggable={false} />}</div>
        </div>}
    <div className="pp-sum" dir="ltr">
      <div><div className="pp-sum-d">{fmtDate(a.d, true)}</div><div className="pp-sum-w">{wText(sum.wFrom)}</div></div>
      <div className="pp-sum-mid">
        <div className="pp-sum-w" style={{ color: deltaColor(sum, S.targetW) }}>
          {sum.delta == null ? '–' : `${sum.delta > 0 ? '+' : sum.delta < 0 ? '−' : ''}${fmtNum(Math.abs(sum.delta))} ${unit}`}
        </div>
        <div className="pp-sum-d">{t('Difference')}</div>
      </div>
      <div style={{ textAlign: 'end' }}><div className="pp-sum-d">{fmtDate(b.d, true)}</div><div className="pp-sum-w">{wText(sum.wTo)}</div></div>
    </div>
    <div className="pp-tools">
      <Segmented value={mode} onChange={setMode}
        options={[{ value: 'slide', label: t('Slider') }, { value: 'side', label: t('Side by side') }]} />
    </div>
  </div>
}

/** Opens the before/after between two progressPhotosOf() entries, in date order either way. */
export function openProgressCompare(x, y) {
  const [a, b] = x.d <= y.d ? [x, y] : [y, x]
  useUI.getState().openSheet(close => <ProgressCompare a={a} b={b} close={close} />, { kind: 'viewer' })
}

export default function ProgressPhotos() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const all = useMemo(() => progressPhotosOf(S), [S.workouts, S.bodyweight])
  const [pose, setPose] = useState('all')
  const photos = useMemo(() => (pose === 'all' ? all : all.filter(p => p.pose === pose)), [all, pose])
  const groups = useMemo(() => groupByDate(photos), [photos])
  const posed = all.some(p => p.pose)
  const [comparing, setComparing] = useState(false)
  const [picked, setPicked] = useState([])   // up to 2 photo keys, in tap order
  const todayW = todaysWorkout(S)
  const todayIso = todayISO()
  const weighedToday = (S.bodyweight || []).some(b => b && b.d === todayIso)
  const { pick, busy, canAdd, showAdd } = useMediaPicker()
  const fileRef = useRef(null)

  const toggle = p => setPicked(cur => {
    if (cur.includes(p.key)) return cur.filter(k => k !== p.key)
    return cur.length >= 2 ? [cur[1], p.key] : [...cur, p.key]
  })
  const cancelCompare = () => { setComparing(false); setPicked([]) }
  const runCompare = () => {
    if (picked.length !== 2) return
    const [ha, hb] = picked
    const a = all.find(p => p.key === ha)
    const b = all.find(p => p.key === hb)
    cancelCompare()
    if (a && b) openProgressCompare(a, b)
  }
  // A photo with today's weigh-in, front, side or back: straight to the weigh-in's sheet, or
  // through logging today's weight first — a weigh-in photo is the one a before/after can put a
  // number on.
  const addToWeighIn = () => {
    if (weighedToday) weighInSheet(todayIso)
    else bwSheet({ onDone: n => { if (n) weighInSheet(todayIso) } })
  }
  // Attaches straight onto today's already-logged workout — the file picker offers the camera
  // on a phone the same way WorkoutMedia.jsx's does, since it is the very same input.
  const onFile = async ev => {
    const file = ev.target.files && ev.target.files[0]
    ev.target.value = ''
    if (!file || !todayW) return
    if (workoutMediaOf(todayW).length >= WORKOUT_MEDIA_MAX) { toast(t('Up to {0} photos or videos per workout.', WORKOUT_MEDIA_MAX)); return }
    const got = await pick(file)
    if (!got) return
    let res
    update(s => { res = addWorkoutMedia(s, todayW, got) })
    if (res === 'added') { toast(t('Photo added')); syncMedia({ force: true }) }
    else if (res === 'full') toast(t('Up to {0} photos or videos per workout.', WORKOUT_MEDIA_MAX))
    else if (res === 'gone') toast(t('Workout deleted'))
  }

  return <>
    <div className="hdr"><button className="iconbtn" onClick={() => (window.history.length > 1 ? nav(-1) : nav('/stats'))} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginInlineStart: 12 }}><h1>{t('Progress photos')}</h1>
        <div className="sub">{tn('{0} photo', '{0} photos', all.length)}</div></div>
      {all.length >= 2 && (comparing
        ? <Button size="sm" variant="ghost" onClick={cancelCompare}>{t('Cancel')}</Button>
        : <Button size="sm" variant="tinted" onClick={() => setComparing(true)}>{t('Compare')}</Button>)}
    </div>

    {!comparing && showAdd && <div className="row" style={{ marginBottom: 16, gap: 8, flexWrap: 'wrap' }}>
      <Button icon="camera" onClick={addToWeighIn}>{weighedToday ? t('Add a photo to today’s weigh-in') : t('Weigh in and add a photo')}</Button>
      {todayW && <Button variant="ghost" icon={busy ? 'image' : 'dumbbell'} disabled={!canAdd} onClick={() => fileRef.current?.click()}>
        {busy ? t('Loading…') : t('Add to today’s workout')}
      </Button>}
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={onFile} />
    </div>}

    {posed && <div style={{ marginBottom: 14 }}>
      <Segmented value={pose} onChange={v => { setPose(v); setPicked([]) }}
        options={[{ value: 'all', label: t('All') }, ...POSES.map(x => ({ value: x, label: t(POSE_LABEL[x]) }))]} />
    </div>}

    {comparing && <div className="small dim" style={{ margin: '0 0 12px' }}>
      {picked.length < 2 ? t('Pick two photos to compare.') : t('Ready! Open the comparison.')}
    </div>}

    {!all.length
      ? <div className="empty"><div className="ico"><Icon name="image" /></div>
          {t('No progress photos yet. Add one to a weigh-in — front, side or back — and compare them here as the weeks go by.')}
        </div>
      : !photos.length
        ? <div className="empty small">{t('No photos with this pose yet.')}</div>
        : groups.map(g => (
          <div key={g.d} style={{ marginBottom: 18 }}>
            <div className="small muted" style={{ marginBottom: 6 }}>{fmtDate(g.d, true, true)}</div>
            <div className="wmedia-grid">
              {g.items.map(p => {
                const selected = picked.includes(p.key)
                return (
                  <button key={p.key} type="button" data-swipe-ignore
                    className={'wmedia-item' + (selected ? ' pp-selected' : '')}
                    aria-label={fmtDate(p.d, true) + (p.pose ? ' · ' + poseText(p.pose) : '')}
                    onClick={() => (comparing ? toggle(p) : openPhotoView(p))}>
                    <CustomThumb ex={{ custom: true, media: p.m }} />
                    {p.pose && <span className="bwp-pose">{poseText(p.pose)}</span>}
                    {selected && <span className="pp-check"><Icon name="check" /></span>}
                  </button>
                )
              })}
            </div>
          </div>
        ))}

    {comparing && picked.length === 2 && <div className="pp-cta">
      <Button variant="primary" onClick={runCompare}>{t('Compare')}</Button>
    </div>}
  </>
}
