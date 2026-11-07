import * as THREE from 'three'
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js'
import type {FacadePart,FacadeVariation} from '../engine/facade/variations.ts'
const textures=new Map<string,THREE.Texture>()
export function facadePartGeometry(p:FacadePart){
 const shape=new THREE.Shape()
 const profile=p.profile??[[0,0],[p.w,0],[p.w,p.h],[0,p.h]]
 profile.forEach(([x,y],i)=>i?shape.lineTo(x/1000,y/1000):shape.moveTo(x/1000,y/1000));shape.closePath()
 const geometry=new THREE.ExtrudeGeometry(shape,{depth:p.depth/1000,bevelEnabled:false,steps:1,curveSegments:8})
 const horizontal=p.side==='N'||p.side==='S',sign=p.side==='N'||p.side==='W'?-1:1
 const along=horizontal?new THREE.Vector3(1,0,0):new THREE.Vector3(0,0,-1)
 const normal=horizontal?new THREE.Vector3(0,0,-sign):new THREE.Vector3(sign,0,0)
 const matrix=new THREE.Matrix4().makeBasis(along,new THREE.Vector3(0,1,0),normal)
 matrix.setPosition(horizontal?p.u/1000:(p.fixed+sign*p.offset)/1000,p.z/1000,horizontal?-(p.fixed+sign*p.offset)/1000:-p.u/1000)
 geometry.applyMatrix4(matrix)
 if(matrix.determinant()<0){const pos=geometry.attributes.position,normalAttr=geometry.attributes.normal,uv=geometry.attributes.uv
  for(const attr of [pos,normalAttr,uv])for(let i=0;i<attr.count;i+=3)for(let k=0;k<attr.itemSize;k++){
   const a=attr.array[(i+1)*attr.itemSize+k];attr.array[(i+1)*attr.itemSize+k]=attr.array[(i+2)*attr.itemSize+k];attr.array[(i+2)*attr.itemSize+k]=a
  }
 }
 return geometry
}
/** A handful of material batches; no per-frame work or new viewer. */
export function buildFacadeDesignGroup(model:FacadeVariation,invalidate:()=>void=()=>{},wallMaterial?:THREE.Material){
 const root=new THREE.Group();root.name=`FacadeDesign_${model.signature}`
 const batches=new Map<string,THREE.BufferGeometry[]>()
 for(const p of model.parts){const list=batches.get(p.material)??[];list.push(facadePartGeometry(p));batches.set(p.material,list)}
 for(const [id,parts] of batches){
  const look=model.materials[id],material=id==='wall'&&wallMaterial?wallMaterial.clone():new THREE.MeshPhysicalMaterial({color:look.color,roughness:look.roughness,metalness:look.metalness,transmission:id==='glass'?.65:0,thickness:.025,transparent:id==='glass',opacity:id==='glass'?.65:1,envMapIntensity:.4})
  if(look.texture){let texture=textures.get(look.texture)
   if(!texture){texture=new THREE.TextureLoader().load(look.texture,invalidate);texture.colorSpace=THREE.SRGBColorSpace;texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.anisotropy=4;textures.set(look.texture,texture)}
   if(material instanceof THREE.MeshStandardMaterial)material.map=texture
  }
  const geometry=mergeGeometries(parts,false);parts.forEach(g=>g.dispose());if(!geometry){material.dispose();continue}
  const mesh=new THREE.Mesh(geometry,material);mesh.castShadow=true;mesh.receiveShadow=true;mesh.userData.facade_design_part=true;mesh.name=`FacadeDesignBatch_${id}`;root.add(mesh)
 }
 return {root,dispose:()=>root.traverse(o=>{if(o instanceof THREE.Mesh){o.geometry.dispose();const materials=Array.isArray(o.material)?o.material:[o.material];materials.forEach(m=>m.dispose())}})}
}
