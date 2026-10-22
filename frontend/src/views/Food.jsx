import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import {
  ACTIVITY, OBJECTIVE, SLOTS, dailySeries, dayOf, foodFromOff, foodsFromItems, itemOf, itemsFromReading, normalizeFood, normalizeItem,
  normalizeMeal, recentFoods, rescale, searchFoods, suggestTargets
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

const SLOT_LABEL = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snacks' }
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
    <label className="food-grams"><span>{t('Amount (g)')}</span><NumberField value={grams} onChange={v => setGrams(v)} /></label>
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

function SearchTab({ taco, onPick }) {
  const S = useStore(s => s.S)
  const [q, setQ] = useState('')
  const mine = useMemo(() => {
    const recent = recentFoods(S.meals, S.foods, { taco: taco || [] })
    const own = (S.foods || []).filter(f => !recent.some(r => r.id === f.id))
    return [...recent, ...own]
  }, [S.meals, S.foods, taco])
  const found = useMemo(() => searchFoods(q, { taco: taco || [], mine }), [q, taco, mine])
  return <>
    <div className="exam-search" style={{ marginBottom: 10 }}>
      <Icon name="magnifier" />
      <input type="search" autoFocus value={q} placeholder={t('Search foods')} aria-label={t('Search foods')} onChange={e => setQ(e.target.value)} />
    </div>
    {!taco && <div className="muted small">{t('Loading…')}</div>}
    {taco && !q && !mine.length && <div className="muted small">{t('Type a food: rice, beans, chicken… The table has about 600 Brazilian foods.')}</div>}
    {!!q && taco && !found.length && <div className="muted small">{t('Nothing matches.')}</div>}
    {(!q && mine.length > 0) && <h4 className="sec" style={{ margin: '6px 2px' }}>{t('Recent and my foods')}</h4>}
    <Section>{found.map(f => <Row key={f.id} title={f.name} subtitle={[f.brand, t('{0} per 100 g', kcalText(f.per100.kcal)), f.src === 'taco' ? 'TACO' : null].filter(Boolean).join(' · ')}
      accessory="chevron" onClick={() => onPick(f)}>{f.src === 'ai' && <span className="exam-ai"><Icon name="sparkles" /></span>}</Row>)}</Section>
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
      <label><span>kcal</span><NumberField nullable value={f.kcal} onChange={v => set('kcal', v)} /></label>
      <label><span>{t('Amount (g)')}</span><NumberField nullable value={f.grams} onChange={v => set('grams', v)} /></label>
      <label><span>{t('Protein (g)')}</span><NumberField nullable value={f.p} onChange={v => set('p', v)} /></label>
      <label><span>{t('Carbs (g)')}</span><NumberField nullable value={f.c} onChange={v => set('c', v)} /></label>
      <label><span>{t('Fat (g)')}</span><NumberField nullable value={f.f} onChange={v => set('f', v)} /></label>
    </div>
    <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={f.keep} disabled={!(f.grams > 0)} onChange={e => set('keep', e.target.checked)} />
      <span className="small">{t('Save as one of my foods (needs the amount)')}</span></label>
    <Button variant="primary" icon="plus" onClick={add}>{t('Add')}</Button>
  </div>
}

function AddFood({ d, slot, close }) {
  const taco = useTaco()
  const [tab, setTab] = useState('search')
  const [food, setFood] = useState(null)
  const done = items => { addItems(d, slot, items); close(); toast(t('Added to {0}', t(SLOT_LABEL[slot]))) }
  if (food) return <Amount food={food} onBack={() => setFood(null)} onAdd={it => done([it])} />
  return <>
    <h3>{t('Add to {0}', t(SLOT_LABEL[slot]))}</h3>
    <Segmented value={tab} onChange={setTab} options={[{ value: 'search', label: t('Search') }, { value: 'barcode', label: t('Barcode') }, { value: 'photo', label: t('Photo') }, { value: 'quick', label: t('Quick') }]} />
    <div style={{ height: 12 }} />
    {tab === 'search' && <SearchTab taco={taco} onPick={setFood} />}
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
    {item.grams > 0 && <label className="food-grams"><span>{t('Amount (g)')}</span><NumberField value={grams} onChange={v => setGrams(v)} /></label>}
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
        <label><span>{t('Year of birth')}</span><NumberField nullable decimal={false} value={f.birthYear} onChange={v => set('birthYear', v)} /></label>
        <label><span>{t('Height (cm)')}</span><NumberField nullable decimal={false} value={f.heightCm} onChange={v => set('heightCm', v)} /></label>
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
        <label><span>kcal</span><NumberField nullable decimal={false} value={f.kcal} onChange={v => set('kcal', v)} /></label>
        <label><span>{t('Protein (g)')}</span><NumberField nullable decimal={false} value={f.p} onChange={v => set('p', v)} /></label>
        <label><span>{t('Carbs (g)')}</span><NumberField nullable decimal={false} value={f.c} onChange={v => set('c', v)} /></label>
        <label><span>{t('Fat (g)')}</span><NumberField nullable decimal={false} value={f.f} onChange={v => set('f', v)} /></label>
      </div>
    </div>
    <div style={{ height: 12 }} />
    <Button variant="primary" onClick={save}>{t('Save')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
  </>
}

export const targetsSheet = () => ui().openSheet(close => <Targets close={close} />)

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
  const [tab, setTab] = useState('day')
  const [d, setD] = useState(todayISO())
  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/health')} aria-label={t('Health')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 10 }}><h1>{t('Nutrition')}</h1><div className="sub">{t('Meals, calories and macros')}</div></div>
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
