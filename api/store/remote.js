/* The Supabase side of STORE=supabase: a few RPC calls and the Storage API, over HTTPS only.
 *
 * The database is reached through PostgREST (`/rest/v1/rpc/<fn>`) with the service role key,
 * never through a Postgres connection: the self-hosted instance this was written for keeps
 * 5432/6543 closed and only its HTTPS gateway open, and a serverless function cannot hold a
 * connection between requests anyway. Every function called here is defined in supabase.sql,
 * lives in `public` with EXECUTE granted to service_role alone, and works on tables in the
 * `opengym` schema, which nothing else can read.
 */

export class RemoteError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

const TIMEOUT_MS = Math.max(1000, +(process.env.SUPABASE_TIMEOUT_MS || 15000) || 15000);

export function createRemote({ url, key, fetch = globalThis.fetch, timeoutMs = TIMEOUT_MS } = {}) {
  if (!url || !key) throw new Error('STORE=supabase needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  const base = String(url).replace(/\/+$/, '');
  const auth = { apikey: key, Authorization: `Bearer ${key}` };
  const signal = () => AbortSignal.timeout(timeoutMs);

  async function rpc(name, args = {}) {
    let r;
    try {
      r = await fetch(`${base}/rest/v1/rpc/${name}`, {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(args),
        signal: signal()
      });
    } catch (e) { throw new RemoteError(`supabase ${name}: ${e.message}`, 0); }
    const text = await r.text();
    // The message only, never the body echoed whole: it can carry the arguments, and those can
    // carry a profile's whole document.
    if (!r.ok) {
      let msg = text.slice(0, 200);
      try { msg = JSON.parse(text).message || msg; } catch { /* not JSON */ }
      throw new RemoteError(`supabase ${name}: ${r.status} ${msg}`, r.status);
    }
    return text ? JSON.parse(text) : null;
  }

  const objectUrl = (bucket, path) => `${base}/storage/v1/object/${bucket}/${path.split('/').map(encodeURIComponent).join('/')}`;
  const storage = {
    async put(bucket, path, body, contentType) {
      const r = await fetch(objectUrl(bucket, path), {
        method: 'POST',
        headers: { ...auth, 'Content-Type': contentType, 'x-upsert': 'true', 'Cache-Control': 'no-store' },
        body, signal: signal()
      });
      if (!r.ok) throw new RemoteError(`storage put ${r.status} ${(await r.text()).slice(0, 200)}`, r.status);
    },
    /** The object's bytes, or null when there is none. */
    async get(bucket, path) {
      const r = await fetch(objectUrl(bucket, path), { headers: auth, signal: signal() });
      if (r.status === 404 || r.status === 400) { await r.arrayBuffer().catch(() => {}); return null; }
      if (!r.ok) throw new RemoteError(`storage get ${r.status}`, r.status);
      return Buffer.from(await r.arrayBuffer());
    },
    async remove(bucket, paths) {
      if (!paths.length) return;
      const r = await fetch(`${base}/storage/v1/object/${bucket}`, {
        method: 'DELETE',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefixes: paths }), signal: signal()
      });
      if (!r.ok && r.status !== 404) throw new RemoteError(`storage remove ${r.status}`, r.status);
    }
  };

  return { rpc, storage };
}
