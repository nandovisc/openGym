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
import { archiveFor, cleanCode, dropLinksOf, linkWith, newCode, trainerByCode, planFor, trainingOf, trainingSummary, unlink } from '../trainer.js';

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

test('a link shares the training, never the health modules or the photos', () => {
  const S = {
    unit: 'kg', routines: [{ id: 'r', name: 'A' }], week: { 1: ['r'] },
    workouts: [{ id: 'w', d: '2026-10-23', entries: [], media: [{ hash: 'x' }] }],
    customEx: [{ id: 'c', name: 'Prancha', media: { hash: 'y' } }],
    bodyweight: [{ d: '2026-10-23', w: 60, photos: [{ m: { hash: 'z' } }] }],
    meals: [{ id: 'm' }], sleep: [{ d: '2026-10-23' }], meds: [{ id: 'x' }], exams: [{ id: 'e' }], habits: [{ id: 'h' }], water: [{ id: 'a' }]
  };
  const shared = trainingOf(S);
  assert.deepEqual(Object.keys(shared).sort(), ['customEx', 'routines', 'unit', 'week', 'workouts']);
  assert.equal(shared.workouts[0].media, undefined);
  assert.equal(shared.customEx[0].media, undefined);
  const withBody = trainingOf(S, { body: true });
  assert.deepEqual(withBody.bodyweight, [{ d: '2026-10-23', w: 60 }]);
  assert.deepEqual(trainingSummary({ workouts: [{ d: '2026-10-01' }, { d: '2026-10-20' }, { d: '2026-10-23' }] }, '2026-10-26'), { last: '2026-10-23', week: 2, month: 3, total: 3 });
});

test('a plan: routines new or rewritten and marked, ones taken out leave their days', () => {
  const cur = { routines: [{ id: 'a', name: 'A', ex: [{ id: '0043', sets: 3 }], emoji: 'x' }, { id: 'b', name: 'B', ex: [] }], week: { 1: ['a', 'b'], 3: ['b'] } };
  const t = { id: 'pt', name: 'Ricardo' };
  const out = planFor(cur, { routines: [{ id: 'a', name: ' Pernas ', ex: [{ id: '1064', sets: 4, _x: 1 }] }, { id: 'n', name: 'Novo', ex: [] }], removed: ['b'] }, t, 5);
  assert.deepEqual(out.routines.map(r => [r.id, r.name, r.trainer?.name]), [['a', 'Pernas', 'Ricardo'], ['n', 'Novo', 'Ricardo']]);
  assert.equal(out.routines[0].emoji, 'x', 'what the trainer did not send is kept');
  assert.deepEqual(out.routines[0].ex, [{ id: '1064', sets: 4 }]);
  assert.deepEqual(out.week, { 1: ['a'] });
  assert.deepEqual(planFor(cur, { routines: [], week: { 2: ['a', 'zz'] } }, t).week, { 2: ['a'] });
  assert.equal(planFor(cur, { routines: [{ id: 'x' }] }, t).error, 'routines');
});

test('a link that ends leaves the trainer a copy of the training up to then', () => {
  const S = { unit: 'kg', workouts: [{ id: 'w', d: '2026-10-20', media: [{ hash: 'x' }] }], meals: [{ id: 'm' }] };
  const link = { ref: 'r1', clientId: 'mari' }, student = { id: 'mari', name: 'Marília' };
  const kept = archiveFor([{ id: 'r1', name: 'Marília', phone: '11', status: 'active' }], link, student, S, '2026-10-26');
  assert.deepEqual(kept[0], { id: 'r1', name: 'Marília', phone: '11', status: 'ended', studentId: 'mari', history: { workouts: [{ id: 'w', d: '2026-10-20' }], customEx: [], unit: 'kg', until: '2026-10-26' } });
  const made = archiveFor([], { clientId: 'mari' }, student, S, '2026-10-26', 'new', 5);
  assert.deepEqual([made[0].id, made[0].name, made[0].status, made[0].created], ['new', 'Marília', 'ended', 5]);
  assert.equal(linkWith([], { id: 't' }, { id: 's' }, { ref: 'r1' }).link.ref, 'r1');
  assert.equal(linkWith([], { id: 't' }, { id: 's' }, { ref: '../x' }).link.ref, undefined);
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

  // The admin sees no code before one is made, then makes one and sees it.
  assert.equal((await call('boss', 'GET', '/api/admin/user?id=pt')).body.user.trainerCode, null);
  const byAdmin = (await call('boss', 'POST', '/api/admin/user/trainer-code', { id: 'pt' })).body;
  assert.match(byAdmin.code, /^PT-/);
  assert.equal((await call('boss', 'GET', '/api/admin/user?id=pt')).body.user.trainerCode.code, byAdmin.code);
  assert.equal((await call('pt', 'GET', '/api/trainer/code')).body.code, byAdmin.code, 'the trainer sees the same code');
  assert.equal((await call('boss', 'POST', '/api/admin/user/trainer-code', { id: 'mari' })).status, 400, 'not a trainer');
  assert.equal((await call('pt', 'POST', '/api/admin/user/trainer-code', { id: 'pt' })).status, 403, 'only an admin');
  const { code } = (await call('pt', 'POST', '/api/trainer/code')).body;
  assert.equal((await call('pt', 'GET', '/api/trainer/code')).body.code, code);
  assert.equal((await call('mari', 'POST', '/api/trainer/link', { code: 'PT-WRONG123' })).body.code, 'bad-code');
  assert.equal((await call('pt', 'POST', '/api/trainer/link', { code })).body.code, 'self');

  const made = await call('mari', 'POST', '/api/trainer/link', { code, body: false, ref: 'rec-mari' });
  assert.equal(made.status, 200, JSON.stringify(made.body));
  assert.deepEqual(made.body.link.trainer, { id: 'pt', name: 'Ricardo' });
  const students = (await call('pt', 'GET', '/api/trainer/students')).body.students;
  assert.deepEqual(students.map(s => [s.student.name, s.scope.body, s.ref]), [['Marília', false, 'rec-mari']]);
  // Her training, as her trainer reads it: workouts and routines, nothing of her health.
  await call('mari', 'PUT', '/api/data', { state: { unit: 'kg', routines: [{ id: 'r', name: 'Pernas', ex: [] }], workouts: [{ id: 'w1', d: '2026-10-23', name: 'Pernas', entries: [], media: [] }], meals: [{ id: 'm1', d: '2026-10-23', items: [] }], bodyweight: [{ d: '2026-10-23', w: 61, t: 1 }] }, stamped: true });
  const read = await call('pt', 'GET', '/api/trainer/student?id=mari');
  assert.equal(read.status, 200, JSON.stringify(read.body));
  assert.deepEqual(read.body.training.workouts.map(w => w.name), ['Pernas']);
  assert.equal(read.body.training.meals, undefined, 'never her food');
  assert.equal(read.body.training.bodyweight, undefined, 'her body only when she shares it');
  assert.equal((await call('pt', 'GET', '/api/trainer/student?id=boss')).status, 404, 'not his student');
  assert.equal((await call('mari', 'GET', '/api/trainer/student?id=mari')).status, 403, 'not a trainer');
  assert.equal((await call('pt', 'GET', '/api/trainer/students')).body.students[0].training.last, '2026-10-23');
  // The trainer plans: a routine rewritten, one added, on Mondays; the student's profile has it,
  // marked, stamped as an edit, in a new revision.
  const rev0 = (await call('mari', 'GET', '/api/data/rev')).body.rev;
  const planned = await call('pt', 'PUT', '/api/trainer/student/plan', { id: 'mari', routines: [{ id: 'r', name: 'Pernas A', ex: [{ id: '1064', sets: 4, reps: 10 }] }, { id: 'r2', name: 'Superiores', ex: [] }], week: { 1: ['r'], 4: ['r2'] } });
  assert.deepEqual(planned.body, { ok: true, routines: 2 });
  const after = (await call('mari', 'GET', '/api/data')).body;
  const st = after.state || after;
  assert.deepEqual(st.routines.map(r => [r.name, r.trainer?.name]), [['Pernas A', 'Ricardo'], ['Superiores', 'Ricardo']]);
  assert.deepEqual(st.week, { 1: ['r'], 4: ['r2'] });
  assert.ok((await call('mari', 'GET', '/api/data/rev')).body.rev > rev0);
  // His agenda: a weekly class for her record; she sees the next ones, with his name.
  const ptDoc = (await call('pt', 'GET', '/api/data')).body;
  const today = new Date().toISOString().slice(0, 10);
  const ptPut = await call('pt', 'PUT', '/api/data', { state: { ...(ptDoc.state || {}), students: [{ id: 'rec-mari', name: 'Marília', studentId: 'mari', status: 'active' }],
    sessionSeries: [{ id: 's1', recordId: 'rec-mari', days: [0, 1, 2, 3, 4, 5, 6], time: '23:59', dur: 60, from: today, until: null }] }, baseRev: ptDoc.rev, stamped: true });
  assert.equal(ptPut.status, 200, JSON.stringify(ptPut.body));
  const mine = (await call('mari', 'GET', '/api/trainer/mine/classes')).body.classes;
  assert.ok(mine.length >= 14, 'every day of the next two weeks');
  assert.deepEqual(Object.keys(mine[0]).sort(), ['d', 'dur', 'status', 'time', 'trainer']);
  assert.equal(mine[0].trainer, 'Ricardo');
  assert.deepEqual((await call('boss', 'GET', '/api/trainer/mine/classes')).body.classes, [], 'no trainer, no classes');
  const removed = await call('pt', 'PUT', '/api/trainer/student/plan', { id: 'mari', removed: ['r2'] });
  assert.equal(removed.body.routines, 1);
  const st2 = ((await call('mari', 'GET', '/api/data')).body.state);
  assert.deepEqual(st2.week, { 1: ['r'] });
  assert.ok(st2.deleted?.routines?.r2 > 0, 'its removal on record, so no phone brings it back');
  assert.equal((await call('pt', 'PUT', '/api/trainer/student/plan', { id: 'boss', routines: [] })).status, 404, 'not his student');
  assert.deepEqual((await call('mari', 'POST', '/api/trainer/scope', { id: made.body.link.id, body: true })).body.scope, { body: true });
  assert.equal((await call('pt', 'POST', '/api/trainer/scope', { id: made.body.link.id, body: false })).status, 404, 'the scope is the student’s to change');
  assert.deepEqual((await call('mari', 'GET', '/api/trainer/mine')).body.trainers.map(x => [x.trainer.name, x.scope.body]), [['Ricardo', true]]);
  assert.deepEqual((await call('pt', 'GET', '/api/trainer/student?id=mari')).body.training.bodyweight.map(b => b.w), [61]);
  const detail = (await call('boss', 'GET', '/api/admin/user?id=pt')).body.user;
  assert.deepEqual([detail.trainer, detail.students], [true, ['Marília']]);

  // The trainer ends it: gone from both sides.
  assert.equal((await call('boss', 'POST', '/api/trainer/unlink', { id: made.body.link.id })).status, 404, 'not a side of it');
  assert.deepEqual((await call('pt', 'POST', '/api/trainer/unlink', { id: made.body.link.id })).body, { ok: true });
  assert.deepEqual((await call('mari', 'GET', '/api/trainer/mine')).body.trainers, []);
  assert.equal((await call('pt', 'GET', '/api/trainer/student?id=mari')).status, 404, 'the access went with the link');
  const ptState = (await call('pt', 'GET', '/api/data')).body.state;
  const rec = ptState.students.find(r => r.studentId === 'mari');
  assert.equal(rec.status, 'ended');
  assert.deepEqual(rec.history.workouts.map(w => w.name), ['Pernas'], 'her training stays with him too');
  assert.equal(rec.history.meals, undefined);
  assert.deepEqual(((await call('mari', 'GET', '/api/data')).body.state).workouts.map(w => w.name), ['Pernas'], 'and with her');

  // Linked again, then the role is taken away: the link goes with it.
  await call('mari', 'POST', '/api/trainer/link', { code });
  await call('boss', 'POST', '/api/admin/user/trainer', { id: 'pt', trainer: false });
  assert.deepEqual((await call('mari', 'GET', '/api/trainer/mine')).body.trainers, []);
  assert.ok(JSON.stringify((await call('boss', 'GET', '/api/admin/audit')).body).includes('trainer.link'));
});
