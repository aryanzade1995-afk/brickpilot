import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { defaultBrief, geometryBrief } from '../src/lib/model/brief.ts'
import { solarConfigurationSchema, defaultSolarConfiguration } from '../src/lib/model/solar.ts'
import { compile } from '../src/lib/model/canonical.ts'
import { generate } from '../src/lib/engine/generate.ts'
import { generateAlternativeDesign } from '../src/lib/engine/generateAlternativeDesign.ts'
import { finishSignature } from '../src/lib/cost/finishAssignments.ts'
import { estimateBoq } from '../src/lib/cost/boq.ts'
import { buildSolarRoofModel } from '../src/lib/solar/roofModel.ts'
import { previewSolarEditor, applySolarEditor, resetFinishSpecifications } from '../src/lib/solar/editor.ts'
import { solarMessages } from '../src/lib/i18n/solarMessages.ts'
import { translate } from '../src/lib/i18n/index.ts'

const brief = defaultBrief(); brief.site.plotWidth = 25; brief.site.plotDepth = 30
const design = generate(compile(brief)), architecture = generateAlternativeDesign(design, 12)
const configuration = solarConfigurationSchema.parse({ intention: 'install-now', inputs: {
  panel: { id: 'test-550', name: 'Illustrative 550 W module', source: 'illustrative', revision: 'test-v1',
    dimensionsMm: { width: 1134, height: 2278, thickness: 35 }, ratedPowerW: 550 },
  request: { kind: 'panel-count', panelCount: 2 }, monthlyConsumptionKwh: 250,
} })
const preview = () => previewSolarEditor(design, configuration, architecture)

test('draft preview is deterministic and cannot change the project or accepted architecture', () => {
  const before = JSON.stringify([brief, design, architecture, configuration])
  const a = preview(), b = preview()
  assert.deepEqual(a, b)
  assert.equal(a.proposal.achievablePanelCount, 2)
  assert.equal(a.proposal.achievableCapacityKwp, 1.1)
  assert.equal(JSON.stringify([brief, design, architecture, configuration]), before)
  assert.equal(brief.solar.intention, 'undecided')
  assert.equal(brief.solar.calculated, null)
})

test('Apply commits the previewed positions, inputs and exact capacity without changing geometry or finishes', () => {
  const p = preview(), next = applySolarEditor(brief, p, p.roof)
  assert.equal(next.solar.intention, 'install-now')
  assert.equal(next.solar.inputs.monthlyConsumptionKwh, 250)
  assert.deepEqual(next.solar.calculated.layout.panels, p.proposal.layout.panels)
  assert.equal(next.solar.calculated.layout.validity.state, 'concept-valid')
  assert.equal(solarConfigurationSchema.safeParse(next.solar).success, true)
  assert.deepEqual(geometryBrief(next), geometryBrief(brief))
  assert.equal(finishSignature(next), finishSignature(brief))
  assert.equal(estimateBoq(design, next).expected, estimateBoq(design, brief).expected)
  assert.equal(estimateBoq(design, next).solar.status, 'needs-review', 'Cost without current architecture cannot trust a saved layout')
  assert.equal(next.specs, brief.specs)
  assert.equal(brief.solar.calculated, null)
})

test('stale roof and reserved-space previews cannot be applied', () => {
  const p = preview()
  assert.throws(() => applySolarEditor(brief, p, { ...p.roof, roofSignature: 'changed' }), /SOLAR_PREVIEW_STALE/)
  const changed = structuredClone(configuration.inputs)
  changed.placement.edgeClearanceMm = 1200
  const now = buildSolarRoofModel(design, { architecture, inputs: changed })
  assert.throws(() => applySolarEditor(brief, p, now), /SOLAR_PREVIEW_STALE/)
})

test('removal, reservation, reset and later re-enabling are separate from finish reset', () => {
  const p = preview(), installed = applySolarEditor(brief, p, p.roof)
  const removedDraft = { ...installed.solar, intention: 'not-included' }
  const removedPreview = previewSolarEditor(design, removedDraft, architecture)
  const removed = applySolarEditor(installed, removedPreview, removedPreview.roof)
  assert.equal(removed.solar.calculated, null)
  assert.deepEqual(removed.solar.inputs, configuration.inputs, 'Remove retains the module and sizing preferences')
  const enabledPreview = previewSolarEditor(design, { ...removed.solar, intention: 'install-now' }, architecture)
  const enabled = applySolarEditor(removed, enabledPreview, enabledPreview.roof)
  assert.deepEqual(enabled.solar.calculated.layout.panels, installed.solar.calculated.layout.panels)
  const region = p.roof.surfaces.find(s => s.usableRegionsMm.length)
  const reservationDraft = { ...configuration, intention: 'reserve-space', inputs: { ...configuration.inputs,
    reservedAreas: [{ id: 'future', label: 'Future solar', roofSurfaceId: region.id, level: region.level, rectMm: region.usableRegionsMm[0] }] } }
  const reservation = previewSolarEditor(design, reservationDraft, architecture)
  const reserved = applySolarEditor(brief, reservation, reservation.roof)
  assert.equal(reserved.solar.calculated, null)
  assert.equal(reserved.solar.inputs.reservedAreas.length, 1)
  assert.equal(reservation.proposal.achievablePanelCount, 0)
  assert.equal(estimateBoq(design, reserved).expected, estimateBoq(design, brief).expected)
  assert.equal(estimateBoq(design, reserved).solar.status, 'reservation-only')
  const reset = previewSolarEditor(design, defaultSolarConfiguration(), architecture)
  assert.deepEqual(applySolarEditor(enabled, reset, reset.roof).solar, defaultSolarConfiguration())
})

test('Reset finishes and finish levels retain structured solar and historical solar allowances', () => {
  const p = preview(), installed = applySolarEditor(brief, p, p.roof)
  installed.specs = { overrides: { solar: 'on', 'solar@old-room': 'on', 'interior-paint': 'premium', 'floor-living@room': 'marble' } }
  for (const level of ['basic', 'mid', 'premium']) {
    const next = resetFinishSpecifications(installed, level)
    assert.equal(next.finish, level)
    assert.equal(next.solar, installed.solar)
    assert.deepEqual(next.specs.overrides, { solar: 'on', 'solar@old-room': 'on' })
  }
  assert.equal(Object.keys(installed.specs.overrides).length, 4)
})

test('an unavailable source preserves a saved layout on unchanged preferences and supports preference-only saves', () => {
  const p = preview(), installed = applySolarEditor(brief, p, p.roof)
  const unavailable = previewSolarEditor(design, installed.solar)
  assert.equal(unavailable.proposal.achievablePanelCount, 0)
  const retained = applySolarEditor(installed, unavailable, unavailable.roof)
  assert.deepEqual(retained.solar.calculated, installed.solar.calculated)
  const incomplete = previewSolarEditor(design, { ...defaultSolarConfiguration(), intention: 'install-now' }, architecture)
  const preferences = applySolarEditor(brief, incomplete, incomplete.roof)
  assert.equal(preferences.solar.intention, 'install-now')
  assert.equal(preferences.solar.calculated, null)
  assert.equal(preferences.solar.inputs.panel, null)
})

test('every solar message has English, Hindi and Marathi presentation, including numeric assumptions', () => {
  for (const [key, translations] of Object.entries(solarMessages)) {
    assert.equal(translate(key, 'en'), key)
    for (const [index, language] of ['hi', 'mr'].entries()) {
      assert.ok(translations[index].trim().length > 0, `${key}: ${language}`)
      assert.equal(translate(key, language), translations[index], `${key}: ${language}`)
      assert.deepEqual(translations[index].match(/\{\d+\}/g)?.sort() ?? [], key.match(/\{\d+\}/g)?.sort() ?? [])
    }
  }
  for (const language of ['hi', 'mr']) {
    assert.notEqual(translate('Concept tilt 15° assumed.', language), 'Concept tilt 15° assumed.')
    assert.ok(translate('Concept row gap 800 mm assumed; not a shading calculation.', language).includes('800'))
  }
})

registerHooks({ resolve(s, c, next) { return s.startsWith('@/') ? { url: new URL(`../src/${s.slice(2)}`, import.meta.url).href, shortCircuit: true } : next(s, c) } })
const storage = new Map()
globalThis.localStorage = { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) }
globalThis.window = { localStorage: globalThis.localStorage }
const { useStudio } = await import('../src/state/studio.ts')
const { useBlender } = await import('../src/state/blender.ts')

test('the Finishes onBrief save path persists solar with pinned plan, layout and accepted render intact', () => {
  useStudio.getState().loadSaved(brief, { massing: design.massingType, seed: 12, planSeed: design.planSeed, planner: 'baseline' })
  useStudio.getState().run()
  const before = useStudio.getState(), source = before.result.design
  const arch = { buildingModel: before.result.buildingModel, massingModel: before.result.massingModel,
    facadeGrammar: before.result.facadeModel, villaDesignDNA: before.result.villaDesignDNA }
  const p = previewSolarEditor(source, configuration, arch), next = applySolarEditor(before.brief, p, p.roof)
  useBlender.setState({ accepted: { [arch.buildingModel.planId]: { files: { glb: '/existing-villa.glb' } } } })
  const renders = useBlender.getState()
  // The route saves all three specification fields atomically.
  useStudio.getState().edit(b => { b.finish = next.finish; b.specs = next.specs; b.solar = solarConfigurationSchema.parse(next.solar) })
  const after = useStudio.getState()
  assert.deepEqual(after.brief.solar, next.solar)
  assert.equal(after.result.design, source)
  assert.equal(after.pinned, before.pinned)
  assert.equal(after.layout, before.layout)
  assert.equal(useBlender.getState(), renders)
  assert.ok(after.result.cost.expected > before.result.cost.expected)
  assert.equal(after.result.cost.solar.panelCount, 2)
})
