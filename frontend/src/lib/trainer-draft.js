// A first draft of a student's plan by AI, for their trainer (the Personal module, phase 9; the
// server runs the Coach's create task, api/trainer-ai.js). Two pure steps on this side: the intake
// the request carries, made from the student's record and the few answers the trainer gives, and
// the draft turned into what PUT /api/trainer/student/plan takes — new routines with ids of their
// own, the week pointing at them, as importing a plan file does (plan-share.js mergePlan).
import { mergePlan } from './plan-share.js'

const list = v => (Array.isArray(v) ? v : [])
export const DRAFT_GOALS = ['strength', 'muscle', 'general', 'fatloss', 'endurance']
export const DRAFT_LEVELS = ['new', 'returning', 'regular']

/**
 * The Coach's intake for a student: the trainer's answers (`form`: goal, experience, daysPerWeek,
 * preferredDays, sessionMin, notes) and what the record says — its restrictions as the
 * limitations, its goal and notes beside the trainer's own words.
 */
export function draftIntake(record, form = {}) {
  const days = [...new Set(list(form.preferredDays).map(Number).filter(d => Number.isInteger(d) && d >= 0 && d <= 6))].sort()
  const notes = [record?.goal ? `Goal in their words: ${record.goal}` : '', record?.notes || '', form.notes || '']
    .map(s => String(s).trim()).filter(Boolean).join('\n')
  return {
    goal: DRAFT_GOALS.includes(form.goal) ? form.goal : 'general',
    experience: DRAFT_LEVELS.includes(form.experience) ? form.experience : 'regular',
    daysPerWeek: Math.min(7, Math.max(1, Math.round(Number(form.daysPerWeek) || days.length || 3))),
    preferredDays: days,
    sessionMin: Math.min(240, Math.max(15, Math.round(Number(form.sessionMin) || 60))),
    equipment: [],
    limitations: String(record?.restrictions || '').trim().slice(0, 600),
    likes: '', dislikes: '',
    notes: notes.slice(0, 600)
  }
}

/**
 * The draft as the student's plan takes it: { routines, week } — routines with new ids (the
 * student's own stay as they are), without the AI's reasons, and without any exercise of its own
 * invention (a plan sent to a student carries no new custom exercises); the week by those new ids,
 * only when `schedule`. `unit` is the student's.
 */
export function draftForStudent(plan, unit, { schedule = true } = {}) {
  const invented = new Set(list(plan?.customEx).map(c => c?.id))
  const bundle = {
    week: plan?.week || {},
    customEx: [],
    routines: list(plan?.routines).map(r => ({ ...r, why: undefined, ex: list(r.ex).filter(e => e && !invented.has(e.id)).map(e => ({ ...e, why: undefined, name: undefined })) }))
      .filter(r => r.ex.length)
  }
  const scratch = { unit: unit || 'kg', routines: [], customEx: [], week: {} }
  mergePlan(scratch, bundle, { schedule })
  const routines = scratch.routines.map(r => ({ ...r, ex: r.ex.map(e => Object.fromEntries(Object.entries(e).filter(([, v]) => v !== undefined))) }))
  return schedule ? { routines, week: scratch.week } : { routines }
}
