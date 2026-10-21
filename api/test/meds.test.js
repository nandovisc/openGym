/* Medication reminders: which doses are owed a push (meds.js), and the tick that sends them
   (server.js medTick) — at the dose's time, once, never for a dose already marked, a paused
   medication or a day it is not taken. The tick runs in a real server.js child, every 300 ms. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { boundPort } from './helpers.mjs';
import { doseId, isScheduledOn, medsDue } from '../meds.js';
import { medReminderPush } from '../push-messages.js';

const med = (over = {}) => ({ id: 'm1', name: 'Losartana', dose: '50', unit: 'mg', times: ['08:00', '20:00'], days: null, start: '2026-10-01', end: null, active: true, ...over });
const now = { date: '2026-10-21', hhmm: '08:05' };   // a Wednesday

test('a dose is owed from its time for the window, unless marked, paused, ended or not its day', () => {
  assert.deepEqual(medsDue({ meds: [med()] }, now, 15).map(x => x.time), ['08:00']);
  assert.deepEqual(medsDue({ meds: [med()] }, { ...now, hhmm: '07:59' }, 15), []);
  assert.deepEqual(medsDue({ meds: [med()] }, { ...now, hhmm: '08:16' }, 15), []);
  assert.deepEqual(medsDue({ meds: [med()], medLog: [{ id: doseId('m1', now.date, '08:00'), status: 'skipped' }] }, now, 15), []);
  assert.deepEqual(medsDue({ meds: [med({ active: false })] }, now, 15), []);
  assert.deepEqual(medsDue({ meds: [med({ end: '2026-10-20' })] }, now, 15), []);
  assert.equal(isScheduledOn(med({ days: [3] }), now.date), true);
  assert.equal(isScheduledOn(med({ days: [1, 5] }), now.date), false);
});

test('the medications of one time come in one push, tagged by the time, opening the day', () => {
  const due = medsDue({ meds: [med(), med({ id: 'm2', name: 'Vitamina D', dose: '2000', unit: 'unit', times: ['08:00'] })] }, now, 15);
  assert.equal(due.length, 1);
  const p = medReminderPush('pt-BR', due[0].meds, due[0].time);
  assert.equal(p.title, 'Hora dos seus remédios 💊');
  assert.equal(p.body, '08:00 · Losartana 50 mg, Vitamina D 2000 unit');
  assert.equal(p.tag, 'med-08:00');
  assert.equal(p.url, '#/health/meds');
  assert.equal(medReminderPush('en', [med()], '08:00').title, 'Time for your medication 💊');
});

// ---- the tick, in a real server ----
const API = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SECRET = crypto.randomBytes(32).toString('hex');
const utcNow = () => { const d = new Date(); return { date: d.toISOString().slice(0, 10), hhmm: d.toISOString().slice(11, 16) }; };
const minusMinutes = (hhmm, n) => { const m = (+hhmm.slice(0, 2) * 60 + +hhmm.slice(3) - n + 1440) % 1440; return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };

async function serverWith(t, state) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-meds-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({
    users: [{ id: 'u1', name: 'One', created: new Date().toISOString() }], creds: [], invites: [],
    // A subscription the push service will refuse: the send fails and is logged, the tick goes on.
    subs: [{ userId: 'u1', endpoint: 'https://push.invalid/sub', keys: { p256dh: 'x', auth: 'y' } }]
  }));
  fs.writeFileSync(path.join(dataDir, 'state-u1.json'), JSON.stringify(state));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080', RP_ID: 'localhost', REMINDER_TICK_MS: '300', COACH_DISABLED: '1' }
  });
  const h = { log: '', dataDir };
  child.stdout.on('data', d => h.log += d);
  child.stderr.on('data', d => h.log += d);
  t.after(() => { child.kill('SIGKILL'); fs.rmSync(dataDir, { recursive: true, force: true }); });
  await boundPort(child, () => h.log);
  return h;
}
const wait = ms => new Promise(r => setTimeout(r, ms));
const firings = log => (log.match(/medication reminder firing/g) || []).length;

test('the tick reminds a due dose once, and records it on the user', async t => {
  const { date, hhmm } = utcNow();
  const time = minusMinutes(hhmm, 1);
  // Not across midnight: the dose would belong to yesterday.
  if (time > hhmm) return;
  const h = await serverWith(t, { lang: 'en', medReminder: { on: true, tz: 'UTC' }, meds: [med({ times: [time], start: '2020-01-01' })], medLog: [] });
  await wait(1500);
  assert.equal(firings(h.log), 1, h.log);
  const db = JSON.parse(fs.readFileSync(path.join(h.dataDir, 'db.json'), 'utf8'));
  assert.deepEqual(db.users[0].medSent, { date, slots: [doseId('m1', date, time)] });
});

test('no reminder for a dose already marked, with the switch off, or for a paused medication', async t => {
  const { date, hhmm } = utcNow();
  const time = minusMinutes(hhmm, 1);
  if (time > hhmm) return;
  const m = med({ times: [time], start: '2020-01-01' });
  const marked = await serverWith(t, { medReminder: { on: true, tz: 'UTC' }, meds: [m], medLog: [{ id: doseId('m1', date, time), medId: 'm1', d: date, time, status: 'taken', at: 1 }] });
  const off = await serverWith(t, { medReminder: { on: false, tz: 'UTC' }, meds: [m], medLog: [] });
  const paused = await serverWith(t, { medReminder: { on: true, tz: 'UTC' }, meds: [{ ...m, active: false }], medLog: [] });
  await wait(1500);
  for (const h of [marked, off, paused]) assert.equal(firings(h.log), 0, h.log);
});
