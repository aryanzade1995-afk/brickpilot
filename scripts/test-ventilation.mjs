import test from 'node:test'
import assert from 'node:assert/strict'
import {AIR_SIDES,ventilationPaths} from '../src/lib/utilities/ventilation.ts'
import {defaultBrief,briefSchema,geometryBrief} from '../src/lib/model/brief.ts'
import {compile} from '../src/lib/model/canonical.ts'
import {airWispRoute,airOverviewPose} from '../src/lib/utilities/airVisual.ts'
import {PerspectiveCamera,Vector3} from 'three'

function house(){
 const room={id:'living',floorId:'GF',name:'Living',rect:{x:1000,y:1000,w:6000,h:6000},outdoor:false}
 return {floors:[{id:'GF',name:'Ground',elevationMm:0}],rooms:[room],columns:[],shafts:[],doors:[],windows:[
  {id:'n',floorId:'GF',orient:'h',at:{x:4000,y:1000},sill:900,head:2200,rooms:['living',null]},
  {id:'s',floorId:'GF',orient:'h',at:{x:4000,y:7000},sill:900,head:2200,rooms:['living',null]},
  {id:'w',floorId:'GF',orient:'v',at:{x:1000,y:4000},sill:900,head:2200,rooms:['living',null]},
  {id:'e',floorId:'GF',orient:'v',at:{x:7000,y:4000},sill:900,head:2200,rooms:['living',null]},
 ]}
}
test('four real inlet/outlet sides use the exact floor/window coordinates and source geometry stays unchanged',()=>{
 const b=house(),before=JSON.stringify(b)
 for(const side of AIR_SIDES){const scenario=ventilationPaths(b,side);assert.equal(scenario.paths.length,1);const p=scenario.paths[0];assert.deepEqual(p.points[0],{...b.windows.find(w=>w.id===p.inletId).at,z:1150});assert.deepEqual(p.points.at(-1),{...b.windows.find(w=>w.id===p.outletId).at,z:1150});assert.equal(scenario.reviews.length,0);assert.deepEqual(scenario,ventilationPaths(b,side))}
 assert.equal(JSON.stringify(b),before)
})
test('air follows actual inter-room doorways; a closed or missing doorway never becomes a passage',()=>{
 const b=house();b.rooms=[{...b.rooms[0],rect:{x:1000,y:1000,w:6000,h:3000}},{...b.rooms[0],id:'back',name:'Back',rect:{x:1000,y:4000,w:6000,h:3000}}]
 b.windows=b.windows.filter(w=>['n','s'].includes(w.id));b.windows[1].rooms=['back',null]
 assert.equal(ventilationPaths(b,'N').paths.length,0)
 b.doors=[{id:'door',floorId:'GF',at:{x:5500,y:4000},rooms:['living','back']}]
 assert.equal(ventilationPaths(b,'N',false).paths.length,0)
 const path=ventilationPaths(b,'N',true).paths[0]
 assert.ok(path.points.some(p=>p.x===5500&&p.y===4000));assert.deepEqual(path.roomIds,['living','back'])
})
test('column/shaft detours stay in the room, and a completely blocked window remains a review state',()=>{
 const b=house();b.columns=[{floorId:'GF',at:{x:4000,y:4000},size:900}]
 const p=ventilationPaths(b,'N').paths[0];assert.ok(p.points.length>2)
 for(const q of p.points)assert.ok(q.x>=1000&&q.x<=7000&&q.y>=1000&&q.y<=7000)
 b.shafts=[{floorId:'GF',rect:{x:1000,y:3300,w:6000,h:1400}}]
 assert.equal(ventilationPaths(b,'N').paths.length,0);assert.ok(ventilationPaths(b,'N').reviews.length)
})
test('missing windows, opposite openings or floor connections produce no fabricated paths',()=>{
 const b=house();b.windows=b.windows.filter(w=>w.id==='n')
 assert.equal(ventilationPaths(b,'N').paths.length,0);assert.ok(ventilationPaths(b,'E').reviews.length)
 b.floors.push({id:'FF',name:'Upper',elevationMm:3100});b.windows.push({...b.windows[0],id:'upper',floorId:'FF',at:{x:4000,y:7000}})
 assert.equal(ventilationPaths(b,'N').paths.length,0)
})
test('optional air settings round trip in Brief but never change architectural identity or the compiled plan hash',()=>{
 const brief=defaultBrief(),before=JSON.stringify(geometryBrief(brief)),seed=compile(brief).seed
 brief.site.ventilation={version:1,direction:'cycle',speed:1.5,doorsOpen:false}
 const restored=briefSchema.parse(JSON.parse(JSON.stringify(brief)))
 assert.deepEqual(restored.site.ventilation,brief.site.ventilation);assert.equal(JSON.stringify(geometryBrief(restored)),before);assert.equal(compile(restored).seed,seed)
 assert.equal(briefSchema.safeParse({...brief,site:{...brief.site,ventilation:{...brief.site.ventilation,speed:Infinity}}}).success,false)
 assert.equal(defaultBrief().site.ventilation,undefined)
})
test('soft-wisp sampling preserves actual opening endpoints and floor height, is finite and deterministic',()=>{
 const b=house();b.columns=[{floorId:'GF',at:{x:4000,y:4000},size:900}]
 const path=ventilationPaths(b,'N').paths[0],before=JSON.stringify(path),r=airWispRoute(path)
 assert.equal(r.points.length,192);assert.ok(r.length>0);assert.ok(r.points.flat().every(Number.isFinite))
 assert.deepEqual(r.points[0],[4,1.15,-1]);assert.deepEqual(r.points.at(-1),[4,1.15,-7]);assert.deepEqual(r,airWispRoute(path));assert.equal(JSON.stringify(path),before)
 assert.equal(airWispRoute({...path,points:[path.points[0],path.points[0]]}),null)
})
test('the airflow overview fits the actual house on narrow mobile and desktop canvases',()=>{
 const b=house();b.floors[0]={...b.floors[0],heightMm:3100,footprint:[b.rooms[0].rect]}
 for(const aspect of[.55,1,1.6,2]){const pose=airOverviewPose(b,40,aspect),camera=new PerspectiveCamera(40,aspect,.01,1000);camera.position.copy(pose.position);camera.lookAt(pose.target);camera.updateMatrixWorld(true)
  for(const x of[1,7])for(const y of[0,3.1])for(const z of[-1,-7]){const projected=new Vector3(x,y,z).project(camera);assert.ok(Math.abs(projected.x)<1&&Math.abs(projected.y)<1)}
 }
})
