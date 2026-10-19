import test from 'node:test'
import assert from 'node:assert/strict'
import {defaultBrief,briefSchema,geometryBrief} from '../src/lib/model/brief.ts'
import {compile} from '../src/lib/model/canonical.ts'
import {generate} from '../src/lib/engine/generate.ts'
import {createBuildingModel} from '../src/lib/engine/buildingModel.ts'
import {measureDesign,geometryCostKey} from '../src/lib/cost/quantities.ts'
import {estimateBoq} from '../src/lib/cost/boq.ts'
import {boqCsv} from '../src/lib/cost/index.ts'
import {plumbingSchedule} from '../src/lib/cost/plumbing.ts'
import {PLUMBING_ITEM_IDS} from '../src/lib/cost/plumbingCatalogue.ts'
import {finishSignature} from '../src/lib/cost/finishAssignments.ts'
import {resolveSpecification,finishPresets} from '../src/lib/cost/catalogue.ts'
import {specificationSchedule} from '../src/lib/cost/schedule.ts'
import {snapshotCost,parseCostReplay,restoreCostReplay,replayedCost} from '../src/lib/cost/replay.ts'

const design=generate(compile(defaultBrief()))
const project=(overrides={})=>({...design,model:{...design.model,brief:{...design.model.brief,specs:{overrides:{...overrides}}}}})
const lines=(cost,item)=>cost.boq.filter(l=>l.item===item)
test('pipes are scheduled once per service and floor, with explicit diameters and installed material/labour costs',()=>{
 const before=JSON.stringify(design),q=measureDesign(design),cost=estimateBoq(design),s=q.plumbing
 assert.equal(new Set(s.runs.map(r=>r.id)).size,s.runs.length)
 for(const f of design.floors){
  const points=q.perFloor.find(p=>p.level===f.level).items['plumbing.points'].Count
  const runs=s.runs.filter(r=>r.floor===f.level)
  assert.equal(runs.find(r=>r.purpose==='Water branches').lengthM,points*8)
  assert.ok(runs.every(r=>r.lengthM>0&&r.diameterMm>0))
 }
 assert.equal(lines(cost,'water-pipes').length,s.runs.filter(r=>r.system==='water').length)
 assert.equal(lines(cost,'drain-pipes').length,s.runs.filter(r=>r.system==='drain').length)
 for(const line of [...lines(cost,'water-pipes'),...lines(cost,'drain-pipes')]){
  assert.match(line.specification,/\d+ mm (nominal|outside)/)
  assert.equal(line.amount,line.qty*line.rate)
  assert.ok(Math.abs(line.amount-line.materialAmount-line.labourAmount)<.001)
 }
 assert.equal(JSON.stringify(design),before)
})
test('capacity, storage volume and BOQ agree, and underground storage is not counted in the overhead tank again',()=>{
 const p=project({'underground-water-tank':'l5000','drain-tank':'septic3000'}),c=estimateBoq(p),s=c.quantities.plumbing
 for(const tank of [s.underground,s.drain])assert.ok(Math.abs(tank.lengthM*tank.widthM*tank.depthM*1000-tank.capacityLitres)<.001)
 assert.equal(c.quantities.tanks.undergroundLitres,5000)
 assert.equal(lines(c,'underground-water-tank')[0].qty,5)
 assert.equal(lines(c,'underground-water-tank')[0].unit,'m³')
 assert.equal(lines(c,'underground-water-tank')[0].amount,70000)
 assert.equal(lines(c,'drain-tank')[0].qty,3)
 assert.equal(lines(c,'drain-tank')[0].amount,39000)
 assert.equal(lines(c,'water-tanks')[0].qty,s.overheadLitres/2000)
 assert.match(lines(c,'water-tanks')[0].specification,/overhead only/)
 const csv=boqCsv(c);assert.match(csv,/5000 L usable storage/);assert.match(csv,/20 mm nominal/)
 const schedule=specificationSchedule(p.model.brief,c)
 const pipeRows=schedule.filter(r=>r.item==='water-pipes'||r.item==='drain-pipes')
 assert.equal(pipeRows.length,s.runs.length,'Specification export must retain each floor/diameter and its own installed rate')
 for(const row of pipeRows){const line=c.boq.find(l=>l.id===row.id);assert.equal(row.rate,line.rate);assert.equal(row.choice,line.specification)}
 assert.match(schedule.find(r=>r.item==='underground-water-tank').choice,/5000 L/)
})
test('tank off, inspection chamber, septic and holding choices price their own scope without stale quantity reuse',()=>{
 const p=project({'underground-water-tank':'off','drain-tank':'off'}),off=estimateBoq(p)
 assert.equal(off.quantities.tanks.undergroundLitres,0)
 assert.equal(lines(off,'underground-water-tank').length,0);assert.equal(lines(off,'drain-tank').length,0)
 p.model.brief.specs.overrides['drain-tank']='chamber'
 const chamber=estimateBoq(p)
 assert.equal(lines(chamber,'drain-tank')[0].qty,1);assert.equal(lines(chamber,'drain-tank')[0].unit,'item')
 assert.equal(lines(chamber,'drain-tank')[0].amount,6000)
 p.model.brief.specs.overrides['drain-tank']='holding10000'
 p.model.brief.specs.overrides['underground-water-tank']='l10000'
 const holding=estimateBoq(p)
 assert.equal(holding.quantities.plumbing.drain.kind,'holding')
 assert.equal(lines(holding,'drain-tank')[0].qty,10)
 assert.equal(holding.quantities.tanks.undergroundLitres,10000)
 assert.equal(holding.defaultExpected,off.defaultExpected,'Changing a capacity must not rewrite the default comparison')
})
test('pipe sizes and materials change the right rates while preserving lengths, rooms, model identity and render signature',()=>{
 const small=project({'water-pipe-size':'mm15','soil-pipe-size':'mm110','underground-water-tank':'off'})
 const large=project({'water-pipe-size':'mm32','water-riser-size':'mm50','soil-pipe-size':'mm160','water-pipes':'pex','drain-pipes':'low-noise','underground-water-tank':'l15000','drain-tank':'septic5000'})
 const a=estimateBoq(small),b=estimateBoq(large)
 assert.equal(a.quantities.plumbing.waterLengthM,b.quantities.plumbing.waterLengthM)
 assert.equal(a.quantities.plumbing.drainLengthM,b.quantities.plumbing.drainLengthM)
 assert.ok(lines(b,'water-pipes').reduce((n,l)=>n+l.amount,0)>lines(a,'water-pipes').reduce((n,l)=>n+l.amount,0))
 assert.ok(lines(b,'drain-pipes').every(l=>/160 mm|75 mm/.test(l.specification)))
 assert.deepEqual(createBuildingModel(small),createBuildingModel(large))
 assert.equal(geometryCostKey(small),geometryCostKey(large))
 assert.deepEqual(geometryBrief(small.model.brief),geometryBrief(large.model.brief))
 assert.equal(finishSignature(small.model.brief),finishSignature(large.model.brief),'Cost-only pipe choices cannot trigger a villa re-render')
 assert.notEqual(finishSignature(large.model.brief),finishSignature({...large.model.brief,specs:{overrides:{'interior-paint':'premium'}}}))
})
test('all finish presets and saved briefs retain valid service defaults and choices',()=>{
 for(const preset of finishPresets.presets){
  const brief={...defaultBrief(),finish:preset.id}
  for(const id of PLUMBING_ITEM_IDS)assert.ok(resolveSpecification(brief,id).id)
 }
 const p=project({'underground-water-tank':'l10000','drain-tank':'holding5000','water-riser-size':'mm40'})
 const restored=briefSchema.parse(JSON.parse(JSON.stringify(p.model.brief)))
 assert.deepEqual(restored.specs,p.model.brief.specs)
 assert.equal(plumbingSchedule(p,restored).underground.capacityLitres,10000)
})
test('saved cost snapshots retain their plumbing schedule and safely reprice pre-services snapshots',()=>{
 const p=project({'underground-water-tank':'l5000','drain-tank':'septic3000'}),cost=estimateBoq(p)
 const snapshot=snapshotCost(p,p.model.brief,cost),restored=parseCostReplay(JSON.parse(JSON.stringify(snapshot)))
 assert.deepEqual(restored.cost.quantities.plumbing,cost.quantities.plumbing)
 restoreCostReplay(restored)
 assert.deepEqual(replayedCost(p,p.model.brief).quantities.plumbing,cost.quantities.plumbing)
 const old=structuredClone(snapshot);delete old.cost.quantities.plumbing
 assert.ok(parseCostReplay(old),'A historical estimate must remain readable')
 restoreCostReplay(parseCostReplay(old));assert.equal(replayedCost(p,p.model.brief),null)
 const bad=structuredClone(snapshot);bad.cost.quantities.plumbing.runs[0].lengthM+=10
 assert.equal(parseCostReplay(bad),null)
 restoreCostReplay(null)
})
