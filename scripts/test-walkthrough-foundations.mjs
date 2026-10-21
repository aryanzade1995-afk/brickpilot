import test from 'node:test'
import assert from 'node:assert/strict'
import { defaultBrief } from '../src/lib/model/brief.ts'
import { compile } from '../src/lib/model/canonical.ts'
import { generate } from '../src/lib/engine/generate.ts'
import { createBuildingModel } from '../src/lib/engine/buildingModel.ts'
import { validate } from '../src/lib/rules/index.ts'
import { estimateBoq } from '../src/lib/cost/boq.ts'
import { finishSignature } from '../src/lib/cost/finishAssignments.ts'
import { interiorFinishes } from '../src/lib/interior/finishes.ts'
import { roomFurnishing } from '../src/lib/interior/preview.ts'
import { createWalkthroughSource, walkthroughRoomKey, assessWalkthroughAsset } from '../src/lib/walkthrough/source.ts'
import { resolveWalkthroughRoomAssets } from '../src/lib/walkthrough/roomAssets.ts'
import { roomLocalToWalkthrough, walkthroughToRoomLocal, planToThreeGlb, planToBlender } from '../src/lib/walkthrough/coordinates.ts'

const brief = defaultBrief(); brief.site.plotWidth = 18; brief.site.plotDepth = 24; brief.levels.storeys = 1
const design = generate(compile(brief), { seed: 41 }), report = validate(design)
assert.ok(report.hardChecksPass)
const preferences = { style: 'modern', lighting: 'warm', furnitureDensity: 'medium' }
const source = createWalkthroughSource(design, report, preferences)
const changed = overrides => ({ ...design, model: { ...design.model, brief: { ...brief, specs: { overrides } } } })

test('records the entire validated source without altering geometry, seed, or cost', () => {
  const before = JSON.stringify(design), price = estimateBoq(design).expected
  assert.deepEqual(source.building, createBuildingModel(design))
  assert.equal(source.rooms.length, design.floors.reduce((n, f) => n + f.rooms.length, 0))
  assert.ok(source.rooms.some(r => design.floors.find(f => f.prefix === r.floorId)?.rooms.find(x => x.id === r.sourceRoomId)?.zone === 'circulation'))
  assert.equal(source.viewerReady, false); assert.equal(source.phase, 'foundations')
  assert.deepEqual(JSON.parse(JSON.stringify(source)), source)
  const copy = createWalkthroughSource(design, report, preferences)
  copy.building.rooms[0].rect.x += 500; copy.floors[0].footprintMm[0].w += 300
  assert.equal(JSON.stringify(design), before); assert.equal(estimateBoq(design).expected, price)
})

test('uses real floor elevations and Blender/glTF coordinates, not centred or exploded study coordinates', () => {
  assert.deepEqual(planToBlender({ x: 3500, y: 7200, z: 3150 }), { x: 3.5, y: 7.2, z: 3.15 })
  assert.deepEqual(planToThreeGlb({ x: 3500, y: 7200, z: 3150 }), { x: 3.5, y: 3.15, z: -7.2 })
  for (const floor of source.building.floors) {
    const room = source.building.rooms.find(r => r.floorId === floor.id), p = [.2, 1.6, -.3]
    const world = roomLocalToWalkthrough(p, room, floor), local = walkthroughToRoomLocal(world, room, floor)
    local.forEach((v, i) => assert.ok(Math.abs(v - p[i]) < 1e-10))
    assert.equal(world[1], floor.elevationMm / 1000 + 1.6)
  }
  assert.throws(() => planToThreeGlb({ x: NaN, y: 0, z: 0 }), /finite/)
})

test('finish edits invalidate appearance only; furniture preferences have their own identity', () => {
  const updated = createWalkthroughSource(changed({ 'kitchen-counter': 'granite' }), report, preferences)
  assert.equal(updated.geometryKey, source.geometryKey); assert.notEqual(updated.appearanceKey, source.appearanceKey)
  const styled = createWalkthroughSource(design, report, { ...preferences, furnitureDensity: 'low' })
  assert.equal(styled.geometryKey, source.geometryKey); assert.notEqual(styled.appearanceKey, source.appearanceKey)
})

test('only recorded doors form links, with no invented nearest-room connections or window passages', () => {
  assert.equal(source.portals.length, source.building.doors.length)
  assert.ok(source.portals.every(p => !source.building.windows.some(w => w.id === p.openingId)))
  for (const portal of source.portals.filter(p => p.state === 'source-linked')) {
    assert.ok(portal.hostWallId); assert.equal(portal.traversal, 'not-evaluated')
    for (const key of portal.rooms) if (key) assert.ok(source.rooms.some(r => r.key === key))
  }
  const broken = structuredClone(design), door = broken.floors[0].openings.find(o => o.kind !== 'window')
  door.rooms = ['missing-room', null]
  const result = createWalkthroughSource(broken, report, preferences)
  const unresolved = result.portals.find(p => p.openingId === door.id && p.floorId === broken.floors[0].prefix)
  assert.equal(unresolved.state, 'needs-review'); assert.equal(unresolved.rooms, null)
  assert.ok(result.issues.some(i => i.code === 'DOOR_CONNECTION_UNRESOLVED'))
})

test('voids and incomplete stairs are recorded explicitly; no traversal or slab cutout is fabricated', () => {
  const modified = structuredClone(design), floor = modified.floors[0], rect = { x: 5000, y: 5000, w: 2000, h: 2000 }
  floor.courtyard = rect
  modified.floors[1].doubleHeightVoids = [{ rect, sourceRoomId: floor.rooms[0].semanticId, roomId: 'gallery' }]
  floor.stair.treads = []; delete floor.stair.startSide
  const result = createWalkthroughSource(modified, report, preferences)
  assert.ok(result.floors[0].exclusions.some(v => v.kind === 'courtyard' && v.rectMm.w === 2000))
  assert.ok(result.floors[1].exclusions.some(v => v.kind === 'double-height'))
  assert.ok(result.stairs.every(s => s.traversal === 'pending'))
  assert.equal(result.stairs.find(s => s.floorId === floor.prefix).sourceState, 'unsupported')
  assert.ok(result.floors.every(f => f.stairCutouts === 'pending-source-stair-adapter'))
  delete floor.stair
  assert.ok(createWalkthroughSource(modified, report, preferences).issues.some(i => i.code === 'STAIR_SOURCE_MISSING'))
})

test('invalid plans and mismatched accepted architecture cannot prepare room assets', () => {
  const rejected = createWalkthroughSource(design, { hardChecksPass: false }, preferences)
  assert.equal(rejected.state, 'blocked')
  assert.equal(resolveWalkthroughRoomAssets(design, rejected, source.rooms[0].key).state, 'stale-or-blocked')
  const oldBuilding = { ...source.building, planId: 'old-plan' }
  assert.equal(createWalkthroughSource(design, report, preferences, oldBuilding).state, 'blocked')
})

test('on-demand room assets reuse selected products and the existing room furnishing system', () => {
  const selected = changed({ 'kitchen-counter': 'granite', switches: 'svc-switches-1' })
  const before = JSON.stringify(selected), price = estimateBoq(selected).expected
  const current = createWalkthroughSource(selected, report, preferences)
  const floor = selected.floors.find(f => f.rooms.some(r => /^kitchen/.test(r.id))), room = floor.rooms.find(r => /^kitchen/.test(r.id))
  const key = walkthroughRoomKey(floor.prefix, room.id), assets = resolveWalkthroughRoomAssets(selected, current, key)
  assert.equal(assets.state, 'resolved')
  assert.deepEqual(assets.finishes, interiorFinishes(selected, floor.level, room.id))
  assert.equal(assets.finishes.counter.name, 'Granite')
  assert.equal(assets.finishes.specifications.find(s => s.item === 'switches').optionId, 'svc-switches-1')
  const furnishing = roomFurnishing(selected, floor.level, room.id, preferences.furnitureDensity)
  assert.ok(furnishing.furniture.length > 0); assert.ok(assets.furnishing.boxes.length > 0)
  assert.equal(resolveWalkthroughRoomAssets(design, current, key).state, 'stale-or-blocked')
  const otherFloor = source.building.floors[1]
  assert.notEqual(key, walkthroughRoomKey(otherFloor.id, room.id))
  assert.equal(JSON.stringify(selected), before); assert.equal(estimateBoq(selected).expected, price)
})

test('unsupported double-height isolation retains finishes without inventing a room shell', () => {
  const modified = structuredClone(design), floor = modified.floors[0], room = floor.rooms.find(r => /^living/.test(r.id))
  modified.floors[1].doubleHeightVoids = [{ rect: { ...room.rect }, sourceRoomId: room.semanticId, roomId: 'gallery' }]
  const current = createWalkthroughSource(modified, report, preferences)
  const assets = resolveWalkthroughRoomAssets(modified, current, walkthroughRoomKey(floor.prefix, room.id))
  assert.equal(assets.state, 'furnishing-unavailable'); assert.ok(assets.finishes)
  assert.equal(assets.furnishing, undefined)
})

test('an exterior GLB never implies a complete interior and stale assets are rejected', () => {
  assert.equal(assessWalkthroughAsset(source, design), 'missing')
  assert.equal(assessWalkthroughAsset(source, design, { planId: 'other', files: { glb: '/model.glb' } }), 'different-plan')
  assert.equal(assessWalkthroughAsset(source, design, { planId: source.building.planId, files: { glb: '/model.glb' } }), 'finishes-out-of-date')
  assert.equal(assessWalkthroughAsset(source, design, { planId: source.building.planId, finishSignature: finishSignature(brief), files: { glb: '/model.glb' } }), 'candidate-needs-interior-audit')
})
