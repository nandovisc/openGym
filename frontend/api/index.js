// The openGym API as one Vercel function (docs/VERCEL.md). Every /api/* request is rewritten here
// by vercel.json and answered by api/server.js, which runs with STORE=supabase on Vercel: the
// data lives in a Supabase database, not on a disk this function does not keep.
//
// Loaded on the first request rather than at import, so a server that cannot start (a missing
// variable, a database that did not answer its first call) says why in a 503 and in the log
// instead of a bare FUNCTION_INVOCATION_FAILED. A module that failed to evaluate stays failed for
// the life of the instance; the next cold start tries again.
let loading = null

export default async function openGymApi(req, res) {
  let api
  try {
    api = await (loading ??= import('../../api/server.js'))
  } catch (e) {
    loading = null
    console.error('openGym API could not start:', e)
    res.statusCode = 503
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Cache-Control', 'no-store')
    res.end(JSON.stringify({ error: 'the API could not start', code: 'boot', reason: String(e?.message || e).slice(0, 300) }))
    return
  }
  return api.handler(req, res)
}
