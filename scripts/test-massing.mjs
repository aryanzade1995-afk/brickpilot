import assert from 'node:assert/strict'
import test from 'node:test'
import { defaultBrief } from '../src/lib/model/brief.ts'
import { compile } from '../src/lib/model/canonical.ts'
import { generate } from '../src/lib/engine/generate.ts'
import { validate } from '../src/lib/rules/index.ts'
import { createBuildingModel } from '../src/lib/engine/buildingModel.ts'
import { createVillaDesignDNA } from '../src/lib/engine/villaDesignDna.ts'
import { MassingGenerator } from '../src/lib/engine/massing/MassingGenerator.ts'
import { MASSING_FAMILIES } from '../src/lib/engine/massing/model.ts'
import { assessMassingFamilies, footprintTopology, uncoveredArea } from '../src/lib/engine/massing/families.ts'
import { massingSilhouetteSignature, validateMassing } from '../src/lib/engine/massing/validate.ts'
import { rectUnionBBox } from '../src/lib/geometry.ts'
import {
  massRect, splitMass, shiftMass, scaleMass, rotateMass, stackMass, stepBackMass,
  extendMass, recessMass, cantileverMass, bridgeMasses, createWing, subtractCourtyard,
  createEntranceVoid, createDoubleHeightVoid, createTerraceCut,
} from '../src/lib/engine/massing/transforms.ts'

const R = (x, y, w, h) => ({ x: x * 1000, y: y * 1000, w: w * 1000, h: h * 1000 })
const square = [R(2, 2, 12, 12)]
const l = [R(2, 2, 12, 4), R(2, 6, 4, 8)]
const u = [R(2, 10, 12, 4), R(2, 2, 4, 8), R(10, 2, 4, 8)]
const ring = [R(2, 2, 12, 3), R(2, 11, 12, 3), R(2, 5, 3, 6), R(11, 5, 3, 6)]
const cross = [R(6, 2, 4, 12), R(2, 6, 4, 4), R(10, 6, 4, 4)]

// These are geometry fixtures, not substitutes for the residential planner.
const buildingFor = (plates) => ({
  schemaVersion: 1, planId: JSON.stringify(plates), units: 'mm', coordinates: 'plan-x-east-y-south-z-up',
  plot: { widthMm: 40000, depthMm: 40000, buildable: R(1, 1, 38, 38) },
  floors: plates.map((footprint, level) => ({ id: `L${level}`, level, name: `Floor ${level}`,
    elevationMm: level * 3100, heightMm: 3100, outline: rectUnionBBox(footprint), footprint, courtyard: null })),
  rooms: plates.flatMap((rs, level) => rs.map((rect, i) => ({ id: `room${i}`, semanticId: `L${level}_R${i}`,
    floorId: `L${level}`, name: `Room ${i}`, zone: i % 2 ? 'private' : 'social', rect,
    area: rect.w * rect.h / 1e6, outdoor: false, wantsWindow: true }))),
  walls: [], doors: [], windows: [], stairs: [], columns: [], beams: [], slabs: [], shafts: [], supportZones: [],
  orientation: { entryCompass: 'S', roadPlanSide: 'S', plateAxis: 'x', mirrored: false, plateFamily: null },
  setbacks: { N: 1000, E: 1000, S: 1000, W: 1000 },
})
const run = (b, seed, family) => MassingGenerator.generate(b, createVillaDesignDNA(b, seed), { family })

test('all fifteen families accept matching plan geometry without inventing rooms or plates', () => {
  const fixtures = {
    L_SHAPED: buildingFor([l]), U_SHAPED: buildingFor([u]), COURTYARD: buildingFor([ring]),
    OFFSET_BLOCKS: buildingFor([square, [R(5, 3, 8, 10)]]),
    INTERLOCKING_BLOCKS: buildingFor([cross]), STACKED_VOLUMES: buildingFor([square, square]),
    STEPPED: buildingFor([square, [R(2, 2, 8, 12)]]), TWIN_WING: buildingFor([u]),
    CANTILEVERED: buildingFor([[R(4, 4, 8, 8)], [R(3, 4, 9, 8)]]),
    TERRACED: buildingFor([square, [R(2, 2, 8, 12)]]), LINEAR: buildingFor([[R(2, 2, 24, 6)]]),
    CLUSTERED: buildingFor([[R(2, 2, 6, 6), R(10, 2, 6, 6), R(18, 2, 6, 6)]]),
    SPLIT_VOLUME: buildingFor([[R(2, 2, 6, 8), R(12, 2, 6, 8)]]),
    PAVILION: buildingFor([square]), ASYMMETRIC: buildingFor([l]),
  }
  fixtures.CANTILEVERED.supportZones.push({ id: 'cantilever', floorId: 'L1', rect: R(3, 4, 1, 8), support: 'cantilever' })
  assert.deepEqual(Object.keys(fixtures), [...MASSING_FAMILIES])
  for (const family of MASSING_FAMILIES) {
    const b = fixtures[family], before = JSON.stringify(b), out = run(b, 42, family)
    assert.equal(out.status, 'valid', `${family}: ${JSON.stringify(out.issues)}`)
    assert.equal(out.family, family)
    assert.ok(out.masses.length > 0)
    assert.deepEqual(validateMassing(b, out.masses), [])
    for (const f of b.floors) {
      const occupied = out.masses.filter((m) => m.floor === f.level && m.usage === 'enclosed').map(massRect)
      assert.equal(uncoveredArea(f.footprint, occupied), 0, family)
      assert.equal(uncoveredArea(occupied, f.footprint), 0, family)
    }
    assert.equal(JSON.stringify(b), before)
  }
})

test('incompatible topology is rejected instead of stamping a family label on a box', () => {
  const b = buildingFor([square, square])
  for (const family of ['L_SHAPED', 'U_SHAPED', 'COURTYARD', 'CANTILEVERED', 'CLUSTERED', 'TWIN_WING']) {
    const out = run(b, 19, family)
    assert.equal(out.status, 'rejected', family)
    assert.equal(out.issues[0].code, 'INCOMPATIBLE_FAMILY')
    assert.deepEqual(out.masses, [])
    assert.equal(out.silhouetteSignature, null)
  }
  assert.equal(footprintTopology(ring).holes, 1)
  assert.equal(footprintTopology(u).holes, 0)
  assert.equal(footprintTopology(l).edges, 6)
})

test('real plan + seed is deterministic; changed seeds change actual orthographic silhouettes', () => {
  const brief = defaultBrief()
  brief.site.plotWidth = 18; brief.site.plotDepth = 24
  const plan = generate(compile(brief)), before = JSON.stringify(plan), b = createBuildingModel(plan)
  const first = run(b, 101)
  assert.equal(first.status, 'valid', JSON.stringify(first.issues))
  const signatures = new Set()
  const coarseProfiles = new Set()
  for (let seed = 1; seed <= 24; seed++) {
    const out = run(b, seed)
    assert.equal(out.status, 'valid', JSON.stringify(out.issues))
    assert.ok(out.familyAssessments.some((f) => f.family === out.family && f.compatible))
    assert.equal(out.silhouetteSignature, massingSilhouetteSignature(out.masses))
    signatures.add(out.silhouetteSignature)
    coarseProfiles.add(massingSilhouetteSignature(out.masses.map((m) => m.usage === 'roof'
      ? { ...m, height: Math.round(m.height / 500) * 500 } : m)))
  }
  assert.equal(signatures.size, 24, 'silhouettes must differ without counting labels, seeds or materials')
  assert.ok(coarseProfiles.size >= 8, 'variation must survive rounding roof heights to 500 mm')
  assert.deepEqual(run(b, 101), first, 'interleaved calls must not affect the seed')
  assert.equal(JSON.stringify(plan), before)
  const wrong = createVillaDesignDNA(b, 101)
  wrong.upperFloorOffset.xMm += 500
  assert.equal(MassingGenerator.generate(b, wrong).issues[0].code, 'DNA_PLAN_CONFLICT')
  assert.throws(() => MassingGenerator.generate(b, { ...wrong, sourcePlanId: 'another-plan' }), /different floor plan/)
  assert.ok(assessMassingFamilies(b).length === 15)
})

test('existing planner families, storeys, balconies and lift cores remain compatible', () => {
  for (const [family, storeys] of [['rectangular', 0], ['rectangular', 1], ['stepped', 2], ['l-shape', 1], ['courtyard', 1]]) {
    const brief = defaultBrief()
    brief.site.plotWidth = 25; brief.site.plotDepth = 25; brief.levels.storeys = storeys
    brief.levels.liftProvision = storeys === 2; brief.rooms.priorities.courtyard = family === 'courtyard'
    const plan = generate(compile(brief), { massing: family, seed: 41 })
    assert.ok(validate(plan).hardChecksPass, family)
    const b = createBuildingModel(plan), before = JSON.stringify(b)
    for (const seed of [7, 41, 101]) {
      const out = run(b, seed)
      assert.equal(out.status, 'valid', `${family}: ${JSON.stringify(out.issues)}`)
      assert.deepEqual(validateMassing(b, out.masses), [])
    }
    assert.equal(JSON.stringify(b), before, 'rooms, walls, openings and structure must stay untouched')
  }
})

const sampleMass = () => ({ id: 'a', floor: 0, x: 2000, y: 2000, width: 6000, depth: 4000, height: 3000,
  rotation: 0, role: 'primary', parentId: null, elevation: 0, usage: 'enclosed', sourceFloorId: 'L0', sourceRoomIds: ['L0_R0'] })
const volume = (m) => m.width * m.depth * m.height
const sumVolume = (ms) => ms.reduce((sum, m) => sum + volume(m), 0)

test('mass transformations have real geometry semantics and never mutate inputs', () => {
  const a = sampleMass(), before = structuredClone(a)
  const parts = splitMass(a, 'x', 0.25)
  assert.equal(sumVolume(parts), volume(a))
  assert.equal(parts[1].x, a.x + 1500)
  assert.equal(massingSilhouetteSignature(parts), massingSilhouetteSignature([a]))
  assert.deepEqual(massRect(rotateMass(a, 90)), R(3, 1, 4, 6))
  assert.deepEqual(massRect(rotateMass(rotateMass(a, 90), 270)), massRect(a))
  assert.equal(shiftMass(a, 1000, -500, 100).elevation, 100)
  assert.equal(volume(scaleMass(a, 2, 0.5, 2)), volume(a) * 2)
  assert.equal(stackMass(a).elevation, 3000)
  assert.equal(stackMass(a).parentId, a.id)
  assert.deepEqual(massRect(stepBackMass(a, 'N', 1000)), R(2, 3, 6, 3))
  assert.deepEqual(massRect(recessMass(a, 'E', 1000)), R(2, 2, 5, 4))
  assert.deepEqual(massRect(extendMass(a, 'S', 1000)), R(2, 2, 6, 5))
  assert.deepEqual(massRect(cantileverMass(a, 'W', 1000)), R(1, 2, 7, 4))
  assert.deepEqual(massRect(createWing(a, 'S', 2000, 3000)), R(4, 6, 2, 3))
  const b = { ...shiftMass(a, 10000, 0), id: 'b' }
  assert.deepEqual(massRect(bridgeMasses(a, b, 1000)), R(8, 3.5, 4, 1))
  assert.deepEqual(a, before)
  assert.throws(() => rotateMass(a, 45), /orthogonal/)
  assert.throws(() => splitMass(a, 'x', 1), /ratio/)
  assert.throws(() => stepBackMass(a, 'N', 5000), /Invalid/)
  assert.throws(() => scaleMass(a, -1, 1), /positive/)
})

test('courtyard, entry, double-height and terrace operations subtract actual volume', () => {
  const a = sampleMass(), cut = R(4, 3, 1, 1)
  const court = subtractCourtyard([a], cut)
  assert.equal(sumVolume(court), volume(a) - 1e6 * 3000)
  assert.equal(footprintTopology(court.map(massRect)).holes, 1)
  assert.equal(sumVolume(createEntranceVoid(a, { ...cut, elevation: 0, height: 2100 })), volume(a) - 1e6 * 2100)
  assert.equal(sumVolume(createTerraceCut(a, cut, 500)), volume(a) - 1e6 * 500)
  const upper = stackMass(a)
  assert.equal(sumVolume(createDoubleHeightVoid([a, upper], cut, 0, 6000)), volume(a) * 2 - 1e6 * 6000)
  const renamed = court.map((m) => ({ ...m, id: `renamed-${m.id}`, role: 'secondary' }))
  assert.equal(massingSilhouetteSignature(court), massingSilhouetteSignature(renamed))
  assert.notEqual(massingSilhouetteSignature([a]), massingSilhouetteSignature(court))
})

test('plan validation refuses destructive occupied-volume transforms and unsupported roof volumes', () => {
  const b = buildingFor([square])
  const out = run(b, 3, 'PAVILION')
  assert.equal(out.status, 'valid')
  const enclosed = out.masses.find((m) => m.usage === 'enclosed')
  const alter = (replacement) => out.masses.flatMap((m) => m.id === enclosed.id ? replacement : [m])
  for (const changed of [
    [shiftMass(enclosed, 100, 0)], [stepBackMass(enclosed, 'S', 500)],
    createEntranceVoid(enclosed, { ...R(4, 4, 1, 1), elevation: 0, height: 2200 }),
  ]) assert.ok(validateMassing(b, alter(changed)).some((i) => i.code === 'PLAN_FOOTPRINT_CHANGED'))
  const roof = out.masses.find((m) => m.usage === 'roof')
  assert.ok(validateMassing(b, out.masses.map((m) => m === roof ? shiftMass(m, 10000, 0) : m))
    .some((i) => i.code === 'UNSUPPORTED_ROOF'))
})
