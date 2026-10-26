import test from 'node:test'
import assert from 'node:assert/strict'
import {Group,Mesh,BoxGeometry,MeshStandardMaterial,Texture,Vector3,Box3} from 'three'
import {applyLightmapUVs,applyWalkthroughLightmaps,validateLightingManifest} from '../src/lib/three/walkthroughLightmaps.ts'
import {bindAcceptedVillaFinishes} from '../src/lib/three/acceptedVillaFinishes.ts'
import {lightingLayoutSignature} from '../src/lib/walkthrough/lighting.ts'
import {surfaceProfile,applySurfaceMicrodetail} from '../src/lib/three/pbrSurfaces.ts'
import {WALKTHROUGH_QUALITY,adaptWalkthroughResolution} from '../src/lib/walkthrough/quality.ts'
import {nearbyRoomEmitters} from '../src/lib/walkthrough/roomLighting.ts'

function fixture(){
 const root=new Group(),wall=new Mesh(new BoxGeometry(4,3,.1),new MeshStandardMaterial());wall.name='GF_Wall_1';wall.position.set(2,1.5,0);root.add(wall);root.updateMatrixWorld(true)
 const g=wall.geometry.toNonIndexed(),p=g.attributes.position,layout=new ArrayBuffer(p.count*20),view=new DataView(layout),point=new Vector3()
 for(let i=0;i<p.count;i++){point.fromBufferAttribute(p,i).applyMatrix4(wall.matrixWorld);[...point.toArray(),point.x/4,point.y/3].forEach((v,k)=>view.setFloat32(i*20+k*4,v,true))}
 const manifest={version:1,identity:'a'.repeat(64),planId:'plan',sourceSha256:'b'.repeat(64),layoutSignature:'layout',preset:'daylight',transport:'neutral-indirect-diffuse',directLightBaked:false,albedoBaked:false,uvChannel:2,layoutBytes:layout.byteLength,atlases:[{id:'GF',irradiance:'indirect-0.hdr',ao:'ao-0.png',width:2048,height:2048}],meshes:[{name:wall.name,atlas:0,offset:0,count:p.count}],files:[],qualifications:[]}
 return {root,wall,manifest,layout}
}
test('explicit lightmap UV import matches exact world triangles and refuses unrelated geometry',()=>{
 const {root,wall,manifest,layout}=fixture(),before=new Box3().setFromObject(root)
 assert.deepEqual(applyLightmapUVs(root,{manifest,layout}),{matched:1,missing:[]})
 assert.ok(new Box3().setFromObject(root).equals(before));assert.ok(wall.geometry.attributes.uv2)
 const other=fixture();other.wall.position.x+=1
 assert.throws(()=>applyLightmapUVs(other.root,{manifest,layout}),/do not match/)
 const corrupt=layout.slice(0);new DataView(corrupt).setFloat32(12,NaN,true)
 assert.throws(()=>applyLightmapUVs(fixture().root,{manifest,layout:corrupt}),/Non-finite/)
})
test('secondary lighting UVs survive room finish partitioning without stretching or filling openings',()=>{
 const {root,wall,manifest,layout}=fixture();applyLightmapUVs(root,{manifest,layout})
 const f={id:'wall',canonicalSurfaceId:'wall',roomId:'room',floorId:'GF',binding:'paint',role:'wall',normal:[0,0,-1],vertices:[[0,0,-.05],[4,0,-.05],[4,3,-.05],[0,3,-.05]]}
 const geometry={faces:[f],metadata:{openings:[]}},app={skins:[{...f,id:'wall:wall-tiles',binding:'tile',vertices:[[0,0,-.052],[4,0,-.052],[4,1.5,-.052],[0,1.5,-.052]]}]}
 bindAcceptedVillaFinishes(root,geometry,app)
 const p=wall.geometry.attributes.position,uv=wall.geometry.attributes.uv2,point=new Vector3()
 assert.equal(uv.count,p.count)
 for(let i=0;i<p.count;i++){point.fromBufferAttribute(p,i).applyMatrix4(wall.matrixWorld);assert.ok(Math.abs(uv.getX(i)-point.x/4)<1e-6);assert.ok(Math.abs(uv.getY(i)-(1-point.y/3))<1e-6)}
})
test('baked indirect uses channel 2 while retaining bright residential fill and gentle contact shading',()=>{
 const {root,wall,manifest,layout}=fixture();applyLightmapUVs(root,{manifest,layout})
 const light=new Texture(),ao=new Texture();light.channel=ao.channel=2
 applyWalkthroughLightmaps(root,{manifest,layout,indirect:[light],ao:[ao]})
 assert.equal(wall.material.lightMap,light);assert.equal(wall.material.aoMap,ao);assert.equal(wall.material.lightMapIntensity,Math.PI)
 const shader={fragmentShader:'#include <lights_fragment_maps>\n#include <aomap_fragment>'};wall.material.onBeforeCompile(shader,{})
 assert.ok(shader.fragmentShader.includes('#include <lights_fragment_maps>'))
 assert.ok(!shader.fragmentShader.includes('iblIrradiance = vec3(0.0)'))
 assert.ok(!shader.fragmentShader.includes('irradiance = texture2D'))
 assert.ok(shader.fragmentShader.includes('mix(daylightDiffuseBeforeAO, reflectedLight.indirectDiffuse, 0.25)'))
})
test('lighting signature reuses paint/albedo changes but invalidates moved furniture, optics and emitter changes',()=>{
 const app={furniture:[{id:'box',position:[1,2,3],size:[1,1,1],rotation:0,shape:'box'}],models:[],skins:[],bindings:{wall:{color:'#ffffff',rough:.8},lamp:{color:'#ffbb77',rough:.4,emissive:'#ffbb77',glow:.4}}}
 const key=lightingLayoutSignature(app),paint=structuredClone(app);paint.bindings.wall.color='#334422';paint.bindings.wall.rough=.75
 assert.equal(lightingLayoutSignature(paint),key)
 const moved=structuredClone(app);moved.furniture[0].position[0]++;assert.notEqual(lightingLayoutSignature(moved),key)
 const light=structuredClone(app);light.bindings.lamp.glow=1;assert.notEqual(lightingLayoutSignature(light),key)
 const glass=structuredClone(app);glass.bindings.wall.opacity=.5;assert.notEqual(lightingLayoutSignature(glass),key)
})
test('manifest validation rejects stale identities, untrusted paths and invalid ranges',()=>{
 const {manifest}=fixture(),valid=m=>validateLightingManifest(m,'a'.repeat(64),'plan','layout')
 valid(manifest);assert.throws(()=>valid({...manifest,planId:'other'}));assert.throws(()=>valid({...manifest,albedoBaked:true}))
 assert.throws(()=>valid({...manifest,atlases:[{...manifest.atlases[0],irradiance:'../secret.hdr'}]}))
 assert.throws(()=>valid({...manifest,meshes:[{...manifest.meshes[0],count:1000000}]}))
})
test('PBR microdetail preserves selected albedo, metre scale and geometry',()=>{
 const look={color:'#bb8877',rough:.78},profile=surfaceProfile('["GF","room","wall"]',look),material=new MeshStandardMaterial({color:look.color,roughness:look.rough}),cache=new Map()
 applySurfaceMicrodetail(material,profile,cache)
 assert.equal(material.color.getHexString(),'bb8877');assert.equal(material.roughness,.78);assert.equal(material.normalMap.repeat.x,4);assert.ok(material.normalScale.x<.1)
 assert.equal(material.userData.surfaceProfile.basis,'illustrative-microdetail')
 assert.equal(Object.keys(WALKTHROUGH_QUALITY).length,3);assert.equal(WALKTHROUGH_QUALITY.adaptive.start,1)
 assert.equal(adaptWalkthroughResolution('adaptive',40,1,0).ratio,.9)
})

test('shaded matte walls keep selected paint and suppress studio glare without changing glossy surfaces',()=>{
 const {root,wall,manifest,layout}=fixture(),paint=new MeshStandardMaterial({color:'#c5b9a6',roughness:.78}),maps=new Map()
 applySurfaceMicrodetail(paint,surfaceProfile('["GF","room","wall"]',{color:'#c5b9a6',rough:.78}),maps)
 wall.material=paint;applyLightmapUVs(root,{manifest,layout})
 const before=new Box3().setFromObject(root),light=new Texture(),ao=new Texture()
 applyWalkthroughLightmaps(root,{manifest,layout,indirect:[light],ao:[ao]})
 assert.equal(wall.material.color.getHexString(),'c5b9a6');assert.equal(wall.material.roughness,.78)
 assert.equal(wall.material.envMapIntensity,.18);assert.equal(wall.material.emissive.getHex(),0)
 assert.ok(new Box3().setFromObject(root).equals(before))
 const shader={fragmentShader:'#include <lights_fragment_maps>\n#include <aomap_fragment>'};wall.material.onBeforeCompile(shader,{})
 assert.ok(!shader.fragmentShader.includes('iblIrradiance = vec3(0.0)'));assert.ok(!shader.fragmentShader.includes('wallShadeLuminance'))
 const floor=fixture();floor.wall.material=new MeshStandardMaterial({color:'#c5b9a6',roughness:.15})
 applySurfaceMicrodetail(floor.wall.material,surfaceProfile('["GF","room","floor"]',{color:'#c5b9a6',rough:.15}),new Map())
 applyLightmapUVs(floor.root,floor);applyWalkthroughLightmaps(floor.root,{...floor,indirect:[light],ao:[ao]})
 assert.equal(floor.wall.material.envMapIntensity,1);assert.equal(floor.wall.material.roughness,.15)
 const floorShader={fragmentShader:'#include <lights_fragment_maps>'};floor.wall.material.onBeforeCompile(floorShader,{})
 assert.ok(!floorShader.fragmentShader.includes('wallShadeLuminance'))
 assert.equal(wall.material.customProgramCacheKey(),floor.wall.material.customProgramCacheKey())
})

test('local fittings respect actual room boundaries and absolute floor ceilings',()=>{
 const geometry={metadata:{floors:[{id:'GF',elevationM:0,clearCeilingM:2.9},{id:'FF',elevationM:3.1,clearCeilingM:6}],rooms:[
  {id:'a',floorId:'GF',elevationM:0,outdoor:false,rectMm:{x:0,y:0,w:3000,h:4000}},
  {id:'b',floorId:'GF',elevationM:0,outdoor:false,rectMm:{x:3000,y:0,w:3000,h:4000}},
  {id:'upper',floorId:'FF',elevationM:3.1,outdoor:false,rectMm:{x:0,y:0,w:3000,h:4000}}]}}
 const lamp=(id,roomId,x,y)=>({id,roomId,position:[x,y,-2]})
 const emitters=[lamp('a','a',1,2.7),lamp('next-room','b',3.05,2.7),lamp('upper','upper',1,5.8)]
 assert.deepEqual(nearbyRoomEmitters(emitters,[2.9,1.5,-2],geometry).map(i=>i.p.id),['a'])
 assert.deepEqual(nearbyRoomEmitters(emitters,[1,4.6,-2],geometry).map(i=>i.p.id),['upper'])
 assert.deepEqual(nearbyRoomEmitters(emitters,[1,6.2,-2],geometry),[])
 assert.deepEqual(nearbyRoomEmitters(emitters,[7,1.5,-2],geometry),[])
 const small=nearbyRoomEmitters(emitters,[1,1.5,-2],geometry)[0].intensity
 const large=structuredClone(geometry);large.metadata.rooms[0].rectMm.w=10000
 assert.ok(nearbyRoomEmitters(emitters,[1,1.5,-2],large)[0].intensity>small)
 assert.ok(nearbyRoomEmitters(emitters,[1,1.5,-2],large)[0].intensity<=24)
})
