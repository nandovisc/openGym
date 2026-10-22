// One structured Messages API call over plain fetch, shared by the readers of Health: a medical
// exam's report (exam-reader.js) and the photo of a plate (meal-reader.js). Plain fetch, the way
// coach/core/adapters/anthropic.js talks to the same API: the api keeps its dependencies few.
//
// The answer is JSON held to the caller's schema by the API itself (structured outputs). A refusal
// is retried by the API on another model in the same call (server-side fallback). Nothing sent or
// received is logged: only the API's own error message, never the request, which carries the
// person's files.

export const ANTHROPIC_VERSION = '2023-06-01';
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

export class AiCallError extends Error {
  constructor(status, code, message) { super(message || code); this.status = status; this.code = code; }
}

/**
 * The settings of one reader from the environment: the shared key, workspace and base, and the
 * reader's own model, effort and time limit (`<PREFIX>_MODEL`, `_EFFORT`, `_TIMEOUT_MS`).
 * `key` empty = the feature is off.
 */
export function anthropicConfig(env, prefix, { effort = 'low' } = {}) {
  const e = env[`${prefix}_EFFORT`] || '';
  return {
    key: String(env.ANTHROPIC_API_KEY || '').trim(),
    // A key made for the whole organisation, not for one workspace, has to say which workspace
    // it spends from; a workspace's own key needs nothing here.
    workspace: String(env.ANTHROPIC_WORKSPACE_ID || '').trim(),
    base: String(env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/+$/, ''),
    model: String(env[`${prefix}_MODEL`] || 'claude-opus-5-5').trim(),
    effort: /^(low|medium|high|xhigh|max)$/.test(e) ? e : effort,
    timeoutMs: Math.max(5000, +(env[`${prefix}_TIMEOUT_MS`] || 110000) || 110000)
  };
}

/** Files ([{ mime, bytes: Buffer }]) as content blocks: a PDF as a document, a photo as an image. */
export const fileBlocks = files => files.map(f => (f.mime === 'application/pdf'
  ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: f.bytes.toString('base64') } }
  : { type: 'image', source: { type: 'base64', media_type: f.mime, data: f.bytes.toString('base64') } }));

/**
 * The parsed JSON answer to `content` under `system`, held to `schema`. Throws AiCallError: 502
 * when the API fails or answers something unreadable ('config' when it refuses the key itself),
 * 504 when it does not answer in time, 422 when it declines. `what` names the job in the log.
 */
export async function structuredCall(cfg, { system, content, schema, maxTokens = 16000, what = 'ai call' }, fetchImpl = globalThis.fetch) {
  const body = {
    model: cfg.model,
    max_tokens: maxTokens,
    system,
    output_config: { effort: cfg.effort, format: { type: 'json_schema', schema } },
    fallbacks: 'default',
    messages: [{ role: 'user', content }]
  };
  let r;
  try {
    r = await fetchImpl(`${cfg.base}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': cfg.key,
        'anthropic-version': ANTHROPIC_VERSION,
        'anthropic-beta': FALLBACK_BETA,
        ...(cfg.workspace ? { 'anthropic-workspace-id': cfg.workspace } : {})
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(cfg.timeoutMs)
    });
  } catch (e) {
    if (e?.name === 'TimeoutError' || e?.name === 'AbortError') throw new AiCallError(504, 'timeout', 'the reading took too long');
    throw new AiCallError(502, 'unavailable', 'the reading service could not be reached');
  }
  let data = null;
  try { data = await r.json(); } catch { /* not JSON */ }
  if (!r.ok) {
    console.error(`${what} failed`, r.status, data?.error?.type || '', String(data?.error?.message || '').slice(0, 200));
    // The key itself refused (wrong, revoked, or one that needs a workspace): the instance's
    // setting to fix, not something trying again would change.
    const code = r.status === 429 ? 'busy' : r.status === 401 || r.status === 403 || (r.status === 400 && data?.error?.type === 'invalid_request_error' && /api key|workspace/i.test(data?.error?.message || '')) ? 'config' : 'unavailable';
    throw new AiCallError(502, code, code === 'config' ? 'the server\'s AI key was not accepted' : 'the reading service failed');
  }
  if (data?.stop_reason === 'refusal') throw new AiCallError(422, 'refused', 'the file could not be read');
  if (data?.stop_reason === 'max_tokens') throw new AiCallError(502, 'truncated', 'the answer was too long');
  const text = (data?.content || []).filter(b => b?.type === 'text').map(b => b.text).join('');
  try {
    const out = JSON.parse(text);
    if (out && typeof out === 'object') return out;
  } catch { /* below */ }
  throw new AiCallError(502, 'unreadable', 'the reading could not be understood');
}
