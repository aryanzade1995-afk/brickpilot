import test from 'node:test'
import assert from 'node:assert/strict'
import {Box3,BoxGeometry,Group,Mesh,MeshStandardMaterial,Vector3} from 'three'
import {separateTankModels,sizeTankModels} from '../src/lib/water/tankSizing.ts'
import {prepareVillaScene} from '../src/lib/three/prepareVillaScene.ts'
import {realizedTankPorts,createVillaPlumbing,selectedPipeSizes} from '../src/lib/plumbing/villaPlumbing.ts'
import {defaultBrief} from '../src/lib/model/brief.ts'
import {compile} from '../src/lib/model/canonical.ts'
import {generate} from '../src/lib/engine/generate.ts'
import {createBuildingModel} from '../src/lib/engine/buildingModel.ts'
import {proposeRainCollection} from '../src/lib/water/simpleSystem.ts'
import {emptyWaterConfig,parseWaterConfig} from '../src/lib/water/schema.ts'
import {readFileSync} from 'node:fs'
test('accepted Blender tank meshes resize about their base without touching source geometry or stand',()=>{
 const source=new Group(),material=new MeshStandardMaterial(),body=new Mesh(new BoxGeometry(1,1,1),material),stand=new Mesh(new BoxGeometry(),material)
 body.name='Roof_WaterTank_1';body.position.set(2,1.36,-3);stand.name='Roof_Tank_Tray';source.add(body,stand)
 const geometry=body.geometry,positions=geometry.attributes.position.array.slice(),models=separateTankModels(source),ports=[{id:'Roof_WaterTank_1',center:{x:2000,y:3000,z:1060},port:{x:2500,y:3000,z:1060},radiusMm:500}]
 assert.equal(models.parts.length,1)
 sizeTankModels(models,ports,.6,1.5)
 const bounds=new Box3().setFromObject(models.root),size=bounds.getSize(new Vector3())
 assert.ok(Math.abs(size.x-.6)<1e-6);assert.ok(Math.abs(size.y-1.5)<1e-6);assert.ok(Math.abs(bounds.min.y-.86)<1e-6)
 assert.equal(body.geometry,geometry);assert.deepEqual(geometry.attributes.position.array,positions);assert.equal(body.position.y,1.36)
 assert.equal(stand.scale.x,1);sizeTankModels(models,ports,1,1);assert.ok(Math.abs(new Box3().setFromObject(models.root).getSize(new Vector3()).y-1)<1e-6)
 assert.throws(()=>sizeTankModels(models,ports,2,1));assert.throws(()=>sizeTankModels(models,ports,1,NaN))
})
test('water-view cache separates original tanks once, while normal villa cache keeps the original model',()=>{
 const source=new Group();for(const name of ['Roof_WaterTank_1','Roof_WaterTank_1_Lid','Wall','Roof_Tank_Tray']){const m=new Mesh(new BoxGeometry(),new MeshStandardMaterial());m.name=name;source.add(m)}
 const before=source.children.length,normal=prepareVillaScene(source,1),water=prepareVillaScene(source,1,true)
 const vertices=root=>{let count=0;root.traverse(m=>{if(m instanceof Mesh)count+=m.geometry.attributes.position.count});return count}
 assert.ok(vertices(normal)>vertices(water));assert.equal(source.children.length,before)
 assert.equal(separateTankModels(source).parts.length,2)
})
test('resized roof-tank outlet connections follow the shell while architectural geometry stays identical',()=>{
 const brief=defaultBrief();brief.site.plotWidth=22;brief.site.plotDepth=28
 const building=createBuildingModel(generate(compile(brief),{seed:41})),before=JSON.stringify(building),old=realizedTankPorts(building),small=realizedTankPorts(building,.65)
 assert.ok(old.length);assert.equal(old.length,small.length)
 for(let i=0;i<old.length;i++){assert.deepEqual(old[i].center,small[i].center);assert.equal(small[i].radiusMm,old[i].radiusMm*.65)}
 const layout=createVillaPlumbing(building,selectedPipeSizes(brief),[],.65)
 for(const tank of small)assert.deepEqual(layout.pipes.find(p=>p.id===`tank-port:${tank.id}`).points[0],tank.port)
 assert.equal(JSON.stringify(building),before)
 const rain=proposeRainCollection(building,1800);assert.ok(rain.ready);assert.equal(rain.tank.capacityLitres,1800)
})
test('custom sizes persist and the removed explanatory cards are absent',()=>{
 const config={...emptyWaterConfig('p','r'),simple:{version:1,rainwater:true,tankLitres:'1800',roofDiameterScale:.8,roofHeightScale:1.3,purpose:'garden',rainfallMm:null}}
 assert.deepEqual(parseWaterConfig(JSON.parse(JSON.stringify(config))),config)
 const ui=readFileSync(new URL('../src/components/water/WaterIntelligence.tsx',import.meta.url),'utf8')
 for(const text of ['TANK TO TAP','Tank to tap','Roof tanks. Hidden pipes.','Roof tanks feed supply pipes','Already in your model','recorded shaft connections'])assert.ok(!ui.includes(text),text)
 for(const control of ['Roof tank width','Roof tank height','Rainwater tank capacity'])assert.ok(ui.includes(control))
})
