import test from 'node:test'
import assert from 'node:assert/strict'
import {registerHooks} from 'node:module'
import {defaultBrief,geometryBrief,parseStoredBrief} from '../src/lib/model/brief.ts'
import {facadeDesignSchema,FACADE_DESIGNS,automaticFacadeDesign} from '../src/lib/model/facadeDesign.ts'
import {compile} from '../src/lib/model/canonical.ts'
import {generate} from '../src/lib/engine/generate.ts'
import {validate} from '../src/lib/rules/index.ts'
import {createBuildingModel} from '../src/lib/engine/buildingModel.ts'
import {buildFacadeZones} from '../src/lib/engine/facade/FacadeGrammar.ts'
import {generateFacadeVariation,facadeOpeningKeepouts} from '../src/lib/engine/facade/variations.ts'
import {generateAlternativeDesign} from '../src/lib/engine/generateAlternativeDesign.ts'
import {buildFacadeDesignGroup,facadePartGeometry} from '../src/lib/three/facadeDesign.ts'
import {prepareVillaScene} from '../src/lib/three/prepareVillaScene.ts'
import * as THREE from 'three'
registerHooks({resolve(s,c,next){return s.startsWith('@/')?{url:new URL(`../src/${s.slice(2)}`,import.meta.url).href,shortCircuit:true}:next(s,c)}})
const cases=[[25,30,0,'S'],[18,24,1,'S'],[22,28,2,'E'],[12,30,1,'S'],[30,22,1,'W'],[22,28,1,'N']]
const fixtures=cases.map(([w,d,storeys,side])=>{
 const brief=defaultBrief();brief.site.plotWidth=w;brief.site.plotDepth=d;brief.levels.storeys=storeys
 brief.site.facing=side;brief.site.roadEdges=[side];brief.entry.primarySide=side;brief.lifestyle.vastu='ignore'
 const plan=generate(compile(brief),{seed:41,massing:'stepped'})
 assert.ok(validate(plan).hardChecksPass,JSON.stringify([w,d,storeys,validate(plan).findings]))
 const building=createBuildingModel(plan),zones=buildFacadeZones(building,{masses:[]})
 return {brief,plan,building,zones}
})
const config=id=>({version:1,facadeStyle:id,facadeSeed:77085,facadeVariation:.75,materialPalette:'selected'})
const overlaps=(a,b)=>Math.min(a.x+a.w,b.x+b.w)>Math.max(a.x,b.x)+1&&Math.min(a.y+a.d,b.y+b.d)>Math.max(a.y,b.y)+1&&Math.min(a.z+a.h,b.z+b.h)>Math.max(a.z,b.z)+1
const geometry=m=>JSON.stringify(m.parts.map(({id,material,...part})=>part))

test('automatic mixes combine five or six actual recipes, preserve clearances and reproduce after reload',()=>{
 const timings=[],combinations=new Set()
 for(const f of fixtures){
  const before=JSON.stringify(f),keepouts=facadeOpeningKeepouts(f.building)
  for(const seed of [41,77085,77086,902104]){
   const settings=automaticFacadeDesign(seed),start=performance.now()
   const m=generateFacadeVariation(f.building,f.zones,settings,f.brief)
   timings.push(performance.now()-start)
   assert.ok(m.styles.length>=5&&m.styles.length<=6,`${seed}: ${JSON.stringify(m.styles)}`)
   assert.deepEqual([...new Set(m.parts.map(p=>p.sourceStyle))].sort(),[...m.styles].sort())
   assert.ok(m.parts.length<=320)
   const owners=new Map()
   for(const p of m.parts){
    if(owners.has(p.zoneId))assert.equal(owners.get(p.zoneId),p.sourceStyle,'one design per wall bay')
    owners.set(p.zoneId,p.sourceStyle)
    assert.ok(!keepouts.some(k=>overlaps(p.bounds,k)),'mixed facade blocks an opening')
    const env=f.building.plot.buildable
    assert.ok(p.bounds.x>=env.x&&p.bounds.y>=env.y&&p.bounds.x+p.bounds.w<=env.x+env.w&&p.bounds.y+p.bounds.d<=env.y+env.h)
   }
   const restored=parseStoredBrief(JSON.parse(JSON.stringify({...f.brief,facadeDesign:settings})))
   assert.ok(restored.success)
   assert.deepEqual(m,generateFacadeVariation(f.building,f.zones,restored.data.facadeDesign,restored.data))
   combinations.add(m.styles.join(','))
  }
  assert.equal(JSON.stringify(f),before,'mixing must not mutate the source house')
 }
 assert.ok(combinations.size>10,'seeds vary design combinations')
 console.log('Mixed facade generation ms p95',timings.sort((a,b)=>a-b)[Math.floor(timings.length*.95)].toFixed(1))
})

test('new exports mix automatically, with matching preview and legacy settings preserved on migration',()=>{
 const f=fixtures[1],exported=generateAlternativeDesign(f.plan,41)
 assert.equal(exported.facadeDesign.configuration.facadeStyle,'MIXED')
 const live=generateFacadeVariation(exported.buildingModel,buildFacadeZones(exported.buildingModel,{masses:[]}),automaticFacadeDesign(41),f.brief,exported.facadeGrammar.coveredOutdoor)
 assert.equal(exported.facadeDesign.signature,live.signature)
 assert.deepEqual(exported.buildingModel,createBuildingModel(f.plan))
 const legacy={...config('D04'),materialPalette:'stone-metal'},migrated=automaticFacadeDesign(123,legacy)
 assert.deepEqual(migrated,{...legacy,facadeStyle:'MIXED'})
 const m=structuredClone(live);Object.values(m.materials).forEach(v=>delete v.texture)
 const group=buildFacadeDesignGroup(m);assert.ok(group.root.children.length<=6);group.dispose()
})
test('ten distinct seeded designs adapt to one, two, three floors, narrow and wide plots and entrances',()=>{
 const timings=[]
 for(const f of fixtures){
  const before=JSON.stringify(f),forms=new Set(),keepouts=facadeOpeningKeepouts(f.building)
  for(const [id] of FACADE_DESIGNS){
   const start=performance.now(),m=generateFacadeVariation(f.building,f.zones,config(id),f.brief);timings.push(performance.now()-start)
   assert.ok(m.parts.length>0,`${JSON.stringify(cases[fixtures.indexOf(f)])} ${id}: ${m.notes}`)
   assert.ok(m.parts.length<=320)
   assert.deepEqual(m,generateFacadeVariation(f.building,f.zones,config(id),f.brief))
   const different=generateFacadeVariation(f.building,f.zones,{...config(id),facadeSeed:77086},f.brief)
   assert.notEqual(geometry(m),geometry(different),`${id} seeds must change geometry`)
   forms.add(geometry(m))
   for(const p of m.parts){
    assert.ok(!keepouts.some(k=>overlaps(p.bounds,k)),`${id} blocks an opening`)
    assert.ok(f.zones.some(z=>z.id===p.zoneId&&z.wallId))
    const env=f.building.plot.buildable;assert.ok(p.bounds.x>=env.x&&p.bounds.y>=env.y&&p.bounds.x+p.bounds.w<=env.x+env.w&&p.bounds.y+p.bounds.d<=env.y+env.h)
    const g=facadePartGeometry(p);g.computeBoundingBox();const box=g.boundingBox
    assert.ok(Math.abs(box.min.x-p.bounds.x/1000)<.001&&Math.abs(box.max.y-(p.bounds.z+p.bounds.h)/1000)<.001);g.dispose()
   }
  }
  assert.equal(forms.size,10,'Recipes must have different geometry, not only palette labels')
  assert.equal(JSON.stringify(f),before)
 }
 console.log('Facade preview generation ms p95',timings.sort((a,b)=>a-b)[Math.floor(timings.length*.95)].toFixed(1))
})
test('settings validate, persist, and never change canonical plan identity',()=>{
 const b=fixtures[1].brief,changed={...b,facadeDesign:config('D04')}
 assert.deepEqual(geometryBrief(b),geometryBrief(changed));assert.equal(compile(b).seed,compile(changed).seed)
 assert.deepEqual(parseStoredBrief(JSON.parse(JSON.stringify(changed))).data.facadeDesign,config('D04'))
 const recovered=parseStoredBrief({...b,facadeDesign:{...config('D04'),facadeSeed:-1}})
 assert.ok(recovered.success);assert.equal(recovered.data.site.plotWidth,b.site.plotWidth);assert.equal(recovered.data.facadeDesign,undefined)
 for(const invalid of [{facadeStyle:'D11'},{facadeSeed:-1},{facadeSeed:Infinity},{facadeVariation:2}])assert.equal(facadeDesignSchema.safeParse({...config('D01'),...invalid}).success,false)
})
test('carport styling only decorates the existing checked roof without adding spans or pillars',()=>{
 const f=fixtures[1],exported=generateAlternativeDesign(f.plan,41)
 const m=generateFacadeVariation(exported.buildingModel,exported.facadeGrammar.zones,config('D09'),f.brief,exported.facadeGrammar.coveredOutdoor)
 assert.ok(m.parts.some(p=>p.zoneId.startsWith('carport:')))
 assert.ok(m.parts.filter(p=>p.zoneId.startsWith('carport:')).every(p=>p.h===100&&p.depth===45))
 assert.deepEqual(exported.buildingModel,createBuildingModel(f.plan))
})
test('export adapter keeps the existing plan and carries matching live facade geometry',()=>{
 const f=fixtures[1],plan=structuredClone(f.plan);plan.model.brief.facadeDesign=config('D07')
 const exported=generateAlternativeDesign(plan,41)
 const live=generateFacadeVariation(exported.buildingModel,buildFacadeZones(exported.buildingModel,{masses:[]}),config('D07'),plan.model.brief)
 assert.equal(exported.facadeDesign.signature,live.signature)
 assert.deepEqual(exported.buildingModel,createBuildingModel(f.plan))
})
test('switching facade layers batches geometry and disposes owned buffers without damaging the source',()=>{
 const f=fixtures[1],m=generateFacadeVariation(f.building,f.zones,config('D10'),f.brief)
 // No asset network is needed for this ownership test.
 Object.values(m.materials).forEach(v=>delete v.texture)
 const group=buildFacadeDesignGroup(m),meshes=group.root.children.length
 assert.ok(meshes<=6)
 let disposed=0;group.root.traverse(o=>{if(o.isMesh){o.geometry.addEventListener('dispose',()=>disposed++);o.material.addEventListener('dispose',()=>disposed++)}})
 group.dispose();assert.equal(disposed,meshes*2)
 const source=new THREE.Group(),original=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial());original.name='Hero_CFrame';source.add(original)
 const legacy=prepareVillaScene(source,1),styled=prepareVillaScene(source,1,false,false,false,true)
 assert.ok(legacy.children.length>0);assert.equal(styled.children.length,0);assert.equal(source.children.length,1)
})
test('changing facade settings preserves the saved selected house and room edits',async()=>{
 const memory=new Map();globalThis.localStorage={getItem:k=>memory.get(k)??null,setItem:(k,v)=>memory.set(k,v),removeItem:k=>memory.delete(k)};globalThis.window={localStorage}
 const {useStudio}=await import('../src/state/studio.ts')
 const f=fixtures[1],pin={massing:f.plan.massingType,seed:41,planSeed:f.plan.planSeed,recipe:f.plan.planRecipe,formVersion:f.plan.formVersion,planner:'baseline'}
 useStudio.getState().loadSaved(f.brief,pin);const before=useStudio.getState().run(),floors=JSON.stringify(before.design.floors)
 useStudio.getState().setFacadeDesign(config('D05'))
 assert.equal(useStudio.getState().result,before);assert.equal(JSON.stringify(before.design.floors),floors)
 const saved=JSON.parse(JSON.stringify(useStudio.getState().brief));useStudio.getState().loadSaved(saved,pin)
 assert.equal(JSON.stringify(useStudio.getState().run().design.floors),floors);assert.equal(useStudio.getState().brief.facadeDesign.facadeStyle,'D05')
})
