import test from 'node:test'
import assert from 'node:assert/strict'
import {registerHooks} from 'node:module'
import {defaultBrief} from '../src/lib/model/brief.ts'
registerHooks({resolve(s,c,next){return s.startsWith('@/')?{url:new URL(`../src/${s.slice(2)}`,import.meta.url).href,shortCircuit:true}:next(s,c)}})
const storage=new Map()
globalThis.localStorage={getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)}
globalThis.window={localStorage:globalThis.localStorage}
const {useStudio,computeDirections,parsePinned,serializePinned}=await import('../src/state/studio.ts')
const {useBlender}=await import('../src/state/blender.ts')
useBlender.setState({selectDirection:()=>{}})
test('Directions selection persists the composition and replays its exact geometry after result cache is cleared',()=>{
 const brief=defaultBrief();brief.site.plotWidth=25;brief.site.plotDepth=30
 const start=performance.now(),output=computeDirections({...useStudio.getState(),brief,pinned:null,recentVillaFingerprints:[]})
 console.log('modern planning ms',Math.round(performance.now()-start),'cards',output.dirs.map(d=>d.label))
 assert.equal(output.dirs.length,4,output.notice??JSON.stringify(output.debug))
 useStudio.setState({brief,directions:output.dirs,pinned:null,result:null,existing:null,layout:null})
 for(const d of output.dirs){
  const result=useStudio.getState().pin({massing:d.massing,seed:d.seed,planSeed:d.planSeed})
  assert.deepEqual(result.design.floors,d.design.floors)
  assert.equal(useStudio.getState().brief.style.composition,d.design.model.brief.style.composition)
  const pin=parsePinned(serializePinned(useStudio.getState().pinned))
  useStudio.setState({pinned:pin,result:null})
  const restored=useStudio.getState().run()
  assert.deepEqual(restored.design.floors,d.design.floors)
  assert.equal(restored.buildingModel.planId,d.buildingModel.planId)
 }
 const rediscovered=computeDirections({...useStudio.getState(),recentVillaFingerprints:[]})
 assert.equal(rediscovered.dirs.length,4,'A saved pin must not remove another composition with the same family/seed')
 assert.equal(new Set(rediscovered.dirs.map(d=>d.planFingerprint.key)).size,4)
})
