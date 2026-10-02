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

test('tight uniqueness settings progressively relax while returning validated architecture', () => {
  reset()
  const first = useStudio.getState().run()
  useStudio.getState().setDiversityLimits({ maxAttempts: 2, similarityThreshold: 0 })
  const next = useStudio.getState().reseed()
  assert.ok(next.report.hardChecksPass && next.shapeFingerprint)
  assert.notEqual(next.design.dna.seed, first.design.dna.seed)
  assert.ok(useStudio.getState().shapeDebug.some(d=>d.accepted))
})

test('geometry history survives brief edits and reload; invalid persisted records are discarded', async () => {
  reset()
  useStudio.getState().run()
  const history = structuredClone(useStudio.getState().recentVillaFingerprints)
  useStudio.getState().edit((brief) => { brief.project.name += " updated" })
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

test('20 varied feasible briefs return at least one valid direction and target four, each replayed exactly when pinned', () => {
 const rows=[]
 for(let i=0;i<20;i++) {
  reset()
  const b=defaultBrief()
  b.site.plotWidth=22+i%5; b.site.plotDepth=26+i%4
  b.levels.storeys=1+i%2
  b.rooms.bedroomsWithBath=2+i%3; b.rooms.bedroomsNoBath=i%2; b.rooms.studies=i%2
  b.household.guests=i%3===0?'frequent':'occasional'
  b.household.staff=['none','daily','liveIn'][i%3]
  b.lifestyle.wfhCount=i%2; b.lifestyle.vastu='ignore'
  b.site.openSpace.mode=['auto','perSide','chosenSides','maxBuild'][i%4]
  b.variation=i*113
  useStudio.setState({brief:b})
  const before=JSON.stringify(b), dirs=useStudio.getState().explore()
  assert.ok(dirs.length>=1 && dirs.length<=4, `fixture ${i}: ${useStudio.getState().generationNotice}`)
  assert.ok(dirs.every(d=>d.report.hardChecksPass && d.massingModel.status==='valid' && d.facadeModel.status==='valid'))
  assert.equal(JSON.stringify(useStudio.getState().brief),before)
  // directions now stand on different plan shapes; each must replay exactly
  const counts={};for(const d of useStudio.getState().shapeDebug)counts[d.code]=(counts[d.code]||0)+1
  for(const d of dirs){
   const r=useStudio.getState().pin({massing:d.massing,seed:d.seed,...(d.planSeed!==undefined?{planSeed:d.planSeed}:{})})
   assert.equal(r.buildingModel.planId,d.buildingModel.planId,`fixture ${i}: pinned plan differs`)
   assert.equal(r.facadeModel.architecturalFamily,d.facadeModel.architecturalFamily)
  }
  rows.push({brief:i,directions:dirs.length,counts})
 }
 console.info('20-brief direction search:',JSON.stringify(rows))
 assert.ok(rows.filter(r=>r.directions===4).length>=16,'target four for most feasible briefs')
})
