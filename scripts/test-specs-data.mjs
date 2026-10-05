import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { specificationData, validateSpecificationData } from '../src/lib/cost/data/validated.ts'
import { photoSchema, ratesSchema } from '../src/lib/cost/data/schemas.ts'
import { specificationChoices, specificationRate } from '../src/lib/cost/catalogue.ts'
const root=fileURLToPath(new URL('../',import.meta.url))
const path=relative=>root+relative
const {rates,catalogue,presets,materials}=specificationData
const validate=(r=rates,s=catalogue,p=presets,m=materials)=>validateSpecificationData(r,s,p,m)
const hash=bytes=>createHash('sha256').update(bytes).digest('hex')
function jpegSize(bytes){
 let pos=2
 while(pos<bytes.length){
  if(bytes[pos++]!==255) continue
  let marker=bytes[pos++];while(marker===255)marker=bytes[pos++]
  if(marker===216||marker===217)continue
  const len=bytes.readUInt16BE(pos)
  if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker))return [bytes.readUInt16BE(pos+5),bytes.readUInt16BE(pos+3)]
  pos+=len
 }
 throw Error('No JPEG image dimensions')
}
test('all 19 groups, levels and presets have complete, valid option and rate references',()=>{
 assert.equal(catalogue.groups.length,19);assert.equal(presets.presets.length,3)
 assert.ok(catalogue.items.length>=80)
 for(const preset of presets.presets)assert.equal(Object.keys(preset.options).length,catalogue.items.length)
 for(const item of catalogue.items)for(const option of item.options)assert.ok(specificationRate(option.rateId).installed>=0)
 assert.ok(specificationChoices('main').every(i=>i.level==='main'))
 assert.ok(['sanitary','cp-fittings'].every(id=>catalogue.items.find(i=>i.id===id).options.length>=8))
 assert.ok(['lift','solar','automation','interiors','ev','cctv'].every(id=>catalogue.items.find(i=>i.id===id).control==='toggle'))
 assert.ok(!specificationChoices('more').some(i=>i.level==='auto'))
})
test('every material and photo is present, original-size and byte-linked to its Blender texture',()=>{
 for(const material of materials.materials){
  assert.ok(existsSync(path(material.texture)));assert.ok(existsSync(path(material.webFile)))
  const original=readFileSync(path(material.texture)),web=readFileSync(path(material.webFile))
  assert.equal(hash(original),material.sha256);assert.equal(hash(web),material.webSha256)
  assert.deepEqual(jpegSize(original),[material.width,material.height]);assert.ok(Math.max(...jpegSize(original))>=1600)
  assert.equal(Math.max(...jpegSize(web)),800)
 }
 for(const item of catalogue.items.filter(i=>['main','more'].includes(i.level)))for(const option of item.options){
  const material=materials.materials.find(m=>m.id===option.blenderMaterial)
  if(option.flooringProductId||option.finishProductId||option.experienceOptionId){assert.ok(material);assert.equal(option.photos.length,0);continue}
  assert.ok(option.photos.some(p=>p.kind==='closeup'&&p.file===material.texture&&p.sha256===material.sha256))
 }
})
test('broken presets, missing rates, missing materials and mismatched photos fail before use',()=>{
 const s=structuredClone(catalogue),p=structuredClone(presets),m=structuredClone(materials)
 p.presets[0].options['main-door']='nonexistent';assert.throws(()=>validate(rates,catalogue,p),/invalid option/)
 s.items[0].options[0].rateId='missing';assert.throws(()=>validate(rates,s),/missing rate/)
 m.materials.pop();assert.throws(()=>validate(rates,catalogue,presets,m),/missing Blender material/)
 const changed=structuredClone(catalogue),item=changed.items.find(i=>i.level==='main')
 item.options[0].photos[0].file='blender/assets/textures/another.jpg';assert.throws(()=>validate(rates,changed),/exact Blender texture/)
})
test('unknown photo sources, false human verification, low resolution and unsafe paths are rejected',()=>{
 const photo=catalogue.items.find(i=>i.level==='main').options[0].photos[0]
 for(const change of [{source:'https://unknown.example/image.jpg'},{source:'https://polyhaven.com.evil.example/a/file'},
  {kind:'installed'},{verifiedBy:'AI generated'},{width:799,height:799},{file:'../../private/file.jpg'},
  {kind:'visualisation',source:'blender://sample',caption:'Product photo'}])assert.equal(photoSchema.safeParse({...photo,...change}).success,false)
 assert.equal(photoSchema.safeParse({...photo,kind:'installed',source:'team://entry-01',licence:'Team owned',verifiedBy:'human:Aryan; original file reviewed 2026-10-03'}).success,true)
})
test('rates enforce allowance limits, positive bands, dates, units and finite material/labour splits',()=>{
 for(const change of [{overheadPct:9},{overheadPct:16},{contingencyPct:4},{contingencyPct:11},{gstPct:101},{date:'2026-02-30'}])
  assert.equal(ratesSchema.safeParse({...rates,settings:{...rates.settings,...change}}).success,false)
 const bad=structuredClone(rates);bad.items[0].material=-1;assert.equal(ratesSchema.safeParse(bad).success,false)
 const duplicate=structuredClone(rates);duplicate.items.push(duplicate.items[0]);assert.equal(ratesSchema.safeParse(duplicate).success,false)
})
