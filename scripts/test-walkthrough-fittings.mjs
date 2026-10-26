import test from 'node:test'
import assert from 'node:assert/strict'
import {Group,Mesh,BoxGeometry,MeshStandardMaterial,DoubleSide,FrontSide,Raycaster,Vector3} from 'three'
import {defaultBrief} from '../src/lib/model/brief.ts'
import {compile} from '../src/lib/model/canonical.ts'
import {generate} from '../src/lib/engine/generate.ts'
import {createWalkthroughSource} from '../src/lib/walkthrough/source.ts'
import {buildWalkthroughScene} from '../src/lib/walkthrough/scene.ts'
import {prepareWalkthroughGeometry,prepareWalkthroughAppearance} from '../src/lib/walkthrough/delivery.ts'
import {placeCeilingFitting} from '../src/lib/walkthrough/fittingLayout.ts'
import {prepareWalkthroughShell} from '../src/lib/three/walkthroughShell.ts'
import {reconcileAcceptedFittingSupports,replaceAcceptedLegacyLights} from '../src/lib/three/acceptedFittingSupports.ts'
import {applyWalkthroughMaterialBindings} from '../src/lib/three/loadWalkthroughAsset.ts'
import {batchWalkthroughScene} from '../src/lib/three/walkthroughBatches.ts'
import {WALKING} from '../src/lib/walkthrough/navigation.ts'
import {interiorFinishes} from '../src/lib/interior/finishes.ts'
import {specsCatalogue} from '../src/lib/cost/catalogue.ts'
const brief=defaultBrief();brief.site.plotWidth=25;brief.site.plotDepth=30
const plan=generate(compile(brief),{seed:41}),prefs={style:'indian-contemporary',lighting:'warm',furnitureDensity:'medium'}
const source=createWalkthroughSource(plan,{hardChecksPass:true},prefs),geometry=prepareWalkthroughGeometry(buildWalkthroughScene(source.building,{hardChecksPass:true})),app=prepareWalkthroughAppearance(plan,source,geometry)

test('separate ceiling fittings clear the fan sweep and touch the finished soffit',()=>{
 const groups=new Map()
 for(const p of app.furniture.filter(p=>p.support&&p.support.normal[1]===-1)){
  const key=JSON.stringify([p.roomId,p.support.group]);if(!groups.has(key))groups.set(key,p)
  if(['ceiling-light','batten','bulb-holder','fan-rod'].some(id=>p.sourceIds.includes(id))){
   const fin=app.specifications.find(s=>s.roomId===p.roomId).finishes
   const finishY=p.support.point[1]-(fin.ceiling.type==='plain'?0:.08)
   assert.ok(Math.abs(p.position[1]+p.size[1]/2-finishY)<1e-6,p.id+' floating below ceiling')
  }
 }
 assert.ok([...groups.values()].some(p=>p.support.group==='fan'))
 for(const fan of [...groups.values()].filter(p=>p.support.group==='fan'))for(const light of [...groups.values()].filter(p=>p.roomId===fan.roomId&&p.support.group!=='fan'))
  assert.ok(Math.hypot(fan.support.point[0]-light.support.point[0],fan.support.point[2]-light.support.point[2])>.9,'fixture intersects the fan sweep')
})

test('fixture footprints avoid disconnected soffits and stair/courtyard gaps',()=>{
 const face=(id,x0,x1)=>({id,canonicalSurfaceId:id,normal:[0,-1,0],vertices:[[x0,3,0],[x1,3,0],[x1,3,-3],[x0,3,-3]]})
 const faces=[face('left',0,1),face('right',2,4)]
 assert.equal(placeCeilingFitting([faces[0]],1.3,1.3),null)
 const chosen=placeCeilingFitting(faces,1.3,1.3);assert.equal(chosen.surface.id,'right');assert.ok(chosen.x>2.65&&chosen.x<3.35)
 assert.equal(placeCeilingFitting([], .3,.3),null)
})

test('skirting follows source wall fragments and the existing 100 mm BOQ height without filling door openings',()=>{
 const skirts=app.furniture.filter(p=>p.sourceIds[0].startsWith('skirting:'));assert.ok(skirts.length)
 for(const p of skirts){
  const room=geometry.metadata.rooms.find(r=>r.id===p.roomId),face=geometry.faces.find(f=>f.canonicalSurfaceId===p.support.surfaceId)
  assert.ok(face);assert.equal(p.size[1],.1);assert.ok(Math.abs(p.position[1]-.05-room.elevationM)<1e-6)
  const width=Math.max(p.size[0],p.size[2]),span=Math.max(...[0,2].map(i=>Math.max(...face.vertices.map(v=>v[i]))-Math.min(...face.vertices.map(v=>v[i]))))
  assert.ok(width<=span+1e-6)
 }
})

test('default furniture has coordinated wood and fabric colours, while explicit fan products keep their catalogue colours',()=>{
 const chair=app.models.find(m=>m.assetId==='dining-chair'),bed=app.models.find(m=>m.assetId==='bed')
 assert.ok(chair&&chair.materialColors['Table-Cross']!=='#ffffff');assert.ok(bed&&bed.color!=='#EFE9DF'&&bed.materialColors.leftPillow==='#B26B4E')
 const room=source.rooms.find(r=>app.specifications.find(s=>s.roomId===r.key)?.finishes.fan),floor=source.building.floors.find(f=>f.id===room.floorId)
 assert.equal(interiorFinishes(plan,floor.level,room.sourceRoomId).fan.profile.color,'#8D6946')
 const product=specsCatalogue.items.find(i=>i.id==='fans').options.find(o=>o.finishProductId)
 const next=structuredClone(plan);next.model.brief.specs.overrides.fans=product.id
 const chosen=interiorFinishes(next,floor.level,room.sourceRoomId)
 assert.equal(chosen.fan.name.includes(product.name),true)
 assert.notEqual(chosen.fan.profile.color,'#8D6946')
 assert.equal(WALKING.eye,1.5);assert.ok(WALKING.height>WALKING.eye)
})

test('fittings require a real accepted support; absent walls do not leave switches in air',()=>{
 const root=new Group(),wall=new Mesh(new BoxGeometry(.2,3,3),new MeshStandardMaterial());wall.name='GF_Wall_1';wall.position.set(-.1,1.5,0);root.add(wall)
 const fitted=(id,point)=>({id,roomId:'room',floorId:'GF',sourceIds:['switchboard'],kind:'furniture',position:[point[0]+.02,1.2,point[2]],size:[.02,.1,.16],rotation:0,shape:'box',binding:id,support:{surfaceId:'face',point,normal:[1,0,0],group:id}})
 const one=fitted('supported',[0,1.2,0]),two=fitted('floating',[3,1.2,0]),app={furniture:[one,two],models:[{id:'missing',replaces:['floating']}],skins:[],bindings:{},issues:[]}
 const next=reconcileAcceptedFittingSupports(app,root)
 assert.deepEqual(next.furniture,[one]);assert.equal(next.models.length,0);assert.ok(next.issues.some(i=>i.code==='FITTING_SUPPORT_UNAVAILABLE'))
 assert.equal(app.furniture.length,2,'canonical source is not mutated')
 const old=new Mesh(new BoxGeometry(),new MeshStandardMaterial());old.name='Interior_GF_ROOM_WarmCeiling_Diffuser';old.userData.source_id='GF_ROOM';root.add(old)
 replaceAcceptedLegacyLights(root,{metadata:{rooms:[{id:'room',semanticId:'GF_ROOM'}]}},{furniture:[{sourceIds:['ceiling-light'],roomId:'room'}]})
 assert.equal(old.visible,false);assert.ok(wall.visible)
})

test('opaque wall and terrace soffit faces remain visible from both sides after finishes and batching; glass stays transparent',async()=>{
 const root=new Group(),material=new MeshStandardMaterial({color:'#b1c3aa'}),wall=new Mesh(new BoxGeometry(4,3,.1),material)
 wall.name='GF_Wall_1';wall.userData.materialBinding=JSON.stringify(['GF','room','wall']);root.add(wall)
 const glass=new Mesh(new BoxGeometry(1,1,.02),new MeshStandardMaterial({transparent:true,opacity:.3}));glass.name='Window_GLASS';glass.position.set(6,0,0);root.add(glass)
 const deck=new Mesh(new BoxGeometry(1,.1,1),material);deck.name='FF_Terrace_Deck_001';deck.position.set(0,4,0);root.add(deck)
 const positions=[...wall.geometry.attributes.position.array]
 prepareWalkthroughShell(root)
 assert.equal(wall.material.side,DoubleSide);assert.equal(deck.material.side,DoubleSide);assert.equal(material.side,FrontSide);assert.equal(glass.material.opacity,.3)
 await applyWalkthroughMaterialBindings(root,{[wall.userData.materialBinding]:{color:'#667755',rough:.8}})
 assert.equal(wall.material.side,DoubleSide);assert.deepEqual([...wall.geometry.attributes.position.array],positions)
 const batches=batchWalkthroughScene(root);root.updateMatrixWorld(true)
 for(const z of [-1,1]){const ray=new Raycaster(new Vector3(0,1,z),new Vector3(0,0,-Math.sign(z)),0,2);assert.ok(ray.intersectObject(root,true).some(h=>h.object.visible),'wall lost after batch')}
 batches.release()
})
