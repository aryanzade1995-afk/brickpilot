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
import { estimateCost } from '../src/lib/cost/index.ts'
const storage=new Map()
globalThis.localStorage={getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)}
globalThis.window={localStorage:globalThis.localStorage}
const server=await createServer({configFile:false,resolve:{alias:{'@':fileURLToPath(new URL('../src',import.meta.url))}},
 optimizeDeps:{noDiscovery:true,entries:[]},server:{middlewareMode:true,watch:null},appType:'custom'})
after(()=>server.close())
const {useFinishes}=await server.ssrLoadModule('/src/state/finishes.ts')
const {FinishesCostView}=await server.ssrLoadModule('/src/routes/FinishesCost.tsx')
const design=generate(compile(defaultBrief())),report=validate(design),key=geometryCostKey(design)
const result={design,model:design.model,report}
const render=(source=result)=>renderToStaticMarkup(React.createElement(MemoryRouter,null,React.createElement(FinishesCostView,{result:source})))
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
 assert.ok(html.includes('Continue to Report'));assert.ok(html.includes('Itemised quantities'))
 assert.ok(html.includes('<details'));assert.ok(!html.includes('<details open'))
 assert.ok(!html.includes('<img'));assert.ok(!html.toLowerCase().includes('budget'))
 assert.ok(html.indexOf('Finishes &amp; Cost')<html.indexOf('Report'))
 const cost=estimateCost(design);assert.ok(html.includes(new Intl.NumberFormat('en-IN',{maximumFractionDigits:0}).format(cost.expected)))
})
test('invalid source plan does not show prices or allow specification editing',()=>{
 const html=render({...result,report:{...report,hardChecksPass:false}});assert.ok(html.includes('Choose a valid floor plan first'))
 assert.ok(!html.includes('Estimated total'));assert.ok(!html.includes('Indoor flooring'))
})
