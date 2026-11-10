import test from 'node:test'
import assert from 'node:assert/strict'
import {defaultBrief,parseStoredBrief} from '../src/lib/model/brief.ts'
import {compile} from '../src/lib/model/canonical.ts'
import {generate} from '../src/lib/engine/generate.ts'
import {furnishSingleRoom} from '../src/lib/three/buildDollhouse.ts'

test('zero bathroom requests still allocate one complete shared bathroom',()=>{
 for(const storeys of [0,1,2]){const brief=defaultBrief();brief.levels.storeys=storeys;brief.rooms.bedroomsWithBath=0;brief.rooms.sharedBaths=0
  const model=compile(brief);assert.ok(model.floors[0].spaces.some(s=>s.id==='sharedBath1'))
 }
})
test('separate choice creates two independent wet rooms and persists',()=>{
 const brief=defaultBrief();brief.site.plotWidth=25;brief.site.plotDepth=30;brief.rooms.bedroomsWithBath=0;brief.rooms.sharedBaths=0;brief.rooms.bathroomLayout='separate'
 const model=compile(brief),spaces=model.floors.flatMap(f=>f.spaces)
 assert.ok(spaces.some(s=>s.name==='Bathing room only'));assert.ok(spaces.some(s=>s.id.endsWith('ToiletOnly')))
 assert.equal(parseStoredBrief(JSON.parse(JSON.stringify(brief))).data.rooms.bathroomLayout,'separate')
 const plan=generate(model,{seed:41})
 let wc=0,shower=0
 for(const floor of plan.floors)for(const room of floor.rooms){const parts=furnishSingleRoom(plan,floor.level,room.id)
  if(room.id.endsWith('ToiletOnly')){assert.ok(parts.some(p=>p.id.endsWith('-wc')));assert.ok(!parts.some(p=>p.id.endsWith('-shower-tray')));wc++}
  if(room.name==='Bathing room only'){assert.ok(parts.some(p=>p.id.endsWith('-shower-tray')));assert.ok(!parts.some(p=>p.id.endsWith('-wc')));shower++}
 }
 assert.ok(wc>0&&shower>0,'both required rooms survive plan generation')
})
