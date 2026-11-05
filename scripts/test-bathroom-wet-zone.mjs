import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createWalkthroughSource} from '../src/lib/walkthrough/source.ts'
import {buildWalkthroughScene} from '../src/lib/walkthrough/scene.ts'
import {prepareWalkthroughGeometry,prepareWalkthroughAppearance,furnitureColliders} from '../src/lib/walkthrough/delivery.ts'
import {WALKING} from '../src/lib/walkthrough/navigation.ts'
const plan=JSON.parse(readFileSync(new URL('./fixtures/walkthrough-room-regression.json',import.meta.url)))
const before=JSON.stringify(plan)
const source=createWalkthroughSource(plan,{hardChecksPass:true},{style:'modern',lighting:'daylight',furnitureDensity:'medium'})
const app=prepareWalkthroughAppearance(plan,source,prepareWalkthroughGeometry(buildWalkthroughScene(source.building,{hardChecksPass:true})))

test('every bathroom has an open shower and mixer without a glass partition',()=>{
 for(const r of source.building.rooms.filter(r=>/bath/i.test(r.name))){
  const key=JSON.stringify([r.floorId,r.id]),items=app.furniture.filter(b=>b.roomId===key)
  const tray=items.find(b=>b.sourceIds.some(id=>id.endsWith('-shower-tray')))
  const glass=items.find(b=>b.sourceIds.some(id=>id.endsWith('-shower-glass')))
  assert.ok(tray,r.id+' wet area');assert.equal(glass,undefined,r.id+' has no partition')
  for(const suffix of ['mixer','head','drain'])assert.ok(items.some(b=>b.sourceIds.some(id=>id.endsWith('-shower-'+suffix))),r.id+' '+suffix)
  assert.ok(tray.size[1]<=.02,'no tall shower step')
  assert.ok(!items.some(b=>b.sourceIds.some(id=>id.includes('-enclosure-'))))
 }
 assert.equal(JSON.stringify(plan),before)
})

test('the screenshot bathroom admits the actual walking capsule from doorway to shower without crossing furniture or glass',()=>{
 const room=source.building.rooms.find(r=>r.id==='sharedBath1'),floor=source.building.floors.find(f=>f.id===room.floorId)
 const items=app.furniture.filter(b=>b.roomId===JSON.stringify([room.floorId,room.id]))
 const ids=new Set(items.map(b=>b.id)),models=app.models.filter(m=>m.roomId===JSON.stringify([room.floorId,room.id]))
 const obstacles=furnitureColliders({...app,furniture:items,models}).filter(c=>c.max[1]>floor.elevationMm/1000+.23&&c.min[1]<floor.elevationMm/1000+WALKING.height)
 const tray=items.find(b=>b.sourceIds.some(id=>id.endsWith('-shower-tray')))
 const door=source.building.doors.find(d=>d.floorId===room.floorId&&d.rooms?.includes(room.id))
 const radius=WALKING.radius+.01,step=.04
 const minX=room.rect.x/1000+.13+radius,maxX=(room.rect.x+room.rect.w)/1000-.13-radius
 const minZ=-(room.rect.y+room.rect.h)/1000+.13+radius,maxZ=-room.rect.y/1000-.13-radius
 const clear=(x,z)=>x>=minX&&x<=maxX&&z>=minZ&&z<=maxZ&&obstacles.every(c=>Math.hypot(x-Math.max(c.min[0],Math.min(x,c.max[0])),z-Math.max(c.min[2],Math.min(z,c.max[2])))>=radius)
 const start=[Math.max(minX,Math.min(maxX,door.at.x/1000)),Math.max(minZ,Math.min(maxZ,-door.at.y/1000))]
 const queue=[start],seen=new Set();let reached=false
 for(let i=0;i<queue.length;i++){
  const [x,z]=queue[i],key=Math.round((x-start[0])/step)+','+Math.round((z-start[1])/step)
  if(seen.has(key)||!clear(x,z))continue;seen.add(key)
  if(Math.hypot(x-tray.position[0],z-tray.position[2])<.12){reached=true;break}
  for(const [dx,dz] of [[step,0],[-step,0],[0,step],[0,-step]])queue.push([x+dx,z+dz])
 }
 assert.ok(reached,'a connected capsule-clear route reaches the shower')
 const replaced=new Set(models.flatMap(m=>m.replaces))
 assert.ok(furnitureColliders({...app,furniture:items,models}).every(c=>!replaced.has(c.id)),'no ghost boxes from replaced fixtures')
})

test('water heaters clear the shower hardware and exposed round bulbs are absent',()=>{
 assert.ok(!app.furniture.some(b=>b.sourceIds.some(id=>/^bulb(?:-holder)?$/.test(id))))
 let heaters=0
 for(const heater of app.furniture.filter(b=>b.sourceIds.includes('water-heater'))){
  heaters++
  const kind=app.specifications.find(s=>s.roomId===heater.roomId).finishes.waterHeater.kind
  assert.equal(heater.shape,kind==='instant'?'box':'cyl')
  for(const part of app.furniture.filter(b=>b.roomId===heater.roomId&&b.sourceIds.some(id=>/-shower-(?:head|arm|riser|mixer)$/.test(id))))
   assert.ok(!heater.position.every((v,i)=>Math.abs(v-part.position[i])<(heater.size[i]+part.size[i])/2+.1),'heater must not surround the shower head or riser')
 }
 assert.ok(heaters>0)
})


test('removed enclosure is absent from specifications and legacy partitions do not hide other glass',async()=>{
 const {specsCatalogue}=await import('../src/lib/cost/catalogue.ts')
 const {hideBathroomPartitions}=await import('../src/lib/three/bathroomPartitions.ts')
 const {Group,Object3D}=await import('three')
 assert.ok(!specsCatalogue.items.some(i=>i.id==='bath-enclosure'))
 const root=new Group()
 const names=['sharedBath1-shower-glass','selected-shower-enclosure','enclosure-post-1','Bathroom_Window_Glass','shower-head']
 for(const name of names){const o=new Object3D();o.name=name;root.add(o)}
 hideBathroomPartitions(root)
 assert.deepEqual(root.children.map(o=>o.visible),[false,false,false,true,true])
})


test('shared and attached bathrooms retain toilets and separate basins across generated layouts',async()=>{
 const {defaultBrief}=await import('../src/lib/model/brief.ts')
 const {compile}=await import('../src/lib/model/canonical.ts')
 const {generate}=await import('../src/lib/engine/generate.ts')
 const {furnishSingleRoom}=await import('../src/lib/three/buildDollhouse.ts')
 let checked=0
 for(const seed of [1,3,7,11]){
  const brief=defaultBrief();brief.site.plotWidth=16;brief.site.plotDepth=22
  const design=generate(compile(brief),{seed}),original=JSON.stringify(design)
  for(const floor of design.floors)for(const room of floor.rooms.filter(r=>/bath|toilet/i.test(r.id+' '+r.name))){
   const fixtures=furnishSingleRoom(design,floor.level,room.id)
   const wc=fixtures.find(f=>f.id.endsWith('-wc')),basin=fixtures.find(f=>f.id.endsWith('-vanity'))
   assert.ok(wc,room.id+' must contain a toilet');assert.ok(basin,room.id+' must contain a basin')
   const gapX=Math.max(0,Math.abs(wc.pos[0]-basin.pos[0])-(wc.size[0]+basin.size[0])/2)
   const gapZ=Math.max(0,Math.abs(wc.pos[2]-basin.pos[2])-(wc.size[2]+basin.size[2])/2)
   assert.ok(Math.hypot(gapX,gapZ)>=.249,room.id+' needs 250 mm clear between fixtures')
   assert.deepEqual(fixtures,furnishSingleRoom(design,floor.level,room.id))
   checked++
  }
  assert.equal(JSON.stringify(design),original)
 }
 assert.ok(checked>=12)
})
