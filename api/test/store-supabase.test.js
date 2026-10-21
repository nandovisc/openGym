/* STORE=supabase end to end: two server processes, one database, nothing shared but the database.
 *
 * What the single process guaranteed by being single has to hold across instances now: a write
 * one instance makes is what the other reads, two writes that race never lose one of them, a
 * WebAuthn challenge or a pairing code handed out by one is good at the other, and the cookie
 * secret survives a restart. Each test talks plain HTTP to real `node server.js` processes whose
 * Supabase is test/fake-supabase.mjs — the real SQL of store/supabase.sql on a real Postgres.
 *
 * Needs a Postgres with store/supabase.sql applied and roles anon/authenticated/service_role:
 *   OPENGYM_TEST_PG=postgres://postgres@127.0.0.1:55432/postgres npm test
 * Skipped without it, like any test that needs something the box may not have. */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { boundPort } from './helpers.mjs';

const PG = process.env.OPENGYM_TEST_PG;
const API = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const KEY = 'service-role-test-key';
const CRON = 'cron-test-secret';
const SECRET = crypto.randomBytes(32).toString('hex');
const skip = !PG && 'OPENGYM_TEST_PG is not set';

let fake;
const children = new Set();
before(async () => {
  if (skip) return;
  const { startFakeSupabase } = await import('./fake-supabase.mjs');
  fake = await startFakeSupabase({ databaseUrl: PG, key: KEY });
});
after(async () => {
  for (const c of children) c.kill('SIGKILL');
  await fake?.close();
});
beforeEach(async () => {
  if (skip) return;
  await fake.reset();
  // A profile and an admin, and the secret the cookies below are signed with — stored before any
  // instance boots, so opengym_bootstrap keeps them.
  const db = { users: [{ id: 'u1', name: 'One', created: new Date().toISOString() }, { id: 'u2', name: 'Two', created: new Date().toISOString() }], creds: [], subs: [], invites: [], deviceLinks: [] };
  await fake.sql`insert into opengym.kv (key, value) values ('secret', ${SECRET}), ('db', ${JSON.stringify(db)})`;
});

function mint(uid) {
  const payload = `${uid}:${Date.now() + 86400000}:0`;
  return payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
}
async function instance(t, env = {}) {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env, PORT: '0', STORE: 'supabase', SUPABASE_URL: fake.url, SUPABASE_SERVICE_ROLE_KEY: KEY,
      ORIGIN: 'http://localhost:8080', RP_ID: 'localhost', ADMIN_UIDS: 'u1', CRON_SECRET: CRON,
      COACH_DISABLED: '1', DATA_DIR: '/nonexistent-opengym', ...env
    }
  });
  children.add(child);
  let log = '';
  child.stdout.on('data', d => log += d); child.stderr.on('data', d => log += d);
  t.after(() => { child.kill('SIGKILL'); children.delete(child); });
  const base = `http://127.0.0.1:${await boundPort(child, () => log)}`;
  const call = async (method, p, { uid, body, headers = {} } = {}) => {
    const r = await fetch(base + p, {
      method,
      headers: { ...(uid ? { Cookie: `gymsid=${mint(uid)}` } : {}), ...(body !== undefined && !Buffer.isBuffer(body) ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body === undefined ? undefined : Buffer.isBuffer(body) ? body : JSON.stringify(body)
    });
    const type = r.headers.get('content-type') || '';
    return { status: r.status, headers: r.headers, body: type.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) };
  };
  return { base, call, log: () => log, child };
}
const storedDb = async () => JSON.parse((await fake.sql`select value from opengym.kv where key = 'db'`)[0].value);
const storedState = async uid => {
  const row = (await fake.sql`select doc from opengym.states where uid = ${uid}`)[0];
  return row ? JSON.parse(row.doc) : null;
};

test('what one instance writes, the other reads; the session secret is the stored one', { skip }, async t => {
  const [a, b] = [await instance(t), await instance(t)];
  assert.equal((await a.call('GET', '/api/me', { uid: 'u1' })).status, 200);
  const put = await a.call('PUT', '/api/data', { uid: 'u1', body: { state: { _ts: 1, unit: 'kg', workouts: [{ id: 'w1', d: '2026-10-01' }], routines: [] }, baseRev: 0 } });
  assert.equal(put.status, 200);
  assert.equal(put.body.rev, 1);
  const got = await b.call('GET', '/api/data', { uid: 'u1' });
  assert.equal(got.status, 200);
  assert.equal(got.body.rev, 1);
  assert.deepEqual(got.body.state.workouts.map(w => w.id), ['w1']);
  assert.deepEqual(await (await b.call('GET', '/api/data/rev', { uid: 'u1' })).body, { rev: 1, wid: put.body.wid });
  // the document is stored byte for byte as the server wrote it
  assert.equal((await storedState('u1'))._wid, put.body.wid);
  // GET /api/data noted the pull on the user record (a write on a read, committed)
  assert.ok((await storedDb()).users.find(u => u.id === 'u2').lastPull === undefined);
  assert.ok(typeof (await storedDb()).users.find(u => u.id === 'u1').lastPull === 'number');
});

test('two devices pushing over the same revision at once: one wins, the other gets a 409 with it', { skip }, async t => {
  const [a, b] = [await instance(t), await instance(t)];
  assert.equal((await a.call('PUT', '/api/data', { uid: 'u1', body: { state: { _ts: 1, workouts: [], routines: [] }, baseRev: 0 } })).status, 200);
  const results = await Promise.all([a, b, a, b, a, b].map((inst, i) =>
    inst.call('PUT', '/api/data', { uid: 'u1', body: { state: { _ts: 10 + i, workouts: [{ id: 'w' + i, d: '2026-10-02' }], routines: [] }, baseRev: 1 } })));
  const ok = results.filter(r => r.status === 200);
  assert.equal(ok.length, 1, results.map(r => r.status).join(','));
  assert.ok(results.every(r => r.status === 200 || r.status === 409));
  const winner = (await storedState('u1')).workouts[0].id;
  for (const r of results.filter(x => x.status === 409)) assert.deepEqual(r.body.state.workouts.map(w => w.id), [winner]);
  assert.equal((await storedState('u1'))._rev, 2);
});

test('writes to db from many requests on two instances at once all land (retried, not lost)', { skip }, async t => {
  const [a, b] = [await instance(t), await instance(t)];
  const n = 12;
  const results = await Promise.all(Array.from({ length: n }, (_, i) => (i % 2 ? a : b).call('POST', '/api/push/subscribe', {
    uid: i % 3 ? 'u1' : 'u2',
    body: { subscription: { endpoint: `https://push.example.com/sub/${i}`, keys: { p256dh: 'p' + i, auth: 'a' + i } } }
  })));
  assert.deepEqual(results.map(r => r.status), Array(n).fill(200));
  const subs = (await storedDb()).subs;
  assert.equal(subs.length, n);
  assert.deepEqual(new Set(subs.map(s => s.endpoint)).size, n);
});

test('a challenge from one instance is good at the other, and only once', { skip }, async t => {
  const [a, b] = [await instance(t), await instance(t)];
  const opts = await a.call('POST', '/api/login/options', { body: {} });
  assert.equal(opts.status, 200);
  // Past the challenge, into the credential lookup: the challenge was found on B.
  const v = await b.call('POST', '/api/login/verify', { body: { cid: opts.body.cid, credential: { id: 'nope' } } });
  assert.equal(v.status, 404);
  assert.equal(v.body.code, 'unknown-credential');
  // and it was used up there
  const again = await a.call('POST', '/api/login/verify', { body: { cid: opts.body.cid, credential: { id: 'nope' } } });
  assert.equal(again.body.code, 'challenge-expired');
});

test('a pairing code minted on one instance is redeemed on the other', { skip }, async t => {
  const [a, b] = [await instance(t), await instance(t)];
  const made = await a.call('POST', '/api/pair/create', { uid: 'u2', body: {} });
  assert.equal(made.status, 200);
  const red = await b.call('POST', '/api/pair/redeem', { body: { code: made.body.code } });
  assert.equal(red.status, 200);
  assert.equal(red.body.user.id, 'u2');
  assert.equal((await a.call('POST', '/api/pair/redeem', { body: { code: made.body.code } })).status, 400);
});

test('live presence and the audit log are seen by an admin on another instance', { skip }, async t => {
  const [a, b] = [await instance(t), await instance(t)];
  assert.equal((await a.call('POST', '/api/activity', { uid: 'u2', body: { active: true, name: 'Legs', exIdx: 1, exTotal: 5 } })).status, 200);
  const list = await b.call('GET', '/api/admin/users', { uid: 'u1' });
  assert.equal(list.status, 200);
  assert.equal(list.body.users.find(u => u.id === 'u2').live?.name, 'Legs');
  assert.equal((await a.call('POST', '/api/logout', { uid: 'u2', body: {} })).status, 200);
  const log = await b.call('GET', '/api/admin/audit', { uid: 'u1' });
  assert.equal(log.status, 200);
  assert.ok(log.body.events.some(e => e.ev === 'auth.logout' && e.uid === 'u2' && Number.isInteger(e.id)), JSON.stringify(log.body.events));
  const cleared = await a.call('POST', '/api/admin/audit/clear', { uid: 'u1', body: {} });
  assert.equal(cleared.status, 200);
  const after = await b.call('GET', '/api/admin/audit', { uid: 'u1' });
  assert.deepEqual(after.body.events.map(e => e.ev), ['admin.audit.clear']);
});

test('a restarted instance keeps signing with the same secret and VAPID key', { skip }, async t => {
  const a = await instance(t);
  const key1 = (await a.call('GET', '/api/push/public-key')).body.key;
  a.child.kill('SIGKILL');
  const b = await instance(t);
  assert.equal((await b.call('GET', '/api/push/public-key')).body.key, key1);
  assert.equal((await b.call('GET', '/api/me', { uid: 'u1' })).status, 200);
});

test('a rest timer is queued with the request and sent by the cron tick that finds it due', { skip }, async t => {
  const a = await instance(t);
  assert.equal((await a.call('POST', '/api/push/rest-timer', { uid: 'u1', body: { seconds: 1, deviceId: 'device-1234' } })).status, 200);
  assert.equal((await fake.sql`select count(*)::int as n from opengym.push_queue`)[0].n, 1);
  // a cancel from another device of the same account leaves this one alone
  await a.call('POST', '/api/push/rest-timer/cancel', { uid: 'u1', body: { deviceId: 'device-9999' } });
  assert.equal((await fake.sql`select count(*)::int as n from opengym.push_queue`)[0].n, 1);
  assert.equal((await a.call('POST', '/api/cron/tick?job=rest', { body: {} })).status, 401);
  assert.equal((await a.call('POST', '/api/cron/tick?job=rest', { body: {}, headers: { Authorization: 'Bearer wrong' } })).status, 401);
  await new Promise(r => setTimeout(r, 1100));
  const tick = await a.call('POST', '/api/cron/tick?job=rest', { body: {}, headers: { Authorization: `Bearer ${CRON}` } });
  assert.equal(tick.status, 200);
  assert.equal(tick.body.sent, 1);
  assert.equal((await fake.sql`select count(*)::int as n from opengym.push_queue`)[0].n, 0);
  for (const job of ['minute', 'hourly']) {
    assert.equal((await a.call('POST', `/api/cron/tick?job=${job}`, { body: {}, headers: { Authorization: `Bearer ${CRON}` } })).status, 200);
  }
});

test('photos go to Storage: upload, read back, missing, refused when they lie, removed with the profile', { skip }, async t => {
  const [a, b] = [await instance(t), await instance(t)];
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), crypto.randomBytes(500)]);
  const hash = crypto.createHash('sha256').update(png).digest('hex');
  const up = await a.call('PUT', `/api/media/${hash}`, { uid: 'u2', body: png, headers: { 'Content-Type': 'image/png' } });
  assert.equal(up.status, 201, JSON.stringify(up.body));
  assert.ok(fake.objects.has(`opengym-media/u2/${hash}.png`));
  const again = await b.call('PUT', `/api/media/${hash}`, { uid: 'u2', body: png, headers: { 'Content-Type': 'image/png' } });
  assert.equal(again.status, 200);
  assert.equal(again.body.existed, true);
  const got = await b.call('GET', `/api/media/${hash}`, { uid: 'u2' });
  assert.equal(got.status, 200);
  assert.equal(got.headers.get('content-type'), 'image/png');
  assert.ok(Buffer.compare(got.body, png) === 0);
  // another profile's file is exactly as missing as one never uploaded
  assert.equal((await b.call('GET', `/api/media/${hash}`, { uid: 'u1' })).status, 404);
  const miss = await a.call('POST', '/api/media/missing', { uid: 'u2', body: { hashes: [hash, 'f'.repeat(64)] } });
  assert.deepEqual(miss.body.missing, ['f'.repeat(64)]);
  assert.equal(miss.body.usage.count, 1);
  const liar = Buffer.from('not a png at all');
  const bad = await a.call('PUT', `/api/media/${crypto.createHash('sha256').update(liar).digest('hex')}`, { uid: 'u2', body: liar, headers: { 'Content-Type': 'image/png' } });
  assert.equal(bad.status, 415);
  const wrongHash = await a.call('PUT', `/api/media/${'a'.repeat(64)}`, { uid: 'u2', body: png, headers: { 'Content-Type': 'image/png' } });
  assert.equal(wrongHash.status, 400);
  // the state does not reference it: "reset everything" sweeps it now
  assert.equal((await a.call('PUT', '/api/data', { uid: 'u2', body: { state: { _ts: 1, workouts: [], routines: [] }, baseRev: 0 } })).status, 200);
  const sw = await b.call('POST', '/api/media/sweep', { uid: 'u2', body: {} });
  assert.equal(sw.status, 200);
  assert.equal(sw.body.removed, 1);
  assert.ok(!fake.objects.has(`opengym-media/u2/${hash}.png`));
  // profile delete removes state and files
  await a.call('PUT', `/api/media/${hash}`, { uid: 'u2', body: png, headers: { 'Content-Type': 'image/png' } });
  const del = await a.call('POST', '/api/admin/user/delete', { uid: 'u1', body: { id: 'u2' } });
  assert.equal(del.status, 200);
  assert.equal(await storedState('u2'), null);
  assert.ok(!fake.objects.has(`opengym-media/u2/${hash}.png`));
  assert.ok(!(await storedDb()).users.some(u => u.id === 'u2'));
});

test('a database that cannot be reached is a 503, not a crash', { skip }, async t => {
  const a = await instance(t);
  await fake.sql`revoke execute on function public.opengym_load() from service_role`;
  t.after(() => fake.sql`grant execute on function public.opengym_load() to service_role`);
  const r = await a.call('GET', '/api/me', { uid: 'u1' });
  assert.equal(r.status, 503);
  assert.equal(r.body.code, 'store');
  assert.equal(a.child.exitCode, null);
});
