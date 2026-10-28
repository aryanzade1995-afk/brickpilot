import test from 'node:test'
import assert from 'node:assert/strict'
import {AIR_SIDES,ventilationPaths} from '../src/lib/utilities/ventilation.ts'
import {defaultBrief,briefSchema,geometryBrief} from '../src/lib/model/brief.ts'
import {compile} from '../src/lib/model/canonical.ts'
import {airWispRoute,airOverviewPose} from '../src/lib/utilities/airVisual.ts'
import {PerspectiveCamera,Vector3} from 'three'
import {explodedAirPaths,explodedAirPoint} from '../src/lib/utilities/explodedAir.ts'

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

test('corridor turns have broad tangent-continuous bends without spline overshoot',()=>{
 const path={points:[{x:0,y:0,z:1000},{x:3000,y:0,z:1000},{x:3000,y:3000,z:1000}]}
 const sampled=airWispRoute(path,384),points=sampled.points.map(p=>new Vector3(...p))
 let maxAngle=0
 for(let i=1;i<points.length-1;i++)maxAngle=Math.max(maxAngle,points[i].clone().sub(points[i-1]).angleTo(points[i+1].clone().sub(points[i])))
 assert.ok(maxAngle<.15,`abrupt turn: ${maxAngle}`)
 assert.ok(points.every(p=>p.x>=0&&p.x<=3&&p.z>=-3&&p.z<=0))
 assert.ok(Math.min(...points.map(p=>p.distanceTo(new Vector3(3,1,0))))>.09,'bend is wider than the old sharp elbow')
})

test('high bathroom windows ease down inside the room and remain level through the opening',()=>{
 const b=house();b.plot={widthMm:10000,depthMm:12000};b.floors[0].level=0
 b.windows[0].sill=1800;b.windows[0].head=2600
 const doll={floors:[{level:0,baseY:.35}]},source=ventilationPaths(b,'N').paths
 const path=explodedAirPaths(b,doll,source).paths[0],profile=path.visualHeight
 const r=airWispRoute(path,1001,(p,path)=>explodedAirPoint(b,doll,p,path))
 const at=Math.round(profile.entryMm/profile.lengthMm*1000)
 assert.ok(Math.abs(r.points[at][1]-2.4)<1e-8)
 assert.ok(Math.abs(r.points[at+1][1]-r.points[at][1])<.00002,'no sudden downward kink at the window')
 assert.ok(r.points.every(p=>p[1]>=1.1-1e-8&&p[1]<=2.4+1e-8))
 assert.ok(r.points.some(p=>p[1]<1.11),'air reaches room level')
 assert.ok(profile.dropMm>1500,'high-window descent uses room space instead of a 500 mm drop')
})

test('exploded airflow uses the furnished floor bases and centred plan axes without changing source geometry',()=>{
 const b=house();b.plot={widthMm:10000,depthMm:12000};b.floors[0].level=0
 b.floors.push({id:'FF',name:'Upper',level:1,elevationMm:4000})
 b.rooms.push({...b.rooms[0],floorId:'FF'})
 b.windows.push(...b.windows.slice(0,2).map(w=>({...w,id:`upper-${w.id}`,floorId:'FF'})))
 const doll={floors:[{level:0,baseY:.35},{level:1,baseY:3.66}]}
 const paths=ventilationPaths(b,'N').paths,before=JSON.stringify({b,doll,paths})
 const shown=explodedAirPaths(b,doll,paths)
 assert.equal(shown.paths.length,2);assert.equal(shown.ports.length,4)
 const upper=paths.find(p=>p.floorId==='FF')
 const point=explodedAirPoint(b,doll,upper.points[0],upper)
 assert.equal(point[0],-1);assert.equal(point[2],-5);assert.ok(Math.abs(point[1]-4.81)<1e-9)
 assert.deepEqual(shown.paths[0].points[1],paths[0].points[0])
 assert.deepEqual(shown.paths[0].points.at(-2),paths[0].points.at(-1))
 assert.ok(shown.paths[0].points.slice(2,-2).every(p=>p.z===750),'room-level airflow is below the cut walls')
 assert.equal(shown.paths[0].points[0].y,paths[0].points[0].y-2000)
 assert.equal(shown.paths[0].points.at(-1).y,paths[0].points.at(-1).y+2000)
 assert.ok(shown.ports.every(p=>p.label.includes('window')))
 const sampled=airWispRoute(shown.paths[1],192,(p,path)=>explodedAirPoint(b,doll,p,path))
 assert.ok(sampled.points.flat().every(Number.isFinite));assert.ok(Math.abs(sampled.points[0][1]-4.81)<1e-9)
 assert.equal(JSON.stringify({b,doll,paths}),before)
 assert.equal(explodedAirPaths(b,{floors:[]},paths).paths.length,0)
 const isolated=explodedAirPaths(b,{floors:[{level:1,baseY:.35}]},paths)
 assert.equal(isolated.paths.length,1);assert.equal(isolated.paths[0].floorId,'FF')
 assert.ok(isolated.ports.every(p=>Math.abs(p.position[1]-1.5)<1e-9),'isolated upper-floor paths follow its furnished base, not global elevation')
 assert.throws(()=>explodedAirPoint(b,{floors:[]},upper.points[0],upper),/No furnished floor/)
})
