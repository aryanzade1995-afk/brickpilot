import assert from 'node:assert/strict'
import test from 'node:test'
import {defaultBrief} from '../src/lib/model/brief.ts'
import {compile} from '../src/lib/model/canonical.ts'
import {generate,distinctDirectionPlans} from '../src/lib/engine/generate.ts'
import {planFingerprint} from '../src/lib/engine/planner/planFingerprint.ts'
import {validate} from '../src/lib/rules/index.ts'
import {generateAlternativeDesign} from '../src/lib/engine/generateAlternativeDesign.ts'
import {buildMassing} from '../src/lib/three/buildMassing.ts'
const brief=()=>{const b=defaultBrief();b.project.buildingType='large-villa';b.site.plotWidth=40;b.site.plotDepth=60;
 b.rooms.bedroomsWithBath=2;b.rooms.bedroomsNoBath=0;return b}
const overlap=(a,b)=>Math.min(a.x+a.w,b.x+b.w)>Math.max(a.x,b.x)&&Math.min(a.y+a.h,b.y+b.h)>Math.max(a.y,b.y)

test('fifty seeded wing layouts vary real living, stair, master, kitchen and verandah decisions with all hard checks',()=>{
 const model=compile(brief()),keys=new Set(),seen={living:new Set(),stair:new Set(),master:new Set(),kitchen:new Set(),verandah:new Set(),doubleHeight:new Set()}
 for(let seed=1;seed<=50;seed++){
  const d=generate(model,{massing:'u-wing',seed}),report=validate(d)
  assert.ok(report.hardChecksPass,`${seed}: ${JSON.stringify(report.findings.filter(f=>f.severity==='error'))}`)
  assert.equal(d.massingType,'u-wing')
  for(const key of Object.keys(seen))seen[key].add(d.layoutChoices[key])
  keys.add(planFingerprint(d).key)
  for(const floor of d.floors)for(const req of d.model.floors[floor.level].spaces.filter(s=>!s.outdoor&&s.zone!=='circulation')){
   const room=floor.rooms.find(r=>r.id===req.id);assert.ok(room.area>=req.min-.05&&room.area<=req.max*1.5+.05,req.id)
  }
 }
 assert.ok(keys.size>=12,`${keys.size} distinct source plans`)
 assert.equal(seen.living.size,3);assert.equal(seen.stair.size,3);assert.equal(seen.master.size,2)
 assert.equal(seen.kitchen.size,2);assert.equal(seen.verandah.size,2);assert.equal(seen.doubleHeight.size,2)
})

test('plan fingerprints are normalized, deterministic and independent of facade colours and seeds',()=>{
 const model=compile(brief()),d=generate(model,{massing:'u-wing',seed:39}),f=planFingerprint(d)
 assert.deepEqual(generate(model,{massing:'u-wing',seed:d.planSeed}),d)
 assert.ok(f.vector.every(n=>n>=0&&n<=1));assert.equal(f.vector.length,14)
 const other=structuredClone(d);other.dna.seed+=10;other.dna.materialPalette='different-paint'
 assert.deepEqual(planFingerprint(other),f)
 other.floors[0].openings=other.floors[0].openings.filter(o=>o.kind!=='door')
 assert.notEqual(planFingerprint(other).adjacencyHash,f.adjacencyHash)
})

test('double-height source cuts preserve requested rooms and pass Blender handoff; both viewers leave intermediate slabs empty',()=>{
 const d=generate(compile(brief()),{massing:'u-wing',seed:39}),floor=d.floors[1],v=floor.doubleHeightVoids[0]
 assert.ok(d.layoutChoices.doubleHeight)
 assert.ok(!floor.footprint.some(r=>overlap(r,v.rect)))
 const payload=generateAlternativeDesign(d,41)
 assert.ok(!payload.buildingModel.slabs.filter(s=>s.floorId===floor.prefix).some(s=>overlap(s.rect,v.rect)))
 const boxes=buildMassing(d).boxes,plot=d.model.plot,H=d.model.brief.levels.floorToFloor
 const x=(v.rect.x+v.rect.w/2-plot.width/2)/1000,z=(v.rect.y+v.rect.h/2-plot.depth/2)/1000
 assert.ok(!boxes.some(b=>['roof','slab'].includes(b.kind)&&Math.abs(b.pos[1]-(.45+H))<.6&&
  x>b.pos[0]-b.size[0]/2&&x<b.pos[0]+b.size[0]/2&&z>b.pos[2]-b.size[2]/2&&z<b.pos[2]+b.size[2]/2))
 const damaged=structuredClone(d);damaged.floors[1].doubleHeightVoids[0].rect.w=10000
 assert.ok(!validate(damaged).hardChecksPass)
 const unguarded=structuredClone(d);unguarded.floors[1].walls=unguarded.floors[1].walls.filter(w=>w.kind!=='parapet')
 assert.ok(validate(unguarded).findings.some(f=>f.code==='DOUBLE_HEIGHT_UNGUARDED'))
})

test('wrap verandahs are real source spaces and covered solids; no-verandah choice is allowed only without a request',()=>{
 const d=generate(compile(brief()),{massing:'u-wing',seed:6})
 assert.equal(d.layoutChoices.verandah,'wrap')
 assert.equal(d.floors[0].rooms.filter(r=>r.id.startsWith('verandahWing')).length,2)
 assert.ok(d.coveredFootprintSqm/(40*60)<=.6)
 assert.ok(buildMassing(d).boxes.some(b=>b.id.includes('verandahWingN')))
 const b=brief();b.rooms.priorities.coveredVerandah=false
 let noVerandah=false
 for(let seed=1;seed<=30;seed++){const p=generate(compile(b),{massing:'u-wing',seed});if(p.layoutChoices?.verandah==='none'){
  assert.ok(!p.floors[0].rooms.some(r=>r.id.startsWith('verandah')));noVerandah=true;break}}
 assert.ok(noVerandah)
})

test('large-villa Directions prefer distinct plan fingerprints and replay each plan seed exactly',()=>{
 for(const [w,h] of [[30,40],[40,60]]){
  const b=brief();b.site.plotWidth=w;b.site.plotDepth=h;const model=compile(b),directions=distinctDirectionPlans(model)
  assert.ok(directions.length>=3)
  assert.equal(new Set(directions.map(d=>planFingerprint(d.plan).key)).size,directions.length)
  for(const d of directions)assert.deepEqual(generate(model,{massing:d.massing,seed:d.planSeed}),d.plan)
 }
})

test('seeded master relocation preserves seniors on the ground floor and child-bedroom groups',()=>{
 const b=brief();b.rooms.bedroomsWithBath=4
 b.household.members.push({...b.household.members[0],id:'senior',role:'senior',needsGroundFloor:true},
  {...b.household.members[0],id:'teen',role:'teen',needsGroundFloor:false})
 const model=compile(b)
 for(const seed of[1,6,9,39]){
  const d=generate(model,{massing:'u-wing',seed});assert.ok(validate(d).hardChecksPass)
  const parents=d.model.floors[0].spaces.filter(s=>s.role==='parents');assert.ok(parents.length)
  for(const parent of parents)assert.ok(d.floors[0].rooms.some(r=>r.id===parent.id))
  const masterFloor=d.model.floors.find(f=>f.spaces.some(s=>s.role==='master'))
  assert.ok(masterFloor.spaces.some(s=>s.role==='child'))
 }
})
