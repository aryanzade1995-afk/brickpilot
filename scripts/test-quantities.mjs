import test from 'node:test'
import assert from 'node:assert/strict'
import {defaultBrief} from '../src/lib/model/brief.ts'
import {compile} from '../src/lib/model/canonical.ts'
import {generate} from '../src/lib/engine/generate.ts'
import {measureDesign,calculateQuantities,stairSlabOpening} from '../src/lib/cost/quantities.ts'
import {sizeStructure,columnSizeMm,beamDepthMm,slabThicknessMm} from '../src/lib/engine/structuralSizing.ts'
import {quantityRulesSchema,quantityRules} from '../src/lib/cost/data/quantityRules.ts'
const source=generate(compile(defaultBrief()))
export function simpleQuantityPlan(){
 const d=structuredClone(source),f=d.floors[0],r={x:3000,y:3000,w:4000,h:4000}
 d.model.brief.levels.storeys=1;d.model.brief.levels.floorToFloor=3.2
 d.model.brief.specs.overrides={'soil-type':'firm','plinth-height':'standard','concrete-grade':'m20','masonry-type':'brick'}
 d.siteFeatures=[];d.model.brief.rooms.priorities.compoundWall=false
 const points=[{x:3000,y:3000},{x:7000,y:3000},{x:7000,y:7000},{x:3000,y:7000}]
 d.floors=[{...f,level:0,name:'Ground',outline:r,footprint:[r],courtyard:null,doubleHeightVoids:[],shafts:[],stair:undefined,structuralSizing:undefined,
  columns:points.map((at,i)=>({id:`C${i}`,at,size:300,grid:String(i)})),
  beams:points.map((a,i)=>({id:`B${i}`,a,b:points[(i+1)%4],span:4000})),
  rooms:[{id:'bed',semanticId:'GF_BED',name:'Bedroom',zone:'private',rect:r,outdoor:false,wantsWindow:true,area:16}],
  walls:[{id:'W1',a:points[0],b:points[1],thickness:230,heightMm:3000,kind:'exterior'}],
  openings:[{id:'D1',kind:'door',at:{x:4000,y:3000},orient:'h',width:900,head:2100,rooms:['bed',null]},
    {id:'W01',kind:'window',at:{x:6000,y:3000},orient:'h',width:1000,sill:900,head:2100,rooms:['bed',null]}]}]
 return d
}
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} ≠ ${b}`)
test('hand take-off: 4m square, four corner columns, four beams, one wall and two apertures',()=>{
 const d=simpleQuantityPlan(),before=JSON.stringify(d),q=calculateQuantities(d),i=q.total.items
 close(i['concrete.footings'].NetVolume,2.016)
 close(i['concrete.columns'].NetVolume,.8993) // 4 × .23² × (3.075 + 1.175)
 close(i['concrete.beams'].NetVolume,.78039) // 4 × 3.77 clear span × .23 × (.35-.125)
 close(i['concrete.plinthBeams'].NetVolume,1.04052)
 close(i['concrete.slabs'].NetVolume,4) // ground plate + roof, each 16 × .125
 close(i['concrete.lintels'].NetVolume,.08625)
 close(i['concrete.chajjas'].NetVolume,.078)
 close(i['masonry.230'].NetVolume,1.674285)
 close(i['plaster.walls'].NetSideArea,17.82)
 close(i['flooring'].NetArea,16);close(i['skirting'].Length,15.1)
 close(i['doors.900x2100'].NetArea,1.89);close(i['windows.1000x1200'].NetArea,1.2)
 close(i['glazing'].NetArea,1.02);assert.equal(i['electrical.points'].Count,6)
 close(q.total.steelKg.footings,2.016*75)
 close(q.total.formworkM2.footings,4*4.8*.35)
 close(i['earthwork.excavation'].NetVolume,4*1.5*1.5*1.3)
 close(i['earthwork.pcc'].NetVolume,4*1.4*1.4*.1)
 const concrete=8.90046,dry=concrete*1.54
 close(q.concreteMaterials.cementBags,dry/5.5*1440/50)
 close(q.concreteMaterials.sandM3,dry*1.5/5.5);close(q.concreteMaterials.aggregateM3,dry*3/5.5)
 assert.equal(JSON.stringify(d),before);assert.deepEqual(q.total.items,q.perFloor[0].items)
 assert.ok(q.assumptions.includes(quantityRules.qualification))
})
test('slab unions deduct stair/shaft voids once, including overlapping holes',()=>{
 const d=simpleQuantityPlan(),f=d.floors[0]
 f.shafts=[{id:'shaft',rect:{x:4000,y:4000,w:1000,h:1000}}]
 let q=calculateQuantities(d);close(q.total.items['concrete.slabs'].NetVolume,3.75)
 const s=source.floors[0].stair,opening=stairSlabOpening(s)
 assert.ok(opening.w*opening.h<s.rect.w*s.rect.h)
 const two=structuredClone(source),old=calculateQuantities(two)
 const bed=two.floors[1].rooms.find(r=>!r.outdoor&&/bed/i.test(r.name)).rect
 two.floors[1].shafts=[...(two.floors[1].shafts??[]),{id:'new',rect:{x:bed.x+bed.w/2,y:bed.y+bed.h/2,w:500,h:500}}]
 q=calculateQuantities(two);assert.ok(q.total.items['concrete.slabs'].NetVolume<old.total.items['concrete.slabs'].NetVolume)
})
test('content memoization detects edits while ignoring cached areas, seeds, colours and rates',()=>{
 const d=simpleQuantityPlan(),q=measureDesign(d)
 assert.equal(measureDesign(d),q);assert.equal(measureDesign(structuredClone(d)),q)
 d.builtAreaSqm=999;d.floors[0].rooms[0].area=999;d.planSeed=999
 assert.equal(measureDesign(d),q)
 d.floors[0].rooms[0].rect={...d.floors[0].rooms[0].rect,w:3500}
 const next=measureDesign(d);assert.notEqual(next,q);assert.equal(next.total.items.flooring.NetArea,14)
 d.model.brief.specs.overrides['plinth-height']='raised'
 assert.notEqual(measureDesign(d),next)
})
test('sizing grows with storeys/span and soil/plinth selections are explicit, not inferred from finish level',()=>{
 for(const p of ['corner','edge','interior'])assert.ok(columnSizeMm(4,p)>columnSizeMm(1,p))
 assert.equal(beamDepthMm(4800),400);assert.equal(beamDepthMm(5000),450)
 assert.equal(slabThicknessMm(3900),125);assert.equal(slabThicknessMm(5000),150)
 const d=simpleQuantityPlan(),s=sizeStructure(d)
 d.floors.push({...structuredClone(d.floors[0]),level:1})
 assert.ok(sizeStructure(d).footings[0].rect.w>s.footings[0].rect.w)
 d.model.brief.specs.overrides['soil-type']='unknown';assert.ok(sizeStructure(d).footings[0].rect.w>1450)
 d.model.brief.specs.overrides['plinth-height']='flood';assert.equal(sizeStructure(d).plinthHeightMm,900)
 d.model.brief.specs.overrides['concrete-grade']='m30';assert.equal(measureDesign(d).concreteMaterials.cementBags,null)
 const damaged=structuredClone(quantityRules);damaged.beam.spanDepthRatio=0
 assert.throws(()=>quantityRulesSchema.parse(damaged))
})
test('site/room quantities and tank sizing respond to source geometry and household count',()=>{
 const d=simpleQuantityPlan(),r={x:0,y:0,w:1000,h:2000}
 d.siteFeatures=[{id:'lawn',kind:'lawn',rect:r,covered:false},{id:'drive',kind:'driveway',rect:{...r,x:1000},covered:false}]
 const q=measureDesign(d);assert.equal(q.total.items['external.lawn'].NetArea,2);assert.equal(q.total.items['external.driveway'].NetArea,2)
 d.model.brief.household.members=Array.from({length:12},(_,i)=>({...d.model.brief.household.members[0],id:`person-${i}`}))
 assert.ok(measureDesign(d).tanks.undergroundLitres>q.tanks.undergroundLitres)
})
