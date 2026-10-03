import test from 'node:test'
import assert from 'node:assert/strict'
import {performance} from 'node:perf_hooks'
import {defaultBrief} from '../src/lib/model/brief.ts'
import {compile} from '../src/lib/model/canonical.ts'
import {generate} from '../src/lib/engine/generate.ts'
import {validate} from '../src/lib/rules/index.ts'
import {estimateBoq} from '../src/lib/cost/boq.ts'
import {rateBook,resolveSpecification,specificationRate} from '../src/lib/cost/catalogue.ts'
import {boqRules,boqRulesSchema,TRADES} from '../src/lib/cost/data/boqRules.ts'
import {defaultSelection} from '../src/lib/cost/specifications.ts'
import {openSpaceBrief} from './fixtures/open-space-brief.mjs'
const brief=defaultBrief(),design=generate(compile(brief))
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} != ${b}`)
const changed=(a,b)=>b.boq.filter(l=>l.amount!==a.boq.find(x=>x.id===l.id)?.amount)

test('measured BOQ reconciles trades, installed rates, add-ons, procurement and ±15% range',()=>{
 const c=estimateBoq(design),direct=c.boq.reduce((n,l)=>n+l.amount,0)
 for(const l of c.boq){close(l.amount,l.qty*l.rate);close(l.amount,l.materialAmount+l.labourAmount);assert.ok(l.item&&l.specId&&l.rateId)}
 assert.deepEqual(c.tradeTotals.map(t=>t.trade),TRADES);close(c.tradeTotals.reduce((n,t)=>n+t.amount,0),direct)
 close(c.tradeTotals.reduce((n,t)=>n+t.share,0),1);close(c.lines[0].expected,direct)
 close(c.expected,c.lines.reduce((n,l)=>n+l.expected,0));close(c.total.low,c.expected*.85);close(c.total.high,c.expected*1.15)
 assert.equal(c.lines.find(l=>l.label==='Approvals allowance').expected,rateBook.settings.allowances.approvals)
 assert.equal(c.lines.find(l=>l.label==='Connections allowance').expected,rateBook.settings.allowances.connections)
 close(c.procurement.material+c.procurement.labour+c.procurement.overhead+c.procurement.projectAddOns,c.expected)
 close(c.procurement.turnkey+c.procurement.projectAddOns,c.expected)
 assert.ok(c.assumptions.some(a=>a.startsWith('Steel kg/m³:')));assert.ok(c.assumptions.some(a=>a.startsWith('Soil:')))
})
test('RCC volume, steel and formwork are charged once; cement and legacy area rates are non-additive',()=>{
 const c=estimateBoq(design),q=c.quantities
 close(c.boq.filter(l=>l.item==='concrete-grade').reduce((n,l)=>n+l.qty,0),Object.entries(q.total.items).filter(([k])=>k.startsWith('concrete.')).reduce((n,[,v])=>n+v.NetVolume,0))
 close(c.boq.filter(l=>l.item==='reinforcement').reduce((n,l)=>n+l.qty,0),Object.values(q.total.steelKg).reduce((a,b)=>a+b,0))
 close(c.boq.filter(l=>l.rateId==='boq-formwork').reduce((n,l)=>n+l.qty,0),Object.values(q.total.formworkM2).reduce((a,b)=>a+b,0))
 assert.ok(c.boq.some(l=>l.unit==='kg'));assert.ok(c.boq.some(l=>l.unit==='m³'));assert.ok(c.boq.some(l=>l.unit==='point'))
 assert.ok(!c.boq.some(l=>['boq-structure','boq-electrical','boq-plumbing'].includes(l.rateId)||l.item==='cement'))
})
test('each house finish override changes only that specification and leaves measured geometry unchanged',()=>{
 const base=estimateBoq(design),before=JSON.stringify(design)
 for(const [id,option] of [['main-door','hardwood'],['glass','double'],['windows','thermal'],['interior-paint','premium'],['solar','on'],['paving','stone']]){
  const b=structuredClone(brief);b.specs.overrides[id]=option;const next=estimateBoq(design,b),delta=changed(base,next)
  assert.ok(delta.length,id);assert.ok(delta.every(l=>l.item===id),id);assert.equal(next.quantities,base.quantities)
  const driver=next.topCostDrivers.find(d=>d.item===id);close(driver.difference,delta.reduce((n,l)=>n+l.amount-base.boq.find(x=>x.id===l.id).amount,0))
 }
 assert.equal(JSON.stringify(design),before)
})
test('per-room overrides take precedence, accept semantic legacy IDs and do not leak into other rooms',()=>{
 const b=structuredClone(brief),base=estimateBoq(design),floor=base.boq.find(l=>l.item==='floor-bedrooms'),paint=base.boq.find(l=>l.item==='interior-paint'&&l.roomId)
 b.specs.overrides[`floor-bedrooms@${floor.roomId}`]='stone'
 b.specs.overrides[`interior-paint@${paint.roomId}`]='premium'
 const next=estimateBoq(design,b),delta=changed(base,next)
 assert.ok(delta.every(l=>l.item==='floor-bedrooms'&&l.roomId===floor.roomId||l.item==='interior-paint'&&l.roomId===paint.roomId))
 assert.ok(delta.some(l=>l.roomId===floor.roomId&&l.label.endsWith('Skirting')))
 const semantic=floor.roomId.slice(floor.roomId.indexOf(':')+1),old=structuredClone(brief);old.specs.overrides[`floor-bedrooms@${semantic}`]='stone'
 assert.equal(estimateBoq(design,old).boq.find(l=>l.id===floor.id).rate,next.boq.find(l=>l.id===floor.id).rate)
 old.specs.overrides[`floor-bedrooms@${floor.roomId}`]='ceramic'
 assert.equal(estimateBoq(design,old).boq.find(l=>l.id===floor.id).specId,'floor-bedrooms/ceramic')
})
test('settings percentages and GST use explicit bases; room/spec selection cannot alter floors',()=>{
 const s=defaultSelection();s.includeGst=true;const c=estimateBoq(design,brief,s),d=c.lines[0].expected
 close(c.lines[1].expected,d*rateBook.settings.overheadPct/100)
 close(c.lines[2].expected,(d+c.lines[1].expected)*rateBook.settings.contingencyPct/100)
 close(c.lines[3].expected,d*rateBook.settings.feePct/100)
 close(c.lines[4].expected,(d+c.lines[1].expected+c.lines[2].expected)*rateBook.settings.gstPct/100)
})
test('five valid varied briefs: Basic < Mid < Premium and project ₹/sq ft inside data bands',()=>{
 for(const b of [defaultBrief(),...['auto','perSide','chosenSides','maxBuild'].map(mode=>openSpaceBrief(mode))]){
  b.rooms.pool=false;const d=generate(compile(b));assert.ok(validate(d).hardChecksPass)
  let previous=0
  for(const finish of ['basic','mid','premium']){
   b.finish=finish;const c=estimateBoq(d,b),band=rateBook.sanityBands[finish]
   assert.ok(c.expected>previous);previous=c.expected
   assert.ok(c.ratePerSqft>=band.min&&c.ratePerSqft<=band.max,`${b.site.openSpace.mode}/${finish}: ${c.ratePerSqft}`)
   assert.equal(c.sanityNote,null)
  }
 }
})
test('memo detects mutated specs/geometry, stays deterministic and reprices within 100ms',()=>{
 const b=structuredClone(brief),base=estimateBoq(design,b);assert.equal(estimateBoq(design,b),base)
 b.specs.overrides.windows='thermal';const start=performance.now(),next=estimateBoq(design,b)
 assert.ok(performance.now()-start<100);assert.notEqual(base,next);assert.ok(Object.isFrozen(next.boq))
 const d=structuredClone(design);d.floors[0].rooms.find(r=>!r.outdoor).rect.w+=100
 assert.notEqual(estimateBoq(d,b).quantities,next.quantities)
 assert.deepEqual(estimateBoq(structuredClone(design),structuredClone(b)),next)
 assert.throws(()=>boqRulesSchema.parse({...boqRules,recipes:[{...boqRules.recipes[0],rateId:'unknown-rate'}]}),/Unknown BOQ/)
})
test('preset plus override maps to the selected installed rate, without changing zero-priced extras',()=>{
 const b=structuredClone(brief);b.finish='premium';b.specs.overrides.solar='off'
 const c=estimateBoq(design,b),line=c.boq.find(l=>l.item==='main-door'),spec=resolveSpecification(b,'main-door')
 assert.equal(line.rate,specificationRate(spec.rateId).installed)
 assert.equal(c.boq.find(l=>l.item==='solar').amount,0)
 assert.ok(c.excluded.some(e=>/solar/i.test(e)))
})
