/* One request, one transaction: what STORE=supabase puts in place of "one process, one event loop".
 *
 * With files on disk the API's whole safety argument is that there is a single Node process:
 * `db` lives in its memory, every route reads and changes it with nothing awaited in between,
 * and saveDb() writes the result. On Vercel there are many instances at once, each one serving
 * several requests at once, and none of them keeps anything between requests. So every request
 * here gets its own copy of everything the routes touch:
 *
 *   1. begin() loads `db` and the three short-lived maps (challenges, pairings, presence), each
 *      with the version it was stored under. A profile's document is loaded the first time a
 *      route asks for it.
 *   2. The route runs unchanged against that copy, inside an AsyncLocalStorage context, so two
 *      requests on one instance never see each other's copy. Its answer is held back.
 *   3. commit() sends what changed in ONE call (opengym_commit), which writes it all only if
 *      every row is still at the version this request read. Audit lines and rest-timer pushes
 *      ride along in the same call, so a request that is retried leaves none of them twice.
 *   4. A row someone else wrote in the meantime fails the whole commit; the request is then run
 *      again from the top against the newer rows, and only the answer of the attempt that
 *      committed is sent. The same compare-and-write the single process gave, across instances.
 *
 * "What changed" is decided by comparing the serialised copy with what was loaded, not by who
 * called saveDb(): a route that changes a row in place (a presence row marked hidden, a passkey
 * counter) is written either way, the way the next saveDb() of the single process wrote it.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { Readable, Writable } from 'node:stream';

export class ConflictError extends Error {
  constructor() { super('the request kept meeting newer writes'); this.code = 'conflict'; }
}

const MAP_KEYS = ['challenges', 'pairings', 'presence'];
const DB_LISTS = ['users', 'creds', 'subs', 'invites', 'deviceLinks', 'trainerLinks'];

export function createTx(remote, { maxAttempts = 10, log = console } = {}) {
  const als = new AsyncLocalStorage();
  // Per instance: the last text of each profile's document and its version. The client asks for
  // its revision every half minute; with this the database answers "unchanged" instead of
  // sending a document that can be megabytes, every time.
  const stateCache = new Map();          // uid -> { version, text, parsed? }
  const STATE_CACHE_MAX = 64;
  const mapSweeps = {};                  // name -> (value, now) => boolean, true = drop on load

  function current() {
    const c = als.getStore();
    if (!c) throw new Error('store: used outside a request');
    return c;
  }

  const serialize = {
    db: c => JSON.stringify(c.db),
    map: (c, k) => JSON.stringify([...c.maps[k]])
  };

  async function begin() {
    const rows = (await remote.rpc('opengym_load', {})) || {};
    const c = { base: {}, versions: {}, maps: {}, db: null, states: new Map(), writes: new Map(), audit: [], push: [], after: [] };
    let db = {};
    try { db = rows.db?.value ? JSON.parse(rows.db.value) : {}; } catch (e) {
      // The single-process server refuses to start on an unreadable db.json rather than start as
      // a new instance. The same here: nothing is answered from a copy that is not the real one.
      throw new Error('store: the stored db does not parse: ' + e.message);
    }
    if (!db || typeof db !== 'object' || Array.isArray(db)) throw new Error('store: the stored db is not an object');
    for (const k of DB_LISTS) db[k] = db[k] || [];
    c.db = db;
    c.versions.db = rows.db?.version || 0;
    c.base.db = serialize.db(c);
    const now = Date.now();
    for (const k of MAP_KEYS) {
      let entries = [];
      try { entries = rows[k]?.value ? JSON.parse(rows[k].value) : []; } catch { entries = []; }
      const m = new Map(Array.isArray(entries) ? entries : []);
      // What the single process swept every minute is swept here on the way in, before the
      // copy is taken as the base, so an expired row costs no write of its own.
      const drop = mapSweeps[k];
      if (drop) for (const [key, v] of m) if (drop(v, now)) m.delete(key);
      c.maps[k] = m;
      c.versions[k] = rows[k]?.version || 0;
      c.base[k] = serialize.map(c, k);
    }
    return c;
  }

  async function commit(c) {
    const kv = [];
    const dbText = serialize.db(c);
    if (dbText !== c.base.db) kv.push({ key: 'db', value: dbText, version: c.versions.db });
    for (const k of MAP_KEYS) {
      const t = serialize.map(c, k);
      if (t !== c.base[k]) kv.push({ key: k, value: t, version: c.versions[k] });
    }
    const states = [...c.writes].map(([uid, w]) => ({ uid, doc: w.doc, version: w.version }));
    if (!kv.length && !states.length && !c.audit.length && !c.push.length) return true;
    const r = await remote.rpc('opengym_commit', { p: { kv, states, audit: c.audit, push: c.push } });
    if (!r?.ok) return false;
    for (const s of states) {
      if (s.doc == null) stateCache.delete(s.uid);
      else rememberState(s.uid, r.states?.[s.uid], s.doc);
    }
    return true;
  }

  function rememberState(uid, version, text) {
    if (!version) { stateCache.delete(uid); return; }
    stateCache.delete(uid);
    stateCache.set(uid, { version, text });
    while (stateCache.size > STATE_CACHE_MAX) stateCache.delete(stateCache.keys().next().value);
  }

  /** Runs `fn` as one transaction, again from the top while its commit meets newer rows. */
  async function run(fn) {
    for (let attempt = 1; ; attempt++) {
      const c = await begin();
      const result = await als.run(c, fn);
      if (await commit(c)) {
        // Outside the transaction that just ended: whatever these do (send a push, which may
        // prune a subscription) is a transaction of its own.
        for (const f of c.after) {
          try { await als.exit(f); } catch (e) { log.error('store: after-commit task failed', e); }
        }
        return result;
      }
      if (attempt >= maxAttempts) throw new ConflictError();
      // Requests that collided would collide again if they all came straight back; a short,
      // random and growing pause spreads them out.
      await new Promise(r => setTimeout(r, Math.random() * 20 * attempt));
    }
  }

  /** The current request's `db`, as one object the routes can keep a reference to. */
  const db = new Proxy({}, {
    get: (_, k) => current().db[k],
    set: (_, k, v) => { current().db[k] = v; return true; },
    has: (_, k) => k in current().db,
    deleteProperty: (_, k) => delete current().db[k],
    ownKeys: () => Reflect.ownKeys(current().db),
    getOwnPropertyDescriptor: (_, k) => {
      const d = Reflect.getOwnPropertyDescriptor(current().db, k);
      return d && { ...d, configurable: true };
    }
  });

  /** A Map that is the current request's copy of the stored map `name`. */
  function map(name, { sweep } = {}) {
    if (!MAP_KEYS.includes(name)) throw new Error('store: unknown map ' + name);
    if (sweep) mapSweeps[name] = sweep;
    const m = () => current().maps[name];
    return {
      get: k => m().get(k),
      set(k, v) { m().set(k, v); return this; },
      has: k => m().has(k),
      delete: k => m().delete(k),
      clear: () => m().clear(),
      keys: () => m().keys(),
      values: () => m().values(),
      entries: () => m().entries(),
      forEach: (f, t) => m().forEach(f, t),
      get size() { return m().size; },
      [Symbol.iterator]: () => m()[Symbol.iterator]()
    };
  }

  /** The stored text of a profile's document (null for none), read once per request. */
  async function stateText(uid) {
    const c = current();
    const seen = c.states.get(uid);
    if (seen) return seen.text;
    const have = stateCache.get(uid);
    const r = await remote.rpc('opengym_state', { p_uid: uid, p_have: have?.version ?? -1 });
    const version = r?.version || 0;
    let text;
    if (!version) { text = null; stateCache.delete(uid); }
    else if (r.doc == null && have && have.version === version) text = have.text;
    else { text = r.doc; rememberState(uid, version, text); }
    c.states.set(uid, { text, version });
    return text;
  }
  /** The document parsed once per instance and version, shared like the stat cache of the
   *  single process shares it. For readers that only look (the reminder tick, the revision). */
  async function stateShared(uid) {
    const text = await stateText(uid);
    if (text == null) return { text: null, parsed: null };
    const hit = stateCache.get(uid);
    if (hit && hit.text === text) {
      if (!('parsed' in hit)) { try { hit.parsed = JSON.parse(text); } catch { hit.parsed = undefined; } }
      return { text, parsed: hit.parsed };
    }
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = undefined; }
    return { text, parsed };
  }
  /** Replaces the document, if it is still at the version this request read when it commits. */
  function writeState(uid, text) {
    const c = current();
    const seen = c.states.get(uid);
    c.writes.set(uid, { doc: text, version: seen ? seen.version : null });
    c.states.set(uid, { text, version: seen?.version ?? 0 });
  }
  function deleteState(uid) {
    const c = current();
    c.writes.set(uid, { doc: null, version: null });
    c.states.set(uid, { text: null, version: 0 });
  }

  return {
    run, db, map, stateText, stateShared, writeState, deleteState,
    audit: rec => current().audit.push(rec),
    push: op => current().push.push(op),
    after: f => current().after.push(f),
    inRequest: () => !!als.getStore()
  };
}

/* ---------- the request and the answer, replayable ---------- */

/** The body, read whole once, so every attempt can read it again. `null` past `limit`. */
export function readRaw(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0, over = false;
    req.on('data', d => {
      size += d.length;
      if (over) { if (size > 2 * limit) req.destroy(); return; }
      if (size > limit) { over = true; chunks.length = 0; return; }
      chunks.push(d);
    });
    req.on('end', () => resolve(over ? null : Buffer.concat(chunks)));
    req.on('error', e => reject(Object.assign(e, { clientGone: true })));
  });
}

/** A fresh readable copy of `req` carrying `raw` as its body. */
export function replayRequest(req, raw) {
  const r = Readable.from(raw.length ? [raw] : []);
  r.headers = req.headers;
  r.rawHeaders = req.rawHeaders;
  r.method = req.method;
  r.url = req.url;
  r.socket = req.socket;
  r.httpVersion = req.httpVersion;
  r.complete = true;
  return r;
}

/** An answer held back until the transaction commits, then sent as it was written. */
export class BufferedResponse extends Writable {
  constructor() {
    super();
    this.statusCode = 200;
    this.headersSent = false;
    this._headers = new Map();        // lower-case name -> [name, value]
    this._chunks = [];
  }
  setHeader(name, value) { this._headers.set(String(name).toLowerCase(), [name, value]); return this; }
  getHeader(name) { return this._headers.get(String(name).toLowerCase())?.[1]; }
  hasHeader(name) { return this._headers.has(String(name).toLowerCase()); }
  removeHeader(name) { this._headers.delete(String(name).toLowerCase()); }
  getHeaders() { return Object.fromEntries([...this._headers].map(([k, [, v]]) => [k, v])); }
  writeHead(code, msg, headers) {
    if (typeof msg === 'object' && msg !== null) headers = msg;
    this.statusCode = code;
    if (Array.isArray(headers)) for (let i = 0; i < headers.length; i += 2) this.setHeader(headers[i], headers[i + 1]);
    else if (headers) for (const [k, v] of Object.entries(headers)) this.setHeader(k, v);
    this.headersSent = true;
    return this;
  }
  _write(chunk, enc, cb) {
    this.headersSent = true;
    this._chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, enc));
    cb();
  }
  /** Settles once the route has finished writing (or never started to). */
  settled() {
    if (this.writableFinished || this.destroyed) return Promise.resolve();
    if (!this.writableEnded) this.end();
    return new Promise(resolve => { this.once('finish', resolve); this.once('close', resolve); });
  }
  sendTo(res) {
    if (this.destroyed && !this.writableFinished) { res.destroy(); return; }
    const headers = {};
    for (const [, [name, value]] of this._headers) headers[name] = value;
    res.writeHead(this.statusCode, headers);
    res.end(Buffer.concat(this._chunks));
  }
}
