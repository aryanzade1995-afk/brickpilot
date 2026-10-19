import test from 'node:test'
import assert from 'node:assert/strict'
import {registerHooks} from 'node:module'
import {defaultBrief} from '../src/lib/model/brief.ts'
import {compile} from '../src/lib/model/canonical.ts'
import {generate} from '../src/lib/engine/generate.ts'
import {varyExterior} from '../src/lib/engine/variation.ts'
import {generateAlternativeDesign} from '../src/lib/engine/generateAlternativeDesign.ts'
import {createBuildingModel} from '../src/lib/engine/buildingModel.ts'
import {finishSignature} from '../src/lib/cost/finishAssignments.ts'
import {SITE_FORM_VERSION} from '../src/lib/engine/siteForm.ts'
registerHooks({resolve(s,c,next){return s.startsWith('@/')?{url:new URL(`../src/${s.slice(2)}`,import.meta.url).href,shortCircuit:true}:next(s,c)}})
const storage=new Map()
globalThis.localStorage={getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)}
globalThis.window={localStorage:globalThis.localStorage}
const {useStudio}=await import('../src/state/studio.ts')
const {useBlender,directionRenderKey}=await import('../src/state/blender.ts')
const brief=defaultBrief();brief.site.plotWidth=25;brief.site.plotDepth=30;brief.style.composition='staggered-wings'
const seed=650523944,design=varyExterior(generate(compile(brief),{seed:41,formVersion:SITE_FORM_VERSION}),seed)
const architecture=generateAlternativeDesign(design,seed)
const direction={...architecture,design,massing:design.massingType,seed,planSeed:design.planSeed,facadeModel:architecture.facadeGrammar}
const id=architecture.buildingModel.planId,key=directionRenderKey(id,seed)
const render={planId:id,seed,requestedSeed:seed,finishSignature:finishSignature(brief),quality:'preview',family:architecture.massingModel.family,
 files:{blend:'/pinned.blend',glb:'/pinned.glb',hero:'/pinned.png',front:'/front.png',aerial:'/aerial.png'},warnings:[]}
function reset(){
 useStudio.getState().loadSaved(brief,null)
 useStudio.setState({directions:[direction]})
 useBlender.setState({accepted:{},directionRenders:{[key]:render},previews:{},selectionKey:null,job:null,sourcePlanId:null,error:null})
}
test('pin → 2D → 3D, repeated navigation and reload reuse the exact direction render without a generation request',async()=>{
 reset()
 const original=globalThis.fetch
 globalThis.fetch=async()=>{throw new Error('Navigation must not submit or request a render')}
 try{
  const pinned=useStudio.getState().pin({massing:direction.massing,seed})
  assert.equal(pinned.design,direction.design,'Pin must adopt the card plan instead of replanning it')
  assert.equal(pinned.buildingModel.planId,id)
  assert.equal(useBlender.getState().accepted[id].files.glb,render.files.glb,'The card render is selected immediately')
  for(let i=0;i<3;i++){
   assert.equal(useStudio.getState().run(),pinned)
   await useBlender.getState().ensureForPlan(useStudio.getState().run().design,seed)
   useStudio.getState().pin({massing:direction.massing,seed,planSeed:direction.planSeed})
  }
  useStudio.setState({result:null,directions:null})
  const restored=useStudio.getState().run()
  assert.equal(createBuildingModel(restored.design).planId,id,'Saved pin replay must preserve the render identity')
  await useBlender.getState().ensureForPlan(restored.design,seed)
  assert.equal(useBlender.getState().accepted[id].files.glb,render.files.glb)
 }finally{globalThis.fetch=original}
})
test('a selected direction that is still rendering adopts the original completed job without another POST',async()=>{
 reset();useBlender.setState({directionRenders:{},previews:{[key]:{planId:id,seed,status:'rendering',phase:'Rendering',jobId:'same-card-job'}}})
 const original=globalThis.fetch,calls=[]
 globalThis.fetch=async(url,options)=>{calls.push([url,options?.method??'GET']);return new Response(JSON.stringify({status:'complete',result:render,debug:[]}))}
 try{
  useStudio.getState().pin({massing:direction.massing,seed,planSeed:direction.planSeed})
  await useBlender.getState().ensureForPlan(useStudio.getState().run().design,seed)
  assert.deepEqual(calls,[['/api/villas/same-card-job','GET']])
  assert.equal(useBlender.getState().accepted[id].files.glb,render.files.glb)
 }finally{globalThis.fetch=original}
})
test('a stopped direction shows its failure on navigation and waits for an explicit retry',async()=>{
 reset();useBlender.setState({directionRenders:{},previews:{[key]:{planId:id,seed,status:'failed',phase:'Stopped',error:'Render stopped',jobId:'stopped'}}})
 const original=globalThis.fetch
 globalThis.fetch=async()=>{throw new Error('A failed direction cannot be retried by navigation')}
 try{
  useStudio.getState().pin({massing:direction.massing,seed,planSeed:direction.planSeed})
  await useBlender.getState().ensureForPlan(design,seed)
  assert.equal(useBlender.getState().error,'Render stopped')
  assert.equal(useBlender.getState().job.status,'failed')
 }finally{globalThis.fetch=original}
})
test('opening a stopped direction cannot replace another plan that is still rendering',async()=>{
 reset()
 const job={id:'other-running-job',status:'rendering',phase:'Rendering',debug:[]}
 useBlender.setState({directionRenders:{},sourcePlanId:'other-plan',job,
  previews:{[key]:{planId:id,seed,status:'failed',phase:'Stopped',jobId:'stopped'}}})
 await useBlender.getState().ensureForPlan(design,seed)
 assert.equal(useBlender.getState().job,job)
 assert.equal(useBlender.getState().sourcePlanId,'other-plan')
})
