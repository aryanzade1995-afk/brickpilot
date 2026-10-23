import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { defaultBrief } from '../src/lib/model/brief.ts'
import { compile } from '../src/lib/model/canonical.ts'
import { generate } from '../src/lib/engine/generate.ts'
import { utilityFloor, connectedLoads } from '../src/lib/utilities/plan.ts'
import { applyUtilityPlanning, planningSchema, planningGeometryKey, emptyPlanning, traceSelection } from '../src/lib/utilities/planning.ts'
import { defaultDrawing, documentSchema, sourceSignature, parseUtilityDrawing } from '../src/lib/utilities/drawingProject.ts'
import { utilityRiserRows } from '../src/lib/utilities/risers.ts'
import { withElectricalDesign } from '../src/lib/utilities/electricalDesign.ts'
import { defaultElectricalInputs } from '../src/lib/utilities/electricalInputs.ts'
import { buildDrawingSheets, sheetSvg } from '../src/lib/utilities/drawingSheets.ts'

const brief = defaultBrief(), design = generate(compile(brief)), base = utilityFloor(design, 0, brief)
const room = base.floor.rooms.find(r => !r.outdoor), circuit = base.circuits.find(c => c.loads.some(id => base.symbols.find(s => s.id === id)?.type === 'socket')) ?? base.circuits[0]
const center = r => ({ x: r.rect.x + r.rect.w / 2, y: r.rect.y + r.rect.h / 2 })
const point = (id = 'new-socket') => ({ id, layer: 'electrical', type: 'socket', roomId: room.id, groupId: circuit.id, label: 'Extra socket', position: center(room), heightMm: null })
const config = () => ({ ...emptyPlanning(), sourcePlanId: base.sourcePlanId, geometryKey: planningGeometryKey(base) })

test('Utilities is SVG-only with no canvas, camera modes or 3D settings; layers start off', () => {
  const viewer = readFileSync(new URL('../src/components/utilities/UtilityPlanViewer.tsx', import.meta.url), 'utf8')
  const route = readFileSync(new URL('../src/routes/Utilities.tsx', import.meta.url), 'utf8')
  for (const forbidden of ['<Canvas', 'FloorScene', 'electricalScene(', 'waterScene(', 'setMode(', '3D view options']) assert.equal(viewer.includes(forbidden), false, forbidden)
  assert.equal(route.includes("'3d'"), false)
  assert.ok(Object.values(defaultDrawing('House').layers).every(l => !l.visible))
})
test('adding a socket preserves architecture and every existing run; no automatic route or cost input', () => {
  const before = JSON.stringify(base), input = config(); input.points.push(point())
  const { model, reviews } = applyUtilityPlanning(base, planningSchema.parse(input))
  assert.equal(JSON.stringify(base), before); assert.deepEqual(model.floor, base.floor)
  assert.deepEqual(model.utilities, base.utilities); assert.equal(model.symbols.length, base.symbols.length + 1)
  assert.equal(model.symbols.find(s => s.id === 'new-socket').mount, undefined)
  assert.ok(reviews.some(r => r.id === 'new-socket' && r.reason.includes('no connection')))
  assert.ok(model.circuits.find(c => c.id === circuit.id).loads.includes('new-socket'))
  const checked = withElectricalDesign(model, defaultElectricalInputs())
  assert.ok(checked.electricalDesign.checks.some(c => c.category === 'Connectivity' && c.status === 'Fail'))
  assert.equal(checked.electricalDesign.loads.find(l => l.id === 'new-socket').watts, null)
})
test('moving a socket withdraws its obsolete connections without moving unrelated wires or room walls', () => {
  const old = base.symbols.find(s => s.layer === 'electrical' && s.type === 'socket'), r = base.floor.rooms.find(r => r.id === old.roomId)
  const input = config(); input.points.push({ ...point(old.id), roomId: old.roomId, groupId: old.circuitIds[0], position: center(r) })
  const { model } = applyUtilityPlanning(base, input)
  assert.deepEqual(model.floor, base.floor)
  assert.ok(!model.utilities.some(u => u.layer !== 'drainage' && (u.fromSymbolId === old.id || u.toSymbolId === old.id)))
  for (const u of base.utilities.filter(u => u.layer === 'drainage' || u.fromSymbolId !== old.id && u.toSymbolId !== old.id)) assert.deepEqual(model.utilities.find(v => v.id === u.id), u)
})
test('manual orthogonal connection uses exactly entered vertices and joins the selected circuit', () => {
  const input = config(), p = point(), a = base.symbols.find(s => s.id === circuit.panelId)
  input.points.push(p); const path = [a.position, { x: p.position.x, y: a.position.y }, p.position]
  input.runs.push({ id: 'manual-1', layer: 'electrical', groupId: circuit.id, from: a.id, to: p.id, path })
  const { model, reviews } = applyUtilityPlanning(base, planningSchema.parse(input))
  assert.deepEqual(model.utilities.find(u => u.id === 'manual-1').path, path)
  assert.ok(connectedLoads(model, model.circuits.find(c => c.id === circuit.id)).includes(p.id))
  assert.ok(!reviews.some(r => r.id === p.id)); assert.equal(traceSelection(model, `point:${p.id}`), `circuit:${circuit.id}`)
  input.runs[0].path = [{ x: 0, y: 0 }, { x: 100, y: 100 }]
  assert.equal(planningSchema.safeParse(input).success, false)
})
test('invalid endpoint, wrong group, duplicate IDs, changed plan and changed walls cannot silently create connections', () => {
  const input = config(), p = point(), a = base.symbols.find(s => s.id === circuit.panelId)
  input.points.push(p); input.runs.push({ id: 'bad', layer: 'electrical', groupId: circuit.id, from: a.id, to: p.id, path: [{ x: 0, y: 0 }, { x: 0, y: 100 }] })
  assert.ok(applyUtilityPlanning(base, input).reviews.some(r => r.id === 'bad'))
  input.points.push(point()); assert.equal(planningSchema.safeParse(input).success, false); input.points.pop()
  const changed = structuredClone(base); changed.floor.walls[0].a.x += 25
  assert.deepEqual(applyUtilityPlanning(changed, input).model.symbols, changed.symbols)
  assert.ok(applyUtilityPlanning({ ...base, sourcePlanId: 'other' }, input).reviews.some(r => r.id === 'plan'))
})
test('moved detectors cannot retain their old coverage or a closed alarm loop', () => {
  const old = base.symbols.find(s => s.layer === 'fire_alarm' && /detector/.test(s.type))
  if (!old) return
  const r = base.floor.rooms.find(r => r.id === old.roomId), input = config()
  input.points.push({ ...point(old.id), layer: 'fire_alarm', type: old.type, roomId: r.id, groupId: old.zoneId, position: center(r) })
  const { model } = applyUtilityPlanning(base, input)
  assert.equal(model.zones.find(z => z.id === old.zoneId).loopStatus, 'incomplete')
  assert.notEqual(model.coverage.find(c => c.roomId === r.id)?.status, 'covered')
})
test('point edits, manual routes and unknown mounting heights round-trip with old 3D snapshots accepted safely', () => {
  const document = defaultDrawing('House'), planning = config(); planning.points.push(point()); document.planning = planning
  const saved = { format: 'formstead-utility-project', version: 1, savedAt: new Date().toISOString(), sourceSignature: sourceSignature(base), model: base, document, reviews: {}, view: { room: 'all', circuit: 'all', zone: 'all', water: 'all', showClashes: false, showCoverage: false, showEvacuation: false, mode: '3d' } }
  assert.deepEqual(parseUtilityDrawing(JSON.parse(JSON.stringify(saved))).document.planning, planning)
  delete saved.document.planning
  assert.deepEqual(parseUtilityDrawing(saved).document.planning, emptyPlanning())
  assert.deepEqual(documentSchema.parse(saved.document).layers, saved.document.layers)
})
test('sheet exports contain edited points and honest qualifications without exporting old disconnected wire endpoints', () => {
  const document = defaultDrawing('House'); document.planning = config(); document.planning.points.push(point()); document.layers.electrical.visible = true
  const { model } = applyUtilityPlanning(base, document.planning)
  const sheets = buildDrawingSheets(model, document, 'electrical'), svg = sheets.map(sheetSvg).join('')
  assert.ok(svg.includes('Extra socket')); assert.ok(svg.includes('mounting height unknown'))
  assert.ok(svg.includes('MANUAL SERVICE PROPOSALS'))
})
test('floor-service schematic uses source positions and no invented floor heights or cross-floor connections', () => {
  const models = design.floors.map(f => utilityFloor(design, f.level, brief)), visible = { drainage: true, electrical: true, water_supply: true, fire_alarm: true, hvac: false }
  const rows = utilityRiserRows(models, visible)
  assert.equal(rows.length, models.length)
  for (const row of rows) for (const service of row.services) for (const p of service.points) assert.deepEqual(p.position, models.find(m => m.floor.level === row.level).symbols.find(s => s.id === p.id).position)
  assert.ok(rows.every(r => !('elevation' in r) && !('connections' in r)))
  assert.ok(utilityRiserRows(models, { ...visible, electrical: false }).every(r => r.services.every(s => s.layer !== 'electrical')))
})
