import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { defaultBrief } from '../src/lib/model/brief.ts'
import { compile } from '../src/lib/model/canonical.ts'
import { generate } from '../src/lib/engine/generate.ts'
import { utilityFloor } from '../src/lib/utilities/plan.ts'
import { detectClashes, createClashCache, reviewClash, applyClashReview, parseClashReviews } from '../src/lib/utilities/clashes.ts'
import { CLASH_RULES } from '../src/lib/utilities/clashRules.ts'
import { segmentDistance, segmentPolygon } from '../src/lib/utilities/clashGeometry.ts'
import { clashCsv } from '../src/lib/utilities/clashReport.ts'

const design = generate(compile(defaultBrief())), base = utilityFloor(design, 0)
const room = { ...base.floor.rooms[0], id: 'bath', semanticId: 'bath', name: 'Bathroom', outdoor: false, rect: { x: 0, y: 0, w: 5000, h: 5000 } }
const empty = { ...base, floor: { ...base.floor, rooms: [room], walls: [], openings: [], courtyard: null, doubleHeightVoids: [] }, utilities: [], symbols: [], circuits: [], waterNetworks: [], zones: [], wallSections: [], exitRoutes: [], coverage: [] }
const run = (id, layer, path, extra = {}) => ({ id, layer, path: path.map(([x, y]) => ({ x, y })), roomId: 'bath', ...extra })
const wire = run('w', 'electrical', [[400, 1000], [2400, 1000]], { circuitId: 'L1', fromSymbolId: 'db', toSymbolId: 'load' })
const drain = run('d', 'drainage', [[1400, 400], [1400, 1800]], { fixtureId: 'drain', stackId: 'stack', diameter: 50 })
const supply = run('s', 'water_supply', [[1400, 400], [1400, 1800]], { networkId: 'cold', service: 'cold', fromSymbolId: 'source', toSymbolId: 'tap', diameter: 20 })
const only = (...ids) => CLASH_RULES.filter(r => ids.includes(r.id))

test('finite segment geometry handles crossings, points, parallel and skew lines and polygon containment', () => {
  assert.equal(segmentDistance([0, 0, 0], [10, 0, 0], [5, -5, 0], [5, 5, 0]).distance, 0)
  assert.equal(segmentDistance([0, 0, 0], [10, 0, 0], [5, -5, 80], [5, 5, 80]).distance, 80)
  assert.equal(segmentDistance([0, 0, 0], [10, 0, 0], [0, 30, 0], [10, 30, 0]).distance, 30)
  assert.equal(segmentDistance([5, 3, 0], [5, 3, 0], [0, 0, 0], [10, 0, 0]).distance, 3)
  const poly = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]
  assert.equal(segmentPolygon({ x: -5, y: 5 }, { x: 15, y: 5 }, poly), true)
  assert.equal(segmentPolygon({ x: 3, y: 3 }, { x: 6, y: 6 }, poly), true)
  assert.equal(segmentPolygon({ x: -5, y: -5 }, { x: -1, y: -1 }, poly), false)
})

test('unknown elevations are review-only, known separated heights remove projected clashes, same height produces HARD', () => {
  const model = { ...empty, utilities: [wire, drain] }, rules = only('wire-drain')
  const pending = detectClashes(model, { rules })
  assert.equal(pending.length, 1); assert.equal(pending[0].certainty, 'needs-verification'); assert.equal(pending[0].distanceBasis, 'plan'); assert.notEqual(pending[0].type, 'HARD')
  assert.equal(detectClashes(model, { rules, layerElevationsMm: { electrical: 2400, drainage: -300 } }).length, 0)
  const physical = detectClashes(model, { rules, layerElevationsMm: { electrical: -300, drainage: -300 } })
  assert.equal(physical[0].type, 'HARD'); assert.equal(physical[0].distanceBasis, '3d'); assert.equal(physical[0].elevationMm, -300)
})

test('physical pipe radii and explicit mm clearances are used without screen scale', () => {
  const parallel = { ...supply, path: wire.path.map(p => ({ x: p.x, y: p.y + 39 })) }
  const clashes = detectClashes({ ...empty, utilities: [wire, parallel] }, { rules: only('wire-water'), layerElevationsMm: { electrical: 1000, water_supply: 1000 } })
  assert.equal(clashes.length, 1); assert.equal(clashes[0].distance, 29)
  assert.deepEqual(clashes, detectClashes({ ...empty, utilities: [parallel, wire] }, { rules: only('wire-water'), layerElevationsMm: { electrical: 1000, water_supply: 1000 } }))
})

test('wet-only checks do not flag dry rooms; rules can be added by config', () => {
  const model = { ...empty, utilities: [wire, supply], floor: { ...empty.floor, rooms: [{ ...room, id: 'study', semanticId: 'study', name: 'Study' }] } }
  assert.equal(detectClashes(model, { rules: only('wire-water') }).length, 0)
  const custom = { ...only('wire-water')[0], id: 'custom', wetAreaOnly: false, message: 'Custom review', minDistMm: 42 }
  assert.equal(detectClashes(model, { rules: [custom] })[0].rule, 'Custom review')
})

test('supply below drain is a concept CODE issue even with large vertical separation; correct order is clear', () => {
  const model = { ...empty, utilities: [supply, { ...drain, path: wire.path }] }, rules = only('supply-drain')
  const bad = detectClashes(model, { rules, layerElevationsMm: { water_supply: -500, drainage: -200 } })
  assert.equal(bad.length, 1); assert.equal(bad[0].type, 'CODE'); assert.equal(bad[0].certainty, 'concept-model')
  assert.equal(detectClashes(model, { rules, layerElevationsMm: { water_supply: -100, drainage: -300 } }).length, 0)
})

test('shared drain-stack junctions are excluded but unrelated drain crossings are reported', () => {
  const a = run('a', 'drainage', [[500, 1000], [1400, 1000]], { fixtureId: 'a-fixture', stackId: 'shared', diameter: 50 })
  const b = run('b', 'drainage', [[1400, 500], [1400, 1000]], { fixtureId: 'b-fixture', stackId: 'shared', diameter: 50 })
  const symbol = { id: 'shared', layer: 'drainage', type: 'vertical_stack', position: { x: 1400, y: 1000 }, roomIds: ['bath'] }
  assert.equal(detectClashes({ ...empty, utilities: [a, b], symbols: [symbol] }, { rules: only('drain-crossing') }).length, 0)
  assert.equal(detectClashes({ ...empty, utilities: [a, { ...b, stackId: 'other' }], symbols: [symbol] }, { rules: only('drain-crossing') }).length, 1)
})

test('hot/cold and sprinkler/electrical checks include symbols and have correct layer pairs', () => {
  const hot = { ...supply, id: 'h', service: 'hot', networkId: 'hot', path: supply.path.map(p => ({ ...p, x: p.x + 35 })) }
  const hotCold = detectClashes({ ...empty, utilities: [hot, supply] }, { rules: only('hot-cold'), layerElevationsMm: { water_supply: 600 } })
  assert.equal(hotCold.length, 1); assert.equal(hotCold[0].severity, 'low'); assert.equal(hotCold[0].distance, 15)
  const sprinkler = { id: 'sprinkler', layer: 'fire_alarm', type: 'sprinkler', position: { x: 1000, y: 1000 }, roomId: 'bath', roomIds: ['bath'], zoneId: 'z' }
  const socket = { id: 'socket', layer: 'electrical', type: 'socket', position: { x: 1020, y: 1000 }, roomId: 'bath', roomIds: ['bath'], circuitIds: ['P1'] }
  const m = { ...empty, symbols: [sprinkler, socket] }, rules = only('sprinkler-power')
  assert.equal(detectClashes(m, { rules })[0].distance, 20)
  assert.equal(detectClashes(m, { rules, itemElevationsMm: { sprinkler: 2800, socket: 450 } }).length, 0)
})

test('solid wall sections flag penetrations but represented door openings allow a known-height crossing', () => {
  const wall = { id: 'wall', a: { x: 1400, y: 0 }, b: { x: 1400, y: 2500 }, thickness: 200, base: 0, height: 3000 }
  const m = { ...empty, utilities: [wire], wallSections: [wall] }, rules = only('service-wall')
  assert.equal(detectClashes(m, { rules, layerElevationsMm: { electrical: 1000 } })[0].itemB, 'wall')
  const door = [{ ...wall, id: 'bottom', b: { x: 1400, y: 500 } }, { ...wall, id: 'top', a: { x: 1400, y: 1500 } }, { ...wall, id: 'head', a: { x: 1400, y: 500 }, b: { x: 1400, y: 1500 }, base: 2100, height: 900 }]
  assert.equal(detectClashes({ ...m, wallSections: door }, { rules, layerElevationsMm: { electrical: 1000 } }).length, 0)
  assert.equal(detectClashes({ ...m, wallSections: door }, { rules, layerElevationsMm: { electrical: 2400 } }).length, 1)
  const cache = createClashCache()
  const initial = detectClashes(m, { rules, cache, layerElevationsMm: { electrical: 1000 } })
  assert.deepEqual(detectClashes(m, { rules, cache, layerElevationsMm: { electrical: 1000 } }), initial)
  assert.equal(detectClashes({ ...m, wallSections: door }, { rules, cache, layerElevationsMm: { electrical: 1000 } }).length, 0, 'Changed door geometry invalidates the structural cache')
})

test('fire coverage and exit checks use the same engine and ignore exempt rooms', () => {
  const m = { ...empty, coverage: [{ roomId: 'bath', status: 'exempt', detectorIds: [] }], exitRoutes: [{ id: 'exit', fromRoomId: 'bath', path: [], status: 'no-exit', exitId: null, reason: 'No represented exit' }] }
  const result = detectClashes(m, { rules: only('exit-wall', 'coverage') })
  assert.equal(result.length, 1); assert.equal(result[0].rule, 'No represented exit route')
  assert.equal(detectClashes({ ...m, coverage: [{ roomId: 'bath', status: 'partial', detectorIds: [] }] }, { rules: only('exit-wall', 'coverage') }).length, 2)
  const wall = { id: 'blocked-wall', a: { x: 1400, y: 0 }, b: { x: 1400, y: 3000 }, thickness: 200, kind: 'interior' }
  const imported = { ...empty, floor: { ...empty.floor, walls: [wall] }, exitRoutes: [{ id: 'stale-exit', fromRoomId: 'bath', path: [{ x: 500, y: 1000 }, { x: 2400, y: 1000 }], status: 'concept', exitId: 'entry', reason: null }] }
  const blocked = detectClashes(imported, { rules: only('exit-wall') })
  assert.equal(blocked[0].rule, 'Exit route blocked by a wall without a door'); assert.deepEqual(blocked[0].position, { x: 1400, y: 1000 })
  const door = { id: 'door', kind: 'door', orient: 'v', at: { x: 1400, y: 1000 }, width: 900 }
  assert.equal(detectClashes({ ...imported, floor: { ...imported.floor, openings: [door] } }, { rules: only('exit-wall') }).length, 0)
  assert.equal(detectClashes({ ...imported, floor: { ...imported.floor, openings: [{ ...door, kind: 'window' }] } }, { rules: only('exit-wall') }).length, 1)
})

test('stable IDs, saved review validation and changed-geometry/rule re-review never hide a new issue', () => {
  const model = { ...empty, utilities: [wire, drain] }, rules = only('wire-drain'), clash = detectClashes(model, { rules })[0]
  const review = reviewClash(clash, 'resolved', 'Checked with designer'), records = parseClashReviews(JSON.parse(JSON.stringify({ version: 1, records: { [clash.id]: review } })))
  assert.equal(applyClashReview(clash, records).status, 'resolved')
  const moved = detectClashes({ ...model, utilities: [{ ...wire, path: wire.path.map(p => ({ ...p, y: p.y + 10 })) }, drain] }, { rules })[0]
  assert.equal(moved.id, clash.id); assert.equal(applyClashReview(moved, records).status, 'open'); assert.equal(applyClashReview(moved, records).needsReview, true)
  const changedRule = detectClashes(model, { rules: [{ ...rules[0], minDistMm: 50 }] })[0]
  assert.equal(applyClashReview(changedRule, records).status, 'open')
  assert.throws(() => reviewClash(clash, 'ignored', '  '), /reason/)
  assert.deepEqual(parseClashReviews({ version: 42, records }), {})
  assert.deepEqual(parseClashReviews({ version: 1, records: { [clash.id]: { ...review, status: 'ignored', note: '' } } }), {})
})

test('500+ segments use spatial buckets and reuse unchanged pair checks; deletion evicts stale results', () => {
  const utilities = Array.from({ length: 300 }, (_, i) => [run(`w${i}`, 'electrical', [[i * 10000, 100], [i * 10000 + 1000, 100]], { circuitId: `P${i}` }), run(`d${i}`, 'drainage', [[i * 10000 + 500, 0], [i * 10000 + 500, 200]], { diameter: 50 })]).flat()
  const m = { ...empty, utilities }, rules = [{ ...only('wire-drain')[0], wetAreaOnly: false }], cache = createClashCache()
  const first = detectClashes(m, { rules, cache })
  assert.equal(first.length, 300); assert.equal(cache.stats.segments, 600); assert.ok(cache.stats.candidates < 3000)
  assert.deepEqual(detectClashes(m, { rules, cache }), first); assert.equal(cache.stats.checked, 0); assert.equal(cache.stats.reused, 300)
  detectClashes({ ...m, utilities: utilities.map((u, i) => i === 0 ? { ...u, path: u.path.map(p => ({ ...p, y: p.y + 5 })) } : u) }, { rules, cache })
  assert.equal(cache.stats.checked, 1); assert.equal(cache.stats.reused, 299)
  assert.equal(detectClashes({ ...m, utilities: [] }, { rules, cache }).length, 0); assert.equal(cache.pairs.size, 0)
})

test('detection never mutates source plans, routes, costs, geometry or existing 3D elevations', () => {
  const before = JSON.stringify(base)
  assert.deepEqual(detectClashes(base), detectClashes(base)); assert.equal(JSON.stringify(base), before)
  for (const result of detectClashes(base)) assert.ok(Number.isFinite(result.position.x) && Number.isFinite(result.position.y))
})

test('CSV quotes notes, prevents spreadsheet formulas and preserves unknown distances/heights', () => {
  const c = detectClashes({ ...empty, utilities: [wire, drain] }, { rules: only('wire-drain') })[0]
  const csv = clashCsv([{ ...c, note: '=HYPERLINK("bad")\nreview' }], empty, 'Villa, "A"')
  assert.match(csv, /"Villa, ""A"""/); assert.match(csv, /'\=HYPERLINK/); assert.match(csv, /needs-verification/); assert.match(csv, /not statutory/)
})

test('viewer has a single clash source with debounce, separate review undo and no new route optimiser', () => {
  const overlay = readFileSync(new URL('../src/lib/utilities/overlays.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(overlay, /function (utilityWarnings|fireWarnings)/)
  const hook = readFileSync(new URL('../src/components/utilities/useUtilityClashes.ts', import.meta.url), 'utf8')
  assert.match(hook, /detectClashes/); assert.match(hook, /200\)/); assert.match(hook, /formstead.utility-clash-reviews.v1/)
  const engine = readFileSync(new URL('../src/lib/utilities/clashes.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(engine, /routeAStar|reroute|reRoute|updateSolar|useStudio|estimateBoq/)
})
