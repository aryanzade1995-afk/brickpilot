import test from 'node:test'
import assert from 'node:assert/strict'
import { withElectricalDesign, electricalReviewCsv } from '../src/lib/utilities/electricalDesign.ts'
import { defaultElectricalInputs, emptyCircuitInput, electricalInputsSchema } from '../src/lib/utilities/electricalInputs.ts'
import { defaultDrawing, sourceSignature, parseUtilityDrawing } from '../src/lib/utilities/drawingProject.ts'
import { buildDrawingSheets, sheetSvg } from '../src/lib/utilities/drawingSheets.ts'
import { electricalScene } from '../src/lib/utilities/electrical3D.ts'
import { ELECTRICAL_RULES } from '../src/lib/utilities/electricalRules.ts'

const at = (x, y) => ({ x, y }), room = { id: 'living', name: 'Living', semanticId: 'living', rect: { x: 0, y: 0, w: 5000, h: 5000 }, area: 25, outdoor: false }
const sym = (id, type, x, y, h) => ({ id, type, layer: 'electrical', roomId: room.id, roomIds: [room.id], circuitIds: ['E:0:L1'], position: at(x, y), label: id, basis: 'proposed', mount: { kind: type === 'light' ? 'ceiling' : 'wall', elevationMm: h, serviceElevationMm: 2500, normal: at(1, 0), wallIndex: 0 } })
const wire = (id, from, to, a, b) => ({ id, layer: 'electrical', circuitId: 'E:0:L1', fromSymbolId: from, toSymbolId: to, roomId: room.id, path: [a, b], wireSize: '1.5mm2', conductors: 3 })
function model() {
  return { sourcePlanId: 'electrical-test', sourceFloorLevels: [0], floor: { level: 0, name: 'Ground floor', outline: room.rect, footprint: [room.rect], rooms: [room], walls: [], openings: [], columns: [], shafts: [], doubleHeightVoids: [] }, slabs: [room.rect], wallSections: [], fixtures: [], zones: [], coverage: [], exitRoutes: [], waterNetworks: [], notes: [],
    symbols: [sym('DB', 'db_panel', 500, 500, 1500), sym('S', 'switch', 1000, 500, 1200), sym('A', 'light', 2000, 500, 2500), sym('B', 'light', 1000, 2500, 2500)],
    circuits: [{ id: 'E:0:L1', panelId: 'DB', name: 'Lighting 1', tag: 'L1', color: '#D32F2F', loads: ['A', 'B'], controls: ['S'], wireSize: '1.5mm2', breaker: '10A', status: 'concept', unroutedLoads: [] }],
    utilities: [wire('DB-S', 'DB', 'S', at(500, 500), at(1000, 500)), wire('S-A', 'S', 'A', at(1000, 500), at(2000, 500)), wire('S-B', 'S', 'B', at(1000, 500), at(1000, 2500))] }
}
function entered(source = model()) {
  const input = defaultElectricalInputs(), derived = withElectricalDesign(source, input), id = derived.circuits[0].id
  Object.assign(input, { supply: 'single-phase', voltageLn: 230, supplyReference: 'test supplier evidence', nbcApplicabilityReference: 'test designer applicability' })
  input.loads.A = { watts: 100, basis: 'nameplate', reference: 'fixture A datasheet', kind: 'light', dedicated: false }
  input.loads.B = { watts: 200, basis: 'nameplate', reference: 'fixture B datasheet', kind: 'light', dedicated: false }
  input.circuits[id] = { ...emptyCircuitInput(), demandFactor: 1, demandReference: 'test simultaneous load assumption', powerFactor: 1, conductor: 'copper', areaMm2: 2.5, insulation: 'test PVC', installation: 'test method B, 2 loaded conductors', ambientC: 40, grouping: 2, baseAmpacityA: 20, temperatureFactor: .8, groupingFactor: .9, otherFactor: 1, tableReference: 'synthetic test data, NOT a code table', breakerA: 10, breakerType: 'MCB', conventionalTripA: 14.5, breakingCapacityKa: 6, voltageDropMvAm: 10, dropReference: 'synthetic line/return coefficient', upstreamDropPercent: .5, routeReview: 'test concept route reviewed' }
  return { input, id }
}
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`)
const result = (d, category, id) => d.checks.find(c => c.category === category && (!id || c.itemId === id))

test('unknowns stay unknown: no default watts, voltage, cable or breaker becomes a sized design', () => {
  const s = model(), input = defaultElectricalInputs(), before = structuredClone(s), a = withElectricalDesign(s, input), b = withElectricalDesign(s, input)
  assert.deepEqual(a, b); assert.deepEqual(s, before)
  const d = a.electricalDesign; assert.equal(d.connectedWatts, null); assert.equal(d.circuits[0].currentA, null); assert.equal(d.circuits[0].deratedAmpacityA, null)
  assert.equal(a.circuits[0].wireSize, 'Unspecified'); assert.equal(a.circuits[0].breaker, 'Unspecified'); assert.equal(d.status, 'review-required')
  for (const c of ['Cable capacity', 'Voltage drop', 'Earthing', 'Local supply']) assert.equal(result(d, c).status, 'Not Checked')
})
test('circuits retain exact paths, IDs, source DB, plan and actual 3D service elevations', () => {
  const s = model(), a = withElectricalDesign(s, defaultElectricalInputs())
  assert.equal(a.floor, s.floor); assert.equal(a.slabs, s.slabs)
  assert.deepEqual(a.utilities.map(r => [r.id, r.path]), s.utilities.map(r => [r.id, r.path]))
  assert.deepEqual(electricalScene(a).wires.map(w => [w.id, w.points]), electricalScene(s).wires.map(w => [w.id, w.points]))
})
test('explicit loads, documented demand/PF and line-neutral voltage calculate design current and corrected ampacity', () => {
  const { input } = entered(), d = withElectricalDesign(model(), input).electricalDesign, c = d.circuits[0]
  assert.equal(c.connectedWatts, 300); assert.equal(c.designWatts, 300); close(c.currentA, 300 / 230); close(c.deratedAmpacityA, 14.4)
  assert.equal(result(d, 'Cable capacity').status, 'Pass'); assert.equal(result(d, 'Circuit loading').status, 'Pass')
})
test('voltage drop sums shared-feeder downstream current, not total circuit current on every branch', () => {
  const { input } = entered(), c = withElectricalDesign(model(), input).electricalDesign.circuits[0]
  close(c.planRouteM, 3.5); close(c.developedRouteM, 8.4); close(c.longestM, 6.1)
  const expected = .01 * (2.8 * 300 / 230 + 3.3 * 200 / 230) / 230 * 100
  close(c.voltageDropPercent, expected); close(c.totalDropPercent, expected + .5)
})
test('missing upstream drop, factor, evidence or phase blocks the corresponding check', () => {
  for (const [key, value, category] of [['upstreamDropPercent', null, 'Voltage drop'], ['tableReference', '', 'Cable capacity'], ['groupingFactor', null, 'Cable capacity'], ['demandReference', '', 'Demand/current']]) {
    const { input, id } = entered(); input.circuits[id][key] = value
    assert.equal(result(withElectricalDesign(model(), input).electricalDesign, category).status, 'Not Checked')
  }
  const { input, id } = entered(); input.supply = 'three-phase'
  assert.equal(withElectricalDesign(model(), input).electricalDesign.circuits[0].currentA, null)
  input.circuits[id].phase = 'L2'; close(withElectricalDesign(model(), input).electricalDesign.circuits[0].currentA, 300 / 230)
})
test('overload, protective capacity, circuit limits and consumer-terminal drop fail independently', () => {
  const { input, id } = entered(); input.circuits[id].baseAmpacityA = 12; input.prospectiveFaultKa = 10; input.circuits[id].upstreamDropPercent = 4; input.loads.A.watts = 500
  const d = withElectricalDesign(model(), input).electricalDesign
  for (const c of ['Cable capacity', 'Fault protection', 'Voltage drop', 'Circuit loading']) assert.equal(result(d, c).status, 'Fail', c)
})
test('broken connections and duplicate feeds cannot produce radial voltage-drop results', () => {
  for (const change of [s => s.utilities.splice(0, 1), s => s.utilities.push({ ...s.utilities[0], id: 'second-feed' })]) {
    const s = model(); change(s); const { input } = entered(s), d = withElectricalDesign(s, input).electricalDesign
    assert.equal(result(d, 'Radial topology').status, 'Fail'); assert.equal(d.circuits[0].voltageDropPercent, null)
  }
})
test('geyser/AC/cooking/pump connections become dedicated proposals without moving geometry', () => {
  const s = model(); s.symbols[3].type = 'socket'; s.symbols[3].label = 'Geyser socket · 16A'
  const m = withElectricalDesign(s, defaultElectricalInputs()), c = m.circuits.find(c => c.loads.includes('B'))
  assert.equal(c.loads.length, 1); assert.ok(c.tag.startsWith('D')); assert.ok(!m.symbols.find(s => s.id === 'B').label.includes('16A'))
  assert.deepEqual(m.utilities.find(r => r.id === 'S-B').path, s.utilities.find(r => r.id === 'S-B').path)
})
test('additional appliances replace a socket placeholder once; unrepresented appliances stay disconnected', () => {
  const s = model(); s.symbols[3].type = 'socket'; const input = defaultElectricalInputs()
  input.additionalLoads.push({ id: 'appliance:ac', name: 'Room AC', roomId: 'living', endpointId: 'B', watts: 1200, basis: 'nameplate', reference: 'AC input watts', kind: 'ac', dedicated: true })
  let d = withElectricalDesign(s, input).electricalDesign; assert.equal(d.loads.length, 2); assert.equal(d.loads.find(l => l.id === 'B').watts, 1200)
  input.additionalLoads[0].endpointId = null; d = withElectricalDesign(s, input).electricalDesign
  assert.equal(d.loads.length, 3); assert.equal(result(d, 'Inventory', 'appliance:ac').status, 'Fail'); assert.ok(!d.circuits.some(c => c.loadIds.includes('appliance:ac')))
})
test('whole-house DB capacity is not inferred from one floor; test records never certify the design', () => {
  const s = model(); s.sourceFloorLevels = [0, 1]; const { input } = entered(s)
  input.db = { ratingA: 40, incomerA: 32, residualMa: 30, ways: 12, spareWays: 1, accessReference: 'review', feederReference: 'external' }
  input.commissioning.Polarity = { result: 'pass', reference: 'contractor report' }
  const d = withElectricalDesign(s, input).electricalDesign
  assert.equal(result(d, 'DB capacity').status, 'Not Checked'); assert.equal(result(d, 'Commissioning', 'Polarity').status, 'Warning'); assert.equal(d.status, 'review-required')
})
test('wet-room and plumbing review uses unknown elevations honestly and retains other services', () => {
  const s = model(); s.floor.rooms[0] = { ...room, name: 'Kitchen' }
  s.utilities.push({ id: 'water', layer: 'water_supply', networkId: 'CW', fromSymbolId: 'in', toSymbolId: 'out', fixtureId: null, service: 'cold', path: [at(500, 500), at(1000, 500)], diameter: 20, material: 'CPVC', roomId: 'living' })
  const input = defaultElectricalInputs(), a = withElectricalDesign(s, input)
  assert.equal(result(a.electricalDesign, 'Service coordination').status, 'Not Checked'); assert.ok(a.electricalDesign.checks.some(c => c.category === 'Wet location'))
  input.serviceElevationsMm['DB-S'] = 2400; input.serviceElevationsMm.water = 0
  const b = withElectricalDesign(s, input); assert.ok(!b.electricalDesign.checks.some(c => c.category === 'Service coordination' && c.itemId === 'DB-S|water'))
  assert.equal(b.utilities.find(r => r.id === 'water'), s.utilities.at(-1))
})
test('invalid numeric values and unknown versions are rejected; zero is not an unknown voltage', () => {
  for (const change of [d => d.voltageLn = 0, d => d.version = 2, d => d.prospectiveFaultKa = -1, d => d.circuits.x = { ...emptyCircuitInput(), powerFactor: 0 }, d => d.voltageLn = Infinity]) {
    const input = defaultElectricalInputs(); change(input); assert.equal(electricalInputsSchema.safeParse(input).success, false)
  }
})
test('JSON keeps applied inputs, older documents migrate to unknowns, and calculated values are recomputed', () => {
  const s = model(), { input } = entered(), doc = defaultDrawing('Electrical test'); doc.electrical = input
  const file = { format: 'formstead-utility-project', version: 1, savedAt: '2026-10-22T00:00:00Z', sourceSignature: sourceSignature(s), model: s, document: doc, reviews: {}, view: { room: 'all', circuit: 'all', zone: 'all', water: 'all', showClashes: false, showCoverage: false, showEvacuation: false } }
  const restored = parseUtilityDrawing(JSON.parse(JSON.stringify(file))); assert.deepEqual(restored.document.electrical, input)
  assert.deepEqual(withElectricalDesign(restored.model, restored.document.electrical).electricalDesign, withElectricalDesign(s, input).electricalDesign)
  delete file.document.electrical; assert.deepEqual(parseUtilityDrawing(file).document.electrical, defaultElectricalInputs())
})
test('drawing sheets and CSV include schedule, load basis, review results and qualifications', () => {
  const { input } = entered(), m = withElectricalDesign(model(), input), doc = defaultDrawing('Electrical test'); doc.electrical = input
  const pages = buildDrawingSheets(m, doc, 'electrical'), xml = pages.map(sheetSvg).join(''), csv = electricalReviewCsv(m.electricalDesign)
  for (const text of ['ELECTRICAL LOAD INVENTORY', 'ELECTRICAL DESIGN REVIEW', 'ELECTRICAL BASIS']) assert.ok(xml.includes(text))
  assert.match(csv, /Circuit/); assert.match(csv, /Not Checked/); assert.match(csv, /fixture A datasheet/); assert.match(csv, /No automated code-compliance/)
  assert.equal(new Set(m.electricalDesign.checks.map(c => c.id)).size, m.electricalDesign.checks.length)
  assert.equal(ELECTRICAL_RULES.voltageDrop.reference.includes('6.2'), true)
})
test('source changes invalidate retained evidence without deleting it or moving architecture', () => {
  const s = model(), { input } = entered(s); input.planSignature = withElectricalDesign(s, input).electricalDesign.sourceSignature
  const a = withElectricalDesign(s, input); assert.equal(result(a.electricalDesign, 'Cable capacity').status, 'Pass')
  const changed = structuredClone(s); changed.utilities[0].path[0].x += 100
  const b = withElectricalDesign(changed, input)
  assert.ok(result(b.electricalDesign, 'Changed source')); assert.equal(result(b.electricalDesign, 'Cable capacity').status, 'Not Checked')
  assert.equal(b.electricalDesign.input.circuits[a.circuits[0].id].baseAmpacityA, 20); assert.equal(b.floor, changed.floor)
})
test('an appliance incorrectly wired through a lighting switch is flagged, not silently approved', () => {
  const s = model(), input = defaultElectricalInputs(); input.loads.B = { watts: 1500, basis: 'nameplate', reference: 'heater', kind: 'geyser', dedicated: true }
  const d = withElectricalDesign(s, input).electricalDesign
  assert.equal(result(d, 'Dedicated isolation').status, 'Fail'); assert.equal(result(d, 'Shared terminal', 'S').status, 'Fail')
})
test('production generated house retains live 3D positions, other networks and source geometry', async () => {
  const { defaultBrief } = await import('../src/lib/model/brief.ts'), { compile } = await import('../src/lib/model/canonical.ts'), { generate } = await import('../src/lib/engine/generate.ts'), { utilityFloor } = await import('../src/lib/utilities/plan.ts')
  const design = generate(compile(defaultBrief())), source = utilityFloor(design, 0), before = JSON.stringify(source), a = withElectricalDesign(source, defaultElectricalInputs())
  assert.equal(JSON.stringify(source), before); assert.equal(a.floor, source.floor)
  assert.deepEqual(electricalScene(a).wires.map(w => [w.id, w.points]).sort(), electricalScene(source).wires.map(w => [w.id, w.points]).sort())
  for (const c of a.circuits) assert.ok(c.loads.every(id => a.electricalDesign.loads.some(l => l.id === id)))
  assert.deepEqual(a.utilities.filter(r => r.layer !== 'electrical'), source.utilities.filter(r => r.layer !== 'electrical'))
})
test('a table value cannot override a verified conditional minimum conductor section', () => {
  const { input, id } = entered(); input.circuits[id].areaMm2 = 1; input.circuits[id].baseAmpacityA = 100
  const d = withElectricalDesign(model(), input).electricalDesign
  assert.equal(result(d, 'Cable capacity').status, 'Pass'); assert.equal(result(d, 'Conductor minimum').status, 'Fail')
})
test('extra appliances cannot disappear through an invalid endpoint/room assignment', () => {
  const input = defaultElectricalInputs(); input.additionalLoads.push({ id: 'appliance:unplaced', name: 'Pump', roomId: 'other-room', endpointId: 'DB', watts: null, basis: 'unknown', reference: '', kind: 'pump', dedicated: true })
  const d = withElectricalDesign(model(), input).electricalDesign
  assert.ok(d.loads.some(l => l.id === 'appliance:unplaced')); assert.equal(result(d, 'Inventory', 'appliance:unplaced').status, 'Fail')
})
