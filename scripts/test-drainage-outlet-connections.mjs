import test from 'node:test'
import assert from 'node:assert/strict'
import {fixtureWasteConnection} from '../src/lib/water/fixtureDrainage.ts'
import {pipeCrossesStructure} from '../src/lib/plumbing/villaPlumbing.ts'

test('every waste outlet reaches its branch with axis-aligned legs even for an offset bath outlet',()=>{
 for(const kind of ['toilet','washbasin','shower','bathtub','floor_drain','washing_machine','kitchen_sink']){
  const f={kind,point:{x:1000,y:1500,z:3000},branch:{points:[{x:1300,y:1800,z:2700}]}}
  const path=fixtureWasteConnection(f)
  assert.deepEqual(path.at(-1),f.branch.points[0])
  for(let i=1;i<path.length;i++)assert.ok(['x','y','z'].filter(a=>Math.abs(path[i][a]-path[i-1][a])>.01).length<=1,kind)
 }
})
test('a declared slab sleeve is restricted to proposals and never bypasses columns',()=>{
 const floor={id:'GF',name:'Ground',level:0,elevationMm:0,heightMm:3000,slabThicknessMm:150,footprint:[{x:0,y:0,w:5000,h:5000}]}
 const building={floors:[floor],shafts:[],walls:[],columns:[],beams:[]}
 const path=[{x:2000,y:2000,z:2500},{x:2000,y:2000,z:4000}]
 assert.match(pipeCrossesStructure(building,path,55),/roof slab/)
 assert.equal(pipeCrossesStructure(building,path,55,{slabSleeves:true}),null)
 building.columns.push({floorId:'GF',id:'C',at:{x:2000,y:2000},size:400})
 assert.match(pipeCrossesStructure(building,path,55,{slabSleeves:true}),/column/)
})
import {readFile} from 'node:fs/promises'
import {defaultBrief} from '../src/lib/model/brief.ts'
import {createBuildingModel} from '../src/lib/engine/buildingModel.ts'
import {projectPipelines} from '../src/lib/water/projectPipelines.ts'
import {fixtureTankTrace} from '../src/lib/water/fixtureDrainage.ts'
test('the reported tight bathroom shaft clears the actual column envelope and every fixture reaches the tank',async()=>{
 const design=JSON.parse(await readFile(new URL('./fixtures/drainage-tight-shaft.json',import.meta.url),'utf8'))
 const building=createBuildingModel(design),before=JSON.stringify(building)
 const p=projectPipelines(design,building,defaultBrief(),null,undefined,{getItem:()=>null})
 assert.equal(p.drainNetwork.pendingStacks.length,0)
 assert.ok(p.fixtureScene.fixtures.some(f=>f.roomId==='bath2'))
 for(const fixture of p.fixtureScene.fixtures){
  assert.ok(fixture.branch?.connected,fixture.key)
  assert.ok(fixtureTankTrace(fixture,p.drainNetwork,p.drainage.tank.inlet).length,fixture.key)
 }
 assert.equal(JSON.stringify(building),before)
})
