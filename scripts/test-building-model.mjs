import assert from 'node:assert/strict'
import test from 'node:test'
import { defaultBrief } from '../src/lib/model/brief.ts'
import { compile } from '../src/lib/model/canonical.ts'
import { generate } from '../src/lib/engine/generate.ts'
import { createBuildingModel } from '../src/lib/engine/buildingModel.ts'
import { createVillaDesignDNA, villaGeometrySignature } from '../src/lib/engine/villaDesignDna.ts'
import { varyExterior } from '../src/lib/engine/variation.ts'
import { validate } from '../src/lib/rules/index.ts'
import { rectUnionArea } from '../src/lib/geometry.ts'
import { assessMassingFamilies } from '../src/lib/engine/massing/families.ts'

const makePlan = () => {
  const brief = defaultBrief()
  brief.site.plotWidth = 18
  brief.site.plotDepth = 24
  const design = generate(compile(brief), { seed: 41 })
  assert.ok(validate(design).hardChecksPass)
  return design
}
const withoutFloorId = (item) => {
  const copy = { ...item }
  delete copy.floorId
  return copy
}

test('BuildingModel is a faithful, detached serialization of the verified 2D plan', () => {
  const design = makePlan()
  const building = createBuildingModel(design)
  assert.equal(building.units, 'mm')
  assert.equal(building.floors.length, design.floors.length)
  assert.equal(building.plot.widthMm, design.model.plot.width)
  assert.deepEqual(building.setbacks, design.model.setbacksMm)
  assert.equal(building.orientation.plateFamily, design.structure.family)

  for (const floor of design.floors) {
    const id = floor.prefix
    const out = building.floors.find((f) => f.id === id)
    assert.ok(out)
    assert.deepEqual(out.footprint, floor.footprint)
    assert.deepEqual(out.outline, floor.outline)
    assert.deepEqual(building.rooms.filter((r) => r.floorId === id).map(withoutFloorId), floor.rooms)
    assert.deepEqual(building.walls.filter((w) => w.floorId === id).map(withoutFloorId), floor.walls)
    assert.deepEqual(building.doors.filter((o) => o.floorId === id).map(withoutFloorId),
      floor.openings.filter((o) => o.kind !== 'window'))
    assert.deepEqual(building.windows.filter((o) => o.floorId === id).map(withoutFloorId),
      floor.openings.filter((o) => o.kind === 'window'))
    assert.deepEqual(building.slabs.filter((s) => s.floorId === id).map((s) => s.rect), floor.footprint)
    assert.deepEqual(building.columns.filter((c) => c.floorId === id).map(withoutFloorId), floor.columns)
    assert.deepEqual(building.beams.filter((b) => b.floorId === id).map(withoutFloorId), floor.structuralSizing.beams)
    assert.ok(building.slabs.filter(s=>s.floorId===id).every(s=>s.thicknessMm===floor.structuralSizing.slabThicknessMm))
    if (floor.stair) assert.deepEqual(building.stairs.find((s) => s.floorId === id).rect, floor.stair.rect)
  }

  const originalX = design.floors[0].rooms[0].rect.x
  building.rooms[0].rect.x += 100
  assert.equal(design.floors[0].rooms[0].rect.x, originalX, 'the adapter must not mutate the plan')
  assert.deepEqual(JSON.parse(JSON.stringify(createBuildingModel(design))), createBuildingModel(design))
})

test('the same plan has one BuildingModel even when exterior seeds change', () => {
  const plan = makePlan()
  const expected = createBuildingModel(plan)
  for (const seed of [1, 2, 57, 9001]) {
    const exterior = varyExterior(plan, seed)
    assert.deepEqual(createBuildingModel(exterior), expected)
  }
})
test('technical sizing changes source identity but retains the architectural seed namespace',()=>{
  const d=makePlan(),old=createBuildingModel(d)
  d.model.brief.specs.overrides={'soil-type':'rock','plinth-height':'raised'}
  const next=createBuildingModel(d)
  assert.notEqual(next.planId,old.planId);assert.equal(next.compositionId,old.compositionId)
  const a=createVillaDesignDNA(old,41),b=createVillaDesignDNA(next,41)
  assert.deepEqual({...a,sourcePlanId:'same'},{...b,sourcePlanId:'same'})
})

test('VillaDesignDNA is seeded, repeatable and changes architectural parameters', () => {
  const plan = makePlan()
  const before = JSON.stringify(plan)
  const building = createBuildingModel(plan)
  const first = createVillaDesignDNA(building, 101)
  assert.deepEqual(createVillaDesignDNA(building, 101), first)
  assert.equal(JSON.stringify(createVillaDesignDNA(building, 101)), JSON.stringify(first))
  assert.equal(first.sourcePlanId, building.planId)
  assert.equal(first.sourcePlateFamily, building.orientation.plateFamily)
  assert.ok(assessMassingFamilies(building).some((f) => f.family === first.massingFamily && f.compatible))
  assert.equal(first.blockRatios.length, first.blockCount)
  assert.ok(Math.abs(first.blockRatios.reduce((sum, ratio) => sum + ratio, 0) - 1) < 1e-9)
  assert.equal(first.blockOffsets.length, first.blockCount)
  assert.equal(first.blockRotations.length, first.blockCount)
  assert.equal(first.upperFloorCoverage, Number((rectUnionArea(plan.floors.at(-1).footprint) /
    rectUnionArea(plan.floors[0].footprint)).toFixed(4)))

  const signatures = new Set()
  const compositions = new Set()
  for (let seed = 1; seed <= 32; seed++) {
    const dna = createVillaDesignDNA(building, seed)
    signatures.add(villaGeometrySignature(dna))
    compositions.add(dna.compositionType)
    assert.equal(dna.sourcePlanId, building.planId)
    assert.equal(dna.upperFloorCoverage, first.upperFloorCoverage)
    assert.deepEqual(dna.upperFloorOffset, first.upperFloorOffset)
  }
  assert.equal(signatures.size, 32, 'different seeds must produce different geometry proposals')
  assert.ok(compositions.size >= 3, 'seeds must vary major composition, not just finishes')
  assert.equal(JSON.stringify(plan), before, 'DNA generation must not modify the source plan')
  assert.throws(() => createVillaDesignDNA(building, Number.NaN), /safe integer/)
  assert.throws(() => createVillaDesignDNA(building, 1.5), /safe integer/)
})
