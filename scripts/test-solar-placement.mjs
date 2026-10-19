import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { defaultBrief, geometryBrief } from '../src/lib/model/brief.ts'
import { solarConfigurationSchema, solarLayoutV2Schema, solarPanelSpecificationKey, recoverStoredSolar } from '../src/lib/model/solar.ts'
import { fnv } from '../src/lib/engine/massing/rng.ts'
import { compile } from '../src/lib/model/canonical.ts'
import { generate } from '../src/lib/engine/generate.ts'
import { generateAlternativeDesign } from '../src/lib/engine/generateAlternativeDesign.ts'
import { finishSignature } from '../src/lib/cost/finishAssignments.ts'
import { estimateBoq } from '../src/lib/cost/boq.ts'
import { buildSolarRoofModel, solarAllocationPolicySchema, solarRoofInputsSignature } from '../src/lib/solar/roofModel.ts'
import { proposeSolarPlacement, reviewSolarLayout, solarLayoutTotals, solarPanelGeometry } from '../src/lib/solar/placement.ts'
import { subtractRegions, regionAreaM2, containsPoint } from '../src/lib/solar/regions.ts'
import { rectUnionEdges } from '../src/lib/geometry.ts'
import { polygonFitsRegions, polygonBounds, polygonsOverlap, rectanglePolygon } from '../src/lib/solar/polygons.ts'

const specification = { id: 'example-module', schemaVersion: 1, name: 'Illustrative module', source: 'illustrative', revision: 'example-v1',
  dimensionsMm: { width: 1000, height: 2000, thickness: 40 }, ratedPowerW: 550 }
function config(inputs = {}, intention = 'install-now') {
  return solarConfigurationSchema.parse({ intention, inputs: { panel: specification, request: { kind: 'panel-count', panelCount: 6 }, ...inputs } })
}
function roofFor(c, { width = 16000, depth = 16000, cuts = [], budget, rotation } = {}) {
  const gross = [{ x: 0, y: 0, w: width, h: depth }], regions = subtractRegions(gross, cuts.map(c => c.rect))
  const exclusions = cuts.map((c, i) => ({ id: `cut-${i}`, kind: c.kind, regionsMm: [c.rect], clearanceMm: 0, reason: 'Fixture obstruction' }))
  const surface = { id: 'roof:top', floorId: 'FF', level: 1, kind: 'flat-top-roof', elevationMm: 6200,
    grossRegionsMm: gross, holes: [], regionsMm: subtractRegions(gross), edges: rectUnionEdges(gross),
    obstacles: exclusions, exclusions, components: [{ id: 'top-island', regionsMm: gross, access: 'modeled' }],
    access: { status: 'modeled', entryMm: { x: 0, y: 0 }, protectedRegionsMm: [] },
    status: 'concept-usable', issues: [], usableRegionsMm: regions, roofAreaM2: regionAreaM2(gross), accessibleClearAreaM2: regionAreaM2(regions),
    usableAreaM2: regionAreaM2(regions), maxSolarFootprintAreaM2: budget ?? regionAreaM2(regions) }
  return { schemaVersion: 1, sourcePlanId: 'test-plan', roofSignature: 'roof-test-v1', allocationSignature: 'allocation-test-v1',
    allocationInputsSignature: solarRoofInputsSignature(c.inputs), coordinates: 'plan-x-east-y-south-z-up', units: 'mm',
    policy: solarAllocationPolicySchema.parse({}), orientation: { status: rotation === undefined ? 'unknown' : 'user-provided', planNorthBearingDeg: rotation ?? null },
    surfaces: [surface], usableAreaM2: surface.usableAreaM2, maxSolarFootprintAreaM2: surface.maxSolarFootprintAreaM2, issues: [], qualification: 'Test geometry contract' }
}
const has = (p, code) => p.issues.some(i => i.code === code)
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-5, `${a} != ${b}`)

test('deterministic proposals preserve exact count × watts and a versioned immutable module specification', () => {
  const c = config({ request: { kind: 'capacity', capacityKwp: 3 } }), roof = roofFor(c)
  const before = JSON.stringify([c, roof]), a = proposeSolarPlacement(c, roof), b = proposeSolarPlacement(c, roof)
  assert.deepEqual(a, b); assert.equal(a.status, 'proposed')
  assert.equal(a.requestedCapacityKwp, 3); assert.equal(a.requestedPanelCount, 6)
  assert.equal(a.achievablePanelCount, 6); assert.equal(a.achievableCapacityKwp, 3.3)
  assert.deepEqual(solarLayoutTotals(a.layout), { panelCount: 6, ratedPowerW: 550, capacityKwp: 3.3 })
  assert.equal(a.layout.specificationKey, solarPanelSpecificationKey(specification))
  assert.notEqual(a.layout.specificationKey, solarPanelSpecificationKey({ ...specification, ratedPowerW: 560 }))
  assert.notEqual(a.layout.specificationKey, solarPanelSpecificationKey({ ...specification, dimensionsMm: { ...specification.dimensionsMm, width: 1100 } }))
  assert.equal(JSON.stringify([c, roof]), before)
  assert.equal(reviewSolarLayout(a.layout, c, roof).state, 'concept-valid')
  const awkward = config({ request: { kind: 'capacity', capacityKwp: 3.3000001 } })
  assert.equal(proposeSolarPlacement(awkward, roofFor(awkward)).requestedPanelCount, 7, 'A capacity just above six panels must not be rounded down')
  const decimal = config({ panel: { ...specification, ratedPowerW: .7 }, request: { kind: 'capacity', capacityKwp: .0021 } })
  const decimalProposal = proposeSolarPlacement(decimal, roofFor(decimal))
  assert.equal(decimalProposal.requestedPanelCount, 3)
  assert.equal(decimalProposal.achievableCapacityKwp, .0021)
})

test('portrait and landscape at arbitrary rotation carry full 3D prism, frame and service envelopes', () => {
  for (const moduleOrientation of ['portrait', 'landscape']) for (const tiltDeg of [0, 37, 90]) {
    const c = config({ placement: { moduleOrientation, arrayRotationDeg: 37, tiltDeg, mountingHeightMm: 700, rowGapMm: 950 } })
    const roof = roofFor(c), p = proposeSolarPlacement(c, roof)
    assert.equal(p.status, 'proposed'); assert.equal(p.layout.panels.length, 6)
    for (const panel of p.layout.panels) {
      assert.equal(panel.moduleOrientation, moduleOrientation); assert.equal(panel.azimuthDeg, 37)
      const g = solarPanelGeometry(panel, p.layout.placementPolicy, p.layout.resolved)
      close(Math.min(...g.physicalCornersMm.map(p => p.z)), 6900)
      assert.ok(g.physicalCornersMm.every(point => roof.surfaces[0].regionsMm.some(r => containsPoint(r, point))))
      assert.ok(polygonFitsRegions(g.projectedFootprintMm, roof.surfaces[0].regionsMm))
      assert.ok(polygonFitsRegions(g.maintenanceEnvelopeMm, roof.surfaces[0].usableRegionsMm))
      assert.ok(g.supportDepthMm >= 800, 'Near-vertical modules retain a support footprint')
    }
    assert.equal(reviewSolarLayout(p.layout, c, roof).state, 'concept-valid')
  }
})

test('complete envelopes cannot bridge courtyard holes, service cuts, reservations or protected access', () => {
  const c = config({ request: { kind: 'panel-count', panelCount: 100 } })
  const cuts = [{ kind: 'courtyard', rect: { x: 5000, y: 4000, w: 3000, h: 3000 } },
    { kind: 'tank-bank', rect: { x: 11000, y: 1000, w: 3500, h: 1500 } },
    { kind: 'reserved-area', rect: { x: 1000, y: 9000, w: 3000, h: 4000 } },
    { kind: 'protected-access', rect: { x: 9000, y: 0, w: 800, h: 16000 } }]
  const roof = roofFor(c, { cuts }), p = proposeSolarPlacement(c, roof)
  assert.equal(p.status, 'limited'); assert.ok(p.achievablePanelCount > 0); assert.ok(p.achievablePanelCount < 100)
  for (const panel of p.layout.panels) {
    const g = solarPanelGeometry(panel, p.layout.placementPolicy, p.layout.resolved)
    for (const cut of cuts) assert.equal(polygonsOverlap(g.maintenanceEnvelopeMm, rectanglePolygon(cut.rect)), false)
  }
  assert.equal(reviewSolarLayout(p.layout, c, roof).state, 'concept-valid')
  const square = rectanglePolygon({ x: 2000, y: 2000, w: 3000, h: 3000 })
  assert.equal(polygonFitsRegions(square, subtractRegions(roof.surfaces[0].regionsMm, [{ x: 3000, y: 3000, w: 500, h: 500 }])), false, 'Corners inside the roof are not enough when a hole lies inside the module')
})

test('manual support overhang and maintenance clearance are checked even when the module face alone fits', () => {
  const c = config({ request: { kind: 'panel-count', panelCount: 1 }, placement: { mode: 'manual', tiltDeg: 0, arrayRotationDeg: 0 } })
  const roof = roofFor(c)
  for (const x of [550, 620]) {
    const p = proposeSolarPlacement(c, roof, { manualPanels: [{ roofSurfaceId: 'roof:top', positionMm: { x, y: 3000 }, azimuthDeg: 0 }] })
    assert.equal(p.achievablePanelCount, 0); assert.ok(has(p, 'ROOF_BOUNDARY_OR_OPENING'))
  }
  const good = proposeSolarPlacement(c, roof, { manualPanels: [{ roofSurfaceId: 'roof:top', positionMm: { x: 2000, y: 3000 }, azimuthDeg: 0 }] })
  assert.equal(good.status, 'proposed')
})

test('row and module spacing are enforced in manual validation and the generated grid', () => {
  const c = config({ request: { kind: 'panel-count', panelCount: 2 }, placement: { mode: 'manual', tiltDeg: 0, rowGapMm: 1000, arrayRotationDeg: 0 } }), roof = roofFor(c)
  // Support depth is 2200. Two rows 2700 apart leave only 500 mm, despite clearing maintenance buffers.
  const p = proposeSolarPlacement(c, roof, { manualPanels: [3000, 5700].map(y => ({ roofSurfaceId: 'roof:top', positionMm: { x: 3000, y }, azimuthDeg: 0 })) })
  assert.equal(p.achievablePanelCount, 1); assert.ok(has(p, 'PANEL_MAINTENANCE_CONFLICT'))
  const valid = proposeSolarPlacement(c, roof, { manualPanels: [3000, 6200].map(y => ({ roofSurfaceId: 'roof:top', positionMm: { x: 3000, y }, azimuthDeg: 0 })) })
  assert.equal(valid.achievablePanelCount, 2); assert.equal(reviewSolarLayout(valid.layout, c, roof).state, 'concept-valid')
  const adjusted = config({ placement: { rowGapMm: 0 } }), auto = proposeSolarPlacement(adjusted, roofFor(adjusted))
  assert.equal(auto.layout.resolved.rowGapMm, 200)
  assert.ok(auto.layout.resolved.assumptions.some(s => s.includes('increased from 0')))
})

test('quota and roof-fit shortfalls report requested versus achieved capacity without claiming a global maximum', () => {
  const c = config(), roof = roofFor(c, { budget: 3 }), p = proposeSolarPlacement(c, roof)
  assert.equal(p.status, 'limited'); assert.equal(p.achievablePanelCount, 1)
  assert.equal(p.requestedCapacityKwp, 3.3); assert.equal(p.achievableCapacityKwp, .55)
  assert.ok(has(p, 'ALLOCATION_BUDGET')); assert.equal(p.search.provesMaximum, false)
  const tiny = proposeSolarPlacement(c, roofFor(c, { width: 700, depth: 700 }))
  assert.equal(tiny.achievablePanelCount, 0); assert.ok(has(tiny, 'MODULE_ENVELOPE_DOES_NOT_FIT'))
})

test('north is not inferred and stale roof inputs cannot bypass new reservations', () => {
  const c = config({ orientation: { preferredPanelAzimuthDeg: 180 } }), roof = roofFor(c)
  assert.ok(has(proposeSolarPlacement(c, roof), 'TRUE_NORTH_REQUIRED'))
  const known = config({ orientation: { preferredPanelAzimuthDeg: 180, planNorthBearingDeg: 90 } }), knownRoof = roofFor(known, { rotation: 90 })
  assert.equal(proposeSolarPlacement(known, knownRoof).layout.resolved.arrayRotationDeg, 90)
  const changed = config({ reservedAreas: [{ id: 'new-space', level: 1, rectMm: { x: 0, y: 0, w: 5000, h: 5000 } }] })
  assert.ok(has(proposeSolarPlacement(changed, roof), 'ROOF_INPUTS_STALE'))
})

test('roof/policy changes mark old layouts for review without moving any panels and permit a separate replacement proposal', () => {
  const c = config(), roof = roofFor(c), old = proposeSolarPlacement(c, roof).layout, before = JSON.stringify(old)
  const nextRoof = { ...roof, roofSignature: 'changed-roof', allocationSignature: 'changed-allocation' }
  assert.deepEqual(reviewSolarLayout(old, c, nextRoof), { state: 'needs-review', reasonCodes: ['ROOF_CHANGED', 'ROOF_ALLOCATION_CHANGED'] })
  const proposed = proposeSolarPlacement(c, nextRoof)
  assert.equal(proposed.layout.roofSignature, 'changed-roof')
  assert.equal(JSON.stringify(old), before)
  assert.equal(reviewSolarLayout(proposed.layout, c, nextRoof).state, 'concept-valid')
})

test('saved layouts reject fabricated dimensions, elevation, count, rotation, duplicated IDs and false validity flags', () => {
  const c = config(), roof = roofFor(c), layout = proposeSolarPlacement(c, roof).layout
  const cases = [l => { l.panels[0].dimensionsMm.width = 10 }, l => { l.panels[0].positionMm.z += 100 },
    l => { l.panels[0].ratedPowerW = 900 }, l => { l.panels[0].azimuthDeg = 30 }, l => { l.panels[0].roofComponentId = 'other' },
    l => { l.panels.push(l.panels[0]) }, l => { l.panels[0].positionMm.x = -500 }, l => { l.panels[0].dimensionsMm.width = 1e30 }]
  for (const tamper of cases) { const bad = structuredClone(layout); tamper(bad); assert.equal(reviewSolarLayout(bad, c, roof).state, 'invalid') }
  assert.equal(reviewSolarLayout({ schemaVersion: 1, roofSignature: 'old', panels: [] }, c, roof).state, 'needs-review')
  assert.equal(solarLayoutV2Schema.safeParse({ ...layout, schemaVersion: 99 }).success, false)
})

test('known legacy input signatures migrate without losing old panel positions; changed inputs still invalidate results', () => {
  const legacy = structuredClone(config())
  delete legacy.inputs.panel.schemaVersion; delete legacy.inputs.placement.arrayRotationDeg
  const canonical = v => Array.isArray(v) ? `[${v.map(canonical).join(',')}]` : v && typeof v === 'object' ?
    `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}` : JSON.stringify(v)
  const source = canonical({ schemaVersion: 1, intention: legacy.intention, inputs: legacy.inputs })
  const signature = `solar-config-v1-${fnv(source).toString(16).padStart(8, '0')}${fnv(`solar-config-v1|${source}`).toString(16).padStart(8, '0')}`
  legacy.calculated = { configurationSignature: signature, layout: { schemaVersion: 1, roofSignature: 'old-roof',
    coordinates: 'plan-x-east-y-south-z-up', units: 'mm', panels: [{ id: 'legacy-1', roofSurfaceId: 'old-top', positionMm: { x: 1000, y: 1000, z: 6500 }, azimuthDeg: 0, tiltDeg: 15 }] } }
  const migrated = recoverStoredSolar(legacy)
  assert.deepEqual(migrated.calculated.layout.panels, legacy.calculated.layout.panels)
  assert.equal(migrated.inputs.panel.schemaVersion, 1); assert.equal(migrated.inputs.placement.arrayRotationDeg, null)
  assert.equal(reviewSolarLayout(migrated.calculated.layout, migrated, roofFor(migrated)).state, 'needs-review')
  legacy.inputs.monthlyConsumptionKwh = 500
  assert.equal(recoverStoredSolar(legacy).calculated, null, 'A schema migration must not bless calculations after unrelated edits')
})

test('bounded search cannot hang on tiny modules or silently claim maximum capacity', () => {
  const c = config({ panel: { ...specification, dimensionsMm: { width: 1, height: 1, thickness: 1 } }, request: { kind: 'panel-count', panelCount: 10000 } })
  const p = proposeSolarPlacement(c, roofFor(c), { policy: { maxCandidateChecks: 100, minSupportDepthMm: 1, supportOverhangMm: 0, maintenanceSideMm: 0, maintenanceRowMm: 0, moduleGapMm: 0 } })
  assert.equal(p.search.candidateChecks, 100); assert.equal(p.search.limitReached, true); assert.ok(has(p, 'SEARCH_LIMIT_REACHED'))
})

test('reserve-for-later and disabled intentions never create an installation layout or change cost', () => {
  const b = defaultBrief(), plan = generate(compile(b)), before = estimateBoq(plan)
  for (const intention of ['undecided', 'not-included', 'reserve-space']) {
    const c = config({ reservedAreas: [{ id: 'future', level: 1, rectMm: { x: 2000, y: 2000, w: 3000, h: 2000 } }] }, intention)
    const p = proposeSolarPlacement(c, roofFor(c))
    assert.equal(p.layout, null); assert.equal(p.achievablePanelCount, 0); assert.equal(p.achievableCapacityKwp, 0)
    assert.deepEqual(p.reservations, c.inputs.reservedAreas)
    const next = { ...b, solar: c }
    assert.deepEqual(geometryBrief(next), geometryBrief(b)); assert.equal(finishSignature(next), finishSignature(b))
    assert.equal(estimateBoq({ ...plan, model: { ...plan.model, brief: next } }).expected, before.expected)
    assert.equal(estimateBoq(plan, next).solar.grossInstallationCost, 0)
  }
  const unassigned = config({}, 'reserve-space')
  assert.ok(has(proposeSolarPlacement(unassigned, roofFor(unassigned)), 'RESERVATION_AREA_REQUIRED'))
})

test('actual generated roof proposal respects shared roof geometry and the source architecture remains byte-for-byte fixed', () => {
  const b = defaultBrief(); b.site.plotWidth = 25; b.site.plotDepth = 30
  const plan = generate(compile(b)), architecture = generateAlternativeDesign(plan, 12), c = config({ request: { kind: 'panel-count', panelCount: 2 } })
  const before = JSON.stringify([plan, architecture]), roof = buildSolarRoofModel(plan, { architecture, inputs: c.inputs }), p = proposeSolarPlacement(c, roof)
  assert.ok(p.achievablePanelCount > 0); assert.equal(reviewSolarLayout(p.layout, c, roof).state, 'concept-valid')
  assert.equal(JSON.stringify([plan, architecture]), before)
  for (const panel of p.layout.panels) {
    const g = solarPanelGeometry(panel, p.layout.placementPolicy, p.layout.resolved), surface = roof.surfaces.find(s => s.id === panel.roofSurfaceId)
    assert.ok(polygonFitsRegions(g.maintenanceEnvelopeMm, surface.usableRegionsMm))
    assert.ok(polygonBounds(g.support.footprintMm).w > 0)
  }
})

registerHooks({ resolve(s, c, next) { return s.startsWith('@/') ? { url: new URL(`../src/${s.slice(2)}`, import.meta.url).href, shortCircuit: true } : next(s, c) } })
const storage = new Map(); globalThis.localStorage = { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) }
globalThis.window = { localStorage: globalThis.localStorage }
const { useStudio } = await import('../src/state/studio.ts')
const { useProjects } = await import('../src/state/projects.ts')
const { useBlender } = await import('../src/state/blender.ts')

test('explicit apply saves the canonical layout and roof changes only mark it for review until a replacement is accepted', async () => {
  const b = defaultBrief(); b.site.plotWidth = 25; b.site.plotDepth = 30
  const plan = generate(compile(b)), pinned = { massing: plan.massingType, seed: 12, planSeed: plan.planSeed, planner: 'baseline' }
  useStudio.getState().loadSaved(b, pinned); useStudio.getState().run()
  const c = config({ request: { kind: 'panel-count', panelCount: 2 } })
  useStudio.getState().updateSolar({ intention: c.intention, inputs: c.inputs })
  const before = useStudio.getState(), id = before.result.buildingModel.planId
  useBlender.setState({ accepted: { [id]: { planId: id, seed: 12, finishSignature: finishSignature(b), files: { glb: '/unchanged.glb' } } }, job: null, directionRenders: {}, previews: {} })
  const renders = useBlender.getState(), oldFetch = globalThis.fetch
  globalThis.fetch = async () => { throw Error('Solar placement must not generate architecture') }
  try {
    const proposed = useStudio.getState().proposeSolarLayout()
    assert.equal(proposed.ok, true); assert.ok(proposed.proposal.achievablePanelCount > 0)
    assert.equal(useStudio.getState().brief.solar.calculated, null, 'Proposal does not replace saved state')
    assert.equal(useStudio.getState().applySolarLayout(proposed.proposal.layout).ok, true)
    let state = useStudio.getState(), savedPanels = JSON.stringify(state.brief.solar.calculated.layout.panels)
    assert.equal(state.result.design, before.result.design); assert.equal(state.result.buildingModel, before.result.buildingModel); assert.ok(state.result.cost.solar.panelCount > 0); assert.equal(state.pinned, before.pinned); assert.equal(state.layout, before.layout)
    assert.equal(useBlender.getState(), renders)
    useProjects.setState({ items: [], currentId: null, stage: 'concept' })
    const saved = useProjects.getState().save({ name: 'Solar layout' })
    useStudio.getState().loadSaved(saved.core.brief, pinned, saved.core.layout)
    useStudio.getState().run()
    state = useStudio.getState()
    assert.equal(state.brief.solar.calculated.layout.validity.state, 'concept-valid')
    assert.equal(JSON.stringify(state.brief.solar.calculated.layout.panels), savedPanels)
    await useBlender.getState().ensureForPlan(state.result.design, 12)
    assert.equal(useBlender.getState().accepted[id].files.glb, '/unchanged.glb')
    useStudio.getState().edit(next => { next.site.plotWidth = 26 })
    assert.equal(useStudio.getState().brief.solar.calculated.layout.validity.state, 'needs-review')
    assert.equal(JSON.stringify(useStudio.getState().brief.solar.calculated.layout.panels), savedPanels)
    useStudio.getState().run()
    assert.equal(useStudio.getState().brief.solar.calculated.layout.validity.state, 'needs-review')
    assert.equal(useStudio.getState().applySolarLayout(proposed.proposal.layout).ok, false, 'An old proposal cannot overwrite a changed roof')
    const replacement = useStudio.getState().proposeSolarLayout()
    assert.equal(replacement.ok, true); assert.ok(replacement.proposal.layout)
    assert.equal(JSON.stringify(useStudio.getState().brief.solar.calculated.layout.panels), savedPanels)
    assert.equal(useStudio.getState().applySolarLayout(replacement.proposal.layout).ok, true)
    assert.equal(useStudio.getState().brief.solar.calculated.layout.validity.state, 'concept-valid')
    const invalid = structuredClone(replacement.proposal.layout); invalid.panels[0].positionMm.z += 100
    assert.equal(useStudio.getState().applySolarLayout(invalid).ok, false)
  } finally { globalThis.fetch = oldFetch }
})
