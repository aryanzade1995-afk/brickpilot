import assert from 'node:assert/strict'
import test from 'node:test'
import {briefSchema,defaultBrief} from '../src/lib/model/brief.ts'
import {compile} from '../src/lib/model/canonical.ts'
import {generate} from '../src/lib/engine/generate.ts'
import {validate} from '../src/lib/rules/index.ts'
test('saved briefs default optional programme growth on; villa geometry and seeds ignore that switch',()=>{
 const b=defaultBrief(),legacy=structuredClone(b);delete legacy.project.autoExtras
 assert.equal(briefSchema.parse(legacy).project.autoExtras,true)
 const first=generate(compile(b),{seed:41}),off=structuredClone(b);off.project.autoExtras=false
 const second=generate(compile(off),{seed:41}),old=generate(compile(legacy),{seed:41})
 assert.deepEqual(first.floors,second.floors);assert.deepEqual(first.floors,old.floors)
 assert.equal(first.id,second.id);assert.equal(first.id,old.id)
})
test('large plots add real finite room requirements in order; opt-out preserves the requested programme',()=>{
 for(const staff of ['none','daily','liveIn']){
  const b=defaultBrief();b.project.buildingType='large-villa';b.site.plotWidth=40;b.site.plotDepth=60;b.household.staff=staff
  const grown=compile(b),off=structuredClone(b);off.project.autoExtras=false
  const requested=compile(off),added=grown.floors.flatMap(f=>f.spaces).filter(s=>s.autoExtra)
  assert.ok(added.length>=6)
  assert.equal(added[0].name,'Second family lounge')
  assert.ok(added.some(s=>s.role==='guest'))
  assert.ok(added.some(s=>s.name==='Gym'))
  assert.ok(added.some(s=>s.id==='poolHouse'))
  assert.ok(added.every(s=>s.min>0 && s.target>=s.min && s.max>=s.target))
  assert.equal(new Set(added.map(s=>s.id)).size,added.length)
  assert.ok(!requested.floors.flatMap(f=>f.spaces).some(s=>s.autoExtra))
  for(const f of requested.floors)for(const s of f.spaces.filter(s=>!s.outdoor))
   assert.deepEqual(grown.floors[f.level].spaces.find(x=>x.id===s.id),s)
 }
})
test('grown programme generates checked rooms within 1.5 times their maxima on large twin wings',()=>{
 for(const [w,h] of [[30,40],[40,60]]){
  const b=defaultBrief();b.project.buildingType='large-villa';b.site.plotWidth=w;b.site.plotDepth=h
  const model=compile(b),plan=generate(model,{massing:'twin-wing',seed:41})
  assert.equal(plan.massingType,'twin-wing')
  const report=validate(plan);assert.ok(report.hardChecksPass,JSON.stringify(report.findings.filter(f=>f.severity==='error')))
  assert.ok(validate(generate(model,{seed:41})).hardChecksPass)
  for(const floor of plan.floors)for(const req of model.floors[floor.level].spaces.filter(s=>!s.outdoor&&s.zone!=='circulation')){
   const room=floor.rooms.find(r=>r.id===req.id)
   assert.ok(room.area>=req.min-.05,req.id)
   assert.ok(room.area<=req.max*1.5+.05,`${req.id}: ${room.area} > ${req.max*1.5}`)
  }
 }
})
