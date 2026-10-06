import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { specsCatalogue } from '../src/lib/cost/catalogue.ts'
import { finishPreview } from '../src/lib/finishes/preview.ts'
import { optionImage, optionPhotos, photographedOptions, photoRequiredGroups } from '../src/lib/finishes/optionImage.ts'
import { detailedPreviewParts } from '../src/lib/finishes/previewGeometry.ts'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
const item=id=>specsCatalogue.items.find(i=>i.id===id)
test('each finish category previews its actual architectural object, not a universal room',()=>{
 for(const [id,kind] of [['windows','window'],['glass','window'],['main-door','door'],['floor-living','floor'],['kitchen-counter','kitchen'],['balcony-railings','railing'],['compound-gate','gate'],['interior-paint','wall'],['false-ceiling','ceiling'],['roof-type','roof'],['contract-type','system']]) {
  assert.equal(finishPreview(item(id),item(id).options[0]).kind,kind)
 }
})
test('surface previews use the same audited image as their option; installed photos are never tiled',()=>{
 for(const i of specsCatalogue.items)for(const o of i.options){
  const result=finishPreview(i,o)
  if(result.texture&&!result.texture.startsWith('https:'))assert.ok(existsSync(`public${result.texture}`),o.id)
  const image=optionImage(o)
  assert.ok(!/metal_plate/i.test(image?.src??''),o.id)
  assert.ok(!/metal_plate/i.test(result.texture??''),o.id)
  assert.ok(optionPhotos(o).every(p=>![p.file,p.webFile,p.source].some(path=>/metal_plate/i.test(path))),o.id)
  if(result.catalogueColour&&image?.surface)assert.equal(result.texture,image.src,o.id)
  if(result.catalogueColour&&image&&!image.surface)assert.equal(result.texture,undefined,o.id)
 }
})
test('requested sections offer only photographed options; hidden IDs remain valid for saved estimates',()=>{
 for(const i of specsCatalogue.items.filter(i=>photoRequiredGroups.has(i.group))){
  for(const o of photographedOptions(i))assert.ok(optionImage(o)?.src,o.id)
  for(const o of i.options.filter(o=>!optionImage(o)))assert.ok(!photographedOptions(i).some(p=>p.id===o.id))
 }
 assert.ok(item('kitchen-layout').options.length>0)
 assert.equal(photographedOptions(item('kitchen-layout')).length,0)
 assert.ok(photographedOptions(item('internal-door')).length>=9)
 // Retain the real railing references after retiring the three checker-plate placeholders.
 assert.ok(photographedOptions(item('balcony-railings')).length>=7)
})
test('local supplier image copies are byte-identical to their audited download hashes',()=>{
 const assets=JSON.parse(readFileSync('src/lib/finishes/imageAssets.json','utf8'))
 for(const asset of Object.values(assets)){
  assert.ok(asset.path)
  assert.equal(createHash('sha256').update(readFileSync(asset.path)).digest('hex'),asset.sha256)
 }
})
test('railing choices refresh selected parts and distinguish cable, bar, post, frameless and clamp forms',()=>{
 const i=item('balcony-railings')
 const ids=['basic','mid','premium','rail-q-line','rail-alu','rail-square','rail-smart','rail-slim','rail-clamps']
 const signatures=ids.map(id=>{
  const o=i.options.find(o=>o.id===id),p=detailedPreviewParts(i,o)
  assert.ok(p.some(p=>p.selected),id)
  return JSON.stringify({p,image:optionImage(o)})
 })
 assert.equal(new Set(signatures).size,ids.length)
})
test('preview is deterministic, does not mutate options, and responds to selected materials',()=>{
 const i=item('main-door'),before=JSON.stringify(i)
 for(const o of i.options)assert.deepEqual(finishPreview(i,o),finishPreview(i,o))
 assert.equal(JSON.stringify(i),before)
 const wood=i.options.find(o=>/teak/i.test(o.name));assert.ok(wood)
 assert.ok(finishPreview(i,wood).texture?.includes('teak'))
 assert.notDeepEqual(finishPreview(i,wood),finishPreview(item('glass'),item('glass').options[0]))
})
