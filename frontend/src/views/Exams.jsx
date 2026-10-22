import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { FILES_MAX, analytes, byName, examsByDate, filterAnalytes, filterExams, fold, fromReading, normalizeExam, outOfRange, seriesOf } from '../lib/exams.js'
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

/** Whether an exam has a report on file and no results yet: the one to offer reading with AI. */
export const awaitsReading = e => (e?.files || []).length > 0 && !(e?.results || []).length

/** The AI's reading of an exam's files (POST /api/exams/read), as the form takes it. Throws. */
async function readReport(files) {
  const body = []
  for (const m of files) {
    const got = await mediaStore.get(m.hash)
    if (!got) throw Object.assign(new Error('missing'), { code: 'missing' })
    body.push({ mime: m.mime, data: await base64Of(got.blob) })
  }
  return fromReading(await api('/api/exams/read', { method: 'POST', body: JSON.stringify({ files: body }), timeout: 150000 }))
}
const readingToast = reading => toast(reading.results.length
  ? t('{0} results read. Check them before saving.', reading.results.length)
  : t('No results were found in this file.'))
const readFailText = e => (e?.code === 'missing' ? t('This file is not on this device yet.') : readError(e))
// A reading laid over the form: its date, and its title and lab where the form has none.
// A reading laid over an exam: the date, lab and doctor it finds win; its title only replaces an
// empty one, or one that is the doctor's name (what an older reading put there).
const withReading = (x, reading) => ({
  ...x,
  d: reading.d || x.d,
  lab: reading.lab || x.lab,
  doctor: reading.doctor || x.doctor || '',
  title: !x.title || (reading.doctor && fold(x.title) === fold(reading.doctor)) ? reading.title || x.title : x.title,
  results: reading.results,
  ai: Date.now()
})

/** The exams being read right now, by id (useUI: it lasts as long as the page is open). */
export const useReadingExam = id => useUI(s => !!s.examReads?.[id])
const setReading = (id, on) => {
  const reads = { ...(useUI.getState().examReads || {}) }
  if (on) reads[id] = true; else delete reads[id]
  useUI.setState({ examReads: reads })
}

/**
 * Reads a saved exam's report with AI and saves what comes back into it, without anyone having to
 * wait on a screen: the person may close the sheet, open another exam, leave Health. Saved only
 * into an exam that is still there and still has no results — values typed in meanwhile are
 * never replaced. The detail then says the values were read by AI, to be checked against the
 * report. Lasts as long as the app stays open.
 */
//
// `replace`: read an exam that already has results again (to fill in the doctor, a better title),
// and put the new reading in their place — unless they were changed while it was on its way.
export function readInBackground(exam, { replace = false } = {}) {
  const id = exam.id
  if (useUI.getState().examReads?.[id] || !(exam.files || []).length) return
  const before = JSON.stringify(exam.results || [])
  setReading(id, true)
  queued(() => readReport(exam.files)).then(got => {
    let saved = null
    update(s => {
      const e = (s.exams || []).find(x => x.id === id)
      if (!e) return
      if (replace ? JSON.stringify(e.results || []) !== before : (e.results || []).length) return
      // A new reading that finds nothing never empties an exam that had results.
      if (replace && !got.results.length && (e.results || []).length) return
      saved = normalizeExam(withReading(e, got), { prev: e })
      s.exams = s.exams.map(x => (x.id === id ? saved : x))
    })
    if (!saved) return
    toast(saved.results.length
      ? t('{0}: {1} results read and saved.', saved.title || t('Exam'), saved.results.length)
      : t('No results were found in this file.'))
  }).catch(e => toast(readFailText(e))).finally(() => setReading(id, false))
}

// Two readings at a time: "read all again" starts one per exam, and each is a long request.
const QUEUE_MAX = 2
let running = 0
const waiting = []
function queued(job) {
  return new Promise((resolve, reject) => {
    const go = () => {
      running++
      job().then(resolve, reject).finally(() => { running--; waiting.shift()?.() })
    }
    if (running < QUEUE_MAX) go(); else waiting.push(go)
  })
}

/** Asks, then reads again with AI every given exam that has its report on file. */
export function readAgainSheet(exams) {
  const list = exams.filter(e => (e.files || []).length && !useUI.getState().examReads?.[e.id])
  if (!list.length) return
  confirmSheet({
    title: list.length === 1 ? t('Read again with AI?') : t('Read {0} exams again with AI?', list.length),
    message: t('The values read now replace the current results. Each reading is charged by the AI service.'),
    confirmText: t('Read again'),
    onConfirm: () => {
      for (const e of list) readInBackground(e, { replace: (e.results || []).length > 0 })
      toast(t('Reading the report. You can keep using the app; the results are saved when ready.'))
    }
  })
}

function ExamForm({ id, reading = null, close }) {
  const S = useStore(s => s.S)
  const user = useStore(s => s.user)
  const config = useStore(s => s.config)
  const prev = id ? (S.exams || []).find(e => e.id === id) : null
  const [f, setF] = useState(() => {
    const start = {
      d: prev?.d || todayISO(), title: prev?.title || '', lab: prev?.lab || '', doctor: prev?.doctor || '', notes: prev?.notes || '',
      files: prev?.files ? [...prev.files] : [], results: prev?.results ? prev.results.map(r => ({ ...r })) : [], ai: prev?.ai || 0
    }
    // Opened from an exam's detail right after its reading: the values wait here to be checked.
    return reading ? withReading(start, reading) : start
  })
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
    // Nothing read off it yet: the exam is saved as it is and read in the background, so the
    // form can close at once. With results already there, a new reading replaces them here, to
    // be looked over before saving.
    if (!f.results.length) {
      const exam = normalizeExam(f, { prev })
      if (exam.error) { toast(t('Choose the date of the exam')); return }
      update(s => { s.exams = [...(s.exams || []).filter(e => e.id !== exam.id), exam] })
      close()
      readInBackground(exam)
      toast(t('Reading the report. You can keep using the app; the results are saved when ready.'))
      return
    }
    setBusy('read')
    try {
      const got = await readReport(f.files)
      setF(x => withReading(x, got))
      readingToast(got)
    } catch (e) {
      toast(readFailText(e))
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
          <div className="small dim" style={{ marginTop: 6 }}>{t('The file is sent to the AI only to read the values. Check them against the report.')}</div>
        </div>}
      </div>
      <label><span>{t('Date')}</span><input className="field" type="date" value={f.d} max={todayISO()} onChange={e => set('d', e.target.value)} /></label>
      <label><span>{t('Title')}</span><TextField value={f.title} maxLength={80} placeholder={t('e.g. Routine blood test')} onChange={e => set('title', e.target.value)} /></label>
      <label><span>{t('Laboratory')}</span><TextField value={f.lab} maxLength={80} onChange={e => set('lab', e.target.value)} /></label>
      <label><span>{t('Doctor')}</span><TextField value={f.doctor} maxLength={80} onChange={e => set('doctor', e.target.value)} /></label>
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

export const examFormSheet = (id = null, reading = null) => ui().openSheet(close => <ExamForm id={id} reading={reading} close={close} />)

function ExamDetail({ id, close }) {
  const exam = useStore(s => (s.S.exams || []).find(e => e.id === id))
  const canRead = useStore(s => !!s.user && !!s.config?.exams_ai)
  const reading = useReadingExam(id)
  const [query, setQuery] = useState('')
  const [onlyOut, setOnlyOut] = useState(false)
  if (!exam) return <><h3>{t('Exam')}</h3><div className="muted small">{t('This exam was deleted.')}</div><Button onClick={close}>{t('Close')}</Button></>
  // In alphabetical order within each section of the report, narrowed by the search and filter.
  const words = fold(query).split(/\s+/).filter(Boolean)
  const shown = exam.results
    .filter(r => (!onlyOut || ['low', 'high', 'abnormal'].includes(r.flag)) && words.every(w => fold(r.name).includes(w)))
    .sort((a, b) => byName(a.name, b.name))
  const sections = [...new Set(exam.results.map(r => r.section || ''))].filter(sec => shown.some(r => (r.section || '') === sec))
  return <>
    <h3>{exam.title || t('Exam')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{[fmtDate(exam.d, true), exam.lab, exam.doctor].filter(Boolean).join(' · ')}</div>
    {exam.files?.length > 0 && <div className="exam-files" style={{ marginBottom: 14 }}>{exam.files.map(file => <ExamFile key={file.hash} file={file} />)}</div>}
    {/* A report on file and nothing read off it yet: reading it is the next thing to do, and it
        goes on in the background — the results are saved into the exam when they arrive. */}
    {canRead && awaitsReading(exam) && <div style={{ marginBottom: 14 }}>
      <Button variant="primary" icon="sparkles" disabled={reading} onClick={() => {
        readInBackground(exam)
        toast(t('Reading the report. You can keep using the app; the results are saved when ready.'))
      }}>{reading ? t('Reading the report…') : t('Read with AI')}</Button>
      {reading && <div className="small dim" style={{ marginTop: 6 }}>{t('You can close this screen; the results are saved when ready.')}</div>}
    </div>}
    {exam.ai > 0 && exam.results.length > 0 && <div className="small dim exam-ai-note"><Icon name="sparkles" /> {t('Read by AI. Check the values against the report.')}</div>}
    {/* Already read (by AI or by hand): reading it again fills in what an earlier reading missed. */}
    {canRead && exam.files?.length > 0 && exam.results.length > 0 && <div style={{ marginBottom: 12 }}>
      <Button size="sm" variant="ghost" icon="sparkles" disabled={reading} onClick={() => readAgainSheet([exam])}>{reading ? t('Reading the report…') : t('Read again with AI')}</Button>
    </div>}
    {exam.results.length > 5 && <ExamFilters query={query} setQuery={setQuery} onlyOut={onlyOut} setOnlyOut={setOnlyOut} />}
    {exam.results.length > 0 && !shown.length && <div className="muted small">{t('Nothing matches.')}</div>}
    {sections.map(sec => <div key={sec} style={{ marginBottom: 12 }}>
      {sec && <h4 className="sec" style={{ margin: '6px 2px' }}>{sec}</h4>}
      {shown.filter(r => (r.section || '') === sec).map(r => {
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

// The search box that narrows as it is typed into, and the out-of-range switch.
function ExamFilters({ query, setQuery, onlyOut, setOnlyOut }) {
  return <div className="exam-filters">
    <div className="exam-search">
      <Icon name="magnifier" />
      <input type="search" value={query} placeholder={t('Search')} aria-label={t('Search')} onChange={e => setQuery(e.target.value)} />
      {query && <button className="iconbtn" onClick={() => setQuery('')} aria-label={t('Clear')}><Icon name="xmark" /></button>}
    </div>
    <button className={'exam-chip' + (onlyOut ? ' on' : '')} aria-pressed={onlyOut} onClick={() => setOnlyOut(!onlyOut)}>{t('Out of range')}</button>
  </div>
}

// In the list: the exam waits to be read with AI, or (pulsing) is being read now.
function ReadMark({ id }) {
  const busy = useReadingExam(id)
  return <span className={'exam-ai' + (busy ? ' busy' : '')} title={busy ? t('Reading the report…') : t('Read with AI')}><Icon name="sparkles" /></span>
}

export default function Exams() {
  const nav = useNavigate()
  const exams = useStore(s => s.S.exams || [])
  const config = useStore(s => s.config)
  const user = useStore(s => s.user)
  const [tab, setTab] = useState('exams')
  const [query, setQuery] = useState('')
  const [onlyOut, setOnlyOut] = useState(false)
  const aiOn = !!user && !!config?.exams_ai
  const list = examsByDate(exams)
  const all = analytes(exams)
  const shownExams = filterExams(list, { query, out: onlyOut })
  const shownAll = filterAnalytes(all, { query, out: onlyOut })

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
    {list.length > 0 && <ExamFilters query={query} setQuery={setQuery} onlyOut={onlyOut} setOnlyOut={setOnlyOut} />}
    {list.length > 0 && (tab === 'exams' ? !shownExams.length : all.length > 0 && !shownAll.length) && <div className="empty small">{t('Nothing matches.')}</div>}

    {tab === 'exams' && shownExams.length > 0 && <Section>{shownExams.map(e => {
      const out = outOfRange(e)
      return <Row key={e.id} icon={e.files?.some(f => f.kind === 'doc') ? 'doc' : 'note'} iconTint={out ? 'var(--red)' : 'var(--indigo)'}
        // Waiting to be read with AI: its report is on file, nothing has been read off it.
        children={aiOn && awaitsReading(e) ? <ReadMark id={e.id} /> : null}
        title={e.title || t('Exam')}
        subtitle={[fmtDate(e.d, true), e.lab, e.doctor, t('{0} results', e.results.length), out ? t('{0} out of range', out) : null].filter(Boolean).join(' · ')}
        accessory="chevron" onClick={() => examDetailSheet(e.id)} />
    })}</Section>}
    {tab === 'exams' && aiOn && list.some(e => (e.files || []).length) && <div style={{ margin: '4px 0 18px' }}>
      <Button size="sm" variant="ghost" icon="sparkles" onClick={() => readAgainSheet(list)}>{t('Read all again with AI')}</Button>
    </div>}

    {tab === 'trends' && (all.length ? shownAll.length > 0 && <Section>{shownAll.map(a => {
      const look = FLAG[a.last.flag]
      return <Row key={a.key} title={a.name}
        subtitle={[fmtDate(a.last.d, true), t('{0} results', a.count)].join(' · ')}
        value={<span style={{ color: look && a.last.flag !== 'normal' ? look.color : undefined }}>{shownValue(a.last)} {a.unit}</span>}
        accessory="chevron" onClick={() => ui().openSheet(close => <Trend k={a.key} close={close} />)} />
    })}</Section> : <div className="empty small">{t('No results yet')}</div>)}
  </div>
}
