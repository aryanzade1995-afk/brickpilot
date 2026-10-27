import test from 'node:test'
import assert from 'node:assert/strict'
import {defaultBrief} from '../src/lib/model/brief.ts'
import {compile} from '../src/lib/model/canonical.ts'
import {generate} from '../src/lib/engine/generate.ts'
import {createBuildingModel} from '../src/lib/engine/buildingModel.ts'
import {utilityFloor} from '../src/lib/utilities/plan.ts'
import {defaultDrainageInputs} from '../src/lib/utilities/drainageInputs.ts'
import {emptyPlanning} from '../src/lib/utilities/planning.ts'
import {resolveDrainageFloor,readDrainageDrawing,publishDrainage} from '../src/lib/utilities/sharedDrainage.ts'
import {createVillaPlumbing} from '../src/lib/plumbing/villaPlumbing.ts'
import {proposeDrainStorage} from '../src/lib/water/drainageStorage.ts'
import {connectedDrainageNetwork} from '../src/lib/water/drainageNetwork.ts'
import {fixtureDrainageScene,fixtureTankTrace} from '../src/lib/water/fixtureDrainage.ts'

const brief=defaultBrief();brief.site.plotWidth=22;brief.site.plotDepth=28
const design=generate(compile(brief),{seed:41}),building=createBuildingModel(design)
const home=createVillaPlumbing(building,{waterMm:25,soilMm:110,wasteMm:75}),storage=proposeDrainStorage(building,home),network=connectedDrainageNetwork(building,home,storage)
const sources=design.floors.map(f=>utilityFloor(design,f.level,brief))
const resolve=(source,input=defaultDrainageInputs())=>resolveDrainageFloor(source,input,emptyPlanning()).model
const floors=sources.map(s=>resolve(s)),scene=fixtureDrainageScene(floors,building,home,network,brief)

test('all-floor fixtures and branch XY are the same records as the resolved 2D design, without architecture changes',()=>{
 const before=JSON.stringify({design,building,sources,home})
 const again=fixtureDrainageScene(sources.map(s=>resolve(s)),building,home,network,brief)
 assert.equal(again.fixtures.length,floors.reduce((n,f)=>n+f.drainageDesign.fixtures.length,0));assert.ok(again.fixtures.length>10)
 for(const f of again.fixtures){
  const plan=floors.find(p=>p.floor.level===f.level)
  assert.deepEqual({x:f.point.x,y:f.point.y},plan.drainageDesign.fixtures.find(p=>p.id===f.id).position)
  if(f.branch){const pipe=plan.drainageDesign.pipes.find(p=>p.id===f.branch.id);assert.deepEqual(f.branch.points.slice(0,pipe.path.length).map(({x,y})=>({x,y})),pipe.path);assert.equal(f.branch.blocked,pipe.state==='blocked')}
 }
 assert.equal(JSON.stringify({design,building,sources,home}),before)
 assert.deepEqual(again,scene)
})
test('default room stacks bind actual shaft centres; explicit user stack positions are not moved',()=>{
 const floor=floors[0],stack=floor.symbols.find(s=>s.layer==='drainage'),shaft=floor.floor.shafts.find(s=>s.roomId===stack.roomIds[0])
 assert.deepEqual(stack.position,{x:shaft.rect.x+shaft.rect.w*.6,y:shaft.rect.y+shaft.rect.h*.5})
 const source=sources[0],old=source.symbols.find(s=>s.layer==='drainage'),input=defaultDrainageInputs()
 input.stackBases[old.id]={position:{x:123,y:456},invertMm:null}
 assert.deepEqual(resolve(source,input).symbols.find(s=>s.id===old.id).position,old.position)
 assert.deepEqual(resolve(source,input).drainageDesign.nodes.find(n=>n.id===`${old.id}:base`).position,{x:123,y:456})
})
test('saved inputs reload per project and floor; manual fixtures and real invert fall are preserved',()=>{
 const source=sources[0],f=scene.fixtures.find(f=>f.level===0&&f.branch),input=defaultDrainageInputs(),room=source.floor.rooms.find(r=>r.id===f.roomId)
 input.datum='Survey BM';input.floorElevationMm=10000
 input.pipes[f.branch.id]={diameterMm:50,gradientRatio:60,inletInvertMm:9800,outletInvertMm:null}
 input.fixtures.push({id:'manual-basin',roomId:room.id,kind:'washbasin',position:{x:room.rect.x+room.rect.w/2,y:room.rect.y+room.rect.h/2}})
 const saved=new Map([[`formstead.drainage-inputs.v1:projectA:floor:0`,JSON.stringify(input)]])
 const a=readDrainageDrawing('projectA:floor:0',source,{getItem:k=>saved.get(k)??null})
 const b=readDrainageDrawing('projectB:floor:0',source,{getItem:k=>saved.get(k)??null})
 assert.equal(b.drainage.datum,'');assert.equal(a.drainage.datum,'Survey BM')
 const loaded=resolve(a.model,a.drainage),restored=fixtureDrainageScene([loaded],building,home,network,brief)
 assert.ok(restored.fixtures.some(f=>f.id==='manual-basin'))
 const actual=restored.fixtures.find(p=>p.id===f.id).branch
 assert.equal(actual.levelsKnown,true);assert.equal(actual.points[0].z,-175)
 assert.ok(actual.points.at(-1).z<actual.points[0].z)
 assert.equal(actual.diameterMm,50)
})
test('unknown sizes/levels remain illustrative; blocked or disconnected branches cannot trace to the tank',()=>{
 for(const fixture of scene.fixtures){
  if(fixture.branch){assert.equal(fixture.branch.levelsKnown,false);assert.ok(fixture.issues.some(s=>s.includes('illustrative')))}
  const trace=fixtureTankTrace(fixture,network,storage.tank?.inlet)
  if(!fixture.branch?.connected)assert.equal(trace.length,0)
  else {assert.ok(trace.length>1);assert.ok(trace.flat().some(p=>JSON.stringify(p)===JSON.stringify(storage.tank.inlet)))}
 }
 assert.ok(scene.fixtures.some(f=>f.branch?.blocked));assert.ok(scene.fixtures.some(f=>f.branch?.connected))
})
test('mismatched imported architecture is rejected; model coordinates use GLB negative plan-Y',()=>{
 const source=structuredClone(sources[0]);source.floor.rooms[0].rect.x+=100
 publishDrainage('imported-scope',source,defaultDrainageInputs(),emptyPlanning())
 assert.equal(readDrainageDrawing('imported-scope',sources[0]).compatible,false)
 assert.equal(fixtureDrainageScene([resolve(source)],building,home,network,brief).fixtures.length,0)
 for(const f of scene.fixtures.filter(f=>f.model)){assert.equal(f.model.position[0],f.point.x/1000);assert.equal(f.model.position[2],-f.point.y/1000);assert.ok(f.model.scale.every(n=>n>0));assert.equal(f.point.z,building.floors.find(p=>p.id===f.floorId).elevationMm)}
})
test('an explicit saved discharge appears at the exact 2D positions and cannot inherit the separate tank connection',()=>{
 const source=sources[0],input=defaultDrainageInputs()
 input.outlet={kind:'sewer',position:{x:21000,y:27000},invertMm:null,approvalReference:''}
 input.inspectionChamber={x:20500,y:26000}
 const plan=resolve(source,input),view=fixtureDrainageScene([plan],building,home,network,brief)
 assert.equal(view.configuredDischarge,true)
 assert.deepEqual(view.destinations.find(n=>n.name.startsWith('sewer')).point,{x:21000,y:27000,z:-650})
 for(const item of view.collectors){const pipe=plan.drainageDesign.pipes.find(p=>item.id.endsWith(p.id));assert.deepEqual(item.points.map(({x,y})=>({x,y})),pipe.path);assert.equal(item.blocked,pipe.state==='blocked');assert.equal(item.levelsKnown,false)}
 assert.ok(view.fixtures.every(f=>!f.branch?.connected));assert.ok(view.issues.some(i=>i.includes('replace the separate tank')))
})
test('live drawing edits override stale storage, with separate keys for repeated manual IDs on different floors',()=>{
 const source=sources[0],input=defaultDrainageInputs();input.city='Pune'
 publishDrainage('live-A',source,input,emptyPlanning())
 assert.equal(readDrainageDrawing('live-A',source,{getItem:()=>null}).drainage.city,'Pune')
 assert.equal(readDrainageDrawing('live-B',source,{getItem:()=>null}).drainage.city,'')
 const repeated=sources.map(s=>{const i=defaultDrainageInputs(),room=s.floor.rooms.find(r=>/bath/i.test(r.name));i.fixtures.push({id:'manual-extra-drain',kind:'floor_drain',roomId:room.id,position:{x:room.rect.x+room.rect.w/2,y:room.rect.y+room.rect.h/2}});return resolve(s,i)})
 const matches=fixtureDrainageScene(repeated,building,home,network,brief).fixtures.filter(f=>f.id==='manual-extra-drain')
 assert.equal(matches.length,2);assert.notEqual(matches[0].key,matches[1].key)
})
