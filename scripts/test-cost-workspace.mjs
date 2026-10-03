import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { defaultBrief, geometryBrief } from '../src/lib/model/brief.ts'
import { compile } from '../src/lib/model/canonical.ts'
import { generate } from '../src/lib/engine/generate.ts'
import { estimateBoq, estimateProjectBoq } from '../src/lib/cost/index.ts'
import { specsCatalogue, specificationMaterials } from '../src/lib/cost/catalogue.ts'
import { applySpecification, applicableRooms, effectiveSpec, undoSpecification, changeCount, itemChanged, quantitySignature, suggestionFor, samples } from '../src/lib/cost/workspace.ts'
import { selectionFromBrief } from '../src/lib/cost/briefSelections.ts'
import { defaultSelection } from '../src/lib/cost/specifications.ts'

const brief=defaultBrief(),design=generate(compile(brief)),cost=estimateBoq(design,brief)
const item=id=>specsCatalogue.items.find(i=>i.id===id)
test('room changes and undo preserve other room choices and every source floor',()=>{
 const before=JSON.stringify(design.floors),floor=item('floor-bedrooms'),rooms=applicableRooms(cost,floor)
 assert.ok(rooms.length>=2)
 const first=applySpecification(brief,cost,floor,'stone',[rooms[0].id])
 assert.equal(effectiveSpec(first,floor.id,rooms[0].id).id,'stone')
 assert.equal(effectiveSpec(first,floor.id,rooms[1].id).id,effectiveSpec(brief,floor.id,rooms[1].id).id)
 const second=applySpecification(first,cost,floor,'anti-skid',[rooms[1].id])
 const undone=undoSpecification(second,cost,floor,rooms[0].id)
 assert.equal(effectiveSpec(undone,floor.id,rooms[1].id).id,'anti-skid')
 assert.equal(changeCount(undone),1);assert.ok(itemChanged(undone,cost,floor))
 assert.equal(JSON.stringify(design.floors),before)
 const priced=estimateBoq(design,first)
 for(const line of cost.boq.filter(l=>l.roomId===rooms[1].id)) assert.equal(priced.boq.find(l=>l.id===line.id).amount,line.amount)
})
test('all-room selection becomes a house default; automatic or invalid options cannot be edited',()=>{
 const floor=item('floor-bedrooms'),rooms=applicableRooms(cost,floor)
 const next=applySpecification(brief,cost,floor,'stone',rooms.map(r=>r.id))
 assert.deepEqual(next.specs.overrides,{[floor.id]:'stone'})
 assert.equal(applySpecification(brief,cost,item('slabs'),'computed'),brief)
 assert.equal(applySpecification(brief,cost,floor,'missing'),brief)
 assert.deepEqual(undoSpecification(next,cost,floor).specs.overrides,{})
})
test('reset and finish defaults cannot reimport stale legacy choices',()=>{
 const old=defaultSelection('refined')
 const selection=selectionFromBrief(brief,design,old,false)
 assert.equal(selection.catalogue,true)
 assert.equal(estimateProjectBoq(design,brief,selection).expected,cost.expected)
 assert.notEqual(estimateProjectBoq(design,brief,old).expected,cost.expected)
 assert.equal(changeCount({...brief,specs:{overrides:{'main-door':'engineered'}}}),0)
})
test('suggestions follow explicit household and climate context without changing the plan seed',()=>{
 const senior=structuredClone(brief);senior.household.members[0].role='senior'
 assert.equal(suggestionFor(senior,'floor-bathrooms').option,'anti-skid')
 const child=structuredClone(brief);child.household.members[0].role='child'
 assert.equal(suggestionFor(child,'interior-paint').option,'washable')
 assert.equal(suggestionFor(brief,'roof-type'),undefined)
 const hot={...brief,site:{...brief.site,climate:'hot'}}
 assert.equal(suggestionFor(hot,'roof-type').option,'cool')
 assert.deepEqual(geometryBrief(hot),geometryBrief(brief));assert.equal(compile(hot).seed,compile(brief).seed)
 assert.deepEqual(generate(compile(hot)).floors,design.floors)
})
test('quantity update signature ignores material choices but tracks measured geometry and sized supports',()=>{
 const next=applySpecification(brief,cost,item('main-door'),'hardwood')
 assert.equal(quantitySignature(estimateBoq(design,next)),quantitySignature(cost))
 const changed=structuredClone(design);changed.floors[0].rooms[0].rect.w+=100
 assert.notEqual(quantitySignature(estimateBoq(changed)),quantitySignature(cost))
})
test('every sample is a labelled Blender visualisation using the exact real close-up material texture',()=>{
 assert.equal(samples.length,specificationMaterials.materials.length)
 const hash=bytes=>createHash('sha256').update(bytes).digest('hex')
 for(const sample of samples){
  const material=specificationMaterials.materials.find(m=>m.id===sample.materialId)
  assert.equal(sample.texture,material.texture);assert.equal(sample.photo.kind,'visualisation')
  assert.ok(sample.photo.caption.includes('Visualisation'))
  assert.ok(sample.photo.width>=1600)
  assert.equal(hash(readFileSync(new URL(`../${sample.photo.file}`,import.meta.url))),sample.photo.sha256)
  assert.equal(hash(readFileSync(new URL(`../${sample.photo.webFile}`,import.meta.url))),sample.photo.webSha256)
 }
})
