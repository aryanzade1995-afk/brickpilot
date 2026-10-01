import assert from 'node:assert/strict'
import test from 'node:test'
import { defaultBrief } from '../src/lib/model/brief.ts'
import { compile } from '../src/lib/model/canonical.ts'
import { generate } from '../src/lib/engine/generate.ts'
import { createBlenderInput } from './export-blender-input.mjs'

test('Blender handoff is deterministic and all four inputs share one verified plan', () => {
  const brief = defaultBrief()
  const design = generate(compile(brief), { seed: 41 })
  const first = createBlenderInput(design, 41)
  assert.equal(JSON.stringify(createBlenderInput(design, 41)), JSON.stringify(first))
  const { buildingModel, massingModel, villaDesignDNA, facadeGrammar } = first
  assert.equal(first.schemaVersion, 1)
  assert.equal(massingModel.sourcePlanId, buildingModel.planId)
  assert.equal(villaDesignDNA.sourcePlanId, buildingModel.planId)
  assert.equal(facadeGrammar.sourcePlanId, buildingModel.planId)
  assert.equal(massingModel.status, 'valid')
  assert.equal(facadeGrammar.status, 'valid')
  assert.ok(facadeGrammar.features.length > 0)
  assert.ok(buildingModel.doors.length > 0 && buildingModel.windows.length > 0)
})

test('Blender handoff refuses a damaged plan', () => {
  const design = generate(compile(defaultBrief()), { seed: 41 })
  design.floors[0].rooms[0].rect.w = 1
  assert.throws(() => createBlenderInput(design, 41), /failed validation/)
})

test('courtyard design exports its true plan void and source balcony', () => {
  const brief = defaultBrief()
  brief.site.plotWidth = 25
  brief.site.plotDepth = 25
  brief.rooms.priorities.courtyard = true
  const design = generate(compile(brief), { massing: 'courtyard', seed: 41 })
  const payload = createBlenderInput(design, 41)
  assert.ok(payload.buildingModel.floors.some((floor) => floor.courtyard))
  assert.ok(payload.buildingModel.rooms.some((room) => room.id.startsWith('balcony')))
  assert.ok(payload.massingModel.masses.some((mass) => mass.usage === 'terrace'))
})
