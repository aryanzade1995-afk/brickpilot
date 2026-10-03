import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { specsCatalogue } from '../src/lib/cost/catalogue.ts'
import { finishPreview } from '../src/lib/finishes/preview.ts'
const item=id=>specsCatalogue.items.find(i=>i.id===id)
test('each finish category previews its actual architectural object, not a universal room',()=>{
 for(const [id,kind] of [['windows','window'],['glass','window'],['main-door','door'],['floor-living','floor'],['kitchen-counter','kitchen'],['balcony-railings','railing'],['compound-gate','gate'],['interior-paint','wall'],['false-ceiling','ceiling'],['roof-type','roof'],['contract-type','system']]) {
  assert.equal(finishPreview(item(id),item(id).options[0]).kind,kind)
 }
})
test('preview textures are local audited assets; metal/glass never get a plaster texture',()=>{
 for(const i of specsCatalogue.items)for(const o of i.options){
  const result=finishPreview(i,o)
  if(result.texture)assert.ok(existsSync(`public${result.texture}`))
  if(['windows','glass','window-grills'].includes(i.id)&&!/wood|teak|timber/i.test(o.name))assert.equal(result.texture,undefined)
  if(/marble|statuario|calacatta|onyx|mosaic/i.test(o.name))assert.equal(result.texture,undefined)
 }
})
test('preview is deterministic, does not mutate options, and responds to selected materials',()=>{
 const i=item('main-door'),before=JSON.stringify(i)
 for(const o of i.options)assert.deepEqual(finishPreview(i,o),finishPreview(i,o))
 assert.equal(JSON.stringify(i),before)
 const wood=i.options.find(o=>/teak/i.test(o.name));assert.ok(wood)
 assert.ok(finishPreview(i,wood).texture?.includes('teak'))
 assert.notDeepEqual(finishPreview(i,wood),finishPreview(item('glass'),item('glass').options[0]))
})
