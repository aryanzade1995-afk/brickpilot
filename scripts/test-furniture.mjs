import test from 'node:test'
import assert from 'node:assert/strict'
import {createServer} from 'vite'
import {fileURLToPath} from 'node:url'
import {renderToStaticMarkup} from 'react-dom/server'
import React from 'react'
import {furnitureFor,FURNITURE_LIMITS} from '../src/lib/furniture/catalogue.ts'
import {placeFurniture,overlaps} from '../src/lib/furniture/place.ts'
import {briefRooms,roomDimensions} from '../src/lib/furniture/rooms.ts'
import {defaultBrief,briefSchema,geometryBrief} from '../src/lib/model/brief.ts'
import {compile} from '../src/lib/model/canonical.ts'
import {generate} from '../src/lib/engine/generate.ts'
import {validate} from '../src/lib/rules/index.ts'
import {MIN_DIM} from '../src/lib/rules/roomLimits.ts'
import {typicalBudgetBand,budgetVerdict} from '../src/lib/cost/briefBudget.ts'
import {buildBriefRoom,buildRoom} from '../src/lib/three/buildRoom.ts'
const brief=defaultBrief()
test('seeded room placement repeats exactly and places essentials first without overlaps or blocked openings',()=>{
 for(const kind of ['master','kids','living','dining','kitchen','bathroom']){
  const items=furnitureFor(kind,kind==='dining'?4:2)
  const a=placeFurniture(kind,4.8,4.5,items)
  assert.deepEqual(a,placeFurniture(kind,4.8,4.5,items));assert.ok(a.placed.length)
  for(const p of a.placed){
   assert.ok(p.x>=0&&p.y>=0&&p.x+p.width<=4.8+1e-6&&p.y+p.depth<=4.5+1e-6)
   assert.ok(!overlaps(p,a.door)&&!overlaps(p,a.window))
   for(const q of a.placed.filter(q=>q.id!==p.id))assert.ok(!overlaps(p,q)&&!overlaps(p,q.access))
   if(p.headboard)assert.ok(p.rotation===90||p.rotation===180)
  }
  const essentialEnd=a.placed.findIndex(p=>!p.essential)
  if(essentialEnd>=0)assert.ok(a.placed.slice(essentialEnd).every(p=>!p.essential))
 }
})
test('smallest bedroom is too small, a larger bedroom tight, standard bedroom comfortable',()=>{
 const items=furnitureFor('master',2)
 assert.equal(placeFurniture('bed1',2.4,2.7,items).verdict,'Too small')
 assert.equal(placeFurniture('bed1',3.2,3.4,items).verdict,'Tight')
 assert.equal(placeFurniture('bed1',3.9,3.6,items).verdict,'Comfortable')
 for(const [size,expected] of [['compact','Too small'],['small','Tight'],['standard','Comfortable']]){const b=defaultBrief();b.rooms.sizes['1:bed2']=size;assert.equal(briefRooms(b).find(r=>r.id==='1:bed2').fit.verdict,expected)}
})
test('household beds and dining seats follow people; stars add a desk requirement and stay independent of plan seed',()=>{
 const rooms=briefRooms(brief),kids=rooms.find(r=>r.kind==='kids')
 assert.equal([...kids.fit.placed,...kids.fit.dropped].filter(p=>p.id.startsWith('single-bed')).length,2)
 assert.equal(furnitureFor('dining',6).filter(p=>p.id.startsWith('chair')).length,6)
 const next=structuredClone(brief);next.rooms.starred=[kids.id]
 assert.ok([...briefRooms(next).find(r=>r.id===kids.id).fit.placed,...briefRooms(next).find(r=>r.id===kids.id).fit.dropped].find(p=>p.id==='desk').essential)
 assert.deepEqual(geometryBrief(next),geometryBrief(brief));assert.equal(compile(next).seed,compile(brief).seed)
})
test('size presets honor room minima, persist, and feed only canonical targets while hard checks remain',()=>{
 const model=compile(brief)
 for(const f of model.floors)for(const s of f.spaces.filter(s=>!s.outdoor))for(const size of ['compact','small','standard','large']){
  const d=roomDimensions(s,size);assert.ok(d.width*1000>=(MIN_DIM[s.zone]??0));assert.ok(d.depth*1000>=(MIN_DIM[s.zone]??0));assert.ok(d.width*d.depth>=s.min-1e-6)
 }
 const next=briefSchema.parse({...brief,rooms:{...brief.rooms,sizes:{'1:bed1':'large'}}})
 assert.equal(briefSchema.parse(JSON.parse(JSON.stringify(next))).rooms.sizes['1:bed1'],'large')
 const target=compile(next).floors[1].spaces.find(s=>s.id==='bed1')
 assert.ok(target.target>model.floors[1].spaces.find(s=>s.id==='bed1').target);assert.equal(target.min,model.floors[1].spaces.find(s=>s.id==='bed1').min)
 assert.ok(validate(generate(compile(next))).hardChecksPass)
 const old=briefSchema.parse({rooms:{sizes:undefined,starred:undefined}})
 assert.deepEqual(old.rooms.sizes,{});assert.deepEqual(old.rooms.starred,[]);assert.equal(compile(old).seed,compile(brief).seed)
})
test('budget verdict boundaries and live rate band use cost data without changing geometry',()=>{
 const band=typicalBudgetBand(brief)
 assert.equal(budgetVerdict(band.high,band),'Within budget');assert.equal(budgetVerdict(band.low,band),'Tight');assert.equal(budgetVerdict(band.low-1,band),'Over budget');assert.equal(budgetVerdict(undefined,band),'Not set')
 const next=briefSchema.parse({...brief,budget:{amount:band.high}})
 assert.deepEqual(geometryBrief(next),geometryBrief(brief));assert.equal(compile(next).seed,compile(brief).seed)
 assert.deepEqual(briefSchema.parse(JSON.parse(JSON.stringify(next))).budget,next.budget)
 assert.ok(typicalBudgetBand({...brief,finish:'premium'}).low>band.low)
})
test('cutaway reuses segmented shell openings with two walls, no ceiling, and keeps the shell without furniture',()=>{
 const shell=buildBriefRoom('bed1','Bedroom',3.9,3.6,FURNITURE_LIMITS.height,0.9,1.2)
 assert.equal(shell.dims.h,2.8);assert.ok(shell.boxes.some(b=>b.id==='floor'));assert.ok(!shell.boxes.some(b=>b.id==='ceil'))
 assert.ok(shell.boxes.filter(b=>b.mat==='wall').every(b=>b.id.startsWith('w-N')||b.id.startsWith('w-W')))
 assert.ok(shell.boxes.some(b=>b.id==='w-N-void0'&&b.mat==='glass'))
 assert.ok(shell.boxes.some(b=>b.id==='w-W-void0'&&b.mat==='reveal'))
 const design=generate(compile(brief)),room=design.floors[0].rooms.find(r=>r.id==='living')
 assert.ok(buildRoom(design,0,room.id,brief.style.character).boxes.some(b=>b.id==='ceil'))
})
test('room selection and budget edits share the store; all existing Step 5 controls and later scorecard remain',async()=>{
 const storage=new Map();globalThis.window={localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)}}
 const server=await createServer({configFile:false,resolve:{alias:{'@':fileURLToPath(new URL('../src',import.meta.url))}},optimizeDeps:{noDiscovery:true,entries:[]},server:{middlewareMode:true,watch:null,hmr:false,ws:false},appType:'custom'})
 try{
  const {useStudio}=await server.ssrLoadModule('/src/state/studio.ts'),{RoomsStep,ReviewStep}=await server.ssrLoadModule('/src/routes/brief/steps.tsx'),{SelectionsBar}=await server.ssrLoadModule('/src/routes/brief/SelectionsBar.tsx')
  useStudio.setState({brief:structuredClone(brief)});useStudio.getState().selectRoom('1:bed1');assert.equal(useStudio.getState().selectedRoomId,'1:bed1')
  useStudio.getState().edit(b=>{b.budget={amount:typicalBudgetBand(b).high}})
  const html=renderToStaticMarkup(React.createElement(RoomsStep)),bar=renderToStaticMarkup(React.createElement(SelectionsBar,{jump:()=>{}})),review=renderToStaticMarkup(React.createElement(ReviewStep))
  for(const label of ['Bedrooms with attached bath','Bedrooms without attached bath','Shared / common bathrooms','Studies / offices','Balcony on upper floors','Pooja room size','Ground-floor priorities','Swimming pool','Optional budget','Selected rooms'])assert.ok(html.includes(label),label)
  assert.ok(html.includes('Budget in lakh'));assert.ok(bar.includes('Budget:'));assert.equal(budgetVerdict(useStudio.getState().brief.budget.amount,typicalBudgetBand(useStudio.getState().brief)),'Within budget');assert.ok(review.includes('Furniture fit'))
  const persisted=briefSchema.parse(JSON.parse(storage.get('brickpilot.studio')).state.brief);assert.deepEqual(persisted.budget,useStudio.getState().brief.budget)
 }finally{await server.close();delete globalThis.window}
})
