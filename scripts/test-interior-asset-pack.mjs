import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {createHash} from 'node:crypto'
import {Box3,Texture,Vector3,Group,Mesh,BoxGeometry,MeshStandardMaterial} from 'three'
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js'
import {interiorAssets,automaticInteriorModel,setInteriorModel,selectedInteriorModel} from '../src/lib/interior-assets/catalogue.ts'
import {instantiateInteriorModel} from '../src/lib/three/interiorModelAssets.ts'
import {defaultBrief,briefSchema,geometryBrief} from '../src/lib/model/brief.ts'
import {compile} from '../src/lib/model/canonical.ts'
import {generate} from '../src/lib/engine/generate.ts'
import {createWalkthroughSource} from '../src/lib/walkthrough/source.ts'
import {buildWalkthroughScene} from '../src/lib/walkthrough/scene.ts'
import {prepareWalkthroughGeometry,prepareWalkthroughAppearance,furnitureColliders} from '../src/lib/walkthrough/delivery.ts'
import {finishSignature} from '../src/lib/cost/finishAssignments.ts'
import {estimateBoq} from '../src/lib/cost/boq.ts'
import {disposeWalkthroughAsset} from '../src/lib/three/loadWalkthroughAsset.ts'
const b=defaultBrief();b.site.plotWidth=25;b.site.plotDepth=30;b.levels.storeys=1
const plan=generate(compile(b),{seed:41}),prefs={style:'modern',lighting:'daylight',furnitureDensity:'medium'}
const prepare=d=>{const source=createWalkthroughSource(d,{hardChecksPass:true},prefs);const geometry=prepareWalkthroughGeometry(buildWalkthroughScene(source.building,{hardChecksPass:true}));return {source,geometry,app:prepareWalkthroughAppearance(d,source,geometry)}}
test('all shipped models have source notices, bounded detail, matching hashes and metre Y-up geometry',async()=>{
 assert.equal(interiorAssets.filter(a=>!a.id.startsWith('user-')).length,23)
 assert.equal(interiorAssets.filter(a=>a.id.startsWith('user-')).length,13)
 for(const a of interiorAssets){
  assert.ok(a.author&&(a.provenance==='user-supplied'?a.license==='User-supplied · rights unverified':['CC-BY-3.0','CC0-1.0'].includes(a.license)),a.id)
  assert.ok(a.triangles<=18100&&a.bytes<6e6,a.id)
  const bytes=fs.readFileSync('public'+a.url)
  assert.equal(createHash('sha256').update(bytes).digest('hex'),a.sha256)
  assert.ok(fs.readFileSync('public'+a.notice,'utf8').includes(a.author))
  const loader=new GLTFLoader().register(()=>({name:'GEOMETRY_QA',loadTexture:()=>Promise.resolve(new Texture())})),g=await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'')
  const bounds=new Box3().setFromObject(g.scene),size=bounds.getSize(new Vector3()).toArray()
  size.forEach((v,i)=>assert.ok(Math.abs(v-a.sizeM[i])<.002,a.id+' axes '+i))
  assert.ok(Math.abs(bounds.min.y)<.002,a.id+' floor anchor');assert.ok(Math.abs(bounds.getCenter(new Vector3()).x)<.002&&Math.abs(bounds.getCenter(new Vector3()).z)<.002,a.id+' centre')
 }
})
test('model selection persists in the existing brief without architectural or cost changes',()=>{
 const next=setInteriorModel(plan.model.brief,'sofa','procedural')
 assert.equal(selectedInteriorModel(briefSchema.parse(next),'sofa'),'procedural')
 assert.deepEqual(geometryBrief(next),geometryBrief(plan.model.brief))
 assert.equal(finishSignature(next),finishSignature(plan.model.brief))
 assert.deepEqual(estimateBoq(plan,next),estimateBoq(plan,plan.model.brief))
 assert.throws(()=>setInteriorModel(next,'bed','fan'))
})
test('room-scoped model changes affect only that room and leave shared architecture immutable',()=>{
 const before=prepare(plan),sofa=before.app.models.find(m=>m.assetId===automaticInteriorModel('sofa'));assert.ok(sofa)
 const room=before.source.rooms.find(r=>r.key===sofa.roomId),next=structuredClone(plan)
 next.model.brief=setInteriorModel(next.model.brief,'sofa','procedural',room.finishRoomKey)
 const after=prepare(next)
 assert.notEqual(before.source.appearanceKey,after.source.appearanceKey)
 assert.equal(before.source.geometryKey,after.source.geometryKey)
 assert.deepEqual(before.geometry,after.geometry)
 assert.ok(!after.app.models.some(m=>m.roomId===room.key&&m.assetId===automaticInteriorModel('sofa')))
 assert.deepEqual(after.app.models.filter(m=>m.roomId!==room.key),before.app.models.filter(m=>m.roomId!==room.key))
 assert.deepEqual(after.app.furniture,before.app.furniture,'the source placement/collision fallback is retained')
})
test('each imported instance fits entirely within its original furniture envelope',()=>{
 const {app}=prepare(plan);assert.ok(app.models.length>10)
 for(const m of app.models){
  assert.ok(m.size.every(v=>v>0)&&m.scale.every(v=>v>0));assert.equal(new Set(m.replaces).size,m.replaces.length)
  const parts=app.furniture.filter(p=>m.replaces.includes(p.id)),bounds=new Box3()
  for(const p of parts){const c=Math.abs(Math.cos(p.rotation)),s=Math.abs(Math.sin(p.rotation)),size=[p.size[0]*c+p.size[2]*s,p.size[1],p.size[0]*s+p.size[2]*c];bounds.expandByPoint(new Vector3(...p.position.map((v,i)=>v-size[i]/2)));bounds.expandByPoint(new Vector3(...p.position.map((v,i)=>v+size[i]/2)))}
  const collider=furnitureColliders({...app,models:[m]}).find(c=>c.id===m.id)
  assert.ok(bounds.expandByScalar(.001).containsPoint(new Vector3(...collider.min))&&bounds.containsPoint(new Vector3(...collider.max)),m.assetId+' outside existing placement')
 }
})
test('wall-hung WC uses its complete fixture and flush-plate envelope rather than shrinking to the bowl height',()=>{
 const next=structuredClone(plan);next.model.brief.specs.overrides.sanitary='premium'
 const {app}=prepare(next),models=app.models.filter(m=>m.assetId==='toilet-wall')
 assert.ok(models.length)
 for(const m of models){assert.ok(m.size[0]>.25&&m.size[2]>.35,JSON.stringify(m.size));assert.ok(m.replaces.some(id=>id.includes('flush-plate')))}
 for(const m of prepare(next).app.models.filter(m=>m.assetId==='fan'))assert.ok(!m.replaces.some(id=>id.includes('fan-light')),'selected underlights stay fitted beneath the imported fan')
})
test('selected paint recolours owned materials and preserves shared PBR geometry/maps',async()=>{
 const asset=interiorAssets.find(a=>a.id==='fan'),template=new Group(),material=new MeshStandardMaterial({color:'#111111',roughness:.32});material.userData.formsteadFinishRole='paint'
 const geometry=new BoxGeometry();geometry.userData.sharedInteriorAsset=true;template.add(new Mesh(geometry,material))
 const instance={assetId:'fan',assetRevision:asset.sha256,id:'test',roomId:'room',floorId:'GF',position:[2,3,4],rotation:0,size:[1,1,1],scale:[1,1,1],color:'#eeeedd',replaces:[]}
 const rendered=await instantiateInteriorModel(instance,async()=>template),mesh=rendered.children[0].children[0]
 assert.equal(mesh.material.color.getHexString(),'eeeedd');assert.equal(material.color.getHexString(),'111111');assert.equal(mesh.geometry,geometry)
 let disposed=false;geometry.addEventListener('dispose',()=>disposed=true);disposeWalkthroughAsset(rendered);assert.equal(disposed,false)
})


test('all seven user files contribute individually traced furniture, with no imported room shells or mirrors',()=>{
 const imported=interiorAssets.filter(a=>a.provenance==='user-supplied')
 assert.equal(new Set(imported.map(a=>a.sourceFile)).size,7)
 for(const a of imported){
  assert.match(a.sourceSha256,/^[a-f0-9]{64}$/)
  assert.ok(a.sourceObjects.length>0&&a.sourceObjects.length<60,a.id)
  assert.ok(a.sourceObjects.every(n=>!/mirror|window wall|groundPlane|^Plane$/i.test(n)),a.id)
  assert.ok(fs.readFileSync('public'+a.notice,'utf8').includes('No open licence is asserted'))
 }
})
test('uploaded defaults and selectable alternatives preserve existing product costs and room architecture',()=>{
 assert.equal(automaticInteriorModel('sofa'),'user-sofa')
 assert.equal(automaticInteriorModel('desk'),'user-office-desk')
 assert.equal(automaticInteriorModel('office-chair'),'user-office-chair')
 assert.equal(automaticInteriorModel('storage-cabinet'),'procedural')
 let next=plan.model.brief
 for(const [category,id] of [['kitchen-upper','user-kitchen-upper'],['kitchen-base','user-library-drawers'],['storage-cabinet','user-service-cabinet']]){
  next=setInteriorModel(next,category,id)
  assert.equal(selectedInteriorModel(briefSchema.parse(next),category),id)
 }
 assert.deepEqual(geometryBrief(next),geometryBrief(plan.model.brief))
 assert.deepEqual(estimateBoq(plan,next),estimateBoq(plan,plan.model.brief))
 const {app}=prepare(plan)
 assert.ok(app.models.some(m=>m.assetId==='user-sofa'))
 assert.ok(app.models.some(m=>m.assetId==='user-bathroom-basin'))
 assert.ok(!app.models.some(m=>m.assetId==='user-service-cabinet'),'industrial roadside cabinet is opt-in')
})
