import test from 'node:test'
import assert from 'node:assert/strict'
import { Group, Mesh, BoxGeometry, MeshStandardMaterial, Plane, Vector3 } from 'three'
import { defaultBrief } from '../src/lib/model/brief.ts'
import { compile } from '../src/lib/model/canonical.ts'
import { generate } from '../src/lib/engine/generate.ts'
import { createBuildingModel } from '../src/lib/engine/buildingModel.ts'
import { utilityFloor } from '../src/lib/utilities/plan.ts'
import { defaultDrainageInputs } from '../src/lib/utilities/drainageInputs.ts'
import { projectPipelines } from '../src/lib/water/projectPipelines.ts'
import { SIMPLE_WATER_DEFAULTS } from '../src/lib/water/simpleSystem.ts'
import { coordinateSupply } from '../src/lib/water/supplyContinuity.ts'
import { coordinateDrainageContinuity } from '../src/lib/water/drainageContinuity.ts'
import { hideBakedPipelines, hideReplacedRoofTanks, stylePipelineOverlay } from '../src/lib/three/pipelineVisibility.ts'
import { acceptedVillaCollision } from '../src/lib/three/acceptedVillaWalkthrough.ts'
import { plumbingExportScene } from '../src/lib/plumbing/pipeGeometry.ts'
import { prepareVillaScene } from '../src/lib/three/prepareVillaScene.ts'

const brief=defaultBrief();brief.site.plotWidth=22;brief.site.plotDepth=28
const design=generate(compile(brief),{seed:3}),building=createBuildingModel(design)
const emptyStorage={getItem:()=>null}
const network=projectPipelines(design,building,brief,'project-A',undefined,emptyStorage)

test('all viewers replay the existing supply/continuous drain engines without changing the house, brief, IDs or cost inputs',()=>{
  const before=JSON.stringify({design,building,brief})
  const replay=projectPipelines(design,building,brief,'project-A',undefined,emptyStorage)
  assert.equal(JSON.stringify({design,building,brief}),before)
  assert.deepEqual(replay,network)
  assert.deepEqual(network.supply,coordinateSupply(building,network.home,network.floors,network.fixtureScene.fixtures))
  assert.deepEqual(network.continuity,coordinateDrainageContinuity(building,network.home,network.drainage,network.rawFixtureScene))
  assert.equal(network.planId,building.planId)
  assert.equal(network.floors.length,design.floors.length)
  const unresolved=new Set(network.floors.flatMap(f=>f.waterNetworks.filter(n=>n.service==='cold').flatMap(n=>n.unroutedFixtures)))
  assert.ok(network.supply.fixtures.every(f=>f.connected===!unresolved.has(f.id)))
  assert.ok(network.fixtureScene.fixtures.every(f=>f.branch?.connected))
})

test('project/floor-scoped saved drainage additions restore in the shared scene; explicit discharge never becomes the proposed tank',()=>{
  const floor=utilityFloor(design,0,brief),input=defaultDrainageInputs(),room=floor.floor.rooms.find(r=>/bath/i.test(r.name))
  input.fixtures.push({id:'saved-extra-basin',kind:'washbasin',roomId:room.id,position:{x:room.rect.x+room.rect.w/2,y:room.rect.y+room.rect.h/2}})
  input.outlet={kind:'sewer',position:{x:21000,y:27000},invertMm:null,approvalReference:''}
  const json=JSON.stringify(input),storage={getItem:key=>key==='formstead.drainage-inputs.v1:project-A:floor:0'?json:null}
  const a=projectPipelines(design,building,brief,'project-A',undefined,storage)
  const b=projectPipelines(design,building,brief,'project-B',undefined,storage)
  assert.ok(a.fixtureScene.fixtures.some(f=>f.id==='saved-extra-basin'))
  assert.ok(!b.fixtureScene.fixtures.some(f=>f.id==='saved-extra-basin'))
  assert.equal(a.fixtureScene.configuredDischarge,true)
  assert.ok(!a.drainNetwork.layout.pipes.some(p=>p.id==='drain:tank-inlet'))
  assert.ok(a.fixtureScene.destinations.some(d=>d.name.startsWith('sewer')))
})

test('saved roof-tank dimensions alter the shared manifold only; source model and original tank pivots are stable',()=>{
  const before=JSON.stringify({building,design})
  const resized=projectPipelines(design,building,brief,'project-A',{...SIMPLE_WATER_DEFAULTS,roofDiameterScale:.8,roofHeightScale:1.2},emptyStorage)
  assert.equal(JSON.stringify({building,design}),before)
  assert.deepEqual(resized.originalPorts,network.originalPorts)
  assert.notDeepEqual(resized.home.tankPorts,network.home.tankPorts)
  assert.equal(resized.options.roofHeightScale,1.2)
})

test('only tagged old pipes are hidden before collision; walls, furniture, buffers and roof stands stay intact',()=>{
  const root=new Group(),wall=new Mesh(new BoxGeometry(),new MeshStandardMaterial()),pipe=wall.clone()
  wall.name='GF_Wall_1';pipe.userData.formstead_plumbing=true;root.add(wall,pipe)
  const tank=wall.clone();tank.name='Roof_WaterTank_1_Body';const stand=wall.clone();stand.name='Roof_Tank_Stand_1';root.add(tank,stand)
  const vertices=[...wall.geometry.attributes.position.array]
  hideBakedPipelines(root)
  assert.equal(pipe.visible,false);assert.equal(wall.visible,true)
  assert.equal(acceptedVillaCollision(root).vertices.length,wall.geometry.attributes.position.array.length*3)
  hideReplacedRoofTanks(root)
  assert.equal(tank.visible,false);assert.equal(stand.visible,true)
  assert.deepEqual([...wall.geometry.attributes.position.array],vertices)
})

test('inspection/cutaway only style live materials; GLB replay strips the live overlay without losing architecture',()=>{
  const root=new Group(),buildingMesh=new Mesh(new BoxGeometry(),new MeshStandardMaterial()),layer=new Group()
  buildingMesh.name='Architecture';const pipe=new Mesh(new BoxGeometry(.03,1,.03),new MeshStandardMaterial());layer.add(pipe);root.add(buildingMesh,layer)
  const plane=new Plane(new Vector3(0,-1,0),2)
  stylePipelineOverlay(layer,true,plane)
  assert.equal(pipe.material.depthTest,false);assert.deepEqual(pipe.material.clippingPlanes,[plane])
  assert.equal(buildingMesh.material.depthTest,true);assert.equal(buildingMesh.material.clippingPlanes,null)
  const exported=plumbingExportScene(root)
  const exportedPipe=exported.root.children[1].children[0]
  assert.equal(exportedPipe.material.depthTest,true);assert.equal(exportedPipe.material.opacity,1)
  assert.equal(pipe.material.depthTest,false)
  const reopened=prepareVillaScene(exported.root,1)
  assert.ok(!reopened.getObjectByName(layer.name||'Formstead_Current_Project_Pipelines')?.userData.formstead_plumbing)
  let serviceCount=0;reopened.traverse(o=>{if(o.userData.formstead_plumbing)serviceCount++})
  assert.equal(serviceCount,0)
  assert.ok(reopened.children.length)
  exported.dispose()
  stylePipelineOverlay(layer,false)
  assert.equal(pipe.material.depthTest,true);assert.deepEqual(pipe.material.clippingPlanes,[])
})

test('displayed fixtures share floor datums and their water/waste pipes end at the visible instance ports',async()=>{
 const {fixtureServicePorts,fixtureWasteConnection}=await import('../src/lib/water/fixtureDrainage.ts')
 for(const f of network.fixtureScene.fixtures){
  const floor=building.floors.find(item=>item.id===f.floorId)
  assert.equal(f.point.z,floor.elevationMm)
  if(f.model){
   if(f.kind==='washbasin'||f.kind==='unknown_sink'){
    assert.ok(Math.abs(f.model.position[1]*1000-floor.elevationMm)<.01,'pedestal base must meet the floor')
    assert.ok(Math.abs(f.model.size[1]*1000-850)<.01,'basin rim must have a consistent installation height')
   }
   if(f.kind==='kitchen_sink')assert.ok(Math.abs((f.model.position[1]+f.model.size[1])*1000-floor.elevationMm-900)<.01)
  }
  const ports=fixtureServicePorts(f),water=network.supply.fixtures.find(item=>item.key===f.key)
  if(water)assert.deepEqual(water.point,ports.supply)
  if(f.branch){
   const waste=fixtureWasteConnection(f)
   assert.deepEqual(waste[0],ports.waste)
   assert.deepEqual(waste.at(-1),f.branch.points[0])
   assert.ok(waste.every(p=>[p.x,p.y,p.z].every(Number.isFinite)))
  }
 }
})

test('sub-millimetre coordinate noise cannot erase a vertical service pipe',async()=>{
 const {plumbingSegments}=await import('../src/lib/plumbing/villaPlumbing.ts')
 const pipes=[{system:'water',diameterMm:20,points:[{x:100,y:200.00000000001,z:900},{x:100,y:200,z:550}]}]
 const segments=plumbingSegments({pipes})
 assert.equal(segments.length,1)
 assert.equal(Math.abs(segments[0].from.z-segments[0].to.z),350)
})
