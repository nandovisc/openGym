// Reads a medical exam's report — the lab's PDF, or photos of the paper — with Claude, for
// POST /api/exams/read (Health → Exams in the app), through the call shared with the meal reader
// (anthropic-call.js).
//
// The answer is JSON held to READING_SCHEMA by the API itself (structured outputs), so what comes
// back always has the shape the app's form expects; the app still checks every value
// (frontend/src/lib/exams.js normalizeResult). Nothing is stored here: the files pass through to
// the API and the reading goes back to the caller.
import { AiCallError, anthropicConfig, fileBlocks, structuredCall } from './anthropic-call.js';

export { ANTHROPIC_VERSION } from './anthropic-call.js';
export { AiCallError as ExamReadError };

/** The reader's settings from the environment (EXAM_AI_MODEL, EXAM_AI_EFFORT…). `key` empty = off. */
// Reading values off a report is transcription: low effort keeps it quick.
export const examReaderConfig = (env = process.env) => anthropicConfig(env, 'EXAM_AI', { effort: 'low' });

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
  const content = fileBlocks(files);
  content.push({ type: 'text', text: files.length > 1 ? 'These images are the pages of one report, in order. Transcribe it.' : 'Transcribe this report.' });
  const reading = await structuredCall(cfg, { system: SYSTEM, content, schema: READING_SCHEMA, what: 'exam read' }, fetchImpl);
  if (!Array.isArray(reading.results)) throw new AiCallError(502, 'unreadable', 'the reading could not be understood');
  return {
    date: typeof reading.date === 'string' ? reading.date : null,
    lab: typeof reading.lab === 'string' ? reading.lab : null,
    doctor: typeof reading.doctor === 'string' ? reading.doctor : null,
    title: typeof reading.title === 'string' ? reading.title : null,
    results: reading.results.filter(x => x && typeof x === 'object').slice(0, 300)
  };
}
