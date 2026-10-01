import assert from 'node:assert/strict'
import test from 'node:test'
import { defaultBrief } from '../src/lib/model/brief.ts'
import { compile } from '../src/lib/model/canonical.ts'
import { generate } from '../src/lib/engine/generate.ts'
import { validate } from '../src/lib/rules/index.ts'
import { createBuildingModel } from '../src/lib/engine/buildingModel.ts'
import { createVillaDesignDNA } from '../src/lib/engine/villaDesignDna.ts'
import { MassingGenerator } from '../src/lib/engine/massing/MassingGenerator.ts'
import { ArchitectureValidator } from '../src/lib/engine/massing/ArchitectureValidator.ts'
import { shiftMass } from '../src/lib/engine/massing/transforms.ts'

const brief = defaultBrief()
const source = generate(compile(brief), { seed: 41 })
assert.ok(validate(source).hardChecksPass)
const building = createBuildingModel(source)
const candidate = MassingGenerator.generate(building, createVillaDesignDNA(building, 41))
assert.equal(candidate.status, 'valid', JSON.stringify(candidate.issues))
const codeSet = (b, masses = candidate.masses, limits) =>
  new Set(ArchitectureValidator.validate(b, masses, limits).issues.map((issue) => issue.code))

test('a verified source plan and candidate pass the complete architecture gate', () => {
  const before = JSON.stringify(building)
  const report = ArchitectureValidator.validate(building, candidate.masses)
  assert.deepEqual(report, { valid: true, issues: [] })
  assert.deepEqual(candidate.architectureReport, report)
  assert.ok(candidate.attemptsTried >= 1 && candidate.attemptsTried <= 8)
  assert.equal(JSON.stringify(building), before)
})

test('room loss, blocked outdoor circulation and unsupported roof are rejected', () => {
  const occupied = candidate.masses.find((m) => m.usage === 'enclosed' && m.floor === 0)
  const moved = candidate.masses.map((m) => m === occupied ? shiftMass(m, 500, 0) : m)
  assert.ok(codeSet(building, moved).has('ROOM_DESTROYED'))
  const outside = structuredClone(building)
  const parking = outside.rooms.find((r) => r.id === 'parking')
  parking.rect = { ...outside.floors[0].footprint[0] }
  assert.ok(codeSet(outside).has('OUTDOOR_ACCESS_BLOCKED'))
  const roof = candidate.masses.find((m) => m.usage === 'roof')
  assert.ok(codeSet(building, candidate.masses.map((m) => m === roof ? shiftMass(m, 3000, 0) : m))
    .has('UNSUPPORTED_ROOF'))
})

test('stair, column, slab, beam and cantilever concept limits are checked', () => {
  const stair = structuredClone(building)
  stair.stairs.at(-1).rect.x += 200
  assert.ok(codeSet(stair).has('STAIR_DISCONNECTED'))
  const column = structuredClone(building)
  column.columns.find((c) => c.floorId === column.floors.at(-1).id).at.x += 250
  assert.ok(codeSet(column).has('COLUMN_MISALIGNED'))
  const slab = structuredClone(building)
  slab.slabs[0].rect.w -= 500
  assert.ok(codeSet(slab).has('INVALID_SLAB'))
  const beam = structuredClone(building)
  beam.beams[0].span = 9000
  assert.ok(codeSet(beam).has('INVALID_BEAM'))
  assert.ok(codeSet(building, candidate.masses, { maxCantileverMm: 300 })
    .has('BALCONY_CANTILEVER_EXCEEDED'))
})

test('balcony access and its exact floor slab are required', () => {
  const balcony = building.rooms.find((r) => r.id.startsWith('balcony'))
  assert.ok(balcony)
  const noDoor = structuredClone(building)
  noDoor.doors = noDoor.doors.filter((d) => !d.rooms?.includes(balcony.id))
  assert.ok(codeSet(noDoor).has('BALCONY_INACCESSIBLE'))
  const noSlab = candidate.masses.filter((m) => m.usage !== 'terrace')
  assert.ok(codeSet(building, noSlab).has('BALCONY_SLAB_MISSING'))
})

test('windows and doors stay on valid walls without column or opening collisions', () => {
  const wrongDoor = structuredClone(building)
  wrongDoor.doors.find((d) => d.kind === 'door').at.x += 2000
  assert.ok(codeSet(wrongDoor).has('DOOR_INACCESSIBLE'))
  const blockedWindow = structuredClone(building)
  const window = blockedWindow.windows[0]
  const column = blockedWindow.columns.find((c) => c.floorId === window.floorId)
  column.at = { ...window.at }
  assert.ok(codeSet(blockedWindow).has('OPENING_ON_COLUMN'))
  const overlap = structuredClone(building)
  overlap.windows.push({ ...structuredClone(overlap.windows[0]), id: 'EXTRA_WINDOW' })
  assert.ok(codeSet(overlap).has('OPENINGS_OVERLAP'))
  const missingWall = structuredClone(building)
  missingWall.windows[0].at.x = -100
  assert.ok(codeSet(missingWall).has('EXTERIOR_OPENING_LOST'))
})

test('thin and overlapping mass fragments cannot reach the geometry stage', () => {
  const roof = candidate.masses.find((m) => m.usage === 'roof')
  const thin = candidate.masses.map((m) => m === roof ? { ...m, width: 100 } : m)
  assert.ok(codeSet(building, thin).has('THIN_VOLUME'))
  const duplicate = [...candidate.masses, { ...roof, id: `${roof.id}-copy` }]
  assert.ok(codeSet(building, duplicate).has('MASS_INTERSECTION'))
})

test('invalid operation is discarded and the next deterministic variation is tried', () => {
  const roof = candidate.masses.find((m) => m.usage === 'roof')
  const before = JSON.stringify(candidate.masses)
  const create = (attempt) => attempt === 0
    ? [...candidate.masses, { ...roof, id: `${roof.id}-collision` }]
    : candidate.masses
  const retry = ArchitectureValidator.tryVariations(building, 3, create)
  assert.equal(retry.report.valid, true)
  assert.equal(retry.attemptsTried, 2)
  assert.deepEqual(retry.masses, candidate.masses)
  const rejected = ArchitectureValidator.tryVariations(building, 1, create)
  assert.equal(rejected.report.valid, false)
  assert.deepEqual(rejected.masses, [])
  assert.ok(rejected.report.issues.some((issue) => issue.code === 'MASS_INTERSECTION'))
  assert.equal(JSON.stringify(candidate.masses), before)
})

test('an empty candidate cannot pass the export gate', () => {
  const codes = codeSet(building, [])
  assert.ok(codes.has('NO_MASSES'))
  assert.ok(codes.has('ROOM_DESTROYED'))
})

test('export guard revalidates cached results after an edit', () => {
  assert.deepEqual(ArchitectureValidator.assertReadyForGeometry(building, candidate), candidate.masses)
  const changed = structuredClone(candidate)
  changed.masses[0].x += 500
  assert.throws(() => ArchitectureValidator.assertReadyForGeometry(building, changed), /Architecture validation failed/)
  assert.throws(() => ArchitectureValidator.assertReadyForGeometry(building,
    { ...candidate, sourcePlanId: 'different-plan' }), /has not passed/)
})
