import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { finishProducts, finishProductSchema, filterFinishProducts, finishFacets } from '../src/lib/finishes/catalogue.ts'
import { specsCatalogue, specificationRate, specificationMaterials } from '../src/lib/cost/catalogue.ts'
import { validateSpecificationData, specificationData } from '../src/lib/cost/data/validated.ts'
import { defaultBrief, briefSchema, geometryBrief } from '../src/lib/model/brief.ts'
import { compile } from '../src/lib/model/canonical.ts'
import { generate } from '../src/lib/engine/generate.ts'
import { estimateBoq } from '../src/lib/cost/boq.ts'
import { applySpecification, applicableRooms, effectiveSpec, quantitySignature } from '../src/lib/cost/workspace.ts'
import { specificationSchedule } from '../src/lib/cost/schedule.ts'
const brief=defaultBrief(),design=generate(compile(brief)),base=estimateBoq(design,brief)
const find=id=>specsCatalogue.items.find(i=>i.id===id)

test('seven catalogues separate material, type, finish and application; preserve legacy options and presets',()=>{
 const categories=[...new Set(finishProducts.map(p=>p.category))]
 assert.equal(categories.length,7);assert.equal(finishProducts.length,129)
 for(const group of categories) assert.equal(finishProducts.filter(p=>p.category===group).length,group==='kitchen'?21:18)
 for(const p of finishProducts)for(const id of p.itemIds){
  const i=find(id),o=i.options.find(o=>o.id===p.id),r=specificationRate(o.rateId)
  assert.equal(o.finishProductId,p.id);assert.equal(i.group,p.category)
  assert.equal(r.unit,p.rate.unit);assert.equal(r.installed,p.rate.material+p.rate.labour)
  assert.ok(specificationMaterials.materials.some(m=>m.id===p.blenderMaterial))
 }
 for(const [id,option] of [['windows','aluminium'],['main-door','hardwood'],['interior-paint','washable'],['kitchen-counter','quartz']])assert.ok(find(id).options.some(o=>o.id===option))
 const layout=finishProducts.filter(p=>p.itemIds.includes('kitchen-layout'))
 assert.deepEqual(layout.map(p=>p.style),['Existing plan','L-shaped','U-shaped','Parallel','Island','Peninsula'])
})

test('images are audited real imagery or explicitly unavailable, with safe official sources and licensing status',()=>{
 const withImages=finishProducts.filter(p=>p.image.path)
 assert.equal(withImages.length,7)
 assert.equal(withImages.filter(p=>p.image.kind==='real-product-photo').length,1)
 for(const p of finishProducts){
  assert.equal(p.thumbnail,p.image.path)
  if(!p.image.path){assert.equal(p.image.kind,'unavailable');assert.equal(p.image.sourceStatus,'unavailable');continue}
  assert.ok(p.image.verifiedBy.startsWith('asset-audit:'))
  if(p.image.kind==='generic-material-closeup'){
   const m=specificationMaterials.materials.find(m=>m.id===p.blenderMaterial)
   assert.equal(p.image.path,m.webFile);assert.equal(p.sourceUrl,m.source)
   assert.ok(existsSync(fileURLToPath(new URL('../'+p.image.path,import.meta.url))))
   assert.equal(p.image.licensingStatus,'CC0-1.0')
  }else{assert.equal(p.image.licensingStatus,'permission-required');assert.equal(p.image.productionReady,false)}
 }
 const photo=withImages.find(p=>p.image.kind==='real-product-photo')
 for(const changes of [{productionReady:true},{kind:'unavailable'},{verifiedBy:null},{path:'https://pinterest.com/imaginary.png'}])
  assert.equal(finishProductSchema.safeParse({...photo,image:{...photo.image,...changes}}).success,false)
 assert.equal(finishProductSchema.safeParse({...photo,sourceUrl:'https://geapl.com.evil.example/product'}).success,false)
})

test('search and contextual facets work without hiding or mutating unrelated catalogues',()=>{
 const p=finishProducts.find(p=>p.id==='cab-acrylic')
 assert.equal(filterFinishProducts('kitchen-cabinets',{search:'ACRYLIC',material:p.material,style:p.style,finish:p.finish,brand:p.brand,room:'Kitchen'}).length,1)
 assert.equal(filterFinishProducts('windows',{search:'impossible-product'}).length,0)
 assert.ok(finishFacets('glass').material.includes('Laminated glass'))
 assert.ok(!filterFinishProducts('bath-wall-tiles').some(p=>p.id==='clad-slate'))
 const flooring=readFileSync(new URL('../src/lib/flooring/products.json',import.meta.url),'utf8')
 assert.equal(JSON.parse(flooring).products.length,25)
})

test('all priced choices reprice only their own lines, preserve quantities/geometry, and round-trip saved selections',()=>{
 const before=JSON.stringify(design.floors),geom=geometryBrief(brief)
 for(const p of finishProducts){
  for(const itemId of p.itemIds){
   const item=find(itemId),rooms=applicableRooms(base,item).map(r=>r.id)
   const next=applySpecification(brief,base,item,p.id,rooms),cost=estimateBoq(design,next)
   assert.equal(quantitySignature(cost),quantitySignature(base),p.id)
   assert.deepEqual(geometryBrief(next),geom,p.id)
   for(const line of cost.boq){
    const previous=base.boq.find(l=>l.id===line.id)
    if(line.item!==itemId)assert.equal(line.amount,previous.amount,p.id+' leaked into '+line.item)
    else{assert.equal(line.specId,itemId+'/'+p.id);assert.equal(line.rate,p.rate.material+p.rate.labour);assert.equal(line.qty,previous.qty)}
   }
   assert.ok(Number.isFinite(cost.expected))
   const saved=briefSchema.parse(JSON.parse(JSON.stringify(next)))
   assert.equal(estimateBoq(design,saved).expected,cost.expected)
  }
 }
 assert.equal(JSON.stringify(design.floors),before)
})

test('wet wall tiles, bath waterproofing and interior paint retain per-room isolation',()=>{
 for(const [id,option] of [['bath-wall-tiles','wall-subway'],['bath-waterproofing','wp-bath-joints'],['interior-paint','paint-matt']]){
  const item=find(id),rooms=applicableRooms(base,item);assert.ok(rooms.length>1)
  const next=applySpecification(brief,base,item,option,[rooms[0].id]),cost=estimateBoq(design,next)
  assert.equal(effectiveSpec(next,id,rooms[0].id).id,option)
  assert.equal(effectiveSpec(next,id,rooms[1].id).id,effectiveSpec(brief,id,rooms[1].id).id)
  for(const line of base.boq)if(line.item!==id||line.roomId!==rooms[0].id)assert.equal(cost.boq.find(l=>l.id===line.id).amount,line.amount)
  assert.notEqual(cost.expected,base.expected)
 }
})

test('layout remains advisory, specialist scope is excluded, hardware adds only an upgrade allowance',()=>{
 for(const [id,option] of [['kitchen-layout','layout-island'],['waterproofing-specialist','wp-tank']]){
  const next=applySpecification(brief,base,find(id),option),cost=estimateBoq(design,next)
  assert.equal(cost.expected,base.expected);assert.ok(cost.excluded.some(s=>s.startsWith(find(id).label)))
  assert.ok(!cost.boq.some(l=>l.item===id))
  assert.equal(specificationSchedule(next,cost).find(s=>s.item===id).optionId,option)
 }
 const next=applySpecification(brief,base,find('kitchen-hardware'),'hardware-blum'),cost=estimateBoq(design,next)
 assert.ok(cost.expected>base.expected)
 for(const line of base.boq.filter(l=>l.item==='kitchen-cabinets'))assert.equal(cost.boq.find(l=>l.id===line.id).amount,line.amount)
 assert.equal(base.boq.find(l=>l.item==='kitchen-hardware').amount,0)
 // Source images must not be embedded into exports pending permission.
 const priced=estimateBoq(design,{...brief,specs:{overrides:{'compound-gate':'gate-auto-swing'}}})
 const row=specificationSchedule({...brief,specs:{overrides:{'compound-gate':'gate-auto-swing'}}},priced).find(s=>s.item==='compound-gate')
 assert.equal(row.photo,null);assert.ok(row.note.includes('permission'))
})

test('forged product references, cross-group choices and mismatched rates fail validation',()=>{
 const {rates,catalogue,presets,materials}=specificationData
 for(const mutation of [o=>o.finishProductId='nonexistent',o=>o.finishProductId='cab-acrylic',o=>o.rateId='boq-paving']){
  const c=structuredClone(catalogue),o=c.items.find(i=>i.id==='bath-wall-tiles').options.find(o=>o.finishProductId)
  mutation(o);assert.throws(()=>validateSpecificationData(rates,c,presets,materials),/finish product|finish rate/)
 }
})
