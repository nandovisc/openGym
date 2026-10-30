import { useEffect, useRef, useState } from 'react'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { Button } from './ui.jsx'
import { MOBILE } from '../lib/mobile.js'

// "Add to Home Screen" on an iPhone, shown rather than told (Login.jsx, for Safari on iOS): a
// drawn iPhone runs the five steps in Safari — Share, the action in the list, Add, the icon —
// while the step's words sit under it. The same animation is on the project site
// (website/iphone.html). Nothing here is stored; the phone is drawn at 300×630 and scaled.

const W = 300, H = 630
const ICON = 'icon-180.png'
// Steps are numbered for a reason: the order is the instruction.
const STEPS = [
  { title: () => t('Open openGym in Safari'), body: () => t('It has to be Safari: it is the browser that puts the icon on the Home Screen.') },
  { title: () => t('Tap Share'), body: () => t('The square with the arrow pointing up, in the middle of the bottom bar.') },
  { title: () => t('Choose “Add to Home Screen”'), body: () => t('Scroll the list of actions down to the one with the “+” icon.') },
  { title: () => t('Tap Add'), body: () => t('The name is already openGym. Leave “Open as Web App” on and tap Add, at the top.') },
  { title: () => t('Open it from the icon'), body: () => t('The green dumbbell is on your Home Screen. From there openGym opens full screen, like an app.') }
]
const LENGTH = [2600, 2600, 3600, 3400, 4400]

function Phone({ host }) {
  return <div className="ig-phone"><div className="ig-screen" data-screen>
    <div className="ig-island" />
    <div className="ig-status" data-status><span>9:41</span><span className="ig-bat" /></div>

    <div className="ig-view" data-view="0">
      <div className="ig-site"><img src={ICON} alt="" /><b>openGym</b><span>{t('Your workouts. Your weights. Your profile.')}</span><i>{t('Sign in with passkey')}</i></div>
      <div className="ig-bar">
        <div className="ig-url"><svg viewBox="0 0 12 12" fill="currentColor"><rect x="2" y="5" width="8" height="6" rx="1.5" /><path d="M3.8 5V3.6a2.2 2.2 0 0 1 4.4 0V5" fill="none" stroke="currentColor" strokeWidth="1.3" /></svg>{host}</div>
        <div className="ig-tools">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M15 5l-7 7 7 7" /></svg>
          <svg className="ig-dim" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M9 5l7 7-7 7" /></svg>
          <svg data-target="share" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12M8 7l4-4 4 4" /><path d="M8 10H6.5A1.5 1.5 0 0 0 5 11.5v8A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5v-8A1.5 1.5 0 0 0 17.5 10H16" /></svg>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"><path d="M4 5.5C6.5 4 9.5 4 12 6c2.5-2 5.5-2 8-.5V19c-2.5-1.5-5.5-1.5-8 .5-2.5-2-5.5-2-8-.5Z" /><path d="M12 6v13.5" /></svg>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="4" y="7" width="12" height="12" rx="2" /><path d="M8 4h10a2 2 0 0 1 2 2v10" /></svg>
        </div>
      </div>
    </div>

    <div className="ig-view ig-off" data-view="1">
      <div className="ig-dimmer" />
      <div className="ig-sheet">
        <div className="ig-sh-head"><img src={ICON} alt="" /><div>openGym<br /><small>{host}</small></div></div>
        <div className="ig-apps"><span style={{ '--c': '#0a84ff' }}>AirDrop</span><span style={{ '--c': '#34c759' }}>{t('Messages')}</span><span style={{ '--c': '#5ac8fa' }}>Mail</span><span style={{ '--c': '#ffcc00' }}>{t('Notes')}</span></div>
        <div className="ig-list-mask"><div className="ig-list" data-list>
          <div className="ig-group">
            <div className="ig-row">{t('Copy')}</div>
            <div className="ig-row">{t('Add to Reading List')}</div>
            <div className="ig-row">{t('Add Bookmark')}</div>
            <div className="ig-row">{t('Find on Page')}</div>
            <div className="ig-row" data-target="a2hs">{t('Add to Home Screen')}<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="4" y="4" width="16" height="16" rx="3.5" /><path d="M12 8v8M8 12h8" /></svg></div>
          </div>
          <div className="ig-group"><div className="ig-row">{t('Print')}</div><div className="ig-row">{t('Edit Actions…')}</div></div>
        </div></div>
      </div>
    </div>

    <div className="ig-view ig-off" data-view="2">
      <div className="ig-dialog">
        <div className="ig-nav"><span className="ig-c">{t('Cancel')}</span><span className="ig-t">{t('Home Screen')}</span><span className="ig-a" data-target="add">{t('Add')}</span></div>
        <div className="ig-card"><img src={ICON} alt="" /><div className="ig-field">openGym<span className="ig-caret" /></div><small>{host}</small></div>
        <div className="ig-toggle">{t('Open as Web App')}<span className="ig-sw" /></div>
        <div className="ig-kbd">{[10, 9, 7].map((n, i) => <div key={i}>{Array.from({ length: n }, (_, j) => <span key={j} />)}</div>)}</div>
      </div>
    </div>

    <div className="ig-view ig-off" data-view="3">
      <div className="ig-home">
        <div className="ig-grid">
          {['#ff9f0a', '#34c759', '#0a84ff', '#5e5ce6', '#ff375f', '#64d2ff', '#30b0c7', '#8e8e93'].map(c => <div key={c} className="ig-app"><i style={{ '--c': c }} /></div>)}
          <div className="ig-app ig-new" data-target="icon"><img src={ICON} alt="" />openGym</div>
        </div>
        <div className="ig-dock">{['#34c759', '#0a84ff', '#ff9f0a', '#5ac8fa'].map(c => <i key={c} style={{ '--c': c }} />)}</div>
      </div>
      <div className="ig-launched" data-launched><img src={ICON} alt="" /><b>openGym</b><span className="ig-badge">{t('Full screen, without Safari')}</span></div>
    </div>

    <div className="ig-finger" data-finger />
  </div></div>
}

export function InstallGuide({ close }) {
  const box = useRef(null)
  const still = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
  const [step, setStep] = useState(0)
  const [playing, setPlaying] = useState(!still)
  const [scale, setScale] = useState(0.8)
  const host = typeof location !== 'undefined' && location.host ? location.host : 'opengym'

  useEffect(() => {
    const fit = () => setScale(Math.min(1, (box.current?.getBoundingClientRect().width || W * 0.72) / W, 0.72))
    fit()
    addEventListener('resize', fit)
    return () => removeEventListener('resize', fit)
  }, [])

  // Each step leaves the phone in its own finished state, so going straight to one looks right.
  useEffect(() => {
    const root = box.current
    if (!root) return
    const q = s => root.querySelector(s)
    const views = [...root.querySelectorAll('[data-view]')]
    const finger = q('[data-finger]'), list = q('[data-list]'), status = q('[data-status]')
    const timers = []
    const later = (ms, fn) => timers.push(setTimeout(fn, still ? 0 : ms))
    const show = v => views.forEach((el, i) => el.classList.toggle('ig-off', i !== v))
    const move = (x, y) => { finger.style.transform = `translate(${x}px, ${y}px)` }
    const moveTo = name => {
      const s = q('[data-screen]').getBoundingClientRect(), r = q(`[data-target="${name}"]`).getBoundingClientRect(), k = s.width / (W - 22)
      move((r.left + r.width / 2 - s.left) / k, (r.top + r.height / 2 - s.top) / k)
    }
    const tap = name => {
      finger.classList.remove('ig-tap'); void finger.offsetWidth; finger.classList.add('ig-tap')
      const el = name && q(`[data-target="${name}"]`)
      if (el) { el.classList.add('ig-hit'); later(380, () => el.classList.remove('ig-hit')) }
    }
    const on = v => finger.classList.toggle('ig-on', v)
    finger.classList.remove('ig-on', 'ig-tap')
    q('[data-target="share"]').classList.remove('ig-ring')
    list.style.transform = ''
    q('[data-target="icon"]').classList.remove('ig-in')
    q('[data-launched]').classList.remove('ig-in')
    status.style.color = ''
    const run = [
      () => { show(0); move(140, 380); later(900, () => on(true)); later(1600, () => move(140, 300)) },
      () => {
        show(0); on(true); move(140, 380)
        later(300, () => { q('[data-target="share"]').classList.add('ig-ring'); moveTo('share') })
        later(1300, () => tap())
        later(1700, () => { q('[data-target="share"]').classList.remove('ig-ring'); show(1); on(false) })
      },
      () => {
        show(1); on(true); move(210, 520)
        later(500, () => { list.style.transform = 'translateY(-70px)'; move(210, 420) })
        later(1500, () => moveTo('a2hs'))
        later(2300, () => tap('a2hs'))
        later(2800, () => { show(2); on(false) })
      },
      () => {
        show(2); on(true); move(140, 300)
        later(700, () => moveTo('add'))
        later(1600, () => tap('add'))
        later(2100, () => { show(3); status.style.color = '#fff'; on(false); later(500, () => q('[data-target="icon"]').classList.add('ig-in')) })
      },
      () => {
        show(3); status.style.color = '#fff'; q('[data-target="icon"]').classList.add('ig-in'); on(true); move(190, 400)
        later(1000, () => moveTo('icon'))
        later(1900, () => tap('icon'))
        later(2200, () => { q('[data-launched]').classList.add('ig-in'); status.style.color = '#eef0e8'; on(false) })
      }
    ]
    run[step]()
    if (playing) later(LENGTH[step], () => setStep(s => (s + 1) % STEPS.length))
    return () => timers.forEach(clearTimeout)
  }, [step, playing])

  const goTo = i => { setPlaying(false); setStep((i + STEPS.length) % STEPS.length) }
  const s = STEPS[step]
  return <div className="ig">
    <h3>{t('Put openGym on your Home Screen')}</h3>
    <div className="ig-box" ref={box} style={{ height: H * scale }}>
      <div className="ig-scaler" style={{ transform: `scale(${scale})` }}><Phone host={host} /></div>
    </div>
    <div className="ig-dots" role="tablist" aria-label={t('Steps')}>
      {STEPS.map((x, i) => <button key={i} type="button" role="tab" aria-selected={i === step} aria-label={t('Step {0}', i + 1)} className={i === step ? 'on' : i < step ? 'done' : ''} onClick={() => goTo(i)} />)}
    </div>
    <div className="ig-step" aria-live="polite">
      <div className="ig-n">{step + 1}</div>
      <div><b>{s.title()}</b><span>{s.body()}</span></div>
    </div>
    <div className="ig-controls">
      <Button size="sm" onClick={() => goTo(step - 1)}>{t('Back')}</Button>
      <Button size="sm" variant="tinted" onClick={() => setPlaying(p => !p)}>{playing ? t('Pause') : t('Play')}</Button>
      <Button size="sm" onClick={() => goTo(step + 1)}>{t('Next')}</Button>
    </div>
    <div className="small dim ig-tip">{t('No option there? Scroll to the end of the list, or tap “Edit Actions…” and switch “Add to Home Screen” on.')}</div>
    <Button variant="ghost" className="dim" onClick={close}>{t('Close')}</Button>
  </div>
}

// An iPhone or iPad in its browser, not yet opened from the Home Screen: who the guide is for.
// iPadOS says Macintosh, so a Mac with a touch screen is read as an iPad.
export function wantsInstallGuide(nav = typeof navigator !== 'undefined' ? navigator : {}, win = typeof window !== 'undefined' ? window : {}) {
  if (MOBILE) return false
  const ua = String(nav.userAgent || '')
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && nav.maxTouchPoints > 1)
  if (!ios) return false
  try { return !(nav.standalone === true || win.matchMedia?.('(display-mode: standalone)').matches) } catch { return true }
}

export const installGuideSheet = () => useUI.getState().openSheet(close => <InstallGuide close={close} />)
