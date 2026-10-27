/* A person's own API keys (api-keys.js): the rules on their own, then a real server.js child —
   a key made in Settings reads only the areas it opens, writes only when it says so, and what it
   writes is stamped so a phone's next push keeps it. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { boundPort } from './helpers.mjs';
import { findKey, hashKey, keyOf, mintKey, newEntry, normalizeKeyInput, pageOf, parseBearer, patchEntry, publicEntry, scopeOfList, settingsFor } from '../api-keys.js';

const API = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SECRET = crypto.randomBytes(32).toString('hex');
const mint = uid => { const p = `${uid}:${Date.now() + 86400000}:0`; return p + '.' + crypto.createHmac('sha256', SECRET).update(p).digest('base64url'); };

test('a key: made once, found by its id and secret, never by a near miss', () => {
  const k = mintKey();
  assert.match(k.key, /^ogk_[0-9a-f]{12}_[A-Za-z0-9_-]{43}$/);
  assert.deepEqual(parseBearer('Bearer ' + k.key), { id: k.id, secret: k.key.slice(17) });
  assert.equal(parseBearer(k.key), null, 'Bearer is required');
  assert.equal(parseBearer('Bearer ogs_' + 'a'.repeat(30)), null, 'not a sleep token');
  const users = [{ id: 'a' }, { id: 'u', apiKeys: [{ id: k.id, h: k.h, scopes: ['body'] }] }];
  assert.equal(findKey(users, 'Bearer ' + k.key).user.id, 'u');
  const wrong = k.key.slice(0, -1) + (k.key.endsWith('A') ? 'B' : 'A');
  assert.equal(findKey(users, 'Bearer ' + wrong), null);
  assert.equal(findKey([{ ...users[1], disabled: true }], 'Bearer ' + k.key), null, 'a disabled account');
  assert.equal(hashKey('x').length, 64);
});

test('a key’s areas: named, at least one, and the students’ records only for a trainer', () => {
  assert.deepEqual(normalizeKeyInput({ name: '  App  de dieta ', scopes: ['health', 'nope', 'body'], write: 'yes' }), { name: 'App de dieta', scopes: ['body', 'health'], write: false });
  assert.deepEqual(normalizeKeyInput({ name: 'x', scopes: ['personal'] }), { error: 'scopes' });
  assert.deepEqual(normalizeKeyInput({ name: 'x', scopes: ['personal'], write: true }, { trainer: true }), { name: 'x', scopes: ['personal'], write: true });
  assert.deepEqual(normalizeKeyInput({ scopes: ['body'] }), { error: 'name' });
  assert.equal(scopeOfList('water'), 'health');
  assert.equal(scopeOfList('payments'), 'personal');
  assert.equal(scopeOfList('coach'), null, 'not every part of the profile is a list a key reads');
  assert.deepEqual(settingsFor({ unit: 'kg', targetW: 80, nutrition: { kcal: 1 }, week: {} }, ['body']), { targetW: 80, unit: 'kg' });
});

test('an entry: what each list needs, the id the server gives or the app derives, stamps never handed out', () => {
  assert.deepEqual(newEntry('bodyweight', { d: '2026-10-27', w: 80.4, id: 'x', _ts: 9 }, { now: 5 }), { entry: { d: '2026-10-27', w: 80.4, t: 5 } });
  assert.deepEqual(newEntry('bodyweight', { d: '27/10', w: 80 }), { error: 'invalid field', field: 'd' });
  assert.deepEqual(newEntry('water', { d: '2026-10-27', ml: 0 }), { error: 'invalid field', field: 'ml' });
  assert.deepEqual(newEntry('water', { d: '2026-10-27', ml: 250 }, { now: 7, id: 'w1' }), { entry: { d: '2026-10-27', ml: 250, t: 7, id: 'w1', created: 7 } });
  assert.equal(newEntry('medLog', { medId: 'm', d: '2026-10-27', time: '08:00', status: 'taken' }).entry.id, 'm|2026-10-27|08:00');
  assert.equal(newEntry('habitLog', { habitId: 'h', d: '2026-10-27', value: 1 }).entry.id, 'h|2026-10-27');
  assert.deepEqual(newEntry('meals', { d: '2026-10-27', slot: 'lunch' }), { error: 'invalid field', field: 'items' });
  assert.equal(newEntry('notes', 'x').error, 'not an object');
  assert.equal(newEntry('foods', { name: 'x', per100: {}, big: 'a'.repeat(40000) }).error, 'too large');

  const old = { id: 'm|2026-10-27|08:00', medId: 'm', d: '2026-10-27', time: '08:00', status: 'taken', _ts: 3 };
  assert.deepEqual(patchEntry('medLog', old, { status: 'skipped', d: '2026-01-01', id: 'z' }), { entry: { id: old.id, medId: 'm', d: '2026-10-27', time: '08:00', status: 'skipped' } });
  assert.deepEqual(patchEntry('medLog', old, { status: 'maybe' }), { error: 'invalid field', field: 'status' });
  assert.deepEqual(patchEntry('bodyweight', { d: '2026-10-27', w: 80 }, { d: '2026-10-28', w: 79 }), { entry: { d: '2026-10-27', w: 79 } });
  assert.equal(keyOf('bodyweight', { d: '2026-10-27' }), '2026-10-27');
  assert.equal(keyOf('workouts', { d: '2026-10-27', start: 5 }), '2026-10-27|5');
  assert.deepEqual(publicEntry({ id: 'a', _ts: 1, _f: {}, _u: {} }), { id: 'a' });
});

test('a page: by day, newest first, a page at a time', () => {
  const water = [{ id: 'a', d: '2026-10-25', t: 1 }, { id: 'b', d: '2026-10-27', t: 1 }, { id: 'c', d: '2026-10-27', t: 2, _ts: 9 }, { id: 'd', d: '2026-10-26', t: 1 }];
  const p = pageOf(water, { limit: 2 });
  assert.deepEqual([p.items.map(x => x.id), p.total, p.next], [['c', 'b'], 4, '2']);
  assert.equal(p.items[0]._ts, undefined);
  assert.deepEqual(pageOf(water, { limit: 2, cursor: p.next }).items.map(x => x.id), ['d', 'a']);
  assert.deepEqual(pageOf(water, { from: '2026-10-26', to: '2026-10-26' }).items.map(x => x.id), ['d']);
  assert.deepEqual(pageOf([{ id: 'r1' }, { id: 'r2' }]).items.map(x => x.id), ['r1', 'r2'], 'a list without days keeps its order');
  assert.equal(pageOf(water, { limit: 9999 }).items.length, 4);
});

test('a key in use: its areas, read-only or writing, stamped writes, revoked at once', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-apikeys-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
  const users = [{ id: 'u', name: 'Ana', created: new Date().toISOString() }, { id: 'v', name: 'Bia', created: new Date().toISOString() }];
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({ users, creds: [], subs: [], invites: [] }));
  fs.writeFileSync(path.join(dataDir, 'state-u.json'), JSON.stringify({
    _rev: 1, unit: 'kg', targetW: 75,
    bodyweight: [{ d: '2026-10-20', w: 80, t: 1 }, { d: '2026-10-26', w: 79.5, t: 2 }],
    water: [{ id: 'w0', d: '2026-10-26', t: 1, ml: 500 }],
    workouts: [{ id: 'wk1', d: '2026-10-26', start: 10, end: 20, entries: [] }]
  }));
  const child = spawn(process.execPath, ['server.js'], { cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080', RP_ID: 'localhost', COACH_DISABLED: '1', ANTHROPIC_API_KEY: '' } });
  let log = '';
  child.stdout.on('data', d => log += d); child.stderr.on('data', d => log += d);
  t.after(() => { child.kill('SIGKILL'); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${await boundPort(child, () => log)}`;
  const app = async (uid, method, p, b) => {
    const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', Cookie: `gymsid=${mint(uid)}` }, ...(b !== undefined ? { body: JSON.stringify(b) } : {}) });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  const api = async (key, method, p, b, headers = {}) => {
    const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: 'Bearer ' + key } : {}), ...headers }, ...(b !== undefined ? { body: JSON.stringify(b) } : {}) });
    return { status: r.status, body: await r.json().catch(() => null), headers: r.headers };
  };

  // Made in Settings: shown this once, listed without it.
  assert.equal((await app('u', 'POST', '/api/account/api-keys', { name: 'x', scopes: [] })).status, 400);
  const reader = (await app('u', 'POST', '/api/account/api-keys', { name: 'Planilha', scopes: ['body', 'training'] })).body;
  const writer = (await app('u', 'POST', '/api/account/api-keys', { name: 'App de água', scopes: ['health'], write: true })).body;
  assert.match(reader.key, /^ogk_/);
  const listed = (await app('u', 'GET', '/api/account/api-keys')).body;
  assert.deepEqual(listed.keys.map(k => [k.name, k.scopes, k.write]), [['Planilha', ['training', 'body'], false], ['App de água', ['health'], true]]);
  assert.ok(!JSON.stringify(listed).includes(reader.key.slice(17)) && !JSON.stringify(listed).includes('"h"'), 'neither the key nor its hash comes back');

  // Reading: its areas only, never with a cookie alone.
  assert.deepEqual((await api(reader.key, 'GET', '/api/v1/me')).body.key.scopes, ['training', 'body']);
  assert.deepEqual((await api(reader.key, 'GET', '/api/v1/settings')).body.settings, { targetW: 75, unit: 'kg' });
  assert.deepEqual((await api(reader.key, 'GET', '/api/v1/bodyweight?from=2026-10-21')).body.items, [{ d: '2026-10-26', w: 79.5, t: 2 }]);
  assert.equal((await api(reader.key, 'GET', '/api/v1/workouts/wk1')).body.entry.id, 'wk1');
  assert.equal((await api(reader.key, 'GET', '/api/v1/water')).status, 403, 'health is not its area');
  assert.equal((await api(reader.key, 'GET', '/api/v1/nope')).status, 404);
  assert.equal((await api(reader.key, 'POST', '/api/v1/bodyweight', { d: '2026-10-27', w: 79 })).status, 403, 'a reading key');
  assert.equal((await api(null, 'GET', '/api/v1/me', undefined, { Cookie: `gymsid=${mint('u')}` })).status, 401, 'a cookie is not a key');
  assert.equal((await api('ogk_000000000000_' + 'a'.repeat(43), 'GET', '/api/v1/me')).status, 401);

  // Writing: a drink added, changed and taken away, each stamped as the server's own edit.
  const read = (await app('u', 'GET', '/api/data')).body;
  const before = read.state || read;
  const add = await api(writer.key, 'POST', '/api/v1/water', { d: '2026-10-27', ml: 250, id: 'mine', _ts: 1 }, { Origin: 'https://other.app' });
  assert.equal(add.status, 201, JSON.stringify(add.body));
  assert.equal(add.headers.get('access-control-allow-origin'), 'https://other.app');
  const id = add.body.entry.id;
  assert.notEqual(id, 'mine');
  assert.equal((await api(writer.key, 'POST', '/api/v1/water', { d: '2026-10-27' })).body.field, 'ml');
  assert.equal((await api(writer.key, 'PATCH', `/api/v1/water/${id}`, { ml: 300 })).body.entry.ml, 300);
  let doc = (await app('u', 'GET', '/api/data')).body;
  const S = doc.state || doc;
  const drink = S.water.find(w => w.id === id);
  assert.equal(drink.ml, 300);
  assert.ok(drink._ts > 0, 'stamped, so a phone merging later keeps it');

  // A phone that read before the write pushes its own copy: refused as a conflict to merge, the
  // drink still there.
  const push = await app('u', 'PUT', '/api/data', { state: before, baseRev: before._rev });
  assert.equal(push.status, 409, JSON.stringify(push.body).slice(0, 200));
  doc = (await app('u', 'GET', '/api/data')).body;
  assert.ok((doc.state || doc).water.some(w => w.id === id));

  assert.equal((await api(writer.key, 'DELETE', `/api/v1/water/${id}`)).status, 200);
  doc = (await app('u', 'GET', '/api/data')).body;
  const after = doc.state || doc;
  assert.ok(!after.water.some(w => w.id === id));
  assert.ok(after.deleted?.water?.[id], 'the removal is on record, so no device brings it back');
  assert.equal((await api(writer.key, 'DELETE', `/api/v1/water/${id}`)).status, 404);

  // Someone else's profile is untouched, and a revoked key stops at once.
  assert.equal((await app('v', 'DELETE', `/api/account/api-keys?id=${writer.id}`)).status, 404, 'not her key');
  assert.equal((await app('u', 'DELETE', `/api/account/api-keys?id=${writer.id}`)).status, 200);
  assert.equal((await api(writer.key, 'GET', '/api/v1/me')).status, 401);
  assert.equal((await app('u', 'GET', '/api/account/api-keys')).body.keys.length, 1);
});
