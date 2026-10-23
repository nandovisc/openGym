/* Workouts from Apple Health: POST /api/workouts/ingest, where the Shortcut the automation
   "Apple Watch Workout → Ends" runs posts the samples of the last hours. The workout is the last
   run of exercise minutes; its calories and heart rate go onto the workout logged in openGym then,
   or into one of its own, once, and a watch workout covered later by a logged one folds into it. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { boundPort } from './helpers.mjs';
import { foldWatchWorkouts, lastSession, measure, parseWorkoutSamples, putWatchWorkout } from '../workouts-ingest.js';

const API = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SECRET = crypto.randomBytes(32).toString('hex');
const mint = uid => { const p = `${uid}:${Date.now() + 86400000}:0`; return p + '.' + crypto.createHmac('sha256', SECRET).update(p).digest('base64url'); };

const at = (h, m) => `2026-10-22T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00-03:00`;
const ms = (h, m) => Date.parse(at(h, m));
// What the Shortcut sends: a list per kind, one sample a line in each field. A walk at 06:00
// (3 minutes, not a workout), then a workout from 07:00 to 07:45 with a 1-minute pause in it.
function body() {
  const ex = [];
  for (let m = 0; m < 3; m++) ex.push([at(6, m), at(6, m + 1)]);
  for (let m = 0; m < 45; m++) if (m !== 20) ex.push([at(7, m), at(7, m + 1)]);
  const en = [], hr = [];
  for (let m = 0; m < 45; m += 5) en.push([at(7, m), at(7, m + 5), '40']);
  en.push([at(8, 30), at(8, 35), '10']);   // after it: not counted
  hr.push([at(6, 30), at(6, 30), '70']);
  for (let m = 0; m < 45; m += 15) hr.push([at(7, m + 5), at(7, m + 5), String(120 + m)]);
  const side = (xs, unit) => ({ start: xs.map(x => x[0]).join('\n'), end: xs.map(x => x[1]).join('\n'), value: xs.map(x => x[2] ?? '1').join('\n'), unit });
  return { exercise: side(ex, 'min'), energy: side(en, 'kcal'), hr: side(hr, 'count/min') };
}

test('the last run of exercise minutes is the workout, measured by what falls inside it', () => {
  const xs = parseWorkoutSamples(body());
  const span = lastSession(xs);
  assert.equal(span.s, ms(7, 0));
  assert.equal(span.e, ms(7, 45));
  assert.equal(span.sl, '2026-10-22T07:00');
  assert.deepEqual(measure(xs, span), { kcal: 360, avgHr: 135, maxHr: 150 });
  assert.equal(lastSession(parseWorkoutSamples({ exercise: { start: at(6, 0), end: at(6, 1), value: '1' } })), null, 'a minute is no workout');
  // Text lines work too, and kilojoules are read as kcal.
  // Flat, as the Shortcut's JSON form sends the lists.
  const b = body(), flat = {};
  for (const k of ['exercise', 'energy', 'hr']) for (const f of ['start', 'end', 'value', 'unit']) flat[`${k}_${f}`] = b[k][f];
  assert.deepEqual(parseWorkoutSamples(flat), xs);
  const t = parseWorkoutSamples(`${at(7, 0)};${at(7, 10)};418,4;energy;kJ\n${at(7, 0)};${at(7, 10)};10;exercise`);
  assert.equal(Math.round(t.find(x => x.kind === 'energy').v), 100);
});

test('it goes onto the workout logged then; without one it is a workout of its own, never twice', () => {
  const span = { s: ms(7, 0), e: ms(7, 45), sl: '2026-10-22T07:00' };
  const m = { kcal: 360, avgHr: 135, maxHr: 150 };
  const logged = { id: 'w1', d: '2026-10-22', start: ms(7, 5), end: ms(7, 50), entries: [{ id: 'bench', sets: [] }] };
  const a = putWatchWorkout([logged], span, m);
  assert.equal(a.action, 'matched');
  assert.equal(a.list[0].health.kcal, 360);
  assert.equal(putWatchWorkout(a.list, span, m).action, 'unchanged');

  const yesterday = { id: 'w0', d: '2026-10-21', start: ms(7, 0) - 86400000, end: ms(7, 45) - 86400000, entries: [] };
  const b = putWatchWorkout([yesterday], span, m, { name: 'Corrida' });
  assert.equal(b.action, 'created');
  assert.deepEqual(b.list[1], { id: 'hk-w:2026-10-22T07:00', d: '2026-10-22', start: span.s, end: span.e, routineIds: [], routineId: null, name: 'Corrida', entries: [], prs: [], vol: 0, health: { kcal: 360, avgHr: 135, maxHr: 150, from: span.s, to: span.e, source: 'Apple Watch' }, src: 'health' });
  assert.equal(putWatchWorkout(b.list, span, m).action, 'unchanged');
  assert.equal(putWatchWorkout(b.list, { ...span, e: ms(7, 50) }, { ...m, kcal: 380 }).action, 'updated');
  assert.equal(putWatchWorkout(b.list, { ...span, e: ms(7, 50) }, m).list.length, 2);

  // Logged afterwards over the same span: the watch's entry folds into it, its removal on record.
  const state = { workouts: [...b.list, logged] };
  const changed = foldWatchWorkouts(state, ms(9, 0));
  assert.deepEqual(changed, ['w1', 'hk-w:2026-10-22T07:00']);
  assert.deepEqual(state.workouts.map(w => w.id), ['w0', 'w1']);
  assert.equal(state.workouts[1].health.kcal, 360);
  assert.ok(state.deleted.workouts['hk-w:2026-10-22T07:00'] > 0);
  assert.deepEqual(foldWatchWorkouts(state, ms(9, 0)), []);
});

async function serverWith(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-workout-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({ users: [{ id: 'u1', name: 'One', created: new Date().toISOString() }], creds: [], subs: [], invites: [] }));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080', RP_ID: 'localhost', COACH_DISABLED: '1', ANTHROPIC_API_KEY: '' }
  });
  let log = '';
  child.stdout.on('data', d => log += d); child.stderr.on('data', d => log += d);
  t.after(() => { child.kill('SIGKILL'); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${await boundPort(child, () => log)}`;
  const call = async (method, p, b, headers = { Cookie: `gymsid=${mint('u1')}` }) => {
    const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', ...headers }, ...(b !== undefined ? { body: JSON.stringify(b) } : {}) });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  return { call, ingest: (b, token) => call('POST', '/api/workouts/ingest', b, { Authorization: `Bearer ${token}` }) };
}

test('the sleep token posts the workout; sent again it changes nothing; a logged one takes it over', async t => {
  const s = await serverWith(t);
  const token = (await s.call('POST', '/api/sleep/token')).body.token;
  assert.equal((await s.ingest(body(), 'ogs_' + 'x'.repeat(32))).status, 401);
  assert.equal((await s.call('POST', '/api/workouts/ingest', body())).status, 401, 'a session is not the token');
  assert.deepEqual((await s.ingest({ exercise: { start: at(6, 0), end: at(6, 1), value: '1' } }, token)).body.workout, null);

  const first = await s.ingest({ ...body(), name: 'Funcional' }, token);
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.action, 'created');
  assert.deepEqual(first.body.workout, { id: 'hk-w:2026-10-22T07:00', start: ms(7, 0), end: ms(7, 45), min: 45, kcal: 360, avgHr: 135, maxHr: 150 });
  const rev = (await s.call('GET', '/api/data/rev')).body.rev;
  let doc = (await s.call('GET', '/api/data')).body;
  let state = doc.state || doc;
  assert.equal(state.workouts.length, 1);
  assert.equal(state.workouts[0].name, 'Funcional');
  assert.ok(state.workouts[0]._ts > 0, 'stamped');

  assert.equal((await s.ingest(body(), token)).body.action, 'unchanged');
  assert.equal((await s.call('GET', '/api/data/rev')).body.rev, rev, 'nothing new, no new revision');
  assert.ok((await s.call('GET', '/api/sleep/token')).body.lastWorkout > 0);

  // The phone pushes the workout it logged over the same span: the watch's entry folds into it.
  const logged = { id: 'w1', d: '2026-10-22', start: ms(7, 2), end: ms(7, 47), routineIds: [], name: 'Treino A', entries: [{ id: 'bench', sets: [{ w: 60, r: 8, done: true }] }], prs: [] };
  const put = await s.call('PUT', '/api/data', { state: { ...state, workouts: [...state.workouts, logged] }, baseRev: rev, stamped: true });
  assert.equal(put.status, 200, JSON.stringify(put.body));
  doc = (await s.call('GET', '/api/data')).body;
  state = doc.state || doc;
  assert.deepEqual(state.workouts.map(w => [w.id, w.health?.kcal]), [['w1', 360]]);
  assert.ok(state.deleted.workouts['hk-w:2026-10-22T07:00'] > 0);
});
