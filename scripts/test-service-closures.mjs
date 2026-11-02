import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createBuildingModel} from '../src/lib/engine/buildingModel.ts'
import {bathroomServiceCovers,roofServiceClosures} from '../src/lib/walkthrough/serviceCovers.ts'

const p=JSON.parse(readFileSync(new URL('./fixtures/walkthrough-room-regression.json',import.meta.url)))
test('shaft/perimeter slots receive only vertical casings; courtyards and stair access remain unfilled',()=>{
 const b=createBuildingModel(p),top=b.floors.at(-1)
 const edge=top.outline
 b.shafts.push({id:'edge-shaft',roomId:'test',floorId:top.id,rect:{x:edge.x+600,y:edge.y,w:450,h:450}})
 const expected=JSON.stringify(b),closures=roofServiceClosures(b)
 assert.ok(closures.some(c=>c.sourceId==='edge-shaft'))
 assert.ok(closures.every(c=>c.boundsMm.h===900&&Math.min(c.boundsMm.w,c.boundsMm.d)<=150))
 assert.equal(JSON.stringify(b),expected)
})
test('all indoor room service openings get flush covers, clipped to the room and protected voids',()=>{
 const b=createBuildingModel(p),k=b.rooms.find(r=>r.id==='kitchen'),floor=b.floors.find(f=>f.id===k.floorId)
 b.shafts=[{id:'edge',floorId:k.floorId,roomId:k.id,rect:{x:k.rect.x-100,y:k.rect.y+100,w:400,h:400}}]
 const covers=bathroomServiceCovers(b,k,'k','selected-kitchen-floor')
 assert.equal(covers.length,1);assert.equal(covers[0].size[0],.3)
 assert.equal(covers[0].binding,'selected-kitchen-floor')
 assert.ok(Math.abs(covers[0].position[1]+covers[0].size[1]/2-floor.elevationMm/1000-.002)<1e-8)
 floor.courtyard={x:k.rect.x,y:k.rect.y,w:500,h:600}
 assert.equal(bathroomServiceCovers(b,k,'k','floor').length,0)
})
