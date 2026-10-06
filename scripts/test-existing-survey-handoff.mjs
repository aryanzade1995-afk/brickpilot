import test from 'node:test'
import assert from 'node:assert/strict'
import {registerHooks} from 'node:module'
import {defaultAnswers} from '../src/lib/existing/types.ts'
import {briefFromAnswers} from '../src/lib/existing/plan.ts'
import {compile} from '../src/lib/model/canonical.ts'
import {generateExisting} from '../src/lib/engine/generateExisting.ts'
import {createBlenderInput} from './export-blender-input.mjs'
registerHooks({resolve(specifier,context,next){return specifier.startsWith('@/')?{url:new URL(`../src/${specifier.slice(2)}`,import.meta.url).href,shortCircuit:true}:next(specifier,context)}})
const storage=new Map()
globalThis.localStorage={getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)}
globalThis.window={localStorage:globalThis.localStorage}
const {useStudio}=await import('../src/state/studio.ts')
test('confirmed drawing continues into 3D, cost and saved replay with identical source geometry',()=>{
  const answers={...defaultAnswers(),plotWidthM:22,plotDepthM:22,storeysWanted:1,bedroomsWithBath:1,bedroomsNoBath:1,sharedBaths:1,utility:false,parking:false}
  const brief=briefFromAnswers(answers)
  const originalStructure={columns:[0,7500].flatMap(y=>[0,5000,10000,15000].map(x=>({id:`C${x}-${y}`,at:{x,y},size:230}))),footings:[],walls:[],beams:[],storeysBuilt:1}
  const source=generateExisting(compile(brief),originalStructure).design.floors[0]
  const structure={columns:source.columns.filter(c=>c.state==='LOCKED').map(c=>({id:c.id,at:c.at,size:c.size})),footings:[],walls:source.walls.map(w=>({id:w.id,a:w.a,b:w.b,thickness:w.thickness})),beams:[],storeysBuilt:1,measuredPlan:{rooms:source.rooms,walls:source.walls,openings:source.openings,heightM:3.1,stairStartSide:source.stair.startSide??'S'}}
  useStudio.getState().loadExisting(brief,structure,1)
  const result=useStudio.getState().run()
  assert.ok(result.report.hardChecksPass)
  assert.ok(result.buildingModel,'the normal 3D BuildingModel was assembled')
  assert.deepEqual(result.design.floors[0].rooms.map(r=>r.rect),source.rooms.map(r=>r.rect))
  assert.deepEqual(result.design.floors[0].openings,source.openings)
  assert.ok(result.cost.expected>0)
  const blender=createBlenderInput(result.design)
  assert.ok(blender,'the normal Blender input can be produced')
  useStudio.getState().loadSaved(brief,null,null,JSON.parse(JSON.stringify({structure,seed:1})))
  const replay=useStudio.getState().run()
  assert.deepEqual(replay.design.floors[0].rooms.map(r=>r.rect),source.rooms.map(r=>r.rect))
  assert.deepEqual(replay.design.floors[0].openings,source.openings)
})
