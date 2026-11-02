import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {Group,Mesh,BoxGeometry,MeshStandardMaterial,Vector3} from 'three'
import {trafficPose,makeVehicle,parkedVehicleAnchors} from '../src/lib/three/vehicleGeometry.ts'
import {prepareVillaScene} from '../src/lib/three/prepareVillaScene.ts'

test('both traffic lanes drive forward, with fixed lane positions and separated same-lane vehicles',()=>{
 for(let i=0;i<4;i++){
  const a=trafficPose(2,i,120,10,-30),b=trafficPose(2.1,i,120,10,-30)
  const nose=new Vector3(0,0,1).applyAxisAngle(new Vector3(0,1,0),a.yaw)
  assert.ok(nose.x*(b.x-a.x)>0,'nose must point along velocity')
  assert.equal(a.z,b.z)
  assert.ok(Math.abs(nose.z)<1e-8)
 }
 assert.notEqual(trafficPose(2,0,120,10,-30).z,trafficPose(2,1,120,10,-30).z)
 assert.ok(Math.abs(trafficPose(2,0,120,10,-30).x-trafficPose(2,2,120,10,-30).x)>10)
})
test('parking replacements use original car locations, never the house or parking roof bounds',()=>{
 const source=new Group(),car=new Mesh(new BoxGeometry(2,1.4,4.5),new MeshStandardMaterial())
 car.position.set(10,.3,-8);car.userData={asset_id:'ferrari-458',source_id:'parking-car'};source.add(car)
 const anchors=parkedVehicleAnchors(source);assert.equal(anchors.length,1);assert.equal(anchors[0].center.x,10)
 const replacement=makeVehicle(source,4.3)
 assert.ok(replacement.children.length>0)
 const prepared=prepareVillaScene(source,1,false,false,true)
 assert.equal(prepared.children.length,0);assert.equal(source.children.length,1)
})
test('both uploaded archives produce standalone, grounded, front-normalized browser cars within a mesh budget',()=>{
 const base=new URL('../public/exterior-assets/user-cars/',import.meta.url),records=JSON.parse(readFileSync(new URL('manifest.json',base)))
 assert.equal(records.length,2)
 for(const asset of records){
  assert.equal(asset.front,'+Z');assert.ok(asset.triangles<50000)
  const b=readFileSync(new URL(asset.file,base)),j=JSON.parse(b.subarray(20,20+b.readUInt32LE(12)).toString())
  assert.ok(j.meshes.length>0)
  assert.ok(j.nodes.every(n=>!['Plane','Plane.001','Cylinder','carr.003'].includes(n.name)))
 }
})

test('six free coloured cars are embedded, licensed, lightweight and selected automatically',()=>{
 const base=new URL('../public/exterior-assets/free-cars/',import.meta.url)
 const records=JSON.parse(readFileSync(new URL('manifest.json',base)))
 assert.equal(records.length,6)
 assert.equal(new Set(records.map(asset=>asset.paint)).size,6)
 for(const asset of records){
  assert.equal(asset.license,'CC0-1.0');assert.equal(asset.front,'+Z')
  assert.ok(asset.paintedFaces>0);assert.ok(asset.triangles<10000)
  const b=readFileSync(new URL(asset.file,base)),j=JSON.parse(b.subarray(20,20+b.readUInt32LE(12)).toString())
  assert.ok(j.meshes.length>0)
  assert.ok((j.buffers??[]).every(b=>!b.uri),'geometry embedded')
  assert.ok((j.images??[]).every(i=>!i.uri),'textures embedded')
 }
})

test('default parking and six-car road traffic do not require opt-in or overlap in a lane',async()=>{
 const {parkedVehicleChoice,ROAD_FLEET}=await import('../src/lib/three/vehicleGeometry.ts')
 for(const saved of [undefined,'none','compact-hatch','unknown'])assert.equal(parkedVehicleChoice(saved),'sedan')
 assert.equal(parkedVehicleChoice('suv-luxury'),'suv-luxury');assert.equal(ROAD_FLEET.length,6)
 for(let lane=0;lane<2;lane++){
  const poses=[lane,lane+2,lane+4].map(i=>trafficPose(2,i,120,10,-30,6))
  for(let i=0;i<3;i++)for(let j=i+1;j<3;j++)assert.ok(Math.abs(poses[i].x-poses[j].x)>10)
 }
})
