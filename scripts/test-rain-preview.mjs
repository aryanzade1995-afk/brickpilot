import test from 'node:test'
import assert from 'node:assert/strict'
import {defaultBrief} from '../src/lib/model/brief.ts'
import {compile} from '../src/lib/model/canonical.ts'
import {generate} from '../src/lib/engine/generate.ts'
import {createBuildingModel} from '../src/lib/engine/buildingModel.ts'
import {realizedTankPorts} from '../src/lib/plumbing/villaPlumbing.ts'
import {proposeRainCollection} from '../src/lib/water/simpleSystem.ts'
import {createRainField,rainSurfaces,rainImpactAt} from '../src/lib/water/rainPreview.ts'
import {pipeAssembly} from '../src/lib/plumbing/assembly.ts'
import {filterDisplayPipes} from '../src/lib/water/filterDisplay.ts'

const brief=defaultBrief();brief.site.plotWidth=22;brief.site.plotDepth=28
const house=createBuildingModel(generate(compile(brief),{seed:41})),ports=realizedTankPorts(house)
test('rain covers actual roof and garden, is deterministic and leaves architecture untouched',()=>{
 const before=JSON.stringify(house),rain=proposeRainCollection(house),field=createRainField(house,ports,1,rain.tank)
 assert.equal(field.version,'rain-preview-v1');assert.ok(field.drops.length>=650&&field.drops.length<=2000);assert.ok(field.splashCount<=240)
 assert.ok(field.drops.some(d=>d.surface==='roof'));assert.ok(field.drops.some(d=>d.surface==='garden'))
 assert.ok(field.drops.every(d=>d.canSplash));assert.ok(field.drops.filter(d=>d.canSplash).every(d=>d.impact[0]>=0&&d.impact[0]<=house.plot.widthMm/1000&&-d.impact[2]>=0&&-d.impact[2]<=house.plot.depthMm/1000))
 assert.deepEqual(field,createRainField(house,ports,1,rain.tank));assert.equal(JSON.stringify(house),before)
 const model=rainSurfaces(house,ports,1,rain.tank)
 for(const drop of field.drops){assert.ok([...drop.impact,drop.phase,drop.speedMps,drop.lengthM,...drop.wind].every(Number.isFinite));assert.ok(drop.speedMps>0);assert.ok(field.topM>drop.impact[1]);assert.ok(drop.phase>=0&&drop.phase<1)
   assert.ok(Math.abs(drop.impact[1]-(rainImpactAt(model,drop.impact[0]*1000,-drop.impact[2]*1000).topMm/1000+.025))<1e-8)
 }
})
test('impact heights respect courtyard holes, stepped roofs, headroom and recorded canopies',()=>{
 const court={x:2000,y:2000,w:1000,h:1000},base={id:'GF',level:0,elevationMm:0,heightMm:3000,footprint:[{x:0,y:0,w:8000,h:7000}],courtyard:court}
 const b={planId:'authored-rain',plot:{widthMm:16000,depthMm:14000},floors:[base,{...base,id:'FF',level:1,elevationMm:3000,footprint:[{x:0,y:0,w:4000,h:7000}]}],shafts:[],roofTerrace:{mumty:{x:0,y:0,w:1200,h:1200}},modernComposition:{canopies:[{rect:{x:9000,y:0,w:1200,h:1200},bottomMm:2800,thicknessMm:170}]}}
 const model=rainSurfaces(b,[],1,null)
 assert.equal(rainImpactAt(model,2500,2500).topMm,0)
 assert.equal(rainImpactAt(model,1500,4500).topMm,6000)
 assert.equal(rainImpactAt(model,6500,4500).topMm,3000)
 assert.equal(rainImpactAt(model,500,500).topMm,8320)
 assert.equal(rainImpactAt(model,9500,500).topMm,2970)
 assert.equal(rainImpactAt(model,14000,12000).kind,'garden')
})
test('rain impacts follow resized roof tanks and the selected ground storage tank',()=>{
 const rain=proposeRainCollection(house),model=rainSurfaces(house,ports,1.4,rain.tank),p=ports[0]
 assert.ok(p);assert.equal(rainImpactAt(model,p.center.x,p.center.y).topMm,p.center.z-200+1135*1.4)
 assert.equal(rainImpactAt(model,rain.tank.center.x,rain.tank.center.y).topMm,rain.tank.center.z+rain.tank.heightMm/2+80)
 assert.throws(()=>createRainField(house,ports,Infinity));assert.throws(()=>createRainField({...house,plot:{widthMm:0,depthMm:10}},ports))
})
test('every storage feed has a screen, separate first-flush leg and two inline filters with no quality certification',()=>{
 for(const capacity of [500,1000,1800,2000,5000]){
   const rain=proposeRainCollection(house,capacity);if(!rain.ready){assert.equal(rain.treatment,null);continue}
   assert.deepEqual(rain.treatment.stages.map(s=>s.kind),['leaf-screen','first-flush','coarse-filter','sediment-cartridge'])
   assert.equal(rain.treatment.potable,false);assert.equal(rain.treatment.bypassToTank,false);assert.equal(rain.treatment.performance,'unverified')
   const feed=rain.downpipes.pipes.find(p=>p.id==='rain:downpipe'),diversion=rain.downpipes.pipes.find(p=>p.id==='rain:first-flush')
   assert.deepEqual(feed.points.at(-1),rain.tank.inlet);assert.deepEqual(diversion.points[0],rain.firstFlush);assert.notDeepEqual(diversion.points.at(-1),rain.tank.inlet)
   for(const stage of rain.treatment.stages.filter(s=>s.kind.endsWith('filter')||s.kind==='sediment-cartridge')){
     assert.ok(feed.points.slice(1).some((b,i)=>{const a=feed.points[i],p=stage.position;const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);return Math.abs(distance(a,p)+distance(p,b)-distance(a,b))<.001}),stage.kind)
   }
 }
})
test('drawn pipes end at filter heads rather than bypassing the visible media',()=>{
 const rain=proposeRainCollection(house),before=JSON.stringify(rain),display=filterDisplayPipes(rain)
 assert.equal(JSON.stringify(rain),before)
 for(const stage of rain.treatment.stages.filter(s=>s.kind==='coarse-filter'||s.kind==='sediment-cartridge'))for(const pipe of display.pipes){
   const [a,b]=pipe.points,p=stage.position
   if(a.x===p.x&&a.y===p.y&&b.x===p.x&&b.y===p.y)assert.ok(Math.max(a.z,b.z)<=p.z-140||Math.min(a.z,b.z)>=p.z+140)
 }
 assert.deepEqual(rain.downpipes.pipes.find(p=>p.id==='rain:downpipe').points.at(-1),rain.tank.inlet)
})


test('filter-to-tank outlet leaves room for a seated elbow rather than two sharp cut ends',()=>{
 const rain=proposeRainCollection(house),drawn=filterDisplayPipes(rain),assembly=pipeAssembly(drawn.segments)
 assert.ok(rain.ready)
 const bend={x:rain.filter.x,y:rain.filter.y,z:rain.tank.inlet.z}
 assert.ok(assembly.fittings.some(f=>f.kind==='elbow'&&Math.hypot(f.position.x-bend.x,f.position.y-bend.y,f.position.z-bend.z)<.01))
 const last=rain.treatment.stages.at(-1)
 assert.ok(last.position.z-140-rain.tank.inlet.z>90*2.25)
})
