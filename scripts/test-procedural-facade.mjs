import { sourceFixture } from './fixtures/specialized-building.mjs'
import { elementFixture } from './fixtures/element-building.mjs'
import assert from 'node:assert/strict'
import test from 'node:test'
import { defaultBrief, SELECTABLE_CHARACTERS } from '../src/lib/model/brief.ts'
import { compile } from '../src/lib/model/canonical.ts'
import { generate } from '../src/lib/engine/generate.ts'
import { validate } from '../src/lib/rules/index.ts'
import { createBuildingModel } from '../src/lib/engine/buildingModel.ts'
import { createVillaDesignDNA } from '../src/lib/engine/villaDesignDna.ts'
import { MassingGenerator } from '../src/lib/engine/massing/MassingGenerator.ts'
import { ArchitecturalFeatureGenerator } from '../src/lib/engine/facade/ArchitecturalFeatureGenerator.ts'
import { buildFacadeZones, validateProceduralFeatures, worldPart } from '../src/lib/engine/facade/FacadeGrammar.ts'
import { ARCHITECTURAL_FEATURE_TYPES, FACADE_ZONE_KINDS } from '../src/lib/engine/facade/proceduralTypes.ts'
import { ARCHITECTURAL_FAMILIES, ARCHITECTURAL_FAMILY_RECIPES,
  architecturalFamilyFitsPlan } from '../src/lib/engine/facade/architecturalFamilies.ts'

const fixture = (plotWidth, plotDepth, massing, seed, courtyard = false) => {
  const brief = defaultBrief()
  brief.site.plotWidth = plotWidth; brief.site.plotDepth = plotDepth
  brief.rooms.priorities.courtyard = courtyard
  const design = generate(compile(brief), { massing, seed })
  assert.ok(validate(design).hardChecksPass)
  const building = createBuildingModel(design)
  const dna = createVillaDesignDNA(building, seed)
  const masses = MassingGenerator.generate(building, dna)
  assert.equal(masses.status, 'valid', JSON.stringify(masses.issues))
  return { building, dna, masses }
}
const authored = (building, seed) => {
  const dna = createVillaDesignDNA(building, seed)
  return { building, dna, masses: MassingGenerator.generate(building, dna) }
}
// Recipe coverage uses authored hosts with enough setback margin for the requested feature.
const court = authored(elementFixture(), 41)
const portal = authored(sourceFixture(18, 24, 2), 2)
const forced = (source, type) => ArchitecturalFeatureGenerator.generate(
  source.building, source.dna, source.masses, { heroFeature: type, supportingFeatures: [] })

test('all real exterior walls and roof edges are classified into facade zones', () => {
  const zones = buildFacadeZones(court.building, court.masses)
  assert.ok(zones.length > 0)
  assert.equal(new Set(zones.map((z) => z.id)).size, zones.length)
  for (const wall of court.building.walls.filter((w) => w.kind === 'exterior')) {
    const zone = zones.find((z) => z.wallId === wall.id)
    assert.ok(zone, wall.id)
    assert.ok(zone.hostMassIds.length > 0)
    assert.ok(FACADE_ZONE_KINDS.includes(zone.kind))
  }
  for (const kind of ['PRIMARY', 'SECONDARY', 'ENTRANCE', 'BALCONY', 'STAIR_TOWER',
    'UPPER', 'ROOFLINE', 'SERVICE', 'VOID'])
    assert.ok(zones.some((z) => z.kind === kind), kind)
  assert.ok(zones.filter((z) => z.kind === 'ROOFLINE').every((z) => z.hostMassIds.some((id) =>
    court.masses.masses.some((m) => m.id === id && m.usage === 'roof'))))
})

test('every requested hero recipe yields anchored solids on a suitable real plan', () => {
  assert.equal(ARCHITECTURAL_FEATURE_TYPES.length, 38)
  for (const type of ARCHITECTURAL_FEATURE_TYPES) {
    const source = type === 'DOUBLE_HEIGHT_PORTAL' ? portal : court
    const model = forced(source, type)
    assert.equal(model.status, 'valid', `${type}: ${JSON.stringify(model.issues)}`)
    assert.deepEqual(model.issues, [])
    assert.equal(model.features.length, 1)
    assert.equal(model.features[0].type, type)
    assert.equal(model.features[0].importance, 'hero')
    assert.ok(model.features[0].parts.length > 0)
    assert.deepEqual(validateProceduralFeatures(source.building, source.masses,
      model.zones, model.features), [], type)
    for (const part of model.features[0].parts) {
      const zone = model.zones.find((z) => z.id === part.zoneId)
      assert.ok(zone)
      assert.deepEqual(part.world, worldPart(zone, part.id, part.role, part.u0Mm, part.u1Mm,
        part.z0Mm, part.z1Mm, part.offsetMm, part.depthMm).world)
    }
  }
})

test('C_FRAME is built from proportional top, upright and bottom beams', () => {
  const model = forced(court, 'C_FRAME')
  const feature = model.features[0]
  assert.deepEqual(feature.parts.map((p) => p.role).sort(), ['beam', 'beam', 'post'])
  assert.ok(feature.parameters.widthRatio > 0.25 && feature.parameters.widthRatio < 1)
  assert.ok(feature.parameters.heightRatio > 0.7 && feature.parameters.heightRatio < 1)
  assert.ok(feature.parameters.thicknessMm >= 140)
  assert.ok(feature.parameters.projectionMm >= 350)
  assert.ok(['LEFT', 'RIGHT'].includes(feature.parameters.openSide))
  const [bottom, post, top] = feature.parts
  assert.ok(bottom.z0Mm < top.z0Mm)
  assert.ok(post.u1Mm === top.u1Mm || post.u0Mm === top.u0Mm)
  assert.ok(bottom.world.h > 0 && bottom.world.w > 0)
})

test('stone and wood spines have different procedural geometry', () => {
  const stone = forced(court, 'STONE_SPINE').features[0]
  const wood = forced(court, 'WOOD_SPINE').features[0]
  assert.equal(stone.parts.length, 1)
  assert.equal(stone.parts[0].role, 'box')
  assert.equal(wood.parts.length, 5)
  assert.ok(wood.parts.every((part) => part.role === 'screen'))
})

test('thirty architectural families create distinct validated solids on one source plan', () => {
  assert.equal(ARCHITECTURAL_FAMILIES.length, 30)
  const geometry = new Set()
  const before = JSON.stringify(court.building)
  for (const family of ARCHITECTURAL_FAMILIES) {
    const options = { architecturalFamily: family, supportingFeatures: [] }
    const result = ArchitecturalFeatureGenerator.generate(court.building, court.dna, court.masses, options)
    assert.equal(result.status, 'valid', `${family}: ${JSON.stringify(result.issues)}`)
    assert.equal(result.architecturalFamily, family)
    assert.ok(ARCHITECTURAL_FAMILY_RECIPES[family].heroes.includes(result.features[0].type), family)
    assert.deepEqual(validateProceduralFeatures(court.building, court.masses, result.zones, result.features), [])
    geometry.add(JSON.stringify(result.features.flatMap((feature) => feature.parts.map((part) =>
      [part.role, part.world.x, part.world.y, part.world.z, part.world.w, part.world.h,
        part.world.height]))))
    assert.deepEqual(ArchitecturalFeatureGenerator.generate(court.building, court.dna, court.masses, options), result)
  }
  assert.equal(geometry.size, ARCHITECTURAL_FAMILIES.length,
    'each named family must produce distinct geometry, not just a different label')
  assert.equal(JSON.stringify(court.building), before)
})

test('courtyard composition requires a plan courtyard; the three UI styles select compatible families', () => {
  const rectangle = fixture(25, 25, 'rectangular', 41)
  assert.equal(architecturalFamilyFitsPlan(rectangle.building, 'COURTYARD_MODERN'), false)
  const rejected = ArchitecturalFeatureGenerator.generate(rectangle.building, rectangle.dna,
    rectangle.masses, { architecturalFamily: 'COURTYARD_MODERN' })
  assert.equal(rejected.status, 'rejected')
  assert.equal(rejected.issues[0].code, 'FAMILY_INCOMPATIBLE')
  assert.deepEqual(SELECTABLE_CHARACTERS, ['modern-box', 'contemporary-indian', 'courtyard-indian'])
  const styleFamilies = {
    'modern-box': ['FRAMED_MODERN', 'FLOATING_BOX', 'INTERLOCKING_MODERN', 'MINIMAL_LUXURY', 'VERTICAL_MONOLITH', 'HORIZONTAL_LAYERED', 'DEEP_REVEAL', 'SCULPTED_CORNER',
      'GLASS_PAVILION', 'STEEL_FRAME_GRID', 'RAISED_BAR', 'FOLDED_PAVILION', 'GLAZED_BAY', 'SOLAR_TERRACE'],
    'contemporary-indian': ['WARM_CONTEMPORARY', 'TROPICAL_MODERN', 'SCREEN_HOUSE', 'INDIAN_CONTEMPORARY', 'VERTICAL_MONOLITH', 'LAYERED_PORTICO', 'FINNED_PAVILION',
      'STEPPED_WHITE', 'FREE_CANOPY', 'BRICK_VEIL', 'SCULPTED_TOWER', 'GARDEN_GATE'],
    'courtyard-indian': ['COURTYARD_MODERN', 'TROPICAL_MODERN', 'SCREEN_HOUSE', 'INDIAN_CONTEMPORARY', 'WARM_CONTEMPORARY', 'LAYERED_PORTICO', 'FINNED_PAVILION',
      'STONE_COLONNADE', 'TIMBER_PORTICO', 'COURT_PERGOLA', 'POOL_RETREAT'],
  }
  for (const character of SELECTABLE_CHARACTERS) for (let seed = 1; seed <= 12; seed++) {
    const dna = createVillaDesignDNA(rectangle.building, seed, character)
    assert.equal(dna.schemaVersion, 3)
    assert.ok(ARCHITECTURAL_FAMILIES.includes(dna.architecturalFamily))
    assert.ok(styleFamilies[character].includes(dna.architecturalFamily))
    assert.notEqual(dna.architecturalFamily, 'COURTYARD_MODERN')
    assert.deepEqual(createVillaDesignDNA(rectangle.building, seed, character), dna)
  }
})

test('same plan and seed are deterministic; seeds vary hero identity with 0-2 supports', () => {
  const before = JSON.stringify(court.building)
  const heroTypes = new Set()
  for (let seed = 1; seed <= 40; seed++) {
    const dna = createVillaDesignDNA(court.building, seed)
    const masses = MassingGenerator.generate(court.building, dna)
    const model = ArchitecturalFeatureGenerator.generate(court.building, dna, masses)
    assert.equal(model.status, 'valid', `${seed}: ${JSON.stringify(model.issues)}`)
    assert.equal(model.features.filter((f) => f.importance === 'hero').length, 1)
    assert.ok(model.features.length >= 1 && model.features.length <= 3)
    heroTypes.add(model.features[0].type)
    assert.deepEqual(ArchitecturalFeatureGenerator.generate(court.building, dna, masses), model)
  }
  assert.ok(heroTypes.size >= 10, 'seeded direction must select genuinely different hero recipes')
  assert.equal(JSON.stringify(court.building), before)
})

test('existing planner plate families and storey counts receive valid anchored features', () => {
  for (const [family, storeys] of [['rectangular', 0], ['rectangular', 1],
    ['stepped', 2], ['l-shape', 1], ['courtyard', 1]]) {
    const brief = defaultBrief()
    brief.site.plotWidth = 25; brief.site.plotDepth = 25
    brief.levels.storeys = storeys; brief.levels.liftProvision = storeys === 2
    brief.rooms.priorities.courtyard = family === 'courtyard'
    const design = generate(compile(brief), { massing: family, seed: 41 })
    assert.ok(validate(design).hardChecksPass, family)
    const building = createBuildingModel(design)
    const dna = createVillaDesignDNA(building, 41)
    const massing = MassingGenerator.generate(building, dna)
    const facade = ArchitecturalFeatureGenerator.generate(building, dna, massing)
    assert.equal(facade.status, 'valid', `${family}: ${JSON.stringify(facade.issues)}`)
    assert.equal(facade.features.filter((f) => f.importance === 'hero').length, 1)
  }
})

test('door overlap, arbitrary coordinates, setback breach and excess heroes fail validation', () => {
  const original = forced(court, 'ENTRY_PORTAL')
  const entry = court.building.doors.find((o) => o.kind === 'entry')
  const feature = structuredClone(original.features[0])
  const zone = original.zones.find((z) => z.id === feature.parts[0].zoneId)
  const at = zone.side === 'N' || zone.side === 'S' ? entry.at.x : entry.at.y
  feature.parts[0] = worldPart(zone, feature.parts[0].id, 'post', at - 80, at + 80,
    zone.elevationMm, zone.elevationMm + 2000, 0, 500)
  const badDoor = validateProceduralFeatures(court.building, court.masses, original.zones, [feature])
  assert.ok(badDoor.some((issue) => issue.code === 'FEATURE_OPENING_COLLISION'))
  const edited = structuredClone(original.features[0])
  edited.parts[0].world.x += 123
  assert.ok(validateProceduralFeatures(court.building, court.masses, original.zones, [edited])
    .some((issue) => issue.code === 'ARBITRARY_COORDINATES'))
  const overhang = structuredClone(original.features[0])
  const p = overhang.parts[0]
  overhang.parts[0] = worldPart(zone, p.id, p.role, p.u0Mm, p.u1Mm, p.z0Mm, p.z1Mm, 40000, p.depthMm)
  assert.ok(validateProceduralFeatures(court.building, court.masses, original.zones, [overhang])
    .some((issue) => issue.code === 'FEATURE_SETBACK'))
  const duplicate = structuredClone(original.features[0])
  duplicate.id = 'another-hero'
  assert.ok(validateProceduralFeatures(court.building, court.masses, original.zones,
    [original.features[0], duplicate]).some((issue) => issue.code === 'FEATURE_BUDGET'))
})

test('incompatible requested hero is rejected and invalid massing cannot receive features', () => {
  const single = fixture(25, 25, 'rectangular', 41)
  assert.equal(forced(single, 'COURTYARD_SCREEN').issues[0].code, 'HERO_UNAVAILABLE')
  // A cached massing bound to a different plan cannot be consumed.
  const invalid = { ...single.masses, status: 'rejected' }
  assert.equal(ArchitecturalFeatureGenerator.generate(single.building, single.dna, invalid).issues[0].code,
    'INVALID_MASSING')
  assert.throws(() => ArchitecturalFeatureGenerator.generate(court.building, court.dna, court.masses,
    { supportingFeatures: ['L_FRAME', 'WOOD_SPINE', 'ROOF_FRAME'] }), /at most two/)
})
