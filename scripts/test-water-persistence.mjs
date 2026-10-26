import test from 'node:test'
import assert from 'node:assert/strict'
import {registerHooks} from 'node:module'
registerHooks({resolve(specifier,context,nextResolve){if(specifier.startsWith('@/'))return {url:new URL(`../src/${specifier.slice(2)}`,import.meta.url).href,shortCircuit:true};return nextResolve(specifier,context)}})
const storage=new Map();globalThis.localStorage={getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)}
globalThis.window={localStorage:globalThis.localStorage}
const {emptyWaterConfig}=await import('../src/lib/water/schema.ts')
const {newWaterComponent}=await import('../src/lib/water/roof.ts')
const {SIMPLE_WATER_DEFAULTS}=await import('../src/lib/water/simpleSystem.ts')
const {defaultBrief}=await import('../src/lib/model/brief.ts')
const {useWaterIntelligence}=await import('../src/state/waterIntelligence.ts')
const {useProjects,parseCore,applyCore}=await import('../src/state/projects.ts')
const {useStudio}=await import('../src/state/studio.ts')
function system(){
  const config=emptyWaterConfig('plan-1','roof-1'),kinds=['catchment','gutter','downpipe','first_flush','filter','tank','overflow','recharge']
  config.components=kinds.map((kind,i)=>({...newWaterComponent(kind,kind),positionM:[1,8-i,2]}))
  config.components.find(n=>n.kind==='first_flush').diversionLitres=10
  config.components.find(n=>n.kind==='filter').efficiency=.9
  Object.assign(config.components.find(n=>n.kind==='tank'),{tankCapacityLitres:500,initialStorageLitres:0})
  config.components.find(n=>n.kind==='recharge').destinationApproved=true
  config.connections=kinds.slice(1).map((to,i)=>({id:`c${i}`,from:kinds[i],to,kind:i>=5?'overflow':'collection',viaM:[],routingBasis:'concept-user-route'}))
  config.catchments=[{id:'roof-area',componentId:'catchment',surfaceId:'roof',areaM2:100,areaBasis:'measured',runoffCoefficient:.8,collectionEfficiency:.9,note:'Measured projected catchment; factors user-provided.'}]
  config.demands=[{tankId:'tank',dailyLitres:100,basis:'user-provided'}]
  config.scenarios=[{id:'rain',name:'Rain then dry',basis:'user-provided',source:'Test scenario',days:[{date:'2026-10-01',rainfallMm:10,eventStart:true},{date:'2026-10-02',rainfallMm:0,eventStart:false}]}]
  config.simple={...SIMPLE_WATER_DEFAULTS,rainwater:true,tankLitres:'2000',rainfallMm:10}
  return config
}
test('project save, reload, switching, duplicate and version restore retain water independently from architecture',()=>{
  useProjects.setState({items:[],currentId:null,stage:'concept'})
  useStudio.setState({brief:defaultBrief(),result:null,pinned:null,layout:null,existing:null});useStudio.getState().run()
  const first=system();assert.equal(useWaterIntelligence.getState().update(first),true)
  const before=useStudio.getState(),project=useProjects.getState().save({name:'Water home'})
  assert.ok(project);assert.deepEqual(project.core.waterIntelligence,first)
  assert.equal(useStudio.getState().result,before.result);assert.equal(useStudio.getState().pinned,before.pinned)
  const restored=parseCore(JSON.parse(JSON.stringify(project.core)));applyCore(restored)
  assert.deepEqual(useWaterIntelligence.getState().document,first)
  const second=system();second.components.find(n=>n.kind==='tank').tankCapacityLitres=2000
  useWaterIntelligence.getState().update(second);useProjects.getState().save({label:'Bigger tank'})
  const updated=useProjects.getState().items.find(p=>p.id===project.id)
  const original=updated.versions.find(v=>v.core.waterIntelligence.components.find(n=>n.kind==='tank').tankCapacityLitres===500)
  assert.ok(original);assert.equal(useProjects.getState().restore(project.id,original.id),true)
  assert.equal(useWaterIntelligence.getState().document.components.find(n=>n.kind==='tank').tankCapacityLitres,500)
  const duplicate=useProjects.getState().duplicate(project.id);assert.ok(duplicate)
  useProjects.getState().startNew();assert.equal(useWaterIntelligence.getState().document,null)
  useProjects.getState().open(duplicate);assert.deepEqual(useWaterIntelligence.getState().document,first)
  const legacy={...project.core};delete legacy.waterIntelligence;applyCore(parseCore(legacy));assert.equal(useWaterIntelligence.getState().document,null)
  const prior=useWaterIntelligence.getState().document;assert.equal(useWaterIntelligence.getState().update({version:99}),false);assert.equal(useWaterIntelligence.getState().document,prior)
})

test('working water document restores from browser persistence after reload',async()=>{
  const c=system();useWaterIntelligence.getState().update(c)
  const raw=storage.get('formstead.water-intelligence.v1');assert.ok(raw)
  useWaterIntelligence.setState({document:null})
  storage.set('formstead.water-intelligence.v1',raw)
  await useWaterIntelligence.persist.rehydrate()
  assert.deepEqual(useWaterIntelligence.getState().document,c)
})
test('full browser storage reports a save failure rather than claiming successful persistence',()=>{
  const write=globalThis.localStorage.setItem
  try {globalThis.localStorage.setItem=()=>{throw new Error('Quota exceeded')}
    assert.equal(useWaterIntelligence.getState().update(system()),false)
    assert.match(useWaterIntelligence.getState().error,/storage.*full/i)
  } finally {globalThis.localStorage.setItem=write}
  assert.equal(useWaterIntelligence.getState().update(system()),true)
})
