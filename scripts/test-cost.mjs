import assert from 'node:assert/strict'
import test from 'node:test'
import { defaultBrief, briefSchema } from '../src/lib/model/brief.ts'
import { compile } from '../src/lib/model/canonical.ts'
import { generate } from '../src/lib/engine/generate.ts'
import { estimateSelectedBoq, boqCsv } from '../src/lib/cost/index.ts'
import { measureDesign, measuredArea } from '../src/lib/cost/quantities.ts'
import { defaultSelection, parseSelection, policy } from '../src/lib/cost/specifications.ts'
const design = generate(compile(defaultBrief()))
test('quantity-driven estimate reconciles lines, allowances and explicit concept band', () => {
 const c=estimateSelectedBoq(design),direct=c.boq.reduce((sum,l)=>sum+l.quantity*l.rate,0)
 assert.equal(c.lines[0].expected,direct);assert.equal(c.expected,c.lines.reduce((sum,l)=>sum+l.expected,0))
 assert.ok(Math.abs(c.total.low-c.expected*.85)<.001);assert.ok(Math.abs(c.total.high-c.expected*1.15)<.001)
 assert.equal(c.lines.find(l=>l.label==='GST provision').expected,0)
 assert.ok(c.label.includes(`Pune rates ${policy.date}`));assert.ok(c.boq.some(x=>x.item==='kitchen-cabinets'))
 assert.ok(c.excluded.some(x=>x.includes('movable furniture')))
})
test('geometry controls quantities despite damaged cached totals; pricing never mutates floors',()=>{
 const copy=structuredClone(design),before=JSON.stringify(copy.floors),original=estimateSelectedBoq(copy)
 copy.builtAreaSqm=999999;copy.openingCounts={doors:999,windows:999}
 for(const f of copy.floors)for(const r of f.rooms)r.area=99999
 const current=estimateSelectedBoq(copy)
 assert.equal(current.expected,original.expected);assert.deepEqual(current.quantities,original.quantities)
 assert.equal(current.quantities.doorCount,original.quantities.doorCount)
 assert.equal(JSON.stringify(design.floors),before);assert.deepEqual(estimateSelectedBoq(design),estimateSelectedBoq(design))
})
test('footprint unions and clipped courtyard/double-height holes are counted once',()=>{
 const a={x:0,y:0,w:4000,h:4000},b={x:2000,y:0,w:4000,h:4000},hole={x:1000,y:1000,w:2000,h:2000}
 assert.equal(measuredArea([a,b],[hole,hole,{x:8000,y:0,w:2000,h:2000}]),20)
})
test('exposed lower roofs and double-height caps are priced without inventing an intermediate floor',()=>{
 const d=structuredClone(design),base=d.floors[0]
 d.floors=[{...base,level:0,footprint:[{x:0,y:0,w:6000,h:4000}],courtyard:null,doubleHeightVoids:[]},
  {...base,level:1,footprint:[{x:0,y:0,w:2000,h:4000}],courtyard:null,
   doubleHeightVoids:[{rect:{x:2000,y:0,w:2000,h:4000},roomId:'void',sourceRoomId:'living'}]}]
 const q=measureDesign(d)
 assert.equal(q.floorArea,32);assert.equal(q.roofArea,24)
})
test('opening areas subtract from walls, open passages have no door cost',()=>{
 const d=structuredClone(design),f=d.floors[0]
 d.floors=[{...f,footprint:[{x:0,y:0,w:4000,h:4000}],rooms:[],courtyard:null,doubleHeightVoids:[],
  walls:[{a:{x:0,y:0},b:{x:4000,y:0},kind:'exterior',thickness:200,heightMm:3000}],
  openings:[{kind:'entry',at:{x:1000,y:0},orient:'h',width:1200,head:2400},
   {kind:'window',at:{x:3000,y:0},orient:'h',width:1000,sill:900,head:2100}]}]
 let q=measureDesign(d);assert.equal(q.doorArea,2.88);assert.equal(q.windowArea,1.2);assert.ok(Math.abs(q.wallArea-7.92)<1e-9)
 d.floors[0].openings[0].leaf=false;q=measureDesign(d);assert.equal(q.doorArea,0);assert.equal(q.doorCount,0)
})
test('specification changes prices only; room override affects only that room flooring specification',()=>{
 const low=estimateSelectedBoq(design,defaultSelection('simple')),high=estimateSelectedBoq(design,defaultSelection('refined'))
 // Finish presets also select concrete/masonry products; physical take-off stays identical.
 const physical=({concreteMaterials:_concrete,masonryMaterials:_masonry,...q})=>q
 assert.deepEqual(physical(low.quantities),physical(high.quantities));assert.ok(high.expected>low.expected)
 const s=defaultSelection(),room=low.quantities.rooms[0],before=estimateSelectedBoq(design,s);s.roomFloors[room.id]='stone'
 const after=estimateSelectedBoq(design,s),changed=after.boq.filter((l,i)=>l.amount!==before.boq[i].amount)
 assert.ok(changed.some(l=>l.id===`floor:${room.id}`));assert.ok(changed.every(l=>l.roomId===room.id&&l.item==='floor-other'))
})
test('GST bases are explicit and corrupt saved percentages/options recover safely',()=>{
 const s=defaultSelection();s.includeGst=true;const c=estimateSelectedBoq(design,s),l=c.lines
 assert.equal(l[4].expected,(l[0].expected+l[1].expected+l[2].expected)*s.gstPercent/100)
 assert.deepEqual(parseSelection({choices:{floor:'missing'},overheadPercent:Infinity,feePercent:-1,contingencyPercent:999,roomFloors:{bad:'missing'}}),defaultSelection())
})
test('CSV includes provenance, quantities and totals and escapes spreadsheet formulas',()=>{
 const d=structuredClone(design);d.floors[0].rooms.find(r=>!r.outdoor).name='=HYPERLINK("bad")'
 const c=estimateSelectedBoq(d),csv=boqCsv(c)
 assert.ok(csv.includes(c.label));assert.ok(csv.includes('Expected total'));assert.ok(csv.includes('CPWD'))
 assert.ok(csv.includes('"Quantity"'));assert.ok(!csv.includes('"=HYPERLINK'))
})
test('legacy spending fields strip silently without changing geometry or estimate',()=>{
 const a=defaultBrief(),b=briefSchema.parse({...a,budget:{amountLakh:5,finish:'premium',scope:'all'}})
 assert.deepEqual(a,b);assert.ok(!('budget' in b));const other=generate(compile(b))
 assert.deepEqual(other,design);assert.deepEqual(estimateSelectedBoq(other),estimateSelectedBoq(design))
})
