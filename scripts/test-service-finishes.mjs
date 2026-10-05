import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {specsCatalogue} from '../src/lib/cost/catalogue.ts'
import {finishProducts,finishProduct} from '../src/lib/finishes/catalogue.ts'
import {photographedOptions,optionImage} from '../src/lib/finishes/optionImage.ts'
import {servicePreviewParts} from '../src/lib/finishes/servicePreviewGeometry.ts'
import {finishPreview} from '../src/lib/finishes/preview.ts'
import {defaultBrief,briefSchema,geometryBrief} from '../src/lib/model/brief.ts'
import {compile} from '../src/lib/model/canonical.ts'
import {generate} from '../src/lib/engine/generate.ts'
import {estimateBoq} from '../src/lib/cost/boq.ts'
import {applicableRooms,applySpecification,effectiveSpec,undoSpecification,quantitySignature} from '../src/lib/cost/workspace.ts'
import {specificationSchedule} from '../src/lib/cost/schedule.ts'
const item=id=>specsCatalogue.items.find(i=>i.id===id),services=finishProducts.filter(p=>p.preview),brief=defaultBrief(),design=generate(compile(brief)),cost=estimateBoq(design,brief)
test('six electrical systems each offer five actual supplier products; bathrooms separate all components and both toilet types',()=>{
 for(const id of ['fans','light-fittings','switches','electrical-bulbs','electrical-battens','electrical-exhaust']){
  const offered=photographedOptions(item(id));assert.equal(offered.length,5,id)
  for(const o of offered){const p=finishProduct(o.finishProductId);assert.ok(p.preview);assert.equal(p.image.kind,'real-product-photo');assert.ok(optionImage(o));assert.equal(p.image.projection,'reference')}
 }
 for(const id of ['bath-basin','bath-shower','bath-tub','bath-enclosure','cp-fittings','water-heater'])assert.equal(photographedOptions(item(id)).length,5,id)
 const toilets=photographedOptions(item('sanitary'));assert.equal(toilets.length,6)
 assert.ok(toilets.some(o=>finishProduct(o.finishProductId).preview.model==='toilet-indian'))
 assert.ok(toilets.some(o=>finishProduct(o.finishProductId).preview.model==='toilet-wall'))
 assert.ok(toilets.some(o=>finishProduct(o.finishProductId).preview.model==='toilet-floor'))
})
test('unpictured service options and proxy swatches disappear from chooser, facets and specification UI data',()=>{
 for(const i of specsCatalogue.items.filter(i=>['waterproofing','painting','electrical','plumbing-sanitary'].includes(i.group))){
  for(const o of photographedOptions(i)){assert.ok(optionImage(o));assert.ok(finishProduct(o.finishProductId)?.preview)}
 }
 assert.equal(photographedOptions(item('foundation-waterproofing')).length,0)
 assert.equal(photographedOptions(item('waterproofing-specialist')).length,0)
 assert.equal(photographedOptions(item('distribution-board')).length,0)
 assert.equal(photographedOptions(item('interior-paint')).length,3)
 // Existing projects retain their cost baseline until the user applies a photographed choice.
 assert.equal(effectiveSpec(brief,'sanitary').id,'mid');assert.equal(effectiveSpec(brief,'fans').id,'mid')
})
test('catalogue assets are present, byte identical to audited sources, and never projected as installation-photo textures',()=>{
 const audit=JSON.parse(readFileSync(new URL('../src/lib/finishes/service-image-audit.json',import.meta.url),'utf8'))
 assert.equal(audit.length,73);assert.equal(services.length,73)
 for(const p of services){const entry=audit.find(a=>a.id===p.id),bytes=readFileSync(new URL('../'+p.image.path,import.meta.url));assert.ok(bytes.length>1000);assert.equal(createHash('sha256').update(bytes).digest('hex'),entry.sha256)
  assert.equal(entry.url,p.image.originalUrl);for(const id of p.itemIds){const i=item(id),o=i.options.find(o=>o.id===p.id),s=finishPreview(i,o);assert.equal(s.texture,undefined);assert.equal(s.image.src,'/'+p.image.path.replace(/^public\//,''))}
 }
})
test('recognisable component models, hollow ceramics and waterproofing details are finite, deterministic and preserve source data',()=>{
 const before=JSON.stringify(services)
 for(const p of services.filter(p=>p.preview.model!=='paint'))for(const id of p.itemIds){const i=item(id),o=i.options.find(o=>o.id===p.id),parts=servicePreviewParts(i,o);assert.ok(parts?.length>1,p.id);assert.deepEqual(parts,servicePreviewParts(i,o))
  for(const part of parts){assert.ok(part.size.every(n=>Number.isFinite(n)&&n>0));assert.ok(part.at.every(Number.isFinite));if(part.shape==='shell')assert.ok(part.profile.length>=5)}
 }
 for(const id of ['bath-basin','bath-tub','sanitary'])assert.ok(photographedOptions(item(id)).every(o=>servicePreviewParts(item(id),o).some(p=>p.shape==='shell')))
 for(const id of ['cp-fittings','water-heater','electrical-battens','electrical-exhaust']){
  const signatures=photographedOptions(item(id)).map(o=>JSON.stringify(servicePreviewParts(item(id),o)))
  assert.equal(new Set(signatures).size,signatures.length,id+' must change the actual model, not just the reference photo')
 }
 const wet=item('bath-waterproofing'),a=wet.options.find(o=>o.id==='svc-wp-pidifin'),b=wet.options.find(o=>o.id==='svc-wp-urp');assert.notDeepEqual(servicePreviewParts(wet,a),servicePreviewParts(wet,b));assert.ok(servicePreviewParts(wet,a).length>30)
 assert.equal(JSON.stringify(services),before)
})
test('bathroom preferences isolate rooms, persist in reports, undo, and never double-charge allowances or alter geometry',()=>{
 const basin=item('bath-basin'),rooms=applicableRooms(cost,basin);assert.ok(rooms.length>=2)
 const next=applySpecification(brief,cost,basin,'svc-basin-3',[rooms[0].id]),priced=estimateBoq(design,next)
 assert.equal(effectiveSpec(next,basin.id,rooms[0].id).id,'svc-basin-3');assert.equal(effectiveSpec(next,basin.id,rooms[1].id).id,'svc-basin-1')
 assert.equal(priced.expected,cost.expected);assert.deepEqual(priced.boq,cost.boq);assert.equal(quantitySignature(priced),quantitySignature(cost));assert.deepEqual(geometryBrief(next),geometryBrief(brief))
 assert.ok(priced.excluded.some(s=>s.startsWith(basin.label)&&!s.includes('undefined')))
 const saved=briefSchema.parse(JSON.parse(JSON.stringify(next))),schedule=specificationSchedule(saved,priced)
 assert.equal(schedule.find(s=>s.item===basin.id&&s.roomId===rooms[0].id).optionId,'svc-basin-3');assert.equal(schedule.find(s=>s.item===basin.id&&s.roomId===rooms[1].id).optionId,'svc-basin-1')
 assert.equal(effectiveSpec(undoSpecification(saved,priced,basin,rooms[0].id),basin.id,rooms[0].id).id,'svc-basin-1')
 for(const id of ['bath-tub','bath-enclosure','electrical-bulbs','electrical-battens','electrical-exhaust']){const i=item(id),changed=applySpecification(brief,cost,i,photographedOptions(i).at(-1).id,applicableRooms(cost,i).map(r=>r.id)),c=estimateBoq(design,changed);assert.equal(c.expected,cost.expected);assert.ok(c.excluded.some(s=>s.startsWith(i.label)));assert.ok(!c.excluded.some(s=>s.includes('undefined')))}
})
