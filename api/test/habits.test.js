/* Habit reminders: which are owed (habits.js habitsDue), their copy (push-messages.js), and the
   tick that sends them in a real server — only for a habit not done yet, once a habit and time. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { boundPort } from './helpers.mjs';
import { habitsDue } from '../habits.js';
import { habitReminderPush } from '../push-messages.js';

const D = '2026-10-22';
const habit = (extra = {}) => ({ id: 'h1', kind: 'check', name: 'Ler', schedules: [{ from: '2026-10-01', type: 'daily' }], start: '2026-10-01', reminders: ['21:00'], ...extra });

test('owed only when not done, within the window, and not for a medication habit the medication reminder covers', () => {
  const S = { habits: [habit()], habitLog: [] };
  assert.equal(habitsDue(S, { date: D, hhmm: '21:10' }, 15).length, 1);
  assert.equal(habitsDue(S, { date: D, hhmm: '20:59' }, 15).length, 0);
  assert.equal(habitsDue(S, { date: D, hhmm: '21:16' }, 15).length, 0);
  assert.equal(habitsDue({ ...S, habitLog: [{ id: `h1|${D}`, habitId: 'h1', d: D, done: true }] }, { date: D, hhmm: '21:10' }, 15).length, 0);
  assert.equal(habitsDue({ ...S, habitLog: [{ id: `h1|${D}`, habitId: 'h1', d: D, state: 'skipped' }] }, { date: D, hhmm: '21:10' }, 15).length, 0);
  const meds = { habits: [habit({ id: 'm', kind: 'auto', auto: { source: 'meds' }, reminders: ['08:00'] })], meds: [{ id: 'x', times: ['08:00'], active: true }], medLog: [] };
  assert.equal(habitsDue(meds, { date: D, hhmm: '08:05' }, 15).length, 1);
  assert.equal(habitsDue({ ...meds, medReminder: { on: true } }, { date: D, hhmm: '08:05' }, 15).length, 0);
});

test('the copy says what is missing', () => {
  const water = habit({ kind: 'quantity', name: 'Água', goal: { value: 2000, unit: 'ml' } });
  assert.deepEqual(habitReminderPush('pt-BR', water, { value: 750 }, '15:00'), { title: 'Hábito: Água', body: '750 de 2000 ml até agora.', tag: 'habit-h1-15:00', url: '#/health/habits' });
  const meals = habit({ kind: 'auto', name: 'Refeições', auto: { source: 'meals', slots: ['breakfast', 'lunch'] } });
  assert.equal(habitReminderPush('pt-BR', meals, { detail: 'breakfast' }, '12:30').body, 'Ainda sem registro: almoço.');
  assert.equal(habitReminderPush('en', habit(), { value: 0 }, '21:00').body, 'Not done yet today.');
});

// ---- the tick, in a real server ----
const API = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SECRET = crypto.randomBytes(32).toString('hex');
const utcNow = () => { const d = new Date(); return { date: d.toISOString().slice(0, 10), hhmm: d.toISOString().slice(11, 16) }; };
const minus = (hhmm, n) => { const m = (+hhmm.slice(0, 2) * 60 + +hhmm.slice(3) - n + 1440) % 1440; return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };
async function serverWith(t, state) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-habits-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({
    users: [{ id: 'u1', name: 'One', created: new Date().toISOString() }], creds: [], invites: [],
    subs: [{ userId: 'u1', endpoint: 'https://push.invalid/sub', keys: { p256dh: 'x', auth: 'y' } }]
  }));
  fs.writeFileSync(path.join(dataDir, 'state-u1.json'), JSON.stringify(state));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080', RP_ID: 'localhost', REMINDER_TICK_MS: '300', COACH_DISABLED: '1' }
  });
  const h = { log: '', dataDir };
  child.stdout.on('data', d => h.log += d); child.stderr.on('data', d => h.log += d);
  t.after(() => { child.kill('SIGKILL'); fs.rmSync(dataDir, { recursive: true, force: true }); });
  await boundPort(child, () => h.log);
  return h;
}
const wait = ms => new Promise(r => setTimeout(r, ms));
const firings = log => (log.match(/habit reminder firing/g) || []).length;

test('the tick reminds a habit not done once, and nothing when done or switched off', async t => {
  const { date, hhmm } = utcNow();
  const time = minus(hhmm, 1);
  if (time > hhmm) return;   // not across midnight
  const h = habit({ reminders: [time], start: '2020-01-01', schedules: [{ from: '2020-01-01', type: 'daily' }] });
  const owed = await serverWith(t, { lang: 'en', habitPrefs: { on: true, tz: 'UTC' }, habits: [h], habitLog: [] });
  const done = await serverWith(t, { habitPrefs: { on: true, tz: 'UTC' }, habits: [h], habitLog: [{ id: `h1|${date}`, habitId: 'h1', d: date, done: true }] });
  const off = await serverWith(t, { habitPrefs: { on: false, tz: 'UTC' }, habits: [h], habitLog: [] });
  await wait(1500);
  assert.equal(firings(owed.log), 1, owed.log);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(owed.dataDir, 'db.json'), 'utf8')).users[0].habitSent, { date, ids: [`h1@${time}`] });
  for (const x of [done, off]) assert.equal(firings(x.log), 0, x.log);
});
