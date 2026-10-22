import test from 'node:test'
import assert from 'node:assert/strict'
import { utilityFloor, UTILITY_LAYERS, connectedLoads, displayedRuns, utilityLegend, selectionForRun, orthogonal } from '../src/lib/utilities/plan.ts'
import { electricalPlan, electricalPathAllowed, routeThroughDoors } from '../src/lib/utilities/electrical.ts'
import { wiringPath } from '../src/lib/utilities/overlays.ts'
import { defaultBrief } from '../src/lib/model/brief.ts'
import { compile } from '../src/lib/model/canonical.ts'
import { generate } from '../src/lib/engine/generate.ts'

const design = generate(compile(defaultBrief()))
const room = (id, name, x, w = 3000) => ({ id, name, semanticId: id, zone: 'service', outdoor: false, wantsWindow: true, rect: { x, y: 0, w, h: 5000 }, area: w * 5000 / 1e6 })
const wall = (x1, y1, x2, y2) => ({ a: { x: x1, y: y1 }, b: { x: x2, y: y2 }, thickness: 200, kind: 'interior' })
const sample = { ...design.floors[0], rooms: [room('bath1', 'Bathroom', 0), room('kitchen', 'Kitchen', 3000, 4000)],
  footprint: [{ x: 0, y: 0, w: 7000, h: 5000 }], outline: { x: 0, y: 0, w: 7000, h: 5000 }, courtyard: null, doubleHeightVoids: [],
  walls: [wall(0, 0, 7000, 0), wall(7000, 0, 7000, 5000), wall(7000, 5000, 0, 5000), wall(0, 5000, 0, 0), wall(3000, 0, 3000, 5000)],
  openings: [{ kind: 'door', orient: 'v', width: 900, at: { x: 3000, y: 4000 }, rooms: ['bath1', 'kitchen'] }] }
const sampleDesign = { ...design, floors: [sample] }, model = utilityFloor(sampleDesign, sample.level)
const visibility = Object.fromEntries(Object.entries(UTILITY_LAYERS).map(([id, c]) => [id, !c.disabled]))

test('drainage proposals are deterministic, orthogonal and fixture-to-stack only', () => {
  for (const floor of design.floors) {
    const a = utilityFloor(design, floor.level), b = utilityFloor(design, floor.level)
    assert.deepEqual(a, b)
    for (const r of a.utilities.filter(r => r.layer === 'drainage')) {
      assert.ok(orthogonal(r.path)); assert.ok(a.fixtures.some(f => f.id === r.fixtureId)); assert.ok(a.symbols.some(s => s.id === r.stackId))
      assert.equal(r.flowDirection, 'forward')
    }
  }
})

test('electrical defaults are off and bathroom controls move to the dry side of the door', () => {
  assert.equal(UTILITY_LAYERS.electrical.label, 'Electrical Wiring'); assert.equal(UTILITY_LAYERS.electrical.color, '#D32F2F')
  assert.equal(UTILITY_LAYERS.electrical.dash, null); assert.equal(UTILITY_LAYERS.electrical.width, 2); assert.equal(UTILITY_LAYERS.electrical.visible, false)
  const symbols = model.symbols.filter(s => s.layer === 'electrical'), panels = symbols.filter(s => s.type === 'db_panel')
  assert.equal(panels.length, 1); assert.equal(panels[0].mount.kind, 'wall'); assert.equal(panels[0].roomId, 'kitchen'); assert.ok(panels[0].position.x > 3000)
  for (const [id, expected] of [['bath1', { light: 1, exhaust_fan: 1, socket: 1 }], ['kitchen', { light: 2, switch: 2, socket: 3 }]]) {
    const counts = {}; for (const s of symbols.filter(s => s.type !== 'db_panel' && s.roomId === id)) counts[s.type] = (counts[s.type] ?? 0) + 1
    assert.deepEqual(counts, expected)
  }
  assert.deepEqual(model.circuits.map(c => [c.name, c.wireSize, c.breaker, c.tag]), [['Lighting 1', '1.5mm2', '10A', 'L1'], ['Power 1', '2.5mm2', '16A', 'P1']])
  assert.equal(model.circuits[0].loads.length, 4, 'Switches are controls, not counted as connected loads')
  assert.equal(model.circuits[1].loads.length, 4)
  assert.equal(new Set(model.circuits.map(c => c.color)).size, 2)
  assert.ok(symbols.some(s => s.label === 'Geyser socket · 16A'))
})

test('parallel branches connect DB to switches and independent lighting loads, with deterministic valid orthogonal paths', () => {
  for (const circuit of model.circuits) {
    assert.deepEqual(connectedLoads(model, circuit).sort(), circuit.loads.toSorted())
    assert.equal(circuit.status, 'concept')
    for (const run of model.utilities.filter(u => u.layer === 'electrical' && u.circuitId === circuit.id)) {
      assert.ok(orthogonal(run.path)); assert.ok(electricalPathAllowed(run.path, sample))
      assert.deepEqual(run.path[0], model.symbols.find(s => s.id === run.fromSymbolId).position)
      assert.deepEqual(run.path.at(-1), model.symbols.find(s => s.id === run.toSymbolId).position)
      assert.equal(selectionForRun(run), `circuit:${circuit.id}`)
    }
    for (const control of circuit.controls) assert.ok(model.utilities.some(u => u.layer === 'electrical' && u.fromSymbolId === circuit.panelId && u.toSymbolId === control))
  }
  assert.deepEqual(utilityFloor(sampleDesign, sample.level), model)
})

test('routing crosses walls only through real doors, not windows or fabricated intermediate vertices', () => {
  const from = { x: 500, y: 500 }, to = { x: 6000, y: 500 }
  const path = routeThroughDoors(from, ['bath1'], to, 'kitchen', sample)
  assert.ok(path); assert.ok(orthogonal(path)); assert.ok(electricalPathAllowed(path, sample))
  assert.ok(path.some(p => p.y === 4000), 'Route must reach the actual shared door, not go through the middle of the wall')
  assert.equal(routeThroughDoors(from, ['bath1'], to, 'kitchen', { ...sample, openings: [] }), null)
  assert.equal(routeThroughDoors(from, ['bath1'], to, 'kitchen', { ...sample, openings: sample.openings.map(o => ({ ...o, kind: 'window' })) }), null)
  assert.equal(electricalPathAllowed([from, { x: 3000, y: 500 }, to], sample), false)
})

test('disconnected rooms expose pending loads instead of inventing a connected system', () => {
  const floor = { ...sample, rooms: [room('bath1', 'Bathroom', 0), room('kitchen', 'Kitchen', 8000)], openings: [], walls: [] }
  const e = electricalPlan(floor, [], []), m = { ...model, ...e, floor }
  assert.ok(e.circuits.some(c => c.status === 'needs-review'))
  for (const c of e.circuits) if (c.status === 'needs-review') assert.ok(connectedLoads(m, c).length < c.loads.length)
  assert.ok(e.notes.some(n => /review/.test(n)))
})

test('room and circuit filters combine; hiding electrical preserves drainage and removes electrical legend entries', () => {
  const power = model.circuits.find(c => c.tag === 'P1')
  const filtered = displayedRuns(model, visibility, 'kitchen', power.id)
  assert.ok(filtered.some(u => u.layer === 'drainage'))
  assert.ok(filtered.filter(u => u.layer === 'electrical').every(u => u.circuitId === power.id && u.roomId === 'kitchen'))
  assert.deepEqual(displayedRuns(model, { ...visibility, electrical: false }).map(u => u.id), model.utilities.filter(u => u.layer !== 'electrical').map(u => u.id))
  const legend = utilityLegend(model, visibility)
  for (const type of ['db_panel', 'switch', 'socket', 'light', 'exhaust_fan']) assert.ok(legend.some(e => e.symbol === type))
  assert.ok(!utilityLegend(model, { ...visibility, electrical: false }).some(e => e.symbol === 'socket'))
})

test('different circuits receive one jump arc; endpoints and same-circuit junctions receive none', () => {
  const a = { id: 'a', layer: 'electrical', circuitId: 'L1', path: [{ x: 0, y: 500 }, { x: 1000, y: 500 }] }
  const b = { id: 'b', layer: 'electrical', circuitId: 'P1', path: [{ x: 500, y: 0 }, { x: 500, y: 1000 }] }
  assert.equal(wiringPath(a, [a, b], .1).jumps.length, 0)
  assert.equal(wiringPath(b, [a, b], .1).jumps.length, 1); assert.match(wiringPath(b, [a, b], .1).d, /Q/)
  assert.equal(wiringPath({ ...b, circuitId: 'L1' }, [a, b], .1).jumps.length, 0)
  assert.equal(wiringPath({ ...b, path: [{ x: 1000, y: 500 }, { x: 1000, y: 1000 }] }, [a, b], .1).jumps.length, 0)
})
