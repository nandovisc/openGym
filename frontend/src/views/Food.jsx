import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import {
  ACTIVITY, OBJECTIVE, SLOTS, dailySeries, dayOf, foodFromOff, foodFromPortion, foodsFromItems, foodsFromOffSearch, itemOf, itemsOfSaved,
  keepEstimatedFoods, itemsFromReading, normalizeFood, normalizeItem, normalizeMeal, recentFoods, rescale, savedFromEstimates, savedMealFrom,
  searchFoods, searchSavedMeals, suggestTargets, totalsOf, usageCounts
} from '../lib/nutrition.js'
import { lastBW } from '../lib/history.js'
import { mediaStore } from '../lib/media-store.js'
import { limitsFrom } from '../lib/media-limits.js'
import { MOBILE } from '../lib/mobile.js'
import { api } from '../lib/api.js'
import { fmtDate, fmtNum, todayISO, uid } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import Icon from '../components/Icon.jsx'
import LineChart from '../components/LineChart.jsx'
import CameraScan from '../components/CameraScan.jsx'
import { useMediaUrl } from '../components/CustomMedia.jsx'
import { mediaErrorText } from '../components/CustomMediaField.jsx'
import { Button, NumberField, Row, Section, Segmented, SelectRow, TextField } from '../components/ui.jsx'
import { confirmSheet } from '../sheets.jsx'

const update = fn => useStore.getState().update(fn)
const ui = () => useUI.getState()
const toast = message => ui().toast(message)

const SLOT_LABEL = { breakfast: 'Breakfast', morningSnack: 'Morning snack', lunch: 'Lunch', snack: 'Afternoon snack', dinner: 'Dinner', supper: 'Supper' }
const ACTIVITY_LABEL = { sedentary: 'Sedentary', light: 'Lightly active', moderate: 'Moderately active', active: 'Very active', very: 'Extremely active' }
const OBJECTIVE_LABEL = { lose: 'Lose weight', maintain: 'Keep my weight', gain: 'Gain weight' }
const kcalText = n => `${fmtNum(Math.round(n || 0))} kcal`
const g = n => `${fmtNum(Math.round((n || 0) * 10) / 10)} g`
const addDays = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10)

// The TACO table, loaded with the screen rather than with the app.
let tacoLoad = null
function useTaco() {
  const [taco, setTaco] = useState(null)
  useEffect(() => {
    let alive = true
    ;(tacoLoad ??= import('../lib/taco-data.js')).then(m => { if (alive) setTaco(m.TACO) }).catch(() => { tacoLoad = null })
    return () => { alive = false }
  }, [])
  return taco
}
// The translated USDA table (lib/usda-data.js), loaded the same way.
let usdaLoad = null
function useUsda() {
  const [usda, setUsda] = useState(null)
  useEffect(() => {
    let alive = true
    ;(usdaLoad ??= import('../lib/usda-data.js')).then(m => { if (alive) setUsda(m.USDA) }).catch(() => { usdaLoad = null })
    return () => { alive = false }
  }, [])
  return usda
}

// Products of Open Food Facts sold in Brazil matching a query, asked through the server
// (GET /api/foods/search: the search endpoints a browser could call are rarely up) while the person
// types: after three letters and a pause, the answer of each query remembered.
// { status: 'idle' | 'loading' | 'done' | 'error' | 'offline', foods }; 'offline' without a server.
const offCache = new Map()
export function useOffSearch(query, { wait = 600 } = {}) {
  const signedIn = useStore(s => !!s.user)
  const q = String(query || '').trim().toLowerCase()
  const [st, setSt] = useState({ status: 'idle', foods: [] })
  useEffect(() => {
    if (q.length < 3) { setSt({ status: 'idle', foods: [] }); return }
    if (!signedIn) { setSt({ status: 'offline', foods: [] }); return }
    if (offCache.has(q)) { setSt({ status: 'done', foods: offCache.get(q) }); return }
    let alive = true
    setSt({ status: 'loading', foods: [] })
    const timer = setTimeout(async () => {
      try {
        const foods = foodsFromOffSearch(await api('/api/foods/search?q=' + encodeURIComponent(q), { timeout: 15000 }))
        offCache.set(q, foods)
        if (alive) setSt({ status: 'done', foods })
      } catch { if (alive) setSt({ status: 'error', foods: [] }) }
    }, wait)
    return () => { alive = false; clearTimeout(timer) }
  }, [q, wait, signedIn])
  return st
}

/** Adds `items` to the day's `slot`: into its meal typed in by hand, or a new one. */
export function addItems(d, slot, items) {
  if (!items.length) return
  update(s => {
    const meals = s.meals || []
    const into = meals.find(m => m.d === d && m.slot === slot && !m.photo && !m.ai)
    if (into) into.items = [...(into.items || []), ...items]
    else s.meals = [...meals, normalizeMeal({ d, slot, time: new Date().toTimeString().slice(0, 5), items })]
  })
}

/* ---------- the photo of a plate, read by AI in the background ---------- */

const base64Of = blob => new Promise((resolve, reject) => {
  const fr = new FileReader()
  fr.onload = () => resolve(String(fr.result).split(',')[1] || '')
  fr.onerror = () => reject(fr.error)
  fr.readAsDataURL(blob)
})
export const useReadingMeal = id => useUI(s => !!s.mealReads?.[id])
const setReading = (id, on) => {
  const reads = { ...(useUI.getState().mealReads || {}) }
  if (on) reads[id] = true; else delete reads[id]
  useUI.setState({ mealReads: reads })
}
function readFail(e) {
  const code = e?.data?.code
  if (code === 'config') return t('The server\'s AI key was not accepted. Check ANTHROPIC_API_KEY on the server.')
  if (code === 'locked') return t('Too many readings in the last hour. Try again later.')
  if (e?.code === 'timeout' || code === 'timeout') return t('Estimating the meal took too long. Add the foods yourself or try again.')
  return t('The meal could not be estimated. Add the foods yourself or try again.')
}

/**
 * Estimates the meal `id` from its photos (blobs) and saves the items into it, while the person
 * does anything else. Saved only into a meal that is still there and still has no items: food
 * added by hand meanwhile is never replaced. Lasts as long as the app stays open.
 */
export function readMealInBackground(id, blobs) {
  if (useUI.getState().mealReads?.[id]) return
  setReading(id, true)
  ;(async () => {
    const files = []
    for (const b of blobs) files.push({ mime: b.type || 'image/jpeg', data: await base64Of(b) })
    return api('/api/meals/read', { method: 'POST', body: JSON.stringify({ files }), timeout: 150000 })
  })().then(reading => {
    const items = itemsFromReading(reading)
    let saved = false
    update(s => {
      const m = (s.meals || []).find(x => x.id === id)
      if (!m || (m.items || []).length) return
      // Each food estimated is kept among the person's foods too, to be found by searching next time.
      const kept = foodsFromItems(items, s.foods)
      if (kept.foods.length) s.foods = [...(s.foods || []), ...kept.foods]
      m.items = kept.items
      m.title = String(reading?.title || '').slice(0, 80)
      m.ai = Date.now()
      // And the plate itself, to add again whole or in part.
      const plate = savedMealFrom(m, m.title, { src: 'ai' })
      if (plate) s.savedMeals = [...(s.savedMeals || []), plate]
      saved = true
    })
    if (saved) toast(items.length ? t('{0}: {1} foods estimated and saved.', reading.title || t('Meal'), items.length) : t('No food was found in the photo.'))
  }).catch(e => toast(readFail(e))).finally(() => setReading(id, false))
}

/* ---------- adding food ---------- */

function Amount({ food, onAdd, onBack }) {
  const [grams, setGrams] = useState(food.serving?.g || 100)
  const it = itemOf(food, grams || 0)
  return <>
    <h3>{food.name}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{[food.brand, t('{0} per 100 g', kcalText(food.per100.kcal))].filter(Boolean).join(' · ')}</div>
    {food.serving?.g > 0 && <div className="row" style={{ gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
      <button className="exam-chip" onClick={() => setGrams(food.serving.g)}>{food.serving.label || `${food.serving.g} g`}</button>
      <button className="exam-chip" onClick={() => setGrams(100)}>100 g</button>
    </div>}
    <label className="food-grams"><span>{t('Amount (g)')}</span><NumberField className="field" value={grams} onChange={v => setGrams(v)} /></label>
    <div className="food-preview">
      <b>{kcalText(it.kcal)}</b>
      <span>{t('P {0}', g(it.p))}</span><span>{t('C {0}', g(it.c))}</span><span>{t('F {0}', g(it.f))}</span>
    </div>
    <div style={{ height: 12 }} />
    <Button variant="primary" icon="plus" disabled={!(grams > 0)} onClick={() => onAdd(it)}>{t('Add')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={onBack}>{t('Back')}</Button>
  </>
}

const SRC_LABEL = { taco: 'TACO', usda: 'USDA', off: 'Open Food Facts' }
const foodRow = (f, onPick, uses) => <Row key={f.id} title={f.name}
  subtitle={[f.brand, t('{0} per 100 g', kcalText(f.per100.kcal)), SRC_LABEL[f.src], uses?.get(f.id) ? t('eaten {0}×', uses.get(f.id)) : null].filter(Boolean).join(' · ')}
  accessory="chevron" onClick={() => onPick(f)}>{f.src === 'ai' && <span className="exam-ai"><Icon name="sparkles" /></span>}</Row>
const mealRow = (m, onOpen) => <Row key={m.id} icon="list" iconTint="var(--orange)" title={m.name}
  subtitle={[t('{0} foods', m.items.length), kcalText(totalsOf(m.items).kcal)].join(' · ')} accessory="chevron" onClick={() => onOpen(m)}>
  {m.src === 'ai' && <span className="exam-ai"><Icon name="sparkles" /></span>}</Row>
const Heading = ({ children }) => <h4 className="sec" style={{ margin: '12px 2px 6px' }}>{children}</h4>

function SearchTab({ taco, usda, onPick, onMeal, onCreate }) {
  const S = useStore(s => s.S)
  const [q, setQ] = useState('')
  const uses = useMemo(() => usageCounts(S.meals), [S.meals])
  const mine = useMemo(() => {
    const recent = recentFoods(S.meals, S.foods, { taco: taco || [], usda: usda || [] })
    const own = (S.foods || []).filter(f => !recent.some(r => r.id === f.id))
    return [...recent, ...own]
  }, [S.meals, S.foods, taco, usda])
  const found = useMemo(() => searchFoods(q, { taco: taco || [], usda: usda || [], mine, uses, limit: 60 }), [q, taco, usda, mine, uses])
  const meals = useMemo(() => (q ? searchSavedMeals(q, S.savedMeals, { limit: 5 }) : []), [q, S.savedMeals])
  const off = useOffSearch(q)
  // Products already among my foods (a barcode looked up before) are shown there, not twice.
  const products = off.foods.filter(f => !mine.some(m => m.id === f.id))
  const pickProduct = f => { update(s => { s.foods = [...(s.foods || []).filter(x => x.id !== f.id), f] }); onPick(f) }
  const groups = [
    ['mine', t('My foods'), found.filter(f => !['taco', 'usda'].includes(f.src))],
    ['taco', t('Brazilian table (TACO)'), found.filter(f => f.src === 'taco')],
    ['usda', t('More foods (USDA)'), found.filter(f => f.src === 'usda').slice(0, 20)]
  ]
  const nothing = !!q && !found.length && !meals.length && !products.length && off.status !== 'loading'
  return <>
    <div className="exam-search" style={{ marginBottom: 10 }}>
      <Icon name="magnifier" />
      <input type="search" autoFocus value={q} placeholder={t('Search foods')} aria-label={t('Search foods')} onChange={e => setQ(e.target.value)} />
    </div>
    {!taco && <div className="muted small">{t('Loading…')}</div>}
    {taco && !q && !mine.length && <div className="muted small">{t('Type a food: rice, beans, chicken… The table has about 600 Brazilian foods.')}</div>}
    {!q && mine.length > 0 && <><Heading>{t('Recent and my foods')}</Heading><Section>{found.map(f => foodRow(f, onPick, uses))}</Section></>}
    {!!q && <>
      {groups[0][2].length > 0 && <><Heading>{groups[0][1]}</Heading><Section>{groups[0][2].map(f => foodRow(f, onPick, uses))}</Section></>}
      {meals.length > 0 && <><Heading>{t('Saved meals')}</Heading><Section>{meals.map(m => mealRow(m, onMeal))}</Section></>}
      {groups.slice(1).map(([k, label, xs]) => xs.length > 0 && <div key={k}><Heading>{label}</Heading><Section>{xs.map(f => foodRow(f, onPick))}</Section></div>)}
      {q.trim().length >= 3 && <>
        <Heading>{t('Products (Open Food Facts)')}</Heading>
        {off.status === 'loading' && <div className="muted small">{t('Looking for products…')}</div>}
        {off.status === 'error' && <div className="muted small">{t('Open Food Facts could not be reached. The rest of the search still works.')}</div>}
        {off.status === 'offline' && <div className="muted small">{t('Packaged products are searched through your server: sign in to see them. The barcode works without it.')}</div>}
        {off.status === 'done' && !products.length && <div className="muted small">{t('No product found.')}</div>}
        {products.length > 0 && <Section>{products.map(f => foodRow(f, pickProduct))}</Section>}
      </>}
      {nothing && <div className="muted small" style={{ marginTop: 10 }}>{t('Nothing matches.')}</div>}
      <div style={{ height: 12 }} />
      <Button icon="plus" onClick={() => onCreate(q.trim())}>{t('Create “{0}”', q.trim())}</Button>
    </>}
  </>
}

/* ---------- my own foods: create, edit ---------- */

function FoodForm({ prev = null, name = '', onSaved, onBack }) {
  const [f, setF] = useState(() => prev
    ? { name: prev.name, mode: '100', grams: prev.serving?.g || null, unit: /ml$/.test(prev.serving?.label || '') ? 'ml' : 'g', kcal: prev.per100.kcal, p: prev.per100.p, c: prev.per100.c, f: prev.per100.f }
    : { name, mode: 'portion', grams: null, unit: 'g', kcal: null, p: null, c: null, f: null })
  const set = (k, v) => setF(x => ({ ...x, [k]: v }))
  const save = () => {
    const base = { id: prev?.id, src: prev?.src && prev.src !== 'ai' ? prev.src : prev?.src === 'ai' ? 'ai' : 'mine', ...(prev?.barcode ? { barcode: prev.barcode } : {}), ...(prev?.brand ? { brand: prev.brand } : {}) }
    const food = f.mode === 'portion'
      ? foodFromPortion({ ...base, name: f.name, grams: f.grams, unit: f.unit, kcal: f.kcal, p: f.p, c: f.c, f: f.f })
      : normalizeFood({ ...base, name: f.name, per100: { kcal: f.kcal, p: f.p, c: f.c, f: f.f }, ...(f.grams > 0 ? { serving: { g: f.grams, label: `${Math.round(f.grams)} ${f.unit}` } } : {}) })
    if (!food) { toast(f.mode === 'portion' ? t('Type the name, the portion size and its calories.') : t('Type a name and the calories.')); return }
    if (prev?.brand) food.brand = prev.brand
    update(s => { s.foods = [...(s.foods || []).filter(x => x.id !== food.id), food] })
    toast(prev ? t('Food saved') : t('Added to my foods'))
    onSaved(food)
  }
  const remove = () => confirmSheet({ title: t('Delete this food?'), message: t('Meals already logged keep it.'), confirmText: t('Delete'), danger: true,
    onConfirm: () => { update(s => { s.foods = (s.foods || []).filter(x => x.id !== prev.id) }); toast(t('Food deleted')); onBack() } })
  const per = f.mode === 'portion' ? t('in the portion') : t('per 100 g')
  return <>
    <h3>{prev ? t('Edit food') : t('Create food')}</h3>
    <div className="med-form">
      <label><span>{t('Name')}</span><TextField value={f.name} maxLength={100} placeholder={t('e.g. Chicken nuggets')} onChange={e => set('name', e.target.value)} /></label>
      <Segmented value={f.mode} onChange={v => set('mode', v)} options={[{ value: 'portion', label: t('Per portion') }, { value: '100', label: t('Per 100 g') }]} />
      <div className="food-macro-grid">
        <label><span>{f.mode === 'portion' ? t('Portion size') : t('Usual portion (optional)')}</span><NumberField className="field" nullable value={f.grams} onChange={v => set('grams', v)} /></label>
        <label><span>{t('Unit')}</span><Segmented value={f.unit} onChange={v => set('unit', v)} options={[{ value: 'g', label: 'g' }, { value: 'ml', label: 'ml' }]} /></label>
        <label><span>{t('kcal {0}', per)}</span><NumberField className="field" nullable value={f.kcal} onChange={v => set('kcal', v)} /></label>
        <label><span>{t('Protein (g)')}</span><NumberField className="field" nullable value={f.p} onChange={v => set('p', v)} /></label>
        <label><span>{t('Carbs (g)')}</span><NumberField className="field" nullable value={f.c} onChange={v => set('c', v)} /></label>
        <label><span>{t('Fat (g)')}</span><NumberField className="field" nullable value={f.f} onChange={v => set('f', v)} /></label>
      </div>
      <div className="small dim">{f.mode === 'portion' ? t('As on the label: the values of one portion. The app works out 100 g.') : t('Values for 100 g (or 100 ml).')}</div>
    </div>
    <div style={{ height: 12 }} />
    <Button variant="primary" onClick={save}>{t('Save')}</Button>
    {prev && <><div style={{ height: 8 }} /><Button variant="ghost" className="danger" icon="trash" onClick={remove}>{t('Delete food')}</Button></>}
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={onBack}>{t('Back')}</Button>
  </>
}

/* ---------- saved meals ---------- */

const FACTORS = [0.5, 1, 1.5, 2]
function SavedMealPick({ saved, onAdd, onBack }) {
  const [picked, setPicked] = useState(() => new Set(saved.items.map((_, i) => i)))
  const [factor, setFactor] = useState(1)
  const items = itemsOfSaved(saved, { picked, factor })
  const tot = totalsOf(items)
  const toggle = i => setPicked(p => { const n = new Set(p); if (n.has(i)) n.delete(i); else n.add(i); return n })
  const add = () => {
    update(s => { const m = (s.savedMeals || []).find(x => x.id === saved.id); if (m) m.used = Date.now() })
    onAdd(items)
  }
  return <>
    <h3>{saved.name}</h3>
    <div className="muted small" style={{ marginBottom: 10 }}>{t('Add the whole meal, or tick only the foods you ate.')}</div>
    <Section>{saved.items.map((x, i) => <label key={i} className="lrow food-pick">
      <input type="checkbox" checked={picked.has(i)} onChange={() => toggle(i)} />
      <span className="food-pick-name">{x.name}<span className="small dim">{[x.grams ? `${fmtNum(Math.round(x.grams * factor))} g` : null, kcalText(x.kcal * factor)].filter(Boolean).join(' · ')}</span></span>
    </label>)}</Section>
    <div style={{ height: 10 }} />
    <Segmented value={factor} onChange={setFactor} options={FACTORS.map(v => ({ value: v, label: `${fmtNum(v)}×` }))} />
    <div className="food-preview" style={{ marginTop: 10 }}>
      <b>{kcalText(tot.kcal)}</b>
      <span>{t('P {0}', g(tot.p))}</span><span>{t('C {0}', g(tot.c))}</span><span>{t('F {0}', g(tot.f))}</span>
    </div>
    <div style={{ height: 12 }} />
    <Button variant="primary" icon="plus" disabled={!items.length} onClick={add}>{picked.size === saved.items.length ? t('Add the whole meal') : t('Add the ticked foods ({0})', items.length)}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={onBack}>{t('Back')}</Button>
  </>
}

function MealsTab({ onOpen }) {
  const saved = useStore(s => s.S.savedMeals)
  const [q, setQ] = useState('')
  const list = searchSavedMeals(q, saved, { limit: 50 })
  if (!(saved || []).length) return <div className="muted small">{t('No saved meals yet. Plates read from a photo are saved here, and any meal of the day can be saved from its list.')}</div>
  return <>
    <div className="exam-search" style={{ marginBottom: 10 }}>
      <Icon name="magnifier" />
      <input type="search" value={q} placeholder={t('Search saved meals')} aria-label={t('Search saved meals')} onChange={e => setQ(e.target.value)} />
    </div>
    {list.length ? <Section>{list.map(m => mealRow(m, onOpen))}</Section> : <div className="muted small">{t('Nothing matches.')}</div>}
  </>
}

function BarcodeTab({ onPick }) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [camera, setCamera] = useState(false)
  const [canScan, setCanScan] = useState(MOBILE)
  useEffect(() => { if (!MOBILE) import('../lib/scan-web.js').then(m => m.productScanSupported()).then(setCanScan).catch(() => {}) }, [])
  const look = async value => {
    const digits = String(value || '').replace(/\D/g, '')
    if (digits.length < 8) { toast(t('Type the numbers under the barcode.')); return }
    const mine = (useStore.getState().S.foods || []).find(f => f.barcode === digits)
    if (mine) { onPick(mine); return }
    setBusy(true)
    try {
      const r = await fetch(`https://world.openfoodfacts.org/api/v2/product/${digits}.json?fields=product_name,product_name_pt,generic_name,brands,nutriments,serving_quantity,serving_size`)
      const food = foodFromOff(await r.json().catch(() => null), digits)
      if (!food) { toast(t('This product is not in Open Food Facts yet. Add it under Quick.')); return }
      update(s => { s.foods = [...(s.foods || []).filter(f => f.id !== food.id), food] })
      onPick(food)
    } catch { toast(t('Open Food Facts could not be reached. Try again.')) } finally { setBusy(false) }
  }
  const scan = async () => {
    if (!MOBILE) { setCamera(true); return }
    try { const hit = await (await import('../lib/scan.js')).scanCode(); if (hit) { setCode(hit.value); look(hit.value) } }
    catch { toast(t('The camera could not read the code. Type the numbers instead.')) }
  }
  if (camera) return <CameraScan products onFound={hit => { setCamera(false); setCode(hit.value); look(hit.value) }} onCancel={() => setCamera(false)} />
  return <>
    {canScan && <><Button variant="primary" icon="camera" onClick={scan}>{t('Scan barcode')}</Button><div style={{ height: 12 }} /></>}
    <label className="food-grams"><span>{t('Barcode number')}</span>
      <TextField value={code} inputMode="numeric" placeholder="7891000100103" onChange={e => setCode(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') look(code) }} /></label>
    <div style={{ height: 8 }} />
    <Button disabled={busy} onClick={() => look(code)}>{busy ? t('Looking it up…') : t('Look up')}</Button>
    <div className="small dim" style={{ marginTop: 8 }}>{t('Products come from Open Food Facts, a free and open database.')}{!canScan ? ' ' + t('This browser cannot read barcodes with the camera; type the numbers.') : ''}</div>
  </>
}

function PhotoTab({ d, slot, close }) {
  const user = useStore(s => s.user)
  const config = useStore(s => s.config)
  const ref = useRef(null)
  const gallery = useRef(null)
  const [busy, setBusy] = useState(false)
  if (!user || !config?.meals_ai) return <div className="muted small">{t('Estimating a meal from its photo needs the AI on your server (ANTHROPIC_API_KEY).')}</div>
  const onFiles = async ev => {
    const picked = [...(ev.target.files || [])].slice(0, 3)
    ev.target.value = ''
    if (!picked.length) return
    setBusy(true)
    try {
      const { ingestMediaFile } = await import('../lib/media-ingest.js')
      const outs = []
      for (const file of picked) {
        try { outs.push(await ingestMediaFile(file, limitsFrom(config))) } catch (e) { toast(mediaErrorText(e)) }
      }
      if (!outs.length) return
      // The first photo is kept with the meal; every one of them goes to the reading.
      for (const b of outs[0].blobs) await mediaStore.put(b.hash, b.blob, { mime: b.mime, pending: true })
      const meal = normalizeMeal({ id: uid(), d, slot, time: new Date().toTimeString().slice(0, 5), items: [], photo: outs[0].media })
      update(s => { s.meals = [...(s.meals || []), meal] })
      close()
      readMealInBackground(meal.id, outs.map(o => o.blobs.find(b => b.hash === o.media.hash)?.blob).filter(Boolean))
      toast(t('Estimating the meal. You can keep using the app; the foods are saved when ready.'))
    } finally { setBusy(false) }
  }
  return <>
    <div className="muted small" style={{ marginBottom: 12 }}>{t('Take a photo of the plate from above. The AI estimates each food and its amount; adjust the grams afterwards if needed.')}</div>
    <Button variant="primary" icon="camera" disabled={busy} onClick={() => ref.current?.click()}>{busy ? t('Preparing…') : t('Photo of the plate')}</Button>
    <Button icon="image" disabled={busy} onClick={() => gallery.current?.click()} style={{ marginTop: 8 }}>{t('From the gallery')}</Button>
    <input ref={ref} type="file" accept="image/*" capture="environment" multiple hidden onChange={onFiles} />
    {/* No capture attribute: the phone offers its photo library instead of opening the camera. */}
    <input ref={gallery} type="file" accept="image/*" multiple hidden onChange={onFiles} />
  </>
}

function QuickTab({ onAdd }) {
  const [f, setF] = useState({ name: '', kcal: null, p: null, c: null, f: null, grams: null, keep: false })
  const set = (k, v) => setF(x => ({ ...x, [k]: v }))
  const add = () => {
    const it = normalizeItem({ name: f.name, kcal: f.kcal, p: f.p, c: f.c, f: f.f, grams: f.grams })
    if (!it) { toast(t('Type a name and the calories.')); return }
    if (f.keep && f.grams > 0) {
      const k = 100 / f.grams
      const food = normalizeFood({ name: f.name, per100: { kcal: it.kcal * k, p: it.p * k, c: it.c * k, f: it.f * k }, serving: { g: f.grams, label: `${f.grams} g` } })
      if (food) { update(s => { s.foods = [...(s.foods || []), food] }); it.ref = food.id; it.src = 'mine' }
    }
    onAdd(it)
  }
  return <div className="med-form">
    <label><span>{t('Name')}</span><TextField value={f.name} maxLength={100} placeholder={t('e.g. Coffee with milk')} onChange={e => set('name', e.target.value)} /></label>
    <div className="food-macro-grid">
      <label><span>kcal</span><NumberField className="field" nullable value={f.kcal} onChange={v => set('kcal', v)} /></label>
      <label><span>{t('Amount (g)')}</span><NumberField className="field" nullable value={f.grams} onChange={v => set('grams', v)} /></label>
      <label><span>{t('Protein (g)')}</span><NumberField className="field" nullable value={f.p} onChange={v => set('p', v)} /></label>
      <label><span>{t('Carbs (g)')}</span><NumberField className="field" nullable value={f.c} onChange={v => set('c', v)} /></label>
      <label><span>{t('Fat (g)')}</span><NumberField className="field" nullable value={f.f} onChange={v => set('f', v)} /></label>
    </div>
    <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={f.keep} disabled={!(f.grams > 0)} onChange={e => set('keep', e.target.checked)} />
      <span className="small">{t('Save as one of my foods (needs the amount)')}</span></label>
    <Button variant="primary" icon="plus" onClick={add}>{t('Add')}</Button>
  </div>
}

function AddFood({ d, slot, close }) {
  const taco = useTaco()
  const usda = useUsda()
  const [tab, setTab] = useState('search')
  const [food, setFood] = useState(null)
  const [creating, setCreating] = useState(null)
  const [saved, setSaved] = useState(null)
  const done = items => { addItems(d, slot, items); close(); toast(t('Added to {0}', t(SLOT_LABEL[slot]))) }
  if (food) return <Amount food={food} onBack={() => setFood(null)} onAdd={it => done([it])} />
  if (creating != null) return <FoodForm name={creating} onBack={() => setCreating(null)} onSaved={f => { setCreating(null); setFood(f) }} />
  if (saved) return <SavedMealPick saved={saved} onBack={() => setSaved(null)} onAdd={done} />
  return <>
    <h3>{t('Add to {0}', t(SLOT_LABEL[slot]))}</h3>
    <Segmented value={tab} onChange={setTab} options={[{ value: 'search', label: t('Search') }, { value: 'meals', label: t('Meals') }, { value: 'barcode', label: t('Barcode') }, { value: 'photo', label: t('Photo') }, { value: 'quick', label: t('Quick') }]} />
    <div style={{ height: 12 }} />
    {tab === 'search' && <SearchTab taco={taco} usda={usda} onPick={setFood} onMeal={setSaved} onCreate={setCreating} />}
    {tab === 'meals' && <MealsTab onOpen={setSaved} />}
    {tab === 'barcode' && <BarcodeTab onPick={setFood} />}
    {tab === 'photo' && <PhotoTab d={d} slot={slot} close={close} />}
    {tab === 'quick' && <QuickTab onAdd={it => done([it])} />}
    <div style={{ height: 12 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
  </>
}

export const addFoodSheet = (d, slot) => ui().openSheet(close => <AddFood d={d} slot={slot} close={close} />)

/* ---------- editing ---------- */

function EditItem({ mealId, itemId, close }) {
  const meal = useStore(s => (s.S.meals || []).find(m => m.id === mealId))
  const item = meal?.items?.find(x => x.id === itemId)
  const [grams, setGrams] = useState(item?.grams || 0)
  const [slot, setSlot] = useState(meal?.slot || 'snack')
  if (!item) return <><h3>{t('Food')}</h3><div className="muted small">{t('This food was removed.')}</div><Button onClick={close}>{t('Close')}</Button></>
  const next = item.grams ? rescale(item, grams || 0) : item
  const save = () => {
    update(s => {
      const m = s.meals.find(x => x.id === mealId)
      if (!m) return
      if (slot === m.slot) { m.items = m.items.map(x => (x.id === itemId ? next : x)); return }
      // Moved to another meal of the day: out of this one, into that one's hand-typed meal.
      m.items = m.items.filter(x => x.id !== itemId)
      const into = s.meals.find(x => x.d === m.d && x.slot === slot && !x.photo && !x.ai)
      if (into) into.items = [...into.items, next]
      else s.meals.push(normalizeMeal({ d: m.d, slot, time: m.time, items: [next] }))
      if (!m.items.length && !m.photo) s.meals = s.meals.filter(x => x.id !== mealId)
    })
    close()
  }
  const remove = () => {
    update(s => {
      const m = s.meals.find(x => x.id === mealId)
      if (!m) return
      m.items = m.items.filter(x => x.id !== itemId)
      if (!m.items.length && !m.photo) s.meals = s.meals.filter(x => x.id !== mealId)
    })
    close()
    toast(t('Food removed'))
  }
  return <>
    <h3>{item.name}</h3>
    {item.src === 'ai' && <div className="small dim exam-ai-note"><Icon name="sparkles" /> {t('Estimated by AI. Adjust the grams if needed.')}</div>}
    {item.grams > 0 && <label className="food-grams"><span>{t('Amount (g)')}</span><NumberField className="field" value={grams} onChange={v => setGrams(v)} /></label>}
    <div className="food-preview">
      <b>{kcalText(next.kcal)}</b>
      <span>{t('P {0}', g(next.p))}</span><span>{t('C {0}', g(next.c))}</span><span>{t('F {0}', g(next.f))}</span>
    </div>
    <div className="sect-b" style={{ marginTop: 10 }}><SelectRow title={t('Meal')} sheetTitle={t('Meal')} value={slot} onChange={setSlot}
      options={SLOTS.map(s => ({ value: s, label: t(SLOT_LABEL[s]) }))} /></div>
    <div style={{ height: 12 }} />
    <Button variant="primary" onClick={save}>{t('Save')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="danger" icon="trash" onClick={remove}>{t('Remove')}</Button>
  </>
}

/* ---------- targets ---------- */

function Targets({ close }) {
  const S = useStore(s => s.S)
  const n = S.nutrition || {}
  const bw = lastBW(S)
  const weightKg = bw ? (S.unit === 'lb' ? bw.w / 2.20462 : bw.w) : null
  const [f, setF] = useState(() => ({
    birthYear: n.birthYear || null, heightCm: n.heightCm || null, activity: n.activity || 'moderate', objective: n.objective || 'maintain',
    kcal: n.targets?.kcal ?? null, p: n.targets?.p ?? null, c: n.targets?.c ?? null, f: n.targets?.f ?? null
  }))
  const set = (k, v) => setF(x => ({ ...x, [k]: v }))
  const suggestion = suggestTargets({ sex: S.body === 'female' ? 'female' : 'male', weightKg, heightCm: f.heightCm, birthYear: f.birthYear, activity: f.activity, objective: f.objective })
  const apply = () => { if (suggestion) setF(x => ({ ...x, kcal: suggestion.kcal, p: suggestion.p, c: suggestion.c, f: suggestion.f })) }
  const save = () => {
    if (!(f.kcal > 0)) { toast(t('Set the daily calories.')); return }
    update(s => {
      s.nutrition = {
        birthYear: f.birthYear || null, heightCm: f.heightCm || null, activity: f.activity, objective: f.objective,
        targets: { kcal: Math.round(f.kcal), p: Math.round(f.p || 0), c: Math.round(f.c || 0), f: Math.round(f.f || 0) },
        custom: !suggestion || suggestion.kcal !== Math.round(f.kcal) || suggestion.p !== Math.round(f.p || 0)
      }
    })
    close()
    toast(t('Targets saved'))
  }
  return <>
    <h3>{t('Daily targets')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>
      {weightKg ? t('Worked out from your last weight ({0} kg) and the details below. Change any number.', fmtNum(Math.round(weightKg * 10) / 10)) : t('Log your weight to get a suggestion, or type your targets.')}
    </div>
    <div className="med-form">
      <div className="food-macro-grid">
        <label><span>{t('Year of birth')}</span><NumberField className="field" nullable decimal={false} value={f.birthYear} onChange={v => set('birthYear', v)} /></label>
        <label><span>{t('Height (cm)')}</span><NumberField className="field" nullable decimal={false} value={f.heightCm} onChange={v => set('heightCm', v)} /></label>
      </div>
      <div className="sect-b">
        <SelectRow title={t('Activity')} sheetTitle={t('Activity')} value={f.activity} onChange={v => set('activity', v)} options={Object.keys(ACTIVITY).map(k => ({ value: k, label: t(ACTIVITY_LABEL[k]) }))} />
        <SelectRow title={t('Objective')} sheetTitle={t('Objective')} value={f.objective} onChange={v => set('objective', v)} options={Object.keys(OBJECTIVE).map(k => ({ value: k, label: t(OBJECTIVE_LABEL[k]) }))} />
      </div>
      {suggestion && <div className="food-suggest">
        <span className="small">{t('Suggested: {0} · P {1} · C {2} · F {3}', kcalText(suggestion.kcal), g(suggestion.p), g(suggestion.c), g(suggestion.f))}</span>
        <Button size="sm" onClick={apply}>{t('Use')}</Button>
      </div>}
      <div className="food-macro-grid">
        <label><span>kcal</span><NumberField className="field" nullable decimal={false} value={f.kcal} onChange={v => set('kcal', v)} /></label>
        <label><span>{t('Protein (g)')}</span><NumberField className="field" nullable decimal={false} value={f.p} onChange={v => set('p', v)} /></label>
        <label><span>{t('Carbs (g)')}</span><NumberField className="field" nullable decimal={false} value={f.c} onChange={v => set('c', v)} /></label>
        <label><span>{t('Fat (g)')}</span><NumberField className="field" nullable decimal={false} value={f.f} onChange={v => set('f', v)} /></label>
      </div>
    </div>
    <div style={{ height: 12 }} />
    <Button variant="primary" onClick={save}>{t('Save')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
  </>
}

export const targetsSheet = () => ui().openSheet(close => <Targets close={close} />)

/* ---------- my foods and saved meals ---------- */

function SaveMealForm({ mealId, close }) {
  const meal = useStore(s => (s.S.meals || []).find(m => m.id === mealId))
  const [name, setName] = useState(meal?.title || '')
  if (!meal) return <><h3>{t('Save as a meal')}</h3><div className="muted small">{t('This meal was removed.')}</div><Button onClick={close}>{t('Close')}</Button></>
  const save = () => {
    const saved = savedMealFrom(meal, name.trim() || meal.title || t(SLOT_LABEL[meal.slot]))
    if (!saved) return
    update(s => { s.savedMeals = [...(s.savedMeals || []), saved] })
    close()
    toast(t('Meal saved'))
  }
  return <>
    <h3>{t('Save as a meal')}</h3>
    <div className="muted small" style={{ marginBottom: 10 }}>{(meal.items || []).map(x => x.name).join(', ')}</div>
    <div className="med-form"><label><span>{t('Name')}</span><TextField value={name} maxLength={80} autoFocus placeholder={t('e.g. Sunday lunch')} onChange={e => setName(e.target.value)} /></label></div>
    <div style={{ height: 12 }} />
    <Button variant="primary" onClick={save}>{t('Save')}</Button>
  </>
}
const saveMealSheet = mealId => ui().openSheet(close => <SaveMealForm mealId={mealId} close={close} />)

function SavedMealEdit({ saved, onBack }) {
  const [name, setName] = useState(saved.name)
  const save = () => {
    const n = name.trim()
    if (!n) return
    update(s => { const m = (s.savedMeals || []).find(x => x.id === saved.id); if (m) m.name = n.slice(0, 80) })
    toast(t('Meal saved')); onBack()
  }
  const remove = () => confirmSheet({ title: t('Delete this saved meal?'), message: t('Days already logged keep their foods.'), confirmText: t('Delete'), danger: true,
    onConfirm: () => { update(s => { s.savedMeals = (s.savedMeals || []).filter(x => x.id !== saved.id) }); toast(t('Saved meal deleted')); onBack() } })
  return <>
    <h3>{saved.name}</h3>
    <div className="med-form"><label><span>{t('Name')}</span><TextField value={name} maxLength={80} onChange={e => setName(e.target.value)} /></label></div>
    <div style={{ height: 10 }} />
    <Section>{saved.items.map((x, i) => <Row key={i} title={x.name} subtitle={x.grams ? `${fmtNum(x.grams)} g` : ''} value={kcalText(x.kcal)} />)}</Section>
    <div style={{ height: 12 }} />
    <Button variant="primary" onClick={save}>{t('Save')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="danger" icon="trash" onClick={remove}>{t('Delete saved meal')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={onBack}>{t('Back')}</Button>
  </>
}

function MyFoods({ close }) {
  const S = useStore(s => s.S)
  const [tab, setTab] = useState('foods')
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState(null)
  const [creating, setCreating] = useState(false)
  const [meal, setMeal] = useState(null)
  const uses = useMemo(() => usageCounts(S.meals), [S.meals])
  if (editing) return <FoodForm prev={editing} onBack={() => setEditing(null)} onSaved={() => setEditing(null)} />
  if (creating) return <FoodForm name={q.trim()} onBack={() => setCreating(false)} onSaved={() => setCreating(false)} />
  if (meal) return <SavedMealEdit saved={meal} onBack={() => setMeal(null)} />
  const foods = searchFoods(q, { mine: S.foods || [], uses, limit: 500 })
  const meals = searchSavedMeals(q, S.savedMeals, { limit: 200 })
  return <>
    <h3>{t('My foods')}</h3>
    <Segmented value={tab} onChange={setTab} options={[{ value: 'foods', label: t('Foods') }, { value: 'meals', label: t('Meals') }]} />
    <div className="exam-search" style={{ margin: '10px 0' }}>
      <Icon name="magnifier" />
      <input type="search" value={q} placeholder={t('Search')} aria-label={t('Search')} onChange={e => setQ(e.target.value)} />
    </div>
    {tab === 'foods' ? <>
      {foods.length ? <Section>{foods.map(f => <Row key={f.id} title={f.name}
        subtitle={[f.brand, t('{0} per 100 g', kcalText(f.per100.kcal)), f.serving?.label].filter(Boolean).join(' · ')}
        value={uses.get(f.id) ? t('{0}×', uses.get(f.id)) : ''} accessory="chevron" onClick={() => setEditing(f)}>
        {f.src === 'ai' && <span className="exam-ai"><Icon name="sparkles" /></span>}</Row>)}</Section>
        : <div className="muted small">{q ? t('Nothing matches.') : t('No foods of your own yet. Foods from photos, barcodes and the ones you create show up here.')}</div>}
      <div style={{ height: 10 }} />
      <Button icon="plus" onClick={() => setCreating(true)}>{t('Create food')}</Button>
    </> : meals.length ? <Section>{meals.map(m => mealRow(m, setMeal))}</Section>
      : <div className="muted small">{q ? t('Nothing matches.') : t('No saved meals yet. Plates read from a photo are saved here, and any meal of the day can be saved from its list.')}</div>}
    <div style={{ height: 12 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Close')}</Button>
  </>
}
export const myFoodsSheet = () => ui().openSheet(close => <MyFoods close={close} />)

/* ---------- the screen ---------- */

function Bar({ label, value, target }) {
  const pct = target > 0 ? Math.min(100, (value / target) * 100) : 0
  const over = target > 0 && value > target * 1.05
  return <div className="food-bar">
    <div className="row between small"><span>{label}</span><span className="dim">{target > 0 ? `${g(value)} / ${g(target)}` : g(value)}</span></div>
    <div className="food-track"><div className={'food-fill' + (over ? ' over' : '')} style={{ width: pct + '%' }} /></div>
  </div>
}

function MealPhoto({ photo }) {
  const { url } = useMediaUrl(photo)
  return url ? <img className="food-photo" src={url} alt="" /> : null
}

function MealBlock({ meal }) {
  const reading = useReadingMeal(meal.id)
  return <>
    {meal.photo && <div className="food-meal-head">
      <MealPhoto photo={meal.photo} />
      <div className="small">
        {reading ? <span className="exam-ai busy"><Icon name="sparkles" /> {t('Estimating the meal…')}</span>
          : <>{meal.title && <b>{meal.title}</b>}{meal.ai > 0 && <div className="dim">{t('Estimated by AI. Adjust the grams if needed.')}</div>}</>}
      </div>
    </div>}
    {(meal.items || []).map(it => <Row key={it.id} title={it.name} subtitle={[it.grams ? `${fmtNum(it.grams)} g` : null, `P ${fmtNum(it.p)} · C ${fmtNum(it.c)} · F ${fmtNum(it.f)}`].filter(Boolean).join(' · ')}
      value={kcalText(it.kcal)} onClick={() => ui().openSheet(close => <EditItem mealId={meal.id} itemId={it.id} close={close} />)}>
      {it.src === 'ai' && <span className="exam-ai"><Icon name="sparkles" /></span>}
    </Row>)}
    {(meal.items || []).length > 0 && !reading && <Row icon="list" iconTint="var(--orange)" title={t('Save as a meal')} subtitle={t('To add it again, whole or in part')}
      className="food-save-meal" onClick={() => saveMealSheet(meal.id)} />}
    {meal.photo && !reading && !(meal.items || []).length && <Row title={t('No food estimated')} subtitle={t('Add the foods by hand, or delete this photo.')}
      onClick={() => confirmSheet({ title: t('Delete this meal?'), message: t('Deletes the photo and the meal.'), confirmText: t('Delete'), danger: true,
        onConfirm: () => update(s => { s.meals = s.meals.filter(x => x.id !== meal.id) }) })} />}
  </>
}

function Day({ d, setD }) {
  const S = useStore(s => s.S)
  const day = dayOf(S.meals, d)
  const tg = S.nutrition?.targets
  const today = todayISO()
  const left = tg?.kcal ? tg.kcal - day.total.kcal : null
  return <>
    <div className="food-daynav">
      <button className="iconbtn" onClick={() => setD(addDays(d, -1))} aria-label={t('Previous day')}><Icon name="chevronLeft" /></button>
      <button className="food-daylabel" onClick={() => setD(today)}>{d === today ? t('Today') : fmtDate(d, true)}</button>
      <button className="iconbtn" disabled={d >= today} onClick={() => setD(addDays(d, 1))} aria-label={t('Next day')}><Icon name="chevronRight" /></button>
    </div>
    <div className="card">
      <div className="row between">
        <div>
          <div className="muted small">{t('Eaten')}</div>
          <div className="big">{fmtNum(day.total.kcal)} <span className="muted" style={{ fontSize: '1rem' }}>{tg?.kcal ? `/ ${fmtNum(tg.kcal)} kcal` : 'kcal'}</span></div>
          {left != null && <div className="small" style={{ color: left < 0 ? 'var(--red)' : 'var(--label-2)' }}>{left >= 0 ? t('{0} left', kcalText(left)) : t('{0} over', kcalText(-left))}</div>}
        </div>
        {!tg?.kcal && <Button size="sm" icon="target" onClick={targetsSheet}>{t('Set targets')}</Button>}
      </div>
      <Bar label={t('Protein')} value={day.total.p} target={tg?.p} />
      <Bar label={t('Carbs')} value={day.total.c} target={tg?.c} />
      <Bar label={t('Fat')} value={day.total.f} target={tg?.f} />
    </div>
    {SLOTS.map(slot => <div key={slot}>
      <div className="row between" style={{ margin: '16px 2px 8px' }}>
        <h4 className="sec" style={{ margin: 0 }}>{t(SLOT_LABEL[slot])}{day.bySlot[slot].kcal ? ` · ${kcalText(day.bySlot[slot].kcal)}` : ''}</h4>
        <button className="iconbtn" onClick={() => addFoodSheet(d, slot)} aria-label={t('Add to {0}', t(SLOT_LABEL[slot]))}><Icon name="plus" /></button>
      </div>
      {day.meals[slot].length ? <Section>{day.meals[slot].map(m => <MealBlock key={m.id} meal={m} />)}</Section>
        : <button className="food-empty" onClick={() => addFoodSheet(d, slot)}>{t('Add food')}</button>}
    </div>)}
  </>
}

function Trends() {
  const S = useStore(s => s.S)
  const [range, setRange] = useState(7)
  const to = todayISO()
  const s = dailySeries(S.meals, addDays(to, -(range - 1)), to)
  const tg = S.nutrition?.targets
  const points = s.days.filter(x => x.logged).map(x => ({ t: Date.parse(x.d + 'T12:00:00'), y: x.kcal, d: x.d }))
  return <>
    <Segmented className="seg-range" value={range} onChange={setRange} options={[{ value: 7, label: '7D' }, { value: 30, label: '30D' }, { value: 90, label: '90D' }]} />
    <div className="card" style={{ marginTop: 12 }}>
      <div className="muted small">{t('Daily average (days logged)')}</div>
      {s.avg ? <>
        <div className="big">{fmtNum(s.avg.kcal)} <span className="muted" style={{ fontSize: '1rem' }}>kcal</span></div>
        <div className="small dim">{t('P {0}', g(s.avg.p))} · {t('C {0}', g(s.avg.c))} · {t('F {0}', g(s.avg.f))} · {t('{0} days logged', s.days.filter(x => x.logged).length)}</div>
      </> : <div className="muted small" style={{ marginTop: 6 }}>{t('Nothing logged in this period.')}</div>}
      {points.length > 1 && <div className="chart" style={{ marginTop: 10 }}><LineChart points={points} h={170} unit="kcal" color="var(--orange)" goal={tg?.kcal} /></div>}
    </div>
  </>
}

export default function Food() {
  const nav = useNavigate()
  // Foods of photo estimates made before they were kept among my foods: kept now, once,
  // And their plates among the saved meals.
  useEffect(() => {
    const { S } = useStore.getState()
    if (keepEstimatedFoods(S.meals, S.foods).changed) update(s => { const r = keepEstimatedFoods(s.meals, s.foods); s.meals = r.meals; s.foods = r.foods })
    if (savedFromEstimates(useStore.getState().S.meals, useStore.getState().S.savedMeals).length) {
      update(s => { s.savedMeals = [...(s.savedMeals || []), ...savedFromEstimates(s.meals, s.savedMeals)] })
    }
  }, [])
  const [tab, setTab] = useState('day')
  const [d, setD] = useState(todayISO())
  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/health')} aria-label={t('Health')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 10 }}><h1>{t('Nutrition')}</h1><div className="sub">{t('Meals, calories and macros')}</div></div>
      <button className="iconbtn" onClick={myFoodsSheet} aria-label={t('My foods')}><Icon name="list" /></button>
      <button className="iconbtn" onClick={targetsSheet} aria-label={t('Daily targets')}><Icon name="target" /></button>
    </div>
    <Segmented value={tab} onChange={setTab} options={[{ value: 'day', label: t('Day') }, { value: 'trends', label: t('Over time') }]} />
    <div style={{ height: 12 }} />
    {tab === 'day' ? <Day d={d} setD={setD} /> : <Trends />}
  </div>
}

/** Today's calories against the target, for the Health hub and the Home card. */
export function foodToday(S, d = todayISO()) {
  const total = dayOf(S.meals, d).total
  return { kcal: total.kcal, target: S.nutrition?.targets?.kcal || null, logged: (S.meals || []).some(m => m?.d === d && (m.items || []).length) }
}
