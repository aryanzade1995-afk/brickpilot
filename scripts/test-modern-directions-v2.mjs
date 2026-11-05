import test from 'node:test'
import assert from 'node:assert/strict'
import {defaultBrief,briefSchema} from '../src/lib/model/brief.ts'
import {compile} from '../src/lib/model/canonical.ts'
import {generate,distinctDirectionPlans} from '../src/lib/engine/generate.ts'
import {SITE_FORM_VERSION,setbackTerraceArea} from '../src/lib/engine/siteForm.ts'
import {MODERN_DIRECTION_COMPOSITIONS} from '../src/lib/model/modernCompositions.ts'
import {buildingShape,buildingShapeDifference} from '../src/lib/engine/buildingShapes.ts'
import {planFindings} from '../src/lib/engine/planner/validate.ts'
import {generateAlternativeDesign} from '../src/lib/engine/generateAlternativeDesign.ts'
import {validate} from '../src/lib/rules/index.ts'
import {uncoveredRects} from '../src/lib/engine/planner/projections.ts'

const brief=()=>{const b=defaultBrief();b.site.plotWidth=25;b.site.plotDepth=30;return b}
test('four modern directions have real distinct plans, valid 3D, fixed cores and exact saved replay',()=>{
 const original=brief(),plans=distinctDirectionPlans(compile(original),4,SITE_FORM_VERSION)
 assert.equal(original.style.composition,undefined)
 assert.deepEqual(plans.map(p=>p.plan.model.brief.style.composition),[...MODERN_DIRECTION_COMPOSITIONS])
 for(const {plan:d} of plans){
  assert.ok(validate(d).hardChecksPass)
  assert.deepEqual(planFindings(d),[])
  for(const required of d.model.floors.flatMap(f=>f.spaces).filter(r=>!r.outdoor))assert.ok(d.floors.some(f=>f.rooms.some(r=>r.id===required.id)))
  const saved=briefSchema.parse(JSON.parse(JSON.stringify(d.model.brief)))
  const replay=generate(compile(saved),{seed:d.planSeed,massing:d.massingType,recipe:d.planRecipe,planner:d.planProposal?'ml':'baseline',formVersion:d.formVersion})
  assert.deepEqual(replay.floors,d.floors)
  const model=generateAlternativeDesign(d,41)
  assert.equal(model.facadeGrammar.status,'valid')
  assert.deepEqual(model.buildingModel.floors.map(f=>f.footprint),generateAlternativeDesign(replay,41).buildingModel.floors.map(f=>f.footprint))
  if(d.model.brief.style.composition==='offset-box'){
   assert.ok(d.floors.some((f,i)=>i>0&&uncoveredRects(f.footprint,d.floors[i-1].footprint).length))
   const broken=structuredClone(d);broken.floors.forEach(f=>f.supportZones=f.supportZones?.filter(z=>!z.review))
   assert.ok(planFindings(broken).some(f=>f.code==='UPPER_FLOOR_UNSUPPORTED'))
  }
  if(d.model.brief.style.composition==='framed-balcony')assert.ok(model.buildingModel.modernComposition.canopies.some(c=>c.framePosts?.length===2))
  if(d.model.brief.style.composition==='stepped-terrace')assert.ok(setbackTerraceArea(d)>=6)
 }
 for(let i=0;i<plans.length;i++)for(let j=0;j<i;j++)assert.ok(buildingShapeDifference(buildingShape(plans[i].plan),buildingShape(plans[j].plan))>=.08)
})
test('constrained sites never gain invented dimensions or duplicate labelled options',()=>{
 for(const size of [[8,10],[12,16],[18,24]]){
  const b=brief();[b.site.plotWidth,b.site.plotDepth]=size
  const plans=distinctDirectionPlans(compile(b),4,SITE_FORM_VERSION)
  for(const p of plans){assert.ok(validate(p.plan).hardChecksPass);assert.equal(p.plan.model.brief.site.plotWidth,size[0]);assert.equal(p.plan.model.brief.site.plotDepth,size[1])}
  assert.equal(new Set(plans.map(p=>buildingShape(p.plan).key)).size,plans.length)
 }
})
test('three occupied floors keep a continuous stair core and valid exported massing',()=>{
 const b=brief();b.levels.storeys=2
 const plans=distinctDirectionPlans(compile(b),4,SITE_FORM_VERSION)
 assert.equal(plans.length,4)
 for(const {plan} of plans){
  assert.equal(plan.floors.length,3)
  const core=plan.floors[0].rooms.find(r=>r.id==='stair').rect
  for(const floor of plan.floors)assert.deepEqual(floor.rooms.find(r=>r.id==='stair').rect,core)
  assert.equal(generateAlternativeDesign(plan,41).facadeGrammar.status,'valid')
 }
})
