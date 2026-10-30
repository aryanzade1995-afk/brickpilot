import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {roomFurnishing} from '../src/lib/interior/preview.ts'
import {createBuildingModel} from '../src/lib/engine/buildingModel.ts'
import {createWalkthroughSource} from '../src/lib/walkthrough/source.ts'
import {buildWalkthroughScene} from '../src/lib/walkthrough/scene.ts'
import {prepareWalkthroughGeometry,prepareWalkthroughAppearance,furnitureColliders} from '../src/lib/walkthrough/delivery.ts'
import {bathroomServiceCovers} from '../src/lib/walkthrough/serviceCovers.ts'

const plan=JSON.parse(fs.readFileSync(new URL('./fixtures/walkthrough-room-regression.json',import.meta.url)))
const building=createBuildingModel(plan),before=JSON.stringify(plan)
const preferences={style:'modern',lighting:'daylight',furnitureDensity:'medium'}
const source=createWalkthroughSource(plan,{hardChecksPass:true},preferences)
const geometry=prepareWalkthroughGeometry(buildWalkthroughScene(source.building,{hardChecksPass:true}))
const app=prepareWalkthroughAppearance(plan,source,geometry)

test('the screenshot living room gets a TV, sofa, rug and chairs without blocking its doorways',()=>{
 const result=roomFurnishing(plan,0,'living','medium',building,true)
 for(const type of ['tv','tv-unit','sofa','rug','armchair'])assert.ok(result.pieces.some(p=>p.type===type),type)
 for(const p of result.pieces.filter(p=>!['rug','curtain','art','pendant','tv'].includes(p.type))){
  const [w,d]=['N','S'].includes(p.face)?[p.w,p.d]:[p.d,p.w]
  for(const door of result.architecture.openings.filter(o=>o.kind!=='window')){
   const along=['N','S'].includes(door.side)?p.x:p.z,half=['N','S'].includes(door.side)?w/2:d/2
   const edge=door.side==='N'?p.z-d/2+result.dims.d/2:door.side==='S'?result.dims.d/2-p.z-d/2:door.side==='W'?p.x-w/2+result.dims.w/2:result.dims.w/2-p.x-w/2
   assert.ok(!(Math.abs(along-door.alongM)<half+door.widthM/2&&edge<.8),`${p.id}: ${door.id}`)
  }
 }
 const living=source.rooms.find(r=>r.sourceRoomId==='living'&&r.floorId===building.floors[0].id)
 assert.ok(app.models.some(m=>m.roomId===living.key&&m.assetId==='user-sofa'))
 assert.ok(app.furniture.some(p=>p.roomId===living.key&&p.sourceIds.some(id=>id.includes('rug'))))
 assert.equal(JSON.stringify(plan),before)
})

test('six-place dining uses a 2.1 x 1 m table and the imported top fits that same envelope',()=>{
 const result=roomFurnishing(plan,0,'dining','medium',building,true),table=result.pieces.find(p=>p.type==='dining-table')
 assert.equal(Math.max(table.w,table.d),2.1);assert.equal(Math.min(table.w,table.d),1)
 assert.equal(result.pieces.filter(p=>p.type==='dining-chair').length,6)
 const dining=source.rooms.find(r=>r.sourceRoomId==='dining'&&r.floorId===building.floors[0].id)
 const model=app.models.find(m=>m.roomId===dining.key&&m.assetId==='dining-table')
 assert.ok(Math.max(model.size[0],model.size[2])>=2.09)
 assert.ok(Math.min(model.size[0],model.size[2])>=.99)
 assert.ok(Math.abs(model.size[1]-.75)<.001,'table height excludes tabletop decorations')
})

test('bathroom toilets are side-on to the entry and every basin retains its floor support',()=>{
 for(const floor of plan.floors)for(const room of floor.rooms.filter(r=>/sharedBath|ensuite|bath/i.test(r.id)&&!r.outdoor)){
  const result=roomFurnishing(plan,floor.level,room.id,'medium',building,true),wc=result.furniture.find(p=>p.id.endsWith('-wc'))
  assert.ok(wc,`${room.id}: WC remains placed`)
  const alongX=wc.size[0]>wc.size[2]
  const side=alongX?(wc.pos[0]<0?'W':'E'):(wc.pos[2]<0?'N':'S')
  const opposite={N:'S',S:'N',E:'W',W:'E'}
  for(const door of result.architecture.openings.filter(o=>o.kind!=='window'))assert.notEqual(side,opposite[door.side],room.id)
 }
 const basins=app.models.filter(m=>m.assetId==='user-bathroom-basin')
 assert.ok(basins.length)
 for(const basin of basins){
  assert.ok(!basin.replaces.some(id=>id.includes('basin-pedestal')))
  assert.ok(app.furniture.some(p=>p.roomId===basin.roomId&&p.sourceIds.some(id=>id.endsWith('basin-pedestal'))))
  const floor=building.floors.find(f=>f.id===basin.floorId)
  assert.ok(basin.position[1]>=floor.elevationMm/1000+.65)
 }
})

test('bathroom shafts receive level removable covers and walking colliders without erasing shaft geometry',()=>{
 const covers=app.furniture.filter(p=>p.id.startsWith('shaft-access-cover:'))
 assert.ok(covers.length>=2)
 for(const cover of covers){
  const shaft=building.shafts.find(s=>cover.sourceIds.includes(s.id)),floor=building.floors.find(f=>f.id===cover.floorId)
  assert.deepEqual([cover.size[0],cover.size[2]],[shaft.rect.w/1000,shaft.rect.h/1000])
  assert.ok(Math.abs(cover.position[1]+cover.size[1]/2-floor.elevationMm/1000-.002)<1e-8)
  assert.ok(furnitureColliders(app).some(c=>c.id===cover.id))
 }
 assert.deepEqual(createBuildingModel(plan).shafts,building.shafts)
 const kitchen=building.rooms.find(r=>r.id==='kitchen')
 assert.deepEqual(bathroomServiceCovers(building,kitchen,'kitchen','floor'),[])
})
