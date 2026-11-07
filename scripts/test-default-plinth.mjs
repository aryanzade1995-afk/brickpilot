import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import {plinthEnclosure,buildPlinthEnclosureGroup} from '../src/lib/three/plinthEnclosure.ts'
const fixture=height=>({planId:'same-house',floors:[{id:'GF',level:0,elevationMm:0,slabThicknessMm:180,footprint:[{x:0,y:0,w:6000,h:8000}],courtyard:{x:2000,y:2000,w:2000,h:3000}}],structuralSizing:{plinthHeightMm:height}})
test('default masonry and earth close every selected plinth height without filling the courtyard',()=>{
 for(const height of [450,1000,1500]){
  const building=fixture(height),before=JSON.stringify(building),p=plinthEnclosure(building)
  assert.equal(p.grade,-height-20);assert.equal(p.top,-180)
  for(const r of p.earth)assert.ok(!(r.x<3000&&r.x+r.w>3000&&r.y<3500&&r.y+r.h>3500))
  for(let i=0;i<p.masonry.length;i++)for(const b of p.masonry.slice(i+1)){
   const a=p.masonry[i]
   assert.ok(Math.min(a.x+a.w,b.x+b.w)<=Math.max(a.x,b.x)||Math.min(a.y+a.h,b.y+b.h)<=Math.max(a.y,b.y),'masonry faces must not overlap')
  }
  assert.equal(JSON.stringify(building),before)
 }
 assert.equal(plinthEnclosure(fixture(180)),null)
})
test('legacy cache is enclosed immediately, new Blender enclosures are not duplicated, materials are preserved',()=>{
 const source=new THREE.Group(),wall=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial({color:'#bbab99'}))
 wall.userData.material_role='wall';source.add(wall)
 const fill=buildPlinthEnclosureGroup(fixture(1000),source)
 assert.equal(fill.root.children.length,2);assert.equal(source.children.length,1)
 const shell=fill.root.children.find(o=>o.userData.construction_role==='masonry-plinth-enclosure')
 assert.equal(shell.material.color.getHex(),wall.material.color.getHex());assert.notEqual(shell.material,wall.material)
 let disposed=0;fill.root.children.forEach(o=>o.geometry.addEventListener('dispose',()=>disposed++));fill.dispose();assert.equal(disposed,2)
 for(const role of ['masonry-plinth-enclosure','compacted-earth-fill']){const part=new THREE.Object3D();part.userData.construction_role=role;source.add(part)}
 const complete=buildPlinthEnclosureGroup(fixture(1000),source);assert.equal(complete.root.children.length,0);complete.dispose()
})
