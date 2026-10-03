import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { createServer } from 'vite'
import { fileURLToPath } from 'node:url'
import { compile } from '../src/lib/model/canonical.ts'
import { defaultBrief } from '../src/lib/model/brief.ts'
import { generate } from '../src/lib/engine/generate.ts'
import { validate } from '../src/lib/rules/index.ts'
import { geometryCostKey } from '../src/lib/cost/quantities.ts'
import { defaultSelection } from '../src/lib/cost/specifications.ts'
import { estimateSelectedBoq, estimateProjectBoq } from '../src/lib/cost/index.ts'
const storage=new Map()
globalThis.localStorage={getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)}
globalThis.window={localStorage:globalThis.localStorage,atob:globalThis.atob,btoa:globalThis.btoa}
const server=await createServer({configFile:false,resolve:{alias:{'@':fileURLToPath(new URL('../src',import.meta.url))}},
 optimizeDeps:{noDiscovery:true,entries:[]},server:{middlewareMode:true,watch:null,hmr:false,ws:false},appType:'custom'})
after(()=>server.close())
const {useFinishes}=await server.ssrLoadModule('/src/state/finishes.ts')
const {FinishesCostView}=await server.ssrLoadModule('/src/routes/FinishesCost.tsx')
const {FloorDrawing}=await server.ssrLoadModule('/src/lib/draw/FloorDrawing.tsx')
const design=generate(compile(defaultBrief())),report=validate(design),key=geometryCostKey(design)
const result={design,model:design.model,report}
const render=(source=result,tab='specifications')=>renderToStaticMarkup(React.createElement(MemoryRouter,{initialEntries:[`/workspace/finishes?tab=${tab}`]},React.createElement(FinishesCostView,{result:source})))
test('finish choices persist independently per geometry without changing the design or seed',async()=>{
 const before=JSON.stringify(design),s=defaultSelection('refined')
 useFinishes.setState({entries:{}});useFinishes.getState().setSelection(key,s)
 await useFinishes.persist.rehydrate()
 assert.deepEqual(useFinishes.getState().entries[key],s)
 const changed=structuredClone(design);changed.floors[0].rooms[0].rect.w+=100
 assert.notEqual(geometryCostKey(changed),key)
 assert.equal(useFinishes.getState().entries[geometryCostKey(changed)],undefined)
 assert.equal(JSON.stringify(design),before)
})
test('cost step has defaults, seven-step navigation and collapsed advanced choices with no photo fabrication',()=>{
 useFinishes.setState({entries:{}})
 const html=render()
 assert.ok(html.includes('Finishes &amp; Cost'));assert.ok(html.includes('Concept estimate ±15%'))
 assert.ok(html.includes('Continue to Report'));assert.ok(html.includes('06.1'));assert.ok(html.includes('06.4'))
 assert.ok(html.includes('More options'));assert.ok(html.includes('0 changes'))
 assert.ok(html.includes('<img'));assert.ok(html.includes('real texture close-up'));assert.ok(!html.toLowerCase().includes('budget'))
 assert.ok(html.indexOf('Finishes &amp; Cost')<html.indexOf('Report'))
 const estimate=render(result,'estimate')
 assert.ok(estimate.includes('Top cost drivers'));assert.ok(estimate.includes('Approvals allowance'))
 const cost=estimateSelectedBoq(design);assert.ok(estimate.includes(new Intl.NumberFormat('en-IN',{maximumFractionDigits:0}).format(cost.expected)))
})
test('invalid source plan does not show prices or allow specification editing',()=>{
 const html=render({...result,report:{...report,hardChecksPass:false}});assert.ok(html.includes('Choose a valid floor plan first'))
 assert.ok(!html.includes('Estimated total'));assert.ok(!html.includes('Indoor flooring'))
})

test('four cost tabs expose quantities, trade shares and assumptions; room filters restrict per-room finishes',()=>{
 useFinishes.setState({entries:{}})
 const q=render(result,'quantities'),e=render(result,'estimate'),a=render(result,'assumptions')
 assert.ok(q.includes('Measured quantities'));assert.ok(q.includes('Show on plan'));assert.ok(q.includes('NetVolume'))
 assert.ok(e.includes('Material + labour'));assert.ok(e.includes('Download BOQ CSV'));assert.ok(e.includes('share')||e.includes('%'))
 assert.ok(a.includes('Rates source &amp; date'));assert.ok(a.includes('Excluded'))
 const room=estimateProjectBoq(design).quantities.rooms.find(r=>r.name==='Kitchen')
 const html=renderToStaticMarkup(React.createElement(MemoryRouter,{initialEntries:[`/workspace/finishes?room=${encodeURIComponent(room.id)}`]},React.createElement(FinishesCostView,{result})))
 assert.ok(html.includes('Kitchen flooring'));assert.ok(!html.includes('Bedroom flooring'))
})

test('room links and quantity highlights are rendering overlays and preserve every source floor',()=>{
 const before=JSON.stringify(design.floors)
 const html=renderToStaticMarkup(React.createElement(FloorDrawing,{floor:design.floors[0],model:design.model,highlightCategory:'concrete.columns',onRoomClick:()=>{}}))
 assert.ok(html.includes('data-layer="quantity-highlight"'));assert.ok(html.includes('data-quantity="concrete.columns"'))
 assert.ok(html.includes('Choose finishes for Kitchen'));assert.ok(html.includes('tabindex="0"'))
 assert.equal(JSON.stringify(design.floors),before)
})

test('quantity revisions report geometry changes only and persist across reloads',async()=>{
 const {quantitySignature}=await server.ssrLoadModule('/src/lib/cost/workspace.ts')
 const before=quantitySignature(estimateProjectBoq(design))
 useFinishes.setState({entries:{},lastMeasured:null,quantitiesUpdated:false})
 useFinishes.getState().noteQuantities(before);assert.equal(useFinishes.getState().quantitiesUpdated,false)
 useFinishes.getState().noteQuantities(before);assert.equal(useFinishes.getState().quantitiesUpdated,false)
 const changed=structuredClone(design);changed.floors[0].rooms[0].rect.w+=100
 useFinishes.getState().noteQuantities(quantitySignature(estimateProjectBoq(changed)))
 assert.equal(useFinishes.getState().quantitiesUpdated,true)
 await useFinishes.persist.rehydrate();assert.equal(useFinishes.getState().quantitiesUpdated,true)
})

test('cost screen prices the current Brief beyond the five legacy dropdowns, without regenerating the plan',()=>{
 useFinishes.setState({entries:{}})
 const brief=structuredClone(design.model.brief);brief.specs.overrides={solar:'on','glass':'double'}
 const before=JSON.stringify(design),cost=estimateProjectBoq(design,brief)
 const html=renderToStaticMarkup(React.createElement(MemoryRouter,{initialEntries:['/workspace/finishes?tab=estimate']},React.createElement(FinishesCostView,{result,brief})))
 assert.ok(html.includes(new Intl.NumberFormat('en-IN',{maximumFractionDigits:0}).format(cost.expected)))
 assert.ok(cost.boq.some(l=>l.item==='solar'&&l.amount===250000));assert.equal(JSON.stringify(design),before)
})

test('PDF exports the selected BOQ through its final row and carries estimate provenance on every page',async()=>{
 const {buildReportPdf}=await server.ssrLoadModule('/src/lib/report/buildPdf.ts')
 const before=JSON.stringify(design),cost=estimateSelectedBoq(design,defaultSelection('refined'))
 const blob=await buildReportPdf({projectName:'Cost review',brief:design.model.brief,design,report,cost,planImages:[],massingImages:[],conceptImages:[]})
 const pdf=Buffer.from(await blob.arrayBuffer()).toString('latin1')
 const amount=new Intl.NumberFormat('en-IN',{maximumFractionDigits:0})
 assert.ok(pdf.startsWith('%PDF-'))
 assert.ok(pdf.includes(`Rs ${amount.format(cost.expected)}`))
 assert.ok(pdf.includes('Natural stone'))
 const last=cost.boq.at(-1)
 assert.ok(pdf.includes(last.label))
 assert.ok(pdf.includes(amount.format(last.amount)))
 const pages=(pdf.match(/\/Type \/Page\b/g)??[]).length
 assert.ok(pages>=2,'the multi-page BOQ fixture exercises continuation pages')
 assert.ok((pdf.match(/Concept estimate/g)??[]).length>=pages)
 assert.ok(pdf.includes(cost.rateVersion))
 assert.ok(pdf.includes('TRADES & PROCUREMENT'));assert.ok(pdf.includes(' / kg'));assert.ok(pdf.includes(' / m3'))
 assert.ok(pdf.includes('Approvals allowance'));assert.ok(pdf.includes('Connections allowance'))
 assert.equal(JSON.stringify(design),before)
})
