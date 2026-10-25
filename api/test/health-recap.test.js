/* The recap the first morning of the week: one line across the modules (health-week.js,
   push-messages.js healthRecapPush), in the person's language. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasNews, lastWeeks } from '../health-week.js';
import { healthRecapPush } from '../push-messages.js';

const S = {
  weekStart: 1, unit: 'kg',
  sleep: [{ d: '2026-10-13', asleepMin: 400 }],
  workouts: [{ id: 'a', d: '2026-10-13' }, { id: 'b', d: '2026-10-15' }, { id: 'c', d: '2026-10-17' }],
  bodyweight: [{ d: '2026-10-12', w: 95.2 }, { d: '2026-10-18', w: 94.8 }],
  water: [{ id: 'w', d: '2026-10-12', ml: 1800 }]
};

test('the week just over, said in one line', () => {
  const weeks = lastWeeks(S, '2026-10-19');
  assert.equal(weeks.week.from, '2026-10-12');
  assert.ok(hasNews(weeks.week));
  assert.deepEqual(healthRecapPush('pt-BR', weeks), { title: 'Sua semana', body: 'Sono 6h40 · 3 treinos · −0,4 kg · água 1,8 l por dia', tag: 'health-week', url: '#/health/week' });
  assert.equal(healthRecapPush('en', weeks).body, 'Sleep 6h40 · 3 workouts · −0.4 kg · water 1.8 l a day');
  assert.equal(hasNews(lastWeeks({}, '2026-10-19').week), false);
});
