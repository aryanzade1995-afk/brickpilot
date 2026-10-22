import test from 'node:test'
import assert from 'node:assert/strict'
import { utilityFloor, UTILITY_LAYERS, displayedRuns, displayedSymbols, utilityLegend, selectionForRun, orthogonal } from '../src/lib/utilities/plan.ts'
import { fireSafetyPlan, detectorCoverage, evacuationRoutes, floorExits } from '../src/lib/utilities/fireSafety.ts'
import { electricalPathAllowed } from '../src/lib/utilities/electrical.ts'
import { defaultBrief } from '../src/lib/model/brief.ts'
import { compile } from '../src/lib/model/canonical.ts'
import { generate } from '../src/lib/engine/generate.ts'

const design = generate(compile(defaultBrief()))
const room = (id, name, x, y, w, h) => ({ id, name, semanticId: id, zone: 'service', outdoor: false, wantsWindow: true, rect: { x, y, w, h }, area: w * h / 1e6 })
const wall = (x1, y1, x2, y2) => ({ a: { x: x1, y: y1 }, b: { x: x2, y: y2 }, thickness: 200, kind: 'interior' })
const floor = { ...design.floors[0], columns: [], shafts: [], rooms: [room('bath', 'Bathroom', 0, 0, 3000, 5000), room('kitchen', 'Kitchen', 3000, 0, 4000, 5000), room('corridor', 'Corridor', 0, 5000, 7000, 1800)],
  outline: { x: 0, y: 0, w: 7000, h: 6800 }, footprint: [{ x: 0, y: 0, w: 7000, h: 6800 }], courtyard: null, doubleHeightVoids: [],
  walls: [wall(0, 0, 7000, 0), wall(7000, 0, 7000, 6800), wall(7000, 6800, 0, 6800), wall(0, 6800, 0, 0), wall(3000, 0, 3000, 5000), wall(0, 5000, 7000, 5000)],
  openings: [{ id: 'bath-door', kind: 'door', orient: 'h', width: 900, at: { x: 1500, y: 5000 }, rooms: ['bath', 'corridor'] }, { id: 'kitchen-door', kind: 'door', orient: 'h', width: 1000, at: { x: 5000, y: 5000 }, rooms: ['kitchen', 'corridor'] }, { id: 'main-entry', kind: 'entry', orient: 'h', width: 1200, at: { x: 3500, y: 6800 }, rooms: ['corridor', null] }] }
const radii = UTILITY_LAYERS.fire_alarm.detectorRadiusMm
const model = utilityFloor({ ...design, floors: [floor] }, 0)
const visible = Object.fromEntries(Object.entries(UTILITY_LAYERS).map(([k, v]) => [k, !v.disabled]))

test('phase-3 config and room-specific fire/safety schedule use real rooms, entry and millimetres', () => {
  assert.deepEqual([UTILITY_LAYERS.fire_alarm.label, UTILITY_LAYERS.fire_alarm.color, UTILITY_LAYERS.fire_alarm.dash, UTILITY_LAYERS.fire_alarm.width, UTILITY_LAYERS.fire_alarm.visible, UTILITY_LAYERS.fire_alarm.disabled], ['Fire Alarm & Safety', '#F57C00', '2 4', 2, false, false])
  const s = model.symbols.filter(s => s.layer === 'fire_alarm')
  assert.equal(s.filter(s => s.type === 'fire_panel').length, 1)
  assert.equal(s.find(s => s.type === 'fire_panel').roomId, 'corridor')
  assert.deepEqual(s.filter(s => s.roomId === 'kitchen').map(s => s.type).sort(), ['extinguisher', 'heat_detector', 'sprinkler'])
  assert.equal(s.filter(s => s.roomId === 'bath').length, 0)
  assert.equal(s.filter(s => s.type === 'smoke_detector').length, 1)
  assert.equal(s.filter(s => s.type === 'manual_call_point').length, 1)
  assert.equal(s.filter(s => s.type === 'sounder').length, 1)
  assert.deepEqual(s.find(s => s.type === 'exit_sign').position, floor.openings[2].at)
  assert.equal(s.find(s => s.type === 'heat_detector').coverageRadiusMm, 5000)
  assert.ok(s.filter(s => s.type === 'smoke_detector').every(s => s.coverageRadiusMm === 7500))
})

test('one deterministic closed loop visits all alarm devices then returns to panel; passive equipment is not wired', () => {
  const z = model.zones[0], runs = model.utilities.filter(u => u.layer === 'fire_alarm')
  assert.equal(z.loopStatus, 'closed'); assert.equal(z.devices.length, 4); assert.equal(runs.length, z.devices.length + 1)
  assert.equal(runs[0].fromSymbolId, z.panelId); assert.equal(runs.at(-1).toSymbolId, z.panelId)
  for (let i = 1; i < runs.length; i++) assert.equal(runs[i - 1].toSymbolId, runs[i].fromSymbolId)
  assert.deepEqual(runs.slice(0, -1).map(u => u.toSymbolId).sort(), [...z.devices].sort())
  for (const run of runs) {
    assert.ok(orthogonal(run.path)); assert.ok(electricalPathAllowed(run.path, floor)); assert.equal(run.cableType, 'FRLS 2C'); assert.equal(selectionForRun(run), `zone:${z.id}`)
    assert.deepEqual(run.path[0], model.symbols.find(s => s.id === run.fromSymbolId).position)
    assert.deepEqual(run.path.at(-1), model.symbols.find(s => s.id === run.toSymbolId).position)
  }
  assert.deepEqual(fireSafetyPlan(floor, [], radii), fireSafetyPlan(floor, [], radii))
})

test('missing doors leave an incomplete loop and blocked escape; windows never substitute for doors', () => {
  for (const openings of [floor.openings.slice(2), floor.openings.map(o => o.kind === 'entry' ? o : { ...o, kind: 'window' })]) {
    const result = fireSafetyPlan({ ...floor, openings }, [], radii)
    assert.equal(result.zones[0].loopStatus, 'incomplete'); assert.ok(result.zones[0].missingLinks.length)
    for (const r of result.exitRoutes.filter(r => ['bath', 'kitchen'].includes(r.fromRoomId))) { assert.equal(r.status, 'blocked'); assert.deepEqual(r.path, []) }
  }
})

test('evacuation follows inset wall edges and actual door openings to the nearest represented exit', () => {
  for (const r of model.exitRoutes) {
    assert.equal(r.status, 'concept'); assert.equal(r.exitId, 'main-entry'); assert.ok(orthogonal(r.path)); assert.ok(electricalPathAllowed(r.path, floor))
    assert.deepEqual(r.path.at(-1), floor.openings[2].at)
  }
  const bath = model.exitRoutes.find(r => r.fromRoomId === 'bath')
  assert.ok(bath.path.some(p => p.x === 220 || p.y === 220 || p.x === 2780 || p.y === 4780))
  const secondExit = { id: 'kitchen-exit', kind: 'door', orient: 'h', width: 1000, at: { x: 5000, y: 0 }, rooms: ['kitchen', null] }
  assert.equal(evacuationRoutes({ ...floor, openings: [...floor.openings, secondExit] }).find(r => r.fromRoomId === 'kitchen').exitId, secondExit.id)
  assert.equal(floorExits({ ...floor, level: 1 }).length, 0)
  assert.equal(floorExits({ ...floor, openings: [{ ...secondExit, kind: 'entry', id: 'A_EMERGENCY_EXIT' }, ...floor.openings] })[0].id, 'main-entry', 'The named main entrance must win over an alphabetically earlier secondary exit')
  assert.ok(evacuationRoutes({ ...floor, level: 1 }).every(r => r.status === 'no-exit' && r.path.length === 0), 'An upper balcony or terrace is not a ground exit')
})

test('coverage never crosses walls; bathrooms are explicitly concept-exempt and large rooms remain partial', () => {
  assert.equal(model.coverage.find(c => c.roomId === 'bath').status, 'exempt')
  assert.equal(model.coverage.find(c => c.roomId === 'kitchen').status, 'covered')
  const extra = room('bed', 'Bedroom', 7000, 5000, 2500, 1800)
  const result = detectorCoverage({ ...floor, rooms: [...floor.rooms, extra] }, model.symbols.filter(s => s.layer === 'fire_alarm'))
  assert.equal(result.find(c => c.roomId === 'bed').status, 'not-covered', 'Nearby corridor smoke circles must not cover a separate room')
  const huge = room('large', 'Common area', 0, 0, 20000, 20000)
  const detector = { id: 'det', layer: 'fire_alarm', type: 'smoke_detector', roomId: 'large', position: { x: 10000, y: 10000 }, coverageRadiusMm: 7500 }
  assert.equal(detectorCoverage({ ...floor, rooms: [huge] }, [detector])[0].status, 'partial')
})

test('shared filters, legend and hiding fire preserve drainage and electrical data and selection', () => {
  const z = model.zones[0]
  assert.ok(displayedRuns(model, visible, 'all', 'all', z.id).some(u => u.layer === 'fire_alarm'))
  assert.ok(displayedRuns(model, visible, 'all', 'all', 'missing').every(u => u.layer !== 'fire_alarm'))
  assert.ok(displayedSymbols(model, visible, 'kitchen').filter(s => s.layer === 'fire_alarm').every(s => s.roomId === 'kitchen'))
  assert.deepEqual(displayedRuns(model, { ...visible, fire_alarm: false }), model.utilities.filter(u => u.layer !== 'fire_alarm'))
  const legend = utilityLegend(model, visible)
  for (const symbol of ['fire_panel', 'smoke_detector', 'heat_detector', 'manual_call_point', 'sounder', 'sprinkler', 'extinguisher', 'exit_sign']) assert.ok(legend.some(l => l.symbol === symbol))
  assert.ok(!utilityLegend(model, { ...visible, fire_alarm: false }).some(l => l.symbol === 'heat_detector'))
  assert.ok(!utilityLegend(model, visible, 'all', true, 'all', false).some(l => l.symbol === 'evacuation_route'))
  assert.ok(utilityLegend(model, visible, 'all', true, 'all', true, true).some(l => l.symbol === 'uncovered_area'))
  assert.ok(!utilityLegend(model, visible).some(l => l.symbol === 'uncovered_area'))
})

test('courtyard cuts are respected and the source design/accepted identity stays unchanged', () => {
  const before = JSON.stringify(design)
  for (const f of design.floors) {
    const m = utilityFloor(design, f.level), cuts = [...(f.courtyard ? [f.courtyard] : []), ...(f.doubleHeightVoids ?? []).map(v => v.rect)]
    for (const u of m.utilities.filter(u => u.layer === 'fire_alarm')) assert.ok(electricalPathAllowed(u.path, f, cuts))
    for (const route of m.exitRoutes.filter(r => r.status === 'concept')) assert.ok(electricalPathAllowed(route.path, f, cuts))
  }
  assert.equal(JSON.stringify(design), before)
})
