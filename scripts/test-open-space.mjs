import test from 'node:test'
import assert from 'node:assert/strict'
import { compile, planToCompass } from '../src/lib/model/canonical.ts'
import { briefSchema, defaultBrief } from '../src/lib/model/brief.ts'
import { resolveOpenSpace } from '../src/lib/model/openSpace.ts'
import { generate } from '../src/lib/engine/generate.ts'
import { validate } from '../src/lib/rules/index.ts'
import { rectUnionArea } from '../src/lib/geometry.ts'
import { buildMassing } from '../src/lib/three/buildMassing.ts'
import { createBuildingModel } from '../src/lib/engine/buildingModel.ts'
import { overlapsSite } from '../src/lib/engine/planner/siteFeatures.ts'
import { openSpaceBrief } from './fixtures/open-space-brief.mjs'

for (const mode of ['auto', 'perSide', 'chosenSides', 'maxBuild']) test(`${mode}: complete room programme, access, structure and site checks pass`, () => {
  const brief = openSpaceBrief(mode), model = compile(brief), d = generate(model), report = validate(d)
  assert.ok(report.hardChecksPass, JSON.stringify(report.findings.filter(f => f.severity === 'error')))
  assert.deepEqual(generate(model), d)
  assert.ok(rectUnionArea(d.floors[0].footprint) < d.floors[0].outline.w * d.floors[0].outline.h, 'real nonrectangular footprint')
  assert.ok(d.floors.every(f => f.reachable))
  const margins = resolveOpenSpace(brief.site).margins
  for (const r of d.floors.flatMap(f => f.rooms)) {
    const oriented = planToCompass[model.entrySide]
    assert.ok(r.rect.x >= margins[oriented.W] * 1000)
    assert.ok(r.rect.y >= margins[oriented.N] * 1000)
    assert.ok(r.rect.x + r.rect.w <= model.plot.width - margins[oriented.E] * 1000)
    assert.ok(r.rect.y + r.rect.h <= model.plot.depth - margins[oriented.S] * 1000)
  }
  if (mode === 'maxBuild') assert.ok(d.footprintSqm / (model.envelope.width * model.envelope.depth / 1e6) >= 0.85)
  const features = d.siteFeatures
  for (const kind of ['parking', 'driveway', 'lawn', 'pool', 'sitOut', 'utilityYard']) assert.ok(features.some(f => f.kind === kind), kind)
  const drive = features.find(f => f.kind === 'driveway')
  assert.equal(drive.rect.y + drive.rect.h, model.plot.depth, 'driveway reaches the real road edge')
  for (const f of features) assert.ok(!features.some(o => o !== f && overlapsSite(f.rect, o.rect)))
  const boxes = buildMassing(d).boxes
  for (const f of features.filter(f => !f.covered)) {
    const box = boxes.find(b => b.id === f.id)
    assert.ok(box, f.id)
    assert.equal(box.size[0], f.rect.w / 1000); assert.equal(box.size[2], f.rect.h / 1000)
  }
  assert.deepEqual(createBuildingModel(d).siteFeatures, features)
})

test('saved briefs default to auto; legal setbacks override smaller user margins', () => {
  const b = openSpaceBrief('perSide'); b.site.openSpace.metres.N = 1
  assert.equal(resolveOpenSpace(b.site).margins.N, 5)
  assert.ok(resolveOpenSpace(b.site).notes[0].includes('setback'))
  assert.equal(compile(b).setbacksMm.S, 5000)
  assert.equal(briefSchema.parse({}).site.openSpace.mode, 'auto')
})

test('pool toggle adds only a site feature, preserving the room programme', () => {
  const b = openSpaceBrief('chosenSides'), withPool = compile(b)
  b.rooms.pool = false
  assert.deepEqual(compile(b).floors, withPool.floors)
  assert.ok(!generate(compile(b)).siteFeatures.some(f => f.kind === 'pool'))
})

test('default max build uses at least 85% of the buildable site with enclosed and covered outdoor footprint', () => {
  const b = defaultBrief(); b.site.openSpace.mode = 'maxBuild'
  const m = compile(b), d = generate(m)
  assert.ok(validate(d).hardChecksPass)
  assert.ok(d.coveredFootprintSqm / (m.envelope.width * m.envelope.depth / 1e6) >= 0.85)
})
