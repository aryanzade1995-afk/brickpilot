import test,{after} from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { fileURLToPath } from 'node:url'
import { briefSchema,defaultBrief,geometryBrief } from '../src/lib/model/brief.ts'
import { compile } from '../src/lib/model/canonical.ts'
import { generate } from '../src/lib/engine/generate.ts'
import { resolveSpecification,resolveSpecifications,specsCatalogue } from '../src/lib/cost/catalogue.ts'
import { selectionFromBrief,writeSelectionToBrief } from '../src/lib/cost/briefSelections.ts'
import { defaultSelection } from '../src/lib/cost/specifications.ts'
import { estimateCost } from '../src/lib/cost/index.ts'
const b=defaultBrief(),design=generate(compile(b))

test('old projects acquire Mid and empty overrides, retaining every geometry field and their legacy seed',()=>{
 const old=geometryBrief(b),loaded=briefSchema.parse({...old,budget:{target:1000}})
 assert.equal(loaded.finish,'mid');assert.deepEqual(loaded.specs.overrides,{})
 assert.deepEqual(geometryBrief(loaded),old);assert.ok(!('budget' in loaded))
 const {autoExtras:_autoExtras,...project}=old.project
 const text=JSON.stringify({...old,project,variation:0});let hash=0x811c9dc5
 for(let i=0;i<text.length;i++)hash=Math.imul(hash^text.charCodeAt(i),0x01000193)
 assert.equal(compile(loaded).seed,`${(hash>>>0).toString(16).padStart(8,'0')}-${loaded.variation}`)
 const saved=briefSchema.parse({...old,finish:'premium',specs:{overrides:{'main-door':'hardwood'}}})
 assert.equal(saved.finish,'premium');assert.equal(saved.specs.overrides['main-door'],'hardwood')
})
test('all finish levels and overrides preserve seeded floors and architectural DNA',()=>{
 const before=JSON.stringify(design.floors)
 for(const finish of ['basic','mid','premium']){
  const brief=structuredClone(b);brief.finish=finish;brief.specs.overrides={'main-door':'hardwood',solar:'on','future-floor':'two','roof-type':'tile'}
  const next=generate(compile(brief))
  assert.equal(next.model.seed,design.model.seed);assert.equal(JSON.stringify(next.floors),before)
  assert.deepEqual(next.dna,design.dna)
 }
})
test('room overrides, retired values and auto items resolve safely for every specification',()=>{
 const brief=structuredClone(b);brief.specs.overrides={'floor-bedrooms':'stone','floor-bedrooms@FF_MASTER_BED':'ceramic','main-door':'retired-product','slabs':'on'}
 assert.equal(resolveSpecification(brief,'floor-bedrooms').id,'stone')
 assert.equal(resolveSpecification(brief,'floor-bedrooms','FF_MASTER_BED').id,'ceramic')
 assert.equal(resolveSpecification(brief,'main-door').id,'engineered')
 assert.equal(resolveSpecification(brief,'slabs').id,'computed')
 assert.equal(Object.keys(resolveSpecifications(brief)).length,specsCatalogue.items.length)
 assert.throws(()=>resolveSpecification(brief,'not-an-item'),/Unknown specification/)
})
test('current finish controls round-trip through the Brief and replay costs on another browser without moving geometry',()=>{
 const brief=structuredClone(b),selection=defaultSelection('refined'),room=estimateCost(design).quantities.rooms[0]
 selection.roomFloors[room.id]='ceramic';brief.specs.overrides.solar='on'
 writeSelectionToBrief(brief,design,selection)
 const loaded=briefSchema.parse(JSON.parse(JSON.stringify(brief))),restored=selectionFromBrief(loaded,design)
 assert.equal(loaded.finish,'premium');assert.equal(loaded.specs.overrides.solar,'on')
 assert.deepEqual(restored,selection)
 const replay=generate(compile(loaded))
 assert.deepEqual(replay.floors,design.floors)
 assert.equal(estimateCost(replay).expected,estimateCost(design,selection).expected)
 assert.ok(estimateCost(replay).expected>estimateCost(design).expected)
 const oldSaved=defaultSelection('simple')
 assert.deepEqual(selectionFromBrief(b,design,oldSaved),oldSaved)
})

const storage=new Map()
globalThis.window={localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},atob:globalThis.atob,btoa:globalThis.btoa}
const server=await createServer({configFile:false,resolve:{alias:{'@':fileURLToPath(new URL('../src',import.meta.url))}},optimizeDeps:{noDiscovery:true,entries:[]},server:{middlewareMode:true,watch:null,hmr:false,ws:false},appType:'custom'})
after(()=>server.close())
const {useStudio}=await server.ssrLoadModule('/src/state/studio.ts')
test('editing specifications retains the existing result, pinned villa and directions; geometry edits still invalidate',()=>{
 const result={design,model:design.model,cost:estimateCost(design)},pin={massing:design.massingType,seed:42}
 useStudio.setState({brief:structuredClone(b),result,pinned:pin,directions:[]})
 const before=useStudio.getState()
 useStudio.getState().edit(brief=>{brief.finish='premium';brief.specs.overrides.windows='thermal'})
 const current=useStudio.getState()
 assert.equal(current.result,before.result);assert.equal(current.result.design.floors,before.result.design.floors)
 assert.equal(current.pinned,before.pinned);assert.equal(current.directions,before.directions)
 const persisted=JSON.parse(storage.get('brickpilot.studio')).state.brief
 assert.equal(persisted.finish,'premium');assert.equal(persisted.specs.overrides.windows,'thermal')
 useStudio.getState().edit(brief=>{brief.site.plotWidth+=1})
 assert.equal(useStudio.getState().result,null);assert.equal(useStudio.getState().pinned,null)
})
