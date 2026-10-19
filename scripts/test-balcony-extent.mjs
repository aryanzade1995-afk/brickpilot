import test from 'node:test'
import assert from 'node:assert/strict'
import {registerHooks} from 'node:module'
import {fullBalconyRect,expandBalconyArea} from '../src/lib/engine/balconyExtent.ts'
import {defaultBrief} from '../src/lib/model/brief.ts'
import {compile} from '../src/lib/model/canonical.ts'
import {generate} from '../src/lib/engine/generate.ts'
import {varyExterior} from '../src/lib/engine/variation.ts'
import {createBuildingModel} from '../src/lib/engine/buildingModel.ts'
import {generateAlternativeDesign} from '../src/lib/engine/generateAlternativeDesign.ts'
import {SITE_FORM_VERSION} from '../src/lib/engine/siteForm.ts'
import {validate} from '../src/lib/rules/index.ts'
import {finishSignature} from '../src/lib/cost/finishAssignments.ts'
import {calculateQuantities} from '../src/lib/cost/quantities.ts'

test('unused strips across joined supported slabs become part of one balcony rectangle',()=>{
 const source={x:16700,y:2300,w:3600,h:3600}
 const lower=[{x:6000,y:2000,w:14800,h:4200},{x:6000,y:6200,w:14800,h:1500}]
 const occupied=[{x:6000,y:2000,w:10700,h:5700}]
 assert.deepEqual(fullBalconyRect(source,lower,occupied),{x:16700,y:2000,w:4100,h:5700})
})

test('expansion cannot cross an unsupported hole, occupied room or another outdoor area',()=>{
 const seed={x:0,y:0,w:2000,h:2000}
 const support=[{x:0,y:0,w:6000,h:2000},{x:0,y:2000,w:2000,h:4000}]
 const expanded=fullBalconyRect(seed,support,[{x:4000,y:0,w:2000,h:2000}])
 assert.deepEqual(expanded,{x:0,y:0,w:2000,h:6000})
 const cantilever={x:0,y:0,w:3000,h:3000}
 assert.equal(fullBalconyRect(cantilever,support,[]),cantilever,'A partly unsupported balcony must not silently grow')
})

const brief=defaultBrief();brief.site.plotWidth=25;brief.site.plotDepth=30;brief.style.composition='staggered-wings'
const seed=650523944,base=generate(compile(brief),{seed:41,formVersion:SITE_FORM_VERSION}),plan=varyExterior(base,seed)
const before=generateAlternativeDesign(plan,seed),expanded=expandBalconyArea(plan)

test('the source plan, 3D model and quantities use the enlarged balcony while indoor geometry and exterior recipe stay fixed',()=>{
 assert.notEqual(expanded,plan);assert.ok(validate(expanded).hardChecksPass)
 assert.equal(expandBalconyArea(expanded),expanded,'Expansion is idempotent')
 for(let i=0;i<plan.floors.length;i++){
  assert.deepEqual(expanded.floors[i].rooms.filter(r=>!r.outdoor),plan.floors[i].rooms.filter(r=>!r.outdoor))
  for(const key of ['footprint','openings','walls','columns','beams'])assert.deepEqual(expanded.floors[i][key],plan.floors[i][key])
 }
 const after=generateAlternativeDesign(expanded,seed)
 assert.notEqual(after.buildingModel.planId,before.buildingModel.planId)
 assert.equal(after.buildingModel.compositionId,before.buildingModel.compositionId)
 assert.equal(after.villaDesignDNA.architecturalFamily,before.villaDesignDNA.architecturalFamily)
 assert.equal(after.villaDesignDNA.materialPalette,before.villaDesignDNA.materialPalette)
 assert.equal(after.buildingModel.rooms.find(r=>r.id==='balcony1').area,expanded.floors[1].rooms.find(r=>r.id==='balcony1').area)
 const quantities=calculateQuantities(expanded),original=calculateQuantities(plan)
 assert.ok(quantities.total.items['waterproofing.balconies'].NetArea>original.total.items['waterproofing.balconies'].NetArea)
})

registerHooks({resolve(s,c,next){return s.startsWith('@/')?{url:new URL(`../src/${s.slice(2)}`,import.meta.url).href,shortCircuit:true}:next(s,c)}})
const storage=new Map();globalThis.localStorage={getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)}
globalThis.window={localStorage:globalThis.localStorage}
const {useStudio,parsePinned,serializePinned}=await import('../src/state/studio.ts')
const {useBlender}=await import('../src/state/blender.ts')
const pinned={massing:base.massingType,seed,planSeed:base.planSeed,planFamily:base.planFamily,recipe:base.planRecipe,formVersion:base.formVersion,planner:'baseline'}
function reset(){useStudio.getState().loadSaved(brief,pinned);useStudio.getState().run();useBlender.setState({accepted:{},directionRenders:{},previews:{},job:null,error:null})}

test('an explicit balcony expansion saves its size and exact render across reload without regeneration',async()=>{
 reset();const originalGenerate=useBlender.getState().generate,originalFetch=globalThis.fetch
 useBlender.setState({generate:async(source,seed)=>{
  const id=createBuildingModel(source).planId
  useBlender.setState({accepted:{[id]:{seed,requestedSeed:seed,planId:id,finishSignature:finishSignature(brief),quality:'preview',
   family:'U_SHAPED',files:{glb:'/expanded.glb',blend:'/expanded.blend',hero:'/hero.png',front:'/front.png',aerial:'/aerial.png'},warnings:[]}}})
 }})
 try{
  assert.equal(await useStudio.getState().fillBalconyArea(),true)
  const current=useStudio.getState(),id=current.result.buildingModel.planId
  const saved=parsePinned(serializePinned(current.pinned));assert.equal(saved.balconyExtent,'full-slab')
  globalThis.fetch=async()=>{throw Error('Returning to the expanded balcony must not submit a new render')}
  useStudio.getState().loadSaved(brief,saved);const reloaded=useStudio.getState().run()
  assert.equal(reloaded.buildingModel.planId,id,'Reload must retain the expanded source identity')
  assert.deepEqual(reloaded.design.exteriorIdentity,current.result.design.exteriorIdentity)
  await useBlender.getState().ensureForPlan(reloaded.design,seed)
  assert.equal(useBlender.getState().accepted[id].files.glb,'/expanded.glb')
 }finally{useBlender.setState({generate:originalGenerate});globalThis.fetch=originalFetch}
})

test('a failed expanded render preserves the previous plan and pin',async()=>{
 reset();const previous=useStudio.getState(),original=useBlender.getState().generate
 useBlender.setState({generate:async()=>{useBlender.setState({error:'Render failed'})}})
 try{
  assert.equal(await useStudio.getState().fillBalconyArea(),false)
  assert.equal(useStudio.getState().result,previous.result);assert.equal(useStudio.getState().pinned,previous.pinned)
 }finally{useBlender.setState({generate:original})}
})
