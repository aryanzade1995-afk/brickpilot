import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { governmentSchemeRules as rules, governmentSchemeRulesSchema, assessGovernmentSupport, normalizeIndianState, supportInputsForSolar, INDIAN_STATES } from '../src/lib/solar/governmentSupport.ts'
import { governmentSupportInputsSchema } from '../src/lib/solar/governmentSupportInputs.ts'
import { defaultBrief, geometryBrief, parseStoredBrief } from '../src/lib/model/brief.ts'
import { solarConfigurationSchema, solarConfigurationSignature, solarSignature, recoverStoredSolar } from '../src/lib/model/solar.ts'
import { compile } from '../src/lib/model/canonical.ts'
import { generate } from '../src/lib/engine/generate.ts'
import { generateAlternativeDesign } from '../src/lib/engine/generateAlternativeDesign.ts'
import { finishSignature } from '../src/lib/cost/finishAssignments.ts'
import { estimateBoq } from '../src/lib/cost/boq.ts'
import { applySolarEditor, previewSolarEditor } from '../src/lib/solar/editor.ts'
import { governmentSupportMessages } from '../src/lib/i18n/governmentSupportMessages.ts'
import { translate } from '../src/lib/i18n/index.ts'

const today = '2026-10-19', empty = () => governmentSupportInputsSchema.parse({})
const basic = () => governmentSupportInputsSchema.parse({ country: 'IN', stateCode: 'MH', discom: 'MSEDCL', consumer: 'individual-residential', ownership: 'consumer-owned', gridConnection: 'yes', roofPermission: 'yes', previousCfa: 'no', installation: 'new' })
const assess = (inputs = empty(), date = today, pack = rules, projectState) => assessGovernmentSupport(inputs, date, pack, projectState)

test('versioned rules have reviewed official sources, correct capacity bands and separate unassessed state support', () => {
  assert.equal(rules.verifiedOn, today); assert.equal(rules.applyUrl, 'https://pmsuryaghar.gov.in/')
  assert.equal(rules.individual.capacityBasis, 'installed-module-DC-kWp'); assert.equal(rules.individual.fractionalCapacity, 'pro-rata')
  assert.deepEqual(rules.individual.general, { firstBandInrPerKwp: 30000, additionalBandInrPerKwp: 18000, maximumInr: 78000 })
  assert.equal(rules.individual.special.maximumInr, 85800)
  assert.equal(rules.individual.additionalAbove3Kwp, 0)
  assert.equal(rules.association.capacityLimitKwp, 500); assert.equal(rules.association.capacityPerDwellingKwp, 3)
  assert.equal(rules.stateSupport.status, 'not-assessed'); assert.equal(rules.stateSupport.amountInr, null)
  assert.ok(rules.conditions.some(r => r.id === 'dcr')); assert.ok(rules.conditions.some(r => r.id === 'previous-cfa'))
  for (const code of rules.specialCategoryStateCodes) assert.ok(INDIAN_STATES.some(([id]) => id === code))
  const wrong = structuredClone(rules); wrong.individual.general.maximumInr = 999999
  assert.equal(governmentSchemeRulesSchema.safeParse(wrong).success, false)
  const unsafe = structuredClone(rules); unsafe.sources[0].url = 'https://example.test/pretend-government'
  assert.equal(governmentSchemeRulesSchema.safeParse(unsafe).success, false)
  const noSource = structuredClone(rules); noSource.conditions[0].source = 'missing'
  assert.equal(governmentSchemeRulesSchema.safeParse(noSource).success, false)
})

test('old projects default to unknown, never Maharashtra from estimate rates or automatically approved equipment', () => {
  const solar = defaultBrief().solar, inputs = supportInputsForSolar(solar), result = assess(inputs)
  assert.equal(inputs.country, 'unknown'); assert.equal(inputs.stateCode, null)
  assert.equal(result.state, 'unknown'); assert.equal(result.eligibility, 'unverified'); assert.equal(result.rateCategory, null); assert.equal(result.showMsedcl, false)
  const potential = assess(basic())
  assert.equal(potential.state, 'potentially-eligible'); assert.equal(potential.eligibility, 'unverified')
  assert.equal(basic().equipment, 'unknown', 'A positive consumer self-check is not equipment approval')
  assert.ok(!('amountInr' in potential)); assert.ok(!('approved' in potential))
})

test('inapplicable states explain non-residential, off-grid, non-DCR, relocation, location and roof rights', () => {
  for (const [change, reason] of [[{ country: 'other' }, 'location'], [{ consumer: 'non-residential' }, 'non-residential'], [{ gridConnection: 'no' }, 'no-grid'], [{ roofPermission: 'no' }, 'no-permission'], [{ equipment: 'non-dcr' }, 'non-dcr'], [{ installation: 'relocated' }, 'relocated']]) {
    const result = assess({ ...basic(), ...change })
    assert.equal(result.state, 'inapplicable'); assert.equal(result.eligibility, 'unverified'); assert.ok(result.reasons.includes(reason)); assert.equal(result.showFinancialGuidance, false)
  }
})

test('unknown answers, earlier subsidy, expansion and association cases do not receive an automatic fresh award', () => {
  for (const patch of [{ previousCfa: 'unknown' }, { stateCode: 'ZZ' }, { consumer: 'unknown' }, { installation: 'unknown' }]) assert.equal(assess({ ...basic(), ...patch }).state, 'unknown')
  for (const patch of [{ previousCfa: 'yes' }, { installation: 'expansion' }]) {
    const result = assess({ ...basic(), ...patch }); assert.equal(result.state, 'unknown'); assert.deepEqual(result.reasons, ['prior-support']); assert.equal(result.showFinancialGuidance, false)
  }
  const association = assess({ ...basic(), consumer: 'housing-association' })
  assert.equal(association.state, 'unknown'); assert.deepEqual(association.reasons, ['association-review'])
  assert.deepEqual(assess({ ...basic(), ownership: 'third-party' }).reasons, ['model-scope'])
  const conflict = assess(basic(), today, rules, 'KA')
  assert.equal(conflict.state, 'unknown'); assert.deepEqual(conflict.reasons, ['state-conflict']); assert.equal(conflict.showFinancialGuidance, false); assert.equal(conflict.showMsedcl, false)
})

test('MSEDCL guidance depends on an explicit Maharashtra location and distributor, with a conditional unknown-supplier label', () => {
  assert.equal(assess(basic()).showMsedcl, true)
  const unknownSupplier = assess({ ...basic(), discom: 'unknown' }); assert.equal(unknownSupplier.showMsedcl, true); assert.equal(unknownSupplier.msedclConditional, true)
  for (const patch of [{ stateCode: 'KA' }, { stateCode: null }, { country: 'unknown' }, { country: 'other' }, { discom: 'other' }]) assert.equal(assess({ ...basic(), ...patch }).showMsedcl, false)
  assert.equal(assess({ ...basic(), stateCode: 'UT' }).rateCategory, 'special')
  assert.equal(assess({ ...basic(), stateCode: 'IN-SK' }).rateCategory, 'special')
  assert.equal(assess(basic()).rateCategory, 'general')
  assert.equal(normalizeIndianState('Maharashtra'), null, 'Unrecognized input is unknown rather than guessed')
})

test('old, future-dated, invalid and expired rule contexts suppress financial figures without pretending to reverify', () => {
  assert.notEqual(assess(basic(), '2027-01-17').state, 'outdated-information')
  for (const date of ['2027-01-18', '2026-10-18', '2026-11-31', 'not-a-date']) {
    const result = assess(basic(), date); assert.equal(result.state, 'outdated-information'); assert.equal(result.showFinancialGuidance, false); assert.equal(result.eligibility, 'unverified')
  }
  assert.equal(assess(basic(), '2026-10-21', { ...rules, schemePeriodEnd: '2026-10-20' }).state, 'outdated-information')
})

test('questionnaire schema cannot collect identity, bank details, credentials or arbitrary URLs', () => {
  for (const patch of [{ aadhaar: '123' }, { bankAccount: '123' }, { portalPassword: 'secret' }, { officialApproval: true }, { sourceUrl: 'https://example.test' }, { schemaVersion: 2 }]) assert.equal(governmentSupportInputsSchema.safeParse(patch).success, false)
})

test('government drafts, apply, cancel-equivalent source immutability and reload preserve canonical panels, price and building identity', () => {
  const brief = defaultBrief(); brief.site.plotWidth = 25; brief.site.plotDepth = 30
  const design = generate(compile(brief)), architecture = generateAlternativeDesign(design, 12), context = { ...architecture, facadeModel: architecture.facadeGrammar }
  const config = solarConfigurationSchema.parse({ intention: 'install-now', assessmentInputs: { objective: 'both' }, inputs: { panel: { id: 'concept', name: 'Illustrative module', source: 'illustrative', dimensionsMm: { width: 1134, height: 2278, thickness: 35 }, ratedPowerW: 550 }, request: { kind: 'panel-count', panelCount: 2 } } })
  const p = previewSolarEditor(design, config, architecture), saved = applySolarEditor(brief, p, p.roof)
  const before = JSON.stringify(saved), draft = structuredClone(saved.solar); draft.assessmentInputs.governmentSupport = basic()
  const preview = previewSolarEditor(design, draft, architecture)
  assert.equal(JSON.stringify(saved), before, 'Drafting/previewing is not saving')
  const applied = applySolarEditor(saved, preview, preview.roof)
  assert.deepEqual(applied.solar.calculated, saved.solar.calculated)
  assert.equal(solarConfigurationSignature(applied.solar), solarConfigurationSignature(saved.solar)); assert.notEqual(solarSignature(applied.solar), solarSignature(saved.solar))
  assert.deepEqual(geometryBrief(applied), geometryBrief(saved)); assert.equal(finishSignature(applied), finishSignature(saved))
  const cost = estimateBoq(design, applied, undefined, context), old = estimateBoq(design, saved, undefined, context)
  assert.equal(cost.expected, old.expected); assert.equal(cost.solar.assistance.deductedInr, 0)
  const reloaded = parseStoredBrief(JSON.parse(JSON.stringify(applied)))
  assert.equal(reloaded.success, true)
  assert.deepEqual(reloaded.data.solar, applied.solar)
  const corrupt = structuredClone(applied.solar); corrupt.assessmentInputs.governmentSupport.schemaVersion = 42
  const recovered = recoverStoredSolar(corrupt)
  assert.equal(recovered.assessmentInputs.objective, 'both'); assert.deepEqual(recovered.calculated, applied.solar.calculated); assert.deepEqual(recovered.assessmentInputs.governmentSupport, empty())
})

test('government support copy is translated with intact placeholders in Hindi and Marathi', () => {
  for (const [key, values] of Object.entries(governmentSupportMessages)) for (const [index, language] of ['hi', 'mr'].entries()) {
    assert.equal(translate(key, language), values[index]); assert.ok(values[index].trim()); assert.deepEqual(values[index].match(/\{\d+\}/g) ?? [], key.match(/\{\d+\}/g) ?? [])
  }
})

registerHooks({ resolve(s, c, next) { return s.startsWith('@/') ? { url: new URL(`../src/${s.slice(2)}`, import.meta.url).href, shortCircuit: true } : next(s, c) } })
const storage = new Map(); globalThis.localStorage = { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) }
globalThis.window = { localStorage: globalThis.localStorage }
const { useStudio } = await import('../src/state/studio.ts')
const { useProjects } = await import('../src/state/projects.ts')
test('saved project versions keep self-check inputs separate from the accepted building and restore prior answers', () => {
  const brief = defaultBrief(), design = generate(compile(brief))
  useStudio.getState().loadSaved(brief, { massing: design.massingType, seed: 12, planSeed: design.planSeed, planner: 'baseline' }); useStudio.getState().run()
  useProjects.setState({ items: [], currentId: null, stage: 'concept' })
  const before = useStudio.getState()
  useStudio.getState().edit(b => { b.solar.assessmentInputs.governmentSupport = basic() })
  assert.equal(useStudio.getState().result.design, before.result.design); assert.equal(useStudio.getState().pinned, before.pinned)
  const saved = useProjects.getState().save({ name: 'Government self-check fixture' }), version = saved.versions[0].id
  useStudio.getState().edit(b => { b.solar.assessmentInputs.governmentSupport.consumer = 'non-residential' })
  useProjects.getState().save({ label: 'Changed consumer category' })
  assert.equal(useProjects.getState().restore(saved.id, version), true)
  assert.deepEqual(useStudio.getState().brief.solar.assessmentInputs.governmentSupport, basic())
})
