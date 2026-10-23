import test from 'node:test'
import assert from 'node:assert/strict'
import { clusterDrainageNodes, drainageLabels, drainageTrace, drainageFlowMarkers, utilityTooltipPosition } from '../src/lib/utilities/drainagePresentation.ts'

const node = (id, kind, x, y) => ({ id, kind, position: { x, y }, elevationMm: null, roomId: 'bath', service: 'waste', basis: 'proposal' })
const pipe = (id, from, to, path, service = 'waste') => ({ id, from, to, path, service, lengthMm: 3000, vertical: false, fixtureIds: ['fixture'], dfu: 1, diameterMm: 50, gradientRatio: null, inletInvertMm: null, outletInvertMm: null, sizingBasis: '', state: 'blocked', roomId: 'bath' })

test('zoom grouping retains every original component once, including overlapping stack services', () => {
  const nodes = [node('trap:fixture', 'trap', 0, 0), node('stack', 'stack', 700, 0), node('CO:stack', 'cleanout', 700, 0), node('vent', 'vent_terminal', 700, 0), node('out', 'outlet', 5000, 0)], before = structuredClone(nodes)
  const overview = clusterDrainageNodes(nodes, .02), detail = clusterDrainageNodes(nodes, .1)
  assert.ok(overview.length < detail.length); assert.deepEqual(overview.flatMap(g => g.nodes.map(n => n.id)).sort(), nodes.map(n => n.id).sort())
  assert.deepEqual(overview, clusterDrainageNodes([...nodes].reverse(), .02)); assert.deepEqual(nodes, before)
  assert.equal(overview[0].anchor.id, 'stack'); assert.equal(detail.find(g => g.anchor.id === 'stack').nodes.length, 3)
})
test('selected branches trace only represented downstream paths, including semantic trap/cleanout access', () => {
  const pipes = [pipe('branch', 'fixture', 'stack', [{ x: 0, y: 0 }, { x: 2000, y: 0 }]), pipe('vertical', 'stack', 'base', [{ x: 2000, y: 0 }, { x: 2000, y: 0 }]), pipe('collector', 'base', 'out', [{ x: 2000, y: 0 }, { x: 5000, y: 0 }], 'building_drain'), pipe('other', 'other-fixture', 'other-stack', [{ x: 0, y: 1000 }, { x: 1000, y: 1000 }]), pipe('vent', 'stack', 'terminal', [{ x: 2000, y: 0 }, { x: 2000, y: 0 }], 'vent')]
  const design = { pipes, nodes: [], checks: [] }, before = structuredClone(design)
  assert.deepEqual([...drainageTrace(design, 'branch').pipes].sort(), ['branch', 'collector', 'vertical'])
  assert.deepEqual([...drainageTrace(design, 'trap:fixture').pipes].sort(), ['branch', 'collector', 'vertical'])
  assert.ok(drainageTrace(design, 'CO:stack').pipes.has('vertical')); assert.deepEqual(design, before)
  assert.equal(pipes[0].state, 'blocked', 'Highlighting cannot clear a source validation failure')
  assert.equal(drainageTrace({ ...design, pipes: [pipes[0]] }, 'branch').pipes.size, 1, 'No outlet/collector may be invented')
})
test('direction markers leave short branches clear and stay on actual long polylines', () => {
  assert.deepEqual(drainageFlowMarkers([{ x: 0, y: 0 }, { x: 100, y: 0 }], .02), [])
  const arrows = drainageFlowMarkers([{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 5000 }], .05)
  assert.ok(arrows.length < 4)
  for (const p of arrows) assert.ok(p.y === 0 && p.x >= 0 && p.x <= 1000 || p.x === 1000 && p.y >= 0 && p.y <= 5000)
})
test('technical labels never cover each other, protected room text, or leave the viewport', () => {
  const pipes = [pipe('a', 'f1', 's', [{ x: 0, y: 0 }, { x: 3000, y: 0 }]), pipe('b', 'f2', 's', [{ x: 0, y: 0 }, { x: 3000, y: 0 }])], viewport = { x: -2000, y: -2000, w: 8000, h: 5000 }, protectedRects = [{ x: 1000, y: -650, w: 2000, h: 500 }]
  const overlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
  assert.equal(drainageLabels(pipes, .02, null, false, [], viewport).length, 0)
  const labels = drainageLabels(pipes, .1, null, true, protectedRects, viewport)
  assert.equal(labels.length, 2); assert.ok(!overlap(labels[0].rect, labels[1].rect))
  for (const l of labels) { assert.ok(!protectedRects.some(r => overlap(r, l.rect))); assert.ok(l.rect.x >= viewport.x && l.rect.y >= viewport.y && l.rect.x + l.rect.w <= viewport.x + viewport.w && l.rect.y + l.rect.h <= viewport.y + viewport.h) }
  assert.equal(drainageLabels([{ ...pipes[0], diameterMm: null }], .1, null, true, [], viewport).length, 0)
  assert.match(drainageLabels([{ ...pipes[0], diameterMm: null }], .1, 'a', false, [], viewport)[0].text, /Size pending/)
})
test('measured tooltip placement stays inside narrow canvases near each corner', () => {
  for (const anchor of [{ x: 0, y: 0 }, { x: 370, y: 470 }, { x: 180, y: 200 }]) {
    const p = utilityTooltipPosition(anchor, { w: 292, h: 300 }, { w: 380, h: 480 })
    assert.ok(p.x >= 12 && p.y >= 12 && p.x + 292 <= 368 && p.y + 300 <= 468)
  }
})
