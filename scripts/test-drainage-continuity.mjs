import test from 'node:test'
import assert from 'node:assert/strict'
import {defaultBrief} from '../src/lib/model/brief.ts'
import {compile} from '../src/lib/model/canonical.ts'
import {generate} from '../src/lib/engine/generate.ts'
import {createBuildingModel} from '../src/lib/engine/buildingModel.ts'
import {utilityFloor} from '../src/lib/utilities/plan.ts'
import {resolveDrainageFloor} from '../src/lib/utilities/sharedDrainage.ts'
import {defaultDrainageInputs} from '../src/lib/utilities/drainageInputs.ts'
import {emptyPlanning} from '../src/lib/utilities/planning.ts'
import {createVillaPlumbing} from '../src/lib/plumbing/villaPlumbing.ts'
import {proposeDrainStorage} from '../src/lib/water/drainageStorage.ts'
import {connectedDrainageNetwork} from '../src/lib/water/drainageNetwork.ts'
import {fixtureDrainageScene,fixtureTankTrace} from '../src/lib/water/fixtureDrainage.ts'
import {coordinateDrainageContinuity,pointOnDrainSegment} from '../src/lib/water/drainageContinuity.ts'

function house(seed=41){
 const brief=defaultBrief();brief.site.plotWidth=22;brief.site.plotDepth=28
 const design=generate(compile(brief),{seed}),building=createBuildingModel(design)
 const home=createVillaPlumbing(building,{waterMm:25,soilMm:110,wasteMm:75}),storage=proposeDrainStorage(building,home),network=connectedDrainageNetwork(building,home,storage)
 const floors=design.floors.map(f=>resolveDrainageFloor(utilityFloor(design,f.level),defaultDrainageInputs(),emptyPlanning()).model)
 const scene=fixtureDrainageScene(floors,building,home,network,brief)
 return {building,home,storage,network,scene,floors}
}
const world=house()
const coordinated=coordinateDrainageContinuity(world.building,world.home,world.storage,world.scene)
const same=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z)<.01

test('every source fixture reaches the tank in representative two-floor coordination proposals',()=>{
 for(const seed of [31,41,72]){
  const h=house(seed),c=coordinateDrainageContinuity(h.building,h.home,h.storage,h.scene)
  assert.ok(c.scene.fixtures.length>10);assert.equal(c.network.pendingStacks.length,0)
  for(const f of c.scene.fixtures){
   assert.ok(f.branch?.connected,f.id);assert.equal(f.branch.blocked,false)
   const route=fixtureTankTrace(f,c.network,h.storage.tank.inlet)
   assert.ok(route.length,f.id);assert.ok(same(route[0][0],f.branch.points.at(-1)))
   for(let i=1;i<route.length;i++)assert.ok(same(route[i-1].at(-1),route[i][0]),`${f.id}: disconnected trace port`)
   assert.ok(same(route.at(-1).at(-1),h.storage.tank.inlet))
  }
 }
})
test('unknown branch levels fall into the underfloor band, and stacks extend downward instead of lifting wastewater',()=>{
 for(const f of coordinated.scene.fixtures){
  const b=f.branch,floor=world.building.floors.find(p=>p.id===f.floorId)
  assert.ok(b.points.every(p=>p.z<floor.elevationMm))
  assert.equal(b.levelsKnown,false);assert.equal(b.proposalReview,true)
  assert.ok(coordinated.network.layout.segments.some(s=>pointOnDrainSegment(b.points.at(-1),s.from,s.to)))
 }
 const extra=coordinated.network.layout.pipes.filter(p=>p.id.startsWith('drain:extension:'))
 assert.ok(extra.length);assert.ok(extra.every(p=>p.points[0].z>p.points.at(-1).z))
})
test('an orphan upper stack uses an external bypass with an explicit new wall sleeve review',()=>{
 assert.ok(world.network.pendingStacks.length)
 const bypass=coordinated.network.layout.pipes.find(p=>p.id.startsWith('drain:bypass:'))
 assert.ok(bypass);assert.ok(bypass.points.some((p,i)=>i&&p.x===bypass.points[i-1].x&&p.y===bypass.points[i-1].y&&p.z<bypass.points[i-1].z))
 assert.ok(coordinated.openings.some(o=>o.kind==='wall-sleeve'))
 assert.ok(coordinated.openings.filter(o=>o.kind==='fixture-drop').length===coordinated.scene.fixtures.length)
 for(const p of bypass.points)assert.ok(p.x>0&&p.x<world.building.plot.widthMm&&p.y>0&&p.y<world.building.plot.depthMm)
})
test('building, saved plan XY, original fixtures and product quantities are never modified',()=>{
 const before=JSON.stringify(world),again=coordinateDrainageContinuity(world.building,world.home,world.storage,world.scene)
 assert.equal(JSON.stringify(world),before);assert.deepEqual(again,coordinated)
 for(const f of again.scene.fixtures){
  const original=world.scene.fixtures.find(q=>q.key===f.key)
  assert.deepEqual(f.point,original.point)
  const xy=ps=>ps.map(({x,y})=>({x,y})).filter((p,i,all)=>!i||p.x!==all[i-1].x||p.y!==all[i-1].y)
  assert.deepEqual(xy(f.branch.points),xy(original.branch.points))
 }
})
test('entered invert levels are preserved and a branch below the tank inlet is rejected, not lifted',()=>{
 const input=structuredClone(world.scene),f=input.fixtures[0]
 f.branch.levelsKnown=true;f.branch.points=f.branch.points.map(p=>({...p,z:world.storage.tank.inlet.z-200}))
 const c=coordinateDrainageContinuity(world.building,world.home,world.storage,input),out=c.scene.fixtures[0]
 assert.deepEqual(out.branch.points,f.branch.points);assert.equal(out.branch.connected,false);assert.equal(out.branch.blocked,true)
 assert.match(out.branch.reason,/cannot fall/)
})
test('actual columns remain blocking; a proposal never punches through one to achieve a green status',()=>{
 const building=structuredClone(world.building),upper=world.scene.fixtures.find(f=>f.level===1)
 const a=upper.branch.points[0],b=upper.branch.points[1]
 building.columns.push({id:'protected-column',floorId:building.floors[0].id,at:{x:(a.x+b.x)/2,y:(a.y+b.y)/2},size:400})
 const c=coordinateDrainageContinuity(building,world.home,world.storage,world.scene),f=c.scene.fixtures.find(f=>f.key===upper.key)
 assert.equal(f.branch.connected,false);assert.equal(f.branch.blocked,true);assert.match(f.branch.reason,/column/)
})
test('a configured discharge, an absent tank or an offset user stack does not acquire an invented tank connection',()=>{
 const input=structuredClone(world.scene);input.configuredDischarge=true
 assert.ok(coordinateDrainageContinuity(world.building,world.home,world.storage,input).scene.fixtures.every(f=>!f.branch?.connected))
 const absent={...world.storage,tank:null,layout:{...world.storage.layout,pipes:[],segments:[]}}
 assert.ok(coordinateDrainageContinuity(world.building,world.home,absent,world.scene).scene.fixtures.every(f=>!f.branch?.connected))
 const edited=structuredClone(world.scene);edited.fixtures[0].branch.stackAligned=false;edited.fixtures[0].branch.connected=false
 assert.equal(coordinateDrainageContinuity(world.building,world.home,world.storage,edited).scene.fixtures[0].branch.connected,false)
})
