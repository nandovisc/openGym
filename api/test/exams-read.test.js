/* POST /api/exams/read: a medical exam's report read by Claude (exam-reader.js). A real server.js
   child talks to a fake Anthropic API on localhost (ANTHROPIC_BASE_URL), which records what it was
   sent and answers what each test needs: the request has to carry the report as a document or
   image block with a JSON schema for the answer, and the route has to turn every way the call
   can go wrong into an answer the app can show. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { boundPort } from './helpers.mjs';
import * as M from './media-samples.mjs';
import { READING_SCHEMA } from '../exam-reader.js';

const API = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SECRET = crypto.randomBytes(32).toString('hex');
const mint = uid => { const p = `${uid}:${Date.now() + 86400000}:0`; return p + '.' + crypto.createHmac('sha256', SECRET).update(p).digest('base64url'); };

const READING = { date: '2026-10-01', lab: 'Lab Central', title: 'Bioquímica', results: [
  { key: 'glucose', name: 'Glicose', value: 104, valueText: '104', unit: 'mg/dL', refLow: 70, refHigh: 99, refText: '70 a 99', flag: 'high', section: 'Bioquímica' }
] };

async function fakeAnthropic(t, answer) {
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', () => {
      seen.push({ url: req.url, headers: req.headers, body: JSON.parse(body) });
      const [status, json] = answer(seen.length);
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(json));
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  return { url: `http://127.0.0.1:${server.address().port}`, seen };
}
const message = reading => [200, { type: 'message', stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(reading) }] }];

async function serverWith(t, env) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-exams-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({ users: [{ id: 'u1', name: 'One', created: new Date().toISOString() }], creds: [], subs: [], invites: [] }));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080', RP_ID: 'localhost', COACH_DISABLED: '1', ANTHROPIC_API_KEY: '', ...env }
  });
  let log = '';
  child.stdout.on('data', d => log += d); child.stderr.on('data', d => log += d);
  t.after(() => { child.kill('SIGKILL'); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${await boundPort(child, () => log)}`;
  const read = async (files, uid = 'u1') => {
    const r = await fetch(`${base}/api/exams/read`, { method: 'POST', headers: { Cookie: `gymsid=${mint(uid)}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ files }) });
    return { status: r.status, body: await r.json() };
  };
  return { base, read, log: () => log };
}
const b64 = buf => buf.toString('base64');

test('a PDF goes to the API as a document with the reading schema, and the reading comes back', async t => {
  const ai = await fakeAnthropic(t, () => message(READING));
  const s = await serverWith(t, { ANTHROPIC_API_KEY: 'sk-test', ANTHROPIC_BASE_URL: ai.url });
  const cfg = await (await fetch(`${s.base}/api/config`)).json();
  assert.equal(cfg.exams_ai, true);
  assert.equal(cfg.media.docMB, 10);
  const r = await s.read([{ mime: 'application/pdf', data: b64(M.pdf()) }]);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body, READING);
  const sent = ai.seen[0];
  assert.equal(sent.url, '/v1/messages');
  assert.equal(sent.headers['x-api-key'], 'sk-test');
  assert.equal(sent.headers['anthropic-version'], '2023-06-01');
  assert.equal(sent.body.model, 'claude-opus-5-5');
  assert.deepEqual(sent.body.output_config.format, { type: 'json_schema', schema: READING_SCHEMA });
  assert.equal(sent.body.fallbacks, 'default');
  const [doc, prompt] = sent.body.messages[0].content;
  assert.equal(doc.type, 'document');
  assert.equal(doc.source.media_type, 'application/pdf');
  assert.equal(Buffer.from(doc.source.data, 'base64').toString('latin1'), M.pdf().toString('latin1'));
  assert.equal(prompt.type, 'text');
});

test('photos go as images, in order; the type is taken from the bytes, not from what is claimed', async t => {
  const ai = await fakeAnthropic(t, () => message({ ...READING, results: [] }));
  const s = await serverWith(t, { ANTHROPIC_API_KEY: 'sk-test', ANTHROPIC_BASE_URL: ai.url });
  const r = await s.read([{ mime: 'application/pdf', data: b64(M.jpeg()) }, { mime: 'image/png', data: b64(M.png()) }]);
  assert.equal(r.status, 200);
  const blocks = ai.seen[0].body.messages[0].content;
  assert.deepEqual(blocks.slice(0, 2).map(b => [b.type, b.source.media_type]), [['image', 'image/jpeg'], ['image', 'image/png']]);
});

test('what is not a report file, too many files, a PDF with others and an oversize file are refused before any call', async t => {
  const ai = await fakeAnthropic(t, () => message(READING));
  const s = await serverWith(t, { ANTHROPIC_API_KEY: 'sk-test', ANTHROPIC_BASE_URL: ai.url, MEDIA_DOC_MAX_MB: '0.001' });
  assert.equal((await s.read([{ mime: 'image/svg+xml', data: b64(M.svg()) }])).status, 415);
  assert.equal((await s.read([{ mime: 'video/mp4', data: b64(M.mp4()) }])).status, 415);
  assert.equal((await s.read([])).status, 400);
  assert.equal((await s.read(Array(7).fill({ mime: 'image/jpeg', data: b64(M.jpeg()) }))).status, 400);
  assert.equal((await s.read([{ data: b64(M.pdf()) }, { data: b64(M.jpeg()) }])).body.code, 'exam-files');
  const big = Buffer.concat([M.pdf(), Buffer.alloc(2000, 32)]);
  assert.equal((await s.read([{ data: b64(big) }])).status, 413);
  assert.equal(ai.seen.length, 0);
});

test('a refusal, a failing API, an unreadable answer and a missing session each get their own answer', async t => {
  const answers = [
    [200, { stop_reason: 'refusal', content: [] }],
    [500, { type: 'error', error: { type: 'api_error', message: 'boom' } }],
    [200, { stop_reason: 'end_turn', content: [{ type: 'text', text: 'not json' }] }],
    [200, { stop_reason: 'max_tokens', content: [{ type: 'text', text: '{' }] }]
  ];
  const ai = await fakeAnthropic(t, n => answers[n - 1]);
  const s = await serverWith(t, { ANTHROPIC_API_KEY: 'sk-test', ANTHROPIC_BASE_URL: ai.url });
  const file = [{ data: b64(M.pdf()) }];
  assert.deepEqual([(await s.read(file)).body.code, (await s.read(file)).body.code, (await s.read(file)).body.code, (await s.read(file)).body.code],
    ['refused', 'unavailable', 'unreadable', 'truncated']);
  const anon = await fetch(`${s.base}/api/exams/read`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ files: file }) });
  assert.equal(anon.status, 401);
  assert.doesNotMatch(s.log(), /JVBER/);   // the report itself (base64 "%PDF") never reaches the log
});

test('an organisation key names its workspace; a key the API refuses is told apart', async t => {
  const answers = [message(READING), [400, { type: 'error', error: { type: 'invalid_request_error', message: 'This API key is not scoped to a workspace, so this request must include the anthropic-workspace-id header' } }]];
  const ai = await fakeAnthropic(t, n => answers[n - 1]);
  const s = await serverWith(t, { ANTHROPIC_API_KEY: 'sk-org', ANTHROPIC_BASE_URL: ai.url, ANTHROPIC_WORKSPACE_ID: 'wrkspc_123' });
  assert.equal((await s.read([{ data: b64(M.pdf()) }])).status, 200);
  assert.equal(ai.seen[0].headers['anthropic-workspace-id'], 'wrkspc_123');
  assert.equal((await s.read([{ data: b64(M.pdf()) }])).body.code, 'config');
});

test('without ANTHROPIC_API_KEY the feature is not there at all', async t => {
  const s = await serverWith(t, {});
  assert.equal((await s.read([{ data: b64(M.pdf()) }])).status, 404);
  assert.equal((await (await fetch(`${s.base}/api/config`)).json()).exams_ai, undefined);
});
