import test from 'node:test'
import assert from 'node:assert/strict'
import {registerHooks} from 'node:module'
import {writeFileSync} from 'node:fs'
import {defaultBrief} from '../src/lib/model/brief.ts'
import {compile} from '../src/lib/model/canonical.ts'
import {generate,distinctDirectionPlans} from '../src/lib/engine/generate.ts'
import {SITE_FORM_VERSION} from '../src/lib/engine/siteForm.ts'
import {buildingShape,buildingShapeDifference} from '../src/lib/engine/buildingShapes.ts'
import {horizontalPlan,frontFacingPlan} from '../src/lib/engine/planner/directionFrontage.ts'
import {validate} from '../src/lib/rules/index.ts'
registerHooks({resolve(s,c,next){return s.startsWith('@/')?{url:new URL(`../src/${s.slice(2)}`,import.meta.url).href,shortCircuit:true}:next(s,c)}})
const storage=new Map()
globalThis.localStorage={getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)}
globalThis.window={localStorage:globalThis.localStorage}
const {computeDirections,useStudio,parsePinned,serializePinned}=await import('../src/state/studio.ts')
const {runDirections,useConceptProgress}=await import('../src/state/directionsWorkerClient.ts')

test('ordinary plots offer four real distinct front-facing plans with at least two horizontal houses',()=>{
 for(const [w,d] of [[15.5,20.5],[18,24],[25,30]]){
  const b=defaultBrief();b.site.plotWidth=w;b.site.plotDepth=d
  const plans=distinctDirectionPlans(compile(b),4,SITE_FORM_VERSION)
  assert.equal(plans.length,4,`${w} x ${d}`)
  assert.ok(plans.every(p=>frontFacingPlan(p.plan)&&validate(p.plan).hardChecksPass))
  assert.ok(plans.filter(p=>horizontalPlan(p.plan)).length>=2)
  for(let i=0;i<4;i++)for(let j=0;j<i;j++)assert.ok(buildingShapeDifference(buildingShape(plans[i].plan),buildingShape(plans[j].plan))>=.08)
  for(const {plan} of plans){
   const pin=parsePinned(serializePinned({massing:plan.massingType,seed:plan.dna.seed,planSeed:plan.planSeed,recipe:plan.planRecipe,formVersion:plan.formVersion}))
   const replay=generate(compile(plan.model.brief),{massing:pin.massing,seed:pin.planSeed,recipe:pin.recipe,formVersion:pin.formVersion})
   assert.deepEqual(replay.floors,plan.floors)
  }
 }
})
test('the normalized front stays attached to the selected road bearing; impossible sites are not padded',()=>{
 for(const side of ['N','E','S','W']){
  const b=defaultBrief();b.site.plotWidth=25;b.site.plotDepth=30;b.site.facing=side;b.site.roadEdges=[side]
  const plans=distinctDirectionPlans(compile(b),4,SITE_FORM_VERSION)
  assert.equal(plans.length,4)
  assert.ok(plans.every(p=>p.plan.model.entrySide===side&&frontFacingPlan(p.plan)))
 }
 const b=defaultBrief();b.site.plotWidth=8;b.site.plotDepth=10;b.rooms.bedroomsWithBath=8
 assert.equal(distinctDirectionPlans(compile(b),4,SITE_FORM_VERSION).length,0)
})
test('a checked 2D plan is published before all four detailed architecture options finish',()=>{
 const brief=defaultBrief();brief.site.plotWidth=18;brief.site.plotDepth=24
 const start=performance.now(),events=[]
 const result=computeDirections({...useStudio.getState(),brief,pinned:null,recentVillaFingerprints:[]},
  (value,label)=>events.push({kind:'progress',value,label,ms:performance.now()-start}),
  (plan,index)=>{assert.ok(validate(plan).hardChecksPass);events.push({kind:'plan',index,ms:performance.now()-start})})
 const elapsed=performance.now()-start,first=events.find(e=>e.kind==='plan')
 assert.ok(first);assert.ok(first.ms<elapsed);assert.equal(result.dirs.length,4)
 assert.ok(events.findIndex(e=>e.kind==='plan')<events.findIndex(e=>e.value===100))
 assert.ok(result.dirs.filter(d=>horizontalPlan(d.design)).length>=2)
 const timings={firstPlanMs:first.ms,completeMs:elapsed,count:result.dirs.length}
 writeFileSync('output/directions-progressive-timings.json',JSON.stringify(timings,null,2));console.log(timings)
})
test('streamed plans remain visible while generation runs; newer briefs cancel and ignore stale messages',async()=>{
 const originalWorker=globalThis.Worker,workers=[]
 class WorkerMock{
  constructor(){this.terminated=false;workers.push(this)}
  postMessage(input){this.input=input}
  terminate(){this.terminated=true}
  emit(data){this.onmessage({data})}
 }
 globalThis.Worker=WorkerMock
 try{
  const base={...useStudio.getState(),brief:defaultBrief(),pinned:null,recentVillaFingerprints:[]}
  const a=runDirections(base).catch(error=>error)
  const first=workers[0]
  first.emit({plan:{id:'first-plan'},index:0})
  assert.equal(useConceptProgress.getState().active,true);assert.equal(useConceptProgress.getState().plans[0].id,'first-plan')
  const next={...base,brief:{...base.brief,variation:base.brief.variation+1}}
  const b=runDirections(next)
  assert.ok(first.terminated)
  first.emit({plan:{id:'stale'},index:1})
  assert.equal(useConceptProgress.getState().plans.length,0)
  await a;assert.equal(useConceptProgress.getState().active,true)
  workers[1].emit({plan:{id:'new-plan'},index:0})
  workers[1].emit({ok:true,result:{dirs:[],history:[],debug:[],notice:null}})
  await b;assert.equal(useConceptProgress.getState().active,false)
  assert.equal(useConceptProgress.getState().plans[0].id,'new-plan')
  assert.equal(useConceptProgress.getState().sourceBrief,next.brief)
 }finally{globalThis.Worker=originalWorker}
})
test('worker startup failures stop loading and allow a retry',async()=>{
 const original=globalThis.Worker
 globalThis.Worker=class{constructor(){throw new Error('worker unavailable')}}
 try{
  await assert.rejects(runDirections({...useStudio.getState(),brief:defaultBrief(),pinned:null}),/unavailable/)
  assert.equal(useConceptProgress.getState().active,false)
 }finally{globalThis.Worker=original}
})
