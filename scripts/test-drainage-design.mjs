import test from 'node:test'
import assert from 'node:assert/strict'
import { designDrainage, invertCalculation, routeDrain, segmentHitsRect, sizeBranch, sizeBuildingDrain, withDrainageDesign } from '../src/lib/utilities/drainage.ts'
import { defaultDrainageInputs, drainageInputsSchema } from '../src/lib/utilities/drainageInputs.ts'
import { defaultDrawing, parseUtilityDrawing, sourceSignature, documentSchema } from '../src/lib/utilities/drawingProject.ts'
import { buildDrawingSheets, sheetSvg } from '../src/lib/utilities/drawingSheets.ts'
import { utilityDxf, vectorSheetPdf } from '../src/lib/utilities/drawingExports.ts'
import { inflateSync } from 'node:zlib'
import { defaultBrief } from '../src/lib/model/brief.ts'
import { compile } from '../src/lib/model/canonical.ts'
import { generate } from '../src/lib/engine/generate.ts'
import { utilityFloor, displayedRuns } from '../src/lib/utilities/plan.ts'

function sample() {
  const room = { id: 'bath', name: 'Bath', rect: { x: 0, y: 0, w: 4000, h: 4000 }, area: 16 }
  return { sourcePlanId: 'fixture-plan', floor: { level: 0, name: 'Ground floor', rooms: [room], outline: room.rect, footprint: [room.rect], walls: [], openings: [], columns: [], shafts: [] },
    slabs: [room.rect], wallSections: [], fixtures: [{ id: 'f-basin', type: 'sink', drainageKind: 'washbasin', position: { x: 1000, y: 1000 }, roomId: room.id, basis: 'furnishing', width: 600, depth: 450 }],
    utilities: [{ id: 'D:f-basin', layer: 'drainage', fixtureId: 'f-basin', path: [{ x: 1000, y: 1000 }, { x: 3000, y: 1000 }], diameter: 50, material: 'PVC', flowDirection: 'forward', roomId: room.id, stackId: 's' }],
    symbols: [{ id: 's', type: 'vertical_stack', layer: 'drainage', position: { x: 3000, y: 1000 }, roomIds: [room.id], basis: 'proposed' }], circuits: [], zones: [], coverage: [], exitRoutes: [], waterNetworks: [], notes: [] }
}
function configured() {
  const d = defaultDrainageInputs()
  d.city = 'Pune'; d.authority = 'unknown'; d.datum = 'Test survey benchmark'; d.floorElevationMm = 0; d.groundElevationMm = -200
  d.fixtureChoices['f-basin'] = { ruleKey: 'washbasin', invertMm: -100, trapConfirmed: true }
  d.pipes['D:f-basin'] = { gradientRatio: 50, inletInvertMm: -100, outletInvertMm: -140, diameterMm: 40 }
  d.stackBases.s = { position: { x: 3000, y: 1000 }, invertMm: -1000 }
  d.inspectionChamber = { x: 5000, y: 1000 }
  d.outlet = { kind: 'sewer', position: { x: 8000, y: 1000 }, invertMm: -1100, approvalReference: 'User supplied reference, not verified' }
  d.pipes['D:s:base->drainage:chamber'] = { gradientRatio: 50, inletInvertMm: -1000, outletInvertMm: -1040, diameterMm: 100 }
  d.pipes['D:drainage:chamber->drainage:outlet'] = { gradientRatio: 50, inletInvertMm: -1040, outletInvertMm: -1100, diameterMm: 100 }
  return d
}
test('missing information stays unknown and an attractive branch cannot pass as a complete outlet system', () => {
  const design = designDrainage(sample(), defaultDrainageInputs())
  assert.equal(design.status, 'review-required')
  assert.ok(design.checks.some(c => c.category === 'Outlet' && c.status === 'Fail'))
  assert.ok(design.checks.some(c => c.category === 'Outlet connectivity' && c.status === 'Fail'))
  assert.ok(design.checks.some(c => c.category === 'Gravity / inverts' && c.status === 'Not Checked'))
  assert.ok(design.pipes.every(p => p.inletInvertMm === null && p.outletInvertMm === null))
  assert.ok(design.checks.every(c => c.reference && c.correction))
})
test('explicit clear geometry creates a single directed fixture-to-stack-to-chamber-to-outlet network', () => {
  const model = sample(), before = JSON.stringify(model), input = configured(), d = designDrainage(model, input)
  assert.equal(d.checks.find(c => c.category === 'Outlet connectivity').status, 'Pass')
  assert.equal(d.pipes.find(p => p.id === 'D:f-basin').dfu, 1)
  assert.ok(d.checks.filter(c => c.category === 'Gravity / inverts').every(c => c.status === 'Pass'))
  assert.ok(d.checks.some(c => c.category === 'Outlet' && c.status === 'Warning'))
  assert.ok(d.checks.some(c => c.category === 'Ventilation' && c.status === 'Not Checked'))
  assert.equal(JSON.stringify(model), before)
  assert.deepEqual(designDrainage(model, input), d)
})
test('fixture rules cover bath, shower, washer, kitchen sink, floor trap, basin; WC flushing type is explicit', () => {
  const m = sample(), i = defaultDrainageInputs()
  i.fixtures = ['bathtub', 'shower', 'washing_machine', 'kitchen_sink', 'floor_drain', 'toilet'].map((kind, n) => ({ id: `u${n}`, kind, roomId: 'bath', position: { x: 600 + n * 400, y: 2000 } }))
  let d = designDrainage(m, i)
  assert.deepEqual(d.fixtures.map(f => f.dfu), [1, 3, 2, 3, 2, 1, null])
  i.fixtureChoices.u5 = { ruleKey: 'wc_tank', invertMm: null, trapConfirmed: false }
  d = designDrainage(m, i)
  assert.equal(d.fixtures.at(-1).dfu, 3)
  assert.equal(d.pipes.find(p => p.from === 'u5').diameterMm, 100)
  i.fixtureChoices.u5.ruleKey = 'wc_valve'
  assert.equal(designDrainage(m, i).fixtures.at(-1).dfu, 4)
})
test('NBC table subsets do not extrapolate loading or mistake trap minimums for complete pipe sizing', () => {
  assert.equal(sizeBranch(7, 50), 65)
  assert.equal(sizeBranch(1, 75), 75)
  assert.equal(sizeBuildingDrain(180, 100, 100), 100)
  assert.equal(sizeBuildingDrain(181, 100, 100), 125)
  assert.equal(sizeBuildingDrain(1, 100, 200), null)
  assert.equal(sizeBranch(10000, 100), null)
})
test('shared-datum fall is calculated exactly, detects uphill and mismatched junction inverts', () => {
  assert.deepEqual(invertCalculation(6000, 60, -300, null), { inlet: -300, outlet: -400, dropMm: 100, residualMm: null })
  const i = configured(); i.pipes['D:f-basin'].outletInvertMm = -50
  const d = designDrainage(sample(), i)
  assert.ok(d.checks.some(c => c.category === 'Gravity / inverts' && c.status === 'Fail'))
  i.pipes['D:drainage:chamber->drainage:outlet'].inletInvertMm = -1020
  assert.ok(designDrainage(sample(), i).checks.some(c => c.category === 'Junction level' && c.status === 'Fail'))
})
test('routing respects columns and wall permission, including complete diameter/elevation sleeve envelope', () => {
  const box = { x: 2000, y: 500, w: 1000, h: 1000 }, path = routeDrain({ x: 1000, y: 1000 }, { x: 4000, y: 1000 }, [box], { x: 0, y: 0, w: 5000, h: 3000 })
  assert.ok(path); assert.ok(path.slice(1).every((p, n) => !segmentHitsRect(path[n], p, box)))
  const m = sample(); m.floor.walls.push({ id: 'wall', a: { x: 3000, y: 0 }, b: { x: 3000, y: 4000 }, thickness: 200 })
  const i = configured(); let d = designDrainage(m, i)
  assert.equal(d.checks.find(c => c.category === 'Outlet connectivity').status, 'Fail')
  i.penetrations.push({ id: 'sleeve', reference: 'structural test approval', rect: { x: 2850, y: 700, w: 400, h: 600 }, minElevationMm: -1100, maxElevationMm: 0 })
  d = designDrainage(m, i)
  assert.equal(d.checks.find(c => c.category === 'Structure / route' && c.itemId === 'D:s:base->drainage:chamber').status, 'Pass')
  i.penetrations[0].maxElevationMm = -1000
  assert.equal(designDrainage(m, i).checks.find(c => c.category === 'Structure / route' && c.itemId === 'D:s:base->drainage:chamber').status, 'Fail')
})
test('cross-service checks use actual shared-datum levels and locate the nearest crossing', () => {
  const m = sample(); m.utilities.push({ id: 'wire', layer: 'electrical', path: [{ x: 2000, y: 500 }, { x: 2000, y: 1500 }], roomId: 'bath', circuitId: 'L1', fromSymbolId: 'a', toSymbolId: 'b', conductors: 2, wireSize: '1.5mm2' })
  const i = configured(); let d = designDrainage(m, i)
  assert.equal(d.checks.find(c => c.category === 'Utility coordination').status, 'Not Checked')
  i.serviceLevels.wire = -100
  d = designDrainage(m, i); assert.equal(d.checks.find(c => c.category === 'Utility coordination').status, 'Fail')
  assert.deepEqual(d.checks.find(c => c.category === 'Utility coordination').position, { x: 2000, y: 1000 })
  i.serviceLevels.wire = 2400
  assert.equal(designDrainage(m, i).checks.find(c => c.category === 'Utility coordination').status, 'Pass')
})
test('JSON schema preserves inputs, upgrades old documents without inventing levels and rejects malformed data', () => {
  const doc = defaultDrawing('Villa'); doc.drainage = configured()
  assert.deepEqual(documentSchema.parse(JSON.parse(JSON.stringify(doc))).drainage, doc.drainage)
  const old = { ...doc }; delete old.drainage
  assert.equal(documentSchema.parse(old).drainage.outlet.invertMm, null)
  assert.equal(drainageInputsSchema.safeParse({ ...configured(), floorElevationMm: NaN }).success, false)
  const m = utilityFloor(generate(compile(defaultBrief())), 0)
  const saved = { format: 'formstead-utility-project', version: 1, savedAt: new Date().toISOString(), sourceSignature: sourceSignature(m), model: m, document: doc, reviews: {}, view: { room: 'all', circuit: 'all', zone: 'all', water: 'all', showClashes: false, showCoverage: false, showEvacuation: false } }
  assert.deepEqual(parseUtilityDrawing(JSON.parse(JSON.stringify(saved))).document.drainage, doc.drainage)
})
test('live projection, sublayer toggles, vector sheets and DXF share the calculated graph without replacing source quantities', () => {
  const base = sample(), i = configured(), d = withDrainageDesign(base, i), doc = defaultDrawing('Villa'); doc.layers.drainage.visible = true
  const svg = buildDrawingSheets(d, doc, 'drainage').map(sheetSvg).join('')
  assert.match(svg, /DRAINAGE REVIEW/); assert.match(svg, /OUT/); assert.match(svg, /professional review/)
  assert.match(utilityDxf(d, doc), /OUT/)
  i.visible.waste = false
  assert.ok(displayedRuns(withDrainageDesign(base, i), { drainage: true, electrical: false, fire_alarm: false, water_supply: false, hvac: false }).every(r => r.drainagePipe.service !== 'waste'))
  assert.equal(base.utilities.length, 1)
})
test('multi-floor / unknown total loading cannot pass as a sized whole-building collector', () => {
  const m = sample(); m.sourceFloorLevels = [0, 1, 2]
  const d = designDrainage(m, configured())
  for (const p of d.pipes.filter(p => p.service === 'building_drain')) assert.equal(d.checks.find(c => c.category === 'Sizing' && c.itemId === p.id).status, 'Not Checked')
})
test('generated residential layouts remain unchanged and unresolved defaults never imply compliance', () => {
  const c = compile(defaultBrief())
  for (let seed = 1; seed <= 4; seed++) {
    const design = generate(c, { seed }), before = JSON.stringify(design)
    for (const f of design.floors) {
      const m = utilityFloor(design, f.level), d = designDrainage(m, defaultDrainageInputs())
      assert.equal(d.checks.find(c => c.category === 'Outlet').status, 'Fail')
      assert.ok(d.checks.filter(c => c.category === 'Gravity / inverts').every(c => c.status === 'Not Checked'))
      assert.deepEqual(d, designDrainage(m, defaultDrainageInputs()))
    }
    assert.equal(JSON.stringify(design), before)
  }
})
test('Unicode arrows and dashes do not erase English text from vector PDF exports', async () => {
  const pdf = await vectorSheetPdf([{ id: 'test', title: 'Drainage', number: 'DR-1', w: 210, h: 297, kind: 'plan', layer: 'drainage', ops: [{ kind: 'text', at: { x: 20, y: 20 }, text: 'DRAINAGE REVIEW → outlet – unknown', size: 3 }] }])
  const data = Buffer.from(pdf.output('arraybuffer')).toString('latin1'), texts = []
  for (const match of data.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) { try { texts.push(inflateSync(Buffer.from(match[1], 'latin1')).toString('latin1')) } catch { texts.push(match[1]) } }
  assert.match(texts.join('\n'), /DRAINAGE REVIEW/)
  assert.match(texts.join('\n'), /outlet - unknown/)
  assert.match(data, /BaseFont \/Helvetica/)
})
