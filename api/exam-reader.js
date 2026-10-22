// Reads a medical exam's report — the lab's PDF, or photos of the paper — with Claude, for
// POST /api/exams/read (Health → Exams in the app). One Messages API call over plain fetch, the
// way coach/core/adapters/anthropic.js talks to the same API: the api keeps its dependencies few.
//
// The answer is JSON held to READING_SCHEMA by the API itself (structured outputs), so what comes
// back always has the shape the app's form expects; the app still checks every value
// (frontend/src/lib/exams.js normalizeResult) and the person confirms them before anything is
// saved. Nothing is stored here: the files pass through to the API and the reading goes back to
// the caller.

export const ANTHROPIC_VERSION = '2023-06-01';
// A refusal is retried by the API on another model in the same call (server-side fallback).
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

export class ExamReadError extends Error {
  constructor(status, code, message) { super(message || code); this.status = status; this.code = code; }
}

/** The reader's settings from the environment. `key` empty = the feature is off. */
export function examReaderConfig(env = process.env) {
  return {
    key: String(env.ANTHROPIC_API_KEY || '').trim(),
    // A key made for the whole organisation, not for one workspace, has to say which workspace
    // it spends from; a workspace's own key needs nothing here.
    workspace: String(env.ANTHROPIC_WORKSPACE_ID || '').trim(),
    base: String(env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/+$/, ''),
    model: String(env.EXAM_AI_MODEL || 'claude-opus-5-5').trim(),
    // Reading values off a report is transcription: low effort keeps it quick.
    effort: /^(low|medium|high|xhigh|max)$/.test(env.EXAM_AI_EFFORT || '') ? env.EXAM_AI_EFFORT : 'low',
    timeoutMs: Math.max(5000, +(env.EXAM_AI_TIMEOUT_MS || 110000) || 110000)
  };
}

const str = { type: 'string' };
const nullable = t => ({ anyOf: [{ type: t }, { type: 'null' }] });
export const READING_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['date', 'lab', 'doctor', 'title', 'results'],
  properties: {
    date: { ...nullable('string'), description: 'Date the sample was collected (or, if absent, the report date), as YYYY-MM-DD. null if the report shows none.' },
    lab: { ...nullable('string'), description: 'Laboratory or clinic that performed the exam, as printed (not the doctor).' },
    doctor: { ...nullable('string'), description: 'Name of the requesting physician ("Médico solicitante", "Solicitante", "Dr./Dra. …"), as printed; null if the report does not show one. Never put the doctor in lab or title.' },
    title: { ...nullable('string'), description: 'Short title for the whole report in its own language, describing the tests, never a person\'s name: e.g. "Hemograma completo", "Perfil lipídico", or "Exames de rotina" for a mix.' },
    results: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['key', 'name', 'value', 'valueText', 'unit', 'refLow', 'refHigh', 'refText', 'flag', 'section'],
        properties: {
          key: { ...str, description: 'Stable snake_case English identifier of the analyte, the same for the same test whatever the lab calls it: glucose, hba1c, total_cholesterol, ldl_cholesterol, hdl_cholesterol, non_hdl_cholesterol, triglycerides, tsh, free_t4, creatinine, urea, egfr, alt, ast, ggt, alkaline_phosphatase, uric_acid, ferritin, iron, vitamin_d_25oh, vitamin_b12, hemoglobin, hematocrit, rbc, wbc, platelets, psa, testosterone_total, insulin, crp_hs, sodium, potassium, calcium, magnesium… Use the closest common name for anything else.' },
          name: { ...str, description: 'The test name exactly as printed, in the report\'s language.' },
          value: { ...nullable('number'), description: 'The result as a number (decimal point, no thousands separator) when it is one; null for words ("Negativo"), bounds ("< 5") or anything not a single number.' },
          valueText: { ...str, description: 'The result exactly as printed.' },
          unit: { ...str, description: 'Unit as printed, "" if none.' },
          refLow: { ...nullable('number'), description: 'Lower bound of the reference range that applies to this patient, if any.' },
          refHigh: { ...nullable('number'), description: 'Upper bound of the reference range that applies to this patient, if any.' },
          refText: { ...str, description: 'The reference range as printed for this patient, "" if none.' },
          flag: { anyOf: [{ type: 'string', enum: ['low', 'high', 'normal', 'abnormal'] }, { type: 'null' }], description: 'low/high against the range, normal inside it, abnormal for a non-numeric result the report marks as altered; null when nothing tells.' },
          section: { ...str, description: 'The report section the test belongs to (e.g. "Eritrograma", "Bioquímica"), "" if none.' }
        }
      }
    }
  }
};

const SYSTEM = 'You transcribe medical laboratory reports into structured data for the patient\'s own health record. ' +
  'Copy what the report says; never estimate, interpret or add a result that is not printed. ' +
  'Include every result row, including sub-items (each leukocyte type, each lipid fraction). ' +
  'When a report lists reference ranges by sex or age, use the one that matches the patient shown on it. ' +
  'If the files are not a laboratory or exam report, return an empty results list.';

/**
 * The reading of `files` ([{ mime, bytes: Buffer }], one PDF or up to six images) — { date, lab,
 * title, results } as READING_SCHEMA describes. Throws ExamReadError: 502 when the API fails or
 * answers something unreadable, 504 when it does not answer in time, 422 when it declines.
 */
export async function readExam(files, cfg, fetchImpl = globalThis.fetch) {
  const content = files.map(f => (f.mime === 'application/pdf'
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: f.bytes.toString('base64') } }
    : { type: 'image', source: { type: 'base64', media_type: f.mime, data: f.bytes.toString('base64') } }));
  content.push({ type: 'text', text: files.length > 1 ? 'These images are the pages of one report, in order. Transcribe it.' : 'Transcribe this report.' });
  const body = {
    model: cfg.model,
    max_tokens: 16000,
    system: SYSTEM,
    output_config: { effort: cfg.effort, format: { type: 'json_schema', schema: READING_SCHEMA } },
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
    if (e?.name === 'TimeoutError' || e?.name === 'AbortError') throw new ExamReadError(504, 'timeout', 'reading the report took too long');
    throw new ExamReadError(502, 'unavailable', 'the reading service could not be reached');
  }
  let data = null;
  try { data = await r.json(); } catch { /* not JSON */ }
  if (!r.ok) {
    // Only the API's own message: never the request, which carries the report.
    console.error('exam read failed', r.status, data?.error?.type || '', String(data?.error?.message || '').slice(0, 200));
    // The key itself refused (wrong, revoked, or one that needs a workspace): the instance's
    // setting to fix, not something trying again would change.
    const code = r.status === 429 ? 'busy' : r.status === 401 || r.status === 403 || (r.status === 400 && data?.error?.type === 'invalid_request_error' && /api key|workspace/i.test(data?.error?.message || '')) ? 'config' : 'unavailable';
    throw new ExamReadError(502, code, code === 'config' ? 'the server\'s AI key was not accepted' : 'the reading service failed');
  }
  if (data?.stop_reason === 'refusal') throw new ExamReadError(422, 'refused', 'the report could not be read');
  if (data?.stop_reason === 'max_tokens') throw new ExamReadError(502, 'truncated', 'the report is too long to read at once');
  const text = (data?.content || []).filter(b => b?.type === 'text').map(b => b.text).join('');
  let reading;
  try { reading = JSON.parse(text); } catch { throw new ExamReadError(502, 'unreadable', 'the reading could not be understood'); }
  if (!reading || typeof reading !== 'object' || !Array.isArray(reading.results)) throw new ExamReadError(502, 'unreadable', 'the reading could not be understood');
  return {
    date: typeof reading.date === 'string' ? reading.date : null,
    lab: typeof reading.lab === 'string' ? reading.lab : null,
    doctor: typeof reading.doctor === 'string' ? reading.doctor : null,
    title: typeof reading.title === 'string' ? reading.title : null,
    results: reading.results.filter(x => x && typeof x === 'object').slice(0, 300)
  };
}
