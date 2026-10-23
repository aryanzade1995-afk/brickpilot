import test from 'node:test'
import assert from 'node:assert/strict'
import { Group, Mesh, BoxGeometry, MeshStandardMaterial, Box3, Vector3 } from 'three'
import { acceptedVillaCollision, acceptedVillaDoors } from '../src/lib/three/acceptedVillaWalkthrough.ts'
import { parseAcceptedVilla } from '../src/lib/three/acceptedVillaWalkthrough.ts'
import { separateCoplanar } from '../src/lib/three/separateCoplanar.ts'
import { createWalkthroughSource } from '../src/lib/walkthrough/source.ts'
import { buildWalkthroughScene } from '../src/lib/walkthrough/scene.ts'
import { prepareWalkthroughGeometry, prepareWalkthroughAppearance, furnitureColliders } from '../src/lib/walkthrough/delivery.ts'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { bindAcceptedVillaFinishes } from '../src/lib/three/acceptedVillaFinishes.ts'
import { applyWalkthroughMaterialBindings } from '../src/lib/three/loadWalkthroughAsset.ts'
import { HouseWalkingSimulation, initializeWalkingPhysics } from '../src/lib/walkthrough/navigation.ts'
import { improveWalkingAccess } from '../src/lib/walkthrough/access.ts'
import { defaultBrief } from '../src/lib/model/brief.ts'
import { compile } from '../src/lib/model/canonical.ts'
import { generate } from '../src/lib/engine/generate.ts'
import { validate } from '../src/lib/rules/index.ts'
import { extractLayout, applyLayout } from '../src/lib/plan/layout.ts'

function add(root, name, size, position, sourceId) {
  const mesh = new Mesh(new BoxGeometry(...size), new MeshStandardMaterial())
  mesh.name = name; mesh.position.set(...position); mesh.userData.source_id = sourceId; root.add(mesh); return mesh
}
const opening = { id: 'scene-door', sourceId: 'D', floorId: 'GF', kind: 'door', operation: 'door-leaf-unmodelled', hinge: 'a', swing: 1, orient: 'h',
  apertureMm: { x: 2500, y: 2900, z: 0, w: 1000, d: 200, h: 2100 }, rooms: ['hall', 'other'] }
function walkingBundle() {
  const identity = { designId: 'exact', projectId: 'test', geometryKey: 'glb', appearanceKey: 'glb' }
  return { metadata: { ...identity, floors: [{ sourceId: 'GF', level: 0, elevationM: 0 }],
    rooms: [{ id: 'hall', floorId: 'GF', name: 'Hall', rectMm: { x: 0, y: 0, w: 6000, h: 6000 } }],
    openings: [{ id: 'MAIN', sourceId: 'MAIN_ENTRANCE', kind: 'entry' }, opening],
    entries: [{ id: 'MAIN', roomId: 'hall', floorId: 'GF', position: [3, 0, -1] }], stairs: [], issues: [] },
  collision: { ...identity, version: 1, units: 'm', coordinates: 'metres-x-plan-east-y-up-z-plan-north', colliders: [], doors: [] } }
}
test('actual Blender leaf and handle leave the fixed trimesh; E opens the same doorway and fixed frames remain', async () => {
  await initializeWalkingPhysics()
  const root = new Group()
  add(root, 'floor', [6, .2, 6], [3, -.1, -3])
  add(root, 'wall-left', [2.5, 3, .2], [1.25, 1.5, -3])
  add(root, 'wall-right', [2.5, 3, .2], [4.75, 1.5, -3])
  const leaf = add(root, 'Door_D_Leaf', [.875, 2, .04], [3, 1.035, -3], 'D')
  const handle = add(root, 'Door_D_Handle', [.1, .025, .03], [3.36, .96, -3.035], 'D')
  const slats = add(root, 'Finish_Door_D_Leaf_WoodSlats', [.85, 1.95, .014], [3, 1.035, -3.027], 'D')
  slats.userData.finish_parent = 'Door_D_Leaf'
  const frame = add(root, 'Door_D_Head', [1, .055, .09], [3, 2.1, -3], 'D')
  const mesh = acceptedVillaCollision(root, [opening]), { metadata, collision } = walkingBundle()
  assert.equal(mesh.doors.length, 1); assert.equal(leaf.userData.walkthroughDoorId, handle.userData.walkthroughDoorId)
  assert.equal(slats.userData.walkthroughDoorId, leaf.userData.walkthroughDoorId)
  assert.equal(frame.userData.walkthroughDoorId, undefined)
  const sim = new HouseWalkingSimulation(metadata, collision, 'exact', mesh)
  try {
    for (let i = 0; i < 120; i++) sim.step({ forward: 1, right: 0, yaw: 0 })
    assert.ok(sim.feet.z > -2.8, 'closed leaf blocks walking')
    const target = sim.targetDoor(sim.eye, { x: 0, y: 0, z: -1 }); assert.ok(target)
    sim.toggleDoor(target.id)
    for (let i = 0; i < 35; i++) sim.step({ forward: 0, right: 0, yaw: 0 })
    assert.ok(Math.abs(sim.getDoorPose(target.id).angle) > 1.5)
    for (let i = 0; i < 85; i++) sim.step({ forward: 1, right: 0, yaw: 0 })
    assert.ok(sim.feet.z < -3.7, 'the actual opening becomes passable')
  } finally { sim.dispose() }
})

test('double entry leaves and carved inserts group separately; slider retains its fixed sash and track', () => {
  const root = new Group(), main = { ...opening, sourceId: 'MAIN', kind: 'entry' }
  for (const [name, x] of [['Leaf_Left', 2.7], ['CarvedPanel_Left_0', 2.7], ['Handle_-1', 2.94], ['Leaf_Right', 3.3], ['Handle_1', 3.06], ['SurroundHead', 3]])
    add(root, `MainEntry_MAIN_${name}`, [.2, 1, .03], [x, 1, -3], 'MAIN')
  for (const name of ['SlidingLeft_Glass', 'SlidingLeft_Top', 'SlidingRight_Glass', 'SlidingTrack']) add(root, `Door_D_${name}`, [.8, 1, .03], [3, 1, -3], 'D')
  add(root, 'Door_E_Leaf', [.8, 2, .04], [3, 1, -3], 'E')
  const release = add(root, 'EmergencyDoor_ReleaseBar', [.7, .04, .045], [3, 1, -3.045], 'E')
  const doors = acceptedVillaDoors(root, [main, { ...opening, operation: 'sliding' }, { ...opening, id:'exit', sourceId:'E', emergencyExit:true }])
  assert.equal(doors.length, 4); assert.equal(release.userData.walkthroughDoorId, 'exit:single')
  assert.equal(doors.find(d => d.id.endsWith(':right')).hinge, 'b')
  assert.equal(root.getObjectByName('Door_D_SlidingRight_Glass').userData.walkthroughDoorId, undefined)
  assert.equal(root.getObjectByName('MainEntry_MAIN_SurroundHead').userData.walkthroughDoorId, undefined)
})

test('one Blender slab receives independent room products without overlays, gaps, changed bounds or unrelated material updates', async () => {
  const root = new Group(), slab = add(root, 'GF_Slab_001', [4, .2, 2], [2, -.1, -1], 'SLAB')
  const key = room => JSON.stringify(['GF', room, 'floor'])
  const faces = ['left', 'right'].map((roomId, i) => ({ id: roomId, roomId, floorId: 'GF', binding: key(roomId), role: 'slab', normal: [0, 1, 0], vertices: [[2*i, 0, -2], [2*i+2, 0, -2], [2*i+2, 0, 0], [2*i, 0, 0]] }))
  const geometry = { faces, metadata: { openings: [] } }, appearance = { skins: [], bindings: { [key('left')]: { color: '#123456', rough: .2 }, [key('right')]: { color: '#aabbcc', rough: .7 } } }
  const before = new Box3().setFromObject(root)
  bindAcceptedVillaFinishes(root, geometry, appearance)
  assert.equal(root.children.length, 1); assert.ok(new Box3().setFromObject(root).equals(before))
  await applyWalkthroughMaterialBindings(root, appearance.bindings)
  assert.ok(slab.userData.materialBindings.includes(key('left')) && slab.userData.materialBindings.includes(key('right')))
  const rightIndex = slab.userData.materialBindings.indexOf(key('right')), rightMaterial = slab.material[rightIndex], positions = [...slab.geometry.attributes.position.array]
  let area = 0
  root.updateMatrixWorld(true)
  for (const group of slab.geometry.groups.filter(g => slab.userData.materialBindings[g.materialIndex])) {
    const binding = slab.userData.materialBindings[group.materialIndex], expected = binding === key('left') ? [0, 2] : [2, 4]
    for (let i = group.start; i < group.start + group.count; i += 3) {
      const p = [0,1,2].map(k => new Vector3().fromBufferAttribute(slab.geometry.attributes.position, i+k).applyMatrix4(slab.matrixWorld))
      p.forEach(v => assert.ok(v.x >= expected[0] - 1e-6 && v.x <= expected[1] + 1e-6))
      area += p[1].clone().sub(p[0]).cross(p[2].clone().sub(p[0])).length() / 2
    }
  }
  assert.ok(Math.abs(area - 8) < 1e-6, `no missing or doubled top area: ${area}`)
  await applyWalkthroughMaterialBindings(root, { ...appearance.bindings, [key('left')]: { color: '#ff0000', rough: .4 } })
  assert.equal(slab.material[rightIndex], rightMaterial); assert.deepEqual([...slab.geometry.attributes.position.array], positions)
})

test('source plan has 1.8m galleries, column-clear open stair portals and no under-stair secondary exit', () => {
  const brief = defaultBrief(); brief.site.plotWidth = 28; brief.site.plotDepth = 32
  const plan = generate(compile(brief), { seed: 41, massing: 'courtyard-ring' })
  assert.ok(validate(plan).hardChecksPass)
  for (const floor of plan.floors) {
    for (const hall of floor.rooms.filter(r => /corridor|privateHall|lobby/.test(r.id))) assert.ok(Math.min(hall.rect.w, hall.rect.h) >= 1800)
    const portal = floor.openings.find(o => o.rooms?.includes('stair') && o.kind === 'door')
    assert.equal(portal.leaf, false); assert.equal(portal.treatment, 'open'); assert.ok(portal.width >= 1400)
  }
  assert.ok(!plan.floors[0].openings.find(o => o.emergencyExit).rooms.includes('stair'))
  const exit = plan.floors[0].openings.find(o => o.emergencyExit), room = plan.floors[0].rooms.find(r => r.id === exit.rooms[0])
  assert.equal(exit.swing, (exit.orient === 'h' ? exit.at.y === room.rect.y : exit.at.x === room.rect.x) ? -1 : 1)
  const layout = extractLayout(plan), operation = improveWalkingAccess(layout, plan)
  assert.ok(operation.ok); assert.ok(validate(applyLayout(plan, operation.layout)).hardChecksPass)
})

test('changing tile coverage repartitions original Blender faces, without accumulating overlapping skins', async () => {
  const root = new Group(), wall = add(root, 'GF_Wall_001', [4, 3, .115], [2, 1.5, 0], 'WALL')
  const base = { id: 'wall', roomId: 'room', floorId: 'GF', binding: 'wall-paint', role: 'wall', normal: [0,0,-1], vertices: [[0,0,-.0575],[4,0,-.0575],[4,3,-.0575],[0,3,-.0575]] }
  const geometry = { faces: [base], metadata: { openings: [] } }
  const appearance = height => ({ bindings: { 'wall-paint': { color: '#abcdef', rough: .8 }, tiles: { color: '#bb6644', rough: .2 } }, skins: [{ ...base, id: 'wall:wall-tiles', binding: 'tiles', vertices: [[0,0,-.0595],[4,0,-.0595],[4,height,-.0595],[0,height,-.0595]] }] })
  const areaFor = key => {
    let total = 0
    for (const g of wall.geometry.groups.filter(g => wall.userData.materialBindings[g.materialIndex] === key)) for (let i=g.start; i<g.start+g.count; i+=3) {
      const p = [0,1,2].map(k => new Vector3().fromBufferAttribute(wall.geometry.attributes.position,i+k))
      total += p[1].sub(p[0]).cross(p[2].sub(p[0])).length()/2
    }
    return total
  }
  for (const height of [1.2, 2.4, 1.2]) {
    const app = appearance(height); bindAcceptedVillaFinishes(root, geometry, app); await applyWalkthroughMaterialBindings(root, app.bindings)
    assert.ok(Math.abs(areaFor('tiles')-4*height)<1e-5); assert.ok(Math.abs(areaFor('tiles')+areaFor('wall-paint')-12)<1e-5)
    assert.equal(root.children.length,1)
  }
})

test('real rebuilt Blender villa: safe entrance, selected surface domains, stair ascent/descent and accessible exit', { skip: !process.env.WALKTHROUGH_VILLA_JOB }, async () => {
  const dir = process.env.WALKTHROUGH_VILLA_JOB, request = JSON.parse(await readFile(join(dir, 'request.json'), 'utf8'))
  const accepted = JSON.parse(await readFile(join(dir, 'accepted.json'), 'utf8'))
  const source = createWalkthroughSource(request.plan, validate(request.plan), { style: 'modern', lighting: 'daylight', furnitureDensity: 'medium' })
  const geometry = prepareWalkthroughGeometry(buildWalkthroughScene(source.building, validate(request.plan)))
  const app = prepareWalkthroughAppearance(request.plan, source, geometry)
  const bytes = await readFile(join(accepted.directory, accepted.files.find(f => f.endsWith('.glb'))))
  const root = await parseAcceptedVilla(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), accepted.planId)
  separateCoplanar(root)
  for (const piece of [...(geometry.metadata.exitAccess?.pieces ?? []), ...(accepted.geometryRevision === 'walk-access-v6' ? geometry.metadata.entryAccess?.pieces ?? [] : [])]) {
    const actual = []; root.traverse(o => { if (o instanceof Mesh && o.userData.source_id === piece.id) actual.push(o) })
    assert.equal(actual.length, 1)
    const b = new Box3().setFromObject(actual[0]), expectedMin = [piece.rect.x/1000,piece.bottomMm/1000,-(piece.rect.y+piece.rect.h)/1000], expectedMax = [(piece.rect.x+piece.rect.w)/1000,piece.topMm/1000,-piece.rect.y/1000]
    b.min.toArray().forEach((v,i)=>assert.ok(Math.abs(v-expectedMin[i])<.01)); b.max.toArray().forEach((v,i)=>assert.ok(Math.abs(v-expectedMax[i])<.01))
  }
  const triangles = acceptedVillaCollision(root, geometry.metadata.openings)
  bindAcceptedVillaFinishes(root, geometry, app)
  let bound = 0; root.traverse(o => { if (o.userData.materialBindings?.some(Boolean)) bound++ })
  assert.ok(bound > 50, `actual room surfaces bound: ${bound}`)
  const identity = { designId: accepted.planId, projectId: 'actual', geometryKey: 'actual-glb', appearanceKey: 'selected' }
  const metadata = { ...geometry.metadata, ...identity }, collision = { ...geometry.collision, ...identity }
  await initializeWalkingPhysics()
  const main = new HouseWalkingSimulation(metadata, collision, accepted.planId, triangles)
  assert.ok(main.grounded); assert.ok(main.doors.size > 10); assert.ok(main.replaceFurnishing(furnitureColliders(app))); main.dispose()
  if (accepted.geometryRevision === 'walk-access-v6') {
    const top = source.building.floors.at(-1), soffit = (top.elevationMm + top.heightMm - top.slabThicknessMm)/1000
    root.traverse(o => { if (o instanceof Mesh && o.name.startsWith(`${top.id}_Wall_`)) assert.ok(new Box3().setFromObject(o).max.y <= soffit + .01, `${o.name} protrudes into terrace slab`) })
  }
  const centre = r => ({ x: (r.x + r.w / 2) / 1000, z: -(r.y + r.h / 2) / 1000 })
  const walk = (sim, p) => {
    for (let i = 0; i < 600; i++) {
      const dx = p.x - sim.feet.x, dz = p.z - sim.feet.z
      if (Math.hypot(dx, dz) < .065) { sim.pause(); return }
      sim.step({ forward: 1, right: 0, yaw: Math.atan2(-dx, -dz) })
    }
    console.log('Blocked contacts', Array.from({length:sim.controller.numComputedCollisions()},(_,i)=>{const c=sim.controller.computedCollision(i);return {normal:c.normal1,point:c.witness1,handle:c.collider?.handle,translation:c.collider?.translation(),rotation:c.collider?.rotation(),door:[...sim.doors.values()].find(d=>d.collider.handle===c.collider?.handle)?.id}}))
    assert.fail(`Walking blocked at ${JSON.stringify(sim.feet)}, target ${JSON.stringify(p)}`)
  }
  const stair = metadata.stairs[0], steps = [...stair.steps].sort((a,b) => a.topMm-b.topMm), first = centre(steps[0].rectMm), second = centre(steps[1].rectMm)
  const len = Math.hypot(second.x-first.x, second.z-first.z), dirX = (second.x-first.x)/len, dirZ = (second.z-first.z)/len
  const approach = { x: first.x-dirX*.55, z: first.z-dirZ*.55 }
  // Test-only initial entry at the real source stair approach, not a runtime warp.
  const entry = metadata.entries.find(e => e.id === main.spawn.openingId)
  const stairMeta = { ...metadata, entries: [{ ...entry, position: [approach.x, 0, approach.z] }] }
  const sim = new HouseWalkingSimulation(stairMeta, collision, accepted.planId, triangles)
  assert.ok(sim.replaceFurnishing(furnitureColliders(app)))
  try {
    const points = steps.map(t => ({ ...centre(t.rectMm), y: t.topMm/1000 })), half = points.findIndex(p => p.y > stair.midLanding.topMm/1000), mid = centre(stair.midLanding.rectMm)
    const alongX = Math.abs(dirX) > .5
    points.splice(half, 0, { x: alongX ? mid.x : points[half-1].x, z: alongX ? points[half-1].z : mid.z }, { x: alongX ? mid.x : points[half].x, z: alongX ? points[half].z : mid.z })
    const last = points.at(-1), landing = centre(stair.destinationLandingMm)
    points.push({ x: alongX ? landing.x : last.x, z: alongX ? last.z : landing.z }, { x: last.x-dirX*.55, z: last.z-dirZ*.55 })
    for (const p of points) walk(sim, p)
    assert.ok(Math.abs(sim.feet.y - stair.destinationElevationMm/1000) < .04, JSON.stringify(sim.feet))
    for (const p of points.slice(0,-1).reverse()) walk(sim, p)
    walk(sim, approach); assert.ok(sim.feet.y < .04)
  } finally { sim.dispose() }
  const exit = metadata.openings.find(o => o.emergencyExit)
  assert.ok(exit && !source.building.doors.find(o => o.id === exit.sourceId).rooms.includes('stair'))
  const room = metadata.rooms.find(r => r.id === exit.rooms.find(Boolean)), a = exit.apertureMm, h = exit.orient === 'h', x = (a.x+a.w/2)/1000, z = -(a.y+a.d/2)/1000
  const inside = h ? { x, z: z + (centre(room.rectMm).z > z ? .6 : -.6) } : { x: x + (centre(room.rectMm).x > x ? .6 : -.6), z }
  const exitMeta = { ...metadata, entries: [{ ...entry, position: [inside.x, 0, inside.z] }] }
  const escape = new HouseWalkingSimulation(exitMeta, collision, accepted.planId, triangles)
  try {
    const door = [...escape.doors.values()].find(d => d.opening.id === exit.id)
    assert.ok(door); escape.toggleDoor(door.id)
    for (let i = 0; i < 35; i++) escape.step({ forward: 0, right: 0, yaw: 0 })
    const access = metadata.exitAccess
    assert.ok(access?.pieces.length >= 2, 'source landing and treads reach the actual site grade')
    for (const piece of access.pieces) walk(escape, centre(piece.rect))
    const last = centre(access.pieces.at(-1).rect), dx = (x-inside.x)/.6, dz = (z-inside.z)/.6
    walk(escape, { x: last.x+dx*.6, z: last.z+dz*.6 })
    assert.ok(Math.abs(escape.feet.y - access.gradeMm/1000) < .1)
    assert.ok(escape.grounded)
    for (const piece of [...access.pieces].reverse()) walk(escape, centre(piece.rect))
    walk(escape, inside); assert.ok(escape.feet.y > -.03)
  } finally { escape.dispose() }
  if (accepted.geometryRevision === 'walk-access-v6') {
    const access = metadata.entryAccess, opening = metadata.openings.find(o => o.sourceId === access.exitId), a=opening.apertureMm, h=opening.orient==='h'
    const x=(a.x+a.w/2)/1000, z=-(a.y+a.d/2)/1000, room=metadata.rooms.find(r=>r.id===opening.rooms.find(Boolean)), r=centre(room.rectMm)
    const inside=h?{x,z:z+(r.z>z?1.15:-1.15)}:{x:x+(r.x>x?1.15:-1.15),z}
    const front=new HouseWalkingSimulation({...metadata,entries:[{...entry,position:[inside.x,0,inside.z]}]},collision,accepted.planId,triangles)
    try {
      assert.ok(front.replaceFurnishing(furnitureColliders(app)))
      const door=[...front.doors.values()].find(d=>d.opening.id===opening.id); front.toggleDoor(door.id)
      for(let i=0;i<45;i++)front.step({forward:0,right:0,yaw:0})
      for(const p of access.pieces)walk(front,centre(p.rect))
      const last=centre(access.pieces.at(-1).rect), dx=(x-inside.x)/1.15, dz=(z-inside.z)/1.15
      walk(front,{x:last.x+dx*.5,z:last.z+dz*.5})
      assert.ok(Math.abs(front.feet.y-access.gradeMm/1000)<.04,'front entrance reaches real verandah paving')
      for(const p of [...access.pieces].reverse())walk(front,centre(p.rect))
      walk(front,inside); assert.ok(front.feet.y>-.03)
    } finally {front.dispose()}
  }
  console.log(`Rebuilt villa: ${triangles.indices.length/3} fixed triangles, ${triangles.doors.length} movable leaves, ${bound} selected-finish meshes; stairs and exit traversed.`)
})
