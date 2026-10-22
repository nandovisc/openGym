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
    meals: { breakfast: 'breakfast', lunch: 'lunch', dinner: 'dinner', snack: 'snacks' },
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
    meals: { breakfast: 'café da manhã', lunch: 'almoço', dinner: 'jantar', snack: 'lanches' },
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
