import test from 'node:test'
import assert from 'node:assert/strict'
import { utilityFloor } from '../src/lib/utilities/plan.ts'
import { electricalScene, electricalWorldPoint, liftElectricalRun } from '../src/lib/utilities/electrical3D.ts'
import { wallMount } from '../src/lib/utilities/electricalMounts.ts'
import { segmentIntersection } from '../src/lib/utilities/electrical.ts'
import { defaultBrief } from '../src/lib/model/brief.ts'
import { compile } from '../src/lib/model/canonical.ts'
import { generate } from '../src/lib/engine/generate.ts'

const design = generate(compile(defaultBrief())), models = design.floors.map(f => utilityFloor(design, f.level))
const close = (a, b) => Math.abs(a - b) < .00001

test('every indoor room gets a light and a door switch proposal; exterior spaces do not', () => {
  for (const model of models) for (const room of model.floor.rooms) {
    const symbols = model.symbols.filter(s => s.layer === 'electrical' && s.roomId === room.id && s.type !== 'db_panel')
    if (room.outdoor) { assert.equal(symbols.length, 0); continue }
    assert.ok(symbols.some(s => s.type === 'light'), room.name)
    if (model.floor.openings.some(o => o.kind !== 'window' && o.rooms?.includes(room.id))) assert.ok(model.symbols.some(s => s.layer === 'electrical' && s.type === 'switch' && (s.roomId === room.id || s.id.includes(`:${room.id}:`))), room.name)
    if (/bed|living|study|office|lounge/i.test(room.name)) assert.ok(symbols.some(s => s.type === 'socket'), room.name)
  }
})

test('wall boards mount to represented wall faces at explicit heights with consistent coordinate conversion', () => {
  assert.deepEqual(electricalWorldPoint({ x: 4500, y: 7200 }, 1200), [4.5, 1.2, 7.2])
  for (const model of models) for (const s of model.symbols.filter(s => s.layer === 'electrical' && s.mount?.kind === 'wall')) {
    const w = model.floor.walls[s.mount.wallIndex], n = s.mount.normal
    assert.ok(w); assert.equal(Math.abs(n.x) + Math.abs(n.y), 1)
    const horizontal = Math.abs(w.a.y - w.b.y) < 1
    assert.ok(close(Math.abs(horizontal ? s.position.y - w.a.y : s.position.x - w.a.x), w.thickness / 2 + 35))
    assert.ok(s.mount.elevationMm > 0 && s.mount.elevationMm < s.mount.serviceElevationMm)
    const board = electricalScene(model).boards.find(b => b.id === s.id)
    assert.deepEqual(board.position, electricalWorldPoint(s.position, s.mount.elevationMm))
  }
})

test('a door or a window at board height is not a valid mounting face; missing walls stay unknown', () => {
  const room = { id: 'r', rect: { x: 0, y: 0, w: 3000, h: 3000 } }
  const floor = { walls: [{ a: { x: 0, y: 0 }, b: { x: 3000, y: 0 }, thickness: 200 }], openings: [{ kind: 'window', orient: 'h', at: { x: 1500, y: 0 }, width: 3000, sill: 900, head: 2100 }] }
  assert.equal(wallMount(floor, room, { x: 1500, y: 300 }, 1200), null)
  assert.ok(wallMount(floor, room, { x: 1500, y: 300 }, 450), 'A represented solid sill can support a low socket proposal')
  assert.equal(wallMount({ ...floor, openings: [{ ...floor.openings[0], kind: 'door' }] }, room, { x: 1500, y: 300 }, 1200), null)
  assert.equal(wallMount({ walls: [], openings: [] }, room, { x: 1500, y: 300 }, 1200), null)
})

test('3D runs preserve canonical topology/endpoints and every segment is horizontal or vertical', () => {
  for (const model of models) {
    const scene = electricalScene(model)
    assert.equal(scene.unmounted.length, 0); assert.equal(scene.pending.length, 0)
    assert.equal(scene.wires.length, model.utilities.filter(u => u.layer === 'electrical').length)
    for (const wire of scene.wires) {
      const from = model.symbols.find(s => s.id === wire.fromSymbolId), to = model.symbols.find(s => s.id === wire.toSymbolId)
      assert.deepEqual(wire.points[0], electricalWorldPoint(from.position, from.mount.elevationMm))
      assert.deepEqual(wire.points.at(-1), electricalWorldPoint(to.position, to.mount.elevationMm))
      for (let i = 1; i < wire.points.length; i++) assert.ok(wire.points[i].filter((v, j) => !close(v, wire.points[i - 1][j])).length <= 1)
    }
  }
})

test('room-to-room conduits cross actual door openings below the lintel, never through a window or solid header', () => {
  let crossings = 0
  for (const model of models) for (const wire of electricalScene(model).wires) for (let i = 1; i < wire.points.length; i++) {
    const a = wire.points[i - 1], b = wire.points[i]
    for (const wall of model.floor.walls) {
      const p = segmentIntersection({ x: a[0] * 1000, y: a[2] * 1000 }, { x: b[0] * 1000, y: b[2] * 1000 }, wall.a, wall.b)
      if (!p) continue
      const door = model.floor.openings.find(o => o.kind !== 'window' && Math.abs(o.orient === 'h' ? p.y - o.at.y : p.x - o.at.x) < 25 && Math.abs(o.orient === 'h' ? p.x - o.at.x : p.y - o.at.y) <= o.width / 2 - 20)
      assert.ok(door); assert.ok(a[1] * 1000 <= (door.head ?? 2100) - 100 + .01); assert.ok(b[1] * 1000 <= (door.head ?? 2100) - 100 + .01); crossings++
    }
  }
  assert.ok(crossings > 0)
})

test('3D filtering retains its DB and all canonical connections for the focused room without mutating the project', () => {
  const before = JSON.stringify(design), model = models[0]
  const room = model.floor.rooms.find(r => !r.outdoor && /living/i.test(r.name)) ?? model.floor.rooms.find(r => !r.outdoor)
  const lighting = model.circuits[0], scene = electricalScene(model, room.id, lighting.id)
  assert.ok(scene.wires.length > 0); assert.ok(scene.wires.every(w => w.circuitId === lighting.id))
  assert.ok(scene.boards.some(b => b.type === 'db_panel'))
  assert.deepEqual(electricalScene(model, room.id, lighting.id), scene)
  assert.equal(JSON.stringify(design), before)
})

test('unsupported source mounting and invalid canonical routes are omitted, with an explicit pending state', () => {
  const model = models[0], run = model.utilities.find(u => u.layer === 'electrical')
  const from = model.symbols.find(s => s.id === run.fromSymbolId), to = model.symbols.find(s => s.id === run.toSymbolId)
  assert.equal(liftElectricalRun(model, run, { ...from, mount: undefined }, to), null)
  const invalid = { ...run, path: [{ x: 100, y: 100 }, { x: 800, y: 800 }] }
  assert.equal(liftElectricalRun(model, invalid, from, to), null)
  const missing = { ...model, symbols: model.symbols.map(s => s.id === from.id ? { ...s, mount: undefined } : s) }
  const scene = electricalScene(missing)
  assert.ok(scene.unmounted.includes(from.id)); assert.ok(scene.pending.includes(run.id))
})
