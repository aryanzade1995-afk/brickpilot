import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {defaultBrief} from '../src/lib/model/brief.ts'
import {createBuildingModel} from '../src/lib/engine/buildingModel.ts'
import {projectPipelines} from '../src/lib/water/projectPipelines.ts'
import {projectDrainageLayout} from '../src/lib/water/projectDrainageLayout.ts'
import {fixtureWasteConnection} from '../src/lib/water/fixtureDrainage.ts'
import {createPlumbingGroup} from '../src/lib/plumbing/pipeGeometry.ts'
const plan=JSON.parse(await readFile(new URL('./fixtures/drainage-tight-shaft.json',import.meta.url),'utf8'))
const model=createBuildingModel(plan),network=projectPipelines(plan,model,defaultBrief(),null,undefined,{getItem:()=>null})
test('Massing assembles every connected fixture and exact outlet with main stacks once',()=>{
 const before=JSON.stringify(network),layout=projectDrainageLayout(network)
 for(const f of network.fixtureScene.fixtures){
  assert.deepEqual(layout.pipes.find(p=>p.id===`fixture-branch:${f.key}`).points,f.branch.points)
  assert.deepEqual(layout.pipes.find(p=>p.id===`fixture-outlet:${f.key}`).points,fixtureWasteConnection(f))
 }
 assert.equal(new Set(layout.pipes.map(p=>p.id)).size,layout.pipes.length)
 assert.equal(JSON.stringify(network),before)
 assert.ok(layout.assembly.tubes.length);assert.ok(layout.assembly.fittings.length)
 const group=createPlumbingGroup(layout);assert.equal(group.userData.source_plan_id,network.planId)
 assert.ok(group.children.every(p=>p.geometry.attributes.position.array.every(Number.isFinite)))
})
test('Massing preserves surveyed pipe fall and refreshes only the live pipe identity',()=>{
 const edited=structuredClone(network),f=edited.fixtureScene.fixtures[0]
 f.branch.points[1].z-=20
 const layout=projectDrainageLayout(edited),original=projectDrainageLayout(network)
 const a=f.branch.points[0],b=f.branch.points[1]
 assert.ok(layout.assembly.tubes.some(p=>JSON.stringify(p.from)===JSON.stringify(a)&&JSON.stringify(p.to)===JSON.stringify(b)))
 assert.notEqual(layout.signature,original.signature)
 assert.equal(layout.planId,original.planId)
})
test('unresolved fixture routes do not become connected Massing pipes',()=>{
 const edited=structuredClone(network),f=edited.fixtureScene.fixtures[0];f.branch.connected=false
 assert.ok(!projectDrainageLayout(edited).pipes.some(p=>p.id===`fixture-branch:${f.key}`))
})
