import test from 'node:test'
import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import RAPIER from '@dimforge/rapier3d-compat'
import { defaultBrief } from '../src/lib/model/brief.ts'
import { compile } from '../src/lib/model/canonical.ts'
import { generate } from '../src/lib/engine/generate.ts'
import { createBuildingModel } from '../src/lib/engine/buildingModel.ts'
import { stairRun } from '../src/lib/engine/planner/elements.ts'
import { buildWalkthroughScene } from '../src/lib/walkthrough/scene.ts'
import { prepareWalkthroughGeometry, furnitureColliders } from '../src/lib/walkthrough/delivery.ts'
import { prepareWalkthroughRequest } from '../server/walkthrough-assets.mjs'
import { HouseWalkingSimulation, initializeWalkingPhysics, WALKING, validateNavigationBundle } from '../src/lib/walkthrough/navigation.ts'

await initializeWalkingPhysics()
const brief = defaultBrief(); brief.site.plotWidth = 18; brief.site.plotDepth = 24
const design = generate(compile(brief), { seed: 41 }), base = createBuildingModel(design)

/** Explicit source fixture: an interior dog-leg stair with a real approach hall,
 * two floors, source landings and a 600mm doorway. No navigation-only ramps.
 */
function sourceHouse(side = 'N') {
  const b = structuredClone(base), outline = { x: 0, y: 0, w: 12000, h: 12000 }, alongY = side === 'N' || side === 'S'
  const stair = { x: 1000, y: 2000, w: alongY ? 2400 : 3300, h: alongY ? 3300 : 2400 }
  for (const k of ['floors', 'rooms', 'walls', 'doors', 'windows', 'stairs', 'columns', 'beams', 'slabs', 'shafts', 'supportZones']) b[k] = []
  b.planId = 'physics-source-house'
  for (let level = 0; level < 2; level++) {
    const id = `F${level}`
    b.floors.push({ ...structuredClone(base.floors[0]), id, level, elevationMm: level * 3000, heightMm: 3000, slabThicknessMm: 150,
      footprint: [{ ...outline }], outline: { ...outline }, courtyard: null, doubleHeightVoids: [] })
    for (const [name, rect] of [['entryhall', { x: 7000, y: 0, w: 5000, h: 12000 }], ['hall', { x: 0, y: 0, w: 7000, h: 2000 }], ['stair', stair]])
      b.rooms.push({ id: name, semanticId: `${id}_${name}`, floorId: id, name, rect: { ...rect }, outdoor: false, zone: 'circulation', area: rect.w * rect.h / 1e6, wantsWindow: false })
    for (const [side, a, c] of [['N', { x: 0, y: 0 }, { x: 12000, y: 0 }], ['E', { x: 12000, y: 0 }, { x: 12000, y: 12000 }], ['S', { x: 0, y: 12000 }, { x: 12000, y: 12000 }], ['W', { x: 0, y: 0 }, { x: 0, y: 12000 }]])
      b.walls.push({ id: `${id}_${side}`, floorId: id, a, b: c, thickness: 200, kind: 'exterior', rooms: ['entryhall', null] })
    b.walls.push({ id: `${id}_partition`, floorId: id, a: { x: 7000, y: 0 }, b: { x: 7000, y: 12000 }, thickness: 100, kind: 'interior', rooms: ['entryhall', 'hall'] })
    b.doors.push({ id: `${id}_narrow_door`, floorId: id, kind: 'door', orient: 'v', at: { x: 7000, y: 1000 }, width: 600, head: 2100, hinge: 'a', swing: 1, rooms: ['entryhall', 'hall'] })
    b.slabs.push({ id: `${id}_slab`, floorId: id, rect: { ...outline }, topMm: level * 3000, thicknessMm: 150 })
    b.stairs.push({ id: `${id}_stair`, floorId: id, ...stairRun(stair, side, 9, 250) })
  }
  b.doors.push({ id: 'MAIN_DOOR', floorId: 'F0', kind: 'entry', orient: 'v', at: { x: 12000, y: 1000 }, width: 1000, rooms: ['entryhall', null] })
  b.roofTerrace = { level: 1, slab: [{ ...outline }], outline: { ...outline }, mumty: null, tank: null, pergola: null, freeRatio: 1 }
  return b
}
function bundle(building = sourceHouse()) {
  const scene = buildWalkthroughScene(building, { hardChecksPass: true })
  assert.notEqual(scene.status, 'unsupported', JSON.stringify(scene.issues))
  const g = prepareWalkthroughGeometry(scene), ids = { designId: building.planId, projectId: 'physics', geometryKey: 'geometry', appearanceKey: 'appearance' }
  return { metadata: { ...g.metadata, ...ids }, collision: { ...g.collision, ...ids }, scene }
}
const sample = bundle()
const create = (data = sample) => new HouseWalkingSimulation(structuredClone(data.metadata), structuredClone(data.collision))
const stationary = { forward: 0, right: 0, yaw: 0 }
test('finish collision replacement preserves standing position and doors, reporting blocked occupants without respawn', () => {
  const sim = create()
  try {
    const feet = { ...sim.feet }, doors = [...sim.doors.values()].map(d => d.collider.handle)
    assert.equal(sim.replaceFurnishing([]), true); assert.deepEqual(sim.feet, feet)
    const box = { id: 'new-selected-product', kind: 'furniture-aabb', floorId: 'F0', sourceIds: ['selected-product'], min: [feet.x - .3, feet.y + .1, feet.z - .3], max: [feet.x + .3, feet.y + 1, feet.z + .3] }
    assert.equal(sim.replaceFurnishing([box]), false); assert.deepEqual(sim.feet, feet)
    assert.deepEqual([...sim.doors.values()].map(d => d.collider.handle), doors)
    assert.equal(sim.replaceFurnishing([]), true); assert.deepEqual(sim.feet, feet)
  } finally { sim.dispose() }
})
function walkTo(sim, x, z, max = 1200, tolerance = .045) {
  for (let i = 0; i < max; i++) {
    const dx = x - sim.feet.x, dz = z - sim.feet.z
    if (Math.hypot(dx, dz) < tolerance) { sim.pause(); return }
    sim.step({ forward: Math.min(1, Math.hypot(dx, dz) * 6), right: 0, yaw: Math.atan2(-dx, -dz) })
  }
  assert.fail(`Could not walk to ${x}, ${z}: ${JSON.stringify({ feet: sim.feet, grounded: sim.grounded, blocked: sim.blocked })}`)
}
const centre = r => ({ x: (r.x + r.w / 2) / 1000, z: -(r.y + r.h / 2) / 1000 })

test('main-entrance spawn is grounded, human height, source-associated; stale/corrupt data is refused', () => {
  const sim = create()
  try {
    assert.match(sim.spawn.openingId, /MAIN_DOOR/); assert.equal(sim.grounded, true)
    assert.ok(Math.abs(sim.eye.y - sim.feet.y - WALKING.eye) < .02)
    assert.throws(() => validateNavigationBundle(sample.metadata, { ...sample.collision, designId: 'other' }, sample.metadata.designId), /does not match/)
    const corrupt = structuredClone(sample); corrupt.collision.colliders[0].min[0] = NaN
    assert.throws(() => create(corrupt), /invalid/)
  } finally { sim.dispose() }
})

test('smooth acceleration/deceleration and normalized diagonal speed are deterministic across frame rates', () => {
  const a = create(), b = create()
  try {
    a.step({ forward: 1, right: 0, yaw: Math.PI / 2 }); assert.ok(Math.abs(a.velocity.x) < WALKING.speed * .5)
    for (let i = 1; i < 60; i++) a.step({ forward: 1, right: 0, yaw: Math.PI / 2 })
    for (let i = 0; i < 120; i++) b.advance({ forward: 1, right: 0, yaw: Math.PI / 2 }, 1 / 120)
    assert.ok(Math.abs(a.feet.x - b.feet.x) < .002)
    const speed = Math.hypot(a.velocity.x, a.velocity.z); for (let i = 0; i < 30; i++) a.step(stationary)
    assert.ok(Math.hypot(a.velocity.x, a.velocity.z) < speed * .01)
    a.advance({ forward: 1, right: 1, yaw: 0 }, 10); assert.ok(Math.hypot(a.velocity.x, a.velocity.z) <= WALKING.speed + 1e-5)
  } finally { a.dispose(); b.dispose() }
})

test('closed door blocks; explicit opening permits the same capsule through a 600mm doorway; closing cannot trap the character', () => {
  const sim = create(), door = sample.metadata.openings.find(o => o.sourceId === 'F0_narrow_door')
  try {
    for (let i = 0; i < 300; i++) sim.step({ forward: 1, right: 0, yaw: Math.PI / 2 })
    assert.ok(sim.feet.x > 7.22, 'closed leaf blocks the capsule')
    sim.toggleDoor(door.id); for (let i = 0; i < 30; i++) sim.step(stationary)
    walkTo(sim, 7, -1)
    sim.toggleDoor(door.id); for (let i = 0; i < 30; i++) sim.step(stationary)
    assert.ok(sim.getDoorPose(door.id).angle > .1, 'close animation cannot intersect the character')
    sim.toggleDoor(door.id); for (let i = 0; i < 30; i++) sim.step(stationary)
    walkTo(sim, 6.3, -1)
    assert.ok(sim.feet.x < 6.4)
  } finally { sim.dispose() }
})

for (const side of ['N', 'S', 'E', 'W']) test(`actual source dog-leg treads, turning landing and destination slab are walked up/down without a floor warp: ${side}`, () => {
  const data = bundle(sourceHouse(side)), sim = create(data), door = data.metadata.openings.find(o => o.sourceId === 'F0_narrow_door'), stair = data.metadata.stairs[0]
  let previous = { ...sim.feet }, maxChange = 0
  const originalStep = sim.step.bind(sim)
  sim.step = input => { originalStep(input); maxChange = Math.max(maxChange, Math.abs(sim.feet.y - previous.y)); previous = { ...sim.feet } }
  try {
    sim.toggleDoor(door.id); for (let i = 0; i < 30; i++) sim.step(stationary)
    walkTo(sim, 6.3, -1)
    const steps = [...stair.steps].sort((a, b) => a.topMm - b.topMm)
    const first = centre(steps[0].rectMm), second = centre(steps[1].rectMm), len = Math.hypot(second.x - first.x, second.z - first.z)
    const approach = { x: first.x - (second.x - first.x) / len * .55, z: first.z - (second.z - first.z) / len * .55 }
    if (side === 'W') walkTo(sim, approach.x, -1); else walkTo(sim, 6.3, approach.z)
    walkTo(sim, approach.x, approach.z)
    const waypoints = steps.map(t => ({ ...centre(t.rectMm), y: t.topMm / 1000 }))
    const half = waypoints.findIndex(p => p.y > stair.midLanding.topMm / 1000)
    const mid = centre(stair.midLanding.rectMm)
    const alongX = side === 'E' || side === 'W'
    waypoints.splice(half, 0,
      { x: alongX ? mid.x : waypoints[half - 1].x, z: alongX ? waypoints[half - 1].z : mid.z, y: stair.midLanding.topMm / 1000 },
      { x: alongX ? mid.x : waypoints[half].x, z: alongX ? waypoints[half].z : mid.z, y: stair.midLanding.topMm / 1000 })
    const last = waypoints.at(-1), landing = centre(stair.destinationLandingMm)
    const destination = { x: last.x - (second.x - first.x) / len * .55, z: last.z - (second.z - first.z) / len * .55, y: 3 }
    // Exit the last flight forward onto the retained source landing and floor.
    const lastStep = centre(steps.at(-1).rectMm)
    destination.x = lastStep.x - (second.x - first.x) / len * .55
    destination.z = lastStep.z - (second.z - first.z) / len * .55
    waypoints.push({ x: alongX ? landing.x : last.x, z: alongX ? last.z : landing.z, y: stair.destinationElevationMm / 1000 }, destination)
    for (const p of waypoints) { walkTo(sim, p.x, p.z); assert.ok(Math.abs(sim.feet.y - p.y) < .24, JSON.stringify({ at: sim.feet, expected: p })) }
    assert.equal(sim.floorId, 'F1'); assert.ok(sim.feet.y > 2.98)
    for (const p of waypoints.slice(0, -1).reverse()) walkTo(sim, p.x, p.z)
    walkTo(sim, approach.x, approach.z)
    assert.ok(sim.feet.y < .03); assert.equal(sim.floorId, 'F0')
    assert.ok(maxChange < WALKING.step + .02, `largest vertical physics displacement ${maxChange}`)
  } finally { sim.dispose() }
})

test('source walls and furniture block sustained movement; no unsupported fall beyond an open slab edge', () => {
  const data = structuredClone(sample)
  data.collision.colliders.push({ id: 'furniture', floorId: 'F0', sourceIds: ['source-furniture'], kind: 'furniture-aabb', min: [9, 0, -1.6], max: [9.5, 1.2, -.4] })
  const sim = create(data)
  try {
    for (let i = 0; i < 600; i++) sim.step({ forward: 1, right: 0, yaw: Math.PI / 2 })
    assert.ok(sim.feet.x > 9.7); assert.ok(sim.feet.y > -.02)
    sim.pause(); for (let i = 0; i < 500; i++) sim.step({ forward: 1, right: 0, yaw: 0 })
    assert.ok(sim.feet.z > -11.7, 'source outside wall is solid')
  } finally { sim.dispose() }
  // A source floor ending at x=10, no fallback ground or implicit parapet.
  const edge = structuredClone(sample)
  edge.collision.colliders = [{ id: 'slab', floorId: 'F0', sourceIds: ['slab'], kind: 'slab', min: [0, -.15, -12], max: [12, 0, 0] }]
  edge.collision.doors = []
  const bare = create(edge)
  try { for (let i = 0; i < 600; i++) bare.step({ forward: 1, right: 0, yaw: -Math.PI / 2 }); assert.ok(bare.feet.x < 12.03); assert.ok(bare.feet.y > -.05); assert.equal(bare.blocked, 'edge') }
  finally { bare.dispose() }
})

test('representative planner-generated furnished house uses its main entrance, source levels and bounded physics cost', () => {
  const p = prepareWalkthroughRequest({ design, projectId: 'generated', expectedPlanId: base.planId, preferences: { style: 'modern', lighting: 'daylight', furnitureDensity: 'medium' } })
  const ids = { designId: p.designId, projectId: p.projectId, geometryKey: 'generated', appearanceKey: 'medium' }
  const sim = new HouseWalkingSimulation({ ...p.geometry.metadata, ...ids }, { ...p.geometry.collision, ...ids, colliders: [...p.geometry.collision.colliders, ...furnitureColliders(p.appearance)] })
  try {
    assert.match(sim.spawn.openingId, /MAIN_DOOR/)
    const start = performance.now()
    for (let i = 0; i < 900; i++) sim.step({ forward: i % 120 < 60 ? 1 : -1, right: 0, yaw: sim.spawn.yaw })
    const ms = performance.now() - start
    assert.ok(sim.grounded); assert.ok(sim.feet.y > -.05)
    assert.ok(ms < 9000, 'physics must average less than 10ms per fixed step in this smoke test')
    console.log(JSON.stringify({ colliders: p.geometry.collision.colliders.length + p.appearance.furniture.length, averagePhysicsMs: ms / 900, sourceFloors: sim.metadata.floors.length }))
  } finally { sim.dispose() }
})

test('head clearance blocks a low beam; an opening narrower than the capsule is never forced through', () => {
  const data = structuredClone(sample)
  data.collision.colliders.push({ id: 'low-beam', floorId: 'F0', sourceIds: ['beam'], kind: 'beam', min: [9, 1.45, -1.6], max: [9.5, 1.65, -.4] })
  const sim = create(data)
  try {
    for (let i = 0; i < 400; i++) sim.step({ forward: 1, right: 0, yaw: Math.PI / 2 })
    assert.ok(sim.feet.x > 9.7, 'body/head cannot enter a low ceiling')
    assert.ok(sim.eye.x > 9.7, 'camera stays on the same safe side of the beam')
  } finally { sim.dispose() }
  const narrow = sourceHouse(); narrow.doors.find(d => d.id === 'F0_narrow_door').width = 400
  const n = create(bundle(narrow)), id = n.metadata.openings.find(o => o.sourceId === 'F0_narrow_door').id
  try {
    n.toggleDoor(id); for (let i = 0; i < 450; i++) n.step({ forward: 1, right: 0, yaw: Math.PI / 2 })
    assert.ok(n.feet.x > 7.15)
  } finally { n.dispose() }
})

test('Rapier slope sliding/climbing stays grounded and descends continuously within the supported slope limit', () => {
  const sim = create(), angle = -Math.PI / 12
  try {
    // Isolated controller test for future surveyed sloped surfaces. No ramp is
    // generated or inserted into any real BuildingModel or house export.
    sim.world.createCollider(RAPIER.ColliderDesc.cuboid(2, .08, .8).setTranslation(9, .49, -1).setRotation({ x: 0, y: 0, z: Math.sin(angle / 2), w: Math.cos(angle / 2) }))
    sim.world.step()
    walkTo(sim, 8.3, -1)
    assert.ok(sim.feet.y > .7 && sim.grounded)
    walkTo(sim, 11.4, -1)
    assert.ok(sim.feet.y < .03 && sim.grounded)
  } finally { sim.dispose() }
})
