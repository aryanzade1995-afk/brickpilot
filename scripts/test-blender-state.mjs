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
const { useBlender, directionRenderKey } = await import('../src/state/blender.ts')
const plan = generate(compile(openSpaceBrief('maxBuild')))
const id = createBuildingModel(plan).planId
const result = { planId: id, seed: plan.dna.seed, requestedSeed: plan.dna.seed, quality: 'preview',
  family: 'STEPPED', hero: 'C_FRAME', roofline: 'FLAT_PARAPET', warnings: [],
  files: Object.fromEntries(['blend', 'glb', 'hero', 'front', 'aerial'].map(k => [k, `/api/villas/test/files/model.${k}`])) }
const reset = () => useBlender.setState({ accepted: {}, directionRenders: {}, selectionKey: null,
  previews: {}, job: null, sourcePlanId: null, error: null })
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
    assert.ok(Number.isSafeInteger(body.seed))
    assert.notEqual(body.seed, plan.dna.seed)
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

test('entering Massing while the pinned direction renders waits for that preview without queuing a second villa',async()=>{
 reset()
 const key=directionRenderKey(id,result.seed)
 useBlender.setState({previews:{[key]:{planId:id,seed:result.seed,status:'rendering',phase:'Rendering',jobId:'preview-job'}}})
 const calls=[],original=globalThis.fetch
 globalThis.fetch=async(url,options)=>{calls.push([url,options]);return respond({status:'complete',result,debug:[]})}
 try{
  await useBlender.getState().ensureForPlan(plan,result.seed)
  await useBlender.getState().ensureForPlan(plan,result.seed)
  assert.deepEqual(calls.map(([url])=>url),['/api/villas/preview-job'])
  assert.equal(useBlender.getState().accepted[id].seed,result.seed)
  assert.equal(useBlender.getState().accepted[id].files.glb,result.files.glb)
 }finally{globalThis.fetch=original}
})

test('two directions using the same plan retain separate seed-specific renders and pin the correct one',async()=>{
 reset()
 const posted=[],original=globalThis.fetch
 globalThis.fetch=async(url,options)=>{
  if(url.endsWith('/health'))return respond({available:true})
  if(options?.method==='POST'){
   const body=JSON.parse(options.body);posted.push(body)
   return respond({id:String(body.seed),status:'queued',phase:'Waiting',debug:[]})
  }
  const seed=Number(url.split('/').at(-1))
  return respond({status:'complete',result:{...result,seed,requestedSeed:seed,
   files:{...result.files,glb:`/model-${seed}.glb`}},debug:[]})
 }
 try{
  await useBlender.getState().previewDirections([{plan,seed:21},{plan,seed:22},{plan,seed:21}])
  assert.equal(posted.length,2);assert.ok(posted.every(p=>p.exact===true))
  assert.equal(Object.keys(useBlender.getState().directionRenders).length,2)
  await useBlender.getState().ensureForPlan(plan,21)
  assert.equal(useBlender.getState().accepted[id].files.glb,'/model-21.glb')
  await useBlender.getState().ensureForPlan(plan,22)
  assert.equal(useBlender.getState().accepted[id].files.glb,'/model-22.glb')
  assert.equal(posted.length,2)
 }finally{globalThis.fetch=original}
})

test('pinned generation requests an exact seed, while Generate another remains a new exterior on the same plan',async()=>{
 reset()
 const posted=[],original=globalThis.fetch
 let seed
 globalThis.fetch=async(url,options)=>{
  if(url.endsWith('/health'))return respond({available:true})
  if(options?.method==='POST'){const body=JSON.parse(options.body);posted.push(body);seed=body.seed;return respond({id:'job',status:'queued',debug:[]})}
  return respond({status:'complete',result:{...result,seed,requestedSeed:seed},debug:[]})
 }
 try{
  await useBlender.getState().ensureForPlan(plan,123)
  assert.equal(posted[0].seed,123);assert.equal(posted[0].exact,true)
  await useBlender.getState().generate(plan,124)
  await useBlender.getState().ensureForPlan(plan,123)
  assert.equal(posted.length,2);assert.equal(posted[1].exact,undefined)
  assert.deepEqual(posted[1].plan,plan)
  assert.equal(useBlender.getState().accepted[id].seed,124)
 }finally{globalThis.fetch=original}
})

test('a preview produced with another seed is rejected instead of silently showing another direction',async()=>{
 reset()
 const original=globalThis.fetch
 globalThis.fetch=async(url,options)=>url.endsWith('/health')?respond({available:true}):
  options?.method==='POST'?respond({id:'wrong',status:'queued',phase:'Queued',debug:[]}):
  respond({status:'complete',result:{...result,seed:999},debug:[]})
 try{
  await useBlender.getState().previewDirections([{plan,seed:123}])
  const key=directionRenderKey(id,123)
  assert.equal(useBlender.getState().previews[key].status,'failed')
  assert.match(useBlender.getState().previews[key].error,/plan and seed/)
  assert.equal(useBlender.getState().directionRenders[key],undefined)
 }finally{globalThis.fetch=original}
})

test('direct pinned generation rejects a stale backend that substitutes another seed',async()=>{
 reset()
 const original=globalThis.fetch
 globalThis.fetch=async(url,options)=>url.endsWith('/health')?respond({available:true}):
  options?.method==='POST'?respond({id:'stale',status:'queued',phase:'Queued',debug:[]}):
  respond({status:'complete',result:{...result,seed:999},debug:[]})
 try{
  await useBlender.getState().ensureForPlan(plan,123)
  assert.equal(useBlender.getState().job.status,'failed')
  assert.match(useBlender.getState().error,/Restart the backend/)
  assert.equal(useBlender.getState().accepted[id],undefined)
 }finally{globalThis.fetch=original}
})

test('reloading while direction previews run resumes the saved job instead of submitting it again',async()=>{
 reset()
 const key=directionRenderKey(id,result.seed)
 useBlender.setState({previews:{[key]:{planId:id,seed:result.seed,status:'queued',phase:'Waiting',jobId:'saved-preview'}}})
 await useBlender.persist.rehydrate()
 const calls=[],original=globalThis.fetch
 globalThis.fetch=async(url,options)=>{calls.push([url,options]);return respond({status:'complete',result,debug:[]})}
 try{
  await useBlender.getState().previewDirections([{plan,seed:result.seed}])
  assert.deepEqual(calls.map(([url])=>url),['/api/villas/saved-preview'])
  assert.equal(useBlender.getState().directionRenders[key].seed,result.seed)
 }finally{globalThis.fetch=original}
})

test('an interrupted preview submission cannot leave the main page waiting forever after reload',async()=>{
 reset()
 const key=directionRenderKey(id,123)
 useBlender.setState({previews:{[key]:{planId:id,seed:123,status:'queued',phase:'Waiting for Blender'}}})
 await useBlender.persist.rehydrate()
 assert.equal(useBlender.getState().previews[key].status,'failed')
 const posted=[],original=globalThis.fetch
 globalThis.fetch=async(url,options)=>url.endsWith('/health')?respond({available:true}):
  options?.method==='POST'?(posted.push(JSON.parse(options.body)),respond({id:'recovered',status:'queued',debug:[]})):
  respond({status:'complete',result:{...result,seed:123},debug:[]})
 try{
  await useBlender.getState().ensureForPlan(plan,123)
  assert.equal(posted.length,1);assert.equal(posted[0].exact,true)
  assert.equal(useBlender.getState().accepted[id].seed,123)
 }finally{globalThis.fetch=original}
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


test('automatic seeds avoid the previous seed even when entropy repeats', async () => {
  const { newDesignSeed } = await import('../src/lib/newDesignSeed.ts')
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto')
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: {
    getRandomValues: (values) => { values[0] = 4294967295; return values },
  } })
  try {
    assert.equal(newDesignSeed(4294967295), 0)
    assert.equal(newDesignSeed(12), 4294967295)
  } finally { Object.defineProperty(globalThis, 'crypto', descriptor) }
})
