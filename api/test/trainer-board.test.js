/* The Personal module, phase 9: what a trainer's profile holds for a student to read (notices and
   shared documents, trainer.js), the push that tells them, and the first draft of a student's plan
   by AI (trainer-ai.js) — the rules on their own, then a real server.js child running the routes. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { boundPort } from './helpers.mjs';
import { pdf } from './media-samples.mjs';
import { documentsFor, noticeReaches, noticesFor, sharedDocument } from '../trainer.js';
import { draftPayload, draftPlan, TrainerAiError } from '../trainer-ai.js';
import { trainerNoticePush } from '../push-messages.js';

const API = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SECRET = crypto.randomBytes(32).toString('hex');
const mint = uid => { const p = `${uid}:${Date.now() + 86400000}:0`; return p + '.' + crypto.createHmac('sha256', SECRET).update(p).digest('base64url'); };
const H = c => c.repeat(64);
const NOW = Date.parse('2026-10-27T12:00:00Z');

const S = {
  students: [
    { id: 'r1', name: 'Marília', studentId: 'mari', status: 'active', group: 'Manhã ' },
    { id: 'r2', name: 'João', status: 'invited', group: 'noite' },
    { id: 'r3', name: 'Ana', studentId: 'ana', status: 'ended', group: 'manhã' }
  ],
  notices: [
    { id: 'n1', title: 'Feriado', body: 'Sem aulas na sexta.', to: { kind: 'all' }, at: NOW - 3600000 },
    { id: 'n2', title: 'Turma da manhã', body: '', to: { kind: 'group', group: 'manhã' }, at: NOW - 7200000 },
    { id: 'n3', title: 'Só o João', body: '', to: { kind: 'student', recordId: 'r2' }, at: NOW },
    { id: 'n4', title: 'Antigo', body: '', to: { kind: 'all' }, at: NOW - 90 * 86400000 }
  ],
  documents: [
    { id: 'd1', recordId: 'r1', kind: 'diet', title: 'Dieta', d: '2026-10-20', shared: true, m: { kind: 'doc', hash: H('a'), mime: 'application/pdf', size: 10 } },
    { id: 'd2', recordId: 'r1', kind: 'contract', title: 'Contrato', d: '2026-10-25', shared: false, m: { kind: 'doc', hash: H('b'), mime: 'application/pdf', size: 10 } },
    { id: 'd3', recordId: 'r2', kind: 'other', title: 'De outro', d: '2026-10-26', shared: true, m: { kind: 'doc', hash: H('c'), mime: 'application/pdf', size: 10 } }
  ]
};

test('a notice reaches every student, a group, or one — never a record whose link ended', () => {
  const [mari, joao, ana] = S.students;
  assert.equal(noticeReaches(S.notices[0], mari), true);
  assert.equal(noticeReaches(S.notices[1], mari), true, 'the group compared without case or spaces');
  assert.equal(noticeReaches(S.notices[1], joao), false);
  assert.equal(noticeReaches(S.notices[2], joao), true);
  assert.equal(noticeReaches(S.notices[0], ana), false);
  assert.equal(noticeReaches({ to: { kind: 'group', group: '' } }, { id: 'x', group: '' }), false);
  assert.equal(noticeReaches({ to: {} }, mari), false);
  // As the student reads them: the last 60 days, newest first, only what is theirs.
  assert.deepEqual(noticesFor(S, { clientId: 'mari' }, NOW).map(n => n.id), ['n1', 'n2']);
  assert.deepEqual(noticesFor(S, { clientId: 'nobody', ref: 'r2' }, NOW).map(n => n.id), ['n3', 'n1'], 'by the invite’s record too');
  assert.deepEqual(noticesFor(S, { clientId: 'ana' }, NOW), []);
});

test('a student reads only the documents shared with them, and never their file through another', () => {
  assert.deepEqual(documentsFor(S, { clientId: 'mari' }), [{ id: 'd1', kind: 'diet', title: 'Dieta', d: '2026-10-20', mime: 'application/pdf', size: 10 }]);
  assert.equal(sharedDocument(S, { clientId: 'mari' }, 'd1').m.hash, H('a'));
  assert.equal(sharedDocument(S, { clientId: 'mari' }, 'd2'), null, 'not shared');
  assert.equal(sharedDocument(S, { clientId: 'mari' }, 'd3'), null, 'another student’s');
  assert.deepEqual(documentsFor(S, { clientId: 'ana' }), []);
});

test('the push says who sent it and what', () => {
  assert.deepEqual(trainerNoticePush('pt-BR', 'Ricardo', 'notice', 'Feriado'), { title: 'Aviso de Ricardo', body: 'Feriado', tag: 'trainer-notice', url: '#/my-trainer' });
  assert.equal(trainerNoticePush('en', 'Ricardo', 'document', 'Dieta').title, 'Ricardo shared a document');
});

const PLAN = {
  coach_contract: 1, name: 'Força 2x', summary: 'Dois dias de corpo inteiro.', basedOn: 'no history yet',
  week: { 1: 'r1', 4: 'r2' },
  routines: [
    { id: 'r1', name: 'A', emoji: 'barbell', prog: 'linear', why: 'x', ex: [{ id: '3294', sets: 3, mode: 'reps', reps: 10, weight: 999 }, { id: '0001', sets: 3, mode: 'reps', reps: 12 }, { id: '0006', sets: 3, mode: 'reps', reps: 12 }] },
    { id: 'r2', name: 'B', emoji: 'dumbbell', prog: 'linear', why: 'y', ex: [{ id: '3293', sets: 3, mode: 'reps', reps: 6 }, { id: '0002', sets: 3, mode: 'reps', reps: 12 }, { id: '0001', sets: 2, mode: 'reps', reps: 15 }] }
  ],
  customEx: []
};
const CFG = { key: 'k', workspace: '', base: 'https://ai.test', model: 'claude-opus-5-5', effort: 'medium', timeoutMs: 5000 };
const answer = (...texts) => {
  const calls = [];
  const fetch = async (url, opts) => {
    calls.push({ url, body: JSON.parse(opts.body), headers: opts.headers });
    const text = texts[Math.min(calls.length - 1, texts.length - 1)];
    return new Response(JSON.stringify({ content: [{ type: 'text', text }], stop_reason: 'end_turn' }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return { fetch, calls };
};

test('the AI draft: the Coach’s create task on the student’s training, checked by its validator', async () => {
  const training = { unit: 'kg', workouts: [{ id: 'w', d: '2026-10-20', entries: [{ id: '3294', sets: [{ w: 20, r: 10, done: true }] }] }], routines: [] };
  const intake = { goal: 'strength', daysPerWeek: 2, sessionMin: 60, limitations: 'joelho direito operado', notes: 'quer correr uma meia maratona' };
  const p = draftPayload(training, intake, { lang: 'pt-BR' });
  assert.equal(p.task, 'create');
  assert.equal(p.meta.lang, 'pt-BR');
  assert.deepEqual([p.coachProfile.daysPerWeek, p.coachProfile.limitations], [2, 'joelho direito operado']);
  assert.ok(p.library.length > 10);
  assert.deepEqual(p.history.workingWeights.map(w => [w.id, w.best]), [['3294', 20]]);

  const ai = answer(JSON.stringify(PLAN));
  const plan = await draftPlan(training, intake, CFG, { lang: 'pt-BR', fetch: ai.fetch });
  assert.equal(ai.calls[0].url, 'https://ai.test/v1/messages');
  assert.equal(ai.calls[0].headers['x-api-key'], 'k');
  assert.equal(ai.calls[0].body.model, 'claude-opus-5-5');
  assert.match(ai.calls[0].body.messages[0].content, /joelho direito operado/);
  assert.deepEqual(plan.routines.map(r => r.ex.length), [3, 3]);
  assert.equal(plan.routines[0].ex[0].weight, 20, 'never above what the student has lifted');
  assert.deepEqual(plan.week, { 1: 'r1', 4: 'r2' });

  // A made-up exercise is sent back once; a second miss is a failed draft, not a loop.
  const bad = { ...PLAN, routines: [{ ...PLAN.routines[0], ex: [{ id: 'nope', sets: 3, mode: 'reps', reps: 5 }] }, PLAN.routines[1]] };
  const fixed = answer(JSON.stringify(bad), JSON.stringify(PLAN));
  assert.equal((await draftPlan(training, intake, CFG, { fetch: fixed.fetch })).routines.length, 2);
  assert.equal(fixed.calls.length, 2);
  const never = answer(JSON.stringify(bad));
  await assert.rejects(draftPlan(training, intake, CFG, { fetch: never.fetch }), e => e instanceof TrainerAiError && e.code === 'unusable' && e.status === 502);
  assert.equal(never.calls.length, 2);
  const refused = async () => new Response(JSON.stringify({ error: { type: 'authentication_error', message: 'invalid x-api-key' } }), { status: 401 });
  await assert.rejects(draftPlan(training, intake, CFG, { fetch: refused }), e => e.code === 'config');
});

test('a student reads the notices and documents meant for them; the trainer rings the bell', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-board-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
  const users = [['pt', 'Ricardo', true], ['mari', 'Marília'], ['joao', 'João']].map(([id, name, trainer]) => ({ id, name, ...(trainer ? { trainer } : {}), created: new Date().toISOString() }));
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({ users, creds: [], subs: [], invites: [], trainerLinks: [{ id: 'L1', trainerId: 'pt', clientId: 'mari', ref: 'r1', scope: { body: false }, created: 1 }] }));
  const child = spawn(process.execPath, ['server.js'], { cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080', RP_ID: 'localhost', COACH_DISABLED: '1', ANTHROPIC_API_KEY: '' } });
  let log = '';
  child.stdout.on('data', d => log += d); child.stderr.on('data', d => log += d);
  t.after(() => { child.kill('SIGKILL'); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${await boundPort(child, () => log)}`;
  const call = async (uid, method, p, b) => {
    const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', Cookie: `gymsid=${mint(uid)}` }, ...(b !== undefined ? { body: JSON.stringify(b) } : {}) });
    return { status: r.status, body: await r.json().catch(() => null) };
  };

  // The trainer's diet PDF for her, uploaded to his own folder and shared in his profile.
  const bytes = pdf();
  const hash = crypto.createHash('sha256').update(bytes).digest('hex');
  const up = await fetch(`${base}/api/media/${hash}`, { method: 'PUT', headers: { Cookie: `gymsid=${mint('pt')}`, 'Content-Type': 'application/pdf' }, body: bytes });
  assert.ok(up.status < 300, await up.text());
  const now = Date.now();
  const put = await call('pt', 'PUT', '/api/data', { state: {
    students: [{ id: 'r1', name: 'Marília', studentId: 'mari', status: 'active', group: 'Manhã' }],
    notices: [{ id: 'n1', title: 'Feriado', body: 'Sem aulas.', to: { kind: 'group', group: 'manhã' }, at: now }, { id: 'n2', title: 'Outra turma', body: '', to: { kind: 'group', group: 'noite' }, at: now }],
    documents: [{ id: 'd1', recordId: 'r1', kind: 'diet', title: 'Dieta', d: '2026-10-27', shared: true, m: { kind: 'doc', hash, mime: 'application/pdf', size: bytes.length, at: 1 } },
      { id: 'd2', recordId: 'r1', kind: 'contract', title: 'Contrato', d: '2026-10-27', shared: false, m: { kind: 'doc', hash, mime: 'application/pdf', size: bytes.length, at: 1 } }]
  }, stamped: true });
  assert.equal(put.status, 200, JSON.stringify(put.body));

  const board = (await call('mari', 'GET', '/api/trainer/mine/board')).body;
  assert.deepEqual(board.notices.map(n => [n.title, n.trainer, n.link]), [['Feriado', 'Ricardo', 'L1']]);
  assert.deepEqual(board.documents.map(d => [d.id, d.title]), [['d1', 'Dieta']]);
  assert.deepEqual((await call('joao', 'GET', '/api/trainer/mine/board')).body, { notices: [], documents: [] }, 'not his student');

  const file = await fetch(`${base}/api/trainer/mine/document?link=L1&id=d1`, { headers: { Cookie: `gymsid=${mint('mari')}` } });
  assert.equal(file.status, 200);
  assert.deepEqual(Buffer.from(await file.arrayBuffer()), bytes);
  assert.equal((await fetch(`${base}/api/trainer/mine/document?link=L1&id=d2`, { headers: { Cookie: `gymsid=${mint('mari')}` } })).status, 404, 'not shared with her');
  assert.equal((await fetch(`${base}/api/trainer/mine/document?link=L1&id=d1`, { headers: { Cookie: `gymsid=${mint('joao')}` } })).status, 404, 'not his link');
  assert.equal((await fetch(`${base}/api/media/${hash}`, { headers: { Cookie: `gymsid=${mint('mari')}` } })).status, 404, 'his folder stays his');

  // The bell: only to his own students, whoever else is named.
  assert.deepEqual((await call('pt', 'POST', '/api/trainer/notify', { kind: 'notice', title: 'Feriado', students: ['mari', 'joao'] })).body, { ok: true, sent: 1 });
  assert.equal((await call('pt', 'POST', '/api/trainer/notify', { title: '', students: ['mari'] })).status, 400);
  assert.equal((await call('mari', 'POST', '/api/trainer/notify', { title: 'x', students: ['joao'] })).status, 403, 'not a trainer');

  // No AI key on this instance: no draft, and the config says nothing.
  assert.equal((await call('pt', 'POST', '/api/trainer/student/draft', { id: 'mari', intake: {} })).status, 404);
  assert.equal((await call('pt', 'GET', '/api/config')).body.trainer_ai, undefined);
});
