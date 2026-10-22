// Builds src/lib/usda-data.js: the generic foods of USDA FoodData Central's SR Legacy (CC0) that the
// TACO table does not have, named in Portuguese, per 100 g. Loaded by the Food screen beside TACO.
//
//   1. node scripts/usda-build.mjs extract <SR Legacy CSV folder> scripts/usda-candidates.json
//        the foods worth having here, in English, with their values per 100 g
//   2. translate: scripts/usda-pt.json maps each fdc id to its Portuguese name ("" = leave it out)
//   3. node scripts/usda-build.mjs emit scripts/usda-candidates.json scripts/usda-pt.json
//        drops the ones TACO already has and writes src/lib/usda-data.js
//
// The CSV: https://fdc.nal.usda.gov/download-datasets (SR Legacy, CSV). Only values per 100 g are
// kept — the household measures (cup, oz, tbsp) are American and stay out.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const [, , cmd, a, b] = process.argv
const root = new URL('..', import.meta.url)

// RFC 4180 enough for USDA's files: every field quoted, "" inside a field for a quote.
function* rows(text) {
  let i = 0
  while (i < text.length) {
    const row = []
    for (;;) {
      if (text[i] === '"') {
        let v = '', j = i + 1
        for (;;) {
          const q = text.indexOf('"', j)
          if (text[q + 1] === '"') { v += text.slice(j, q) + '"'; j = q + 2 } else { v += text.slice(j, q); i = q + 1; break }
        }
        row.push(v)
      } else {
        const m = /[,\r\n]/.exec(text.slice(i)); const end = m ? i + m.index : text.length
        row.push(text.slice(i, end)); i = end
      }
      if (text[i] === ',') { i++; continue }
      if (text[i] === '\r') i++
      if (text[i] === '\n') i++
      break
    }
    yield row
  }
}
const table = file => { const it = rows(readFileSync(file, 'utf8')); const head = it.next().value; return [...it].filter(r => r.length === head.length).map(r => Object.fromEntries(head.map((h, k) => [h, r[k]]))) }

// Categories with nothing for this app: baby food, fast food and restaurant dishes, branded
// products, American Indian/Alaska Native foods, lab reference materials.
const SKIP_CATEGORIES = new Set(['3', '21', '24', '25', '26', '27'])
// Names that are a brand, an American institution's recipe, or a cut described to the fat trim.
const SKIP_NAME = [
  /[A-Z]{3,}/, /®|™/, /\b(Pillsbury|Kraft|Kellogg|General Mills|Nabisco|Quaker|Heinz|Campbell|Hormel|Oscar Mayer|Tyson|Kashi|Post|Nestle|Hershey|Mars|Archway|Keebler|Pepperidge|Ovaltine|Sunsweet|Ocean Spray|Gerber|Beechnut|Lipton|Arby|Burger King|McDonald|Wendy|Subway|Taco Bell|Pizza Hut|Domino|KFC|Popeyes|Denny|Applebee|Olive Garden|Carrabba|Cracker Barrel|On The Border|Chick-fil-a|Dairy Queen|Starbucks|Snapple|Gatorade|Powerade|Lean Cuisine|Healthy Choice|Stouffer|Banquet|Marie Callender|Hot Pockets|Smart Ones|Weight Watchers|Boca|Morningstar|Worthington|Loma Linda)\b/i,
  /\b(USDA Commodity|school lunch|NFS|Native|Alaska|Hawaii|Navajo|Apache|Hopi|Shoshone|Ojibwa|Yupik|Inupiat|Tribal)\b/i,
  /\b(Game meat|bison|caribou|elk|moose|deer|venison|antelope|bear|beaver|muskrat|opossum|raccoon|squirrel|seal|whale|walrus|oriental|frog legs|turtle|emu|ostrich|goose|squab|pheasant|quail|dove|buffalo)\b/i,
  /\b(trimmed to|separable lean and fat|select\b|choice\b|prime\b|grade|retail cuts|composite of|imported|New Zealand|Australian|Canadian|frozen, unprepared|canned, solids and liquids|pre-cooked|with salt|without salt|unenriched|low sodium|reduced sodium|no salt added|fortified with|enriched with)/i,
  /\b(formula|infant|toddler|medical|supplement|meal replacement|protein powder)\b/i
]
// Within a crowded category, the cooked and the raw are kept, the many ways of trimming are not.
const KEEP_PREP = /\b(raw|cooked|boiled|baked|roasted|grilled|broiled|fried|steamed|dried|fresh|plain|whole|nonfat|lowfat|ground|canned)\b/i

function extract(dir, out) {
  const nut = { 1008: 'kcal', 2047: 'kcal2', 1003: 'p', 1005: 'c', 1004: 'f', 1079: 'fib' }
  const foods = table(join(dir, 'food.csv'))
  const values = new Map()
  for (const r of table(join(dir, 'food_nutrient.csv'))) {
    const k = nut[r.nutrient_id]; if (!k) continue
    if (!values.has(r.fdc_id)) values.set(r.fdc_id, {})
    values.get(r.fdc_id)[k] = Number(r.amount)
  }
  const kept = []
  const perBeefPork = { 10: 0, 13: 0, 17: 0, 5: 0, 7: 0 }
  for (const f of foods) {
    if (SKIP_CATEGORIES.has(f.food_category_id)) continue
    const name = f.description
    if (SKIP_NAME.some(re => re.test(name))) continue
    const v = values.get(f.fdc_id) || {}
    const kcal = Number.isFinite(v.kcal) ? v.kcal : v.kcal2
    if (!Number.isFinite(kcal)) continue
    // Meat: hundreds of cuts each, described down to the fat trim. A capped share, cooked/raw first.
    if (f.food_category_id in perBeefPork) {
      if (!KEEP_PREP.test(name) || /\b(separable lean only)\b.*\b(separable lean only)\b/i.test(name)) continue
      if (perBeefPork[f.food_category_id]++ >= 120) continue
    }
    const r1 = n => Math.round((Number.isFinite(n) ? n : 0) * 10) / 10
    kept.push({ id: Number(f.fdc_id), en: name, cat: Number(f.food_category_id), kcal: Math.round(kcal), p: r1(v.p), c: r1(v.c), f: r1(v.f), fib: r1(v.fib) })
  }
  writeFileSync(out, JSON.stringify(kept, null, 0).replace(/\},\{/g, '},\n{'))
  console.log(kept.length, 'candidates →', out)
}

// Words a name has to share with a TACO food, accents and plurals aside, to be the same food.
const fold = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const STOP = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'com', 'sem', 'em', 'a', 'o', 'ao', 'tipo', 'inteiro', 'inteira'])
const PREP = ['cru', 'crua', 'cozido', 'cozida', 'assado', 'assada', 'grelhado', 'grelhada', 'frito', 'frita', 'refogado', 'refogada', 'enlatado', 'enlatada', 'seco', 'seca', 'desidratado', 'desidratada', 'congelado', 'congelada']
const stem = w => w.replace(/oes$|aes$/, 'ao').replace(/ais$/, 'al').replace(/eis$/, 'el').replace(/(?<=[^s])s$/, '')
const words = name => fold(name).split(/[^a-z0-9]+/).filter(w => w && !STOP.has(w)).map(stem)
const prepOf = ws => new Set(ws.filter(w => PREP.map(stem).includes(w)).map(w => w.replace(/a$/, 'o')))

function emit(candFile, ptFile) {
  const cands = JSON.parse(readFileSync(candFile, 'utf8'))
  const pt = JSON.parse(readFileSync(ptFile, 'utf8'))
  const tacoSrc = readFileSync(fileURLToPath(new URL('src/lib/taco-data.js', root)), 'utf8')
  const tacoNames = [...tacoSrc.matchAll(/\[\d+,("(?:[^"\\]|\\.)*")/g)].map(m => JSON.parse(m[1]))
  const taco = tacoNames.map(n => { const ws = words(n); return { ws: new Set(ws.filter(w => !PREP.map(stem).includes(w))), prep: prepOf(ws) } })
  // The same food: its words (preparation aside) all in a TACO name of no more words, and the same
  // preparation when both say one.
  if (tacoNames.length < 500) throw new Error('TACO not read: ' + tacoNames.length)
  const inTaco = name => {
    const ws = words(name)
    const core = ws.filter(w => !PREP.map(stem).includes(w)), prep = prepOf(ws)
    return taco.some(t => core.length && core.every(w => t.ws.has(w)) && t.ws.size <= core.length + 1 &&
      (!prep.size || !t.prep.size || [...prep].some(x => t.prep.has(x))))
  }
  // Also the same food: the same main food and preparation as a TACO entry, told apart only by
  // words that do not make it another food (white, long grain, without skin…).
  const GENERIC = new Set(['branco', 'branca', 'grao', 'longo', 'curto', 'medio', '1', '2', 'comum', 'regular', 'simple', 'natural',
    'integral', 'parboilizado', 'pele', 'osso', 'gordura', 'fresco', 'fresca', 'maduro', 'madura', 'polido', 'toda', 'variedade',
    'misturado', 'mista', 'misto', 'especie', 'carne', 'magro', 'magra', 'escorrido', 'escorrida', 'agua', 'sal', 'oleo'].map(stem))
  const tacoHeads = tacoNames.map(n => { const ws = words(n); return { head: ws[0], prep: prepOf(ws) } })
  const sameAsTaco = name => {
    const ws = words(name), prep = prepOf(ws)
    if (!prep.size) return false
    const rest = ws.slice(1).filter(w => !PREP.map(stem).includes(w))
    return rest.every(w => GENERIC.has(w)) && tacoHeads.some(t => t.head === ws[0] && [...prep].some(x => t.prep.has(x)))
  }
  const seen = new Set(), out = []
  let dropTaco = 0, dropDup = 0, dropEmpty = 0
  for (const c of cands) {
    const name = String(pt[c.id] ?? '').trim()
    if (!name) { dropEmpty++; continue }
    if (inTaco(name) || sameAsTaco(name)) { dropTaco++; continue }
    const key = words(name).sort().join(' ')
    if (seen.has(key)) { dropDup++; continue }
    seen.add(key)
    out.push([c.id, name, c.kcal, c.p, c.c, c.f, c.fib])
  }
  out.sort((x, y) => x[1].localeCompare(y[1], 'pt'))
  const q = s => "'" + s.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'"
  const body = out.map(r => `[${r[0]},${q(r[1])},${r.slice(2).join(',')}]`).join(',\n')
  writeFileSync(fileURLToPath(new URL('src/lib/usda-data.js', root)),
    `// Generated by scripts/usda-build.mjs — do not edit by hand.\n` +
    `// USDA FoodData Central, SR Legacy (April 2018), CC0 1.0 (public domain); names translated to\n` +
    `// Portuguese, foods the TACO table already has left out. [fdcId, name, kcal, protein, carbs, fat, fibre] per 100 g.\n` +
    `export const USDA = [\n${body}\n]\n`)
  console.log(out.length, 'foods written;', dropTaco, 'already in TACO,', dropDup, 'duplicates,', dropEmpty, 'left out')
}

if (cmd === 'extract') extract(a, b)
else if (cmd === 'emit') emit(a, b)
else { console.error('usage: usda-build.mjs extract <csv dir> <out.json> | emit <candidates.json> <pt.json>'); process.exit(1) }
