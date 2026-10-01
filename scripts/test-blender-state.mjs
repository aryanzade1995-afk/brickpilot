import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { compile } from '../src/lib/model/canonical.ts'
import { generate } from '../src/lib/engine/generate.ts'
import { createBuildingModel } from '../src/lib/engine/buildingModel.ts'
import { openSpaceBrief } from './fixtures/open-space-brief.mjs'

registerHooks({ resolve(specifier, context, nextResolve) {
  return specifier.startsWith('@/') ? { url: new URL(`../src/${specifier.slice(2)}`, import.meta.url).href, shortCircuit: true } : nextResolve(specifier, context)
} })
const storage = new Map()
globalThis.localStorage = { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) }
globalThis.window = {localStorage: globalThis.localStorage}
const { useBlender } = await import('../src/state/blender.ts')
const plan = generate(compile(openSpaceBrief('maxBuild')))
const id = createBuildingModel(plan).planId
const result = { planId: id, seed: plan.dna.seed, requestedSeed: plan.dna.seed, quality: 'preview',
  family: 'STEPPED', hero: 'C_FRAME', roofline: 'FLAT_PARAPET', warnings: [],
  files: Object.fromEntries(['blend', 'glb', 'hero', 'front', 'aerial'].map(k => [k, `/api/villas/test/files/model.${k}`])) }
const reset = () => useBlender.setState({ accepted: {}, job: null, sourcePlanId: null, error: null })
const respond = data => new Response(JSON.stringify(data), {headers: {'content-type': 'application/json'}})

test('default Massing generation submits the exact verified plan and numeric seed only once', async () => {
  reset()
  const before = JSON.stringify(plan), calls = [], original = globalThis.fetch
  globalThis.fetch = async (url, options) => {
    calls.push([url, options])
    if (url.endsWith('/health')) return respond({available: true})
    if (options?.method === 'POST') return respond({id: 'job-1', status: 'queued', phase: 'Queued', debug: []})
    return respond({id: 'job-1', status: 'complete', phase: 'Ready', result, debug: []})
  }
  try {
    await Promise.all([useBlender.getState().ensureForPlan(plan), useBlender.getState().ensureForPlan(plan)])
    await useBlender.getState().ensureForPlan(plan)
    assert.equal(calls.filter(([url]) => url === '/api/villas').length, 1)
    const body = JSON.parse(calls.find(([, o]) => o?.method === 'POST')[1].body)
    assert.deepEqual(body.plan, plan)
    assert.equal(body.seed, plan.dna.seed)
    assert.deepEqual(body.plan.siteFeatures, plan.siteFeatures)
    assert.equal(body.quality, 'preview')
    assert.equal(JSON.stringify(plan), before)
    assert.equal(useBlender.getState().accepted[id].files.glb, result.files.glb)
  } finally { globalThis.fetch = original }
})

test('returning to an accepted plan reuses its model without a new request', async () => {
  reset(); useBlender.setState({accepted: {[id]: result}})
  const original = globalThis.fetch
  globalThis.fetch = async () => { throw new Error('Must not request or regenerate') }
  try { await useBlender.getState().ensureForPlan(plan); assert.equal(useBlender.getState().accepted[id], result) }
  finally { globalThis.fetch = original }
})

test('an unavailable Blender service explains the failure without automatic retry loops', async () => {
  reset()
  let calls = 0; const original = globalThis.fetch
  globalThis.fetch = async () => { calls++; return respond({available: false, note: 'Set BLENDER_BIN'}) }
  try {
    await useBlender.getState().ensureForPlan(plan)
    await useBlender.getState().ensureForPlan(plan)
    assert.equal(calls, 1)
    assert.equal(useBlender.getState().sourcePlanId, id)
    assert.match(useBlender.getState().error, /BLENDER_BIN/)
  } finally { globalThis.fetch = original }
})

test('another plan running in Blender is retained and cannot be replaced by navigation', async () => {
  reset()
  const job = {id: 'other-job', status: 'rendering', phase: 'Rendering', debug: []}
  useBlender.setState({sourcePlanId: 'another-plan', job})
  await useBlender.getState().ensureForPlan(plan)
  assert.equal(useBlender.getState().job, job)
  assert.equal(useBlender.getState().sourcePlanId, 'another-plan')
})

test('manual another-design generation changes the exterior seed while preserving the entire source plan', async () => {
  reset(); useBlender.setState({accepted: {[id]: result}})
  const before = JSON.stringify(plan), original = globalThis.fetch
  let submitted
  globalThis.fetch = async (url, options) => {
    if (options?.method === 'POST') { submitted = JSON.parse(options.body); return respond({id: 'next', status: 'queued', debug: []}) }
    return respond({id: 'next', status: 'complete', result: {...result, seed: 772}, debug: []})
  }
  try {
    await useBlender.getState().generate(plan, 772)
    assert.equal(submitted.seed, 772)
    assert.deepEqual(submitted.plan, plan)
    assert.equal(JSON.stringify(plan), before)
    assert.equal(useBlender.getState().accepted[id].seed, 772)
  } finally { globalThis.fetch = original }
})

test('a damaged source plan cannot launch Blender or replace a prior accepted model', async () => {
  reset(); useBlender.setState({accepted: {[id]: result}})
  const damaged = structuredClone(plan)
  damaged.floors[0].rooms[0].rect.w = 10
  const original = globalThis.fetch
  globalThis.fetch = async () => { throw new Error('Invalid plan must not reach the service') }
  try {
    await useBlender.getState().generate(damaged, 772)
    assert.match(useBlender.getState().error, /2D plan checks/)
    assert.equal(useBlender.getState().accepted[id], result)
  } finally { globalThis.fetch = original }
})
