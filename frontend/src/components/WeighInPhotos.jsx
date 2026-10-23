// The progress photos of a weigh-in — front, side or back — in the weigh-in's own sheet, and the
// full-screen viewer they open in (where one is removed or given another pose).
//
// The same machinery as a workout's photos (WorkoutMedia.jsx): a pick runs through the same
// ingest and lands in the local store as pending (useMediaPicker), the list is written to the
// weigh-in through lib/bodyweight-photos.js (stamped, so the sync keeps the copy edited last), and
// the same sync uploads it. They are the owner's own: no Coach payload, MCP tool or admin view
// reads `photos`; only the zip backup carries the files.
import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { fmtDate, fmtNum } from '../lib/format.js'
import { closeThenNav } from '../lib/nav.js'
import { addBwPhoto, removeBwPhoto, setBwPhotoPose, bwPhotosOf, POSES, BW_PHOTOS_MAX } from '../lib/bodyweight-photos.js'
import { syncMedia } from '../lib/media-sync.js'
import { useMediaPicker } from './CustomMediaField.jsx'
import { CustomThumb, MediaView } from './CustomMedia.jsx'
import { Button, Segmented } from './ui.jsx'
import Icon from './Icon.jsx'

const toast = m => useUI.getState().toast(m)

export const POSE_LABEL = { front: 'Front view', side: 'Side view', back: 'Back view' }
export const poseText = pose => (pose ? t(POSE_LABEL[pose]) : t('No pose'))

/**
 * Whether a weigh-in may be offered an Add, beside the picker's own reasons: the server has to
 * say it keeps a weigh-in's files (`media.bodyweight` in /api/config), or its GC would sweep a
 * file only a weigh-in names. Unknown (offline start), a guest and a local phone are fine.
 */
export const serverTakesBodyweightMedia = (user, config) => !user || !config || !config.media || !!config.media.bodyweight

// The weigh-in of day `d` as the store holds it now.
const useEntry = d => useStore(s => (s.S.bodyweight || []).find(x => x && x.d === d) || null)

/** The photos of the weigh-in of day `d`, with one Add button per pose. */
export function WeighInPhotos({ d }) {
  const entry = useEntry(d)
  const update = useStore(s => s.update)
  const user = useStore(s => s.user)
  const config = useStore(s => s.config)
  const { pick, busy, warning, note, storable, showAdd: pickerShowsAdd, canAdd: pickerCanAdd } = useMediaPicker()
  const fileRef = useRef(null)
  const poseRef = useRef('front')
  if (!entry) return null
  const photos = bwPhotosOf(entry)
  const showAdd = pickerShowsAdd && serverTakesBodyweightMedia(user, config) && storable
  const canAdd = pickerCanAdd && showAdd && photos.length < BW_PHOTOS_MAX

  const addAs = pose => { poseRef.current = pose; fileRef.current?.click() }
  const onFile = async ev => {
    const file = ev.target.files && ev.target.files[0]
    ev.target.value = ''   // picking the same file again still fires onChange
    if (!file) return
    const got = await pick(file)
    if (!got) return
    let res
    update(s => { res = addBwPhoto(s, d, got, poseRef.current) })
    if (res === 'added') { toast(t('Photo added')); syncMedia({ force: true }) }
    else if (res === 'full') toast(t('Up to {0} photos per weigh-in.', BW_PHOTOS_MAX))
    else if (res === 'invalid') toast(t('Only photos can be kept with a weigh-in.'))
    else if (res === 'gone') toast(t('Weigh-in deleted'))
  }

  return <div className="wmedia">
    <div className="small muted wmedia-h">{t('Progress photos')}</div>
    {photos.length > 0 && <div className="wmedia-grid" style={{ marginBottom: 10 }}>
      {photos.map(p => (
        <button key={p.m.hash} type="button" className="wmedia-item" data-swipe-ignore
          aria-label={poseText(p.pose)} onClick={() => openBwPhotoViewer(d, p.m.hash)}>
          <CustomThumb ex={{ custom: true, media: p.m }} />
          {p.pose && <span className="bwp-pose">{poseText(p.pose)}</span>}
        </button>
      ))}
    </div>}
    {showAdd && photos.length < BW_PHOTOS_MAX && <div className="row" style={{ gap: 8 }}>
      {POSES.map(pose => (
        <Button key={pose} size="sm" variant="tinted" icon={busy ? 'image' : 'camera'} disabled={!canAdd} style={{ flex: 1 }}
          onClick={() => addAs(pose)}>{t(POSE_LABEL[pose])}</Button>
      ))}
    </div>}
    <input ref={fileRef} type="file" accept="image/*" hidden onChange={onFile} />
    {showAdd && !photos.length && <div className="small dim wmedia-note">{t('Same spot, same light, same distance: the photos line up best when only you changed.')}</div>}
    {photos.length >= BW_PHOTOS_MAX && <div className="small dim wmedia-note">{t('Up to {0} photos per weigh-in.', BW_PHOTOS_MAX)}</div>}
    {warning && <div className="small dim wmedia-note">{warning}</div>}
    {note && photos.length > 0 && <div className="small dim wmedia-note">{note}</div>}
  </div>
}

/** Opens the full-screen viewer on the photo `hash` of the weigh-in of day `d`. */
export function openBwPhotoViewer(d, hash) {
  useUI.getState().openSheet(close => <BwPhotoViewer d={d} hash={hash} close={close} />, { kind: 'viewer' })
}

function BwPhotoViewer({ d, hash, close }) {
  const entry = useEntry(d)
  const update = useStore(s => s.update)
  const photos = bwPhotosOf(entry)
  const [cur, setCur] = useState(hash)
  const [asking, setAsking] = useState(false)
  const box = useRef(null)
  const at = Math.max(0, photos.findIndex(p => p.m.hash === cur))
  const p = photos[at] || null
  // The last one removed here, or the weigh-in deleted on another device: nothing left to show.
  useEffect(() => { if (!p) close() }, [!p])
  useEffect(() => {
    const before = document.activeElement
    box.current?.querySelector('button')?.focus()
    return () => { if (before && typeof before.focus === 'function' && before.isConnected) before.focus() }
  }, [])
  if (!p) return null
  const go = step => { setAsking(false); setCur(photos[(at + step + photos.length) % photos.length].m.hash) }
  const remove = () => {
    const next = photos[at + 1] || photos[at - 1]
    update(s => { removeBwPhoto(s, d, p.m.hash) })
    setAsking(false)
    if (next) setCur(next.m.hash)
  }
  return <div className="mviewer" role="dialog" aria-modal="true" aria-label={t('Progress photos')} ref={box} tabIndex={-1}>
    <div className="mviewer-bar">
      <button type="button" className="iconbtn" aria-label={t('Close')} onClick={close}><Icon name="xmark" /></button>
      <span className="mviewer-count">{fmtDate(d, true)}</span>
      <button type="button" className="iconbtn" aria-label={t('Remove')} onClick={() => setAsking(a => !a)}><Icon name="trash" /></button>
    </div>
    <div className="mviewer-stage">
      <MediaView key={p.m.hash} m={p.m} cls="exmedia viewer" />
    </div>
    {asking
      ? <div className="mviewer-ask">
          <div className="mviewer-ask-t">{t('Remove this photo?')}</div>
          <div className="mviewer-ask-b">
            <Button variant="ghost" size="sm" onClick={() => setAsking(false)}>{t('Cancel')}</Button>
            <Button variant="danger" size="sm" onClick={remove}>{t('Remove')}</Button>
          </div>
        </div>
      : <div className="bwp-viewer-pose">
          <Segmented value={p.pose || ''} onChange={v => update(s => { setBwPhotoPose(s, d, p.m.hash, v) })}
            options={POSES.map(x => ({ value: x, label: t(POSE_LABEL[x]) }))} />
        </div>}
    {photos.length > 1 && !asking && <div className="mviewer-nav">
      <button type="button" className="iconbtn" aria-label={t('Previous')} onClick={() => go(-1)}><Icon name="chevronLeft" /></button>
      <button type="button" className="iconbtn" aria-label={t('Next')} onClick={() => go(1)}><Icon name="chevronRight" /></button>
    </div>}
  </div>
}

/** One weigh-in: its weight, its photos, and the way to the before/after. */
function WeighInSheet({ d, close }) {
  const entry = useEntry(d)
  const unit = useStore(s => s.S.unit)
  useEffect(() => { if (!entry) close() }, [!entry])
  if (!entry) return null
  return <>
    <h3 style={{ marginBottom: 2 }}>{fmtDate(d, true, true)}</h3>
    <div style={{ fontSize: '1.6rem', fontWeight: 700, margin: '4px 0 14px' }}>{fmtNum(entry.w)} {unit}</div>
    <WeighInPhotos d={d} />
    <Button variant="ghost" icon="image" trailingIcon="chevronRight" onClick={() => closeThenNav(close, '/progress-photos')}>{t('Compare photos')}</Button>
  </>
}
export const weighInSheet = d => useUI.getState().openSheet(close => <WeighInSheet d={d} close={close} />)
