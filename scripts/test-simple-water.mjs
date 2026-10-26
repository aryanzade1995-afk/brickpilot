import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync,existsSync} from 'node:fs'
import {Mesh,MeshStandardMaterial,BoxGeometry,Group} from 'three'
import {defaultBrief} from '../src/lib/model/brief.ts'
import {compile} from '../src/lib/model/canonical.ts'
import {generate} from '../src/lib/engine/generate.ts'
import {createBuildingModel} from '../src/lib/engine/buildingModel.ts'
import {createVillaPlumbing,selectedPipeSizes,pipeCrossesStructure} from '../src/lib/plumbing/villaPlumbing.ts'
import {outerRoofLoops,proposeRainCollection,SIMPLE_WATER_DEFAULTS} from '../src/lib/water/simpleSystem.ts'
import {ghostWaterArchitecture} from '../src/lib/water/ghostScene.ts'
import {emptyWaterConfig,parseWaterConfig} from '../src/lib/water/schema.ts'
const brief=defaultBrief();brief.site.plotWidth=22;brief.site.plotDepth=28
const building=createBuildingModel(generate(compile(brief),{seed:41}))
test('rain proposal is deterministic and preserves the exact source house and supply system',()=>{
 const before=JSON.stringify(building),supply=JSON.stringify(createVillaPlumbing(building,selectedPipeSizes(brief))),a=proposeRainCollection(building,1000)
 assert.ok(a.ready,a.notes.join(';'))
 assert.deepEqual(a,proposeRainCollection(building,1000));assert.equal(JSON.stringify(building),before)
 assert.equal(JSON.stringify(createVillaPlumbing(building,selectedPipeSizes(brief))),supply)
 assert.equal(a.downpipes.planId,building.planId)
})
test('gutters form one closed perimeter and every rain pipe is continuous, orthogonal and structurally clear',()=>{
 const a=proposeRainCollection(building,1000)
 for(let i=0;i<a.gutters.length;i++){assert.deepEqual(a.gutters[i][1],a.gutters[(i+1)%a.gutters.length][0]);assert.equal(pipeCrossesStructure(building,a.gutters[i],90),null)}
 for(const pipe of a.downpipes.pipes){assert.equal(pipeCrossesStructure(building,pipe.points,pipe.diameterMm/2),null,pipe.id)
   for(let i=1;i<pipe.points.length;i++)assert.equal(['x','y','z'].filter(k=>pipe.points[i][k]!==pipe.points[i-1][k]).length,1)
 }
 const feed=a.downpipes.pipes.find(p=>p.id==='rain:downpipe')
 assert.deepEqual(feed.points[0],a.collector);assert.deepEqual(feed.points.at(-1),a.tank.inlet)
 assert.ok(feed.points.every((p,i)=>i===0||p.z<=feed.points[i-1].z))
 assert.deepEqual(a.downpipes.pipes.find(p=>p.id==='rain:first-flush').points[0],a.firstFlush)
})
test('rain storage is separate from roof supply and fits outside the building and site access',()=>{
 const a=proposeRainCollection(building,1000),tank=a.tank
 for(const floor of building.floors)for(const r of floor.footprint)assert.ok(tank.center.x+tank.radiusMm<=r.x||tank.center.x-tank.radiusMm>=r.x+r.w||tank.center.y+tank.radiusMm<=r.y||tank.center.y-tank.radiusMm>=r.y+r.h)
 assert.ok(tank.center.x-tank.radiusMm>=0&&tank.center.y-tank.radiusMm>=0)
 assert.ok(tank.center.x+tank.radiusMm<=building.plot.widthMm&&tank.center.y+tank.radiusMm<=building.plot.depthMm)
 assert.ok(!a.downpipes.pipes.some(p=>p.id.startsWith('tank-port:')))
 assert.ok(a.notes.join(' ').includes('non-potable'))
})
test('tank capacity changes preview geometry without changing the house; unsupported sizes are rejected',()=>{
 const source=JSON.stringify(building),a=proposeRainCollection(building,1000),b=proposeRainCollection(building,2000)
 assert.ok(b.ready,b.notes.join(';'));assert.equal(b.tank.capacityLitres,2000)
 assert.notEqual(a.tank.radiusMm,b.tank.radiusMm);assert.equal(JSON.stringify(building),source)
 assert.throws(()=>proposeRainCollection(building,NaN));assert.throws(()=>proposeRainCollection(building,1234))
})
test('courtyard rings are not turned into cross-courtyard gutter shortcuts',()=>{
 const ring=[{x:0,y:0,w:10000,h:2000},{x:0,y:8000,w:10000,h:2000},{x:0,y:2000,w:2000,h:6000},{x:8000,y:2000,w:2000,h:6000}]
 assert.equal(outerRoofLoops(ring).length,1)
 assert.equal(outerRoofLoops([{x:0,y:0,w:2000,h:2000},{x:5000,y:0,w:2000,h:2000}]).length,2)
})
test('no roof or no installation space produces a clear pending result and no invented tank or penetrations',()=>{
 const absent=structuredClone(building);delete absent.roofTerrace
 assert.equal(proposeRainCollection(absent).ready,false)
 const crowded=structuredClone(building);crowded.siteFeatures=[{kind:'pool',rect:{x:0,y:0,w:crowded.plot.widthMm,h:crowded.plot.depthMm}}]
 const r=proposeRainCollection(crowded);assert.equal(r.ready,false);assert.equal(r.tank,null);assert.equal(r.downpipes.pipes.length,0)
})
test('see-inside mode clones materials, preserves geometry and restores original materials on exit',()=>{
 const root=new Group(),material=new MeshStandardMaterial({color:'#eadfcc'}),geometry=new BoxGeometry(),a=new Mesh(geometry,material),b=new Mesh(geometry,material);root.add(a,b)
 const original=material.color.getHex(),restore=ghostWaterArchitecture(root),ghost=a.material
 assert.notEqual(ghost,material);assert.equal(a.geometry,geometry);assert.equal(a.material,b.material)
 assert.equal(material.opacity,1);assert.equal(material.color.getHex(),original);assert.equal(ghost.depthWrite,false)
 let disposed=false;ghost.addEventListener('dispose',()=>{disposed=true});restore()
 assert.equal(a.material,material);assert.equal(b.material,material);assert.equal(disposed,true)
 geometry.dispose();material.dispose()
})
test('simple preferences round trip while old engineering documents remain readable',()=>{
 const old=emptyWaterConfig('p','r');assert.equal(parseWaterConfig(old).simple,undefined)
 const updated={...old,simple:{...SIMPLE_WATER_DEFAULTS,rainwater:true,tankLitres:'2000',rainfallMm:10}}
 assert.deepEqual(parseWaterConfig(JSON.parse(JSON.stringify(updated))),updated)
 assert.equal(parseWaterConfig({...updated,simple:{...updated.simple,tankLitres:'invalid'}}),null)
})
test('old dashboard and manual component editor are removed from the current UI',()=>{
 const source=readFileSync(new URL('../src/components/water/WaterIntelligence.tsx',import.meta.url),'utf8')
 for(const old of ['Daily rainfall scenario','Connection intermediate points','Sensor type','Compare performance','Add manual catchment','Show suggestion details'])assert.ok(!source.includes(old))
 assert.ok(source.includes('See inside walls'));assert.ok(source.includes('Tank to home'));assert.ok(source.includes('Collect rainwater'))
 assert.equal(existsSync(new URL('../src/components/water/WaterIntelligenceLayer.tsx',import.meta.url)),false)
})
