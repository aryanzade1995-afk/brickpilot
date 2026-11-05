import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createWalkthroughSource} from '../src/lib/walkthrough/source.ts'
import {buildWalkthroughScene} from '../src/lib/walkthrough/scene.ts'
import {prepareWalkthroughAppearance,prepareWalkthroughGeometry} from '../src/lib/walkthrough/delivery.ts'
import {instantiateInteriorModel} from '../src/lib/three/interiorModelAssets.ts'
import {Group,Mesh,BoxGeometry,MeshStandardMaterial} from 'three'
const plan=JSON.parse(readFileSync(new URL('./fixtures/walkthrough-room-regression.json',import.meta.url)))
const prepare=d=>{
 const source=createWalkthroughSource(d,{hardChecksPass:true},{style:'modern',lighting:'daylight',furnitureDensity:'medium'})
 return prepareWalkthroughAppearance(d,source,prepareWalkthroughGeometry(buildWalkthroughScene(source.building,{hardChecksPass:true})))
}
test('each selected tap and overhead head uses its own fitting variant and supported attachment, preserving architecture',()=>{
 for(let variant=0;variant<5;variant++){
  const d=structuredClone(plan)
  d.model.brief.specs.overrides['cp-fittings']='svc-faucet-'+(variant+1)
  d.model.brief.specs.overrides['bath-shower']='svc-shower-'+(variant+1)
  const before=JSON.stringify(d),app=prepare(d)
  const taps=app.models.filter(m=>m.assetId.startsWith('basin-tap-')),showers=app.models.filter(m=>m.assetId.startsWith('shower-set-'))
  assert.ok(taps.length>0&&showers.length>0)
  for(const m of [...taps,...showers]){
   assert.ok(m.assetId.endsWith('-'+variant))
   assert.ok(m.scale.every(n=>n>0&&n<=1))
   assert.ok(m.scale.every(n=>n===m.scale[0]),'fittings preserve their proportions')
   const anchor=app.furniture.find(p=>m.replaces.includes(p.id)&&p.sourceIds.some(id=>id.endsWith('-anchor')))
   assert.deepEqual(m.position,anchor.position)
   assert.ok(m.sourceProduct)
   for(const other of app.models.filter(n=>n.id!==m.id))assert.ok(!other.replaces.some(id=>m.replaces.includes(id)),'tap cannot be swallowed by the basin replacement')
  }
  assert.equal(JSON.stringify(d),before)
 }
})
test('selected metal finish changes the fitting without recolouring nozzle rubber or sharing mutable materials',async()=>{
 const instance=prepare(plan).models.find(m=>m.assetId.startsWith('shower-set-'))
 const source=new Group(),metal=new MeshStandardMaterial({color:'#888888',metalness:1}),rubber=new MeshStandardMaterial({color:'#111111',metalness:0})
 source.add(new Mesh(new BoxGeometry(),metal),new Mesh(new BoxGeometry(),rubber))
 for(const color of ['#BA9856','#202326','#BDC5CD']){
  const result=await instantiateInteriorModel({...instance,hardwareColor:color},async()=>source),materials=[]
  result.traverse(o=>{if(o instanceof Mesh)materials.push(o.material)})
  assert.equal(materials[0].color.getHexString(),color.slice(1).toLowerCase())
  assert.equal(materials[1].color.getHexString(),'111111')
  assert.equal(metal.color.getHexString(),'888888')
 }
})

test('every basin fitting is one compact mixer with hot/cold indicators',()=>{
 for(let variant=0;variant<5;variant++){
  const bytes=readFileSync(new URL(`../public/bath-hardware/basin-tap-${variant}.glb`,import.meta.url))
  const json=JSON.parse(bytes.toString('utf8',20,20+bytes.readUInt32LE(12)))
  assert.ok(json.materials.some(m=>m.name.startsWith('Hot index')))
  assert.ok(json.materials.some(m=>m.name.startsWith('Cold index')))
  const bounds=json.accessors.filter(a=>a.type==='VEC3'&&a.min&&a.max)
  const lo=[0,1,2].map(i=>Math.min(...bounds.map(b=>b.min[i])))
  const hi=[0,1,2].map(i=>Math.max(...bounds.map(b=>b.max[i])))
  assert.ok(hi[0]-lo[0]<.08,'single mixer width')
  assert.ok(hi[1]-lo[1]<.16,'tap height')
  assert.ok(hi[2]-lo[2]<.18,'spout reach')
 }
})
