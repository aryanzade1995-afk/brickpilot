import test from 'node:test'
import assert from 'node:assert/strict'
import { Group, Mesh, BoxGeometry, MeshStandardMaterial, MeshPhysicalMaterial, Box3 } from 'three'
import { batchWalkthroughScene, prepareWalkthroughGlazing } from '../src/lib/three/walkthroughBatches.ts'
import { acceptedVillaCollision } from '../src/lib/three/acceptedVillaWalkthrough.ts'
import { applyWalkthroughContactDetail } from '../src/lib/three/walkthroughSurfaceDetail.ts'

test('static room batching preserves world extents, glass and moving doors; release restores original IDs and meshes', () => {
  const root = new Group(), parent = new Group(), material = new MeshStandardMaterial()
  parent.position.set(3,0,-4); root.add(parent)
  const pieces = Array.from({ length: 12 }, (_,i) => { const m=new Mesh(new BoxGeometry(.3,1,.3),material.clone()); m.position.set(i*.4,.5,0); m.userData.source_id=`source-${i}`; parent.add(m); return m })
  const door = new Mesh(new BoxGeometry(.8,2,.04),material); door.userData.walkthroughDoorId='door'; parent.add(door)
  const glass = new Mesh(new BoxGeometry(.8,2,.02),new MeshStandardMaterial({transparent:true,opacity:.3})); parent.add(glass)
  root.updateMatrixWorld(true)
  const expected = new Box3(); pieces.forEach(m=>expected.expandByObject(m))
  const triangles=pieces.reduce((n,m)=>n+m.geometry.index.count/3,0), buffers=pieces.map(m=>m.geometry)
  const batch=batchWalkthroughScene(root), actual=new Box3(), visible=[]
  root.traverseVisible(o=>{if(o instanceof Mesh && o.userData.walkthroughBatch) {actual.expandByObject(o);visible.push(o)}})
  assert.equal(batch.before,12); assert.ok(batch.after<=2); assert.ok(actual.min.distanceTo(expected.min)<1e-6 && actual.max.distanceTo(expected.max)<1e-6)
  assert.equal(visible.reduce((n,m)=>n+m.geometry.index.count/3,0),triangles)
  assert.ok(door.visible && glass.visible); assert.ok(pieces.every(m=>!m.visible))
  batch.release(); batch.release()
  assert.ok(pieces.every((m,i)=>m.visible && m.geometry===buffers[i] && m.userData.source_id===`source-${i}`))
})

test('reflected glazing avoids the full-house transmission prepass and preserves dimensions and source materials', () => {
  const root=new Group(), material=new MeshPhysicalMaterial({color:'#dce7e8',transmission:1,roughness:.1}), glass=new Mesh(new BoxGeometry(1,2,.02),material)
  glass.userData.material_role='glass';root.add(glass)
  const geometry=glass.geometry
  prepareWalkthroughGlazing(root)
  assert.equal(glass.geometry,geometry);assert.equal(material.transmission,1)
  assert.equal(glass.material.transmission,0);assert.ok(glass.material.transparent);assert.equal(glass.material.opacity,.28);assert.equal(glass.material.depthWrite,false)
  assert.equal(acceptedVillaCollision(root).indices.length,geometry.index.count,'glass stays physically solid')
})

test('legacy open portal glass is absent in both rendering and collision while real windows remain solid', () => {
  const root=new Group(), add=(name,id)=>{const m=new Mesh(new BoxGeometry(1,2,.04),new MeshStandardMaterial());m.name=name;m.userData.source_id=id;root.add(m);return m}
  const leaf=add('Door_OPEN_SlidingLeft_Glass','OPEN'), fixed=add('Door_OPEN_SlidingRight_Glass','OPEN'), window=add('Window_W_Glass','W')
  const result=acceptedVillaCollision(root,[{sourceId:'OPEN',kind:'door',operation:'open'}])
  assert.equal(leaf.visible,false); assert.equal(fixed.visible,false); assert.ok(window.visible)
  assert.equal(result.indices.length,window.geometry.index.count)
})

test('small real threshold is passable, without allowing the character to climb furniture', async () => {
  const {HouseWalkingSimulation,initializeWalkingPhysics}=await import('../src/lib/walkthrough/navigation.ts')
  await initializeWalkingPhysics()
  const identity={designId:'p',projectId:'test',geometryKey:'g',appearanceKey:'a'}
  const metadata={...identity,floors:[{sourceId:'GF',elevationM:0}],rooms:[],openings:[{id:'main',sourceId:'MAIN',kind:'entry'}],entries:[{id:'main',position:[1,0,-1]}],stairs:[],issues:[]}
  const c=(id,min,max)=>({id,min,max,kind:'slab',sourceIds:[id],floorId:'GF'})
  const collision={...identity,version:1,units:'m',coordinates:'metres-x-plan-east-y-up-z-plan-north',doors:[],colliders:[c('floor',[0,-.2,-4],[4,0,0]),c('track',[0,0,-2.05],[4,.035,-1.95]),{...c('cabinet',[0,0,-3.3],[4,.8,-3]),kind:'furniture-aabb'}]}
  const sim=new HouseWalkingSimulation(metadata,collision,'p')
  try {for(let i=0;i<220;i++)sim.step({forward:1,right:0,yaw:0});assert.ok(sim.feet.z < -2.3 && sim.feet.z > -3);assert.ok(sim.feet.y < .05)} finally {sim.dispose()}
})

test('baked contact shading grounds real room furnishings without moving floors or recolouring selected products', () => {
  const root=new Group(), floorMaterial=new MeshStandardMaterial({color:'#bb9988'}), wallMaterial=new MeshStandardMaterial({color:'#ffffff'})
  const floor=new Mesh(new BoxGeometry(4,.1,4).toNonIndexed(),[floorMaterial,wallMaterial]); root.add(floor)
  floor.userData.materialBindings=[JSON.stringify(['GF','room','floor']),JSON.stringify(['GF','room','wall'])]
  floor.geometry.clearGroups();floor.geometry.addGroup(0,18,0);floor.geometry.addGroup(18,18,1)
  const positions=[...floor.geometry.attributes.position.array]
  const geometry={metadata:{rooms:[{id:'room',rectMm:{x:-2000,y:-2000,w:4000,h:4000},elevationM:0}]}}
  const appearance={furniture:[{roomId:'room',position:[0,.4,0],size:[1.8,.8,.9],rotation:0}]}
  applyWalkthroughContactDetail(root,geometry,appearance)
  assert.ok(floorMaterial.aoMap); assert.equal(floorMaterial.color.getHexString(),'bb9988');assert.equal(wallMaterial.aoMap,null)
  assert.deepEqual([...floor.geometry.attributes.position.array],positions);assert.ok(floor.geometry.attributes.uv1)
  const map=floorMaterial.aoMap, pixels=map.image.data
  assert.ok(pixels[(64*128+64)*4] < pixels[(10*128+10)*4],'contact region is darker than free floor')
  applyWalkthroughContactDetail(root,geometry,appearance);assert.equal(floorMaterial.aoMap,map,'unchanged geometry reuses its baked detail')
})
