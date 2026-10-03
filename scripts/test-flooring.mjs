import test from 'node:test'
import assert from 'node:assert/strict'
import { flooringProducts, flooringProductSchema, filterFlooringProducts } from '../src/lib/flooring/catalogue.ts'
import { defaultBrief, geometryBrief, briefSchema } from '../src/lib/model/brief.ts'
import { compile } from '../src/lib/model/canonical.ts'
import { generate } from '../src/lib/engine/generate.ts'
import { estimateBoq } from '../src/lib/cost/index.ts'
import { specsCatalogue, specificationRate, specificationMaterials } from '../src/lib/cost/catalogue.ts'
import { applySpecification, applicableRooms, effectiveSpec, quantitySignature } from '../src/lib/cost/workspace.ts'
import { specificationSchedule } from '../src/lib/cost/schedule.ts'
const brief=defaultBrief(),design=generate(compile(brief)),base=estimateBoq(design,brief)
const item=specsCatalogue.items.find(i=>i.id==='floor-bedrooms'),rooms=applicableRooms(base,item)
test('25 flooring families preserve separate material/look, rates and valid preview references',()=>{
 assert.equal(flooringProducts.length,25)
 for(const p of flooringProducts){
  assert.ok(item.options.some(o=>o.id===p.id&&o.flooringProductId===p.id))
  assert.equal(specificationRate(`floor-catalog-${p.id}`).installed,p.price.material+p.price.labour)
  assert.ok(specificationMaterials.materials.some(m=>m.id===p.blenderMaterial))
 }
 assert.equal(flooringProducts.find(p=>p.id==='marble-gvt').materialType,'PGVT')
 assert.notEqual(flooringProducts.find(p=>p.id==='italian-marble').materialType,'PGVT')
 assert.ok(item.options.some(o=>o.id==='vitrified'))
})
test('official image provenance, pending permissions and explicit unavailable assets',()=>{
 const images=flooringProducts.filter(p=>p.image.url)
 assert.equal(images.length,19);assert.equal(flooringProducts.length-images.length,6)
 for(const p of images){assert.equal(p.image.sourceStatus,'source-verified');assert.equal(p.image.licensingStatus,'permission-required');assert.equal(p.image.productionReady,false);assert.ok(p.image.verifiedBy)}
 for(const p of flooringProducts.filter(p=>!p.image.url))assert.equal(p.image.imageType,'unavailable')
 const p=structuredClone(images[0]);p.image.productionReady=true;assert.equal(flooringProductSchema.safeParse(p).success,false)
 p.image.productionReady=false;p.image.url='https://pinterest.com/fake.jpg';p.thumbnail=p.image.url;assert.equal(flooringProductSchema.safeParse(p).success,false)
})
test('search and all five facets filter catalogue without altering specifications',()=>{
 assert.ok(filterFlooringProducts({search:'CALACATTA'}).some(p=>p.id==='calacatta-look'))
 const p=flooringProducts.find(p=>p.id==='anti-skid-stone')
 assert.ok(filterFlooringProducts({material:p.materialType,look:p.look,finish:p.finish,manufacturer:p.manufacturer,room:'Bathrooms'}).some(o=>o.id===p.id))
 assert.equal(filterFlooringProducts({search:'not-a-product'}).length,0)
 assert.ok(!filterFlooringProducts({room:'Bathrooms'}).some(p=>p.id==='italian-marble'))
})
test('every new option prices through the existing engine without changing geometry or quantities',()=>{
 const original=JSON.stringify(design.floors)
 for(const p of flooringProducts){
  const next=applySpecification(brief,base,item,p.id,rooms.map(r=>r.id)),priced=estimateBoq(design,next)
  assert.ok(priced.boq.filter(l=>l.item===item.id).every(l=>l.specId.endsWith('/'+p.id)))
  assert.ok(Number.isFinite(priced.expected));assert.equal(quantitySignature(priced),quantitySignature(base))
  assert.deepEqual(geometryBrief(next),geometryBrief(brief))
 }
 assert.equal(JSON.stringify(design.floors),original)
})
test('per-room choice updates only its own measured lines and survives saved brief normalization',()=>{
 assert.ok(rooms.length>1)
 const next=applySpecification(brief,base,item,'walnut-look',[rooms[0].id]),priced=estimateBoq(design,next)
 assert.equal(effectiveSpec(next,item.id,rooms[0].id).id,'walnut-look')
 assert.equal(effectiveSpec(next,item.id,rooms[1].id).id,effectiveSpec(brief,item.id,rooms[1].id).id)
 for(const line of base.boq.filter(l=>l.roomId!==rooms[0].id))assert.equal(priced.boq.find(l=>l.id===line.id).amount,line.amount)
 assert.notEqual(priced.expected,base.expected)
 const restored=briefSchema.parse(JSON.parse(JSON.stringify(next)))
 assert.equal(estimateBoq(design,restored).expected,priced.expected)
 const row=specificationSchedule(next,priced).find(r=>r.item===item.id&&r.roomId===rooms[0].id)
 assert.equal(row.photo,null);assert.ok(row.note.includes('Orientbell'));assert.ok(row.note.includes('rights clearance'))
})



