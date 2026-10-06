import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { defaultBrief } from '../src/lib/model/brief.ts'
import { compile } from '../src/lib/model/canonical.ts'
import { generate } from '../src/lib/engine/generate.ts'
import { generateAlternativeDesign, ENVELOPE_LIMITS } from '../src/lib/engine/generateAlternativeDesign.ts'
import { ArchitectureValidator } from '../src/lib/engine/massing/ArchitectureValidator.ts'
import { extractLayout } from '../src/lib/plan/layout.ts'
import { resizeRoom, swapRooms, commit } from '../src/lib/plan/ops.ts'
import { outdoorBlockers, outdoorIntersects, planCoveredOutdoor } from '../src/lib/engine/coveredOutdoor.ts'
import { CAR_HEIGHT_MM } from '../src/lib/engine/outdoorAssets.ts'

const b = defaultBrief(); b.site.plotWidth = 18; b.site.plotDepth = 24; b.levels.storeys = 1
const source = generate(compile(b)), fixtures = []
function checked(plan, seed) {
  const model = generateAlternativeDesign(plan, seed), { buildingModel: building, massingModel: massing, facadeGrammar: facade } = model
  const layout = facade.coveredOutdoor
  assert.deepEqual(layout.issues, [])
  assert.equal(layout.sourcePlanId, building.planId)
  assert.deepEqual(planCoveredOutdoor(building, massing, facade), layout)
  const ground = building.floors[0], z = ground.elevationMm-(building.structuralSizing?.plinthHeightMm??400)+70
  const posts = layout.roofs.flatMap(r => r.posts.map(p => ({...p,z,height:ground.elevationMm+ground.heightMm-200-z})))
  const blockers = [...outdoorBlockers(building,massing,facade),...layout.cars.map(c=>({...c.rect,z,height:CAR_HEIGHT_MM}))]
  for (const [i,p] of posts.entries()) assert.ok(![...blockers,...posts.slice(0,i)].some(q=>outdoorIntersects(p,q)), 'pillar intersects another object')
  fixtures.push(model)
  return model
}

test('shortened parking regenerates clear bearings and only cars that fit', () => {
  const initial = checked(source,6)
  for (const amount of [300,600,900]) {
    const l=extractLayout(source), p=l.floors[0].rooms.find(r=>r.id==='parking')
    const op=resizeRoom(l,source,0,p.id,{...p.rect,h:p.rect.h-amount})
    assert.ok(op.ok,op.reason)
    const edited=commit(source,op.layout,l,op.affected); assert.ok(edited.ok,edited.reason)
    const saved=JSON.stringify(edited.design), model=checked(edited.design,6)
    assert.notEqual(model.buildingModel.planId,initial.buildingModel.planId,'edited geometry retires cached models')
    assert.equal(JSON.stringify(edited.design),saved,'support placement preserves source walls, rooms and openings')
  }
})
test('swapping exterior spaces and changing room dimensions rebuilds pillar placements', () => {
  const l=extractLayout(source), op=swapRooms(l,source,0,'parking','verandah')
  assert.ok(op.ok,op.reason)
  const edited=commit(source,op.layout,l,op.affected); assert.ok(edited.ok,edited.reason)
  for (const seed of [6,12,23]) checked(edited.design,seed)
})
test('canopy piers reject paths and driveways even outside room bounds', () => {
  const plan=JSON.parse(readFileSync(new URL('./fixtures/canopy-source.json',import.meta.url)))
  const model=checked(plan,6), pier=model.massingModel.masses.find(m=>m.usage==='support')
  assert.ok(pier)
  const building=structuredClone(model.buildingModel)
  building.siteFeatures=[{id:'new-path',kind:'path',rect:{x:pier.x,y:pier.y,w:250,h:250}}]
  assert.ok(ArchitectureValidator.validate(building,model.massingModel.masses,ENVELOPE_LIMITS).issues.some(i=>i.code==='CIRCULATION_BLOCKED'))
})
test('unsafe mandatory bearings report the affected room instead of exporting collisions',()=>{
  const model=checked(source,6), facade=structuredClone(model.facadeGrammar)
  const roof=facade.coveredOutdoor.roofs.find(r=>r.posts.length)
  const part={world:{...roof.rect,z:-500,height:5000},operation:'ADD'}
  facade.specialized.assemblies.push({category:'ENTRANCE',parts:[part]})
  assert.ok(planCoveredOutdoor(model.buildingModel,model.massingModel,facade).issues.some(i=>i.code==='OUTDOOR_SUPPORT_COLLISION'))
  // when the villa is generated, that porch piece is left open instead of rejecting the whole exterior
  const open=planCoveredOutdoor(model.buildingModel,model.massingModel,facade,false,true)
  assert.deepEqual(open.issues,[]); assert.ok(open.openRoofs.includes(roof.id)); assert.ok(!open.roofs.some(r=>r.id===roof.id))
  if(process.env.PILLAR_FIXTURES){mkdirSync(process.env.PILLAR_FIXTURES,{recursive:true});fixtures.forEach((f,i)=>writeFileSync(`${process.env.PILLAR_FIXTURES}/${i}.json`,JSON.stringify(f)))}
})
