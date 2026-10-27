import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { CIRC, BIO, addAssessment, addAssessmentPhoto, assessmentDraft, assessmentPhotos, assessmentsOf, compareAssessments, foldSites, normalizeAssessment, removeAssessment, removeAssessmentPhoto, resultsOf } from '../lib/assessment.js'
import { POSES, BW_PHOTOS_MAX } from '../lib/bodyweight-photos.js'
import { fmtDate, fmtNum, todayISO } from '../lib/format.js'
import { dateLocale } from '../lib/i18n-core.js'
import { t } from '../lib/i18n.js'
import { syncMedia } from '../lib/media-sync.js'
import Icon from '../components/Icon.jsx'
import LineChart from '../components/LineChart.jsx'
import { useMediaPicker } from '../components/CustomMediaField.jsx'
import { CustomThumb, MediaView } from '../components/CustomMedia.jsx'
import { POSE_LABEL, poseText } from '../components/WeighInPhotos.jsx'
import { Button, NumberField, Row, Section, Segmented, SelectRow } from '../components/ui.jsx'
import { confirmSheet } from '../sheets.jsx'

// The Personal module, phase 8: a student's physical assessment (lib/assessment.js) — skinfolds
// by Jackson & Pollock (3 or 7 sites, body fat by Siri), circumferences, a bioimpedance scale's
// readings, flexibility on Wells' bench and photos by pose — compared with an earlier one. Kept
// in the trainer's own profile, beside the student's record.

const ui = () => useUI.getState()
const toast = m => ui().toast(m)
const update = fn => useStore.getState().update(fn)

export const FOLD_LABEL = { chest: 'Chest', midaxillary: 'Midaxillary', triceps: 'Triceps', subscapular: 'Subscapular', abdomen: 'Abdominal', suprailiac: 'Suprailiac', thigh: 'Thigh' }
export const CIRC_LABEL = {
  neck: 'Neck', shoulders: 'Shoulders', chest: 'Chest', waist: 'Waist', abdomen: 'Abdomen', hips: 'Hips',
  armR: 'Right arm, relaxed', armL: 'Left arm, relaxed', armFlexR: 'Right arm, flexed', armFlexL: 'Left arm, flexed',
  forearmR: 'Right forearm', forearmL: 'Left forearm', thighR: 'Right thigh', thighL: 'Left thigh', calfR: 'Right calf', calfL: 'Left calf'
}
export const BIO_LABEL = { fat: 'Body fat', muscle: 'Muscle mass', water: 'Body water', visceral: 'Visceral fat', bmr: 'Basal metabolic rate' }
const BIO_UNIT = { fat: '%', muscle: 'kg', water: '%', visceral: '', bmr: 'kcal' }
const RESULT_LABEL = { weight: 'Body weight', fat: 'Body fat', fatMass: 'Fat mass', leanMass: 'Lean mass', bmi: 'BMI', whr: 'Waist-to-hip ratio', sum: 'Sum of skinfolds' }
const RESULT_UNIT = { weight: 'kg', fat: '%', fatMass: 'kg', leanMass: 'kg', bmi: '', whr: '', sum: 'mm' }
const BMI_LABEL = { under: 'Underweight', normal: 'Normal weight', over: 'Overweight', obese1: 'Obesity I', obese2: 'Obesity II', obese3: 'Obesity III' }
const GROUP_LABEL = { result: 'Results', circ: 'Circumferences (cm)', bio: 'Bioimpedance', flex: 'Flexibility', folds: 'Skinfolds (mm)' }
const PROTOCOL_LABEL = { p3: 'Pollock 3 sites', p7: 'Pollock 7 sites' }

const labelOf = (group, key) => t(group === 'result' ? RESULT_LABEL[key] : group === 'circ' ? CIRC_LABEL[key] : group === 'bio' ? BIO_LABEL[key] : group === 'folds' ? FOLD_LABEL[key] : 'Sit and reach')
const unitOf = (group, key) => (group === 'result' ? RESULT_UNIT[key] : group === 'circ' || group === 'flex' ? 'cm' : group === 'bio' ? BIO_UNIT[key] : 'mm')
const withUnit = (v, u) => (v == null ? '–' : `${fmtNum(v)}${u ? (u === '%' ? '%' : ' ' + u) : ''}`)
const ratio = v => (v == null ? '–' : v.toLocaleString(dateLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
const signed = (v, u, fmt = withUnit) => (v == null ? '' : v === 0 ? '=' : `${v > 0 ? '+' : '−'}${fmt(Math.abs(v), u)}`)

/** Whether the server keeps an assessment's photos (`media.assessments` in /api/config). */
const serverTakesAssessmentMedia = (user, config) => !user || !config || !config.media || !!config.media.assessments

function AssessmentForm({ record, prev, close, onSaved }) {
  const S = useStore(s => s.S)
  const [f, setF] = useState(() => prev ? structuredClone(prev) : assessmentDraft(record, assessmentsOf(S, record.id).at(-1), todayISO()))
  const set = patch => setF(x => ({ ...x, ...patch }))
  const setIn = (group, key, v) => setF(x => ({ ...x, [group]: { ...(x[group] || {}), [key]: v } }))
  const sites = foldSites(f.protocol, f.sex)
  const r = resultsOf(normalizeAssessment({ ...f, recordId: record.id, d: f.d || todayISO() }))
  const save = () => {
    const a = normalizeAssessment({ ...f, recordId: record.id }, { prev })
    if (a.error) { toast(t('Pick the day of the assessment')); return }
    update(s => { s.assessments = addAssessment(s.assessments, a) })
    close(); onSaved?.(a)
  }
  const num = (group, key, label, unit) => <label className="rec-field" key={group + key}><span className="small dim">{label}{unit ? ` (${unit})` : ''}</span>
    <NumberField className="field" nullable value={group ? f[group]?.[key] ?? null : f[key] ?? null} onChange={v => (group ? setIn(group, key, v) : set({ [key]: v }))} aria-label={label} /></label>
  return <>
    <h3>{prev ? t('Edit assessment') : t('New assessment')}</h3>
    <div className="small dim" style={{ marginTop: -6, marginBottom: 12 }}>{record.name}</div>
    <label className="rec-field"><span className="small dim">{t('Day')}</span><input className="input" type="date" value={f.d || ''} onChange={e => set({ d: e.target.value })} /></label>
    <div className="rec-field"><span className="small dim">{t('Sex')}</span>
      <Segmented value={f.sex || 'none'} onChange={v => set({ sex: v === 'none' ? null : v })} options={[{ value: 'none', label: '–' }, { value: 'f', label: t('Female') }, { value: 'm', label: t('Male') }]} /></div>
    <div className="asm-grid">
      {num(null, 'age', t('Age'), t('years'))}
      {num(null, 'weight', t('Body weight'), 'kg')}
      {num(null, 'height', t('Height'), 'cm')}
    </div>

    <div className="asm-h">{t('Skinfolds')}</div>
    <Segmented value={f.protocol || 'none'} onChange={v => set({ protocol: v === 'none' ? null : v })}
      options={[{ value: 'none', label: '–' }, { value: 'p3', label: t('3 sites') }, { value: 'p7', label: t('7 sites') }]} />
    {f.protocol === 'p3' && !f.sex && <div className="small dim asm-note">{t('Pick the sex: Pollock 3 measures different sites for men and women.')}</div>}
    {sites.length > 0 && <div className="asm-grid" style={{ marginTop: 10 }}>{sites.map(k => num('folds', k, t(FOLD_LABEL[k]), 'mm'))}</div>}

    <div className="asm-h">{t('Circumferences')}</div>
    <div className="asm-grid">{CIRC.map(k => num('circ', k, t(CIRC_LABEL[k]), 'cm'))}</div>

    <div className="asm-h">{t('Bioimpedance')}</div>
    <div className="asm-grid">{BIO.map(k => num('bio', k, t(BIO_LABEL[k]), BIO_UNIT[k]))}</div>

    <div className="asm-h">{t('Flexibility')}</div>
    <div className="asm-grid">{num('flex', 'sitReach', t('Sit and reach'), 'cm')}</div>

    <label className="rec-field"><span className="small dim">{t('Notes')}</span>
      <textarea className="input" rows={2} maxLength={1000} value={f.note || ''} onChange={e => set({ note: e.target.value })} /></label>

    {(r.fat != null || r.bmi != null) && <div className="card small asm-live">
      {r.fat != null && <div><b>{t('Body fat')}: {withUnit(r.fat, '%')}</b> <span className="dim">· {r.fatSource === 'folds' ? t(PROTOCOL_LABEL[f.protocol]) : t('Bioimpedance')}</span></div>}
      {r.bmi != null && <div>{t('BMI')}: {fmtNum(r.bmi)} <span className="dim">· {t(BMI_LABEL[r.bmiClass])}</span></div>}
    </div>}
    <div style={{ height: 12 }} />
    <Button variant="primary" onClick={save}>{t('Save')}</Button>
  </>
}
/** The form of an assessment of `record`: a new one, or `prev` to change. */
export const assessmentFormSheet = (record, prev, onSaved) => ui().openSheet(close => <AssessmentForm record={record} prev={prev} close={close} onSaved={onSaved} />)

/** A student's record: their assessments, the body fat over time, and the way to a new one. */
export function RecordAssessments({ record }) {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const list = assessmentsOf(S, record.id)
  const fats = list.map(a => ({ a, r: resultsOf(a) })).filter(x => x.r.fat != null)
  const points = fats.map(x => ({ t: new Date(x.a.d + 'T12:00:00').getTime(), y: x.r.fat, d: x.a.d }))
  return <Section title={t('Physical assessments')}>
    {points.length >= 2 && <div className="asm-chart"><div className="small dim">{t('Body fat')}</div><LineChart points={points} h={90} unit="%" /></div>}
    {[...list].reverse().slice(0, 8).map(a => {
      const r = resultsOf(a)
      return <Row key={a.id} title={fmtDate(a.d, true)} accessory="chevron" onClick={() => nav('/assessment/' + a.id)}
        subtitle={[r.fat != null ? `${t('Body fat')} ${withUnit(r.fat, '%')}` : null, a.weight ? withUnit(a.weight, 'kg') : null, r.bmi != null ? `${t('BMI')} ${fmtNum(r.bmi)}` : null, assessmentPhotos(a).length ? t('{0} photos', assessmentPhotos(a).length) : null].filter(Boolean).join(' · ') || t('No readings')} />
    })}
    <Row title={<span className="accent">{t('New assessment')}</span>} onClick={() => assessmentFormSheet(record, null, a => nav('/assessment/' + a.id))} />
  </Section>
}

function Photos({ a, before }) {
  const user = useStore(s => s.user)
  const config = useStore(s => s.config)
  const { pick, busy, warning, storable, showAdd: pickerShowsAdd, canAdd: pickerCanAdd } = useMediaPicker()
  const fileRef = useRef(null)
  const poseRef = useRef('front')
  const photos = assessmentPhotos(a)
  const showAdd = pickerShowsAdd && serverTakesAssessmentMedia(user, config) && storable
  const canAdd = pickerCanAdd && showAdd && photos.length < BW_PHOTOS_MAX
  const onFile = async ev => {
    const file = ev.target.files && ev.target.files[0]
    ev.target.value = ''
    if (!file) return
    const got = await pick(file)
    if (!got) return
    let res
    update(s => { res = addAssessmentPhoto(s, a.id, got, poseRef.current) })
    if (res === 'added') { toast(t('Photo added')); syncMedia({ force: true }) }
    else if (res === 'full') toast(t('Up to {0} photos per assessment.', BW_PHOTOS_MAX))
    else if (res === 'invalid') toast(t('Only photos can be kept with an assessment.'))
  }
  const old = before ? assessmentPhotos(before) : []
  if (!photos.length && !showAdd) return null
  const pairs = POSES.map(pose => ({ pose, now: photos.find(p => p.pose === pose), then: old.find(p => p.pose === pose) })).filter(x => x.now && x.then)
  return <Section title={t('Photos')}>
    <div className="wmedia" style={{ padding: '10px 12px 4px' }}>
      {photos.length > 0 && <div className="wmedia-grid" style={{ marginBottom: 10 }}>
        {photos.map(p => <button key={p.m.hash} type="button" className="wmedia-item" aria-label={poseText(p.pose)} onClick={() => photoViewer(a.id, p.m.hash)}>
          <CustomThumb ex={{ custom: true, media: p.m }} />
          {p.pose && <span className="bwp-pose">{poseText(p.pose)}</span>}
        </button>)}
      </div>}
      {showAdd && photos.length < BW_PHOTOS_MAX && <div className="row" style={{ gap: 8 }}>
        {POSES.map(pose => <Button key={pose} size="sm" variant="tinted" icon={busy ? 'image' : 'camera'} disabled={!canAdd} style={{ flex: 1 }}
          onClick={() => { poseRef.current = pose; fileRef.current?.click() }}>{t(POSE_LABEL[pose])}</Button>)}
      </div>}
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={onFile} />
      {showAdd && !photos.length && <div className="small dim wmedia-note">{t('Same spot, same light, same distance each time: the photos line up best when only the body changed.')}</div>}
      {warning && <div className="small dim wmedia-note">{warning}</div>}
      {pairs.map(x => <div key={x.pose} className="asm-pair">
        <div className="small dim asm-pair-h">{poseText(x.pose)}: {fmtDate(before.d, true)} → {fmtDate(a.d, true)}</div>
        <div className="asm-pair-row">
          <div className="asm-pair-img"><MediaView m={x.then.m} still /></div>
          <div className="asm-pair-img"><MediaView m={x.now.m} still /></div>
        </div>
      </div>)}
    </div>
  </Section>
}

function PhotoViewer({ id, hash, close }) {
  const a = useStore(s => (s.S.assessments || []).find(x => x && x.id === id))
  const photos = a ? assessmentPhotos(a) : []
  const [cur, setCur] = useState(hash)
  const at = Math.max(0, photos.findIndex(p => p.m.hash === cur))
  const p = photos[at] || null
  useEffect(() => { if (!p) close() }, [!p])
  if (!p) return null
  const remove = () => confirmSheet({ title: t('Remove this photo?'), confirmText: t('Remove'), danger: true, onConfirm: () => update(s => { removeAssessmentPhoto(s, id, p.m.hash) }) })
  return <div className="mviewer" role="dialog" aria-modal="true" aria-label={t('Photos')}>
    <div className="mviewer-bar">
      <button type="button" className="iconbtn" aria-label={t('Close')} onClick={close}><Icon name="xmark" /></button>
      <span className="mviewer-count">{poseText(p.pose)} · {fmtDate(a.d, true)}</span>
      <button type="button" className="iconbtn" aria-label={t('Remove')} onClick={remove}><Icon name="trash" /></button>
    </div>
    <div className="mviewer-stage"><MediaView key={p.m.hash} m={p.m} cls="exmedia viewer" /></div>
    {photos.length > 1 && <div className="mviewer-nav">
      <button type="button" className="iconbtn" aria-label={t('Previous')} onClick={() => setCur(photos[(at - 1 + photos.length) % photos.length].m.hash)}><Icon name="chevronLeft" /></button>
      <button type="button" className="iconbtn" aria-label={t('Next')} onClick={() => setCur(photos[(at + 1) % photos.length].m.hash)}><Icon name="chevronRight" /></button>
    </div>}
  </div>
}
const photoViewer = (id, hash) => ui().openSheet(close => <PhotoViewer id={id} hash={hash} close={close} />, { kind: 'viewer' })

/** One assessment (#/assessment/:id): what it works out to, against an earlier one, and its photos. */
export default function AssessmentView() {
  const nav = useNavigate()
  const { id } = useParams()
  const S = useStore(s => s.S)
  const a = (S.assessments || []).find(x => x && x.id === id) || null
  const record = a ? (S.students || []).find(r => r && r.id === a.recordId) : null
  const earlier = a ? assessmentsOf(S, a.recordId).filter(x => x.id !== a.id && (x.d < a.d || (x.d === a.d && (x.created || 0) < (a.created || 0)))) : []
  const [vsId, setVsId] = useState(null)
  const before = earlier.find(x => x.id === vsId) || earlier.at(-1) || null
  useEffect(() => { if (!a) nav('/students', { replace: true }) }, [!a])
  if (!a) return null
  const r = resultsOf(a)
  const rows = compareAssessments(a, before)
  const groups = ['result', 'circ', 'bio', 'flex', 'folds'].map(g => [g, rows.filter(x => x.group === g)]).filter(([, xs]) => xs.length)
  const remove = () => confirmSheet({ title: t('Delete this assessment?'), message: t('Its readings and photos go.'), confirmText: t('Delete'), danger: true,
    onConfirm: () => { update(s => { s.assessments = removeAssessment(s.assessments, a.id) }); nav(-1) } })
  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav(-1)} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 10 }}><h1>{t('Assessment')}</h1><div className="sub">{[record?.name, fmtDate(a.d, true, true)].filter(Boolean).join(' · ')}</div></div>
      {record && <button className="iconbtn" onClick={() => assessmentFormSheet(record, a)} aria-label={t('Edit assessment')}><Icon name="pencil" /></button>}
    </div>
    <div className="tiles">
      <div className="tile"><div className="l">{t('Body fat')}</div><div className="v">{withUnit(r.fat, '%')}</div><div className="small dim">{r.fatSource === 'folds' ? t(PROTOCOL_LABEL[a.protocol]) : r.fatSource === 'bio' ? t('Bioimpedance') : ''}</div></div>
      <div className="tile"><div className="l">{t('Body weight')}</div><div className="v">{withUnit(a.weight, 'kg')}</div>{r.fatMass != null && <div className="small dim">{t('{0} fat · {1} lean', withUnit(r.fatMass, 'kg'), withUnit(r.leanMass, 'kg'))}</div>}</div>
      <div className="tile"><div className="l">{t('BMI')}</div><div className="v">{r.bmi != null ? fmtNum(r.bmi) : '–'}</div>{r.bmiClass && <div className="small dim">{t(BMI_LABEL[r.bmiClass])}</div>}</div>
      <div className="tile"><div className="l">{t('Waist-to-hip ratio')}</div><div className={'v' + (r.whrHigh ? ' fin-danger' : '')}>{ratio(r.whr ?? null)}</div>{r.whrHigh != null && <div className="small dim">{r.whrHigh ? t('High risk') : t('Low risk')}</div>}</div>
    </div>
    {earlier.length > 0 && <Section>
      <SelectRow title={t('Compared with')} value={before.id} onChange={setVsId} sheetTitle={t('Compare with')}
        options={[...earlier].reverse().map(x => ({ value: x.id, label: fmtDate(x.d, true) }))} />
    </Section>}
    {groups.map(([g, xs]) => <Section key={g} title={t(GROUP_LABEL[g])}>
      {xs.map(x => <Row key={x.key} title={labelOf(g, x.key)} value={<span className="asm-val">
        <b>{x.key === 'whr' ? ratio(x.now) : withUnit(x.now, unitOf(g, x.key))}</b>{before && x.delta != null && <span className="small dim"> {signed(x.delta, unitOf(g, x.key), x.key === 'whr' ? ratio : withUnit)}</span>}
      </span>} />)}
    </Section>)}
    <Photos a={a} before={before} />
    {a.note && <div className="card small rec-notes"><b>{t('Notes')}</b><p>{a.note}</p></div>}
    <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
      {record && <Button icon="pencil" onClick={() => assessmentFormSheet(record, a)}>{t('Edit assessment')}</Button>}
      <Button variant="ghost" className="danger" onClick={remove}>{t('Delete')}</Button>
    </div>
    <div className="small dim" style={{ marginTop: 10 }}>{t('Body fat from skinfolds by Jackson & Pollock with Siri’s equation; it is an estimate, like a scale’s.')}</div>
  </div>
}
