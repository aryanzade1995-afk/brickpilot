import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {defaultBrief} from '../src/lib/model/brief.ts'
import {compile} from '../src/lib/model/canonical.ts'
import {generate} from '../src/lib/engine/generate.ts'
import {createBuildingModel} from '../src/lib/engine/buildingModel.ts'
import {createVillaPlumbing,pipeCrossesStructure} from '../src/lib/plumbing/villaPlumbing.ts'
import {proposeDrainStorage,drainTankLocalPorts} from '../src/lib/water/drainageStorage.ts'
import {emptyWaterConfig,parseWaterConfig} from '../src/lib/water/schema.ts'
const brief=defaultBrief();brief.site.plotWidth=22;brief.site.plotDepth=28
const house=createBuildingModel(generate(compile(brief),{seed:41})),sizes={waterMm:25,soilMm:110,wasteMm:75}

test('buried drainage tank fits outside architecture and connects only recorded sanitary stacks',()=>{
 const before=JSON.stringify(house),home=createVillaPlumbing(house,sizes),result=proposeDrainStorage(house,home)
 assert.ok(result.tank);assert.equal(result.status,'concept-review-required')
 assert.ok(result.tank.topMm<0);assert.ok(result.tank.center.z<result.tank.topMm)
 assert.ok(result.tank.outlet.z<result.tank.inlet.z)
 const r=result.tank.rect
 for(const floor of house.floors)for(const p of floor.footprint)assert.ok(!(r.x<p.x+p.w&&r.x+r.w>p.x&&r.y<p.y+p.h&&r.y+r.h>p.y))
 const inletPipe=result.layout.pipes.find(p=>p.id==='drain:tank-inlet');assert.ok(inletPipe);assert.deepEqual(inletPipe.points.at(-1),result.tank.inlet)
 for(const pipe of result.layout.pipes){assert.equal(pipe.system,'drain');assert.equal(pipeCrossesStructure(house,pipe.points,pipe.diameterMm/2),null);if(pipe.id!=='drain:tank-inlet'){assert.deepEqual(pipe.points.at(-1),inletPipe.points[0]);assert.ok(home.pipes.some(p=>p.id===pipe.id.slice('drain:collector:'.length)))}}
 assert.equal(result.layout.pipes.length,result.linkedStacks.length+1)
 assert.ok(result.issues.some(s=>s.includes('approved final disposal')))
 assert.equal(JSON.stringify(house),before)
 assert.deepEqual(proposeDrainStorage(house,home),result)
})
test('no site space or no ground stacks yields an explicit pending state without invented tank or routes',()=>{
 const home=createVillaPlumbing(house,sizes)
 const blocked=proposeDrainStorage(house,home,[{x:0,y:0,w:house.plot.widthMm,h:house.plot.depthMm}])
 assert.equal(blocked.tank,null);assert.equal(blocked.layout.pipes.length,0);assert.ok(blocked.issues[0].includes('No clear'))
 const missing=proposeDrainStorage(house,{...home,pipes:[]})
 assert.equal(missing.tank,null);assert.ok(missing.issues[0].includes('No represented'))
})
test('removing the recorded slab aperture cannot create a verified drain penetration',()=>{
 const home=createVillaPlumbing(house,sizes),modified=structuredClone(house);modified.shafts=[]
 for(const f of modified.floors)f.slabThicknessMm=180
 const result=proposeDrainStorage(modified,home)
 assert.equal(result.layout.pipes.length,0)
 assert.ok(result.issues.some(s=>s.includes('slab')))
})
test('additional tank feed points preserve all existing valid paths and reject structure crossings',()=>{
 const before=JSON.stringify(house),legacy=createVillaPlumbing(house,sizes),expanded=createVillaPlumbing(house,sizes,[],1,true)
 assert.equal(expanded.tankPorts.length,legacy.tankPorts.length)
 assert.ok(expanded.pipes.filter(p=>p.id.startsWith('supply:')).length>=legacy.pipes.filter(p=>p.id.startsWith('supply:')).length)
 for(const pipe of expanded.pipes)assert.equal(pipeCrossesStructure(house,pipe.points,pipe.diameterMm/2),null)
 assert.equal(JSON.stringify(house),before)
})
test('drainage preview selection round trips through the existing versioned water config and accepts older projects',()=>{
 const old=emptyWaterConfig(house.planId,'roof'),base={version:1,rainwater:false,tankLitres:'1000',purpose:'garden',rainfallMm:null}
 assert.ok(parseWaterConfig({...old,simple:base}))
 const result=parseWaterConfig(JSON.parse(JSON.stringify({...old,simple:{...base,drainage:true}})))
 assert.equal(result.simple.drainage,true);assert.equal(result.sourcePlanId,house.planId)
 assert.equal(parseWaterConfig({...old,simple:{...base,drainage:'yes'}}),null)
})
test('downloaded PBR maps have CC0 provenance and are real local JPG images',()=>{
 const root='public/materials/water',manifest=JSON.parse(fs.readFileSync(`${root}/sources.json`,'utf8'))
 assert.deepEqual(manifest.map(a=>a.asset),['Plastic010','Concrete034'])
 for(const asset of manifest){assert.equal(asset.license,'CC0-1.0');assert.match(asset.source,/^https:\/\/ambientcg.com\//);assert.equal(asset.files.length,3)
  for(const file of asset.files){const data=fs.readFileSync(`${root}/${file}`);assert.equal(data[0],255);assert.equal(data[1],216);assert.ok(data.length>100000)}
 }
})


test('tank mesh ports align with canonical collector inverts in both site orientations',()=>{
 const tank=proposeDrainStorage(house,createVillaPlumbing(house,sizes)).tank
 for(const alongX of [true,false]){
  const t={...tank,alongX,center:{x:7000,y:9000,z:-1020},topMm:-120,inlet:alongX?{x:5500,y:9000,z:-650}:{x:7000,y:7500,z:-650},outlet:alongX?{x:8500,y:9000,z:-750}:{x:7000,y:10500,z:-750}}
  const local=drainTankLocalPorts(t)
  assert.equal(local.inlet.x,-1.5);assert.equal(local.outlet.x,1.5)
  assert.equal(local.inlet.y,-.53);assert.equal(local.outlet.y,-.63)
  assert.equal(Math.abs(local.inlet.z),0)
 }
})


test('shared collector has one pipe size and explicit transitions from smaller source stacks',()=>{
 const home=createVillaPlumbing(house,sizes),result=proposeDrainStorage(house,home)
 assert.ok(result.layout.pipes.length)
 assert.equal(new Set(result.layout.pipes.map(p=>p.diameterMm)).size,1)
 for(const reducer of result.reducers){assert.ok(reducer.toMm>reducer.fromMm);assert.ok(home.pipes.some(p=>p.system==='drain'&&p.diameterMm===reducer.fromMm&&p.points.some(q=>q.x===reducer.at.x&&q.y===reducer.at.y&&q.z===reducer.at.z)))}
 assert.ok(result.issues.some(s=>s.includes('Discharge-based sizing is not verified')))
})
