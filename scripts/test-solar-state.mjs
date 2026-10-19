import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { briefSchema, defaultBrief, geometryBrief, parseStoredBrief } from '../src/lib/model/brief.ts'
import { defaultSolarConfiguration, solarConfigurationSchema, solarInputsSchema, solarConfigurationSignature,
  solarLayoutSchema, solarLayoutSignature, solarSignature } from '../src/lib/model/solar.ts'
import { compile } from '../src/lib/model/canonical.ts'
import { generate } from '../src/lib/engine/generate.ts'
import { createBuildingModel } from '../src/lib/engine/buildingModel.ts'
import { finishSignature } from '../src/lib/cost/finishAssignments.ts'
import { estimateBoq } from '../src/lib/cost/boq.ts'
import { geometryCostKey } from '../src/lib/cost/quantities.ts'
import { extractLayout } from '../src/lib/plan/layout.ts'
import { pricingSignature, snapshotCost, restoreCostReplay, replayedCost } from '../src/lib/cost/replay.ts'

const panel = { id: 'illustrative-550', name: 'Example 550 W module', source: 'illustrative', revision: null,
  dimensionsMm: { width: 1134, height: 2278, thickness: 35 }, ratedPowerW: 550 }
const inputs = solarInputsSchema.parse({ panel, request: { kind: 'panel-count', panelCount: 6 }, monthlyConsumptionKwh: 280,
  location: { latitudeDeg: 18.52, longitudeDeg: 73.85, stateCode: 'MH', locality: 'Pune' },
  orientation: { planNorthBearingDeg: 45, preferredPanelAzimuthDeg: 180 }, mounting: 'low-tilt',
  reservedAreas: [{ id: 'seating', level: 1, rectMm: { x: 1000, y: 2000, w: 3000, h: 2500 } }],
  placement: { moduleOrientation: 'portrait', tiltDeg: 15, mountingHeightMm: 400, edgeClearanceMm: 1000, rowGapMm: 800 } })
const configured = () => solarConfigurationSchema.parse({ intention: 'install-now', inputs })
const layout = solarLayoutSchema.parse({ schemaVersion: 1, roofSignature: 'roof-example',
  coordinates: 'plan-x-east-y-south-z-up', units: 'mm',
  panels: [{ id: 'panel-1', roofSurfaceId: 'roof-1', positionMm: { x: 5000, y: 5000, z: 6500 }, azimuthDeg: 180, tiltDeg: 15 }] })
const calculated = () => { const config = configured(); return solarConfigurationSchema.parse({ ...config,
  calculated: { configurationSignature: solarConfigurationSignature(config), layout } }) }

test('old briefs migrate to undecided with genuinely unknown inputs and unchanged legacy solar allowance/cost', () => {
  const { solar: _solar, ...legacy } = defaultBrief()
  for (const allowance of [undefined, 'off', 'on']) {
    const raw = { ...legacy, specs: { overrides: allowance ? { solar: allowance } : {} } }
    const loaded = briefSchema.parse(raw)
    assert.equal(loaded.solar.intention, 'undecided')
    assert.equal(loaded.solar.schemaVersion, 1)
    assert.equal(loaded.solar.inputs.panel, null)
    assert.equal(loaded.solar.inputs.monthlyConsumptionKwh, null)
    assert.equal(loaded.solar.inputs.location.latitudeDeg, null)
    assert.equal(loaded.solar.inputs.orientation.planNorthBearingDeg, null)
    assert.equal(loaded.solar.inputs.mounting, 'unknown')
    assert.deepEqual(loaded.solar.inputs.request, { kind: 'unknown' })
    assert.equal(loaded.solar.calculated, null)
    assert.deepEqual(loaded.specs, raw.specs)
    assert.equal(compile(raw).seed, compile(loaded).seed)
    assert.equal(pricingSignature(raw), pricingSignature(loaded), 'Historical cost-replay signature must survive migration')
    assert.equal(finishSignature(raw), finishSignature(loaded), 'Historical render cache key must survive migration')
    const before = generate(compile(raw)), after = generate(compile(loaded))
    assert.equal(createBuildingModel(before).planId, createBuildingModel(after).planId)
    assert.deepEqual(estimateBoq(after), estimateBoq(before))
    if (allowance === 'on') assert.equal(estimateBoq(after).boq.find(line => line.item === 'solar').amount, 250000)
  }
})

test('version, numeric units, exclusive requests, coordinates and duplicate IDs are validated strictly', () => {
  for (const invalid of [
    { schemaVersion: 2 }, { intention: 'installed' },
    { inputs: { request: { kind: 'panel-count', panelCount: 0 } } },
    { inputs: { request: { kind: 'capacity', capacityKwp: 3, panelCount: 6 } } },
    { inputs: { request: { kind: 'capacity', capacityKwp: Infinity } } },
    { inputs: { monthlyConsumptionKwh: -1 } },
    { inputs: { monthlyConsumptionKwh: '300' } },
    { inputs: { panel: { ...panel, ratedPowerW: 0 } } },
    { inputs: { panel: { ...panel, dimensionsMm: { width: -1, height: 2000, thickness: 35 } } } },
    { inputs: { orientation: { planNorthBearingDeg: 360 } } },
    { inputs: { location: { latitudeDeg: 18 } } },
    { inputs: { reservedAreas: [inputs.reservedAreas[0], inputs.reservedAreas[0]] } },
    { inputs: { layout: layout } },
  ]) assert.equal(solarConfigurationSchema.safeParse(invalid).success, false, JSON.stringify(invalid))
  assert.equal(solarLayoutSchema.safeParse({ ...layout, units: 'm' }).success, false)
  assert.equal(solarLayoutSchema.safeParse({ ...layout, panels: [...layout.panels, ...layout.panels] }).success, false)
  const zero = solarInputsSchema.parse({ monthlyConsumptionKwh: 0, location: { latitudeDeg: 0, longitudeDeg: 0 } })
  assert.equal(zero.monthlyConsumptionKwh, 0); assert.equal(zero.location.latitudeDeg, 0)
})

test('all intentions and calculated layouts have separate solar identities without entering building/finish identity; pricing identity changes independently', () => {
  const brief = defaultBrief(), source = generate(compile(brief)), building = createBuildingModel(source)
  const expected = estimateBoq(source)
  for (const intention of ['undecided', 'not-included', 'reserve-space', 'install-now']) {
    const next = { ...brief, solar: solarConfigurationSchema.parse({ intention, inputs }) }
    assert.deepEqual(geometryBrief(next), geometryBrief(brief))
    assert.equal(compile(next).seed, compile(brief).seed)
    assert.equal(finishSignature(next), finishSignature(brief))
    assert.notEqual(pricingSignature(next), pricingSignature(brief))
    const plan = generate(compile(next)), model = createBuildingModel(plan)
    assert.deepEqual(plan.floors, source.floors)
    assert.equal(model.planId, building.planId); assert.equal(model.compositionId, building.compositionId)
    assert.equal(geometryCostKey(plan), geometryCostKey(source))
    assert.equal(estimateBoq(plan).expected, expected.expected)
    assert.equal(estimateBoq(plan).solar.grossInstallationCost, 0)
  }
  const result = calculated()
  assert.notEqual(solarSignature(result), solarSignature(configured()))
  assert.equal(solarConfigurationSignature(result), solarConfigurationSignature(configured()))
  const moved = { ...layout, panels: [{ ...layout.panels[0], positionMm: { x: 6000, y: 5000, z: 6500 } }] }
  assert.notEqual(solarLayoutSignature(moved), solarLayoutSignature(layout))
  assert.notEqual(solarLayoutSignature({ ...layout, roofSignature: 'different-roof' }), solarLayoutSignature(layout))
  assert.notEqual(solarConfigurationSignature({ ...result, inputs: { ...inputs, monthlyConsumptionKwh: 300 } }), solarConfigurationSignature(result))
  const reversed = Object.fromEntries(Object.entries(result).reverse())
  assert.equal(solarSignature(solarConfigurationSchema.parse(reversed)), solarSignature(result))
  assert.equal(solarConfigurationSchema.safeParse({ ...result, inputs: { ...inputs, monthlyConsumptionKwh: 300 } }).success, false)
  assert.equal(solarConfigurationSchema.safeParse({ ...result, intention: 'reserve-space' }).success, false)
})

test('storage recovery preserves the building and allowance, clearing stale results before falling back to unknown solar', () => {
  const brief = defaultBrief(); brief.specs.overrides.solar = 'on'
  const config = calculated()
  const stale = parseStoredBrief({ ...brief, solar: { ...config, inputs: { ...inputs, monthlyConsumptionKwh: 350 } } })
  assert.equal(stale.success, true)
  assert.equal(stale.data.solar.inputs.monthlyConsumptionKwh, 350)
  assert.equal(stale.data.solar.calculated, null)
  for (const invalid of [{ schemaVersion: 99 }, { schemaVersion: 1, inputs: { monthlyConsumptionKwh: -2 } }]) {
    const stored = parseStoredBrief({ ...brief, solar: invalid })
    assert.equal(stored.success, true); assert.equal(stored.data.solar.intention, 'undecided')
    assert.deepEqual(geometryBrief(stored.data), geometryBrief(brief))
    assert.equal(stored.data.specs.overrides.solar, 'on')
  }
  assert.equal(parseStoredBrief({ ...brief, levels: { storeys: -99 } }).success, false, 'Unrelated invalid architecture is not hidden')
  const valid = parseStoredBrief(JSON.parse(JSON.stringify({ ...brief, solar: config })))
  assert.equal(valid.success, true)
  assert.deepEqual(valid.data.solar, config, 'A matching calculated layout survives serialization separately from inputs')
})

registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === '@/lib/supabase.ts') return { url: 'data:text/javascript,export const supabase=null;export const isAuthConfigured=false;', shortCircuit: true }
  return specifier.startsWith('@/') ? { url: new URL(`../src/${specifier.slice(2)}`, import.meta.url).href, shortCircuit: true } : nextResolve(specifier, context)
} })
const storage = new Map()
globalThis.localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) }
globalThis.window = { localStorage: globalThis.localStorage }
const { useStudio } = await import('../src/state/studio.ts')
const { useProjects, parseCore, startAutosave } = await import('../src/state/projects.ts')
const { useBlender } = await import('../src/state/blender.ts')
const { parseSavedDesignRow } = await import('../src/state/designs.ts')

test('cloud saved-design parsing carries solar and migrates legacy/malformed optional data without remote access', () => {
  const base = { id: 'solar-project', name: 'Example', pinned: null, created_at: '2026-10-19T00:00:00Z', updated_at: '2026-10-19T00:00:00Z' }
  const config = calculated(), brief = defaultBrief()
  assert.deepEqual(parseSavedDesignRow({ ...base, brief: JSON.parse(JSON.stringify({ ...brief, solar: config })) }).brief.solar, config)
  const { solar: _solar, ...old } = brief
  old.specs.overrides.solar = 'on'
  for (const raw of [old, { ...old, solar: { schemaVersion: 999 } }]) {
    const parsed = parseSavedDesignRow({ ...base, brief: raw })
    assert.equal(parsed.brief.solar.intention, 'undecided')
    assert.equal(parsed.brief.specs.overrides.solar, 'on')
    assert.equal(compile(parsed.brief).seed, compile(old).seed)
  }
})

test('solar can be decided before generating any villa', () => {
  useStudio.getState().reset()
  assert.equal(useStudio.getState().result, null)
  assert.equal(useStudio.getState().updateSolar({ intention: 'reserve-space', inputs: {} }).ok, true)
  assert.equal(useStudio.getState().brief.solar.intention, 'reserve-space')
  assert.equal(useStudio.getState().result, null)
  assert.equal(useStudio.getState().pinned, null)
})

function fresh() {
  const brief = defaultBrief(); brief.site.plotWidth = 25; brief.site.plotDepth = 30
  const source = generate(compile(brief), { seed: 41, planner: 'baseline' })
  const pinned = { massing: source.massingType, seed: 650523944, planSeed: source.planSeed,
    planFamily: source.planFamily, recipe: source.planRecipe, planner: 'baseline' }
  useStudio.getState().loadSaved(brief, pinned, extractLayout(source))
  useStudio.getState().run()
  useProjects.setState({ items: [], currentId: null, stage: 'concept', error: null })
  const state = useStudio.getState(), id = state.result.buildingModel.planId
  useBlender.setState({ accepted: { [id]: { seed: pinned.seed, requestedSeed: pinned.seed, planId: id,
    finishSignature: finishSignature(brief), quality: 'preview', warnings: [], files: { glb: '/same-building.glb' } } },
    job: null, sourcePlanId: id, directionRenders: {}, previews: {}, selectionKey: null, error: null })
  return state
}

test('dedicated updates are atomic and preserve exact source design, edits, accepted render and cost without network work', async () => {
  fresh()
  const before = useStudio.getState(), renders = useBlender.getState(), oldFetch = globalThis.fetch
  globalThis.fetch = async () => { throw Error('Solar inputs must not request a new building') }
  try {
    assert.deepEqual(useStudio.getState().updateSolar({ intention: 'install-now', inputs }), { ok: true })
    const after = useStudio.getState()
    assert.equal(after.result.design, before.result.design); assert.equal(after.result.buildingModel, before.result.buildingModel)
    assert.equal(after.result.cost.expected, before.result.cost.expected); assert.equal(after.pinned, before.pinned)
    assert.equal(after.layout, before.layout); assert.equal(after.existing, before.existing)
    assert.equal(useBlender.getState(), renders)
    assert.deepEqual(after.brief.solar.inputs, inputs)
    assert.equal(after.brief.solar.calculated, null)
    assert.equal(useStudio.getState().updateSolar({ intention: 'install-now', inputs: { panel: { ...panel, ratedPowerW: -1 } } }).ok, false)
    assert.equal(useStudio.getState(), after, 'Invalid update must not write state or storage')
    assert.equal(useStudio.getState().updateSolar({ intention: 'install-now', inputs, calculated: calculated().calculated }).ok, false)
    assert.deepEqual(useStudio.getState().updateSolar({ intention: 'install-now', inputs }), { ok: true })
    assert.equal(useStudio.getState(), after, 'Equivalent input update is a no-op')
    await useBlender.getState().ensureForPlan(after.result.design, after.pinned.seed)
    assert.equal(useBlender.getState().accepted[after.result.buildingModel.planId].files.glb, '/same-building.glb')
  } finally { globalThis.fetch = oldFetch }
})

test('editing inputs clears calculated data while a no-op retains it', () => {
  fresh()
  useStudio.setState(state => ({ brief: { ...state.brief, solar: calculated() } }))
  const before = useStudio.getState()
  useStudio.getState().updateSolar({ intention: 'install-now', inputs })
  assert.equal(useStudio.getState(), before)
  useStudio.getState().updateSolar({ intention: 'install-now', inputs: { ...inputs, request: { kind: 'capacity', capacityKwp: 3 } } })
  assert.equal(useStudio.getState().brief.solar.calculated, null)
  assert.equal(useStudio.getState().result, before.result)
})

test('studio reload, project switching, duplication and version restore keep solar isolated and replay the same villa', async () => {
  fresh()
  useStudio.getState().updateSolar({ intention: 'install-now', inputs })
  const before = useStudio.getState(), config = before.brief.solar, id = before.result.buildingModel.planId
  const saved = useProjects.getState().save({ name: 'Solar project' })
  const firstVersion = saved.versions[0].id
  const stored = JSON.parse(storage.get('brickpilot.projects.v1')).items[0]
  assert.deepEqual(parseCore(stored.core).brief.solar, config)
  const persistedStudio = storage.get('brickpilot.studio')
  useStudio.getState().updateSolar({ intention: 'not-included', inputs: {} })
  storage.set('brickpilot.studio', persistedStudio)
  await useStudio.persist.rehydrate()
  assert.deepEqual(useStudio.getState().brief.solar, config)
  assert.equal(useStudio.getState().run().buildingModel.planId, id)

  useStudio.getState().reset(); useProjects.getState().startNew(); useStudio.getState().run()
  useProjects.getState().save({ name: 'Other project' })
  assert.deepEqual(useStudio.getState().brief.solar, defaultSolarConfiguration())
  useProjects.getState().open(saved.id); useStudio.getState().run()
  assert.deepEqual(useStudio.getState().brief.solar, config)
  assert.deepEqual(useStudio.getState().layout, before.layout)
  assert.equal(useStudio.getState().result.buildingModel.planId, id)
  const copied = useProjects.getState().duplicate(saved.id)
  assert.deepEqual(useProjects.getState().items.find(item => item.id === copied).core.brief.solar, config)
  useStudio.getState().updateSolar({ intention: 'reserve-space', inputs })
  useProjects.getState().save({ label: 'Reserve instead' })
  assert.equal(useProjects.getState().restore(saved.id, firstVersion), true)
  assert.deepEqual(useStudio.getState().brief.solar, config)
  assert.equal(useStudio.getState().result.buildingModel.planId, id)
  const oldFetch = globalThis.fetch
  globalThis.fetch = async () => { throw Error('Restoring solar must reuse the accepted render') }
  try { await useBlender.getState().ensureForPlan(useStudio.getState().result.design, before.pinned.seed) }
  finally { globalThis.fetch = oldFetch }
  assert.equal(useBlender.getState().accepted[id].files.glb, '/same-building.glb')
})

test('solar-only edits autosave the open project and invalidate stale pricing replay while retaining numerical non-installed cost', async () => {
  fresh()
  const state = useStudio.getState()
  const replay = snapshotCost(state.result.design, state.brief, state.result.cost)
  restoreCostReplay(replay)
  useProjects.getState().save({ name: 'Autosaved solar' })
  const stop = startAutosave()
  try {
    useStudio.getState().updateSolar({ intention: 'reserve-space', inputs })
    const now = useStudio.getState()
    assert.equal(replayedCost(now.result.design, now.brief), null)
    assert.equal(now.result.cost.expected, state.result.cost.expected)
    await new Promise(resolve => setTimeout(resolve, 1650))
    const saved = useProjects.getState().items.find(item => item.id === useProjects.getState().currentId)
    assert.equal(saved.core.brief.solar.intention, 'reserve-space')
    assert.deepEqual(saved.core.brief.solar.inputs, inputs)
  } finally { stop(); restoreCostReplay(null) }
})
