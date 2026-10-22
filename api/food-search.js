// Products of Open Food Facts matching a name, for GET /api/foods/search (Health → Food search).
// Asked by the server rather than the app: the search endpoints a browser could call answer
// "temporarily unavailable" more often than not, and the one that works (Search-a-licious) does not
// allow calls from other sites. Plain fetch, products sold in Brazil, the answer of a query kept for
// a while — the service asks for few searches. Only what the app reads of a product is passed on.

export const OFF_SEARCH_URL = 'https://search.openfoodfacts.org/search';
const FIELDS = 'code,product_name,product_name_pt,generic_name,brands,nutriments,serving_quantity,serving_quantity_unit,serving_size';
const KEEP_MS = 30 * 60 * 1000;
const KEEP_MAX = 300;
const cache = new Map();

/** The query as Search-a-licious takes it: letters, digits and spaces of the words typed. */
export const cleanQuery = q => String(q ?? '').normalize('NFC').replace(/[^\p{L}\p{N}\s-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);

const brandOf = b => (Array.isArray(b) ? b[0] : String(b ?? '').split(',')[0]) || '';
const NUTRIENTS = ['energy-kcal_100g', 'energy-kj_100g', 'energy_100g', 'proteins_100g', 'carbohydrates_100g', 'fat_100g', 'fiber_100g'];
const slim = p => ({
  code: String(p.code), product_name: p.product_name || '', product_name_pt: p.product_name_pt || '', generic_name: p.generic_name || '',
  brands: brandOf(p.brands),
  nutriments: Object.fromEntries(NUTRIENTS.filter(k => p.nutriments?.[k] != null).map(k => [k, p.nutriments[k]])),
  ...(p.serving_quantity != null ? { serving_quantity: p.serving_quantity, serving_quantity_unit: p.serving_quantity_unit || 'g', serving_size: p.serving_size || '' } : {})
});

/** { products } for `query`, at most `size`; throws on a failed call (the route answers 502). */
export async function searchProducts(query, { base = OFF_SEARCH_URL, size = 20, fetchImpl = globalThis.fetch, now = Date.now() } = {}) {
  const q = cleanQuery(query).toLowerCase();
  if (q.length < 3) return { products: [] };
  const hit = cache.get(q);
  if (hit && now - hit.at < KEEP_MS) return { products: hit.products };
  const url = `${base}?q=${encodeURIComponent(`${q} countries_tags:"en:brazil"`)}&page_size=${size}&fields=${FIELDS}`;
  const r = await fetchImpl(url, { headers: { 'User-Agent': 'openGym (self-hosted fitness and health tracker)' }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error('open food facts ' + r.status);
  const data = await r.json();
  const products = (Array.isArray(data?.hits) ? data.hits : []).filter(p => p?.code).map(slim);
  cache.set(q, { at: now, products });
  if (cache.size > KEEP_MAX) cache.delete(cache.keys().next().value);
  return { products };
}
