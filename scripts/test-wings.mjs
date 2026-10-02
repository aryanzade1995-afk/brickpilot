import assert from 'node:assert/strict'
import test from 'node:test'
import {defaultBrief} from '../src/lib/model/brief.ts'
import {compile} from '../src/lib/model/canonical.ts'
import {generate} from '../src/lib/engine/generate.ts'
import {validate} from '../src/lib/rules/index.ts'
import {reachability} from '../src/lib/engine/planner/index.ts'
import {sharedEdge,rectUnionBBox,rectUnionArea} from '../src/lib/geometry.ts'
import {generateAlternativeDesign} from '../src/lib/engine/generateAlternativeDesign.ts'
export function wingBrief(w,h,storeys=1){
 const b=defaultBrief();b.site.plotWidth=w;b.site.plotDepth=h;b.levels.storeys=storeys
 b.project.buildingType='large-villa';b.rooms.bedroomsWithBath=2;b.rooms.bedroomsNoBath=0
 return b
}
test('twin-wing plans reuse rooms and validated connected circulation, stack stairs and replay deterministically',()=>{
 for(const [w,h] of [[18,24],[24,30],[30,40],[40,60]])for(const storeys of [1,2]){
  const model=compile(wingBrief(w,h,storeys)),plan=generate(model,{massing:'twin-wing',seed:41})
  assert.equal(plan.massingType,'twin-wing',`${w}x${h}, ${storeys}`)
  const report=validate(plan);assert.ok(report.hardChecksPass,JSON.stringify(report.findings.filter(f=>f.severity==='error')))
  assert.deepEqual(generate(model,{massing:'twin-wing',seed:41}),plan)
  assert.deepEqual(generate(model,{massing:'twin-wing',seed:plan.dna.seed}),plan)
  for(const floor of plan.floors){
   assert.deepEqual(reachability(floor.rooms,floor.openings,floor.level),[])
   const link=floor.rooms.find(r=>r.id==='link'),spines=floor.rooms.filter(r=>r.id==='privateHall'||r.id==='corridor'||r.id.startsWith('lobby'))
   assert.equal(spines.length,2)
   for(const spine of spines){
    assert.ok(sharedEdge(link.rect,spine.rect).length>=1200)
    assert.ok(floor.openings.some(o=>o.rooms?.includes(link.id)&&o.rooms.includes(spine.id)))
   }
   assert.ok(floor.beams.every(b=>b.span<=6000))
  }
 }
})
test('large twin wings spread across the plot while keeping roofed coverage under sixty percent',()=>{
 for(const [w,h] of [[30,40],[40,60]]){
  const model=compile(wingBrief(w,h)),plan=generate(model,{massing:'twin-wing',seed:41})
  const bar=generate(model,{massing:'rectangular',seed:41})
  const box=rectUnionBBox(plan.floors[0].footprint)
  assert.ok(box.w*box.h/(model.envelope.width*model.envelope.depth)>=.85)
  const roofed=rectUnionArea([...plan.floors[0].footprint,...plan.floors[0].rooms.filter(r=>r.outdoor&&r.id!=='courtyard').map(r=>r.rect)])
  assert.ok(roofed/(model.plot.width*model.plot.depth)<=.6)
  assert.ok(plan.builtAreaSqm>bar.builtAreaSqm)
 }
})
test('twin-wing roof edges have unique facade anchors and enter the production Blender pipeline',()=>{
 const plan=generate(compile(wingBrief(30,40)),{massing:'twin-wing',seed:41})
 const payload=generateAlternativeDesign(plan,41)
 assert.equal(payload.facadeGrammar.status,'valid')
 assert.equal(new Set(payload.facadeGrammar.zones.map(z=>z.id)).size,payload.facadeGrammar.zones.length)
})

test('U wings, courtyard rings and pavilions retain their requested family with validated multi-floor access',()=>{
 for(const family of ['u-wing','courtyard-ring','pavilion'])for(const [w,h] of [[24,30],[30,40],[40,60]])for(const storeys of [1,2]){
  const model=compile(wingBrief(w,h,storeys)),plan=generate(model,{massing:family,seed:41})
  assert.equal(plan.massingType,family,`${w}x${h} ${storeys} ${family}`)
  const report=validate(plan);assert.ok(report.hardChecksPass,JSON.stringify(report.findings.filter(f=>f.severity==='error')))
  assert.deepEqual(generate(model,{massing:family,seed:plan.dna.seed}),plan)
  for(const floor of plan.floors){
   assert.deepEqual(reachability(floor.rooms,floor.openings,floor.level),[])
   if(floor.level===0)assert.ok(floor.rooms.some(r=>r.zone!=='circulation'&&!r.outdoor&&r.rect.x===floor.outline.x),'occupied ground side wing')
   assert.ok(floor.beams.every(b=>b.span<=6000))
   const link=floor.rooms.find(r=>r.id==='link')
   assert.ok(floor.openings.filter(o=>o.rooms?.includes(link.id)).length>=2)
   if(family==='courtyard-ring')assert.ok(floor.openings.filter(o=>o.rooms?.includes('rightLink')).length>=2)
  }
  if(w>=30){
   const box=rectUnionBBox(plan.floors[0].footprint)
   assert.ok(box.w*box.h/(model.envelope.width*model.envelope.depth)>=.85)
   assert.ok(plan.coveredFootprintSqm/(w*h)<=.6)
   assert.ok(plan.builtAreaSqm>generate(model,{massing:'rectangular',seed:41}).builtAreaSqm)
  }
 }
})

test('all new wing families produce valid production Blender handoffs with unique roof zones',()=>{
 for(const massing of ['u-wing','courtyard-ring','pavilion']){
  const payload=generateAlternativeDesign(generate(compile(wingBrief(30,40)),{massing,seed:41}),41)
  assert.equal(payload.facadeGrammar.status,'valid')
  assert.equal(new Set(payload.facadeGrammar.zones.map(z=>z.id)).size,payload.facadeGrammar.zones.length)
 }
})
