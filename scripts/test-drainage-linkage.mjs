import test from 'node:test'
import assert from 'node:assert/strict'
import {PerspectiveCamera,Vector3} from 'three'
import {defaultBrief} from '../src/lib/model/brief.ts'
import {compile} from '../src/lib/model/canonical.ts'
import {generate} from '../src/lib/engine/generate.ts'
import {createBuildingModel} from '../src/lib/engine/buildingModel.ts'
import {createVillaPlumbing} from '../src/lib/plumbing/villaPlumbing.ts'
import {proposeDrainStorage} from '../src/lib/water/drainageStorage.ts'
import {connectedDrainageNetwork,drainNetworkSegments,drainageOverviewPose} from '../src/lib/water/drainageNetwork.ts'

const brief=defaultBrief();brief.site.plotWidth=22;brief.site.plotDepth=28
const house=createBuildingModel(generate(compile(brief),{seed:41})),home=createVillaPlumbing(house,{waterMm:25,soilMm:110,wasteMm:75}),storage=proposeDrainStorage(house,home)

test('one assembled drainage network reaches the tank through a perpendicular inlet branch',()=>{
 const before=JSON.stringify({house,home,storage}),network=connectedDrainageNetwork(house,home,storage)
 const inlet=storage.layout.pipes.find(p=>p.id==='drain:tank-inlet');assert.ok(inlet)
 assert.deepEqual(inlet.points.at(-1),storage.tank.inlet)
 const [a,b]=inlet.points
 assert.equal(a.z,b.z)
 assert.equal(storage.tank.alongX?a.y:a.x,storage.tank.alongX?b.y:b.x)
 assert.equal(Math.hypot(a.x-b.x,a.y-b.y),350)
 for(const p of storage.layout.pipes)assert.ok(network.layout.pipes.some(q=>q.id===p.id),`${p.id} must reach the same inlet`)
 assert.ok(network.layout.assembly.fittings.some(f=>Math.hypot(f.position.x-a.x,f.position.y-a.y,f.position.z-a.z)<=inlet.diameterMm+.01))
 assert.equal(JSON.stringify({house,home,storage}),before)
})
test('mid-run junctions split into common graph nodes rather than crossed unjoined tubes',()=>{
 const pipe=(id,points)=>({id,points,system:'drain',diameterMm:110,purpose:'test',floorId:'GF',shaftId:null,sizeBasis:'selected outside diameter'})
 const segments=drainNetworkSegments([pipe('trunk',[{x:0,y:0,z:0},{x:2000,y:0,z:0}]),pipe('branch',[{x:1000,y:1000,z:0},{x:1000,y:0,z:0}])])
 assert.equal(segments.length,3)
 assert.equal(segments.filter(s=>[s.from,s.to].some(p=>p.x===1000&&p.y===0&&p.z===0)).length,3)
})
test('crossing routes at separate elevations do not create a false connection',()=>{
 const pipe=(id,points)=>({id,points,system:'drain',diameterMm:110,purpose:'test',floorId:'GF',shaftId:null,sizeBasis:'selected outside diameter'})
 const segments=drainNetworkSegments([pipe('lower',[{x:0,y:0,z:0},{x:2000,y:0,z:0}]),pipe('upper',[{x:1000,y:-1000,z:1000},{x:1000,y:1000,z:1000}])])
 assert.equal(segments.length,2)
})
test('orphan source stacks remain reviewable but cannot masquerade as connected or animated drains',()=>{
 const orphan={...home.pipes.find(p=>p.id.startsWith('soil:')),id:'soil:isolated',shaftId:null,points:[{x:111,y:222,z:4000},{x:111,y:222,z:6000}]}
 const network=connectedDrainageNetwork(house,{...home,pipes:[...home.pipes,orphan]},storage)
 assert.ok(network.pendingStacks.some(p=>p.id===orphan.id))
 assert.ok(!network.layout.pipes.some(p=>p.id===orphan.id))
 assert.ok(network.labels.find(l=>l.id===orphan.id).pending)
 assert.ok(network.issues.some(s=>s.startsWith(orphan.id)))
})
test('initial overview fits the house, roof structures and buried tank on desktop and mobile',()=>{
 for(const aspect of [1.6,.62]){
  const pose=drainageOverviewPose(house,storage,40,aspect),camera=new PerspectiveCamera(40,aspect,.01,1000)
  camera.position.set(...pose.position);camera.lookAt(new Vector3(...pose.target));camera.updateMatrixWorld()
  for(const x of [0,house.plot.widthMm/1000])for(const y of [pose.bottom,pose.top])for(const z of [0,-house.plot.depthMm/1000]){
   const ndc=new Vector3(x,y,z).project(camera);assert.ok(Math.abs(ndc.x)<1&&Math.abs(ndc.y)<1&&ndc.z<1)
  }
 }
})
