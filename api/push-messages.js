import { NUDGE_COPY } from './nudge-copy.js';
import { lineIndex } from './nudge.js';

const COPY = {
  en: {
    restTitle: 'Rest over 💪',
    restBody: 'Time for your next set.',
    testBody: 'Test notification ✅ This is what alerts look like.',
    dayFallbackTitle: 'Workout planned today',
    dayRoutineSuffix: 'today',
    dayBody: "It's on your plan. Let's go 💪",
    medTitle: 'Time for your medication 💊',
    medTitleMany: 'Time for your medications 💊',
    habitTitle: 'Habit: {0}',
    habitBody: 'Not done yet today.',
    habitProgress: '{0} of {1} {2} so far.',
    habitMeals: 'Not logged yet: {0}.',
    habitTask: 'On your list for today.',
    groupTitle: '{0}',
    groupBody: 'Still to do: {0}.',
    recapTitle: 'Your week of habits',
    recapBody: '{0} of {1} done ({2}%). Best: {3}.',
    recapBodyNone: '{0} of {1} done ({2}%).',
    weekTitle: 'Your week',
    weekSleep: 'sleep {0}', weekWorkouts: '{0} workouts', weekWorkout: '1 workout', weekDoses: '{0}% of doses',
    weekWater: 'water {0} l a day', weekHabits: 'habits {0}%', weekDecimal: '.',
    smartDoseTitle: 'Did you take {0}?', smartDoseBody: 'The {1} dose is not marked yet.',
    smartWeightTitle: 'Time to weigh in', smartWeightBody: 'No weigh-in for {0} days.',
    smartWaterTitle: 'A glass of water? 💧', smartWaterBody: '{0} of {1} so far today.',
    smartSleepTitle: 'Last night has not arrived', smartSleepBody: 'Open Shortcuts and run the sleep one, or log the night by hand.',
    meals: { breakfast: 'breakfast', morningSnack: 'morning snack', lunch: 'lunch', snack: 'afternoon snack', dinner: 'dinner', supper: 'supper' },
  },
  'pt-BR': {
    restTitle: 'Descanso terminado 💪',
    restBody: 'Hora da próxima série.',
    testBody: 'Notificação de teste ✅ É assim que os alertas aparecem.',
    dayFallbackTitle: 'Treino planejado para hoje',
    dayRoutineSuffix: 'hoje',
    dayBody: 'Está no seu plano. Bora treinar 💪',
    medTitle: 'Hora do seu remédio 💊',
    medTitleMany: 'Hora dos seus remédios 💊',
    habitTitle: 'Hábito: {0}',
    habitBody: 'Ainda não feito hoje.',
    habitProgress: '{0} de {1} {2} até agora.',
    habitMeals: 'Ainda sem registro: {0}.',
    habitTask: 'Na sua lista de hoje.',
    groupTitle: '{0}',
    groupBody: 'Ainda por fazer: {0}.',
    recapTitle: 'Sua semana de hábitos',
    recapBody: '{0} de {1} feitos ({2}%). Destaque: {3}.',
    recapBodyNone: '{0} de {1} feitos ({2}%).',
    weekTitle: 'Sua semana',
    weekSleep: 'sono {0}', weekWorkouts: '{0} treinos', weekWorkout: '1 treino', weekDoses: '{0}% das doses',
    weekWater: 'água {0} l por dia', weekHabits: 'hábitos {0}%', weekDecimal: ',',
    smartDoseTitle: 'Tomou {0}?', smartDoseBody: 'A dose das {1} ainda não foi marcada.',
    smartWeightTitle: 'Hora de se pesar', smartWeightBody: 'Sem pesagem há {0} dias.',
    smartWaterTitle: 'Um copo de água? 💧', smartWaterBody: '{0} de {1} até agora hoje.',
    smartSleepTitle: 'A noite de ontem não chegou', smartSleepBody: 'Abra o Atalhos e rode o do sono, ou registre a noite à mão.',
    meals: { breakfast: 'café da manhã', morningSnack: 'lanche da manhã', lunch: 'almoço', snack: 'lanche da tarde', dinner: 'jantar', supper: 'ceia' },
  },
};

const copyFor = lang => COPY[lang] || COPY.en;

export function restTimerPush(lang) {
  const copy = copyFor(lang);
  return { title: copy.restTitle, body: copy.restBody, tag: 'rest-timer' };
}

export function testPush(lang) {
  return { title: 'openGym', body: copyFor(lang).testBody, tag: 'test' };
}

export function dayReminderPush(lang, routine) {
  const copy = copyFor(lang);
  return {
    title: routine
      ? `${routine.emoji || '🏋️'} ${routine.name} ${copy.dayRoutineSuffix}`
      : copy.dayFallbackTitle,
    body: copy.dayBody,
    tag: 'day-reminder',
  };
}

// The doses due at one time of the day (server.js medTick): every medication of that time in one
// alert, "Losartan 50 mg, Vitamin D 2000 unit". Tagged by the time, so the 08:00 alert does not
// replace the 20:00 one; opens the day's doses (frontend views/Meds.jsx).
export function medReminderPush(lang, meds, time) {
  const copy = copyFor(lang);
  const what = m => [m.name, [m.dose, m.unit].filter(Boolean).join(' ')].filter(Boolean).join(' ');
  return {
    title: meds.length > 1 ? copy.medTitleMany : copy.medTitle,
    body: `${time} · ${meds.map(what).join(', ')}`,
    tag: `med-${time}`,
    url: '#/health/meds',
  };
}

const fill = (s, ...args) => args.reduce((t, a, i) => t.replaceAll(`{${i}}`, a), s);
// A habit not done yet at one of its reminder times (habits.js habitsDue): its name, and how far
// it got — the amount so far, the meals not logged yet.
export function habitReminderPush(lang, habit, status, time) {
  const copy = copyFor(lang);
  let body = copy.habitBody;
  if (habit.kind === 'task') body = copy.habitTask;
  else if ((habit.kind === 'quantity' || habit.kind === 'timer') && status.value > 0) body = fill(copy.habitProgress, String(Math.round(status.value * 10) / 10), String(habit.goal?.value), habit.goal?.unit || '');
  else if (habit.kind === 'auto' && habit.auto?.source === 'meals' && habit.auto?.mode !== 'target') {
    const want = (habit.auto.slots?.length ? habit.auto.slots : ['breakfast', 'lunch', 'dinner']);
    const have = String(status.detail || '').split(',');
    const missing = want.filter(s => !have.includes(s)).map(s => copy.meals[s] || s);
    if (missing.length) body = fill(copy.habitMeals, missing.join(', '));
  }
  return { title: fill(copy.habitTitle, habit.name), body, tag: `habit-${habit.id}-${time}`, url: '#/health/habits' };
}

// A group's reminder (habits.js groupsDue): the habits of the group still to do.
export function groupReminderPush(lang, group, habits, time) {
  const copy = copyFor(lang);
  return { title: fill(copy.groupTitle, group.name), body: fill(copy.groupBody, habits.map(h => h.name).join(', ')), tag: `habits-group-${group.id}-${time}`, url: '#/health/habits' };
}
// The week's recap (habits.js weekSummary), the first morning of the week.
export function weeklyRecapPush(lang, summary) {
  const copy = copyFor(lang);
  const pct = String(Math.round((summary.rate || 0) * 100));
  const best = summary.habits.filter(r => r.total && r.done === r.total).map(r => r.habit.name)[0];
  return { title: copy.recapTitle, body: best ? fill(copy.recapBody, String(summary.done), String(summary.total), pct, best) : fill(copy.recapBodyNone, String(summary.done), String(summary.total), pct), tag: 'habits-recap', url: '#/health/habits?recap=1' };
}

// The week across the modules (health-week.js lastWeeks), the first morning of the week: one line
// of what there was — sleep, workouts, weight, doses, water, habits.
export function healthRecapPush(lang, { week }) {
  const copy = copyFor(lang);
  const dec = n => String(n).replace('.', copy.weekDecimal);
  const hm = min => `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`;
  const parts = [];
  if (week.sleep) parts.push(fill(copy.weekSleep, hm(week.sleep.avgMin)));
  if (week.training?.workouts) parts.push(week.training.workouts === 1 ? copy.weekWorkout : fill(copy.weekWorkouts, String(week.training.workouts)));
  if (week.weight?.change != null) parts.push(`${week.weight.change > 0 ? '+' : week.weight.change < 0 ? '−' : '±'}${dec(Math.abs(week.weight.change))} ${week.weight.unit}`);
  if (week.meds) parts.push(fill(copy.weekDoses, String(week.meds.pct)));
  if (week.water) parts.push(fill(copy.weekWater, dec(Math.round(week.water.avgMl / 100) / 10)));
  if (week.habits) parts.push(fill(copy.weekHabits, String(Math.round(week.habits.rate * 100))));
  const body = parts.join(' · ');
  return { title: copy.weekTitle, body: body.charAt(0).toUpperCase() + body.slice(1), tag: 'health-week', url: '#/health/week' };
}

// A smart reminder (smart-nudges.js smartDue), from what the person usually does.
export function smartPush(lang, n) {
  const copy = copyFor(lang);
  const ml = v => (v >= 1000 ? `${String(Math.round(v / 100) / 10).replace('.', copy.weekDecimal)} l` : `${v} ml`);
  if (n.kind === 'dose') return { title: fill(copy.smartDoseTitle, n.med.name), body: fill(copy.smartDoseBody, n.med.name, n.time), tag: n.key, url: '#/health/meds' };
  if (n.kind === 'weight') return { title: copy.smartWeightTitle, body: fill(copy.smartWeightBody, String(n.days)), tag: 'smart-weight', url: '#/home' };
  if (n.kind === 'water') return { title: copy.smartWaterTitle, body: fill(copy.smartWaterBody, ml(n.total), ml(n.goal)), tag: 'smart-water', url: '#/health/water' };
  return { title: copy.smartSleepTitle, body: copy.smartSleepBody, tag: 'smart-sleep', url: '#/health/sleep' };
}

// The missed-workout nudge (nudge.js). Its copy is translated in the frontend packs and generated
// into nudge-copy.js, so every language the app speaks has it — unlike the strings above, which
// predate that and fall back to English. de-CH is de with ß written ss, as in the frontend
// (lib/i18n-core.js DERIVED_LOCALES).
const nudgeCopyFor = lang => {
  if (lang === 'de-CH') {
    const ch = s => s.replace(/ß/g, 'ss');
    return Object.fromEntries(Object.entries(NUDGE_COPY.de).map(([k, c]) => [k, { title: ch(c.title), lines: c.lines.map(ch) }]));
  }
  return NUDGE_COPY[lang] || NUDGE_COPY.en;
};
export function nudgePush(lang, tone, routine, iso) {
  const copy = nudgeCopyFor(lang)[NUDGE_COPY.en[tone] ? tone : 'friendly'];
  const line = copy.lines[lineIndex(iso, copy.lines.length)];
  const name = routine?.name || 'openGym';
  return { title: copy.title, body: line.replace('{0}', () => name), tag: 'nudge' };
}
