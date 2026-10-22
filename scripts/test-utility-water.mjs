import test from 'node:test'
import assert from 'node:assert/strict'
import { utilityFloor, UTILITY_LAYERS, displayedRuns, displayedSymbols, selectionForRun, utilityLegend, orthogonal } from '../src/lib/utilities/plan.ts'
import { waterPlan } from '../src/lib/utilities/water.ts'
import { waterScene } from '../src/lib/utilities/water3D.ts'
import { electricalPathAllowed, segmentIntersection } from '../src/lib/utilities/electrical.ts'
import { electricalWorldPoint } from '../src/lib/utilities/electrical3D.ts'
import { defaultBrief } from '../src/lib/model/brief.ts'
import { compile } from '../src/lib/model/canonical.ts'
import { generate } from '../src/lib/engine/generate.ts'
import { estimateBoq } from '../src/lib/cost/boq.ts'

const brief = defaultBrief(), design = generate(compile(brief)), models = design.floors.map(f => utilityFloor(design, f.level))
const visible = Object.fromEntries(Object.entries(UTILITY_LAYERS).map(([id, layer]) => [id, !layer.disabled]))

test('water supply serves actual supply fixtures only: no floor drains, hot toilets or invented dry-room taps', () => {
  assert.equal(UTILITY_LAYERS.water_supply.disabled, false); assert.equal(UTILITY_LAYERS.water_supply.visible, false)
  for (const model of models) {
    const outlets = model.symbols.filter(s => s.layer === 'water_supply' && s.type === 'water_outlet')
    for (const fixture of model.fixtures) {
      const nodes = outlets.filter(n => n.fixtureId === fixture.id)
      if (fixture.type === 'floor_drain') { assert.equal(nodes.length, 0); continue }
      assert.ok(nodes.some(n => n.service === 'cold'), fixture.id)
      assert.equal(nodes.some(n => n.service === 'hot'), fixture.type !== 'toilet')
    }
    for (const n of outlets) assert.ok(model.fixtures.some(f => f.id === n.fixtureId && f.roomId === n.roomId && f.type !== 'floor_drain'))
    assert.ok(model.waterNetworks.every(n => n.sourceBasis === 'unverified'))
    assert.ok(model.waterNetworks.find(n => n.service === 'hot').material.includes('verification'))
  }
})

test('pipe sizes and cold material follow specifications without changing drainage, electrical, fire, identity or cost', () => {
  const before = JSON.stringify(design), cost = estimateBoq(design), base = models[0]
  const changed = utilityFloor(design, base.floor.level, { ...brief, specs: { overrides: { 'water-pipe-size': 'mm15', 'water-riser-size': 'mm50' } } })
  assert.ok(changed.utilities.filter(u => u.layer === 'water_supply').every(u => u.diameter === 15 || u.diameter === 50))
  assert.ok(changed.waterNetworks.every(n => n.branchDiameterMm === 15 && n.riserDiameterMm === 50))
  assert.deepEqual(base.utilities.filter(u => u.layer !== 'water_supply'), changed.utilities.filter(u => u.layer !== 'water_supply'))
  assert.deepEqual(base.fixtures, changed.fixtures)
  assert.equal(JSON.stringify(design), before); assert.deepEqual(estimateBoq(design), cost)
})

test('canonical water runs use actual door-connected orthogonal paths and matching wall-mounted endpoints', () => {
  for (const model of models) {
    const cuts = [...(model.floor.courtyard ? [model.floor.courtyard] : []), ...(model.floor.doubleHeightVoids ?? []).map(v => v.rect)]
    for (const run of model.utilities.filter(u => u.layer === 'water_supply')) {
      const from = model.symbols.find(s => s.id === run.fromSymbolId), to = model.symbols.find(s => s.id === run.toSymbolId)
      assert.ok(orthogonal(run.path)); assert.ok(electricalPathAllowed(run.path, model.floor, cuts))
      assert.deepEqual(run.path[0], from.position); assert.deepEqual(run.path.at(-1), to.position)
      assert.ok(from.mount && to.mount); assert.equal(selectionForRun(run), `water:${run.networkId}`)
    }
    assert.deepEqual(utilityFloor(design, model.floor.level), model)
  }
})

test('3D pipes share the canonical layout and use explicit underfloor door crossings without diagonal shortcuts', () => {
  let crossings = 0
  for (const model of models) {
    const scene = waterScene(model)
    assert.equal(scene.pending.length, 0)
    for (const run of model.utilities.filter(u => u.layer === 'water_supply')) {
      const pipe = scene.pipes.find(p => p.id === run.id), from = model.symbols.find(s => s.id === run.fromSymbolId), to = model.symbols.find(s => s.id === run.toSymbolId)
      assert.ok(pipe); assert.deepEqual(pipe.points[0], electricalWorldPoint(from.position, from.mount.elevationMm)); assert.deepEqual(pipe.points.at(-1), electricalWorldPoint(to.position, to.mount.elevationMm))
      for (let i = 1; i < pipe.points.length; i++) {
        const a = pipe.points[i - 1], b = pipe.points[i]
        assert.ok(b.filter((v, j) => Math.abs(v - a[j]) > .00001).length <= 1)
        for (const w of model.floor.walls) {
          const p = segmentIntersection({ x: a[0] * 1000, y: a[2] * 1000 }, { x: b[0] * 1000, y: b[2] * 1000 }, w.a, w.b)
          if (!p) continue
          assert.ok(Math.abs(a[1] + .08) < .00001 && Math.abs(b[1] + .08) < .00001); crossings++
        }
      }
    }
  }
  assert.ok(crossings > 0)
})

test('cold/hot filters, hiding water and the hot-proposal switch preserve all other layers and update the legend', () => {
  const model = models[0], cold = model.waterNetworks.find(n => n.service === 'cold'), hot = model.waterNetworks.find(n => n.service === 'hot')
  const shown = displayedRuns(model, visible, 'all', 'all', 'all', cold.id)
  assert.ok(shown.some(u => u.layer === 'water_supply')); assert.ok(shown.filter(u => u.layer === 'water_supply').every(u => u.networkId === cold.id))
  assert.deepEqual(displayedRuns(model, { ...visible, water_supply: false }), model.utilities.filter(u => u.layer !== 'water_supply'))
  assert.ok(displayedSymbols(model, visible, 'all', 'all', 'all', hot.id).filter(s => s.layer === 'water_supply').every(s => s.service === 'hot'))
  assert.ok(waterScene(model, 'all', 'all', false).nodes.every(n => n.service === 'cold'))
  assert.ok(waterScene(model, 'all', hot.id).fixtures.every(f => f.type !== 'toilet'))
  assert.ok(utilityLegend(model, visible).some(e => e.symbol === 'isolation_valve'))
  assert.ok(!utilityLegend(model, { ...visible, water_supply: false }).some(e => e.symbol === 'water_outlet'))
})

test('missing source walls/doors expose pending water connections rather than fabricated supply paths', () => {
  const model = models[0], floor = { ...model.floor, walls: [], openings: [] }
  const proposal = waterPlan(floor, [], model.fixtures, brief)
  assert.equal(proposal.utilities.length, 0); assert.equal(proposal.symbols.length, 0)
  assert.ok(proposal.notes.length > 0); assert.ok(proposal.networks.some(n => n.unroutedFixtures.length > 0))
  const empty = waterPlan({ ...floor, rooms: [] }, [], [], brief)
  assert.deepEqual(empty.utilities, []); assert.deepEqual(empty.networks, [])
})
