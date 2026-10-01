import assert from 'node:assert/strict'
import test from 'node:test'
import { createVillaDesignDNA } from '../src/lib/engine/villaDesignDna.ts'
import { MassingGenerator } from '../src/lib/engine/massing/MassingGenerator.ts'
import { ArchitecturalFeatureGenerator } from '../src/lib/engine/facade/ArchitecturalFeatureGenerator.ts'
import { SpecializedGrammarGenerator } from '../src/lib/engine/facade/specialized/SpecializedGrammarGenerator.ts'
import { GRAMMAR_TYPES } from '../src/lib/engine/facade/specialized/types.ts'
import { makeBalcony } from '../src/lib/engine/facade/specialized/balconies.ts'
import { makeEntrance } from '../src/lib/engine/facade/specialized/entrances.ts'
import { makeWindows } from '../src/lib/engine/facade/specialized/windows.ts'
import { makeRoofline } from '../src/lib/engine/facade/specialized/rooflines.ts'
import { makeDepth } from '../src/lib/engine/facade/specialized/depth.ts'
import { validateSpecializedAssemblies } from '../src/lib/engine/facade/specialized/validate.ts'
import { add, assembly, resolveAnchor, wallAnchor } from '../src/lib/engine/facade/specialized/context.ts'

import { sourceFixture, context, cornerFixture, sideFixture, courtEntryFixture } from './fixtures/specialized-building.mjs'

const valid = (ctx, unit) => unit && validateSpecializedAssemblies(ctx, [unit]).length === 0
const signature = u => JSON.stringify(u.parts.map(p => [p.operation, p.anchor.kind, p.local]))

test('all ten balcony grammars have distinct actual geometry on accessible source balconies', () => {
  const standard = context(sourceFixture()), corner = context(cornerFixture()), shapes = new Set()
  for (const type of GRAMMAR_TYPES.BALCONY) {
    const ctx = ['CORNER', 'WRAP'].includes(type) ? corner : standard
    const unit = makeBalcony(ctx, ctx.building.rooms.find(r => r.id === 'balcony1'), type)
    assert.ok(valid(ctx, unit), `${type}: ${JSON.stringify(unit && validateSpecializedAssemblies(ctx, [unit]))}`)
    assert.ok(unit.openingIds.length); shapes.add(signature(unit))
  }
  assert.equal(shapes.size, 10)
})

test('seven entrance grammars preserve the real main door and need a matching source facade', () => {
  const sources = [context(sourceFixture()), context(sourceFixture(18, 24, 2)), context(sideFixture()), context(courtEntryFixture())]
  const shapes = new Set()
  for (const type of GRAMMAR_TYPES.ENTRANCE) {
    const unit = sources.map(ctx => ({ ctx, unit: makeEntrance(ctx, ctx.building.doors.find(d => d.kind === 'entry'), type) })).find(({ ctx, unit }) => valid(ctx, unit))
    assert.ok(unit, `${type}: ${JSON.stringify(sources.map(ctx => { const u = makeEntrance(ctx, ctx.building.doors.find(d => d.kind === 'entry'), type); return u && validateSpecializedAssemblies(ctx, [u]) }))}`); shapes.add(signature(unit.unit))
    assert.ok(unit.ctx.building.doors.some(d => d.kind === 'entry' && unit.unit.openingIds.includes(d.id)))
  }
  assert.equal(shapes.size, 7)
})

test('eight window compositions preserve actual room apertures including explicit tall and corner glazing', () => {
  const b = sourceFixture(), corner = structuredClone(b), tall = structuredClone(b)
  const bed = corner.rooms.find(r => r.id === 'bed3')
  corner.windows.push({ id: 'FF_CORNER_WINDOW', kind: 'window', floorId: bed.floorId, orient: 'v', width: 900, sill: 900,
    at: { x: bed.rect.x, y: bed.rect.y + bed.rect.h - 650 }, rooms: ['bed3', null] })
  corner.planId += '-corner-glazing'
  const living = tall.windows.find(w => w.rooms?.includes('living')); living.sill = 0; living.head = 2800; tall.planId += '-tall'
  const sources = [context(b), context(corner), context(tall)], shapes = new Set()
  for (const type of GRAMMAR_TYPES.WINDOW) {
    let found
    for (const ctx of sources) for (const first of ctx.building.windows) {
      const unit = makeWindows(ctx, [first, ...ctx.building.windows.filter(w => w.id !== first.id)], type)
      if (valid(ctx, unit)) { found = { ctx, unit }; break }
    }
    assert.ok(found, type); shapes.add(signature(found.unit))
    assert.ok(found.unit.sourceRoomIds.every(id => found.ctx.building.rooms.some(r => r.semanticId === id && !r.outdoor)))
  }
  assert.equal(shapes.size, 8)
})

test('eight roofline grammars generate supported solids; usable terrace choices need a clear stair route', () => {
  const sources = [context(sourceFixture()), context(sourceFixture(), true)], shapes = new Set()
  for (const type of GRAMMAR_TYPES.ROOFLINE) {
    const found = sources.map(ctx => ({ ctx, unit: makeRoofline(ctx, type) })).find(({ ctx, unit }) => valid(ctx, unit))
    assert.ok(found, type); shapes.add(signature(found.unit))
  }
  assert.equal(shapes.size, 8)
  const blocked = context(sourceFixture())
  assert.equal(makeRoofline(blocked, 'PERGOLA'), null)
})

test('seven depth profiles change mesh depth, with real cuts and configured cantilevers', () => {
  const ctx = context(sourceFixture()), shapes = new Set()
  for (const type of GRAMMAR_TYPES.DEPTH) {
    const unit = ctx.facade.zones.map(z => makeDepth(ctx, z.id, type)).find(u => valid(ctx, u))
    assert.ok(unit, type); shapes.add(signature(unit))
    if (type.endsWith('RECESS')) assert.equal(unit.parts[0].operation, 'RECESS')
  }
  assert.equal(shapes.size, 7)
})

test('complete seeded grammars are deterministic, preserve the source plan and vary physical geometry', () => {
  const building = sourceFixture(), before = JSON.stringify(building), silhouettes = new Set()
  for (let seed = 1; seed <= 12; seed++) {
    const dna = createVillaDesignDNA(building, seed), massing = MassingGenerator.generate(building, dna)
    const first = ArchitecturalFeatureGenerator.generate(building, dna, massing)
    assert.equal(first.status, 'valid')
    assert.deepEqual(ArchitecturalFeatureGenerator.generate(building, dna, massing), first)
    assert.deepEqual(validateSpecializedAssemblies({ building, dna, massing, facade: first, limits: first.specialized.limits }, first.specialized.assemblies), [])
    silhouettes.add(JSON.stringify(first.specialized.assemblies.map(signature)))
  }
  assert.equal(JSON.stringify(building), before); assert.ok(silhouettes.size >= 8)
})

test('invalid hosts, lost room access, changed coordinates, blocked doors and excessive cantilevers are rejected', () => {
  const ctx = context(sourceFixture())
  const entry = ctx.building.doors.find(d => d.kind === 'entry'), unit = makeEntrance(ctx, entry, 'FLOATING_CANOPY')
  assert.ok(valid(ctx, unit))
  const altered = structuredClone(unit); altered.parts[0].world.x += 1
  assert.ok(validateSpecializedAssemblies(ctx, [altered]).some(i => i.code === 'ARBITRARY_COORDINATES'))
  const missing = structuredClone(unit); missing.openingIds = []
  assert.ok(validateSpecializedAssemblies(ctx, [missing]).some(i => i.code === 'MAIN_DOOR_REQUIRED'))
  const cut = structuredClone(unit); cut.parts[0].local.z = 100; cut.parts[0].world.z = ctx.building.floors[0].elevationMm + 100
  assert.ok(validateSpecializedAssemblies(ctx, [cut]).some(i => i.code === 'DOOR_ACCESS_CONFLICT'))
  const unlimited = structuredClone(unit); unlimited.parts[0].local.d = 9999
  assert.ok(validateSpecializedAssemblies(ctx, [unlimited]).some(i => i.code === 'PROJECTION_LIMIT'))
  const wall = ctx.building.walls.find(w => w.kind === 'exterior' && w.floorId === 'GF' && w.a.y === w.b.y)
  const anchor = wallAnchor(wall), a = resolveAnchor(ctx, anchor)
  const column = ctx.building.columns.find(c => c.floorId === wall.floorId && c.at.y === wall.a.y && c.at.x >= a.x && c.at.x <= a.x + a.w)
  const columnCut = assembly('DEPTH', 'DEEP_RECESS', 'column-cut')
  add(ctx, columnCut, anchor, 'recess', Math.max(0, column.at.x - a.x - 50), -130, 500, 100, 130, 1000, 'stone', 'RECESS')
  assert.ok(validateSpecializedAssemblies(ctx, [columnCut]).some(i => i.code === 'COLUMN_CONFLICT'))
  assert.equal(makeWindows(ctx, [ctx.building.windows[0]], 'FLOOR_TO_CEILING'), null)
  const facade = ArchitecturalFeatureGenerator.generate(ctx.building, ctx.dna, ctx.massing)
  const rejected = SpecializedGrammarGenerator.generate(ctx.building, ctx.dna, ctx.massing, facade, { BALCONY: 'WRAP' })
  assert.equal(rejected.status, 'rejected'); assert.ok(rejected.issues.some(i => i.code === 'GRAMMAR_UNAVAILABLE'))
})
