import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { FILES_MAX, analytes, examsByDate, fromReading, normalizeExam, outOfRange, seriesOf } from '../lib/exams.js'
import { mediaStore } from '../lib/media-store.js'
import { limitsFrom } from '../lib/media-limits.js'
import { api } from '../lib/api.js'
import { fmtDate, fmtNum, todayISO } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import Icon from '../components/Icon.jsx'
import LineChart from '../components/LineChart.jsx'
import { useMediaUrl } from '../components/CustomMedia.jsx'
import { mediaErrorText } from '../components/CustomMediaField.jsx'
import { Button, Row, Section, Segmented, TextField } from '../components/ui.jsx'
import { confirmSheet } from '../sheets.jsx'

const update = fn => useStore.getState().update(fn)
const ui = () => useUI.getState()
const toast = message => ui().toast(message)

const FLAG = {
  high: { label: 'High', color: 'var(--red)', icon: 'arrowUp' },
  low: { label: 'Low', color: 'var(--orange)', icon: 'arrowDown' },
  abnormal: { label: 'Altered', color: 'var(--red)', icon: 'warning' },
  normal: { label: 'Normal', color: 'var(--green)', icon: 'check' }
}
const shownValue = r => (r.value != null ? fmtNum(r.value) : r.valueText || '–')

// The base64 of a blob, for the reading request.
const base64Of = blob => new Promise((resolve, reject) => {
  const fr = new FileReader()
  fr.onload = () => resolve(String(fr.result).split(',')[1] || '')
  fr.onerror = () => reject(fr.error)
  fr.readAsDataURL(blob)
})

function readError(e) {
  const code = e?.data?.code
  if (e?.code === 'timeout' || code === 'timeout') return t('Reading the report took too long. Try again, or fill in the values yourself.')
  if (code === 'refused' || code === 'unreadable') return t('The report could not be read. Fill in the values yourself.')
  if (code === 'exam-too-large' || e?.status === 413) return t('That file is too large to be read.')
  if (code === 'locked') return t('Too many readings in the last hour. Try again later.')
  if (code === 'config') return t('The server\'s AI key was not accepted. Check ANTHROPIC_API_KEY on the server.')
  return t('Reading the report failed. Try again, or fill in the values yourself.')
}

/** One stored file of an exam: a PDF opened in a new tab, a photo shown as a thumbnail. */
function ExamFile({ file, onRemove }) {
  const { url, status, load } = useMediaUrl(file, { auto: file.kind !== 'doc' })
  const open = () => {
    if (url) { window.open(url, '_blank', 'noopener'); return }
    load()
  }
  return <div className="exam-file">
    {file.kind === 'doc'
      ? <button className="exam-doc" onClick={open}><Icon name="doc" /><span>{status === 'loading' ? t('Loading…') : t('Open PDF')}</span></button>
      : <button className="exam-photo" onClick={open}>{url ? <img src={url} alt="" /> : <Icon name="image" />}</button>}
    {onRemove && <button className="iconbtn exam-file-x" onClick={onRemove} aria-label={t('Remove')}><Icon name="xmark" /></button>}
  </div>
}

function ResultRow({ r, onChange, onRemove }) {
  const set = (k, v) => onChange({ ...r, [k]: v,
    // A value or range typed by hand is read again from its text, and its flag worked out again.
    ...(k === 'valueText' ? { value: null, flag: null } : {}),
    ...(k === 'refText' ? { refLow: null, refHigh: null, flag: null } : {}) })
  return <div className="exam-edit-row">
    <div className="row" style={{ gap: 6 }}>
      <TextField value={r.name} placeholder={t('Test')} onChange={e => set('name', e.target.value)} />
      <button className="iconbtn" onClick={onRemove} aria-label={t('Remove')}><Icon name="trash" /></button>
    </div>
    <div className="row" style={{ gap: 6 }}>
      <TextField value={r.valueText} placeholder={t('Result')} onChange={e => set('valueText', e.target.value)} />
      <TextField value={r.unit} placeholder={t('Unit')} onChange={e => set('unit', e.target.value)} />
    </div>
    <TextField value={r.refText} placeholder={t('Reference range')} onChange={e => set('refText', e.target.value)} />
  </div>
}

function ExamForm({ id, close }) {
  const S = useStore(s => s.S)
  const user = useStore(s => s.user)
  const config = useStore(s => s.config)
  const prev = id ? (S.exams || []).find(e => e.id === id) : null
  const [f, setF] = useState(() => ({
    d: prev?.d || todayISO(), title: prev?.title || '', lab: prev?.lab || '', notes: prev?.notes || '',
    files: prev?.files ? [...prev.files] : [], results: prev?.results ? prev.results.map(r => ({ ...r })) : []
  }))
  const [busy, setBusy] = useState('')
  const fileRef = useRef(null)
  const set = (k, v) => setF(x => ({ ...x, [k]: v }))
  const hashes = f.files.map(x => x.hash).join(',')
  useEffect(() => (hashes ? mediaStore.hold(hashes.split(',')) : undefined), [hashes])
  const canRead = !!user && !!config?.exams_ai && f.files.length > 0
  const hasPdf = f.files.some(x => x.kind === 'doc')

  const onFiles = async ev => {
    const picked = [...(ev.target.files || [])]
    ev.target.value = ''
    if (!picked.length) return
    setBusy('files')
    try {
      const { ingestMediaFile } = await import('../lib/media-ingest.js')
      const added = []
      for (const file of picked) {
        try {
          const out = await ingestMediaFile(file, limitsFrom(config), {}, { docs: true })
          for (const b of out.blobs) await mediaStore.put(b.hash, b.blob, { mime: b.mime, pending: true })
          added.push(out.media)
        } catch (e) { toast(e?.code === 'type' ? t('Use a PDF or a photo of the report.') : mediaErrorText(e)) }
      }
      setF(x => {
        let files = [...x.files, ...added.filter(m => !x.files.some(y => y.hash === m.hash))]
        // One PDF is the whole report; photos are its pages, up to six.
        const pdf = files.find(m => m.kind === 'doc')
        if (pdf) files = [pdf]
        return { ...x, files: files.slice(0, FILES_MAX) }
      })
    } finally { setBusy('') }
  }

  const read = async () => {
    setBusy('read')
    try {
      const files = []
      for (const m of f.files) {
        const got = await mediaStore.get(m.hash)
        if (!got) throw Object.assign(new Error('missing'), { code: 'missing' })
        files.push({ mime: m.mime, data: await base64Of(got.blob) })
      }
      const reading = fromReading(await api('/api/exams/read', { method: 'POST', body: JSON.stringify({ files }), timeout: 150000 }))
      setF(x => ({ ...x, d: reading.d || x.d, title: x.title || reading.title, lab: x.lab || reading.lab, results: reading.results }))
      toast(reading.results.length ? t('{0} results read. Check them before saving.', reading.results.length) : t('No results were found in this file.'))
    } catch (e) {
      toast(e?.code === 'missing' ? t('This file is not on this device yet.') : readError(e))
    } finally { setBusy('') }
  }

  const save = () => {
    const exam = normalizeExam(f, { prev })
    if (exam.error) { toast(t('Choose the date of the exam')); return }
    update(s => {
      const list = (s.exams || []).filter(e => e.id !== exam.id)
      s.exams = [...list, exam]
    })
    close()
    toast(prev ? t('Exam saved') : t('Exam added'))
  }
  const remove = () => confirmSheet({
    title: t('Delete exam?'), message: t('Deletes the exam and its results. Its files are removed from the server later.'),
    confirmText: t('Delete'), danger: true,
    onConfirm: () => { update(s => { s.exams = (s.exams || []).filter(e => e.id !== prev.id) }); close(); toast(t('Exam deleted')) }
  })

  return <>
    <h3>{prev ? t('Edit exam') : t('New exam')}</h3>
    <div className="med-form">
      <div>
        <span className="med-label">{t('Report')}</span>
        <div className="exam-files">
          {f.files.map(file => <ExamFile key={file.hash} file={file} onRemove={() => set('files', f.files.filter(x => x.hash !== file.hash))} />)}
          {!hasPdf && f.files.length < FILES_MAX && <button className="exam-add" onClick={() => fileRef.current?.click()} disabled={!!busy}>
            <Icon name="plus" /><span>{busy === 'files' ? t('Adding…') : t('PDF or photos')}</span>
          </button>}
        </div>
        <input ref={fileRef} type="file" accept="application/pdf,image/*" multiple hidden onChange={onFiles} />
        {canRead && <div style={{ marginTop: 10 }}>
          <Button variant="primary" icon="sparkles" onClick={read} disabled={!!busy}>{busy === 'read' ? t('Reading the report…') : t('Read with AI')}</Button>
          <div className="small dim" style={{ marginTop: 6 }}>{t('The file is sent to the AI only to read the values. Check them before saving.')}</div>
        </div>}
      </div>
      <label><span>{t('Date')}</span><input className="field" type="date" value={f.d} max={todayISO()} onChange={e => set('d', e.target.value)} /></label>
      <label><span>{t('Title')}</span><TextField value={f.title} maxLength={80} placeholder={t('e.g. Routine blood test')} onChange={e => set('title', e.target.value)} /></label>
      <label><span>{t('Laboratory')}</span><TextField value={f.lab} maxLength={80} onChange={e => set('lab', e.target.value)} /></label>
      <div>
        <span className="med-label">{t('Results')}</span>
        {f.results.map((r, i) => <ResultRow key={r.id || i} r={r}
          onChange={v => set('results', f.results.map((x, j) => (j === i ? v : x)))}
          onRemove={() => set('results', f.results.filter((_, j) => j !== i))} />)}
        <Button size="sm" variant="ghost" icon="plus" onClick={() => set('results', [...f.results, { name: '', valueText: '', unit: '', refText: '' }])}>{t('Add result')}</Button>
      </div>
      <label><span>{t('Notes')}</span><TextField value={f.notes} maxLength={500} onChange={e => set('notes', e.target.value)} /></label>
    </div>
    <div style={{ height: 14 }} />
    <Button variant="primary" onClick={save} disabled={busy === 'read'}>{t('Save')}</Button>
    <div style={{ height: 8 }} />
    {prev ? <Button variant="ghost" className="danger" icon="trash" onClick={remove}>{t('Delete exam')}</Button>
      : <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>}
  </>
}

export const examFormSheet = (id = null) => ui().openSheet(close => <ExamForm id={id} close={close} />)

function ExamDetail({ id, close }) {
  const exam = useStore(s => (s.S.exams || []).find(e => e.id === id))
  if (!exam) return <><h3>{t('Exam')}</h3><div className="muted small">{t('This exam was deleted.')}</div><Button onClick={close}>{t('Close')}</Button></>
  const sections = [...new Set(exam.results.map(r => r.section || ''))]
  return <>
    <h3>{exam.title || t('Exam')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{[fmtDate(exam.d, true), exam.lab].filter(Boolean).join(' · ')}</div>
    {exam.files?.length > 0 && <div className="exam-files" style={{ marginBottom: 14 }}>{exam.files.map(file => <ExamFile key={file.hash} file={file} />)}</div>}
    {sections.map(sec => <div key={sec} style={{ marginBottom: 12 }}>
      {sec && <h4 className="sec" style={{ margin: '6px 2px' }}>{sec}</h4>}
      {exam.results.filter(r => (r.section || '') === sec).map(r => {
        const look = FLAG[r.flag]
        return <div className="exam-result" key={r.id}>
          <div className="exam-what"><b>{r.name}</b>{r.refText && <span className="small dim">{t('Reference: {0}', r.refText)}</span>}</div>
          <div className="exam-val" style={{ color: look && r.flag !== 'normal' ? look.color : undefined }}>
            {shownValue(r)} <span className="small dim">{r.unit}</span>
            {look && r.flag !== 'normal' && <span className="small" style={{ display: 'block' }}>{t(look.label)}</span>}
          </div>
        </div>
      })}
    </div>)}
    {!exam.results.length && <div className="muted small">{t('No results recorded.')}</div>}
    {exam.notes && <div className="small dim" style={{ marginTop: 8 }}>{exam.notes}</div>}
    <div style={{ height: 14 }} />
    <Button icon="pencil" onClick={() => { close(); examFormSheet(exam.id) }}>{t('Edit')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Close')}</Button>
  </>
}

const examDetailSheet = id => ui().openSheet(close => <ExamDetail id={id} close={close} />)

function Trend({ k, close }) {
  const exams = useStore(s => s.S.exams || [])
  const a = analytes(exams).find(x => x.key === k)
  const s = seriesOf(exams, k)
  const rows = examsByDate(exams).flatMap(e => e.results.filter(r => r.key === k).map(r => ({ e, r })))
  return <>
    <h3>{a?.name || k}</h3>
    {(s.refLow != null || s.refHigh != null) && <div className="muted small">{t('Reference: {0}', [s.refLow, s.refHigh].map(v => (v == null ? '…' : fmtNum(v))).join(' – ') + (s.unit ? ' ' + s.unit : ''))}</div>}
    {s.points.length > 1
      ? <div className="chart" style={{ margin: '10px 0' }}><LineChart points={s.points} h={170} unit={s.unit} color="var(--teal)" /></div>
      : <div className="muted small" style={{ margin: '10px 0' }}>{t('The chart appears once there are two results.')}</div>}
    <div className="list">{rows.map(({ e, r }) => {
      const look = FLAG[r.flag]
      return <div className="exam-result" key={e.id + r.id}>
        <div className="exam-what"><b>{fmtDate(e.d, true)}</b><span className="small dim">{e.lab || e.title}</span></div>
        <div className="exam-val" style={{ color: look && r.flag !== 'normal' ? look.color : undefined }}>{shownValue(r)} <span className="small dim">{r.unit}</span></div>
      </div>
    })}</div>
    <div style={{ height: 12 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Close')}</Button>
  </>
}

export default function Exams() {
  const nav = useNavigate()
  const exams = useStore(s => s.S.exams || [])
  const config = useStore(s => s.config)
  const user = useStore(s => s.user)
  const [tab, setTab] = useState('exams')
  const list = examsByDate(exams)
  const all = analytes(exams)

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/health')} aria-label={t('Health')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 10 }}><h1>{t('Medical exams')}</h1><div className="sub">{t('{0} exams', list.length)}</div></div>
      <button className="iconbtn" onClick={() => examFormSheet()} aria-label={t('New exam')}><Icon name="plus" /></button>
    </div>

    {!list.length && <div className="card">
      <div className="muted small">{user && config?.exams_ai
        ? t('Add the PDF from the lab or photos of the report. The AI reads the values for you to check, and each test gets its own chart over time.')
        : t('Add the PDF from the lab or photos of the report, with the values you want to follow. Each test gets its own chart over time.')}</div>
      <div style={{ height: 10 }} /><Button variant="primary" icon="plus" onClick={() => examFormSheet()}>{t('Add exam')}</Button>
    </div>}

    {list.length > 0 && <Segmented value={tab} onChange={setTab} options={[{ value: 'exams', label: t('Exams') }, { value: 'trends', label: t('Over time') }]} />}
    <div style={{ height: 12 }} />

    {tab === 'exams' && list.length > 0 && <Section>{list.map(e => {
      const out = outOfRange(e)
      return <Row key={e.id} icon={e.files?.some(f => f.kind === 'doc') ? 'doc' : 'note'} iconTint={out ? 'var(--red)' : 'var(--indigo)'}
        title={e.title || t('Exam')}
        subtitle={[fmtDate(e.d, true), e.lab, t('{0} results', e.results.length), out ? t('{0} out of range', out) : null].filter(Boolean).join(' · ')}
        accessory="chevron" onClick={() => examDetailSheet(e.id)} />
    })}</Section>}

    {tab === 'trends' && (all.length ? <Section>{all.map(a => {
      const look = FLAG[a.last.flag]
      return <Row key={a.key} title={a.name}
        subtitle={[fmtDate(a.last.d, true), t('{0} results', a.count)].join(' · ')}
        value={<span style={{ color: look && a.last.flag !== 'normal' ? look.color : undefined }}>{shownValue(a.last)} {a.unit}</span>}
        accessory="chevron" onClick={() => ui().openSheet(close => <Trend k={a.key} close={close} />)} />
    })}</Section> : <div className="empty small">{t('No results yet')}</div>)}
  </div>
}
