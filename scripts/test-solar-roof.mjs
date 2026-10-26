import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { defaultBrief } from '../src/lib/model/brief.ts'
import { compile } from '../src/lib/model/canonical.ts'
import { solarInputsSchema } from '../src/lib/model/solar.ts'
import { generate } from '../src/lib/engine/generate.ts'
import { generateAlternativeDesign } from '../src/lib/engine/generateAlternativeDesign.ts'
import { createBuildingModel } from '../src/lib/engine/buildingModel.ts'
import { terraceLayout, terraceFreeRatio, TERRACE_LIMITS, tankBank } from '../src/lib/engine/terrace.ts'
import { buildSolarRoofModel, solarAllocationPolicySchema } from '../src/lib/solar/roofModel.ts'
import { realizedTerraceObjects } from '../src/lib/solar/terraceObjects.ts'
import { roofAccess } from '../src/lib/walkthrough/openingAssemblies.ts'
import { subtractRegions, intersectRegions, regionAreaM2, connectedRegions, insetRegions } from '../src/lib/solar/regions.ts'
import { rectUnionArea, rectUnionBBox } from '../src/lib/geometry.ts'
import { planToBlender, blenderToPlan, planToThreeGlb, threeGlbToPlan, trueAzimuthToPlan,
  planAzimuthToTrue, planAzimuthDirection, planToTrueNorthFrame, trueNorthFrameToPlan } from '../src/lib/solar/coordinates.ts'

const brief = defaultBrief(); brief.site.plotWidth = 25; brief.site.plotDepth = 30
const actual = generate(compile(brief)), architecture = generateAlternativeDesign(actual, 12)
const topSurface = m => m.surfaces.find(s => s.kind === 'flat-top-roof')
const issue = (model, code) => [...model.issues, ...model.surfaces.flatMap(s => s.issues)].some(i => i.code === code)
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} ≠ ${b}`)

// Contrived source contracts isolate roof topology/access. Production integration below
// uses a fully generated and validated architecture, rather than these unit fixtures.
function fixture({ plates = [{ x: 0, y: 0, w: 14000, h: 12000 }], courtyard = null,
  voids = [], stair = { rect: { x: 1000, y: 1000, w: 2000, h: 3000 }, direction: 'up', treads: [], startSide: 'S' }, roof = 'flat' } = {}) {
  const b = defaultBrief(); b.levels.storeys = 0; b.site.plotWidth = 25; b.site.plotDepth = 30
  const design = generate(compile(b)), floor = design.floors[0]
  floor.footprint = structuredClone(plates); floor.outline = rectUnionBBox(plates)
  floor.courtyard = courtyard; floor.doubleHeightVoids = voids
  floor.roof = { ...floor.roof, kind: roof }; floor.stair = stair
  floor.rooms = []; floor.shafts = []; floor.openings = []
  const building = createBuildingModel(design)
  const arch = { buildingModel: building,
    massingModel: { sourcePlanId: building.planId, seed: 7, status: 'valid', masses: [] },
    facadeGrammar: { sourcePlanId: building.planId, massingSeed: 7, status: 'valid', features: [] },
    villaDesignDNA: { roofType: roof === 'flat' ? 'flat-terrace' : 'gable' } }
  return { design, arch, building }
}
function checkExcluded(surface) {
  assert.equal(subtractRegions(surface.usableRegionsMm, surface.regionsMm).length, 0, 'Usable roof must lie on the actual surface')
  for (const e of surface.exclusions) assert.equal(intersectRegions(surface.usableRegionsMm, e.regionsMm).length, 0, e.id)
  close(regionAreaM2(surface.usableRegionsMm), surface.usableAreaM2)
  assert.ok(surface.maxSolarFootprintAreaM2 <= surface.usableAreaM2 + 1e-9)
}

test('exact rectangle unions preserve holes, eliminate overlaps and remain decomposition/order independent', () => {
  const source = [{ x: 0, y: 0, w: 10000, h: 10000 }, { x: 5000, y: 0, w: 10000, h: 10000 }]
  const hole = { x: 4000, y: 3000, w: 5000, h: 4000 }
  const regions = subtractRegions(source, [hole])
  close(regionAreaM2(regions), 130)
  assert.equal(intersectRegions(regions, [hole]).length, 0)
  close(regions.reduce((n, r) => n + r.w * r.h, 0), rectUnionArea(regions))
  assert.deepEqual(subtractRegions([...source].reverse(), [hole]), regions)
  assert.deepEqual(subtractRegions([{ x: 0, y: 0, w: 15000, h: 10000 }], [hole]), regions)
  const edged = insetRegions(regions, 600)
  assert.equal(intersectRegions(edged, [{ x: 3500, y: 2500, w: 6000, h: 5000 }]).length, 0)
  assert.throws(() => subtractRegions([{ x: 0, y: 0, w: NaN, h: 2 }]), /finite/)
})

test('real accepted villa yields usable top roof without changing architecture, historical terrace rule or identity', () => {
  const before = JSON.stringify([actual, architecture]), t = terraceLayout(actual), ratio = terraceFreeRatio(t)
  const model = buildSolarRoofModel(actual, { architecture }), top = topSurface(model)
  assert.equal(top.status, 'concept-usable'); assert.ok(top.usableAreaM2 > 0)
  assert.equal(model.sourcePlanId, architecture.buildingModel.planId)
  assert.equal(model.orientation.status, 'unknown'); assert.equal(model.orientation.planNorthBearingDeg, null)
  assert.equal(model.policy.minFreeTerraceRatio, .3); assert.equal(TERRACE_LIMITS.minFreeRatio, .8)
  close(terraceFreeRatio(t), ratio); assert.ok(ratio >= .8)
  assert.equal(JSON.stringify([actual, architecture]), before)
  checkExcluded(top)
  assert.ok(top.access.protectedRegionsMm.length)
  const approach = roofAccess(architecture.buildingModel)?.protectedAreaMm
  if (approach) assert.equal(intersectRegions(top.usableRegionsMm, [approach]).length, 0)
  assert.equal(model.surfaces.find(s => s.kind === 'balcony').status, 'excluded')
})

test('courtyards, double-height caps, shafts and explicitly supplied skylights remain excluded with inner edges', () => {
  const courtyard = { x: 5000, y: 5000, w: 2400, h: 2400 }, double = { x: 9000, y: 6000, w: 2000, h: 1800 }
  const f = fixture({ courtyard, voids: [{ rect: double, roomId: 'void', sourceRoomId: 'living' }] })
  f.design.floors[0].shafts = [{ id: 'vent', roomId: 'bath', rect: { x: 8000, y: 3000, w: 600, h: 600 }, stackedOver: null }]
  f.arch.buildingModel = createBuildingModel(f.design)
  f.arch.massingModel.sourcePlanId = f.arch.buildingModel.planId; f.arch.facadeGrammar.sourcePlanId = f.arch.buildingModel.planId
  const opening = { id: 'skylight-1', level: 0, kind: 'skylight', rectMm: { x: 9000, y: 8500, w: 1500, h: 1200 } }
  const model = buildSolarRoofModel(f.design, { architecture: f.arch, roofOpenings: [opening] }), top = topSurface(model)
  assert.equal(top.status, 'concept-usable')
  assert.deepEqual(top.holes.map(h => h.kind).sort(), ['courtyard', 'double-height', 'shaft', 'skylight'].sort())
  const holes = [courtyard, double, opening.rectMm, f.design.floors[0].shafts[0].rect]
  assert.equal(intersectRegions(top.regionsMm, holes).length, 0)
  assert.ok(top.edges.length > 4, 'Opening boundaries are explicit')
  checkExcluded(top)
})

test('full realized tank bank and its connected maintenance approach are protected', () => {
  const f = fixture(), model = buildSolarRoofModel(f.design, { architecture: f.arch }), top = topSurface(model)
  const bank = top.obstacles.find(o => o.kind === 'tank-bank')
  assert.deepEqual(bank.regionsMm, [tankBank(f.building.roofTerrace)])
  assert.ok(regionAreaM2(bank.regionsMm) > regionAreaM2([f.building.roofTerrace.tank]))
  assert.equal(top.access.status, 'modeled'); checkExcluded(top)
  assert.equal(intersectRegions(top.access.protectedRegionsMm, bank.regionsMm).length, 0)
})

test('TypeScript tankBank matches the actual Blender roof-services helper across expansions and obstructions', () => {
  const f = fixture(), terrace = f.building.roofTerrace
  const cases = [terrace,
    { ...terrace, tank: { x: 200, y: 200, w: 1100, h: 1100 }, mumty: { x: 1400, y: 200, w: 2200, h: 3000 } },
    { ...terrace, slab: [{ x: 0, y: 0, w: 1400, h: 1400 }], tank: { x: 150, y: 150, w: 1100, h: 1100 }, mumty: null },
    { ...terrace, tank: null }]
  const script = 'import sys,json;sys.path.insert(0,"blender");from geometry.roof_services import tank_bank;print(json.dumps([tank_bank(t) for t in json.load(sys.stdin)]))'
  const actualBanks = JSON.parse(execFileSync(process.env.PYTHON ?? 'python', ['-c', script], { cwd: fileURLToPath(new URL('..', import.meta.url)), input: JSON.stringify(cases), encoding: 'utf8' }))
  assert.deepEqual(actualBanks, cases.map(tankBank))
})

test('lower stepped terraces and source balconies are separate unsupported surfaces', () => {
  const model = buildSolarRoofModel(actual, { architecture })
  const lower = model.surfaces.find(s => s.kind === 'lower-terrace')
  assert.ok(lower); assert.equal(lower.status, 'excluded'); assert.deepEqual(lower.usableRegionsMm, [])
  assert.ok(lower.holes.some(h => h.kind === 'upper-storey'))
  const top = architecture.buildingModel.floors.at(-1)
  assert.equal(intersectRegions(lower.regionsMm, top.footprint).length, 0)
  for (const s of model.surfaces.filter(s => s.kind === 'balcony')) assert.equal(s.usableAreaM2, 0)
})

test('existing exporter furniture/parasol/planter positions match the shared roof obstacle extents', () => {
  const f = fixture(), buildings = [f.building, architecture.buildingModel]
  // Stub only drawing helpers. The real exporter still chooses free rectangles,
  // positions, object counts and planter locations. No Blender installation is needed.
  const script = `import sys,json,types
sys.path.insert(0,"blender")
covered=types.ModuleType("geometry.covered");covered._cylinder=lambda *a,**kw:None;sys.modules["geometry.covered"]=covered
landscape=types.ModuleType("visualization.landscape");sys.modules["visualization.landscape"]=landscape
import geometry.terrace_objects as objects
output=[]
for building,access in json.load(sys.stdin):
    result=[]
    def record(kind,w,h):
        def draw(scene,name,x,y,z,along_x,source):result.append({"id":name,"kind":kind,"rectMm":{"x":x-w/2,"y":y-h/2,"w":w,"h":h}})
        return draw
    objects._lounger=record("lounger",1900,650);objects._bench=record("bench",1600,420)
    objects._parasol=lambda scene,name,x,y,z,source:result.append({"id":name,"kind":"parasol","rectMm":{"x":x-1250,"y":y-1250,"w":2500,"h":2500}})
    landscape.planter=lambda scene,name,plan,seed,leaves:result.append({"id":name,"kind":"planter","rectMm":plan["rect"]})
    objects.create_terrace_objects(None,building,access);output.append(result)
print(json.dumps(output))`
  const fromExporter = JSON.parse(execFileSync(process.env.PYTHON ?? 'python', ['-c', script], { cwd: fileURLToPath(new URL('..', import.meta.url)), input: JSON.stringify(buildings.map(b=>[b,roofAccess(b)])), encoding: 'utf8' }))
  assert.deepEqual(fromExporter, buildings.map(b => realizedTerraceObjects(b).map(({ heightMm: _heightMm, ...record }) => record)))
  const model = buildSolarRoofModel(f.design, { architecture: f.arch }), top = topSurface(model)
  const objects = top.obstacles.filter(o => o.kind === 'terrace-object')
  assert.ok(objects.some(o => o.id === 'Terrace_Parasol'))
  for (const object of objects) assert.equal(intersectRegions(top.usableRegionsMm, object.regionsMm).length, 0)
})

test('roof islands do not gain access by sharing an outline or touching at a corner', () => {
  const f = fixture({ plates: [{ x: 10000, y: 0, w: 14000, h: 12000 }, { x: 0, y: 0, w: 6000, h: 8000 }],
    stair: { rect: { x: 11000, y: 1000, w: 2000, h: 3000 }, treads: [], direction: 'up', startSide: 'S' } })
  const model = buildSolarRoofModel(f.design, { architecture: f.arch }), top = topSurface(model)
  assert.equal(top.status, 'concept-usable'); assert.equal(top.components.length, 2)
  assert.equal(top.components.filter(c => c.access === 'unreachable').length, 1)
  assert.ok(top.accessibleClearAreaM2 < top.roofAreaM2 - 48, 'An inaccessible island cannot increase the solar allocation budget')
  assert.equal(intersectRegions(top.usableRegionsMm, [{ x: 0, y: 0, w: 6000, h: 8000 }]).length, 0)
  assert.ok(issue(model, 'DISCONNECTED_ROOF_REGION')); checkExcluded(top)
  assert.equal(connectedRegions([{ x: 0, y: 0, w: 1000, h: 1000 }, { x: 1000, y: 1000, w: 1000, h: 1000 }]).length, 2)
})

test('full-width access cannot cross a narrow neck; missing or obstructed exits stay explanatory', () => {
  const neck = [{ x: 0, y: 0, w: 5000, h: 5000 }, { x: 5000, y: 2200, w: 2000, h: 500 }, { x: 7000, y: 0, w: 5000, h: 5000 }]
  assert.equal(connectedRegions(subtractRegions(neck)).length, 1)
  assert.equal(connectedRegions(insetRegions(neck, 400)).length, 2)
  const f = fixture({ stair: undefined })
  delete f.design.floors[0].stair; f.arch.buildingModel = createBuildingModel(f.design)
  f.arch.massingModel.sourcePlanId = f.arch.buildingModel.planId; f.arch.facadeGrammar.sourcePlanId = f.arch.buildingModel.planId
  const model = buildSolarRoofModel(f.design, { architecture: f.arch })
  assert.equal(topSurface(model).status, 'uncertain'); assert.equal(model.usableAreaM2, 0); assert.ok(issue(model, 'ROOF_ACCESS_UNKNOWN'))
  const normal = fixture(), t = normal.building.roofTerrace.mumty
  const reserved = solarInputsSchema.parse({ reservedAreas: [{ id: 'blocks-door', level: 0, rectMm: { x: t.x - 500, y: t.y + t.h, w: t.w + 1000, h: 2000 } }] })
  const blocked = buildSolarRoofModel(normal.design, { architecture: normal.arch, inputs: reserved })
  assert.equal(blocked.usableAreaM2, 0); assert.ok(issue(blocked, 'ROOF_EXIT_BLOCKED'))
})

test('decorative overhead frames, solar shades and canopies cannot become panel-supporting surfaces', () => {
  const f = fixture(), roofZ = f.building.floors[0].heightMm
  const parts = [0, 3000].map((offset, i) => ({ id: `beam-${i}`, world: { x: 6000 + offset, y: 5000, w: 100, h: 3000, z: roofZ + 2300, height: 100 } }))
  f.arch.facadeGrammar.features.push({ id: 'shade', type: 'SOLAR_SHADE_ROOF', parts })
  const canopy = { id: 'canopy', floor: 0, sourceFloorId: f.building.floors[0].id, x: 10000, y: 5000, width: 2000, depth: 2000,
    rotation: 0, elevation: roofZ + 100, height: 200, usage: 'canopy' }
  f.arch.massingModel.masses.push(canopy)
  f.arch.facadeGrammar.coveredOutdoor = { sourcePlanId: f.building.planId, roofs: [{ id: 'porch', slabs: [{ x: 14000, y: 0, w: 3000, h: 3000 }] }] }
  const model = buildSolarRoofModel(f.design, { architecture: f.arch }), top = topSurface(model)
  const shade = top.obstacles.find(o => o.id === 'feature:shade')
  assert.equal(regionAreaM2(shade.regionsMm), 9.3, 'Space between sparse overhead beams is excluded conservatively')
  assert.equal(model.surfaces.find(s => s.kind === 'canopy').status, 'excluded')
  assert.equal(model.surfaces.find(s => s.id === 'porch:porch').status, 'excluded')
  assert.equal(intersectRegions(top.usableRegionsMm, shade.regionsMm).length, 0)
  checkExcluded(top)
})

test('unsupported pitched roofs, missing architecture and mismatched accepted sources fail closed', () => {
  const f = fixture({ roof: 'pitched' }), pitched = buildSolarRoofModel(f.design, { architecture: f.arch })
  assert.equal(pitched.usableAreaM2, 0); assert.ok(issue(pitched, 'SLOPING_ROOF_UNSUPPORTED'))
  const unknown = buildSolarRoofModel(actual)
  assert.equal(unknown.usableAreaM2, 0); assert.equal(topSurface(unknown).status, 'uncertain')
  const stale = structuredClone(architecture); stale.facadeGrammar.sourcePlanId = 'old-plan'
  assert.equal(buildSolarRoofModel(actual, { architecture: stale }).usableAreaM2, 0)
  const otherSeed = structuredClone(architecture); otherSeed.facadeGrammar.massingSeed++
  assert.equal(buildSolarRoofModel(actual, { architecture: otherSeed }).usableAreaM2, 0)
})

test('solar reservations and adjustable allocation policy change allocation without mutating the 80% rule or geometric roof signature', () => {
  const f = fixture(), before = JSON.stringify(f), a = buildSolarRoofModel(f.design, { architecture: f.arch })
  const inputs = solarInputsSchema.parse({ reservedAreas: [{ id: 'terrace-seating', level: 0, rectMm: { x: 6000, y: 7000, w: 2000, h: 2000 } }] })
  const b = buildSolarRoofModel(f.design, { architecture: f.arch, inputs, policy: { minFreeTerraceRatio: .6, edgeClearanceMm: 800 } })
  assert.equal(a.roofSignature, b.roofSignature); assert.notEqual(a.allocationSignature, b.allocationSignature)
  assert.ok(b.maxSolarFootprintAreaM2 < a.maxSolarFootprintAreaM2)
  assert.equal(intersectRegions(topSurface(b).usableRegionsMm, inputs.reservedAreas.map(r => r.rectMm)).length, 0)
  assert.equal(TERRACE_LIMITS.minFreeRatio, .8); assert.equal(JSON.stringify(f), before)
  checkExcluded(topSurface(b))
  const full = solarInputsSchema.parse({ reservedAreas: [{ id: 'all', level: 0, rectMm: f.design.floors[0].outline }] })
  const empty = buildSolarRoofModel(f.design, { architecture: f.arch, inputs: full })
  assert.equal(empty.usableAreaM2, 0); assert.ok(issue(empty, 'ROOF_FULLY_EXCLUDED'))
  const noBudget = buildSolarRoofModel(f.design, { architecture: f.arch, policy: { minFreeTerraceRatio: 1 } })
  assert.equal(noBudget.maxSolarFootprintAreaM2, 0); assert.ok(issue(noBudget, 'SOLAR_ALLOCATION_EMPTY'))
  const invalidRef = solarInputsSchema.parse({ reservedAreas: [{ id: 'old', roofSurfaceId: 'old-roof', level: 0, rectMm: { x: 6000, y: 7000, w: 2000, h: 2000 } }] })
  assert.equal(buildSolarRoofModel(f.design, { architecture: f.arch, inputs: invalidRef }).usableAreaM2, 0)
  assert.equal(solarAllocationPolicySchema.safeParse({ accessWidthMm: -1 }).success, false)
})

test('plan, Blender and accepted GLB coordinates round trip without guessing true north from road direction', () => {
  const p = { x: 12000, y: 5000, z: 6200 }
  assert.deepEqual(planToBlender(p), { x: 12, y: 5, z: 6.2 })
  assert.deepEqual(planToThreeGlb(p), { x: 12, y: 6.2, z: -5 })
  assert.deepEqual(blenderToPlan(planToBlender(p)), p); assert.deepEqual(threeGlbToPlan(planToThreeGlb(p)), p)
  assert.equal(trueAzimuthToPlan(180, null), null)
  assert.equal(trueAzimuthToPlan(180, 90), 90); assert.equal(planAzimuthToTrue(90, 90), 180)
  assert.equal(trueAzimuthToPlan(0, 45), 315)
  assert.equal(planToTrueNorthFrame(p, null), null)
  const truePoint = planToTrueNorthFrame(p, 90), back = trueNorthFrameToPlan(truePoint, 90)
  close(truePoint.eastMm, -5000); close(truePoint.northMm, -12000)
  close(back.x, p.x); close(back.y, p.y); close(back.z, p.z)
  const east = planAzimuthDirection(90); close(east.x, 1); close(east.y, 0)
  const north = planAzimuthDirection(0); close(north.x, 0); close(north.y, -1)
  assert.throws(() => planToThreeGlb({ x: Infinity, y: 0, z: 0 }), /finite/)
})
