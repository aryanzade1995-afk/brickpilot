import test from 'node:test'
import assert from 'node:assert/strict'
import {Group,Mesh,BoxGeometry,MeshStandardMaterial,Texture} from 'three'
import {refineMaterialResponse} from '../src/lib/three/materialResponse.ts'
import {stabilizeSurfaceDepth} from '../src/lib/three/stableSurfaceDepth.ts'

test('structural depth priority keeps finishes, buffers and shared source materials unchanged',()=>{
 const root=new Group(),source=new MeshStandardMaterial({color:'#ac9275',roughness:.8,map:new Texture()})
 const wall=new Mesh(new BoxGeometry(),source),beam=new Mesh(new BoxGeometry(),source),soil=new Mesh(new BoxGeometry(),source)
 wall.userData.material_role='primary_wall';beam.userData.material_role='concrete';soil.userData.material_role='soil';root.add(wall,beam,soil)
 const buffers=root.children.map(m=>m.geometry),positions=buffers.map(g=>[...g.attributes.position.array])
 const owned=stabilizeSurfaceDepth(root)
 assert.equal(owned.length,2);assert.equal(wall.material,source);assert.equal(source.polygonOffset,false)
 assert.ok(beam.material.polygonOffset&&soil.material.polygonOffset)
 assert.ok(soil.material.polygonOffsetUnits>beam.material.polygonOffsetUnits)
 root.children.forEach((m,i)=>{assert.equal(m.material.color.getHex(),source.color.getHex());assert.equal(m.material.map,source.map);assert.equal(m.geometry,buffers[i]);assert.deepEqual([...m.geometry.attributes.position.array],positions[i])})
 const glass=new Mesh(new BoxGeometry(),new MeshStandardMaterial({transparent:true,opacity:.5}));glass.userData.material_role='concrete';root.add(glass)
 const material=glass.material;stabilizeSurfaceDepth(root);assert.equal(glass.material,material)
 owned.forEach(m=>m.dispose())
})
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
