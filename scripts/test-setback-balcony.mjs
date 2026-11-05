import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {registerHooks} from 'node:module'
import {compile} from '../src/lib/model/canonical.ts'
import {generate} from '../src/lib/engine/generate.ts'
import {withSetbackBalcony} from '../src/lib/engine/setbackBalcony.ts'
import {validate} from '../src/lib/rules/index.ts'
registerHooks({resolve(s,c,next){return s.startsWith('@/')?{url:new URL(`../src/${s.slice(2)}`,import.meta.url).href,shortCircuit:true}:next(s,c)}})
const fixture=JSON.parse(readFileSync(new URL('./fixtures/setback-balcony-brief.json',import.meta.url)))
const plan=generate(compile(fixture.brief),{recipe:fixture.recipe,formVersion:fixture.formVersion})
test('the full L-shaped setback is occupied without leaving its connected return unused',()=>{
 const f=JSON.parse(readFileSync(new URL('./fixtures/setback-balcony-wrap-brief.json',import.meta.url)))
 const p=generate(compile(f.brief),{recipe:f.recipe,formVersion:f.formVersion})
 const changed=withSetbackBalcony(p)
 const balconies=changed.floors[1].rooms.filter(r=>r.id.startsWith('balconySetback'))
 assert.equal(balconies.length,2)
 assert.equal(balconies.reduce((area,r)=>area+r.rect.w*r.rect.h,0),14010000)
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
 assert.equal(JSON.stringify(plan),before)
 assert.equal(withSetbackBalcony(changed),changed)
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
