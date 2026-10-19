import test from 'node:test'
import assert from 'node:assert/strict'
import {defaultBrief} from '../src/lib/model/brief.ts'
import {compile} from '../src/lib/model/canonical.ts'
import {generate} from '../src/lib/engine/generate.ts'
import {validate} from '../src/lib/rules/index.ts'
import {placeDoors} from '../src/lib/engine/planner/elements.ts'
import {SITE_FORM_VERSION} from '../src/lib/engine/siteForm.ts'
import {createBuildingModel} from '../src/lib/engine/buildingModel.ts'

const room=(id,rect,outdoor=false)=>({id,semanticId:`FF_${id.toUpperCase()}`,name:id,zone:outdoor?'outdoor':'private',rect,area:rect.w*rect.h/1e6,outdoor,wantsWindow:!outdoor})
test('balcony access is either one hinged door or one real sliding door, with hinged fallback on a narrow wall',()=>{
 for(const [type,width,sliding] of [['hinged',4000,false],['sliding',4000,true],['sliding',1600,false]]){
  const rooms=[room('bed1',{x:0,y:0,w:width,h:4000}),room('balcony1',{x:0,y:4000,w:width,h:1500},true)]
  const result=placeDoors(rooms,'bed1','FF',[],new Map(),()=>'',()=>undefined,null,{x:width/2,y:2000},'closed',type)
  assert.deepEqual(result.failed,[])
  assert.equal(result.openings.length,1)
  const door=result.openings[0]
  assert.equal(door.kind,'door');assert.ok(door.rooms.includes('balcony1'))
  assert.equal(door.treatment==='glazed-slide',sliding)
  assert.equal(door.leaf,!sliding)
  assert.equal(door.width,sliding?1800:900)
 }
})

const b=defaultBrief();b.site.plotWidth=25;b.site.plotDepth=30;b.style.composition='staggered-wings'
const plan=generate(compile(b),{seed:41,formVersion:SITE_FORM_VERSION})
test('generated windows remain protected fixed windows and every balcony has a separate access door',()=>{
 assert.ok(validate(plan).hardChecksPass)
 let balconies=0
 for(const f of plan.floors){
  for(const w of f.openings.filter(o=>o.kind==='window')){
   assert.ok(w.sill>=900);assert.equal(w.treatment,undefined);assert.equal(w.leaf,undefined);assert.equal(w.rooms[1],null)
  }
  for(const r of f.rooms.filter(r=>r.outdoor&&r.id.startsWith('balcony'))){
   balconies++
   const door=f.openings.find(o=>o.kind==='door'&&o.rooms.includes(r.id))
   assert.ok(door);assert.ok(door.width>=900)
  }
 }
 assert.ok(balconies>0)
 assert.equal(createBuildingModel(plan).openingPolicy.minWindowSillMm,900)
})
test('a window cannot replace balcony access, and exterior sliders without a landing are rejected',()=>{
 const changed=structuredClone(plan),f=changed.floors.find(f=>f.rooms.some(r=>r.outdoor&&r.id.startsWith('balcony')))
 const balcony=f.rooms.find(r=>r.outdoor&&r.id.startsWith('balcony'))
 const door=f.openings.find(o=>o.kind==='door'&&o.rooms.includes(balcony.id))
 door.kind='window';delete door.leaf;delete door.treatment;door.sill=900
 let findings=validate(changed).findings
 assert.ok(findings.some(f=>f.code==='BALCONY_ACCESS_MISSING'))
 assert.ok(findings.some(f=>f.code==='WINDOW_IS_NOT_ACCESS'))
 const orphan=structuredClone(plan),window=orphan.floors[1].openings.find(o=>o.kind==='window')
 window.kind='entry';window.leaf=false;window.treatment='glazed-slide';window.sill=0
 findings=validate(orphan).findings
 assert.ok(findings.some(f=>f.code==='SLIDER_WITHOUT_BALCONY'))
})
