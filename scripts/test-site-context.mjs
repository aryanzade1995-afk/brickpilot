import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createBuildingModel} from '../src/lib/engine/buildingModel.ts'
import {siteContext} from '../src/lib/three/siteContext.ts'
const plan=JSON.parse(readFileSync(new URL('./fixtures/walkthrough-room-regression.json',import.meta.url)))
test('illustrative street uses real plot coordinates and preserves the complete source house',()=>{
 const building=createBuildingModel(plan),before=JSON.stringify(building),s=siteContext(building)
 assert.equal(s.width,building.plot.widthMm/1000);assert.equal(s.depth,building.plot.depthMm/1000)
 assert.ok(s.roadZ+3.5< -s.depth,'road is outside plot')
 for(const h of s.homes)assert.ok(h.x+h.w/2<0||h.x-h.w/2>s.width||h.z+h.d/2< -s.depth||h.z-h.d/2>0)
 for(const [x,z] of s.trees)assert.ok(x<0||x>s.width||z< -s.depth||z>0)
 assert.equal(JSON.stringify(building),before)
 assert.throws(()=>siteContext({...building,plot:{...building.plot,widthMm:NaN}}))
})
test('context models are bounded, embedded browser meshes with retained source credits',()=>{
 const base=new URL('../public/exterior-assets/site-context/',import.meta.url)
 const records=JSON.parse(readFileSync(new URL('manifest.json',base)))
 for(const r of records){
  const buffer=readFileSync(new URL(r.file,base)),json=JSON.parse(buffer.subarray(20,20+buffer.readUInt32LE(12)).toString())
  assert.ok(r.triangles<40000,r.file+' complexity budget');assert.ok(json.meshes.length>0)
  assert.ok((json.images??[]).every(i=>!i.uri||i.uri.startsWith('data:')),'textures embedded')
 }
 assert.match(readFileSync(new URL('ATTRIBUTION.md',base),'utf8'),/vicent091036/)
})
