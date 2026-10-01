import assert from 'node:assert/strict'
import test, { mock } from 'node:test'
import { registerHooks } from 'node:module'
import { defaultBrief } from '../src/lib/model/brief.ts'
import { DEFAULT_DIVERSITY_LIMITS } from '../src/lib/engine/fingerprint/VillaDiversityGate.ts'

registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) return { url: new URL(`../src/${specifier.slice(2)}`, import.meta.url).href, shortCircuit: true }
  return nextResolve(specifier, context)
} })
const storage = new Map()
globalThis.localStorage = { getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) }
globalThis.window = { localStorage: globalThis.localStorage }
mock.method(console, 'debug', () => {})
const { useStudio } = await import('../src/state/studio.ts')
const reset = () => useStudio.setState({ brief: defaultBrief(), directions: null, pinned: null, result: null,
  referencePreferences: null, recentExteriorSeeds: [], recentVillaFingerprints: [],
  diversityLimits: { ...DEFAULT_DIVERSITY_LIMITS }, shapeDebug: [], generationNotice: null })

test('new studio generation stores a shape record; repeated navigation is an exact replay', () => {
  reset()
  const first = useStudio.getState().run()
  assert.ok(first.shapeFingerprint)
  assert.equal(first.shapeStatus, 'accepted')
  assert.equal(useStudio.getState().recentVillaFingerprints.length, 1)
  assert.equal(useStudio.getState().run(), first)
  assert.equal(useStudio.getState().recentVillaFingerprints.length, 1)
})

test('accepted directions are mutually checked, pinning does not count a second generation', () => {
  reset()
  const dirs = useStudio.getState().explore()
  assert.ok(dirs.length > 0)
  const state = useStudio.getState()
  assert.equal(state.recentVillaFingerprints.length, dirs.length)
  assert.ok(dirs.every((d) => d.shapeFingerprint.seed === d.seed))
  const { seed, massing } = dirs[0]
  const pinned = state.pin({ seed, massing })
  assert.equal(pinned.shapeStatus, 'replay')
  assert.deepEqual(pinned.shapeFingerprint.vector, dirs[0].shapeFingerprint.vector)
  assert.equal(useStudio.getState().recentVillaFingerprints.length, dirs.length)
  assert.equal(useStudio.getState().explore(), dirs)
})

test('exhausted reseeding keeps the previous villa and history and reports a notice', () => {
  reset()
  const first = useStudio.getState().run()
  const history = structuredClone(useStudio.getState().recentVillaFingerprints)
  useStudio.getState().setDiversityLimits({ maxAttempts: 2, similarityThreshold: 0 })
  assert.equal(useStudio.getState().reseed(), first)
  assert.equal(useStudio.getState().result, first)
  assert.deepEqual(useStudio.getState().recentVillaFingerprints, history)
  assert.match(useStudio.getState().generationNotice, /No sufficiently different/)
  assert.equal(useStudio.getState().shapeDebug.length, 2)
})

test('geometry history survives brief edits and reload; invalid persisted records are discarded', async () => {
  reset()
  useStudio.getState().run()
  const history = structuredClone(useStudio.getState().recentVillaFingerprints)
  useStudio.getState().edit((brief) => { brief.budget.amountInr += 1000 })
  assert.deepEqual(useStudio.getState().recentVillaFingerprints, history)
  const saved = JSON.parse(storage.get('brickpilot.studio'))
  saved.state.recentVillaFingerprints.push({ schemaVersion: 999, vector: [] })
  storage.set('brickpilot.studio', JSON.stringify(saved))
  await useStudio.persist.rehydrate()
  assert.deepEqual(useStudio.getState().recentVillaFingerprints, history)
})

test('saved seeds replay exactly and are not reclassified as new architecture', () => {
  reset()
  const first = useStudio.getState().run()
  const history = structuredClone(useStudio.getState().recentVillaFingerprints)
  useStudio.getState().loadSaved(defaultBrief(), { seed: first.design.dna.seed, massing: first.design.massingType })
  const replay = useStudio.getState().run()
  assert.equal(replay.design.dna.seed, first.design.dna.seed)
  assert.equal(replay.shapeStatus, 'replay')
  assert.deepEqual(replay.shapeFingerprint.vector, first.shapeFingerprint.vector)
  assert.deepEqual(useStudio.getState().recentVillaFingerprints, history)
})

test('browser reload retains the accepted seed and does not generate or count another villa', async () => {
  reset()
  const first = useStudio.getState().run()
  const history = structuredClone(useStudio.getState().recentVillaFingerprints)
  assert.equal(useStudio.getState().pinned.seed, first.design.dna.seed)
  // Clear the runtime cache without rewriting persistent storage.
  const saved = storage.get('brickpilot.studio')
  useStudio.setState({ result: null, pinned: null })
  storage.set('brickpilot.studio', saved)
  await useStudio.persist.rehydrate()
  const replay = useStudio.getState().run()
  assert.equal(replay.shapeStatus, 'replay')
  assert.deepEqual(replay.shapeFingerprint.vector, first.shapeFingerprint.vector)
  assert.deepEqual(useStudio.getState().recentVillaFingerprints, history)
})

test('a stale invalid saved seed preserves the valid 2D plan and reports rejection without crashing', () => {
  reset()
  useStudio.getState().loadSaved(defaultBrief(), { massing: 'rectangular', seed: 1.5 })
  const result = useStudio.getState().run()
  assert.equal(result.report.hardChecksPass, true)
  assert.equal(result.shapeStatus, 'rejected')
  assert.equal(result.shapeFingerprint, null)
  assert.equal(useStudio.getState().recentVillaFingerprints.length, 0)
  assert.equal(useStudio.getState().shapeDebug[0].code, 'INVALID_ARCHITECTURE')
})
