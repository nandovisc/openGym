import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { healthOn } from '../lib/modules.js'
import { t } from '../lib/i18n.js'

// The Training tab's pages, as tabs across its top: the week, the plan, the exercises and the
// stats. Each keeps its own route (/training, /plan, /library, /stats), so every link into them
// still lands. Only with the new navigation (lib/modules.js healthOn): training-only, those four
// are tabs of the bar themselves.
const PAGES = [['/training', 'Week'], ['/plan', 'Plan'], ['/library', 'Exercises'], ['/stats', 'Stats']]
export default function TrainingNav() {
  const nav = useNavigate()
  const on = useStore(s => healthOn(s.S))
  if (!on) return null
  // Read off the address (the app routes by hash): the page around it remounts on every route
  // change (App.jsx keys #app on the path), so there is nothing to subscribe to.
  const path = (typeof location !== 'undefined' ? location.hash : '').replace(/^#/, '').split('?')[0]
  const cur = PAGES.findIndex(([p]) => path === p || path.startsWith(p + '/'))
  return <nav className="seg training-nav" style={{ '--n': PAGES.length, '--i': Math.max(0, cur) }} aria-label={t('Training')}>
    <span className="seg-sel" aria-hidden="true" />
    {PAGES.map(([p, label], i) => <button key={p} className={i === cur ? 'on' : ''} aria-current={i === cur ? 'page' : undefined} onClick={() => nav(p)}>
      <span>{t(label)}</span>
    </button>)}
  </nav>
}
