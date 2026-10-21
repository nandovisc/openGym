/* A stand-in for the two Supabase endpoints STORE=supabase talks to, on top of a real Postgres.
 *
 * `/rest/v1/rpc/<fn>` runs the actual functions of store/supabase.sql, as service_role (so the
 * grants are tested too), the way PostgREST calls them: named arguments from the JSON body, the
 * function's own JSON as the answer. `/storage/v1/object/...` keeps objects in memory. Nothing
 * else of either API is here; nothing else is called.
 */
import http from 'node:http';
import postgres from 'postgres';

export async function startFakeSupabase({ databaseUrl, key }) {
  const sql = postgres(databaseUrl, { max: 10, onnotice: () => {} });
  const objects = new Map();   // "bucket/path" -> { type, bytes }
  const read = req => new Promise((resolve, reject) => {
    const c = []; req.on('data', d => c.push(d)); req.on('end', () => resolve(Buffer.concat(c))); req.on('error', reject);
  });
  const send = (res, code, body, type = 'application/json') => { res.writeHead(code, { 'Content-Type': type }); res.end(body); };

  const server = http.createServer(async (req, res) => {
    try {
      if (req.headers.apikey !== key || req.headers.authorization !== `Bearer ${key}`) return send(res, 401, '{"message":"bad key"}');
      const url = new URL(req.url, 'http://x');
      const rpc = /^\/rest\/v1\/rpc\/([a-z_]+)$/.exec(url.pathname);
      if (rpc && req.method === 'POST') {
        const args = JSON.parse((await read(req)).toString() || '{}');
        const names = Object.keys(args);
        const params = [], parts = [];
        for (const n of names) {
          const v = args[n];
          params.push(v);
          parts.push(`${n} => $${params.length}${Array.isArray(v) ? '::text[]' : v !== null && typeof v === 'object' ? '::jsonb' : ''}`);
        }
        const rows = await sql.begin(async t => {
          await t`set local role service_role`;
          return t.unsafe(`select public.${rpc[1]}(${parts.join(', ')}) as r`, params);
        });
        const r = rows[0]?.r;
        return send(res, 200, r === undefined || r === null ? 'null' : JSON.stringify(r));
      }
      const obj = /^\/storage\/v1\/object\/([^/]+)\/(.+)$/.exec(url.pathname);
      if (obj && req.method === 'POST') {
        objects.set(`${obj[1]}/${decodeURIComponent(obj[2])}`, { type: req.headers['content-type'], bytes: await read(req) });
        return send(res, 200, '{"Key":"ok"}');
      }
      if (obj && req.method === 'GET') {
        const o = objects.get(`${obj[1]}/${decodeURIComponent(obj[2])}`);
        if (!o) return send(res, 400, '{"statusCode":"404","error":"not_found"}');
        return send(res, 200, o.bytes, o.type);
      }
      const bucket = /^\/storage\/v1\/object\/([^/]+)$/.exec(url.pathname);
      if (bucket && req.method === 'DELETE') {
        const { prefixes = [] } = JSON.parse((await read(req)).toString() || '{}');
        for (const p of prefixes) objects.delete(`${bucket[1]}/${p}`);
        return send(res, 200, '[]');
      }
      send(res, 404, '{"message":"not here"}');
    } catch (e) {
      send(res, 400, JSON.stringify({ message: e.message }));
    }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    sql,
    objects,
    async reset() {
      await sql`truncate opengym.kv, opengym.states, opengym.audit, opengym.media, opengym.push_queue`;
      objects.clear();
    },
    async close() { server.close(); await sql.end({ timeout: 1 }); }
  };
}
