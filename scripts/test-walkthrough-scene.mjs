import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { defaultBrief } from '../src/lib/model/brief.ts'
import { compile } from '../src/lib/model/canonical.ts'
import { generate } from '../src/lib/engine/generate.ts'
import { createBuildingModel } from '../src/lib/engine/buildingModel.ts'
import { validate } from '../src/lib/rules/index.ts'
import { stairRun } from '../src/lib/engine/planner/elements.ts'
import { subtractRegions, intersectRegions } from '../src/lib/solar/regions.ts'
import { buildWalkthroughScene } from '../src/lib/walkthrough/scene.ts'
import { realizeSourceStair } from '../src/lib/walkthrough/stairs.ts'
import { exposedSurfaces } from '../src/lib/walkthrough/surfaces.ts'
import { createWalkthroughSceneGroup } from '../src/lib/three/buildWalkthroughScene.ts'
import { threeGlbToPlan } from '../src/lib/walkthrough/coordinates.ts'

const brief = defaultBrief(); brief.site.plotWidth = 18; brief.site.plotDepth = 24; brief.levels.storeys = 1
const design = generate(compile(brief), { seed: 41 }), report = validate(design)
assert.ok(report.hardChecksPass)
const building = createBuildingModel(design), generated = buildWalkthroughScene(building, report)
const area = rects => rects.reduce((a, r) => a + r.w * r.h, 0)
const volume = b => b.w * b.d * b.h
const solid = (id, x, y, z, w, d, h) => ({ id, sourceIds: [id], floorId: 'F', role: 'wall', boundsMm: { x, y, z, w, d, h } })
const overlaps = (a, b) => Math.min(a.x + a.w, b.x + b.w) > Math.max(a.x, b.x) + 1e-6 && Math.min(a.y + a.d, b.y + b.d) > Math.max(a.y, b.y) + 1e-6 && Math.min(a.z + a.h, b.z + b.h) > Math.max(a.z, b.z) + 1e-6
function fixture(count = 2) {
  const b = structuredClone(building), r = { x: 0, y: 0, w: 12000, h: 12000 }
  for (const key of ['floors', 'rooms', 'walls', 'doors', 'windows', 'stairs', 'columns', 'beams', 'slabs', 'shafts', 'supportZones']) b[key] = []
  for (let level = 0; level < count; level++) {
    const id = `F${level}`, stair = { x: 0, y: 0, w: 2400, h: 3300 }
    b.floors.push({ ...structuredClone(building.floors[0]), id, level, elevationMm: level * 3000, heightMm: 3000, slabThicknessMm: 150, footprint: [{ ...r }], outline: { ...r }, courtyard: null, doubleHeightVoids: [] })
    for (const [roomId, rect] of [['stair', stair], ['hall', { x: 2400, y: 0, w: 9600, h: 3300 }]]) b.rooms.push({ id: roomId, semanticId: `${id}_${roomId}`, floorId: id, name: roomId, rect: { ...rect }, outdoor: false, zone: 'circulation', area: rect.w * rect.h / 1e6, wantsWindow: false })
    b.slabs.push({ id: `${id}_slab`, floorId: id, rect: { ...r }, topMm: level * 3000, thicknessMm: 150 })
    b.stairs.push({ id: `${id}_stair`, floorId: id, ...stairRun(stair, 'N', 9, 250) })
    const lines = [['N', { x: 0, y: 0 }, { x: 12000, y: 0 }], ['E', { x: 12000, y: 0 }, { x: 12000, y: 12000 }], ['S', { x: 0, y: 12000 }, { x: 12000, y: 12000 }], ['W', { x: 0, y: 0 }, { x: 0, y: 12000 }]]
    for (const [side, a, c] of lines) b.walls.push({ id: `${id}_${side}`, floorId: id, a, b: c, thickness: 200, kind: 'exterior', rooms: ['hall', null] })
    b.walls.push({ id: `${id}_shared`, floorId: id, a: { x: 2400, y: 0 }, b: { x: 2400, y: 3300 }, thickness: 100, kind: 'interior', rooms: ['stair', 'hall'] })
    b.doors.push({ id: `${id}_door`, floorId: id, kind: 'door', at: { x: 2400, y: 500 }, orient: 'v', width: 800, leaf: false, rooms: ['stair', 'hall'] })
    b.windows.push({ id: `${id}_window`, floorId: id, kind: 'window', at: { x: 8000, y: 0 }, orient: 'h', width: 1200, sill: 900, head: 2100, rooms: ['hall', null] })
  }
  b.doors.push({ id: 'entry', floorId: 'F0', kind: 'entry', at: { x: 12000, y: 1500 }, orient: 'v', width: 1000, rooms: ['hall', null] })
  b.roofTerrace = { level: count - 1, slab: [{ ...r }], outline: { ...r }, mumty: null, tank: null, pergola: null, freeRatio: 1 }
  return b
}
const build = b => buildWalkthroughScene(b, { hardChecksPass: true })

test('the validated generated 2D house becomes one immutable globally placed shell', () => {
  const copy = structuredClone(building), before = JSON.stringify(copy)
  build(copy); assert.equal(JSON.stringify(copy), before)
  assert.notEqual(generated.status, 'unsupported', JSON.stringify(generated.issues))
  assert.equal(generated.floors.length, design.floors.length); assert.equal(generated.rooms.length, building.rooms.length)
  assert.equal(generated.openings.length, building.doors.length + building.windows.length)
  assert.deepEqual(generated.source, createBuildingModel(design)); assert.equal(JSON.stringify(building), before)
  for (const room of generated.rooms) {
    const original = building.rooms.find(r => r.floorId === room.floorId && r.id === room.sourceId), floor = building.floors.find(f => f.id === room.floorId)
    assert.deepEqual(room.rectMm, original.rect); assert.equal(room.elevationM, floor.elevationMm / 1000)
  }
  for (const f of generated.floors) assert.equal(f.elevationM, building.floors.find(x => x.id === f.sourceId).elevationMm / 1000)
  assert.ok(generated.surfaces.length > 100)
  const p = generated.surfaces[0].vertices[0], source = threeGlbToPlan({ x: p[0], y: p[1], z: p[2] })
  assert.ok(Object.values(source).every(Number.isFinite))
})

test('shared walls are built once; exact duplicate source records become semantic aliases', () => {
  const b = fixture(1), base = build(b), wall = b.walls.find(w => w.id.endsWith('shared'))
  const expected = (3300 * 3000 - 800 * b.floors[0].openingLimits.doorHeadMm) * wall.thickness
  assert.equal(base.solids.filter(s => s.role === 'wall' && s.sourceIds.includes(wall.id)).reduce((n, s) => n + volume(s.boundsMm), 0), expected)
  b.walls.push({ ...structuredClone(wall), id: 'shared-alias' })
  const duplicate = build(b); assert.notEqual(duplicate.status, 'unsupported')
  const wallSolids = duplicate.solids.filter(s => s.role === 'wall' && s.sourceIds.includes(wall.id))
  assert.equal(wallSolids.reduce((n, s) => n + volume(s.boundsMm), 0), expected)
  assert.ok(wallSolids.every(s => s.sourceIds.includes('shared-alias')))
})

test('three- and four-storey sources keep real elevations and distinct floor-scoped room identities', () => {
  for (const count of [3, 4]) {
    const b = fixture(count), s = build(b)
    assert.notEqual(s.status, 'unsupported', JSON.stringify(s.issues))
    assert.equal(s.floors.length, count); assert.equal(s.stairs.length, count)
    assert.deepEqual(s.floors.map(f => f.elevationM), Array.from({ length: count }, (_, i) => i * 3))
    assert.equal(new Set(s.rooms.map(r => r.id)).size, count * 2)
    const reachable = new Set([s.rooms.find(r => r.floorId === 'F0' && r.sourceId === 'hall').id])
    let progress = true
    while (progress) { progress = false; for (const c of s.connections) if (reachable.has(c.from) || reachable.has(c.to)) for (const key of [c.from, c.to]) if (key && !reachable.has(key)) { reachable.add(key); progress = true } }
    assert.ok(s.rooms.every(r => reachable.has(r.id)))
  }
})

test('source door/window holes retain exact widths and vertical limits; no wall fills an aperture', () => {
  for (const o of generated.openings) {
    const source = [...building.doors, ...building.windows].find(x => x.id === o.sourceId && x.floorId === o.floorId)
    assert.equal(o.orient === 'h' ? o.apertureMm.w : o.apertureMm.d, source.width)
    assert.equal(o.sillMm, source.kind === 'window' ? source.sill ?? building.floors.find(f => f.id === o.floorId).openingLimits.defaultSillMm : 0)
    assert.ok(!generated.solids.some(s => s.role === 'wall' && overlaps(s.boundsMm, o.apertureMm)), o.sourceId)
  }
  const b = fixture(1); b.windows[0].head = 5000
  const invalid = build(b); assert.equal(invalid.status, 'unsupported'); assert.ok(invalid.issues.some(i => i.code === 'OPENING_HEIGHT_UNRESOLVED'))
  assert.equal(invalid.surfaces.length, 0)
})

test('glazing render faces never coincide with an opaque stair or structure face', () => {
  for (const face of generated.surfaces.filter(f => f.role === 'glass')) {
    const o = generated.openings.find(o => o.id === face.solidId), horizontal = o.orient === 'h'
    const points = face.vertices.map(([x, y, z]) => threeGlbToPlan({ x, y, z })), along = points.map(p => horizontal ? p.x : p.y), heights = points.map(p => p.z)
    const p = { x: Math.min(...along), y: Math.min(...heights), w: Math.max(...along) - Math.min(...along), h: Math.max(...heights) - Math.min(...heights) }
    const plane = horizontal ? points[0].y : points[0].x
    for (const s of generated.solids) {
      const b = s.boundsMm, lo = horizontal ? b.y : b.x, hi = lo + (horizontal ? b.d : b.w)
      if (lo > plane + 1e-6 || hi < plane - 1e-6) continue
      const q = { x: horizontal ? b.x : b.y, y: b.z, w: horizontal ? b.w : b.d, h: b.h }
      assert.ok(Math.min(p.x + p.w, q.x + q.w) - Math.max(p.x, q.x) < 1e-6 || Math.min(p.y + p.h, q.y + q.h) - Math.max(p.y, q.y) < 1e-6)
    }
  }
})

test('courtyard, shaft and double-height holes are exact slab cuts; no lower ceiling fills a double-height space', () => {
  const b = fixture(), courtyard = { x: 7000, y: 7000, w: 2000, h: 2000 }, shaft = { x: 10500, y: 10500, w: 500, h: 500 }
  b.floors.forEach(f => { f.courtyard = { ...courtyard }; b.shafts.push({ id: `${f.id}_shaft`, floorId: f.id, roomId: 'duct', rect: { ...shaft }, stackedOver: null }) })
  const dh = { x: 6000, y: 3500, w: 1500, h: 1500 }; b.floors[1].doubleHeightVoids = [{ rect: dh, roomId: 'void', sourceRoomId: 'F0_hall' }]
  const s = build(b); assert.notEqual(s.status, 'unsupported', JSON.stringify(s.issues))
  for (const f of s.floors) {
    const original = b.floors.find(x => x.id === f.sourceId), expected = subtractRegions(original.footprint, f.cutouts.map(c => c.rectMm))
    assert.equal(area(f.supportedRegionsMm), area(expected))
    assert.equal(intersectRegions(f.supportedRegionsMm, [courtyard, shaft, ...(f.level === 1 ? [dh] : [])]).length, 0)
  }
  assert.ok(!s.solids.some(x => x.role === 'slab' && x.boundsMm.z < 3000 && x.boundsMm.z + x.boundsMm.h > 2850 && intersectRegions([{ x: x.boundsMm.x, y: x.boundsMm.y, w: x.boundsMm.w, h: x.boundsMm.d }], [dh]).length))
  assert.ok(s.solids.some(x => x.role === 'slab' && x.boundsMm.z === 5850 && intersectRegions([{ x: x.boundsMm.x, y: x.boundsMm.y, w: x.boundsMm.w, h: x.boundsMm.d }], [dh]).length), 'The double-height room closes only at the actual top roof')
})

test('source dog-leg stairs match Blender nosing/landing/opening interpretation in all rotations', () => {
  const python = process.env.PYTHON ?? (process.platform === 'win32' && existsSync('C:/Python314/python.exe') ? 'C:/Python314/python.exe' : 'python3')
  for (const side of ['N', 'S', 'E', 'W']) {
    const r = side === 'N' || side === 'S' ? { x: 1000, y: 2000, w: 2400, h: 3300 } : { x: 1000, y: 2000, w: 3300, h: 2400 }
    const stair = { id: 'stair', floorId: 'F0', ...stairRun(r, side, 9, 250) }, floor = { ...building.floors[0], id: 'F0' }
    const js = realizeSourceStair(stair, floor, 'F1', building.quantityRules.stairs)
    const script = "import sys,json;sys.path.insert(0,'blender');from geometry.stairs import stair_layout;s=stair_layout(json.load(sys.stdin));print(json.dumps({'opening':s['opening'],'going':s['going'],'count':s['steps_per_flight'],'landing':s['world_rect'](0,s['travel'],s['across'],s['run']-s['travel'])}))"
    const result = spawnSync(python, ['-c', script], { input: JSON.stringify(stair), encoding: 'utf8', windowsHide: true })
    assert.equal(result.status, 0, result.stderr || result.error?.message)
    const py = JSON.parse(result.stdout)
    assert.deepEqual(js.openingMm, py.opening); assert.deepEqual(js.midLanding.rectMm, py.landing)
    assert.equal(js.goingMm, py.going); assert.equal(js.stepCount, py.count * 2)
    assert.equal(js.midLanding.topMm - js.midLanding.bottomMm, building.quantityRules.stairs.landingThicknessMm)
    assert.equal(js.steps.length, py.count * 2 - 1)
    assert.ok(Math.abs(js.steps.at(-1).topMm + js.riseMm - js.destinationElevationMm) < 1e-8)
  }
})

test('stairs join source storeys and retain destination landings and actual headroom', () => {
  for (const stair of generated.stairs) {
    assert.ok(stair.headroom.length > 5)
    assert.ok(stair.headroom.every(h => h.clearanceMm === null || h.clearanceMm > 0))
    const floor = generated.floors.find(f => f.sourceId === stair.destinationFloorId)
    if (floor) {
      assert.equal(intersectRegions(floor.supportedRegionsMm, [stair.openingMm]).length, 0)
      assert.equal(area(intersectRegions(floor.supportedRegionsMm, [stair.destinationLandingMm])), area([stair.destinationLandingMm]))
    }
  }
  assert.ok(generated.connections.some(c => c.kind === 'stair' && generated.rooms.some(r => r.id === c.to && r.floorId !== generated.rooms.find(r => r.id === c.from).floorId)))
  const b = fixture(); b.beams.push({ id: 'low-obstruction', floorId: 'F0', a: { x: 0, y: 2800 }, b: { x: 2400, y: 2800 }, span: 2400, widthMm: 300, depthMm: 2000 })
  const blocked = build(b); assert.equal(blocked.status, 'unsupported'); assert.ok(blocked.issues.some(i => i.code === 'STAIR_OBSTRUCTED'))
})

test('columns, sized beams, balcony floors and source terrace plates remain in the common shell', () => {
  for (const c of building.columns) assert.ok(generated.solids.some(s => s.role === 'column' && s.floorId === c.floorId && s.sourceIds.includes(c.id)))
  for (const beam of building.beams) assert.ok(generated.solids.some(s => s.role === 'beam' && s.floorId === beam.floorId && s.sourceIds.includes(beam.id)))
  const balcony = building.rooms.find(r => /balcony/i.test(r.id)), room = generated.rooms.find(r => r.sourceId === balcony.id && r.floorId === balcony.floorId)
  assert.deepEqual(room.rectMm, balcony.rect); assert.equal(area(room.supportedRegionsMm), area([balcony.rect]))
  assert.ok(generated.connections.some(c => c.kind === 'door' && (c.from === room.id || c.to === room.id)))
  assert.ok(generated.roofs.some(r => r.access === 'source-stair'))
  assert.ok(generated.solids.some(s => s.role === 'parapet'))
})

test('an upper doorway connects to a real setback terrace only when its full outside edge is supported', () => {
  const b = fixture(), upper = b.floors[1]; upper.footprint[0].w = 8000; upper.outline.w = 8000
  b.slabs.find(s => s.floorId === upper.id).rect.w = 8000
  b.rooms.find(r => r.floorId === upper.id && r.id === 'hall').rect.w = 5600
  for (const w of b.walls.filter(w => w.floorId === upper.id)) {
    if (w.id.endsWith('_E')) { w.a.x = 8000; w.b.x = 8000 }
    if (w.id.endsWith('_N') || w.id.endsWith('_S')) w.b.x = 8000
  }
  b.windows.find(w => w.floorId === upper.id).at.x = 6000
  b.roofTerrace.slab[0].w = 8000; b.roofTerrace.outline.w = 8000
  b.doors.push({ id: 'terrace-door', floorId: upper.id, kind: 'door', at: { x: 8000, y: 1500 }, orient: 'v', width: 1000, leaf: false, rooms: ['hall', null] })
  const s = build(b); assert.notEqual(s.status, 'unsupported', JSON.stringify(s.issues))
  const terrace = s.roofs.find(r => r.floorId === 'F0')
  assert.equal(terrace.elevationM, 3); assert.equal(terrace.access, 'source-door')
  assert.ok(s.connections.some(c => c.sourceId === 'terrace-door' && c.to === terrace.id))
  b.rooms.find(r => r.floorId === 'F0' && r.id === 'hall').rect.h = 900
  b.shafts.push({ id: 'roof-edge-void', floorId: 'F0', roomId: 'duct', rect: { x: 8100, y: 1400, w: 500, h: 200 }, stackedOver: null })
  const gap = build(b); assert.notEqual(gap.status, 'unsupported', JSON.stringify(gap.issues))
  assert.equal(gap.roofs.find(r => r.floorId === 'F0').access, 'unconfirmed')
  assert.ok(!gap.connections.some(c => c.sourceId === 'terrace-door' && c.to === terrace.id))
})

test('the shell boundary has no internal or duplicate coplanar faces and has outward winding', () => {
  const boxes = [solid('a', 0, 0, 0, 1000, 1000, 1000), solid('b', 1000, 0, 0, 1000, 1000, 1000), solid('duplicate', 0, 0, 0, 1000, 1000, 1000)]
  const faces = exposedSurfaces(boxes), area3 = faces.reduce((sum, f) => {
    const a = f.vertices[0], b = f.vertices[1], c = f.vertices[2], u = b.map((v, i) => v - a[i]), v = c.map((n, i) => n - a[i])
    const cross = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
    assert.ok(cross.reduce((n, x, i) => n + x * f.normal[i], 0) > 0)
    return sum + Math.hypot(...cross)
  }, 0)
  assert.equal(area3, 10); assert.ok(!faces.some(f => f.vertices.every(p => p[0] === 1) && Math.abs(f.normal[0]) === 1))
  assert.deepEqual(exposedSurfaces([...boxes].reverse()), faces)
  const crossing = exposedSurfaces([solid('horizontal', 0, 0, 0, 2000, 1000, 1000), solid('vertical', 500, -500, 0, 1000, 2000, 1000)])
  const area = crossing.reduce((sum, f) => sum + Math.hypot(...f.vertices[1].map((v, i) => v - f.vertices[0][i])) * Math.hypot(...f.vertices[2].map((v, i) => v - f.vertices[1][i])), 0)
  assert.equal(area, 14, 'Overlapping crossed solids expose only the boundary of their union')
})

test('invalid input is reported without repairing it or publishing a partial renderable house', () => {
  const cases = [
    b => { b.walls[0].b.y += 10 }, b => { b.doors[0].at.x += 99000 }, b => { b.slabs[0].rect.w = NaN },
    b => { b.floors[1].elevationMm += 200 }, b => { b.stairs[0].startSide = undefined }, b => { b.floors[0].slabThicknessMm = undefined },
    b => { b.roofTerrace = undefined }, b => { b.walls.push({ ...b.walls[0], id: 'partial-overlap', a: { x: 100, y: 0 } }) },
  ]
  for (const mutate of cases) { const b = fixture(); mutate(b); const before = JSON.stringify(b), result = build(b)
    assert.equal(result.status, 'unsupported'); assert.equal(result.surfaces.length, 0); assert.equal(result.solids.length, 0)
    assert.ok(result.issues.some(i => i.severity === 'error')); assert.equal(JSON.stringify(b), before)
  }
  assert.equal(buildWalkthroughScene(building, { hardChecksPass: false }).status, 'unsupported')
})

test('door connectivity requires the actual source doorway and room boundary, and never uses windows', () => {
  const b = fixture(); b.doors[0].rooms = ['hall', 'hall']
  const s = build(b); assert.notEqual(s.status, 'unsupported')
  assert.ok(!s.connections.some(c => c.sourceId === b.doors[0].id))
  assert.ok(!s.connections.some(c => b.windows.some(w => w.id === c.sourceId)))
  assert.ok(s.issues.some(i => i.code === 'DOOR_ROOM_REFERENCE'))
})

test('stable geometry/surface IDs survive source-array reordering and the Three adapter retains semantics', () => {
  const b = structuredClone(building)
  for (const key of ['floors', 'rooms', 'walls', 'doors', 'windows', 'stairs', 'columns', 'beams', 'slabs', 'shafts']) b[key].reverse()
  const s = build(b); assert.deepEqual(s.surfaces.map(s => s.id), generated.surfaces.map(s => s.id))
  const owned = createWalkthroughSceneGroup(generated), meshes = []
  owned.group.traverse(o => { if (o.isMesh) meshes.push(o) })
  assert.equal(owned.group.children.length, generated.floors.length)
  assert.ok(owned.group.children.every(o => o.position.length() === 0 && o.scale.toArray().every(n => n === 1)))
  assert.equal(meshes.reduce((n, m) => n + m.userData.surfaceRanges.length, 0), generated.surfaces.length)
  assert.ok(meshes.every(m => m.geometry.getAttribute('position').count > 0 && m.geometry.index.count > 0))
  owned.dispose(); owned.dispose(); assert.equal(owned.group.children.length, 0)
  assert.throws(() => createWalkthroughSceneGroup({ ...generated, status: 'unsupported' }), /Unsupported/)
})
