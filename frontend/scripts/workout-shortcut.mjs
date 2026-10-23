// Builds and signs public/shortcuts/opengym-workout.shortcut, the iPhone Shortcut that sends the
// workout that just ended on an Apple Watch to POST /api/workouts/ingest (views/Sleep.jsx offers
// it for download next to the sleep one).
//
//   node scripts/workout-shortcut.mjs      (on a Mac: signing needs Apple's `shortcuts sign`)
//
// The Health action of Shortcuts has no Workouts type, so this sends what it can read over the
// last hours — Exercise Minutes, Active Energy, Heart Rate — and the server finds the workout in
// them (api/workouts-ingest.js). Each list goes as three lines-of-text fields (start, end, value),
// a property of the whole list at once: no Repeat over a thousand heart-rate samples.
// It takes the same pasted line as the sleep Shortcut ("<sleep ingest address> <token>") and
// points it at /api/workouts/ingest. The person runs it from the automation "Apple Watch Workout
// → Ends"; a shortcut file cannot carry an automation, docs/SLEEP_SHORTCUT.md shows the taps.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = fileURLToPath(new URL('../public/shortcuts/opengym-workout.shortcut', import.meta.url))
const OBJ = '￼'
let n = 0
const id = () => `0000B000-0000-4000-8000-${String(++n).padStart(12, '0')}`

const plain = s => ({ Value: { string: s }, WFSerializationType: 'WFTextTokenString' })
const tokens = (string, attachmentsByRange) => ({ Value: { string, attachmentsByRange }, WFSerializationType: 'WFTextTokenString' })
const out = (uuid, name, aggr) => ({ Type: 'ActionOutput', OutputUUID: uuid, OutputName: name, ...(aggr ? { Aggrandizements: aggr } : {}) })
const attach = v => ({ Value: v, WFSerializationType: 'WFTextTokenAttachment' })
const prop = (p, date) => [
  { Type: 'WFPropertyVariableAggrandizement', PropertyName: p },
  ...(date ? [{ Type: 'WFDateFormatVariableAggrandizement', WFDateFormatStyle: 'ISO 8601', WFISO8601IncludeTime: true }] : [])
]
const act = (WFWorkflowActionIdentifier, WFWorkflowActionParameters) => ({ WFWorkflowActionIdentifier, WFWorkflowActionParameters })
const dict = items => ({ Value: { WFDictionaryFieldValueItems: items.map(([k, v]) => ({ WFItemType: 0, WFKey: plain(k), WFValue: v })) }, WFSerializationType: 'WFDictionaryFieldValue' })

// The names the types have in the Health action ("Sleep" kept its English name on a phone set to
// Portuguese, so these are the English ones too).
const KINDS = [['exercise', 'Exercise Minutes'], ['energy', 'Active Energy'], ['hr', 'Heart Rate']]
const [setup, name, split, first, token, url] = Array.from({ length: 6 }, id)
const finds = KINDS.map(() => id())

const actions = [
  act('is.workflow.actions.comment', { WFCommentActionText: 'openGym: ao terminar um treino no Apple Watch, envia as calorias ativas, a frequência cardíaca e os minutos de exercício das últimas horas para o seu servidor. Cole no primeiro texto a mesma linha do Atalho do sono (Saúde → Sono → 🔗). No segundo texto, opcional, o nome do treino.' }),
  act('is.workflow.actions.gettext', { UUID: setup, WFTextActionText: plain('COLE_AQUI_A_LINHA_DO_OPENGYM') }),
  act('is.workflow.actions.gettext', { UUID: name, WFTextActionText: plain('') }),
  act('is.workflow.actions.text.split', { UUID: split, text: attach(out(setup, 'Text')), WFTextSeparator: 'Spaces' }),
  act('is.workflow.actions.getitemfromlist', { UUID: first, WFInput: attach(out(split, 'Split Text')), WFItemSpecifier: 'First Item' }),
  act('is.workflow.actions.getitemfromlist', { UUID: token, WFInput: attach(out(split, 'Split Text')), WFItemSpecifier: 'Last Item' }),
  act('is.workflow.actions.text.replace', { UUID: url, WFInput: tokens(OBJ, { '{0, 1}': out(first, 'Item from List') }), WFReplaceTextFind: '/api/sleep/ingest', WFReplaceTextReplace: '/api/workouts/ingest' }),
  ...KINDS.map(([, type], i) => act('is.workflow.actions.filter.health.quantity', {
    UUID: finds[i],
    WFContentItemFilter: { Value: { WFActionParameterFilterPrefix: 1, WFContentPredicateBoundedDate: false, WFActionParameterFilterTemplates: [
      { Operator: 4, Property: 'Type', Removable: false, Values: { Enumeration: type } },
      // In the last 4 hours (unit 32: hours).
      { Operator: 1001, Property: 'Start Date', Removable: true, Values: { Number: 4, Unit: 32 } }
    ] }, WFSerializationType: 'WFContentPredicateTableTemplate' },
    WFContentItemSortProperty: 'Start Date', WFContentItemSortOrder: 'Oldest First'
  })),
  act('is.workflow.actions.downloadurl', {
    WFURL: tokens(OBJ, { '{0, 1}': out(url, 'Updated Text') }), WFHTTPMethod: 'POST', WFHTTPBodyType: 'JSON', ShowHeaders: true,
    WFHTTPHeaders: dict([['Authorization', tokens(`Bearer ${OBJ}`, { '{7, 1}': out(token, 'Item from List') })]]),
    WFJSONValues: dict([
      ['name', tokens(OBJ, { '{0, 1}': out(name, 'Text') })],
      ...KINDS.flatMap(([k], i) => [
        [`${k}_start`, tokens(OBJ, { '{0, 1}': out(finds[i], 'Health Samples', prop('Start Date', true)) })],
        [`${k}_end`, tokens(OBJ, { '{0, 1}': out(finds[i], 'Health Samples', prop('End Date', true)) })],
        [`${k}_value`, tokens(OBJ, { '{0, 1}': out(finds[i], 'Health Samples', prop('Value')) })],
        [`${k}_unit`, tokens(OBJ, { '{0, 1}': out(finds[i], 'Health Samples', prop('Unit')) })]
      ])
    ])
  })
]
const workflow = {
  WFWorkflowActions: actions,
  WFWorkflowClientVersion: '2607.0.1',
  WFWorkflowMinimumClientVersion: 900,
  WFWorkflowMinimumClientVersionString: '900',
  WFWorkflowIcon: { WFWorkflowIconStartColor: 4282601983, WFWorkflowIconGlyphNumber: 59765 },
  WFWorkflowImportQuestions: [{ ActionIndex: 1, Category: 'Parameter', DefaultValue: '', ParameterKey: 'WFTextActionText', Text: 'Cole a mesma linha do Atalho do sono.' }],
  WFWorkflowInputContentItemClasses: [],
  WFWorkflowOutputContentItemClasses: [],
  WFWorkflowTypes: [],
  WFWorkflowHasOutputFallback: false,
  WFWorkflowHasShortcutInputVariables: false
}

// A property list as XML: all `shortcuts sign` needs.
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const plist = v => {
  if (v === true || v === false) return `<${v}/>`
  if (typeof v === 'number') return Number.isInteger(v) ? `<integer>${v}</integer>` : `<real>${v}</real>`
  if (typeof v === 'string') return `<string>${esc(v)}</string>`
  if (Array.isArray(v)) return `<array>${v.map(plist).join('')}</array>`
  return `<dict>${Object.entries(v).map(([k, x]) => `<key>${esc(k)}</key>${plist(x)}`).join('')}</dict>`
}
const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">${plist(workflow)}</plist>\n`

const dir = mkdtempSync(join(tmpdir(), 'og-shortcut-'))
try {
  const unsigned = join(dir, 'unsigned.shortcut')
  writeFileSync(unsigned, xml)
  execFileSync('shortcuts', ['sign', '--mode', 'anyone', '--input', unsigned, '--output', OUT], { stdio: 'inherit' })
  console.log('signed →', OUT)
} finally {
  rmSync(dir, { recursive: true, force: true })
}
