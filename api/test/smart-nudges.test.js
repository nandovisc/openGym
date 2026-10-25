/* Smart reminders (smart-nudges.js): each from what the person usually does, only when switched
   on, and in the person's language (push-messages.js smartPush). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localHm, smartDue } from '../smart-nudges.js';
import { smartPush } from '../push-messages.js';

const D = '2026-10-25';
const back = n => new Date(Date.parse(D + 'T12:00:00Z') - n * 86400000).toISOString().slice(0, 10);
const at = (d, hm) => Date.parse(`${d}T${hm}:00Z`);
const on = { dose: true, weight: true, water: true, sleep: true };

test('nothing unless switched on', () => {
  const S = { meds: [{ id: 'm', name: 'Losartana', times: ['08:00'], active: true }], medLog: [] };
  assert.deepEqual(smartDue(S, { date: D, hhmm: '09:05' }), []);
  assert.equal(localHm(at(D, '09:30'), 'UTC'), '09:30');
  assert.equal(localHm(at(D, '12:30'), 'America/Sao_Paulo'), '09:30');
});

test('a dose still unmarked an hour after it is usually marked', () => {
  const medLog = [1, 2, 3, 4].map(i => ({ id: `m|${back(i)}|08:00`, status: 'taken', at: at(back(i), '08:40') }));
  const S = { smartReminders: on, meds: [{ id: 'm', name: 'Losartana', times: ['08:00'], active: true }], medLog };
  assert.deepEqual(smartDue(S, { date: D, hhmm: '09:05' }), []);
  const [n] = smartDue(S, { date: D, hhmm: '09:42' });
  assert.deepEqual(n, { key: `dose:m|${D}|08:00`, kind: 'dose', med: { id: 'm', name: 'Losartana' }, time: '08:00' });
  assert.deepEqual(smartPush('pt-BR', n), { title: 'Tomou Losartana?', body: 'A dose das 08:00 ainda não foi marcada.', tag: `dose:m|${D}|08:00`, url: '#/health/meds' });
  assert.deepEqual(smartDue({ ...S, medLog: [...medLog, { id: `m|${D}|08:00`, status: 'taken' }] }, { date: D, hhmm: '09:42' }), []);
});

test('no weigh-in for twice the usual gap, at the usual hour', () => {
  const bodyweight = [9, 8, 7, 6].map(i => ({ d: back(i), w: 95, t: at(back(i), '07:10') }));
  const S = { smartReminders: on, bodyweight };
  assert.deepEqual(smartDue(S, { date: D, hhmm: '07:15' }).map(n => [n.kind, n.days]), [['weight', 6]]);
  assert.deepEqual(smartDue(S, { date: D, hhmm: '12:00' }), []);
  assert.deepEqual(smartDue({ ...S, bodyweight: [...bodyweight, { d: back(1), w: 95 }] }, { date: D, hhmm: '07:15' }), []);
});

test('water behind at 15:00, and last night not sent by 11:00', () => {
  const S = { smartReminders: on, waterPrefs: { goalMl: 2800 }, water: [{ id: 'a', d: D, ml: 500 }],
    sleep: [1, 2, 3, 4, 5].map(i => ({ d: back(i), src: 'health' })) };
  assert.deepEqual(smartDue(S, { date: D, hhmm: '15:03' }).map(n => n.key), ['water:15:00']);
  assert.equal(smartPush('en', smartDue(S, { date: D, hhmm: '15:03' })[0]).body, '500 ml of 2.8 l so far today.');
  assert.deepEqual(smartDue({ ...S, water: [{ id: 'a', d: D, ml: 1200 }] }, { date: D, hhmm: '15:03' }), []);
  assert.deepEqual(smartDue(S, { date: D, hhmm: '11:02' }, { sleepLast: 1 }).map(n => n.key), [`sleep:${D}`]);
  assert.deepEqual(smartDue(S, { date: D, hhmm: '11:02' }), [], 'no Shortcut, no word about it');
});
