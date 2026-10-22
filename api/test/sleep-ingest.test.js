/* Sleep from Apple Health: the token made in Settings, and POST /api/sleep/ingest, where an iPhone
   Shortcut posts the night every morning. A real server.js child; the nights it writes have to
   land in the profile the way a device's own push would (a new revision the app's poll sees),
   once each, and never over a night the person logged by hand. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { boundPort } from './helpers.mjs';

const API = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SECRET = crypto.randomBytes(32).toString('hex');
const mint = uid => { const p = `${uid}:${Date.now() + 86400000}:0`; return p + '.' + crypto.createHmac('sha256', SECRET).update(p).digest('base64url'); };

// The night as the Shortcut sends it from a phone set to Portuguese: one line a sample.
const NIGHT = [
  '2026-10-21T23:05:00-03:00;2026-10-22T06:55:00-03:00;Na cama;Apple Watch',
  '2026-10-21T23:20:00-03:00;2026-10-22T02:00:00-03:00;Essencial;Apple Watch',
  '2026-10-22T02:00:00-03:00;2026-10-22T03:00:00-03:00;Profundo;Apple Watch',
  '2026-10-22T03:00:00-03:00;2026-10-22T06:40:00-03:00;REM;Apple Watch'
].join('\n');

async function serverWith(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-sleep-'));
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
  const call = async (method, p, body, headers = { Cookie: `gymsid=${mint('u1')}` }) => {
    const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', ...headers }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  const ingest = (body, token) => call('POST', '/api/sleep/ingest', body, { Authorization: `Bearer ${token}` });
  return { call, ingest, dataDir, log: () => log };
}

test('a token made in Settings lets the Shortcut put the night into the profile, once, until it is revoked', async t => {
  const s = await serverWith(t);
  assert.deepEqual((await s.call('GET', '/api/sleep/token')).body, { on: false });
  const made = await s.call('POST', '/api/sleep/token');
  assert.equal(made.status, 200);
  assert.match(made.body.token, /^ogs_/);
  assert.equal(made.body.on, true);
  assert.ok(!fs.readFileSync(path.join(s.dataDir, 'db.json'), 'utf8').includes(made.body.token), 'only the hash is stored');

  assert.equal((await s.ingest({ samples: NIGHT }, 'ogs_' + 'x'.repeat(32))).status, 401);
  assert.equal((await s.call('POST', '/api/sleep/ingest', { samples: NIGHT })).status, 401, 'a session is not a sleep token');

  const first = await s.ingest({ samples: NIGHT }, made.body.token);
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.deepEqual(first.body.written, ['2026-10-22']);
  assert.deepEqual(first.body.nights, [{ d: '2026-10-22', asleepMin: 440, source: 'Apple Watch' }]);
  const doc = (await s.call('GET', '/api/data')).body;
  const rev = (await s.call('GET', '/api/data/rev')).body.rev;
  const state = doc.state || doc;
  assert.equal(rev > 0, true);
  assert.deepEqual(state.sleep.map(n => [n.id, n.bed, n.wake, n.stages]), [['hk:2026-10-22', '2026-10-21T23:05', '2026-10-22T06:55', { deep: 60, rem: 220, core: 160, awake: 0 }]]);
  assert.ok(state.sleep[0]._ts > 0, 'stamped, so a device merging later keeps it');

  const again = await s.ingest({ samples: NIGHT }, made.body.token);
  assert.deepEqual(again.body.written, []);
  assert.equal((await s.call('GET', '/api/data/rev')).body.rev, rev, 'nothing new, no new revision');
  const view = (await s.call('GET', '/api/sleep/token')).body;
  assert.equal(view.nights, 1);
  assert.ok(view.last > 0);

  assert.deepEqual((await s.call('DELETE', '/api/sleep/token')).body, { on: false });
  assert.equal((await s.ingest({ samples: NIGHT }, made.body.token)).status, 401);
});

test('a night logged by hand stays; samples also come as JSON; a new token replaces the old', async t => {
  const s = await serverWith(t);
  const manual = { id: 'm1', d: '2026-10-22', bed: '2026-10-21T22:30', wake: '2026-10-22T06:00', asleepMin: 450, inBedMin: 450, stages: null, src: 'manual', created: 1 };
  assert.equal((await s.call('PUT', '/api/data', { state: { workouts: [], routines: [], sleep: [manual] } })).status, 200);
  const old = (await s.call('POST', '/api/sleep/token')).body.token;
  const tok = (await s.call('POST', '/api/sleep/token')).body.token;
  assert.equal((await s.ingest({ samples: NIGHT }, old)).status, 401);
  const samples = [
    { start: '2026-10-22 23:40:00 -0300', end: '2026-10-23 07:10:00 -0300', value: 'HKCategoryValueSleepAnalysisAsleepUnspecified', source: 'Oura' },
    ...NIGHT.split('\n').map(l => { const [start, end, value, source] = l.split(';'); return { start, end, value, source }; })
  ];
  const r = await s.ingest({ samples }, tok);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.written, ['2026-10-23']);
  const state = (await s.call('GET', '/api/data')).body;
  const sleep = (state.state || state).sleep;
  assert.deepEqual(sleep.map(n => [n.id, n.src, n.asleepMin]), [['m1', 'manual', 450], ['hk:2026-10-23', 'health', 450]]);
});
