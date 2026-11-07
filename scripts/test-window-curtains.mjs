import test from 'node:test'
import assert from 'node:assert/strict'
import {registerHooks} from 'node:module'
import {defaultBrief,geometryBrief,parseStoredBrief} from '../src/lib/model/brief.ts'
import {compile} from '../src/lib/model/canonical.ts'
import {generate} from '../src/lib/engine/generate.ts'
import {createBuildingModel} from '../src/lib/engine/buildingModel.ts'
import {curtainLayout} from '../src/lib/curtains/layout.ts'
import {CURTAIN_OPTIONS,selectedCurtain} from '../src/lib/curtains/catalogue.ts'
import {CurtainMotion} from '../src/lib/curtains/motion.ts'
import {createCurtainRig} from '../src/lib/three/curtains.ts'
import {estimateBoq} from '../src/lib/cost/boq.ts'
import {finishSignature} from '../src/lib/cost/finishAssignments.ts'
import {specsCatalogue,resolveSpecification} from '../src/lib/cost/catalogue.ts'
import {applySpecification,applicableRooms} from '../src/lib/cost/workspace.ts'
import {specificationSchedule} from '../src/lib/cost/schedule.ts'
import {classifyTradeScope} from '../src/lib/cost/pricingContext.ts'
registerHooks({resolve(s,c,next){return s.startsWith('@/')?{url:new URL(`../src/${s.slice(2)}`,import.meta.url).href,shortCircuit:true}:next(s,c)}})
const brief=defaultBrief();brief.site.plotWidth=18;brief.site.plotDepth=24;brief.lifestyle.vastu='ignore'
const plan=generate(compile(brief),{seed:41,massing:'stepped'}),building=createBuildingModel(plan)
const windows=curtainLayout(building,brief)

test('catalogue, dry-room source windows and fabric geometry use one saved preference',()=>{
 assert.ok(windows.length>0);assert.equal(new Set(windows.map(w=>w.id)).size,windows.length)
 for(const w of windows){
  assert.ok(building.windows.some(o=>o.id===w.id));assert.ok(w.width>0&&w.drop>0)
  assert.ok(Math.abs(w.position[1]-w.drop-w.floorY-.06)<1e-8)
  assert.ok(!/bath|toilet|ensuite|kitchen|utility/i.test(w.roomName));assert.equal(w.option.id,resolveSpecification(brief,'window-curtains',w.roomId).id)
 }
 const chosen=structuredClone(brief);chosen.specs.overrides['window-curtains']='curtain-blackout';chosen.specs.overrides[`window-curtains@${windows[0].roomId}`]='curtain-roller'
 assert.equal(selectedCurtain(chosen,windows[0].roomId).id,'curtain-roller')
 assert.deepEqual(parseStoredBrief(JSON.parse(JSON.stringify(chosen))).data.specs,chosen.specs)
 assert.deepEqual(geometryBrief(chosen),geometryBrief(brief));assert.equal(finishSignature(chosen),finishSignature(brief),'curtain changes never require another Blender export')
 assert.equal(selectedCurtain({...brief,specs:{overrides:{'window-curtains':'retired-style'}}}).id,'curtain-linen')
})

test('whole-home and room choices price measured coverage exactly once, including none and optional interior scope',()=>{
 const item=specsCatalogue.items.find(i=>i.id==='window-curtains'),before=JSON.stringify(plan),cost=estimateBoq(plan,brief)
 const lines=cost.boq.filter(l=>l.item===item.id)
 assert.equal(lines.length,windows.length)
 for(const w of windows){const line=lines.find(l=>l.id===`curtains:${w.id}`);assert.equal(line.qty,w.area);assert.equal(line.amount,w.area*(w.option.material+w.option.labour));assert.equal(line.scopeCategory,'interiors')}
 assert.equal(classifyTradeScope('Extras','window-curtains'),'interiors')
 const chosen=applySpecification(brief,cost,item,'curtain-none',applicableRooms(cost,item).map(r=>r.id))
 const none=estimateBoq(plan,chosen);assert.ok(none.boq.filter(l=>l.item===item.id).every(l=>l.qty===0&&l.amount===0))
 assert.ok(applicableRooms(none,item).length>0,'None must remain selectable per room')
 const roomChoice=applySpecification(chosen,none,item,'curtain-blackout',[windows[0].roomId])
 const changed=estimateBoq(plan,roomChoice)
 assert.ok(changed.boq.filter(l=>l.item===item.id&&l.roomId===windows[0].roomId).every(l=>l.amount>0))
 assert.ok(changed.boq.filter(l=>l.item===item.id&&l.roomId!==windows[0].roomId).every(l=>l.amount===0))
 assert.ok(specificationSchedule(roomChoice,changed).some(r=>r.item===item.id&&r.choice.includes('Blackout')))
 assert.equal(JSON.stringify(plan),before)
})

test('curtains animate independently, reverse smoothly, settle and respect reduced motion',()=>{
 const motion=new CurtainMotion(windows),first=windows[0].id
 motion.toggle(first);motion.advance(.05);const half=motion.states.get(first).progress
 assert.ok(half>0&&half<1)
 for(const [id,s] of motion.states)if(id!==first)assert.equal(s.progress,1)
 motion.toggle(first);motion.advance(.05);assert.ok(motion.states.get(first).progress>half)
 motion.toggle(first);for(let i=0;i<150;i++)motion.advance(1/60)
 assert.equal(motion.states.get(first).progress,0);assert.equal(motion.advance(1/60),false)
 const reduced=new CurtainMotion(windows,true);reduced.toggle(first);assert.equal(reduced.states.get(first).progress,0)
 const w=windows[0],r=w.roomBounds
 const target={x:w.position[0],y:w.position[1]-w.drop*.45,z:w.position[2]}
 const centre={x:(r.x+r.w/2)/1000,z:-(r.y+r.h/2)/1000},len=Math.hypot(centre.x-target.x,centre.z-target.z)
 const eye={x:target.x+(centre.x-target.x)/len*.7,y:target.y,z:target.z+(centre.z-target.z)/len*.7}
 const direction={x:(target.x-eye.x)/.7,y:0,z:(target.z-eye.z)/.7}
 assert.equal(motion.target(eye,direction)?.id,first)
 assert.equal(motion.target({...eye,y:eye.y+4},direction),null)
 assert.equal(motion.target(eye,{x:-direction.x,y:0,z:-direction.z}),null)
})

test('pleated panels and roller blinds move without rebuilding geometry or blocking the source house',()=>{
 for(const option of CURTAIN_OPTIONS.filter(o=>o.kind!=='none')){
  const rig=createCurtainRig({...windows[0],option}),buffers=[]
  rig.root.traverse(o=>{if(o.isMesh)buffers.push([o,o.geometry,[...o.geometry.attributes.position.array]])})
  rig.apply(0);rig.apply(.5);rig.apply(1)
  buffers.forEach(([mesh,g,positions])=>{assert.equal(mesh.geometry,g);assert.deepEqual([...g.attributes.position.array],positions)})
  assert.ok(buffers.reduce((n,[,g])=>n+(g.index?.count??g.attributes.position.count)/3,0)<1800)
  let disposed=0;const unique=new Set(buffers.map(([,g])=>g));unique.forEach(g=>g.addEventListener('dispose',()=>disposed++));rig.dispose();assert.equal(disposed,unique.size)
 }
})
