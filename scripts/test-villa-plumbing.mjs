import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { defaultBrief } from '../src/lib/model/brief.ts'
import { createVillaPlumbing, realizedTankPorts, selectedPipeSizes, pipeCrossesStructure, plumbingSegments, PLUMBING_CONCEPT } from '../src/lib/plumbing/villaPlumbing.ts'
import { createPlumbingGroup, disposePlumbingGroup, plumbingExportScene } from '../src/lib/plumbing/pipeGeometry.ts'
import { prepareVillaScene } from '../src/lib/three/prepareVillaScene.ts'
import { tankBank } from '../src/lib/engine/terrace.ts'
// Small authored source with aligned apertures; the production fixture is optional.
const floor=(id,level)=>({id,level,name:id,elevationMm:level*3000,heightMm:3000,slabThicknessMm:150,outline:{x:0,y:0,w:12000,h:10000},footprint:[{x:0,y:0,w:12000,h:10000}],courtyard:null})
const source={schemaVersion:1,planId:'plumbing-test',floors:[floor('GF',0),floor('FF',1)],shafts:['GF','FF'].map(floorId=>({id:`${floorId}_SHAFT`,floorId,roomId:'bath',rect:{x:10000,y:8000,w:600,h:600},stackedOver:null})),rooms:['GF','FF'].map(floorId=>({id:'bath',name:'Bathroom',floorId})),walls:[],columns:[],beams:[],roofTerrace:{level:1,slab:[{x:0,y:0,w:12000,h:10000}],outline:{x:0,y:0,w:12000,h:10000},mumty:null,tank:{x:600,y:600,w:1100,h:1100},pergola:null},stairs:[]}
const sizes={waterMm:32,soilMm:110,wasteMm:75}
test('deterministic service replay leaves building, openings and identity unchanged',()=>{const before=JSON.stringify(source),a=createVillaPlumbing(source,sizes);assert.deepEqual(a,createVillaPlumbing(source,sizes));assert.equal(JSON.stringify(source),before);assert.equal(a.planId,source.planId);assert.notEqual(a.signature,createVillaPlumbing(source,{...sizes,waterMm:25}).signature);assert.deepEqual(selectedPipeSizes(defaultBrief()),sizes)})
test('every actual expanded-bank cylinder has a tank-shell outlet',()=>{const bank=tankBank(source.roofTerrace),ports=realizedTankPorts(source),layout=createVillaPlumbing(source,sizes);assert.equal(ports.length,Math.round(Math.max(bank.w,bank.h)/1150));for(const p of ports){assert.ok(Math.abs(Math.hypot(p.port.x-p.center.x,p.port.y-p.center.y)-p.radiusMm)<1e-6);assert.deepEqual(layout.pipes.find(r=>r.id===`tank-port:${p.id}`).points[0],p.port)}})
test('pipe envelopes clear structure and all segments stay orthogonal',()=>{const layout=createVillaPlumbing(source,sizes);assert.ok(layout.pipes.length>0);for(const p of layout.pipes){assert.equal(pipeCrossesStructure(source,p.points,p.diameterMm/2),null,p.id);for(let i=1;i<p.points.length;i++)assert.equal(['x','y','z'].filter(k=>p.points[i][k]!==p.points[i-1][k]).length,1)}})
test('aligned source holes support a true roof-to-lower-floor feed; interrupted slabs prevent it',()=>{const open=createVillaPlumbing(source,sizes);assert.ok(open.pipes.some(p=>p.id==='supply:GF_SHAFT'));const blocked=structuredClone(source);blocked.shafts=blocked.shafts.filter(s=>s.floorId==='GF');const result=createVillaPlumbing(blocked,sizes);assert.ok(!result.pipes.some(p=>p.id==='supply:GF_SHAFT'));assert.ok(result.issues.some(i=>i.id==='supply:GF_SHAFT'&&i.reason.includes('slab')))})
test('water and drainage occupy separate pipe envelopes inside shafts',()=>{const layout=createVillaPlumbing(source,sizes);for(const s of source.shafts){const d=layout.pipes.find(p=>p.id===`soil:${s.id}`),w=layout.pipes.find(p=>p.id===`supply:${s.id}`||p.id===`water-stub:${s.id}`);assert.ok(d&&w);assert.ok(Math.hypot(d.points[0].x-w.points.at(-1).x,d.points[0].y-w.points.at(-1).y)>=(d.diameterMm+w.diameterMm)/2+PLUMBING_CONCEPT.separationMm)}})
test('missing tank, tiny shaft and unknown size remain honest review states',()=>{const missing=structuredClone(source);delete missing.roofTerrace;assert.equal(createVillaPlumbing(missing,sizes).tankPorts.length,0);const tiny=structuredClone(source);tiny.shafts.forEach(s=>s.rect.w=80);assert.ok(createVillaPlumbing(tiny,sizes).issues.some(i=>i.reason.includes('too small')));assert.equal(createVillaPlumbing(source,{...sizes,waterMm:NaN}).pipes.length,0);assert.ok(createVillaPlumbing(source,sizes).issues.some(i=>i.id==='discharge'))})
test('overlapping shared headers are unioned and the layer needs only three material draws',()=>{const runs={pipes:[{system:'water',diameterMm:32,points:[{x:0,y:0,z:0},{x:100,y:0,z:0}]},{system:'water',diameterMm:32,points:[{x:50,y:0,z:0},{x:150,y:0,z:0}]}]};assert.deepEqual(plumbingSegments(runs),[{system:'water',diameterMm:32,from:{x:0,y:0,z:0},to:{x:150,y:0,z:0}}]);const root=createPlumbingGroup(createVillaPlumbing(source,sizes));assert.ok(root.children.length<=3);for(const mesh of root.children){assert.ok([...mesh.geometry.attributes.position.array].every(Number.isFinite));assert.equal(mesh.userData.formstead_plumbing,true)}disposePlumbingGroup(root)})
test('combined GLBs strip baked services before one current canonical layer is attached',()=>{const sourceScene=new THREE.Group();sourceScene.add(new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial()),createPlumbingGroup(createVillaPlumbing(source,sizes)));const prepared=prepareVillaScene(sourceScene,1);let count=0;prepared.traverse(o=>{if(o.userData.formstead_plumbing)count++});assert.equal(count,0);assert.ok(prepared.children.length)})
test('Blender replays canonical segments; services are excluded from architectural shape metrics',()=>{const python=readFileSync(new URL('../blender/geometry/plumbing.py',import.meta.url),'utf8');assert.ok(python.includes("layout['segments']"));assert.ok(!python.includes('routeDrain'));assert.ok(readFileSync(new URL('../blender/exporters/shape.py',import.meta.url),'utf8').includes('obj.get("formstead_plumbing")'))})

test('X-ray stays a viewing option; exports use opaque pipes without mutating the cached scene',()=>{
 const live=createPlumbingGroup(createVillaPlumbing(source,sizes),true),exported=plumbingExportScene(live)
 assert.equal(live.children[0].material.depthTest,false)
 assert.equal(exported.root.children[0].material.depthTest,true)
 assert.equal(exported.root.children[0].material.opacity,1)
 assert.equal(live.children[0].material.opacity,.8)
 exported.dispose();disposePlumbingGroup(live)
})

test('aligned floors share one soil stack; vents never overlap occupied soil pipe sections',()=>{
 const layout=createVillaPlumbing(source,sizes)
 assert.ok(layout.pipes.some(p=>p.id==='stack-link:GF_SHAFT'))
 assert.ok(!layout.pipes.some(p=>p.id==='vent:GF_SHAFT'))
 const segments=plumbingSegments(layout)
 for(const vent of segments.filter(s=>s.system==='vent'))for(const drain of segments.filter(s=>s.system==='drain')){
   if(vent.from.x!==drain.from.x||vent.from.y!==drain.from.y||vent.to.x!==drain.to.x||vent.to.y!==drain.to.y)continue
   assert.ok(Math.min(vent.to.z,drain.to.z)-Math.max(vent.from.z,drain.from.z)<=.001)
 }
})
