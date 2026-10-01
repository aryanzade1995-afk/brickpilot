import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { sourceFixture, cornerFixture, context } from './specialized-building.mjs'
import { makeBalcony } from '../../src/lib/engine/facade/specialized/balconies.ts'
import { makeEntrance } from '../../src/lib/engine/facade/specialized/entrances.ts'
import { makeRoofline } from '../../src/lib/engine/facade/specialized/rooflines.ts'
import { makeDepth } from '../../src/lib/engine/facade/specialized/depth.ts'
import { validateSpecializedAssemblies } from '../../src/lib/engine/facade/specialized/validate.ts'

// Isolate difficult geometry for real Blender runtime checks. These fixtures
// have checked source plans and no hero, so the recipe itself is visible.
await mkdir('output', { recursive: true })
for (const [name, building, bareRoof, depthType] of [
  ['specialized-recess', sourceFixture(), false, 'DEEP_RECESS'],
  ['specialized-corner-terrace', cornerFixture(), true, 'SHALLOW_RECESS'],
]) {
  const ctx = context(building, bareRoof), assemblies = []
  const append = unit => {
    assert.ok(unit, `No compatible ${name} recipe`)
    assert.deepEqual(validateSpecializedAssemblies(ctx, [...assemblies, unit]), [])
    assemblies.push(unit)
  }
  append(makeBalcony(ctx, building.rooms.find(r => r.id === 'balcony1'), bareRoof ? 'WRAP' : 'RECESSED'))
  append(makeEntrance(ctx, building.doors.find(d => d.kind === 'entry'), 'RECESSED_ENTRY'))
  append(makeRoofline(ctx, bareRoof ? 'PERGOLA' : 'STEPPED_PARAPET'))
  const depth = ctx.facade.zones.map(z => makeDepth(ctx, z.id, depthType))
    .find(u => u && !validateSpecializedAssemblies(ctx, [...assemblies, u]).length)
  append(depth)
  ctx.facade.specialized = { schemaVersion: 1, sourcePlanId: building.planId, seed: ctx.dna.seed,
    status: 'valid', issues: [], omissions: [], assemblies, limits: ctx.limits }
  await writeFile(`output/${name}.json`, JSON.stringify({ schemaVersion: 1,
    buildingModel: building, massingModel: ctx.massing, villaDesignDNA: ctx.dna, facadeGrammar: ctx.facade }, null, 2))
  console.log(`output/${name}.json`)
}
