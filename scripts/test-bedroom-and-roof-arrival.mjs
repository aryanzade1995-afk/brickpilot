import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {createBuildingModel} from '../src/lib/engine/buildingModel.ts'
import {roomFurnishing} from '../src/lib/interior/preview.ts'
import {createWalkthroughSource} from '../src/lib/walkthrough/source.ts'
import {buildWalkthroughScene} from '../src/lib/walkthrough/scene.ts'
import {prepareWalkthroughGeometry,prepareWalkthroughAppearance} from '../src/lib/walkthrough/delivery.ts'
import {roofAccess} from '../src/lib/walkthrough/openingAssemblies.ts'

const plan=JSON.parse(fs.readFileSync(new URL('./fixtures/walkthrough-room-regression.json',import.meta.url)))
const building=createBuildingModel(plan),before=JSON.stringify(plan)
const source=createWalkthroughSource(plan,{hardChecksPass:true},{style:'modern',lighting:'daylight',furnitureDensity:'medium'})
const geometry=prepareWalkthroughGeometry(buildWalkthroughScene(source.building,{hardChecksPass:true}))
const app=prepareWalkthroughAppearance(plan,source,geometry)

test('the supplied bed is used in adult bedrooms and the old bed is restricted to child/teen rooms',()=>{
 const beds=app.models.filter(m=>['bed','bedroom-essentials-bed'].includes(m.assetId))
 assert.equal(beds.length,3)
 for(const model of beds){
  const room=source.rooms.find(r=>r.key===model.roomId),original=building.rooms.find(r=>r.floorId===room.floorId&&r.id===room.sourceRoomId)
  assert.equal(model.assetId,/child|teen|kid/i.test(original.name)?'bed':'bedroom-essentials-bed')
  assert.ok(model.replaces.length>0)
 }
 assert.equal(JSON.stringify(plan),before)
})

test('the empty bedroom and balcony lounge receive furniture without intersecting source columns or door swings',()=>{
 for(const [id,types] of [['bed3',['bed','nightstand','rug']],['familyLounge',['sofa','tv','coffee-table','rug','armchair']]]){
  const result=roomFurnishing(plan,1,id,'medium',building,true)
  for(const type of types)assert.ok(result.pieces.some(p=>p.type===type),id+': '+type)
  for(const p of result.pieces.filter(p=>!['rug','curtain','art','pendant','tv','table-lamp'].includes(p.type))){
   const [w,d]=['N','S'].includes(p.face)?[p.w,p.d]:[p.d,p.w]
   for(const c of result.architecture.boxes.filter(c=>c.id.startsWith('column')))
    assert.ok(!(Math.abs(p.x-c.pos[0])<(w+c.size[0])/2-.001&&Math.abs(p.z-c.pos[2])<(d+c.size[2])/2-.001),`${id}: ${p.id} column`)
   for(const door of result.architecture.openings.filter(o=>o.kind!=='window')){
    const horizontal=['N','S'].includes(door.side),along=horizontal?p.x:p.z,half=horizontal?w/2:d/2
    const edge=door.side==='N'?p.z-d/2+result.dims.d/2:door.side==='S'?result.dims.d/2-p.z-d/2:door.side==='W'?p.x-w/2+result.dims.w/2:result.dims.w/2-p.x-w/2
    assert.ok(!(Math.abs(along-door.alongM)<half+door.widthM/2&&edge<.8),`${id}: ${p.id} doorway`)
   }
  }
 }
})

test('terrace door is a single normal-width aperture aligned only to the arriving flight',()=>{
 const access=roofAccess(building),a=access.opening.apertureMm
 const floor=building.floors.at(-1),stair=building.stairs.find(s=>s.floorId===floor.id)
 const horizontal=['N','S'].includes(access.side),lo=horizontal?stair.rect.x:stair.rect.y,size=horizontal?stair.rect.w:stair.rect.h
 const start=horizontal?a.x:a.y,width=horizontal?a.w:a.d
 assert.ok(width>=750&&width<=1000)
 assert.ok(start>=lo+size/2,'descending-flight half is not a door')
 const wallAtOtherHalf=access.walls.some(w=>{
  const b=w.boundsMm,along=horizontal?b.x:b.y,length=horizontal?b.w:b.d
  return b.z===a.z&&along<=lo+size*.25&&along+length>=lo+size*.25
 })
 assert.ok(wallAtOtherHalf,'the other flight has a full-height wall')
 assert.equal(roofAccess({...building,stairs:building.stairs.map(s=>({...s,treads:[]}))}),null,'missing flight data is not invented')
 assert.equal(JSON.stringify(plan),before)
})
