import assert from 'node:assert/strict'
import test from 'node:test'
import { defaultBrief } from '../src/lib/model/brief.ts'
import { compile } from '../src/lib/model/canonical.ts'
import { generate } from '../src/lib/engine/generate.ts'
import { createVillaArchitecture } from '../src/lib/engine/fingerprint/createVillaArchitecture.ts'
import { createVillaShapeFingerprint, villaShapeSimilarity, fingerprintRecord, parseFingerprintHistory,
  FINGERPRINT_VECTOR_LENGTH } from '../src/lib/engine/fingerprint/VillaShapeFingerprint.ts'
import { evaluateVillaFingerprint, selectDistinctVilla, diversityLimits, formatFingerprintDebug }
  from '../src/lib/engine/fingerprint/VillaDiversityGate.ts'
import { createDistinctBlenderInput } from './export-blender-input.mjs'
import { fingerprint, noveltyScore } from '../src/lib/engine/variation.ts'
import { MASSING_FAMILIES } from '../src/lib/engine/massing/model.ts'
import { ARCHITECTURAL_FAMILIES } from '../src/lib/engine/facade/architecturalFamilies.ts'
import { ARCHITECTURAL_FEATURE_TYPES } from '../src/lib/engine/facade/proceduralTypes.ts'
import { ROOFLINE_TYPES } from '../src/lib/engine/facade/specialized/types.ts'

const plan = generate(compile(defaultBrief()))
const a = createVillaArchitecture(plan, 41)
const b = createVillaArchitecture(plan, 42)
const c = createVillaArchitecture(plan, 43)
const record = fingerprintRecord(a.shapeFingerprint)
const fp = a.shapeFingerprint
const remeasure = (architecture) => createVillaShapeFingerprint(architecture.buildingModel, architecture.villaDesignDNA,
  architecture.massingModel, architecture.facadeGrammar)

test('fingerprint includes all requested shape measurements in a deterministic normalized vector', () => {
  assert.deepEqual(remeasure(a), fp)
  assert.deepEqual(createVillaArchitecture(plan, 41).shapeFingerprint, fp)
  for (const key of ['massingFamily', 'blockCount', 'blockRatios', 'blockPositions', 'floorFootprints', 'upperFloorCoverage',
    'upperFloorOffsets', 'frontSilhouette', 'sideSilhouette', 'courtyardPresence', 'courtyardRatio', 'cantileverAmount',
    'terraceTopology', 'balconyTopology', 'heroFeature', 'facadeFamily', 'rooflineType', 'verticalFeature', 'voidRatio', 'overallHeight'])
    assert.ok(key in fp, key)
  assert.equal(fp.vector.length, FINGERPRINT_VECTOR_LENGTH)
  assert.ok(fp.vector.every((v) => Number.isFinite(v) && v >= 0 && v <= 1))
  assert.equal(villaShapeSimilarity(fp, fp), 1)
})

test('changing materials, palette, landscape, random DNA block intent or seed metadata does not lower similarity', () => {
  const changed = structuredClone(a)
  changed.villaDesignDNA.materialPalette = 'white-wood'
  changed.villaDesignDNA.landscapeStyle = 'lush-tropical'
  changed.villaDesignDNA.blockRatios = [0.01, 0.99]
  changed.villaDesignDNA.blockOffsets.forEach((p) => { p.xMm += 1000 })
  changed.facadeGrammar.specialized.assemblies.forEach((g) => g.parts.forEach((p) => { p.material = 'metal' }))
  assert.deepEqual(remeasure(changed).vector, fp.vector)
  assert.equal(villaShapeSimilarity(fp, { ...remeasure(changed), seed: 999 }), 1)
  assert.ok(!JSON.stringify(record).includes('materialPalette'))
  assert.equal(noveltyScore(fingerprint(plan.dna), fingerprint({ ...plan.dna, materialPalette: 'white-wood' })), 0)
})

test('family labels cannot make physically identical geometry novel', () => {
  const changed = structuredClone(a)
  changed.massingModel.family = 'ASYMMETRIC'
  changed.facadeGrammar.architecturalFamily = 'SCREEN_HOUSE'
  changed.facadeGrammar.features.find((f) => f.importance === 'hero').type = 'C_FRAME'
  assert.equal(villaShapeSimilarity(fp, remeasure(changed)), 1)
})

test('geometry order and splitting a coplanar solid do not create artificial novelty', () => {
  const changed = structuredClone(a)
  changed.massingModel.masses.reverse()
  changed.facadeGrammar.features.reverse()
  changed.facadeGrammar.features.forEach((f) => f.parts.reverse())
  assert.deepEqual(remeasure(changed).vector, fp.vector)
  const mass = changed.massingModel.masses.find((m) => m.usage === 'roof' && m.width >= 1000)
  const width = mass.width
  mass.width = Math.floor(width / 2)
  changed.massingModel.masses.push({ ...mass, id: 'split-roof', x: mass.x + mass.width, width: width - mass.width })
  assert.ok(villaShapeSimilarity(fp, remeasure(changed)) > 0.99)
})

test('nearby geometry is rejected, a real roof/hero change can pass, and similarity is symmetric', () => {
  assert.ok(villaShapeSimilarity(fp, b.shapeFingerprint) > 0.75)
  assert.ok(villaShapeSimilarity(fp, c.shapeFingerprint) < 0.75)
  assert.equal(villaShapeSimilarity(fp, c.shapeFingerprint), villaShapeSimilarity(c.shapeFingerprint, fp))
  const reject = evaluateVillaFingerprint(b.shapeFingerprint, [record])
  assert.equal(reject.accepted, false)
  assert.equal(reject.code, 'SIMILAR_SHAPE')
  assert.equal(reject.nearestPreviousSeed, 41)
  assert.equal(evaluateVillaFingerprint(c.shapeFingerprint, [record]).accepted, true)
})

test('courtyard plan measurements use the source void and upper-floor footprints', () => {
  const brief = defaultBrief()
  brief.site.plotWidth = 25; brief.site.plotDepth = 25; brief.rooms.priorities.courtyard = true
  const courtyard = createVillaArchitecture(generate(compile(brief), { massing: 'courtyard', seed: 41 }), 41)
  const f = courtyard.shapeFingerprint
  assert.equal(f.courtyardPresence, true)
  assert.ok(f.courtyardRatio > 0 && f.voidRatio > 0)
  assert.equal(f.floorFootprints.length, courtyard.buildingModel.floors.length)
  assert.ok(f.balconyTopology.accessCount > 0)
  assert.ok(f.balconyTopology.accessPoints.length > 0)
  assert.ok(villaShapeSimilarity(fp, f) < 0.75)
})

test('each rolling quota rejects the third family/hero/facade and fourth roofline', () => {
  const cases = [['massingFamily', 2], ['heroFeature', 2], ['facadeFamily', 2], ['rooflineType', 3]]
  for (const [field, count] of cases) {
    const history = Array.from({ length: count }, (_, i) => ({ ...record, seed: 100 + i }))
    const reject = evaluateVillaFingerprint(fp, history, { similarityThreshold: 1 })
    assert.equal(reject.accepted, false, field)
    assert.equal(reject.code, 'DIVERSITY_LIMIT', field)
    assert.match(reject.reason, new RegExp(field))
  }
})

test('last-ten quotas drop the outgoing oldest villa before accepting the next one', () => {
  const families = MASSING_FAMILIES.filter((f) => f !== fp.massingFamily)
  const heroes = ARCHITECTURAL_FEATURE_TYPES.filter((f) => f !== fp.heroFeature)
  const facades = ARCHITECTURAL_FAMILIES.filter((f) => f !== fp.facadeFamily)
  const roofs = [...ROOFLINE_TYPES, 'NONE'].filter((f) => f !== fp.rooflineType)
  const history = [record, ...Array.from({ length: 8 }, (_, i) => ({ ...fingerprintRecord(c.shapeFingerprint),
    massingFamily: families[i], heroFeature: heroes[i], facadeFamily: facades[i], rooflineType: roofs[i], seed: i + 100 })),
    { ...record, seed: 301 }]
  assert.equal(evaluateVillaFingerprint(fp, history, { similarityThreshold: 1 }).accepted, true)
  assert.equal(evaluateVillaFingerprint(fp, [record], { similarityThreshold: 1, windowSize: 1 }).accepted, true)
})

test('stricter configuration checks every family already in the prospective rolling window', () => {
  const history = [record, { ...record, seed: 100 }, { ...record, seed: 101 }]
  const candidate = { ...c.shapeFingerprint, massingFamily: 'LINEAR', heroFeature: 'L_FRAME', facadeFamily: 'SCREEN_HOUSE', rooflineType: 'PERGOLA' }
  const reject = evaluateVillaFingerprint(candidate, history, { similarityThreshold: 1 })
  assert.equal(reject.accepted, false)
  assert.equal(reject.code, 'DIVERSITY_LIMIT')
  assert.ok(reject.reason.includes(`massingFamily=${fp.massingFamily}`))
})

test('similarity exactly at the threshold is permitted; exceeding it is rejected', () => {
  const threshold = villaShapeSimilarity(fp, b.shapeFingerprint)
  assert.equal(evaluateVillaFingerprint(b.shapeFingerprint, [record], { similarityThreshold: threshold }).accepted, true)
  assert.equal(evaluateVillaFingerprint(b.shapeFingerprint, [record], { similarityThreshold: threshold - 0.000001 }).accepted, false)
})

test('retry seeds are deterministic, rejection never enters history and accepted records are retained', () => {
  const callback = (seed) => ({ candidate: { seed }, fingerprint: seed === 42 ? b.shapeFingerprint : { ...c.shapeFingerprint, seed } })
  const first = selectDistinctVilla(42, [record], callback)
  const second = selectDistinctVilla(42, [record], callback)
  assert.deepEqual(first, second)
  assert.equal(first.debug[0].accepted, false)
  assert.equal(first.debug.length, 2)
  assert.equal(first.accepted.candidate.seed, first.debug[1].seed)
  assert.equal(first.history.length, 2)
  assert.ok(!first.history.some((f) => f.seed === 42))
  assert.notEqual(first.debug[0].seed, first.debug[1].seed)
})

test('exhausted retries preserve history and never accept a duplicate or invalid candidate', () => {
  const failed = selectDistinctVilla(41, [record], (seed) => ({ candidate: seed, fingerprint: { ...fp, seed } }), { maxAttempts: 4 })
  assert.equal(failed.accepted, null)
  assert.deepEqual(failed.history, [record])
  assert.equal(failed.debug.length, 4)
  assert.ok(failed.debug.every((d) => !d.accepted))
  const invalid = selectDistinctVilla(41, [], () => { throw new Error('Opening conflicts') }, { maxAttempts: 2 })
  assert.equal(invalid.accepted, null)
  assert.equal(invalid.debug[0].code, 'INVALID_ARCHITECTURE')
  assert.match(invalid.debug[0].reason, /Opening conflicts/)
})

test('saved-seed reference prevents duplicate reseeds without counting another generated villa', () => {
  const reject = evaluateVillaFingerprint(fp, [], {}, [record])
  assert.equal(reject.accepted, false)
  assert.equal(reject.nearestPreviousSeed, fp.seed)
  const allowed = evaluateVillaFingerprint(c.shapeFingerprint, [{ ...record, seed: 1 }], { similarityThreshold: 1 }, [record])
  assert.equal(allowed.accepted, true)
})

test('history round-trip is bounded, repaired and excludes unknown persisted properties', () => {
  const valid = JSON.parse(JSON.stringify({ ...record, materialPalette: 'not stored' }))
  const invalid = [null, {}, { ...record, schemaVersion: 99 }, { ...record, seed: 1.5 },
    { ...record, vector: [1] }, { ...record, vector: [...record.vector.slice(1), -1] }, { ...record, massingFamily: 'not real' }]
  assert.deepEqual(parseFingerprintHistory([...invalid, valid]), [record])
  assert.equal(parseFingerprintHistory(Array(80).fill(record)).length, 50)
  assert.deepEqual(parseFingerprintHistory(null), [])
  assert.throws(() => villaShapeSimilarity(record, { ...record, vector: [NaN] }), /invalid|Incompatible/)
})

test('configuration validates architectural novelty limits, and debug includes all requested fields', () => {
  assert.throws(() => diversityLimits({ similarityThreshold: NaN }), RangeError)
  assert.throws(() => diversityLimits({ maxAttempts: 0 }), RangeError)
  assert.throws(() => diversityLimits({ recentLimit: 2, windowSize: 10 }), RangeError)
  assert.throws(() => selectDistinctVilla(1.1, [], () => null), RangeError)
  const output = formatFingerprintDebug(evaluateVillaFingerprint(b.shapeFingerprint, [record]))
  for (const text of ['seed=42', 'family=', 'nearestPreviousSeed=41', 'similarity=', '%', 'REJECTED', 'reason=']) assert.ok(output.includes(text))
})

test('Blender candidate selection changes only exterior seed and preserves all source rooms, openings and floors', () => {
  const selection = createDistinctBlenderInput(plan, 42, [record])
  assert.ok(selection.accepted)
  assert.equal(selection.debug[0].accepted, false)
  const payload = selection.accepted.candidate
  assert.deepEqual(payload.buildingModel, a.buildingModel)
  assert.equal(payload.shapeFingerprint.seed, payload.villaDesignDNA.seed)
  assert.equal(payload.shapeFingerprint.seed, payload.massingModel.seed)
  assert.ok(evaluateVillaFingerprint(payload.shapeFingerprint, [record]).accepted)
})
