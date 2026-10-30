import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {buildDollhouse} from '../src/lib/three/buildDollhouse.ts'
import {furnishedDresser} from '../src/lib/three/dressRoom.ts'
import {setInteriorModel,interiorAsset} from '../src/lib/interior-assets/catalogue.ts'
import {createWalkthroughSource} from '../src/lib/walkthrough/source.ts'
import {buildWalkthroughScene} from '../src/lib/walkthrough/scene.ts'
import {prepareWalkthroughGeometry,prepareWalkthroughAppearance} from '../src/lib/walkthrough/delivery.ts'
const plan=JSON.parse(readFileSync(new URL('./fixtures/walkthrough-room-regression.json',import.meta.url)))
const make=(p,only,vent=false)=>buildDollhouse(p,only,furnishedDresser(p,'modern','medium'),{fullHeightOpenings:vent})

test('uploaded kitchen models agree across walkthrough, furnished and ventilation; worktops stay intact',()=>{
 const before=JSON.stringify(plan),source=createWalkthroughSource(plan,{hardChecksPass:true},{style:'modern',lighting:'daylight',furnitureDensity:'medium'})
 const app=prepareWalkthroughAppearance(plan,source,prepareWalkthroughGeometry(buildWalkthroughScene(source.building,{hardChecksPass:true})))
 const furnished=make(plan),vent=make(plan,undefined,true)
 assert.ok(furnished.models.length>0)
 assert.deepEqual(vent.models,furnished.models)
 for(const entry of furnished.models){
  const matching=app.models.find(m=>m.assetId===entry.instance.assetId&&Math.abs(m.position[0]-entry.instance.position[0])<1e-8&&Math.abs(m.position[2]-entry.instance.position[2])<1e-8)
  assert.ok(matching,entry.instance.assetId)
  matching.size.forEach((v,i)=>assert.ok(Math.abs(v-entry.instance.size[i])<1e-8))
  assert.equal(matching.rotation,entry.instance.rotation)
  assert.ok(interiorAsset(entry.instance.assetId))
  assert.ok(entry.instance.replaces.every(id=>!/-top\d*$/.test(JSON.parse(id)[2])),'cabinet replacement excludes slab')
 }
 assert.ok(furnished.boxes.some(b=>/-top\d*$/.test(b.id)))
 assert.equal(JSON.stringify(plan),before)
})

test('room selection reaches both furnished views and floor isolation preserves the shared model coordinates',()=>{
 const p=structuredClone(plan);p.model.brief=setInteriorModel(p.model.brief,'kitchen-upper','user-kitchen-upper','0:GF_KITCHEN')
 const all=make(p),ground=make(p,0),vent=make(p,0,true)
 const upper=ground.models.filter(m=>m.instance.assetId==='user-kitchen-upper')
 assert.ok(upper.length>0)
 assert.deepEqual(ground.models,vent.models)
 for(const model of ground.models)assert.ok(all.models.some(m=>JSON.stringify(m)===JSON.stringify(model)))
 assert.equal(JSON.stringify(p.floors),JSON.stringify(plan.floors))
})
