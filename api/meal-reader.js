// Estimates what is on a plate — calories and macros of each food — from photos, with Claude, for
// POST /api/meals/read (Health → Food in the app), through the call shared with the exam reader
// (anthropic-call.js). An estimate, and the app says so: amounts from a photo are a guess, and
// oil, sugar or sauce mostly do not show. The person adjusts the grams afterwards.
import { AiCallError, anthropicConfig, fileBlocks, structuredCall } from './anthropic-call.js';

/** The reader's settings from the environment (MEAL_AI_MODEL, MEAL_AI_EFFORT…). `key` empty = off. */
export const mealReaderConfig = (env = process.env) => anthropicConfig(env, 'MEAL_AI', { effort: 'low' });

const num = { type: 'number' };
export const PLATE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'items'],
  properties: {
    title: { type: 'string', description: 'A short name for the meal in Brazilian Portuguese, e.g. "Arroz, feijão e frango grelhado". "" if no food is visible.' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'grams', 'kcal', 'protein', 'carbs', 'fat'],
        properties: {
          name: { type: 'string', description: 'The food in Brazilian Portuguese, as in the TACO table when it has one (e.g. "Arroz, tipo 1, cozido", "Feijão, carioca, cozido").' },
          grams: { ...num, description: 'Estimated edible amount on the plate, in grams.' },
          kcal: { ...num, description: 'Energy of that amount, kcal.' },
          protein: { ...num, description: 'Protein of that amount, grams.' },
          carbs: { ...num, description: 'Carbohydrate of that amount, grams.' },
          fat: { ...num, description: 'Fat of that amount, grams, including the cooking fat a typical Brazilian home preparation uses.' }
        }
      }
    }
  }
};

const SYSTEM = 'You estimate the food on a plate from photos for the person\'s own food diary in Brazil. ' +
  'List each visible food once, with its estimated edible amount in grams for typical Brazilian portions, and the energy and macros of that amount, ' +
  'using values from the Brazilian TACO table (Tabela Brasileira de Composição de Alimentos) when the food is in it. ' +
  'Estimate amounts from the plate, cutlery and packaging in view. Do not list drinks or foods you cannot see. ' +
  'If the photos show no food, return an empty items list.';

/** The estimate for `files` ([{ mime, bytes }], up to three photos of one meal): { title, items }. */
export async function readMeal(files, cfg, fetchImpl = globalThis.fetch) {
  const content = fileBlocks(files);
  content.push({ type: 'text', text: files.length > 1 ? 'These photos show one meal. Estimate it.' : 'Estimate this meal.' });
  const out = await structuredCall(cfg, { system: SYSTEM, content, schema: PLATE_SCHEMA, maxTokens: 8000, what: 'meal read' }, fetchImpl);
  if (!Array.isArray(out.items)) throw new AiCallError(502, 'unreadable', 'the reading could not be understood');
  return {
    title: typeof out.title === 'string' ? out.title : '',
    items: out.items.filter(x => x && typeof x === 'object' && typeof x.name === 'string').slice(0, 30)
  };
}
