import fs from 'node:fs'
import assert from 'node:assert/strict'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { Texture, Box3, Vector3 } from 'three'
import { acceptedVillaCollision } from '../src/lib/three/acceptedVillaWalkthrough.ts'
import { HouseWalkingSimulation, initializeWalkingPhysics, WALKING } from '../src/lib/walkthrough/navigation.ts'
const dir=process.argv[2]??'output/doors-pipes-validation'
const bytes=fs.readFileSync(dir+'/details.glb'),g=JSON.parse(fs.readFileSync(dir+'/geometry.json'))
const loader=new GLTFLoader().register(()=>({name:'GEOMETRY_QA',loadTexture:()=>Promise.resolve(new Texture())}))
const {scene}=await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'')
const triangles=acceptedVillaCollision(scene,g.metadata.openings)
const id={designId:g.planId,projectId:'detail-test',geometryKey:'actual-glb',appearanceKey:'actual-glb'}
await initializeWalkingPhysics()
const sim=new HouseWalkingSimulation({...g.metadata,...id},{...g.collision,...id},g.planId,triangles)
const tested=[]
try{
 for(const d of [...sim.doors.values()].filter(d=>d.opening.sourceId==='ROOF_STAIR_EXIT'||d.operation==='sliding')){
  if(tested.some(t=>t.source===d.opening.sourceId))continue
  const o=d.opening,a=o.apertureMm,h=o.orient==='h',base=a.z/1000
  const source=g.source?.rooms??[],roof=o.sourceId==='ROOF_STAIR_EXIT'
  const along=roof?(h?(a.x+a.w/2)/1000:-(a.y+a.d/2)/1000):(h?d.centre.x:d.centre.z)
  const plane=h?-(a.y+a.d/2)/1000:(a.x+a.w/2)/1000
  const candidates=[]
  for(const dist of [1.1,.9,.7,.4,.25])for(const sign of [-1,1]){
   const p=h?{x:along,y:base+WALKING.skin*2,z:plane+sign*dist}:{x:plane+sign*dist,y:base+WALKING.skin*2,z:along}
   if(sim.canStand(p))candidates.push({p,sign})
  }
  if(!candidates.length){
   const p=h?new Vector3(along,base,plane-.7):new Vector3(plane-.7,base,along),area=new Box3(p.clone().add(new Vector3(-.22,.02,-.22)),p.clone().add(new Vector3(.22,1.77,.22))),hits=[]
   scene.traverse(m=>{if(m.isMesh&&area.intersectsBox(new Box3().setFromObject(m)))hits.push({name:m.name,bounds:new Box3().setFromObject(m)})});console.log('APPROACH_BLOCKERS',o.sourceId,JSON.stringify(hits))
  }
  assert.ok(candidates.length,`No supported approach to ${o.sourceId}`)
  const {p,sign}=candidates[0]
  sim.feet={...p};sim.character.setTranslation({x:p.x,y:p.y+WALKING.height/2,z:p.z});sim.pause();sim.world.step()
  const direction=h?{x:0,z:-sign}:{x:-sign,z:0},yaw=Math.atan2(-direction.x,-direction.z)
  for(let i=0;i<85;i++)sim.step({forward:1,right:0,yaw})
  const before=h?sim.feet.z:sim.feet.x
  assert.ok((before-plane)*sign>0,`Closed door failed to block ${o.sourceId}`)
  // Stand back before opening; leaves may not intersect or push the person.
  sim.feet={...p};sim.character.setTranslation({x:p.x,y:p.y+WALKING.height/2,z:p.z});sim.pause();sim.world.step()
  sim.toggleDoor(d.id)
  for(let i=0;i<50;i++)sim.step({forward:0,right:0,yaw})
  assert.ok(d.progress>.99,`Door blocked during opening: ${o.sourceId}`)
  for(let i=0;i<125;i++)sim.step({forward:1,right:0,yaw})
  const after=h?sim.feet.z:sim.feet.x
  if((after-plane)*sign>=-.15){const p=new Vector3(sim.feet.x,sim.feet.y,sim.feet.z),area=new Box3(p.clone().add(new Vector3(-.25,.02,-.25)),p.clone().add(new Vector3(.25,1.77,.25))),hits=[];scene.traverse(m=>{if(m.isMesh&&!m.userData.walkthroughDoorId&&area.intersectsBox(new Box3().setFromObject(m)))hits.push({name:m.name,bounds:new Box3().setFromObject(m)})});console.log('PASSAGE_BLOCKERS',o.sourceId,JSON.stringify({feet:sim.feet,blocked:sim.blocked,hits}))}
  assert.ok((after-plane)*sign<-.15,`Open door still blocks passage: ${o.sourceId}; ${after} vs ${plane}`)
  tested.push({source:o.sourceId,operation:d.operation,closedBlocks:true,openPasses:true,roof})
 }
 assert.ok(tested.some(t=>t.roof));assert.ok(tested.some(t=>t.operation==='sliding'))
 console.log(JSON.stringify({planId:g.planId,doors:sim.doors.size,tested}))
}finally{sim.dispose()}
