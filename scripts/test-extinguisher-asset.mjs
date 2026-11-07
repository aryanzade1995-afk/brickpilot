import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {Group,Mesh,BoxGeometry,MeshStandardMaterial,Box3,Vector3,DataTexture} from 'three'
import {replaceExtinguisherBoxes,restoreExtinguisherMaterials} from '../src/lib/three/extinguisherAsset.ts'

test('older white extinguisher bodies regain the original red PBR map without recolouring labels or moving geometry',()=>{
 const asset=new Group(),texture=new DataTexture(new Uint8Array([190,15,12,255]),1,1)
 const source=new MeshStandardMaterial({map:texture,roughness:.45});source.name='korean_fire_extinguisher_01_body'
 source.normalMap=new DataTexture(new Uint8Array([128,128,255,255]),1,1)
 asset.add(new Mesh(new BoxGeometry(),source))
 const old=new MeshStandardMaterial({color:'#cccccc'});old.name=source.name+'.001'
 const root=new Group(),body=new Mesh(new BoxGeometry(.2,.65,.2),old),label=new Mesh(new BoxGeometry(),new MeshStandardMaterial({color:'white'}))
 body.position.set(2,3.1,-4);label.material.name='korean_fire_extinguisher_01_paper';root.add(body,label)
 const geometry=body.geometry,position=body.position.clone(),paper=label.material
 restoreExtinguisherMaterials(root,asset)
 assert.equal(body.material.map,texture);assert.equal(body.material.normalMap,source.normalMap)
 assert.equal(body.geometry,geometry);assert.deepEqual(body.position,position);assert.equal(label.material,paper)
 assert.equal(old.map,null,'original shared material was not recoloured')
 const repaired=body.material;restoreExtinguisherMaterials(root,asset);assert.equal(body.material,repaired)
})

test('detailed prop is a compact self-contained PBR GLB with real geometry',()=>{
 const bytes=readFileSync(new URL('../public/safety-assets/fire-extinguisher.glb',import.meta.url))
 assert.equal(bytes.toString('ascii',0,4),'glTF')
 assert.ok(bytes.length<4_000_000)
 const json=JSON.parse(bytes.toString('utf8',20,20+bytes.readUInt32LE(12)))
 assert.ok(json.images.every(i=>i.bufferView!==undefined),'no remote texture requests')
 assert.ok(json.materials.some(m=>m.normalTexture&&m.pbrMetallicRoughness?.baseColorTexture))
 const triangles=json.meshes.flatMap(m=>m.primitives).reduce((n,p)=>n+json.accessors[p.indices].count/3,0)
 assert.ok(triangles>1000&&triangles<15000)
 assert.ok(readFileSync(new URL('../public/safety-assets/fire-extinguisher.blend',import.meta.url)).length>100000)
})

test('legacy boxes become floor-standing props on every level without changing walls or duplicating upgraded models',()=>{
 const root=new Group(),floor=new Group();floor.position.y=3.2;root.add(floor)
 const box=new Mesh(new BoxGeometry(.15,.42,.15),new MeshStandardMaterial());box.name='L1_Extinguisher';box.position.set(2,1.1,-3);floor.add(box)
 const wall=box.clone();wall.name='Wall';floor.add(wall)
 const asset=new Group(),body=new Mesh(new BoxGeometry(.28,.65,.37),new MeshStandardMaterial());body.position.y=.325;asset.add(body)
 const existing=new Mesh(new BoxGeometry(),new MeshStandardMaterial());existing.name='L2_Extinguisher_Detailed';existing.userData.formstead_extinguisher_asset=true;root.add(existing)
 replaceExtinguisherBoxes(root,asset)
 assert.equal(box.visible,false);assert.equal(wall.visible,true);assert.equal(existing.visible,true)
 const replacement=floor.getObjectByName('L1_Extinguisher_Detailed')
 assert.ok(replacement)
 const bounds=new Box3().setFromObject(replacement),center=bounds.getCenter(new Vector3())
 assert.ok(Math.abs(bounds.min.y-3.2)<1e-6)
 assert.ok(Math.abs(center.x-2)<1e-6&&Math.abs(center.z+3)<1e-6)
 assert.equal(replacement.userData.formstead_extinguisher_asset,true)
 const count=floor.children.length
 replaceExtinguisherBoxes(root,asset)
 assert.equal(floor.children.length,count)
})
