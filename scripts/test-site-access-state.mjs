import test from 'node:test'
import assert from 'node:assert/strict'
import {registerHooks} from 'node:module'
registerHooks({resolve(specifier,context,nextResolve){if(specifier.startsWith('@/'))return{url:new URL(`../src/${specifier.slice(2)}`,import.meta.url).href,shortCircuit:true};return nextResolve(specifier,context)}})
const storage=new Map();globalThis.localStorage={getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)};globalThis.window={localStorage:globalThis.localStorage}
const {defaultBrief}=await import('../src/lib/model/brief.ts')
const {useStudio}=await import('../src/state/studio.ts')
const {useProjects,parseCore,applyCore}=await import('../src/state/projects.ts')

test('height and entry-ramp edits preserve the pinned direction/layout and update the shared building instead of replanning rooms',()=>{
 const brief=defaultBrief();brief.site.plotWidth=22;brief.site.plotDepth=28
 useStudio.setState({brief,result:null,pinned:null,layout:null,existing:null});useStudio.getState().run()
 const before=useStudio.getState(),plan=before.result.design,geometry=JSON.stringify(plan.floors.map(({structuralSizing,...f})=>f)),planId=before.result.buildingModel.planId
 const pinned={seed:plan.dna.seed,massing:plan.massingType},layout={version:1,floors:[]}
 useStudio.setState({pinned,layout})
 useStudio.getState().edit(b=>{b.specs.overrides['plinth-height']='raised'})
 const raised=useStudio.getState()
 assert.equal(raised.pinned,pinned);assert.equal(raised.layout,layout);assert.equal(raised.result.buildingModel.structuralSizing.plinthHeightMm,600)
 assert.notEqual(raised.result.buildingModel.planId,planId);assert.equal(raised.result.design.dna.seed,plan.dna.seed)
 assert.equal(raised.brief.entry.accessIdentity.planId,planId);assert.equal(raised.result.buildingModel.exteriorSeedPlanId,planId)
 assert.equal(JSON.stringify(raised.result.design.floors.map(({structuralSizing,...f})=>f)),geometry)
 assert.equal(raised.result.design.floors[0].structuralSizing.plinthHeightMm,600)
 useStudio.getState().edit(b=>{b.entry.ramp=true})
 const ramp=useStudio.getState();assert.ok(ramp.result.buildingModel.entryRamp);assert.equal(ramp.pinned,pinned);assert.equal(ramp.layout,layout)
 const building=ramp.result.buildingModel
 useStudio.getState().edit(b=>{b.site.ventilation={version:1,direction:'E',speed:1,doorsOpen:true}})
 assert.equal(useStudio.getState().result.buildingModel,building);assert.equal(useStudio.getState().result.design,ramp.result.design)
})
test('project save/reload retains air direction, ramp choice and the same height setting',()=>{
 useProjects.setState({items:[],currentId:null,stage:'concept'})
 // Save a normal source layout, not the deliberately minimal edit sentinel.
 useStudio.setState({layout:null,pinned:null})
 const saved=useProjects.getState().save({name:'Raised accessible home'});assert.ok(saved)
 const core=parseCore(JSON.parse(JSON.stringify(saved.core)));assert.ok(core)
 applyCore(core)
 const restored=useStudio.getState().brief
 assert.equal(restored.entry.ramp,true);assert.equal(restored.specs.overrides['plinth-height'],'raised');assert.equal(restored.site.ventilation.direction,'E')
 assert.ok(restored.entry.accessIdentity?.planId)
})
