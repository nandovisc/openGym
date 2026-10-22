/* POST /api/meals/read: the photo of a plate estimated by Claude (meal-reader.js). A real server.js
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
import { PLATE_SCHEMA } from '../meal-reader.js';

const API = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SECRET = crypto.randomBytes(32).toString('hex');
const mint = uid => { const p = `${uid}:${Date.now() + 86400000}:0`; return p + '.' + crypto.createHmac('sha256', SECRET).update(p).digest('base64url'); };

const READING = { title: 'Arroz, feijão e frango', items: [
  { name: 'Arroz, tipo 1, cozido', grams: 150, kcal: 192, protein: 3.8, carbs: 42.2, fat: 0.3 },
  { name: 'Frango, peito, sem pele, grelhado', grams: 120, kcal: 191, protein: 38.4, carbs: 0, fat: 3 }
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
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-meals-'));
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
    const r = await fetch(`${base}/api/meals/read`, { method: 'POST', headers: { Cookie: `gymsid=${mint(uid)}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ files }) });
    return { status: r.status, body: await r.json() };
  };
  return { base, read, log: () => log };
}
const b64 = buf => buf.toString('base64');

test('photos go to the API as images with the plate schema, and the estimate comes back', async t => {
  const ai = await fakeAnthropic(t, () => message(READING));
  const s = await serverWith(t, { ANTHROPIC_API_KEY: 'sk-test', ANTHROPIC_BASE_URL: ai.url, ANTHROPIC_WORKSPACE_ID: 'wrkspc_1' });
  assert.equal((await (await fetch(`${s.base}/api/config`)).json()).meals_ai, true);
  const r = await s.read([{ data: b64(M.jpeg()) }, { data: b64(M.png()) }]);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body, READING);
  const sent = ai.seen[0];
  assert.equal(sent.headers['anthropic-workspace-id'], 'wrkspc_1');
  assert.deepEqual(sent.body.output_config.format, { type: 'json_schema', schema: PLATE_SCHEMA });
  assert.deepEqual(sent.body.messages[0].content.slice(0, 2).map(b => [b.type, b.source.media_type]), [['image', 'image/jpeg'], ['image', 'image/png']]);
});

test('a PDF, too many photos and an oversize photo are refused before any call; a refusal is told apart', async t => {
  const ai = await fakeAnthropic(t, () => [200, { stop_reason: 'refusal', content: [] }]);
  const s = await serverWith(t, { ANTHROPIC_API_KEY: 'sk-test', ANTHROPIC_BASE_URL: ai.url, MEDIA_IMAGE_MAX_MB: '0.001' });
  assert.equal((await s.read([{ data: b64(M.pdf()) }])).status, 415);
  assert.equal((await s.read(Array(4).fill({ data: b64(M.jpeg()) }))).status, 400);
  assert.equal((await s.read([{ data: b64(M.jpeg(5000)) }])).status, 413);
  assert.equal(ai.seen.length, 0);
  assert.equal((await s.read([{ data: b64(M.jpeg()) }])).body.code, 'refused');
});

test('without ANTHROPIC_API_KEY the estimate is not there at all', async t => {
  const s = await serverWith(t, {});
  assert.equal((await s.read([{ data: b64(M.jpeg()) }])).status, 404);
  assert.equal((await (await fetch(`${s.base}/api/config`)).json()).meals_ai, undefined);
});
