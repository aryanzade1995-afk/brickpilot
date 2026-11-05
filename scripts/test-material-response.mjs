import test from 'node:test'
import assert from 'node:assert/strict'
import {Group,Mesh,BoxGeometry,MeshStandardMaterial,Texture} from 'three'
import {refineMaterialResponse} from '../src/lib/three/materialResponse.ts'
test('reflection refinement preserves selected finish values and shared geometry across repeated calls',()=>{
 const root=new Group(),material=new MeshStandardMaterial({color:'#ac9275',roughness:.8,map:new Texture()})
 const mesh=new Mesh(new BoxGeometry(),material);root.add(mesh)
 const geometry=mesh.geometry,positions=[...geometry.attributes.position.array],colour=material.color.getHex()
 refineMaterialResponse(root);refineMaterialResponse(root)
 assert.equal(material.color.getHex(),colour);assert.equal(material.roughness,.8);assert.equal(material.opacity,1)
 assert.equal(mesh.geometry,geometry);assert.deepEqual([...geometry.attributes.position.array],positions)
 assert.equal(material.envMapIntensity,.25)
 material.roughness=.2;material.envMapIntensity=1;refineMaterialResponse(root);assert.equal(material.envMapIntensity,1)
})
