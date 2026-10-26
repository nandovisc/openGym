/* The Personal module, phase 1: an admin makes an account a trainer, the trainer hands out a
   code, the student links with it (choosing whether their body is shared), either side ends it.
   trainer.js holds the rules; a real server.js child runs the routes. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { boundPort } from './helpers.mjs';
import { cleanCode, dropLinksOf, linkWith, newCode, trainerByCode, unlink } from '../trainer.js';

const API = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SECRET = crypto.randomBytes(32).toString('hex');
const mint = uid => { const p = `${uid}:${Date.now() + 86400000}:0`; return p + '.' + crypto.createHmac('sha256', SECRET).update(p).digest('base64url'); };

test('the rules: a readable code, one link a pair, never with oneself', () => {
  const code = newCode();
  assert.match(code, /^PT-[A-HJ-NP-Z2-9]{8}$/);
  assert.equal(cleanCode('pt-ab cd'), 'ABCD');
  const trainer = { id: 't', trainer: true, trainerCode: { code, exp: Date.now() + 1000 } };
  assert.equal(trainerByCode([trainer], code.toLowerCase()), trainer);
  assert.equal(trainerByCode([{ ...trainer, trainerCode: { code, exp: 1 } }], code), null, 'expired');
  assert.equal(trainerByCode([{ ...trainer, trainer: false }], code), null, 'no longer a trainer');
  let { links, link } = linkWith([], trainer, { id: 's' });
  assert.deepEqual(link.scope, { body: false });
  ({ links } = linkWith(links, trainer, { id: 's' }, { body: true }));
  assert.equal(links.length, 1);
  assert.deepEqual(links[0].scope, { body: true });
  assert.equal(linkWith(links, trainer, trainer).error, 'self');
  assert.equal(unlink(links, links[0].id, { id: 'x' }).link, null, 'a stranger cannot end it');
  assert.equal(unlink(links, links[0].id, { id: 's' }).links.length, 0);
  assert.equal(dropLinksOf(links, 't', 'client').length, 1);
  assert.equal(dropLinksOf(links, 't').length, 0);
});

test('admin makes a trainer; the student links with the code and either side ends it', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-trainer-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
  const users = [['boss', 'Boss'], ['pt', 'Ricardo'], ['mari', 'Marília']].map(([id, name]) => ({ id, name, created: new Date().toISOString() }));
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({ users, creds: [], subs: [], invites: [] }));
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

  assert.equal((await call('pt', 'POST', '/api/trainer/code')).status, 403, 'not a trainer yet');
  assert.equal((await call('pt', 'POST', '/api/admin/user/trainer', { id: 'pt', trainer: true })).status, 403, 'only an admin gives the role');
  assert.deepEqual((await call('boss', 'POST', '/api/admin/user/trainer', { id: 'pt', trainer: true })).body, { ok: true, id: 'pt', trainer: true });
  assert.equal((await call('pt', 'GET', '/api/me')).body.user.trainer, true);

  const { code } = (await call('pt', 'POST', '/api/trainer/code')).body;
  assert.equal((await call('pt', 'GET', '/api/trainer/code')).body.code, code);
  assert.equal((await call('mari', 'POST', '/api/trainer/link', { code: 'PT-WRONG123' })).body.code, 'bad-code');
  assert.equal((await call('pt', 'POST', '/api/trainer/link', { code })).body.code, 'self');

  const made = await call('mari', 'POST', '/api/trainer/link', { code, body: false });
  assert.equal(made.status, 200, JSON.stringify(made.body));
  assert.deepEqual(made.body.link.trainer, { id: 'pt', name: 'Ricardo' });
  const students = (await call('pt', 'GET', '/api/trainer/students')).body.students;
  assert.deepEqual(students.map(s => [s.student.name, s.scope.body]), [['Marília', false]]);
  assert.deepEqual((await call('mari', 'POST', '/api/trainer/scope', { id: made.body.link.id, body: true })).body.scope, { body: true });
  assert.equal((await call('pt', 'POST', '/api/trainer/scope', { id: made.body.link.id, body: false })).status, 404, 'the scope is the student’s to change');
  assert.deepEqual((await call('mari', 'GET', '/api/trainer/mine')).body.trainers.map(x => [x.trainer.name, x.scope.body]), [['Ricardo', true]]);
  const detail = (await call('boss', 'GET', '/api/admin/user?id=pt')).body.user;
  assert.deepEqual([detail.trainer, detail.students], [true, ['Marília']]);

  // The trainer ends it: gone from both sides.
  assert.equal((await call('boss', 'POST', '/api/trainer/unlink', { id: made.body.link.id })).status, 404, 'not a side of it');
  assert.deepEqual((await call('pt', 'POST', '/api/trainer/unlink', { id: made.body.link.id })).body, { ok: true });
  assert.deepEqual((await call('mari', 'GET', '/api/trainer/mine')).body.trainers, []);

  // Linked again, then the role is taken away: the link goes with it.
  await call('mari', 'POST', '/api/trainer/link', { code });
  await call('boss', 'POST', '/api/admin/user/trainer', { id: 'pt', trainer: false });
  assert.deepEqual((await call('mari', 'GET', '/api/trainer/mine')).body.trainers, []);
  assert.ok(JSON.stringify((await call('boss', 'GET', '/api/admin/audit')).body).includes('trainer.link'));
});
