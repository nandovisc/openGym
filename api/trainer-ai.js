// A first draft of a student's plan, by AI, for their trainer (the Personal module, phase 9): the
// Coach's own create task — the same prompt, library slice, parser, validator and single repair
// round (coach/core/pipeline.js) — run on the student's training as the link shares it, with an
// intake the trainer filled from the student's record (goal, restrictions, notes). It goes out
// with the instance's ANTHROPIC_API_KEY, as the exam reader does, so it needs no Coach set-up and
// spends nobody's personal account. Nothing is stored: the draft goes back to the trainer, who
// changes what they like and sends it to the student with the plan editor.
import adapter from './coach/core/adapters/anthropic.js';
import { build } from './coach/core/payload.js';
import { runPipeline } from './coach/core/pipeline.js';
import { anthropicConfig } from './anthropic-call.js';

/** The settings from the environment (TRAINER_AI_MODEL, _EFFORT, _TIMEOUT_MS). `key` empty = off. */
export const trainerAiConfig = (env = process.env) => anthropicConfig(env, 'TRAINER_AI', { effort: 'medium' });

export class TrainerAiError extends Error {
  constructor(status, code, message) { super(message || code); this.status = status; this.code = code; }
}

// What a failed attempt tells the trainer. The provider's own words go to the server's log only.
const FAIL = {
  timeout: [504, 'timeout', 'the draft took too long'],
  auth: [502, 'config', 'the server\'s AI key was not accepted'],
  missing: [502, 'config', 'the server\'s AI key was not accepted'],
  unusable: [502, 'unusable', 'the AI answered a plan the app could not use']
};

/**
 * The payload of the create task for a student: their training (trainer.js trainingOf) as the
 * profile it reads, and `intake` as the Coach's own intake answers (payload.js cleanProfile bounds
 * every field of it).
 */
export function draftPayload(training, intake, { lang = null } = {}) {
  const S = training && typeof training === 'object' ? training : {};
  return build(S, { handle: 'student', kind: 'create', intake: intake && typeof intake === 'object' ? intake : {}, lang });
}

/**
 * The draft: { name, summary, week, routines, customEx } as validate.js let it through. Throws
 * TrainerAiError: 504 when no answer came in time, 502 when the provider failed or answered
 * something unusable even after the repair round.
 */
export async function draftPlan(training, intake, cfg, { lang = null, fetch: fetchImpl = globalThis.fetch } = {}) {
  const payload = draftPayload(training, intake, { lang });
  // Both attempts share one deadline: the function that runs this has its own limit, and a repair
  // round started late would be cut off by it with nothing to say.
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), cfg.timeoutMs);
  let attempt;
  try {
    attempt = await runPipeline({
      adapter,
      cfg: { providerOptions: { anthropic: { baseUrl: cfg.base, ...(cfg.workspace ? { headers: { 'anthropic-workspace-id': cfg.workspace } } : {}) } } },
      kind: 'create', payload, model: cfg.model, timeoutMs: cfg.timeoutMs,
      invokeOpts: { env: { ANTHROPIC_API_KEY: cfg.key }, fetch: fetchImpl, signal: ctl.signal, maxTokens: 16000 }
    });
  } finally { clearTimeout(timer); }
  if (!attempt.ok) {
    if (ctl.signal.aborted) throw new TrainerAiError(...FAIL.timeout);
    if (attempt.errorClass !== 'unusable') console.error('trainer draft failed', attempt.errorClass, String(attempt.detail || '').slice(0, 200));
    throw new TrainerAiError(...(FAIL[attempt.errorClass] || [502, 'unavailable', 'the AI service failed']));
  }
  const b = attempt.result?.bundle;
  if (!b || !Array.isArray(b.routines) || !b.routines.length) throw new TrainerAiError(...FAIL.unusable);
  return { name: b.name || null, summary: b.summary || null, week: b.week || {}, routines: b.routines, customEx: b.customEx || [] };
}
