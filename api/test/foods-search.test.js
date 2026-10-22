/* GET /api/foods/search: packaged products by name, asked of Open Food Facts by the server
   (food-search.js). A real server.js child talks to a fake Search-a-licious on localhost
   (OFF_SEARCH_URL): the query has to ask for products sold in Brazil, the answer has to carry only
   what the app reads, and a failure upstream has to be an answer the app can show. */
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

const API = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SECRET = crypto.randomBytes(32).toString('hex');
const mint = uid => { const p = `${uid}:${Date.now() + 86400000}:0`; return p + '.' + crypto.createHmac('sha256', SECRET).update(p).digest('base64url'); };

async function fakeOff(t, answer) {
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push(new URL(req.url, 'http://x'));
    const [status, body] = answer(seen.length);
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  return { url: `http://127.0.0.1:${server.address().port}/search`, seen };
}

async function serverWith(t, env) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-foods-'));
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
  const search = async (q, cookie = true) => {
    const r = await fetch(`${base}/api/foods/search?q=${encodeURIComponent(q)}`, { headers: cookie ? { Cookie: `gymsid=${mint('u1')}` } : {} });
    return { status: r.status, body: await r.json() };
  };
  return { search };
}

const HIT = { code: '7891515791179', brands: ['PERDIX', 'Perdigão'], product_name: 'Empanado De Frango Perdigão', product_name_pt: 'Empanado De Frango Perdigão',
  nutriments: { 'energy-kcal_100g': 238, proteins_100g: 13.1, carbohydrates_100g: 15.4, fat_100g: 13.8, 'saturated-fat_100g': 4 }, serving_quantity: 130, serving_quantity_unit: 'g', serving_size: '130 g', ecoscore_grade: 'c' };

test('products sold in Brazil come back with only what the app reads, and a query is asked once', async t => {
  const off = await fakeOff(t, () => [200, { hits: [HIT, { product_name: 'no code' }] }]);
  const s = await serverWith(t, { OFF_SEARCH_URL: off.url });
  assert.equal((await s.search('nuggets', false)).status, 401);
  const r = await s.search('Nuggets!');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.products, [{ code: '7891515791179', product_name: 'Empanado De Frango Perdigão', product_name_pt: 'Empanado De Frango Perdigão', generic_name: '', brands: 'PERDIX',
    nutriments: { 'energy-kcal_100g': 238, proteins_100g: 13.1, carbohydrates_100g: 15.4, fat_100g: 13.8 }, serving_quantity: 130, serving_quantity_unit: 'g', serving_size: '130 g' }]);
  assert.equal(off.seen[0].searchParams.get('q'), 'nuggets countries_tags:"en:brazil"');
  await s.search('nuggets');
  assert.equal(off.seen.length, 1, 'the same query is answered from memory');
  assert.deepEqual((await s.search('ab')).body, { products: [] });
  assert.equal(off.seen.length, 1, 'too short a query asks nothing');
});

test('Open Food Facts failing is a 502 the app can show', async t => {
  const off = await fakeOff(t, () => [503, { error: 'busy' }]);
  const s = await serverWith(t, { OFF_SEARCH_URL: off.url });
  const r = await s.search('biscoito');
  assert.equal(r.status, 502);
  assert.equal(r.body.code, 'unavailable');
});
