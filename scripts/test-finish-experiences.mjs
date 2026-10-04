import test from 'node:test'
import assert from 'node:assert/strict'
import { specsCatalogue, specificationRate } from '../src/lib/cost/catalogue.ts'
import { detailedPreviewParts } from '../src/lib/finishes/previewGeometry.ts'
import { experienceOptions } from '../src/lib/finishes/experiences.ts'
import { applyPaintColour, paintColour, paintShades, groupedShades, hslHex } from '../src/lib/finishes/paint.ts'
import { defaultBrief, briefSchema, geometryBrief } from '../src/lib/model/brief.ts'
import { compile } from '../src/lib/model/canonical.ts'
import { generate } from '../src/lib/engine/generate.ts'
import { estimateBoq } from '../src/lib/cost/boq.ts'
import { applicableRooms, applySpecification, changeCount, undoSpecification } from '../src/lib/cost/workspace.ts'
import { openSpaceBrief } from './fixtures/open-space-brief.mjs'
import { specificationSchedule } from '../src/lib/cost/schedule.ts'
const item=id=>specsCatalogue.items.find(i=>i.id===id),brief=defaultBrief(),design=generate(compile(brief)),cost=estimateBoq(design,brief)
test('15 ceiling choices, 11 gardens and 7 pool allowances preserve defaults and price through measured area',()=>{
 for(const [id,n]of [['false-ceiling',15],['landscaping',11],['pool',7]])assert.equal(item(id).options.length,n)
 for(const option of experienceOptions){const i=item(option.item),o=i.options.find(o=>o.id===option.id);assert.ok(o);assert.equal(specificationRate(o.rateId).installed,option.rate.material+option.rate.labour)}
 const before=JSON.stringify(design.floors),rooms=applicableRooms(cost,item('false-ceiling')).map(r=>r.id)
 const changed=applySpecification(brief,cost,item('false-ceiling'),'ceiling-slats',rooms)
 assert.ok(estimateBoq(design,changed).expected>cost.expected);assert.equal(JSON.stringify(design.floors),before)
})
test('every ceiling pattern fits its host room with no pieces beyond width/depth',()=>{
 for(const o of item('false-ceiling').options){const p=detailedPreviewParts(item('false-ceiling'),o,[3.2,2.7]);assert.ok(p.length)
 for(const part of p.filter(p=>!p.rotation&&(!p.shape||p.shape==='box'))){assert.ok(Math.abs(part.at[0])+part.size[0]/2<=1.64);assert.ok(Math.abs(part.at[2])+part.size[2]/2<=1.4)}
 }
})
test('railing changes alter posts, infill and material geometry; each fitting tier is visibly different',()=>{
 for(const id of ['false-ceiling','balcony-railings','sanitary','cp-fittings','roof-type','landscaping','pool']){
  const signatures=item(id).options.map(o=>JSON.stringify(detailedPreviewParts(item(id),o)))
  assert.ok(signatures.every(s=>s&&s!=='undefined'),id)
  assert.ok(new Set(signatures).size===signatures.length,id)
  assert.notEqual(signatures[0],signatures[1],id)
 }
 const rail=item('balcony-railings');assert.notDeepEqual(detailedPreviewParts(rail,rail.options.find(o=>o.id==='rail-frameless')),detailedPreviewParts(rail,rail.options.find(o=>o.id==='rail-glass-post')))
 const roof=item('roof-type');for(const o of roof.options)assert.ok(detailedPreviewParts(roof,o).some(p=>p.selected&&p.at[1]>.4),'finish belongs above house')
})
test('official shades have source codes and hex colours, and stay grouped by family',()=>{
 assert.ok(paintShades.length>=100);assert.equal(new Set(paintShades.map(s=>s.id)).size,paintShades.length)
 for(const g of groupedShades())assert.ok(g.shades.every(s=>s.family===g.family&&s.sourceUrl.startsWith('https://www.asianpaints.com/')))
 assert.equal(hslHex(0,100,50),'#FF0000');assert.equal(hslHex(120,100,50),'#00FF00')
})
test('paint colour stays separate from paint quality; room isolation, saved reload, undo and reports work',()=>{
 const rooms=applicableRooms(cost,item('interior-paint')).map(r=>r.id),one=rooms[0],before=geometryBrief(brief)
 const changed=applyPaintColour(brief,'#245A83',rooms,[one])
 assert.equal(paintColour(changed,one).hex,'#245A83');assert.notEqual(paintColour(changed,rooms[1]).hex,'#245A83')
 const q=applySpecification(changed,cost,item('interior-paint'),'premium',[one]);assert.equal(paintColour(q,one).hex,'#245A83')
 assert.equal(estimateBoq(design,changed).expected,cost.expected);assert.deepEqual(geometryBrief(changed),before)
 assert.equal(paintColour(briefSchema.parse(JSON.parse(JSON.stringify(q))),one).hex,'#245A83')
 const schedule=specificationSchedule(changed,estimateBoq(design,changed));assert.ok(schedule.some(s=>s.roomId===one&&s.choice.includes('#245A83')))
 assert.equal(changeCount(changed),1);assert.notEqual(paintColour(undoSpecification(changed,cost,item('interior-paint'),one),one).hex,'#245A83')
 assert.equal(applyPaintColour(brief,'invalid',rooms,rooms),brief)
})

test('pool and garden choices reprice their own measured areas without adding site geometry',()=>{
 const b=openSpaceBrief('auto'),d=generate(compile(b)),base=estimateBoq(d,b),before=JSON.stringify(d.siteFeatures)
 for(const id of ['pool','landscaping']){
  assert.ok(base.boq.some(l=>l.item===id&&l.qty>0))
  for(const option of item(id).options){const changed=applySpecification(b,base,item(id),option.id),c=estimateBoq(d,changed)
   for(const line of c.boq.filter(l=>l.item===id)){assert.equal(line.rate,specificationRate(option.rateId).installed);assert.equal(line.amount,line.qty*line.rate)}
   assert.deepEqual(c.boq.filter(l=>l.item!==id),base.boq.filter(l=>l.item!==id))
  }
 }
 assert.equal(JSON.stringify(d.siteFeatures),before)
})
