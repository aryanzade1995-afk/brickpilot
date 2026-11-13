import test from 'node:test'
import assert from 'node:assert/strict'
import {Scene,Mesh,BoxGeometry,MeshStandardMaterial,MeshBasicMaterial,ShaderMaterial,Group,Box3,Vector3,Texture,RectAreaLight} from 'three'
import {raytraceScene,RAYTRACE_SAMPLES} from '../src/lib/three/raytraceScene.ts'

test('ray-traced snapshot retains visible geometry, world coordinates, selected materials and texture ownership',()=>{
 const source=new Scene(),group=new Group(),geometry=new BoxGeometry(2,3,4),texture=new Texture(),material=new MeshStandardMaterial({color:'#769f8d',map:texture,roughness:.73})
 group.position.set(7,2,-4);group.rotation.y=.6;source.add(group)
 const house=new Mesh(geometry,material);house.position.set(1,3,2);group.add(house)
 const hidden=new Group();hidden.visible=false;hidden.add(new Mesh(geometry,material));source.add(hidden)
 const sky=new Mesh(geometry,new ShaderMaterial());source.add(sky)
 source.updateMatrixWorld(true)
 const before=new Box3().setFromObject(house),color=material.color.getHex(),snapshot=raytraceScene(source)
 const mesh=snapshot.scene.children.find(o=>o instanceof Mesh)
 assert.ok(mesh);snapshot.scene.updateMatrixWorld(true)
 const after=new Box3().setFromObject(mesh)
 assert.ok(before.min.distanceTo(after.min)<1e-10);assert.ok(before.max.distanceTo(after.max)<1e-10)
 assert.equal(snapshot.scene.children.filter(o=>o instanceof Mesh).length,1)
 assert.equal(mesh.geometry,geometry);assert.equal(mesh.material,material);assert.equal(mesh.material.map,texture)
 let disposed=0;geometry.addEventListener('dispose',()=>disposed++);material.addEventListener('dispose',()=>disposed++);texture.addEventListener('dispose',()=>disposed++)
 snapshot.dispose();assert.equal(disposed,0);assert.equal(material.color.getHex(),color);assert.equal(house.parent,group)
})

test('unlit models convert privately and finite sun follows daylight/golden-hour settings',()=>{
 const source=new Scene(),material=new MeshBasicMaterial({color:'#b56738',alphaTest:.4}),object=new Mesh(new BoxGeometry(),material)
 source.add(object)
 const day=raytraceScene(source),gold=raytraceScene(source,true)
 const copy=day.scene.children.find(o=>o instanceof Mesh).material
 assert.ok(copy instanceof MeshStandardMaterial);assert.notEqual(copy,material);assert.equal(copy.color.getHex(),material.color.getHex());assert.equal(copy.alphaTest,.4)
 let copyDisposed=false,sourceDisposed=false;copy.addEventListener('dispose',()=>copyDisposed=true);material.addEventListener('dispose',()=>sourceDisposed=true)
 const sun=day.scene.children.find(o=>o instanceof RectAreaLight),warmSun=gold.scene.children.find(o=>o instanceof RectAreaLight)
 assert.ok(sun.width>0&&sun.height>0&&Number.isFinite(sun.intensity));assert.ok(warmSun.position.y<sun.position.y)
 // RectAreaLight emits along local -Z; Object3D.getWorldDirection returns +Z.
 assert.ok(sun.getWorldDirection(new Vector3()).negate().dot(sun.position.clone().normalize().negate())>.999)
 day.dispose();gold.dispose();assert.equal(copyDisposed,true);assert.equal(sourceDisposed,false)
 assert.equal(RAYTRACE_SAMPLES.balanced,64);assert.equal(RAYTRACE_SAMPLES.fine,128)
})

test('large terrain remains a shadow receiver without mutating its source material',()=>{
 const source=new Scene(),normal=new Texture(),material=new MeshStandardMaterial({color:'#677750',normalMap:normal}),ground=new Mesh(new BoxGeometry(3000,.01,3000),material)
 ground.name='Site_terrain';source.add(ground)
 const snapshot=raytraceScene(source),copy=snapshot.scene.children.find(o=>o instanceof Mesh).material
 assert.notEqual(copy,material);assert.equal(copy.castShadow,false);assert.equal(material.castShadow,undefined)
 assert.equal(copy.normalMap,null);assert.equal(material.normalMap,normal)
 assert.equal(copy.color.getHex(),material.color.getHex());snapshot.dispose()
})
