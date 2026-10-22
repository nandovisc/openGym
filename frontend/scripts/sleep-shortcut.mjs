// Builds and signs public/shortcuts/opengym-sleep.shortcut, the iPhone Shortcut that sends last
// night from the Health app to POST /api/sleep/ingest (views/Sleep.jsx offers it for download).
//
//   node scripts/sleep-shortcut.mjs        (on a Mac: signing needs Apple's `shortcuts sign`)
//
// An iPhone imports only signed shortcuts, and only a Mac's Shortcuts can sign one, so the file is
// signed once here and committed; nothing in it is per person. The person pastes one line the app
// copies for them — "<ingest address> <token>" — into its first Text action; the shortcut splits
// it, so the same file works for any server.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = fileURLToPath(new URL('../public/shortcuts/opengym-sleep.shortcut', import.meta.url))
const OBJ = '￼'
let n = 0
const id = () => `0000A000-0000-4000-8000-${String(++n).padStart(12, '0')}`

const plain = s => ({ Value: { string: s }, WFSerializationType: 'WFTextTokenString' })
const tokens = (string, attachmentsByRange) => ({ Value: { string, attachmentsByRange }, WFSerializationType: 'WFTextTokenString' })
const out = (uuid, name) => ({ Type: 'ActionOutput', OutputUUID: uuid, OutputName: name })
const attach = v => ({ Value: v, WFSerializationType: 'WFTextTokenAttachment' })
const item = (prop, date) => ({ Type: 'Variable', VariableName: 'Repeat Item', Aggrandizements: [
  { Type: 'WFPropertyVariableAggrandizement', PropertyName: prop },
  ...(date ? [{ Type: 'WFDateFormatVariableAggrandizement', WFDateFormatStyle: 'ISO 8601', WFISO8601IncludeTime: true }] : [])
] })
const act = (WFWorkflowActionIdentifier, WFWorkflowActionParameters) => ({ WFWorkflowActionIdentifier, WFWorkflowActionParameters })
const dict = items => ({ Value: { WFDictionaryFieldValueItems: items.map(([k, v]) => ({ WFItemType: 0, WFKey: plain(k), WFValue: v })) }, WFSerializationType: 'WFDictionaryFieldValue' })

const [setup, split, url, token, find, line, loop, end, combined] = Array.from({ length: 9 }, id)
const actions = [
  act('is.workflow.actions.comment', { WFCommentActionText: 'openGym: envia as noites de sono do app Saúde (Apple Watch, Oura, RingConn…) para o seu servidor. Cole no texto abaixo a linha que o openGym copia ao criar o token (Saúde → Sono → 🔗).' }),
  act('is.workflow.actions.gettext', { UUID: setup, WFTextActionText: plain('COLE_AQUI_A_LINHA_DO_OPENGYM') }),
  act('is.workflow.actions.text.split', { UUID: split, text: attach(out(setup, 'Text')), WFTextSeparator: 'Spaces' }),
  act('is.workflow.actions.getitemfromlist', { UUID: url, WFInput: attach(out(split, 'Split Text')), WFItemSpecifier: 'First Item' }),
  act('is.workflow.actions.getitemfromlist', { UUID: token, WFInput: attach(out(split, 'Split Text')), WFItemSpecifier: 'Last Item' }),
  act('is.workflow.actions.filter.health.quantity', {
    UUID: find,
    WFContentItemFilter: { Value: { WFActionParameterFilterPrefix: 1, WFContentPredicateBoundedDate: false, WFActionParameterFilterTemplates: [
      // "Sleep" is the name the type has in the action, on a phone set to Portuguese as well.
      { Operator: 4, Property: 'Type', Removable: false, Values: { Enumeration: 'Sleep' } },
      { Operator: 1001, Property: 'Start Date', Removable: true, Values: { Number: 2, Unit: 16 } }
    ] }, WFSerializationType: 'WFContentPredicateTableTemplate' },
    WFContentItemSortProperty: 'Start Date', WFContentItemSortOrder: 'Oldest First'
  }),
  act('is.workflow.actions.repeat.each', { GroupingIdentifier: loop, WFControlFlowMode: 0, WFInput: attach(out(find, 'Health Samples')) }),
  act('is.workflow.actions.gettext', { UUID: line, WFTextActionText: tokens(`${OBJ};${OBJ};${OBJ};${OBJ}`, {
    '{0, 1}': item('Start Date', true), '{2, 1}': item('End Date', true), '{4, 1}': item('Value'), '{6, 1}': item('Source')
  }) }),
  act('is.workflow.actions.repeat.each', { GroupingIdentifier: loop, WFControlFlowMode: 2, UUID: end }),
  act('is.workflow.actions.text.combine', { UUID: combined, WFTextSeparator: 'New Lines', text: attach(out(end, 'Repeat Results')) }),
  act('is.workflow.actions.downloadurl', {
    WFURL: tokens(OBJ, { '{0, 1}': out(url, 'Item from List') }), WFHTTPMethod: 'POST', WFHTTPBodyType: 'JSON', ShowHeaders: true,
    WFHTTPHeaders: dict([['Authorization', tokens(`Bearer ${OBJ}`, { '{7, 1}': out(token, 'Item from List') })]]),
    WFJSONValues: dict([['samples', tokens(OBJ, { '{0, 1}': out(combined, 'Combined Text') })]])
  })
]
const workflow = {
  WFWorkflowActions: actions,
  WFWorkflowClientVersion: '2607.0.1',
  WFWorkflowMinimumClientVersion: 900,
  WFWorkflowMinimumClientVersionString: '900',
  WFWorkflowIcon: { WFWorkflowIconStartColor: 1440408063, WFWorkflowIconGlyphNumber: 59446 },
  WFWorkflowImportQuestions: [{ ActionIndex: 1, Category: 'Parameter', DefaultValue: '', ParameterKey: 'WFTextActionText', Text: 'Cole a linha que o openGym copiou ao criar o token.' }],
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
