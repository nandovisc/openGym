/* A trainer's class reminder (agenda.js agendaDue, push-messages.js classReminderPush): half an
   hour before a class still on, to the trainer with the student's name and to the student with
   the trainer's. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agendaDue, recordOf } from '../agenda.js';
import { classReminderPush } from '../push-messages.js';

test('half an hour before a class that is still on', () => {
  const S = { students: [{ id: 'r', name: 'Marília' }], sessionSeries: [{ id: 's', recordId: 'r', days: [1], time: '07:00', dur: 60, from: '2026-10-01' }],
    sessions: [{ id: 's|2026-11-02', seriesId: 's', recordId: 'r', d: '2026-11-02', time: '07:00', status: 'canceled' }] };
  const [o] = agendaDue(S, { date: '2026-10-26', hhmm: '06:31' });
  assert.equal(o.id, 's|2026-10-26');
  assert.equal(recordOf(S, o).name, 'Marília');
  assert.deepEqual(agendaDue(S, { date: '2026-11-02', hhmm: '06:31' }), [], 'a cancelled class is not reminded');
  assert.deepEqual(classReminderPush('pt-BR', 'Marília', '07:00', 'trainer'), { title: 'Aula com Marília às 07:00', body: 'Daqui a pouco.', tag: 'class-07:00', url: '#/agenda' });
  assert.equal(classReminderPush(null, 'Ricardo', '07:00', 'student').title, 'Aula com Ricardo às 07:00');
});
