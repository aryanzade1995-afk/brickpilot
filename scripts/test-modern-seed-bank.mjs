import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, unlink, rmdir } from 'node:fs/promises'
import { join } from 'node:path'
import { defaultBrief } from '../src/lib/model/brief.ts'
import { compile } from '../src/lib/model/canonical.ts'
import { generate } from '../src/lib/engine/generate.ts'
import { generateAlternativeDesign } from '../src/lib/engine/generateAlternativeDesign.ts'
import { styleFamilyPool } from '../src/lib/engine/facade/architecturalFamilies.ts'
import { MODERN_SEED_CATALOGUE, MODERN_SEEDS, modernSeedSchedule, nextModernSeedCursor } from '../src/lib/engine/modernSeedBank.ts'
import { emptyModernUsage, modernGeometryHash, alreadyBuiltModernDesign, alreadyBuiltModernMesh, recordModernDesign, readModernUsage, classifyModernCandidateFailure } from '../server/modern-villa-library.mjs'
import { writeAtomicJson } from '../server/atomic-json.mjs'
import { validRealizedShape, realizedSimilarity } from '../server/villa-shape.mjs'

const plan = generate(compile(defaultBrief()), { seed: 41 })
const first = generateAlternativeDesign(plan, MODERN_SEEDS[0])

test('all 1000 modern catalogue seeds replay as distinct valid production geometries on the reference plan', () => {
  assert.equal(MODERN_SEED_CATALOGUE.count, 1000)
  assert.equal(MODERN_SEEDS.length, 1000)
  assert.equal(new Set(MODERN_SEEDS).size, 1000)
  assert.equal(new Set(MODERN_SEED_CATALOGUE.entries.map(e => e.id)).size, 1000)
  const before = JSON.stringify(plan), hashes = new Set(), families = new Set()
  for (const entry of MODERN_SEED_CATALOGUE.entries) {
    const architecture = generateAlternativeDesign(plan, entry.seed)
    const hash = modernGeometryHash(architecture)
    assert.equal(hash, entry.geometryHash, entry.id)
    assert.ok(!hashes.has(hash), `${entry.id} repeats actual geometry`)
    hashes.add(hash); families.add(architecture.facadeGrammar.architecturalFamily)
    assert.ok(styleFamilyPool('modern-box').includes(architecture.facadeGrammar.architecturalFamily))
    assert.equal(architecture.villaDesignDNA.character, 'modern-box')
    assert.equal(architecture.massingModel.status, 'valid')
    assert.equal(architecture.facadeGrammar.status, 'valid')
    assert.equal(architecture.buildingModel.planId, MODERN_SEED_CATALOGUE.validation.referencePlanId)
  }
  assert.equal(hashes.size, 1000)
  assert.ok(families.size >= 10)
  assert.equal(JSON.stringify(plan), before, 'the seed bank cannot edit the source plan')
})

test('1000 catalogue selections never repeat; exhaustion continues with new seeds rather than wrapping', () => {
  const usage = { usedSeeds: [], cursor: 0 }, chosen = []
  for (let i = 0; i < 1000; i++) {
    const seed = modernSeedSchedule(MODERN_SEEDS[0], usage, 1)[0]
    assert.ok(!chosen.includes(seed)); chosen.push(seed)
    usage.usedSeeds.push(seed); usage.cursor = nextModernSeedCursor(seed, usage.cursor)
  }
  assert.deepEqual(new Set(chosen), new Set(MODERN_SEEDS))
  const overflow = modernSeedSchedule(MODERN_SEEDS[0], usage, 32)
  assert.equal(new Set(overflow).size, 32)
  assert.ok(overflow.every(seed => !chosen.includes(seed)))
  assert.deepEqual(modernSeedSchedule(MODERN_SEEDS[0], usage, 32), overflow)
})

test('durable usage survives reload, retains more than 50 records and refuses damaged state', async () => {
  const directory = await mkdtemp('output/modern-seed-test-'), path = join(directory, 'usage.json')
  try {
    assert.deepEqual(await readModernUsage(path), emptyModernUsage())
    let usage = recordModernDesign(emptyModernUsage(), first)
    for (const entry of MODERN_SEED_CATALOGUE.entries.slice(1, 75)) {
      usage.usedSeeds.push(entry.seed); usage.geometryHashes.push(entry.geometryHash)
    }
    await writeAtomicJson(path, usage)
    const restored = await readModernUsage(path)
    assert.equal(restored.geometryHashes.length, 75)
    assert.ok(alreadyBuiltModernDesign(restored, first))
    assert.deepEqual(recordModernDesign(recordModernDesign(emptyModernUsage(), first), first), recordModernDesign(emptyModernUsage(), first), 'saved replay is idempotent')
    assert.ok(modernSeedSchedule(first.villaDesignDNA.seed, restored, 32).every(seed => !restored.usedSeeds.includes(seed)))
    await writeFile(path, JSON.stringify({ schemaVersion: 1, usedSeeds: [], geometryHashes: ['bad'], cursor: 0 }))
    await assert.rejects(readModernUsage(path), /damaged/)
  } finally { await unlink(path).catch(() => {}); await rmdir(directory) }
})

test('paint, seed metadata and family labels cannot turn an already used geometry into a new design', () => {
  const usage = recordModernDesign(emptyModernUsage(), first), changed = structuredClone(first)
  changed.villaDesignDNA.seed++
  changed.villaDesignDNA.materialPalette = 'charcoal-oak'
  changed.facadeGrammar.architecturalFamily = 'FLOATING_BOX'
  changed.facadeGrammar.features.reverse()
  for (const feature of changed.facadeGrammar.features) {
    feature.parts.reverse()
    for (const part of feature.parts) part.materialHint = 'metal'
  }
  assert.ok(alreadyBuiltModernDesign(usage, changed))
  changed.facadeGrammar.features[0].parts[0].world.w += 200
  assert.ok(!alreadyBuiltModernDesign(usage, changed))
})

test('Blender geometry rejection retries a different seed while executable failures and timeouts remain fatal', () => {
  const invalid = classifyModernCandidateFailure(new Error('Blender failed (1); see generation log'),
    'Traceback\nValueError: Exterior pillar intersects Garden_Tree_01; regenerate the edited design\n')
  assert.equal(invalid.candidateInvalid, true)
  assert.match(invalid.message, /pillar intersects/)
  for (const message of ['Blender could not start: missing binary', 'Blender generation timed out', 'Blender failed (139); see generation log']) {
    const original = new Error(message)
    assert.equal(classifyModernCandidateFailure(original, 'ValueError: old log'), original)
  }
  const crash = new Error('Blender failed (1); see generation log')
  assert.equal(classifyModernCandidateFailure(crash, 'ModuleNotFoundError: missing dependency'), crash)
})

test('measured facade geometry distinguishes modern exteriors without rewarding palette changes', () => {
  const keys = ['front', 'side', 'roof', 'roofFront', 'roofSide', 'facadeFront', 'facadeSide']
  const a = { schemaVersion: 4, planId: 'fixed-plan', seed: 1, grid: 32,
    parts: Object.fromEntries(keys.map(key => [key, Array(1024).fill(1)])) }
  const b = structuredClone(a)
  b.seed = 2; b.palette = 'different'
  assert.equal(realizedSimilarity(a, b), 1)
  b.parts.facadeFront.fill(0)
  assert.equal(realizedSimilarity(a, b), .75, 'a different facade can change similarity even when the roof and plan stay fixed')
  delete b.parts.facadeSide
  assert.equal(validRealizedShape(b), false)
})

test('permanent measured-mesh protection rejects repeats even after they leave the recent 50', () => {
  const geometry = { schemaVersion: 4, planId: first.buildingModel.planId, seed: first.villaDesignDNA.seed, grid: 32,
    parts: Object.fromEntries(['front', 'side', 'roof', 'roofFront', 'roofSide', 'facadeFront', 'facadeSide'].map(key => [key, Array(1024).fill(1)])) }
  const usage = recordModernDesign(emptyModernUsage(), first, geometry)
  for (let i = 0; i < 75; i++) usage.realizedHashes.push(i.toString(16).padStart(64, '0'))
  const duplicate = structuredClone(geometry); duplicate.seed++; duplicate.planId = 'renamed'; duplicate.palette = 'different'
  assert.ok(alreadyBuiltModernMesh(usage, duplicate))
  duplicate.parts.facadeFront.fill(0)
  assert.ok(!alreadyBuiltModernMesh(usage, duplicate))
  assert.throws(() => recordModernDesign(usage, first, duplicate), /different plan or seed/)
})

test('the browser seed picker persists usage across reload and preserves random generation for other styles', async () => {
  const previousStorage = globalThis.localStorage, data = new Map()
  globalThis.localStorage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) }
  try {
    const { newDesignSeed } = await import('../src/lib/newDesignSeed.ts')
    const seeds = Array.from({ length: 1000 }, () => newDesignSeed(undefined, 'modern-box'))
    assert.equal(new Set(seeds).size, 1000)
    assert.deepEqual(new Set(seeds), new Set(MODERN_SEEDS))
    const reloaded = await import('../src/lib/newDesignSeed.ts?modern-reload')
    const extra = reloaded.newDesignSeed(seeds.at(-1), 'modern-box')
    assert.ok(!seeds.includes(extra))
    const random = newDesignSeed(41, 'courtyard-indian')
    assert.ok(Number.isSafeInteger(random) && random !== 41)
  } finally { globalThis.localStorage = previousStorage }
})
