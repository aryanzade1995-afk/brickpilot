import test from 'node:test'
import assert from 'node:assert/strict'
import {defaultBrief} from '../src/lib/model/brief.ts'
import {compile} from '../src/lib/model/canonical.ts'
import {generate} from '../src/lib/engine/generate.ts'
import {frontYard} from '../src/lib/engine/planner/index.ts'
import {PARKING_HOUSE_GAP} from '../src/lib/engine/planner/program.ts'
import {placeSiteFeatures} from '../src/lib/engine/planner/siteFeatures.ts'
import {createBuildingModel} from '../src/lib/engine/buildingModel.ts'

const separate=(a,b)=>a.x>=b.x+b.w+PARKING_HOUSE_GAP||a.x+a.w<=b.x-PARKING_HOUSE_GAP||
  a.y>=b.y+b.h+PARKING_HOUSE_GAP||a.y+a.h<=b.y-PARKING_HOUSE_GAP

test('generated parking is detached and BuildingModel preserves the same bay',()=>{
  for(const massing of ['stepped','twin-wing','courtyard-ring']){
    const b=defaultBrief();b.site.plotWidth=22;b.site.plotDepth=30
    const plan=generate(compile(b),{seed:41,massing}),floor=plan.floors[0]
    const parking=floor.rooms.find(r=>r.id==='parking')
    assert.ok(parking,`${massing} retains covered parking`)
    assert.ok(parking.rect.w>=3000&&parking.rect.h>=5000)
    for(const room of floor.rooms.filter(r=>!r.outdoor))assert.ok(separate(parking.rect,room.rect),`${massing}: ${room.id}`)
    assert.deepEqual(createBuildingModel(plan).rooms.find(r=>r.id==='parking').rect,parking.rect)
    assert.deepEqual(plan.siteFeatures.find(f=>f.kind==='parking').rect,parking.rect)
  }
})

test('a site with no detached bay does not squeeze a car bay against the house',()=>{
  const house={x:0,y:0,w:6000,h:6000},rooms=[{id:'living',outdoor:false,rect:house}]
  const site={plot:{x:0,y:0,w:6000,h:11000},envelope:{x:0,y:0,w:6000,h:11000},houseZone:house,frontStripMm:5000}
  frontYard(rooms,[{id:'parking',kind:'parking',targetSqm:15}],house,site,false,false,(s,rect)=>({...s,rect,outdoor:true}))
  assert.equal(rooms.length,1)
})

test('uncovered parking also keeps its separation instead of accepting an attached saved bay',()=>{
  const b=defaultBrief();b.site.plotWidth=20;b.site.plotDepth=25
  const model=compile(b),ground={rooms:[{id:'living',outdoor:false,rect:{x:4000,y:4000,w:8000,h:8000}}],openings:[]}
  const saved={x:4000,y:12000,w:3000,h:5000},before=JSON.stringify(ground)
  const result=placeSiteFeatures(model,ground,{parking:saved})
  const parking=result.features.find(f=>f.kind==='parking')
  assert.ok(parking);assert.ok(separate(parking.rect,ground.rooms[0].rect))
  assert.equal(JSON.stringify(ground),before)
})
