import test from 'node:test'
import assert from 'node:assert/strict'
import {defaultBrief} from '../src/lib/model/brief.ts'
import {compile} from '../src/lib/model/canonical.ts'
import {generate} from '../src/lib/engine/generate.ts'
import {createBuildingModel} from '../src/lib/engine/buildingModel.ts'
import {placeBalcony} from '../src/lib/engine/planner/index.ts'
import {PARKING_HOUSE_GAP} from '../src/lib/engine/planner/program.ts'
import {placeSiteFeatures} from '../src/lib/engine/planner/siteFeatures.ts'
import {layoutProgramme} from '../src/lib/engine/planner/layoutChoices.ts'

test('new villas omit verandahs and driveway while retaining parking and connected balconies',()=>{
  for(const massing of ['stepped','twin-wing','courtyard-ring']){
    const brief=defaultBrief();brief.site.plotWidth=22;brief.site.plotDepth=30
    brief.rooms.priorities.coveredVerandah=true // A legacy saved preference must not reintroduce it.
    const before=JSON.stringify(brief),plan=generate(compile(brief),{seed:41,massing})
    assert.equal(JSON.stringify(brief),before)
    assert.ok(!plan.floors.flatMap(f=>f.rooms).some(r=>r.id.startsWith('verandah')))
    assert.ok(!plan.siteFeatures.some(f=>f.kind==='driveway'))
    const parking=plan.floors[0].rooms.find(r=>r.id==='parking').rect
    for(const balcony of plan.floors.slice(1).flatMap(f=>f.rooms.filter(r=>r.id.startsWith('balcony')))){
      const b=balcony.rect
      assert.ok(!(b.x<parking.x+parking.w&&b.x+b.w>parking.x&&b.y<parking.y+parking.h&&b.y+b.h>parking.y))
    }
    const building=createBuildingModel(plan)
    assert.ok(!building.rooms.some(r=>r.id.startsWith('verandah')))
    assert.ok(!building.siteFeatures.some(f=>f.kind==='driveway'))
    const restored=placeSiteFeatures(plan.model,plan.floors[0],{driveway:{x:0,y:0,w:3000,h:5000}})
    assert.ok(!restored.features.some(f=>f.kind==='driveway'))
  }
})

test('front balcony faces detached parking without physically overlapping its roof',()=>{
  const rect={x:4000,y:4000,w:5000,h:5000},room={id:'bed1',rect,area:25,outdoor:false}
  const site={plot:{x:0,y:0,w:18000,h:18000},envelope:{x:0,y:0,w:18000,h:18000}}
  const parking={x:4000,y:9900,w:5000,h:5000}
  const b=placeBalcony([room],rect,site,()=> 'bed',[],false,[parking])
  assert.ok(b)
  // This deliberately close bay prevents an overlap; a front balcony needs a larger gap.
  assert.ok(!(b.x<parking.x+parking.w&&b.x+b.w>parking.x&&b.y<parking.y+parking.h&&b.y+b.h>parking.y))
  const frontParking={...parking,y:9000+PARKING_HOUSE_GAP}
  const front=placeBalcony([room],rect,site,()=> 'bed',[],false,[frontParking])
  assert.equal(front.y,9000)
  assert.ok(front.y+front.h<=frontParking.y)
})

test('legacy wrap recipes cannot add covered verandahs and are not mutated',()=>{
  const model=compile(defaultBrief()),choices={living:'front',stair:'side',master:'upper',kitchen:'garden',verandah:'wrap',doubleHeight:false}
  const before=JSON.stringify(choices),programme=layoutProgramme(model,choices)
  assert.equal(JSON.stringify(choices),before)
  assert.ok(!programme.floors[0].spaces.some(s=>s.id.startsWith('verandah')))
})
