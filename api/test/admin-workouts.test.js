/* Workouts an admin adds to someone's profile (Admin → a user → Add workouts from a file): only
   admins, only what is new, marked as added by an admin, in a revision the person's app sees. */
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

test('an admin adds workouts to a profile, once; nobody else can', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-admin-w-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({ users: [{ id: 'boss', name: 'Boss', created: new Date().toISOString() }, { id: 'mari', name: 'Marília', created: new Date().toISOString() }], creds: [], subs: [], invites: [] }));
  const child = spawn(process.execPath, ['server.js'], { cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080', RP_ID: 'localhost', COACH_DISABLED: '1', ANTHROPIC_API_KEY: '', ADMIN_UIDS: 'boss' } });
  let log = '';
  child.stdout.on('data', d => log += d); child.stderr.on('data', d => log += d);
  t.after(() => { child.kill('SIGKILL'); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${await boundPort(child, () => log)}`;
  const call = async (uid, method, p, b) => {
    const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', Cookie: `gymsid=${mint(uid)}` }, ...(b !== undefined ? { body: JSON.stringify(b) } : {}) });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  const workout = { id: 'imp-1', d: '2026-10-23', start: Date.parse('2026-10-23T10:00:00Z'), end: Date.parse('2026-10-23T10:38:00Z'), name: 'Pernas', entries: [{ id: '1064', sets: [{ sec: 30, w: 0, done: true }] }] };

  assert.equal((await call('mari', 'POST', '/api/admin/user/workouts', { id: 'mari', workouts: [workout] })).status, 403);
  assert.equal((await call('boss', 'POST', '/api/admin/user/workouts', { id: 'mari', workouts: [{ id: 'x' }] })).status, 400);
  assert.equal((await call('boss', 'POST', '/api/admin/user/workouts', { id: 'nobody', workouts: [workout] })).status, 404);

  const first = await call('boss', 'POST', '/api/admin/user/workouts', { id: 'mari', workouts: [workout], customEx: [{ id: 'imp-ex', name: 'Prancha aberta' }] });
  assert.deepEqual(first.body, { ok: true, added: 1, skipped: 0, customEx: 1 });
  const again = await call('boss', 'POST', '/api/admin/user/workouts', { id: 'mari', workouts: [workout] });
  assert.deepEqual(again.body, { ok: true, added: 0, skipped: 1, customEx: 0 });

  const doc = (await call('mari', 'GET', '/api/data')).body;
  const state = doc.state || doc;
  assert.equal(state.workouts.length, 1);
  assert.equal(state.workouts[0].src, 'admin');
  assert.equal(state.workouts[0].addedBy, 'boss');
  assert.ok(state.workouts[0]._ts > 0, 'stamped, so the phone merging later keeps it');
  assert.deepEqual(state.customEx.map(c => c.name), ['Prancha aberta']);
  assert.ok((await call('mari', 'GET', '/api/data/rev')).body.rev > 0);
  const audit = (await call('boss', 'GET', '/api/admin/audit')).body;
  assert.ok(JSON.stringify(audit).includes('admin.user.workouts'));
});
