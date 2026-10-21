import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
registerHooks({ resolve(s, c, next) { return s.startsWith('@/') ? { url: new URL(`../src/${s.slice(2)}`, import.meta.url).href, shortCircuit: true } : next(s, c) } })
const { utilityFloor, utilityWallSections, orthogonal, route } = await import('../src/lib/utilities/plan.ts')
const { defaultBrief } = await import('../src/lib/model/brief.ts')
const { compile } = await import('../src/lib/model/canonical.ts')
const { generate } = await import('../src/lib/engine/generate.ts')
const { furnishSingleRoom } = await import('../src/lib/three/buildDollhouse.ts')
const { estimateBoq } = await import('../src/lib/cost/boq.ts')
const brief = defaultBrief(), design = generate(compile(brief))

test('the viewer reads actual floors and furnishing coordinates without changing design, seed or BOQ', () => {
  const original = JSON.stringify(design), cost = estimateBoq(design)
  for (const floor of design.floors) {
    const view = utilityFloor(design, floor.level)
    assert.equal(view.floor, floor)
    assert.equal(view.sourcePlanId, design.id)
    for (const fixture of view.fixtures.filter(f => f.basis === 'furnishing')) {
      const room = floor.rooms.find(r => r.id === fixture.roomId)
      const piece = furnishSingleRoom(design, floor.level, room.id).find(p => `${floor.level}:${p.id}` === fixture.id)
      assert.ok(piece)
      assert.equal(fixture.position.x, Math.round(room.rect.x + room.rect.w / 2 + piece.pos[0] * 1000))
      assert.equal(fixture.position.y, Math.round(room.rect.y + room.rect.h / 2 + piece.pos[2] * 1000))
    }
    for (const run of view.utilities.filter(u => u.layer === 'drainage')) {
      assert.ok(orthogonal(run.path))
      assert.deepEqual(run.path[0], view.fixtures.find(f => f.id === run.fixtureId).position)
      assert.deepEqual(run.path.at(-1), view.symbols.find(s => s.id === run.stackId).position)
      const r = floor.rooms.find(r => r.id === run.roomId).rect
      assert.ok(run.path.every(p => p.x >= r.x - 1 && p.y >= r.y - 1 && p.x <= r.x + r.w + 1 && p.y <= r.y + r.h + 1), 'A branch cannot cut across another room or courtyard')
    }
  }
  assert.equal(JSON.stringify(design), original)
  assert.deepEqual(estimateBoq(design), cost)
})

test('pipe materials and diameters follow the current specification without changing fixture geometry', () => {
  const a = utilityFloor(design, 0)
  const b = utilityFloor(design, 0, { ...brief, specs: { overrides: { 'waste-pipe-size': 'mm50', 'soil-pipe-size': 'mm160' } } })
  assert.ok(b.utilities.length > 0)
  assert.deepEqual(a.fixtures, b.fixtures)
  for (const run of b.utilities.filter(u => u.layer === 'drainage')) assert.equal(run.diameter, b.fixtures.find(f => f.id === run.fixtureId).type === 'toilet' ? 160 : 50)
})

test('shared wet-room walls get a shared proposal, disconnected rooms do not get a route through living areas', () => {
  const base = design.floors[0], room = (id, x) => ({ id, semanticId: id, name: 'Bathroom', zone: 'service', rect: { x, y: 0, w: 3000, h: 3000 }, area: 9, outdoor: false, wantsWindow: true })
  const rooms = [room('bath1', 0), room('bath2', 3000), room('bath3', 12000)]
  const floor = { ...base, rooms, walls: [], openings: [], footprint: rooms.map(r => r.rect), courtyard: null, doubleHeightVoids: [] }
  const model = utilityFloor({ ...design, floors: [floor] }, floor.level)
  assert.equal(model.symbols.filter(s => s.layer === 'drainage').length, 2)
  assert.ok(model.symbols.some(s => s.roomIds.length === 2))
  assert.ok(model.symbols.some(s => s.roomIds.length === 1 && s.roomIds[0] === 'bath3'))
})

test('slabs preserve courtyard and double-height holes, and no-wet-room floors are explicitly empty', () => {
  const base = design.floors[0], hole = { x: 1000, y: 1000, w: 1500, h: 1500 }
  const floor = { ...base, footprint: [{ x: 0, y: 0, w: 6000, h: 6000 }], courtyard: hole,
    doubleHeightVoids: [{ id: 'void', rect: { x: 4000, y: 4000, w: 1000, h: 1000 } }], rooms: [] }
  const model = utilityFloor({ ...design, floors: [floor] }, floor.level)
  assert.equal(model.slabs.reduce((n, r) => n + r.w * r.h, 0), 36000000 - 2250000 - 1000000)
  assert.equal(model.fixtures.length, 0); assert.equal(model.utilities.length, 0)
  assert.throws(() => utilityFloor(design, 999), /not present/)
})

test('the shared wall model preserves door gaps and window sill/head heights for the 3D view', () => {
  const floor = { ...design.floors[0], walls: [{ a: { x: 0, y: 0 }, b: { x: 6000, y: 0 }, kind: 'exterior', thickness: 200 }],
    openings: [{ kind: 'door', at: { x: 1500, y: 0 }, orient: 'h', width: 1000, head: 2200 }, { kind: 'window', at: { x: 4500, y: 0 }, orient: 'h', width: 1000, sill: 900, head: 2100 }] }
  const sections = utilityWallSections(floor, 3000)
  const door = sections.filter(s => s.a.x === 1000 && s.b.x === 2000)
  assert.deepEqual(door.map(s => [s.base, s.height]), [[2200, 800]])
  const window = sections.filter(s => s.a.x === 4000 && s.b.x === 5000)
  assert.deepEqual(window.map(s => [s.base, s.height]), [[0, 900], [2100, 900]])
  assert.deepEqual(route({ x: 1, y: 2 }, { x: 3, y: 4 }), [{ x: 1, y: 2 }, { x: 3, y: 2 }, { x: 3, y: 4 }])
})
