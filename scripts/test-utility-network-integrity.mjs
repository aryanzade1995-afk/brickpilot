import test from 'node:test'
import assert from 'node:assert/strict'
import { defaultBrief } from '../src/lib/model/brief.ts'
import { compile } from '../src/lib/model/canonical.ts'
import { generate } from '../src/lib/engine/generate.ts'
import { utilityFloor, UTILITY_LAYERS, utilityLegend, connectedLoads, displayedRuns } from '../src/lib/utilities/plan.ts'
import { utilityObstacles, orthogonal } from '../src/lib/utilities/routing.ts'
import { electricalPathAllowed, routeThroughDoors } from '../src/lib/utilities/electrical.ts'
import { defaultDrawing, visibleLayers } from '../src/lib/utilities/drawingProject.ts'
import { buildDrawingSheets, clashReportSheets, sheetSvg } from '../src/lib/utilities/drawingSheets.ts'

test('a fresh utility visit starts with every service off; each layer can be enabled and disabled independently', () => {
  const document = defaultDrawing('Villa'), model = utilityFloor(generate(compile(defaultBrief())), 0)
  assert.ok(Object.values(UTILITY_LAYERS).every(c => !c.visible))
  assert.deepEqual(displayedRuns(model, visibleLayers(document)), [])
  for (const key of Object.keys(document.layers)) {
    document.layers[key].visible = true
    assert.ok(displayedRuns(model, visibleLayers(document)).every(r => r.layer === key))
    assert.ok(displayedRuns(model, visibleLayers(document)).length)
    document.layers[key].visible = false
    assert.equal(displayedRuns(model, visibleLayers(document)).length, 0)
  }
})

test('legacy marker data cannot reappear in legends, drawing sheets or report exports', () => {
  const doc = defaultDrawing('Villa'), model = utilityFloor(generate(compile(defaultBrief())), 0)
  for (const p of Object.values(doc.layers)) p.visible = true
  const oldMarker = { id: 'old', type: 'HARD', severity: 'high', position: { x: 1000, y: 1000 }, rule: 'Old clash', layerA: 'electrical', layerB: 'drainage' }
  const legend = utilityLegend(model, visibleLayers(doc), 'all', true)
  assert.ok(!legend.some(e => e.symbol === 'clearance_warning' || /problem|clash/i.test(e.label)))
  const sheets = buildDrawingSheets(model, doc, 'coordination', [oldMarker])
  assert.ok(!sheets.some(s => s.kind === 'clashes'))
  for (const sheet of sheets) assert.doesNotMatch(sheetSvg(sheet), /data-layer="clashes"|CLASH KEY|>!</)
  assert.deepEqual(clashReportSheets(model, doc, [oldMarker]), [])
})

test('32 generated floor layouts have connected networks, protected source geometry and no fabricated drain shortcuts', () => {
  const canonical = compile(defaultBrief())
  for (let seed = 1; seed <= 16; seed++) {
    const design = generate(canonical, { seed }), before = JSON.stringify(design)
    for (const floor of design.floors) {
      const model = utilityFloor(design, floor.level), cuts = utilityObstacles(floor)
      const label = `seed ${seed}, floor ${floor.level}`
      for (const run of model.utilities) {
        assert.ok(orthogonal(run.path), label)
        assert.ok(run.path.length > 1, label)
        assert.ok(run.path.every(p => Number.isFinite(p.x) && Number.isFinite(p.y)))
        if (run.layer !== 'drainage') assert.ok(electricalPathAllowed(run.path, floor, cuts), `${label} ${run.id}`)
        else {
          const fixture = model.fixtures.find(f => f.id === run.fixtureId), stack = model.symbols.find(s => s.id === run.stackId)
          assert.ok(fixture && stack, label)
          assert.deepEqual(run.path[0], fixture.position); assert.deepEqual(run.path.at(-1), stack.position)
          assert.equal(run.flowDirection, 'forward'); assert.doesNotMatch(run.id, /trunk|interstack/)
        }
      }
      for (const c of model.circuits) {
        assert.deepEqual(connectedLoads(model, c).sort(), c.loads.toSorted(), label)
        assert.deepEqual(c.unroutedLoads, [], label)
        if (c.tag === 'P1') assert.ok(model.utilities.filter(r => r.layer === 'electrical' && r.circuitId === c.id).every(r => r.fromSymbolId === c.panelId), 'power appliances have independent DB branches')
      }
      assert.ok(model.symbols.filter(s => s.type === 'db_panel').every(s => !/bath|toilet|kitchen/i.test(floor.rooms.find(r => r.id === s.roomId).name)), label)
      assert.ok(model.waterNetworks.every(n => !n.unroutedFixtures.length), label)
      assert.ok(model.zones.every(z => z.loopStatus === 'closed' && !z.missingLinks.length), label)
      assert.ok(model.coverage.every(c => ['covered', 'exempt'].includes(c.status)), label)
      for (const s of model.symbols.filter(s => s.type === 'sprinkler')) for (const e of model.symbols.filter(s => s.layer === 'electrical')) assert.ok(Math.hypot(s.position.x - e.position.x, s.position.y - e.position.y) >= 600, label)
    }
    assert.equal(JSON.stringify(design), before, 'utility placement must not change the building, quantities or seed')
  }
})

test('service paths go around a represented column rather than drawing a structural penetration', () => {
  const r = { id: 'r', name: 'Living', rect: { x: 0, y: 0, w: 6000, h: 3000 } }
  const floor = { rooms: [r], walls: [], openings: [], columns: [{ at: { x: 3000, y: 1500 }, size: 800 }] }
  const cuts = utilityObstacles(floor), path = routeThroughDoors({ x: 1000, y: 1500 }, ['r'], { x: 5000, y: 1500 }, 'r', floor, cuts, true, true, 180)
  assert.ok(path); assert.ok(electricalPathAllowed(path, floor, cuts))
  assert.ok(path.some(p => p.y !== 1500))
})
