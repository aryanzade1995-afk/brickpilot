import test from 'node:test'
import assert from 'node:assert/strict'
import {defaultBrief,briefSchema,geometryBrief} from '../src/lib/model/brief.ts'
import {compile} from '../src/lib/model/canonical.ts'
import {generate} from '../src/lib/engine/generate.ts'
import {validate} from '../src/lib/rules/index.ts'
import {SITE_FORM_VERSION,setbackTerraceArea} from '../src/lib/engine/siteForm.ts'
import {buildingShape} from '../src/lib/engine/buildingShapes.ts'
import {generateAlternativeDesign} from '../src/lib/engine/generateAlternativeDesign.ts'
import {MODERN_COMPOSITIONS} from '../src/lib/model/modernCompositions.ts'
import {createVillaDesignDNA,MODERN_EXTERIOR_PALETTES} from '../src/lib/engine/villaDesignDna.ts'
import {createBuildingModel} from '../src/lib/engine/buildingModel.ts'

const overlap=(a,b)=>Math.min(a.x+a.w,b.x+b.w)>Math.max(a.x,b.x)&&Math.min(a.y+a.h,b.y+b.h)>Math.max(a.y,b.y)
const brief=composition=>{
 const b=defaultBrief();b.site.plotWidth=25;b.site.plotDepth=30;b.style.composition=composition;return b
}
test('old briefs omit the optional composition and preserve their geometry seed input',()=>{
 const b=defaultBrief();assert.equal(Object.hasOwn(b.style,'composition'),false)
 assert.deepEqual(geometryBrief(briefSchema.parse(b)),geometryBrief(b))
 assert.equal(briefSchema.safeParse({...b,style:{...b.style,composition:'random-box'}}).success,false)
})
test('modern compositions use twelve deterministic exterior palettes instead of one forced white finish',()=>{
 const building=createBuildingModel(generate(compile(brief('staggered-wings')),{seed:41,formVersion:SITE_FORM_VERSION}))
 const palettes=new Set()
 for(let seed=0;seed<128;seed++){
  const dna=createVillaDesignDNA(building,seed,'modern-box')
  palettes.add(dna.materialPalette)
  assert.deepEqual(dna,createVillaDesignDNA(building,seed,'modern-box'))
  assert.equal(dna.sourcePlanId,building.planId)
 }
 assert.deepEqual([...palettes].sort(),[...MODERN_EXTERIOR_PALETTES].sort())
})
test('three compositions produce distinct valid occupied shapes, replay exactly and retain requested rooms',()=>{
 const shapes=new Set()
 for(const composition of MODERN_COMPOSITIONS){
  const b=brief(composition),model=compile(b),d=generate(model,{seed:41,formVersion:SITE_FORM_VERSION})
  assert.equal(compile(briefSchema.parse(b)).seed,model.seed,'Saving a composition changed its seed input')
  assert.deepEqual(generate(model,{seed:41}).floors,d.floors,'Brief fit checks must use the same composition planner')
  assert.ok(validate(d).hardChecksPass,composition)
  for(const required of model.floors.flatMap(f=>f.spaces).filter(r=>!r.outdoor))
   assert.ok(d.floors.some(f=>f.rooms.some(r=>r.id===required.id)),`${composition}: missing ${required.id}`)
  shapes.add(buildingShape(d).key)
  const replay=generate(model,{seed:d.planSeed,massing:d.massingType,recipe:d.planRecipe,planner:d.planProposal?'ml':'baseline',formVersion:d.formVersion})
  assert.deepEqual(replay.floors,d.floors,`${composition}: saved recipe moved rooms`)
  const a=generateAlternativeDesign(d,650523944),b2=generateAlternativeDesign(d,650523945)
  assert.equal(a.facadeGrammar.status,'valid');assert.deepEqual(a.buildingModel,b2.buildingModel)
  assert.ok(a.buildingModel.modernComposition.canopies.length>=2)
  const env=a.buildingModel.plot.buildable
  for(const c of a.buildingModel.modernComposition.canopies){
   assert.ok(c.rect.x>=env.x&&c.rect.y>=env.y&&c.rect.x+c.rect.w<=env.x+env.w&&c.rect.y+c.rect.h<=env.y+env.h)
   const f=a.buildingModel.floors.find(f=>f.id===c.floorId)
   assert.ok(!f.courtyard||!overlap(c.rect,f.courtyard))
   assert.ok(a.buildingModel.windows.some(w=>w.id===c.sourceWindowId))
  }
  if(composition==='terraced-villa')assert.ok(setbackTerraceArea(d)>=6)
  if(composition==='glazed-bay')for(const f of d.floors)
   assert.ok(f.openings.some(w=>w.kind==='window'&&w.rooms?.includes('stair')&&(w.head-w.sill)>=1500&&w.sill>=900))
 }
 assert.equal(shapes.size,3,'Compositions must change occupied geometry, not only exterior accessories')
})
test('composition does not allow canopies or occupied rooms to cover the preserved courtyard pool',()=>{
 const b=brief('staggered-wings');b.site.plotWidth=22;b.site.plotDepth=28;b.rooms.pool=true;b.rooms.priorities.courtyard=true
 const d=generate(compile(b),{seed:41,formVersion:SITE_FORM_VERSION})
 assert.ok(validate(d).hardChecksPass)
 assert.equal(d.siteFeatures.find(f=>f.kind==='pool').roomId,'courtyard')
 const a=generateAlternativeDesign(d,650523944)
 for(const c of a.buildingModel.modernComposition.canopies){
  const court=a.buildingModel.floors.find(f=>f.id===c.floorId).courtyard
  assert.ok(!court||!overlap(c.rect,court))
 }
})
