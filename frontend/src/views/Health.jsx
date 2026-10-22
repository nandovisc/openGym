import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { doseState, dosesOn, hhmmOf } from '../lib/meds.js'
import { examsByDate, outOfRange } from '../lib/exams.js'
import { foodToday } from './Food.jsx'
import { sleepLast } from './Sleep.jsx'
import { lastBW } from '../lib/history.js'
import { fmtDate, fmtDur, fmtNum, todayISO } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import Icon from '../components/Icon.jsx'
import { Row, Section } from '../components/ui.jsx'
import { weighInsSheet } from '../sheets.jsx'

/** "2 of 3 doses taken today", or what is next, for the Health hub and the Home card. */
export function medsToday(S, now = { d: todayISO(), hhmm: hhmmOf() }) {
  const doses = dosesOn(S.meds, S.medLog, now.d)
  const taken = doses.filter(x => x.entry?.status === 'taken').length
  const open = doses.filter(x => !x.entry)
  const late = open.filter(x => doseState(x, now) === 'late').length
  return { total: doses.length, taken, late, next: open[0] || null }
}

// Health: every record of the body that is not a workout, one place to reach them from. Body
// weight and measurements are the screens that were there already; medications and exams are
// new, and so is nutrition.
export default function Health() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const meds = medsToday(S)
  const bw = lastBW(S)
  const lastMeasure = (S.measurements || []).at(-1)
  const lastExam = examsByDate(S.exams)[0]
  const food = foodToday(S)
  const sleep = sleepLast(S)
  const medsSub = !(S.meds || []).length ? t('Add what you take and get reminded')
    : !meds.total ? t('Nothing scheduled today')
      : [t('{0} of {1} doses taken today', meds.taken, meds.total), meds.late ? t('{0} late', meds.late) : null].filter(Boolean).join(' · ')

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/home')} aria-label={t('Home')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 10 }}><h1>{t('Health')}</h1><div className="sub">{t('Medications, body and more')}</div></div>
    </div>
    <Section>
      <Row icon="pill" iconTint="var(--teal)" title={t('Medications')} subtitle={medsSub} accessory="chevron" onClick={() => nav('/health/meds')} />
      <Row icon="doc" iconTint="var(--red)" title={t('Medical exams')}
        subtitle={lastExam ? [fmtDate(lastExam.d, true), lastExam.title, outOfRange(lastExam) ? t('{0} out of range', outOfRange(lastExam)) : null].filter(Boolean).join(' · ') : t('Lab reports read for you, results over time')}
        accessory="chevron" onClick={() => nav('/health/exams')} />
      <Row icon="flame" iconTint="var(--orange)" title={t('Nutrition')}
        subtitle={food.logged ? (food.target ? t('{0} of {1} kcal today', fmtNum(food.kcal), fmtNum(food.target)) : t('{0} kcal today', fmtNum(food.kcal))) : t('Meals, calories and macros')}
        accessory="chevron" onClick={() => nav('/health/food')} />
      <Row icon="moon" iconTint="var(--indigo)" title={t('Sleep')}
        subtitle={sleep ? `${t('Last night: {0}', fmtDur(sleep.min * 60000))} · ${sleep.bed} → ${sleep.wake}` : t('Your nights, from Apple Health or by hand')}
        accessory="chevron" onClick={() => nav('/health/sleep')} />
      <Row icon="scale" iconTint="var(--blue)" title={t('Body weight')}
        subtitle={bw ? `${fmtNum(bw.w)} ${S.unit} · ${fmtDate(bw.d, true)}` : t('No weigh-ins yet')} accessory="chevron" onClick={weighInsSheet} />
      <Row icon="ruler" iconTint="var(--indigo)" title={t('Body measurements')}
        subtitle={lastMeasure ? fmtDate(lastMeasure.d, true) : t('No measurements yet')} accessory="chevron" onClick={() => nav('/measurements')} />
    </Section>

  </div>
}
