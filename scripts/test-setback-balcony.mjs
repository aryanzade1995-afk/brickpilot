import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {registerHooks} from 'node:module'
import {compile} from '../src/lib/model/canonical.ts'
import {generate} from '../src/lib/engine/generate.ts'
import {withSetbackBalcony} from '../src/lib/engine/setbackBalcony.ts'
import {validate} from '../src/lib/rules/index.ts'
import {characterSchema} from '../src/lib/model/brief.ts'
import {rectsOverlap} from '../src/lib/geometry.ts'
import {generateAlternativeDesign} from '../src/lib/engine/generateAlternativeDesign.ts'
registerHooks({resolve(s,c,next){return s.startsWith('@/')?{url:new URL(`../src/${s.slice(2)}`,import.meta.url).href,shortCircuit:true}:next(s,c)}})
const fixture=JSON.parse(readFileSync(new URL('./fixtures/setback-balcony-brief.json',import.meta.url)))
const plan=generate(compile(fixture.brief),{recipe:fixture.recipe,formVersion:fixture.formVersion})

test('the narrow upper lobby serves the pictured setback through a real sliding door, without a fictitious swing',()=>{
 const f=JSON.parse(readFileSync(new URL('./fixtures/narrow-lobby-setback-brief.json',import.meta.url)))
 const source=generate(compile(f.brief),f),changed=withSetbackBalcony(source)
 assert.notEqual(changed,source);assert.ok(validate(changed).hardChecksPass)
 const balcony=changed.floors[1].rooms.find(r=>r.id==='balconySetback')
 assert.deepEqual(balcony.rect,{x:7200,y:7200,w:2400,h:3000})
 const architecture=generateAlternativeDesign(changed,1955)
 const door=architecture.buildingModel.doors.find(d=>d.rooms?.includes(balcony.id))
 assert.ok(door);assert.equal(door.leaf,false)
 assert.ok(architecture.balconySliders.some(s=>s.sourceId===door.id&&s.clearWidthMm>=850),'Blender must receive the real slider, not an open portal')
})
test('the full usable L-shaped setback is occupied while keeping the service shaft clear',()=>{
 const f=JSON.parse(readFileSync(new URL('./fixtures/setback-balcony-wrap-brief.json',import.meta.url)))
 const p=generate(compile(f.brief),{recipe:f.recipe,formVersion:f.formVersion})
 const changed=withSetbackBalcony(p)
 const balconies=changed.floors[1].rooms.filter(r=>r.id.startsWith('balconySetback'))
 assert.equal(balconies.length,2)
 const reserved=(p.floors[0].shafts??[]).map(s=>s.rect)
 // Shaft reservation also leaves a narrow return below the 1.2 m usable
 // depth. It remains service space, rather than an inaccessible balcony.
 assert.equal(balconies.reduce((area,r)=>area+r.rect.w*r.rect.h,0),12570000)
 assert.ok(balconies.every(r=>reserved.every(s=>!rectsOverlap(r.rect,s))))
 assert.ok(validate(changed).hardChecksPass)
})
test('a supported setback becomes a reachable balcony without changing enclosed geometry',()=>{
 const before=JSON.stringify(plan),changed=withSetbackBalcony(plan)
 assert.notEqual(changed,plan);assert.ok(validate(changed).hardChecksPass)
 for(let i=0;i<plan.floors.length;i++){
  assert.deepEqual(changed.floors[i].footprint,plan.floors[i].footprint)
  assert.deepEqual(changed.floors[i].rooms.filter(r=>!r.outdoor),plan.floors[i].rooms.filter(r=>!r.outdoor))
 }
 const floor=changed.floors.find(f=>f.rooms.some(r=>r.id==='balconySetback'))
 assert.ok(floor.openings.some(o=>o.kind==='door'&&o.rooms?.includes('balconySetback')&&o.width>=900))
 assert.ok(floor.openings.filter(o=>o.rooms?.includes('balconySetback')&&o.kind==='door').every(o=>o.treatment==='glazed-slide'&&o.leaf===false),'a sliding balcony door must not reserve a hinged swing in its host room')
 assert.equal(JSON.stringify(plan),before)
 assert.equal(withSetbackBalcony(changed),changed)
 assert.deepEqual(changed.openingCounts,{doors:changed.floors.flatMap(f=>f.openings).filter(o=>o.kind!=='window').length,windows:changed.floors.flatMap(f=>f.openings).filter(o=>o.kind==='window').length})
})

test('conversion is available for every house style without a style-specific opt-in',()=>{
 for(const character of characterSchema.options){
  const source=structuredClone(plan);source.model.brief.style.character=character
  const changed=withSetbackBalcony(source)
  assert.notEqual(changed,source,character)
  assert.ok(validate(changed).hardChecksPass,character)
  assert.equal(withSetbackBalcony(changed),changed)
 }
})

test('saved homes automatically restore usable balconies without the old pin flag',async()=>{
 const storage=new Map();globalThis.localStorage={getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)};globalThis.window={localStorage}
 const {useStudio}=await import('../src/state/studio.ts')
 for(const character of ['modern-box','contemporary-indian','coastal-bungalow','tropical-beach-villa']){
  const brief=structuredClone(fixture.brief);brief.style.character=character
  useStudio.getState().loadSaved(brief,{massing:plan.massingType,seed:978,planSeed:plan.planSeed,recipe:plan.planRecipe,formVersion:plan.formVersion,planner:'baseline'})
  const restored=useStudio.getState().run()
  assert.ok(restored.report.hardChecksPass,character)
  assert.ok(restored.design.floors.some(f=>f.rooms.some(r=>r.id.startsWith('balconySetback'))),character)
  assert.equal(withSetbackBalcony(restored.design),restored.design)
 }
})
test('balcony conversion survives saved pin restoration',async()=>{
 const storage=new Map();globalThis.localStorage={getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)};globalThis.window={localStorage}
 const {useStudio,parsePinned,serializePinned}=await import('../src/state/studio.ts')
 const pin={massing:plan.massingType,seed:978,planSeed:plan.planSeed,recipe:plan.planRecipe,formVersion:plan.formVersion,planner:'baseline',setbackBalcony:true}
 useStudio.getState().loadSaved(fixture.brief,parsePinned(serializePinned(pin)))
 const restored=useStudio.getState().run()
 assert.ok(restored.report.hardChecksPass)
 assert.ok(restored.design.floors.some(f=>f.rooms.some(r=>r.id==='balconySetback')))
 assert.deepEqual(restored.design.floors,withSetbackBalcony(plan).floors)
})
