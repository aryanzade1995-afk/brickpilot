import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import { defaultBrief } from '../src/lib/model/brief.ts'
import { compile } from '../src/lib/model/canonical.ts'
import { generate } from '../src/lib/engine/generate.ts'
import { generateAlternativeDesign, ENVELOPE_LIMITS } from '../src/lib/engine/generateAlternativeDesign.ts'
import { ArchitectureValidator } from '../src/lib/engine/massing/ArchitectureValidator.ts'
import { validRealizedShape, realizedSimilarity, evaluateRealizedVilla, productionDiversityPolicy } from '../server/villa-shape.mjs'
import { handleVillaRequest } from '../server/villa-jobs.mjs'

const plan = generate(compile(defaultBrief()), { seed: 41 })
const one = generateAlternativeDesign(plan, 6)

test('50 architectural seeds preserve one plan and a clear terrace while varying facade solids', () => {
  const original = JSON.stringify(plan), building = JSON.stringify(one.buildingModel)
  const signatures = new Set(), families = new Set()
  for (let seed = 1; seed <= 50; seed++) {
    const alternative = generateAlternativeDesign(plan, seed)
    assert.equal(JSON.stringify(alternative.buildingModel), building)
    assert.equal(alternative.villaDesignDNA.seed, seed)
    assert.equal(alternative.massingModel.status, 'valid')
    assert.equal(alternative.facadeGrammar.status, 'valid')
    ArchitectureValidator.assertReadyForGeometry(alternative.buildingModel, alternative.massingModel)
    assert.ok(!alternative.massingModel.masses.some(m=>m.usage==='roof'))
    assert.ok(alternative.buildingModel.roofTerrace.freeRatio>=.8)
    signatures.add(JSON.stringify(alternative.facadeGrammar.features.flatMap(f=>f.parts.map(p=>p.world))))
    families.add(alternative.massingModel.family)
  }
  assert.equal(JSON.stringify(plan), original)
  assert.ok(signatures.size >= 30, `${signatures.size} unique actual facade geometries`)
  assert.equal(families.size, 15)
})
test('same plan and exact seed reproduce all architectural inputs without mutating the plan', () => {
  assert.equal(JSON.stringify(generateAlternativeDesign(plan, 6)), JSON.stringify(one))
  assert.throws(() => generateAlternativeDesign(plan, NaN), /seed/)
  const broken = structuredClone(plan); broken.floors[0].rooms[0].rect.w = 1
  assert.throws(() => generateAlternativeDesign(broken, 6), /validation/)
})
test('solid roof additions are rejected before geometry even when they have adequate support',()=>{
 const model=generateAlternativeDesign(plan,8),top=model.buildingModel.floors.at(-1)
 const host=model.massingModel.masses.find(m=>m.sourceFloorId===top.id&&m.usage==='enclosed')
 const block={...host,id:'forbidden-roof-box',usage:'roof',elevation:top.elevationMm+top.heightMm,height:800,parentId:host.id}
 const report=ArchitectureValidator.validate(model.buildingModel,[...model.massingModel.masses,block],ENVELOPE_LIMITS)
 assert.ok(report.issues.some(i=>i.code==='TERRACE_SOLID_MASS'))
})

test('exterior canopy piers preserve parking and reject missing bearings and low head clearance', () => {
  const canopyPlan = JSON.parse(readFileSync(new URL('./fixtures/canopy-source.json', import.meta.url), 'utf8'))
  const sheltered = generateAlternativeDesign(canopyPlan, 6)
  const masses = structuredClone(sheltered.massingModel.masses)
  const canopy = masses.find((m) => m.usage === 'canopy'); assert.ok(canopy)
  const parking = sheltered.buildingModel.rooms.find((r) => r.id === 'parking')
  const pier = masses.find((m) => m.usage === 'support'); assert.ok(pier)
  pier.x = parking.rect.x + 500; pier.y = parking.rect.y + 500
  assert.ok(ArchitectureValidator.validate(sheltered.buildingModel, masses, ENVELOPE_LIMITS).issues.some((i) => i.code === 'CIRCULATION_BLOCKED'))
  canopy.bearingSupports = []
  assert.ok(ArchitectureValidator.validate(sheltered.buildingModel, masses, ENVELOPE_LIMITS).issues.some((i) => i.code === 'CANOPY_SUPPORT_MISSING'))
  canopy.elevation = 1800
  assert.ok(ArchitectureValidator.validate(sheltered.buildingModel, masses, ENVELOPE_LIMITS).issues.some((i) => i.code === 'INVALID_CANOPY'))
})
test('taller source plans only use piers within configured heights', () => {
  const brief = defaultBrief(); brief.levels.count = 4
  const tall = generate(compile(brief), { seed: 41 })
  for (const seed of [1, 8, 25]) {
    const p = generateAlternativeDesign(tall, seed)
    assert.ok(p.massingModel.masses.filter((m) => m.usage === 'support').every((m) => m.height <= ENVELOPE_LIMITS.maxSupportHeightMm))
  }
})

const shape = (seed = 6) => ({ schemaVersion: 1, planId: one.buildingModel.planId, seed, grid: 32,
  parts: Object.fromEntries(['front', 'side', 'roof', 'roofFront', 'roofSide'].map((k) => [k, Array(1024).fill(1)])) })
test('measured geometry similarity ignores palettes, materials and architectural labels', () => {
  const a = shape(), b = { ...shape(8), palette: 'CHARCOAL_WOOD_WHITE', family: 'renamed' }
  assert.equal(realizedSimilarity(a, b), 1)
  const payload = structuredClone(one); payload.villaDesignDNA.materialPalette = 'earth'
  const decision = evaluateRealizedVilla(payload, a, [{ geometry: b, fingerprint: one.shapeFingerprint }])
  assert.equal(decision.accepted, false)
  assert.equal(decision.similarityPercent, 100)
  assert.equal(decision.nearestPreviousSeed, 8)
  b.parts.roof[0] = NaN
  assert.equal(validRealizedShape(b), false)
  assert.throws(() => realizedSimilarity(a, b), /Invalid/)
})
test('post-mesh acceptance rejects mismatched plan identities and enforces identity quotas', () => {
  assert.throws(() => evaluateRealizedVilla(one, { ...shape(), planId: 'other' }, []), /match/)
  const history = Array.from({ length: 2 }, (_, i) => ({ geometry: { ...shape(100 + i), parts: Object.fromEntries(
    ['front', 'side', 'roof', 'roofFront', 'roofSide'].map((k) => [k, Array(1024).fill(0)])) }, fingerprint: one.shapeFingerprint }))
  const decision = evaluateRealizedVilla(one, shape(), history)
  assert.equal(decision.accepted, false)
  assert.equal(decision.code, 'DIVERSITY_LIMIT')
})
test('villa routes reject unsafe requests and never serve unaccepted candidate files', async () => {
  const server = createServer(async (req, res) => {
    const handled = await handleVillaRequest(req, res, async () => ({ plan: {}, seed: 'not-numeric' }))
    if (!handled) { res.writeHead(404); res.end() }
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${server.address().port}`
  try {
    assert.equal((await fetch(url + '/api/villas', { method: 'POST' })).status, 400)
    assert.equal((await fetch(url + '/api/villas/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/files/input.json')).status, 404)
    assert.equal((await fetch(url + '/api/villas/../../server/.env')).status, 404)
  } finally { await new Promise((resolve) => server.close(resolve)) }
})

test('production uniqueness relaxes progressively without allowing invalid measured scenes',()=>{
 const history=Array.from({length:10},(_,i)=>({geometry:shape(100+i),fingerprint:one.shapeFingerprint}))
 const policies=Array.from({length:32},(_,i)=>productionDiversityPolicy(i,32))
 assert.equal(policies[0].threshold,.75)
 assert.equal(policies.at(-1).threshold,1)
 assert.ok(policies.every((p,i)=>i===0 || p.threshold>=policies[i-1].threshold))
 assert.equal(evaluateRealizedVilla(one,shape(),history,policies[0].threshold,policies[0].limits).accepted,false)
 assert.equal(evaluateRealizedVilla(one,shape(),history,policies.at(-1).threshold,policies.at(-1).limits).accepted,true)
 assert.throws(()=>evaluateRealizedVilla(one,{...shape(),planId:'wrong'},history,1,policies.at(-1).limits),/match/)
 assert.throws(()=>productionDiversityPolicy(0,32,NaN),RangeError)
})
