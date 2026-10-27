import test from 'node:test'
import assert from 'node:assert/strict'
import {defaultBrief} from '../src/lib/model/brief.ts'
import {compile} from '../src/lib/model/canonical.ts'
import {generate} from '../src/lib/engine/generate.ts'
import {createBuildingModel} from '../src/lib/engine/buildingModel.ts'
import {createVillaPlumbing} from '../src/lib/plumbing/villaPlumbing.ts'
import {utilityFloor} from '../src/lib/utilities/plan.ts'
import {coordinateSupply,supplyFixtureTrace,concealedWaterPath} from '../src/lib/water/supplyContinuity.ts'
import {pipeConnectionParts} from '../src/lib/water/pipeConnections.ts'

function setup(seed=41){const brief=defaultBrief();brief.site.plotWidth=22;brief.site.plotDepth=28;const design=generate(compile(brief),{seed}),building=createBuildingModel(design),home=createVillaPlumbing(building,{waterMm:25,soilMm:110,wasteMm:75},[],1,true),floors=design.floors.map(f=>utilityFloor(design,f.level,brief));return {design,building,home,floors}}
const h=setup(),s=coordinateSupply(h.building,h.home,h.floors)
const same=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z)<.02

test('tank manifold, risers, indoor horizontal/vertical branches and every actual cold fixture form one network',()=>{
 for(const seed of [1,2,3]){
  const h=setup(seed),s=coordinateSupply(h.building,h.home,h.floors)
  const expected=h.floors.flatMap(f=>f.fixtures.filter(f=>f.type!=='floor_drain'))
  assert.equal(s.fixtures.length,expected.length);assert.equal(s.pendingLayout.pipes.length,0)
  for(const f of s.fixtures){assert.equal(f.connected,true,f.id);const trace=supplyFixtureTrace(s,f);assert.ok(trace.length);assert.ok(s.roots.some(r=>same(r,trace[0][0])));assert.ok(same(trace.at(-1).at(-1),f.point));for(let i=1;i<trace.length;i++)assert.ok(same(trace[i-1].at(-1),trace[i][0]))}
  assert.ok(s.layout.pipes.some(p=>p.id.startsWith('water:external-feed:')))
  assert.ok(s.layout.pipes.some(p=>p.id.startsWith('water:drawing:')))
  assert.ok(s.layout.segments.some(p=>p.from.z===p.to.z));assert.ok(s.layout.segments.some(p=>p.from.x===p.to.x&&p.from.y===p.to.y&&p.from.z!==p.to.z))
 }
})
test('concealed route coordinates use actual wall centre planes, keep units/floors and retain selected source geometry',()=>{
 const before=JSON.stringify(h),again=coordinateSupply(h.building,h.home,h.floors)
 assert.equal(JSON.stringify(h),before);assert.deepEqual(again,s)
 for(const p of s.layout.pipes)for(let i=1;i<p.points.length;i++)assert.ok(['x','y','z'].filter(axis=>Math.abs(p.points[i][axis]-p.points[i-1][axis])>.01).length<=1,p.id)
 const model=h.floors[0],wall=model.floor.walls.find(w=>w.a.y===w.b.y),point={x:(wall.a.x+wall.b.x)/2,y:wall.a.y+wall.thickness/2+35,z:600}
 const simple={...model,floor:{...model.floor,columns:[],walls:[wall]}}
 assert.equal(concealedWaterPath([point],simple)[0].y,wall.a.y)
 assert.ok(s.layout.pipes.filter(p=>p.id.startsWith('water:drawing:FF')).every(p=>p.points.every(p=>p.z>h.building.floors[1].elevationMm-300)))
})
test('missing roof tank cannot become a fabricated supply; alternative hot water is never joined to cold tanks',()=>{
 const noTank={...h.home,tankPorts:[],pipes:h.home.pipes.filter(p=>!p.id.startsWith('tank-port:')&&!p.id.startsWith('tank-manifold')&&!p.id.startsWith('supply:'))}
 const missing=coordinateSupply(h.building,noTank,h.floors)
 assert.ok(missing.fixtures.every(f=>!f.connected));assert.equal(missing.layout.pipes.length,0);assert.ok(missing.pendingLayout.pipes.length)
 assert.ok(s.layout.pipes.every(p=>!p.id.includes(':HW')))
 assert.ok(!s.fixtures.some(p=>p.id.includes('floor-drain')))
})
test('all visible socket collars sit on actual pipe legs, and shared legs have one fitting instance',()=>{
 const parts=pipeConnectionParts(s.layout.pipes,s.layout.segments)
 assert.ok(parts.length>20);assert.equal(new Set(parts.map(p=>p.id)).size,parts.length)
 assert.ok(parts.every(p=>[p.point.x,p.point.y,p.point.z,p.lengthMm,p.diameterMm].every(Number.isFinite)&&p.lengthMm>0&&p.diameterMm>0))
 const pipe={system:'water',diameterMm:25,points:[{x:0,y:0,z:0},{x:1000,y:0,z:0},{x:1000,y:1000,z:0}]}
 assert.deepEqual(pipeConnectionParts([pipe,pipe]),pipeConnectionParts([pipe]))
 const elbow=pipeConnectionParts([pipe]).filter(p=>p.kind==='socket');assert.equal(elbow.length,2)
 assert.ok(elbow.every(p=>p.point.x===1000||p.point.y===0))
 const tee=pipeConnectionParts([{system:'drain',diameterMm:110,points:[{x:0,y:0,z:1000},{x:0,y:0,z:0},{x:1000,y:0,z:0}]},{system:'drain',diameterMm:50,points:[{x:0,y:1000,z:0},{x:0,y:0,z:0}]}])
 assert.equal(tee.filter(p=>p.kind==='socket').length,3)
})

test('a missing connection in a source drawing remains a clear review state rather than a fabricated wall route',()=>{
 const h=setup(41),s=coordinateSupply(h.building,h.home,h.floors)
 const missing=h.floors.flatMap(f=>f.waterNetworks.filter(n=>n.service==='cold').flatMap(n=>n.unroutedFixtures))
 assert.ok(missing.length)
 for(const id of missing){assert.equal(s.fixtures.find(f=>f.id===id).connected,false);assert.ok(s.issues.some(issue=>issue.includes(id)))}
})
