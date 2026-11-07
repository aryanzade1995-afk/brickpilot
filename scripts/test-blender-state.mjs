import { finishSignature } from '../src/lib/cost/finishAssignments.ts'
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
const result = { finishSignature: finishSignature(plan.model.brief), planId: id, seed: plan.dna.seed, requestedSeed: plan.dna.seed, quality: 'preview',
  family: 'STEPPED', hero: 'C_FRAME', roofline: 'FLAT_PARAPET', warnings: [],
  files: Object.fromEntries(['blend', 'glb', 'hero', 'front', 'aerial'].map(k => [k, `/api/villas/test/files/model.${k}`])) }
const reset = () => useBlender.setState({ baseModels:{},accepted: {}, directionRenders: {}, selectionKey: null,
  previews: {}, job: null, sourcePlanId: null, error: null })
const respond = data => new Response(JSON.stringify(data), {headers: {'content-type': 'application/json'}})

test('rendering a facade retains the original house model for immediate restoration after reload',async()=>{
 reset();useBlender.setState({accepted:{[id]:result}})
 const original=globalThis.fetch
 globalThis.fetch=async(url,options)=>respond(options?.method==='POST'?{id:'facade-export',status:'queued',debug:[]}:{id:'facade-export',status:'complete',result:{...result,facadeSignature:'facade-d07',files:{...result.files,glb:'/styled.glb'}},debug:[]})
 try{
  await useBlender.getState().generate(plan,result.seed,'preview',true)
  assert.equal(useBlender.getState().accepted[id].files.glb,'/styled.glb')
  assert.equal(useBlender.getState().baseModels[id].files.glb,result.files.glb)
  await useBlender.persist.rehydrate()
  assert.equal(useBlender.getState().baseModels[id].files.glb,result.files.glb)
 }finally{globalThis.fetch=original}
})

test('pinning another plan detaches the old completed job before Massing resumes', async () => {
  reset()
  useBlender.setState({sourcePlanId:'previous-plan',selectionKey:'previous-selection',
    job:{id:'previous-model',status:'complete',result:{...result,planId:'previous-plan'},debug:[]}})
  const original=globalThis.fetch,posts=[]
  globalThis.fetch=async(url,options)=>{
    if(url.endsWith('/health'))return respond({available:true})
    if(options?.method==='POST'){posts.push(JSON.parse(options.body));return respond({id:'pinned-model',status:'queued',debug:[]})}
    return respond({id:url.split('/').at(-1),status:'complete',result:url.endsWith('/previous-model')?{...result,planId:'previous-plan'}:result,debug:[]})
  }
  try{
    useBlender.getState().selectDirection(plan,result.seed)
    await useBlender.getState().resume()
    await useBlender.getState().ensureForPlan(plan,result.seed)
    assert.equal(posts.length,1)
    assert.equal(posts[0].exact,true)
    assert.deepEqual(posts[0].plan,plan)
    assert.equal(useBlender.getState().accepted[id].files.glb,result.files.glb)
    assert.equal(useBlender.getState().error,null)
  }finally{globalThis.fetch=original}
})

test('reload repairs the legacy wrong-source handoff without retrying an actual failed render', async () => {
  reset()
  useBlender.setState({sourcePlanId:id,selectionKey:`${directionRenderKey(id,result.seed)}:${result.finishSignature}`,
    error:'Generated model belongs to a different source plan',
    job:{id:'legacy-unrelated',status:'failed',result:{...result,planId:'previous-plan'},debug:[]}})
  const original=globalThis.fetch,posts=[]
  globalThis.fetch=async(url,options)=>{
    if(url.endsWith('/health'))return respond({available:true})
    if(options?.method==='POST'){posts.push(JSON.parse(options.body));return respond({id:'repaired-handoff',status:'queued',debug:[]})}
    return respond({id:url.split('/').at(-1),status:'complete',result:url.endsWith('/legacy-unrelated')?{...result,planId:'previous-plan'}:result,debug:[]})
  }
  try{
    await useBlender.getState().resume()
    await useBlender.getState().ensureForPlan(plan,result.seed)
    assert.equal(posts.length,1)
    assert.equal(useBlender.getState().accepted[id].seed,result.seed)
    assert.equal(useBlender.getState().error,null)
  }finally{globalThis.fetch=original}
})

test('a matching selection key cannot reuse another exterior seed for the same rooms', async () => {
  reset()
  useBlender.setState({accepted:{[id]:{...result,seed:result.seed+1}}})
  useBlender.getState().selectDirection(plan,result.seed)
  const original=globalThis.fetch,posts=[]
  globalThis.fetch=async(url,options)=>{
    if(url.endsWith('/health'))return respond({available:true})
    if(options?.method==='POST'){posts.push(JSON.parse(options.body));return respond({id:'right-seed',status:'queued',debug:[]})}
    return respond({id:'right-seed',status:'complete',result,debug:[]})
  }
  try{
    await useBlender.getState().ensureForPlan(plan,result.seed)
    assert.equal(posts.length,1)
    assert.equal(posts[0].seed,result.seed)
    assert.equal(useBlender.getState().accepted[id].seed,result.seed)
  }finally{globalThis.fetch=original}
})

test('pinning during an existing image poll continues to the full model without another navigation', async () => {
  reset()
  const key=directionRenderKey(id,result.seed),original=globalThis.fetch,posts=[]
  let release
  const image=new Promise(resolve=>{release=resolve})
  useBlender.setState({previews:{[key]:{planId:id,seed:result.seed,jobId:'pending-image',status:'rendering',phase:'Rendering'}}})
  globalThis.fetch=async(url,options)=>{
    if(url.endsWith('/health'))return respond({available:true})
    if(options?.method==='POST'){posts.push(JSON.parse(options.body));return respond({id:'after-image',status:'queued',debug:[]})}
    if(url.endsWith('/pending-image'))return image
    return respond({id:'after-image',status:'complete',result,debug:[]})
  }
  try{
    const preview=useBlender.getState().previewDirections([{plan,seed:result.seed}])
    useBlender.getState().selectDirection(plan,result.seed)
    const model=useBlender.getState().ensureForPlan(plan,result.seed)
    release(respond({id:'pending-image',status:'complete',phase:'Ready',directionImage:{planId:id,seed:result.seed,finishSignature:result.finishSignature,url:'/api/villas/pending-image/preview/hero'},debug:[]}))
    await Promise.all([preview,model])
    assert.equal(posts.length,1)
    assert.equal(posts[0].directionPreview,undefined)
    assert.equal(useBlender.getState().accepted[id].files.glb,result.files.glb)
  }finally{globalThis.fetch=original}
})

test('a completed image-only job cannot block the selected full 3D model', async () => {
  reset()
  const key = directionRenderKey(id, result.seed)
  useBlender.setState({sourcePlanId:id, selectionKey:`${key}:${result.finishSignature}`,
    job:{id:'image-only',status:'complete',phase:'Ready',debug:[]},
    previews:{[key]:{planId:id,seed:result.seed,status:'complete',phase:'Ready',jobId:'image-only'}}})
  const original = globalThis.fetch, posted = []
  globalThis.fetch = async (url, options) => {
    if (url.endsWith('/health')) return respond({available:true})
    if (url.endsWith('/image-only')) return respond({id:'image-only',status:'complete',phase:'Ready',
      directionImage:{planId:id,seed:result.seed,finishSignature:result.finishSignature,url:'/api/villas/image-only/preview/hero'},debug:[]})
    if (options?.method === 'POST') {
      posted.push(JSON.parse(options.body))
      return respond({id:'full-model',status:'queued',debug:[]})
    }
    return respond({id:'full-model',status:'complete',result,debug:[]})
  }
  try {
    await useBlender.getState().resume()
    await useBlender.getState().ensureForPlan(plan,result.seed)
    await useBlender.getState().ensureForPlan(plan,result.seed)
    assert.equal(posted.length,1)
    assert.equal(posted[0].seed,result.seed)
    assert.equal(posted[0].directionPreview,undefined)
    assert.equal(useBlender.getState().accepted[id].files.glb,result.files.glb)
  } finally { globalThis.fetch = original }
})

test('switching pins during the availability request cannot export the previous selection', async () => {
  reset()
  const original=globalThis.fetch,posts=[]
  let release
  const health=new Promise(resolve=>{release=resolve})
  globalThis.fetch=async(url,options)=>{
    if(url.endsWith('/health'))return health
    posts.push(options)
    throw new Error('The superseded selection must not be submitted')
  }
  try{
    useBlender.getState().selectDirection(plan,result.seed)
    const pending=useBlender.getState().ensureForPlan(plan,result.seed)
    useBlender.getState().selectDirection(plan,result.seed+1)
    release(respond({available:true}))
    await pending
    assert.equal(posts.length,0)
    assert.equal(useBlender.getState().job,null)
    assert.equal(useBlender.getState().error,null)
  }finally{globalThis.fetch=original}
})

test('a saved failed model retains its error after reload and does not silently retry', async () => {
  reset()
  useBlender.setState({sourcePlanId:id,selectionKey:`${directionRenderKey(id,result.seed)}:${result.finishSignature}`,
    job:{id:'failed-model',status:'failed',phase:'Stopped',debug:[]},error:'Blender render was interrupted'})
  await useBlender.persist.rehydrate()
  const original = globalThis.fetch
  globalThis.fetch = async () => { throw new Error('Navigation must not retry a failed render') }
  try {
    await useBlender.getState().ensureForPlan(plan,result.seed)
    assert.equal(useBlender.getState().error,'Blender render was interrupted')
  } finally { globalThis.fetch = original }
})

test('pipe sizes and underground tank choices reuse the accepted villa without a render request',async()=>{
 reset();useBlender.setState({accepted:{[id]:result}})
 const changed=structuredClone(plan)
 Object.assign(changed.model.brief.specs.overrides,{'water-pipe-size':'mm32','water-riser-size':'mm50','underground-water-tank':'l5000','drain-tank':'septic3000'})
 const original=globalThis.fetch
 globalThis.fetch=async()=>{throw new Error('A service choice cannot regenerate the building')}
 try{
  await useBlender.getState().ensureForPlan(changed,result.seed)
  assert.equal(useBlender.getState().accepted[id].files.glb,result.files.glb)
  assert.equal(useBlender.getState().job,null)
 }finally{globalThis.fetch=original}
})

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

test('reopening a refreshed direction does not restore its older cached model', async () => {
  reset()
  const key=directionRenderKey(id,result.seed)
  const refreshed={...result,files:{...result.files,glb:'/refreshed-no-main-door-sign.glb'}}
  useBlender.setState({accepted:{[id]:refreshed},directionRenders:{[key]:result},selectionKey:'another-direction'})
  const original=globalThis.fetch
  globalThis.fetch=async()=>{throw new Error('No new render is needed')}
  try {
    await useBlender.getState().ensureForPlan(plan,result.seed)
    assert.equal(useBlender.getState().accepted[id].files.glb,refreshed.files.glb)
  } finally {globalThis.fetch=original}
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

test('pinned generation requests an exact seed and returning to the pin restores its cached exterior',async()=>{
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
  assert.equal(useBlender.getState().accepted[id].seed,124,'Explicit generation can change the exterior')
  await useBlender.getState().ensureForPlan(plan,123)
  assert.equal(posted.length,2);assert.equal(posted[1].exact,undefined)
  assert.deepEqual(posted[1].plan,plan)
  assert.equal(useBlender.getState().accepted[id].seed,123,'Opening the pinned direction must restore that exact exterior')
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


test('changing finishes re-renders the same accepted seed and exact rooms instead of reusing stale materials', async () => {
 reset(); useBlender.setState({accepted:{[id]:result}})
 const changed=structuredClone(plan);changed.model.brief.specs.overrides['exterior-paint']='premium'
 const original=globalThis.fetch,posted=[]
 globalThis.fetch=async(url,options)=>{
  if(url.endsWith('/health'))return respond({available:true})
  if(options?.method==='POST'){posted.push(JSON.parse(options.body));return respond({id:'finish-job',status:'queued',debug:[]})}
  return respond({status:'complete',result:{...result,finishSignature:finishSignature(changed.model.brief)},debug:[]})
 }
 try{
  await useBlender.getState().ensureForPlan(changed,result.seed)
  assert.equal(posted.length,1);assert.equal(posted[0].seed,result.seed);assert.equal(posted[0].exact,true)
  assert.deepEqual(posted[0].plan.floors,plan.floors)
  await useBlender.getState().ensureForPlan(changed,result.seed);assert.equal(posted.length,1)
 }finally{globalThis.fetch=original}
})

test('reload recovers a repaired failed job without submitting another render',async()=>{
 reset()
 const key=directionRenderKey(id,result.seed),original=globalThis.fetch,calls=[]
 useBlender.setState({sourcePlanId:id,selectionKey:`${key}:${result.finishSignature}`,error:'Blender failed (1)',job:{id:'repaired-job',status:'failed',phase:'Stopped',expectedSeed:result.seed,debug:[]},previews:{[key]:{planId:id,seed:result.seed,jobId:'repaired-job',status:'failed',phase:'Stopped',error:'Blender failed (1)'}}})
 globalThis.fetch=async(url,options)=>{calls.push([url,options?.method]);assert.notEqual(options?.method,'POST');return respond({id:'repaired-job',status:'complete',phase:'Ready',result,debug:[]})}
 try{
  await useBlender.getState().resume()
  assert.equal(useBlender.getState().accepted[id].files.glb,result.files.glb)
  assert.equal(useBlender.getState().previews[key].status,'complete')
  assert.equal(useBlender.getState().error,null)
  const count=calls.length
  await useBlender.getState().resume()
  assert.equal(calls.length,count)
 }finally{globalThis.fetch=original}
})

test('explicit retry replaces the failed direction preview with the new successful job',async()=>{
 reset();const original=globalThis.fetch,key=directionRenderKey(id,result.seed)
 useBlender.setState({sourcePlanId:id,job:{id:'old-job',status:'failed',phase:'Stopped',debug:[]},previews:{[key]:{planId:id,seed:result.seed,status:'failed',phase:'Stopped',jobId:'old-job',error:'Old failure'}}})
 globalThis.fetch=async(url,options)=>respond(options?.method==='POST'?{id:'retry-job',status:'queued',phase:'Queued',debug:[]}:{id:'retry-job',status:'complete',phase:'Ready',result,debug:[]})
 try{
  await useBlender.getState().generate(plan,result.seed,'preview',true)
  assert.equal(useBlender.getState().previews[key].status,'complete')
  assert.equal(useBlender.getState().previews[key].jobId,'retry-job')
  assert.equal(useBlender.getState().previews[key].error,undefined)
  await useBlender.getState().ensureForPlan(plan,result.seed)
  assert.equal(useBlender.getState().error,null)
 }finally{globalThis.fetch=original}
})

test('Directions discovers a recovered preview without queuing a new render',async()=>{
 reset();const key=directionRenderKey(id,result.seed),original=globalThis.fetch
 useBlender.setState({previews:{[key]:{planId:id,seed:result.seed,jobId:'recovered-preview',status:'failed',phase:'Stopped'}}})
 globalThis.fetch=async(url,options)=>{assert.notEqual(options?.method,'POST');return respond({id:'recovered-preview',status:'complete',phase:'Ready',result,debug:[]})}
 try{
  await useBlender.getState().previewDirections([{plan,seed:result.seed}])
  assert.equal(useBlender.getState().previews[key].status,'complete')
  assert.equal(useBlender.getState().directionRenders[key].seed,result.seed)
 }finally{globalThis.fetch=original}
})

test('Directions explicit retry submits the same plan and seed once',async()=>{
 reset();const key=directionRenderKey(id,result.seed),original=globalThis.fetch,posts=[]
 useBlender.setState({previews:{[key]:{planId:id,seed:result.seed,jobId:'failed-preview',status:'failed',phase:'Stopped'}}})
 globalThis.fetch=async(url,options)=>{
  if(options?.method==='POST'){posts.push(JSON.parse(options.body));return respond({id:'new-preview',status:'queued',phase:'Queued',debug:[]})}
  return respond(url.endsWith('/health')?{available:true}:url.endsWith('/failed-preview')?{status:'failed',error:'Old failure'}:{id:'new-preview',status:'complete',phase:'Ready',result,debug:[]})
 }
 try{
  await useBlender.getState().previewDirections([{plan,seed:result.seed}],true)
  assert.equal(posts.length,1);assert.equal(posts[0].seed,result.seed);assert.equal(posts[0].exact,true);assert.deepEqual(posts[0].plan,plan)
  assert.equal(useBlender.getState().previews[key].status,'complete')
 }finally{globalThis.fetch=original}
})

test('Directions uses a completed image immediately without pretending a downloadable model exists',async()=>{
 reset();const key=directionRenderKey(id,result.seed),original=globalThis.fetch,posts=[]
 globalThis.fetch=async(url,options)=>{
  if(options?.method==='POST'){posts.push(JSON.parse(options.body));return respond({id:'image-job',status:'queued',phase:'Queued',debug:[]})}
  return respond(url.endsWith('/health')?{available:true}:{id:'image-job',status:'complete',phase:'Ready',
   directionImage:{planId:id,seed:result.seed,finishSignature:result.finishSignature,url:'/api/villas/image-job/preview/hero'},debug:[]})
 }
 try{
  await useBlender.getState().previewDirections([{plan,seed:result.seed}])
  const state=useBlender.getState()
  assert.equal(posts.length,1);assert.equal(posts[0].directionPreview,true)
  assert.equal(state.previews[key].status,'complete');assert.equal(state.previews[key].heroPreview,'/api/villas/image-job/preview/hero')
  assert.equal(state.accepted[id],undefined);assert.equal(state.directionRenders[key],undefined)
  await state.previewDirections([{plan,seed:result.seed}]);assert.equal(posts.length,1)
 }finally{globalThis.fetch=original}
})

test('selecting an image-only direction exports exactly that plan and seed once, at full existing model quality',async()=>{
 reset();const key=directionRenderKey(id,result.seed),original=globalThis.fetch,posts=[]
 useBlender.setState({previews:{[key]:{planId:id,seed:result.seed,jobId:'image-job',status:'complete',phase:'Ready',heroPreview:'/image.png'}}})
 globalThis.fetch=async(url,options)=>{
  if(options?.method==='POST'){posts.push(JSON.parse(options.body));return respond({id:'model-job',status:'queued',phase:'Queued',debug:[]})}
  return respond(url.endsWith('/health')?{available:true}:{id:'model-job',status:'complete',phase:'Ready',result,debug:[]})
 }
 try{
  await useBlender.getState().ensureForPlan(plan,result.seed)
  await useBlender.getState().ensureForPlan(plan,result.seed)
  assert.equal(posts.length,1);assert.equal(posts[0].directionPreview,undefined)
  assert.equal(posts[0].exact,true);assert.equal(posts[0].seed,result.seed);assert.deepEqual(posts[0].plan,plan)
  assert.equal(useBlender.getState().accepted[id].files.glb,result.files.glb)
 }finally{globalThis.fetch=original}
})

test('an image from a different plan is rejected rather than attached to the card',async()=>{
 reset();const key=directionRenderKey(id,result.seed),original=globalThis.fetch
 useBlender.setState({previews:{[key]:{planId:id,seed:result.seed,jobId:'wrong-image',status:'queued',phase:'Queued'}}})
 globalThis.fetch=async()=>respond({id:'wrong-image',status:'complete',phase:'Ready',directionImage:{planId:'other-plan',seed:result.seed,url:'/api/villas/wrong-image/preview/hero'}})
 try{
  await useBlender.getState().previewDirections([{plan,seed:result.seed}])
  assert.equal(useBlender.getState().previews[key].status,'failed')
  assert.match(useBlender.getState().previews[key].error,/does not match/)
 }finally{globalThis.fetch=original}
})
