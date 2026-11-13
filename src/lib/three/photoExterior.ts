import {Float32BufferAttribute,Matrix3,Mesh,MeshPhysicalMaterial,MeshStandardMaterial,RepeatWrapping,SRGBColorSpace,Vector3,type Box3,type BufferGeometry,type Material,type Object3D,type Texture} from 'three'
import type {BuildingModel} from '../engine/buildingModel.ts'

export const PHOTO_BASE='/exterior-assets/photo/'
export const PHOTO_ENVIRONMENTS={day:PHOTO_BASE+'suburban_field_01-environment.hdr',dusk:PHOTO_BASE+'industrial_sunset_puresky-environment.hdr'}
export const PHOTO_MAP_NAMES=['asphalt_01-Diffuse','asphalt_01-nor_gl','asphalt_01-Rough','lawn-Diffuse','lawn-nor_gl','lawn-Rough','painted_plaster_wall-nor_gl','painted_plaster_wall-Rough','concrete_floor_02-Diffuse','concrete_floor_02-nor_gl','concrete_floor_02-Rough'] as const
export const PHOTO_MAP_URLS=PHOTO_MAP_NAMES.map(name=>PHOTO_BASE+name+'.jpg')
export type PhotoMaps=Record<typeof PHOTO_MAP_NAMES[number],Texture>

/** Private sampler settings: cached source images never change or get disposed. */
export function photoMaps(source:Texture[],anisotropy=4){
 const maps={} as PhotoMaps
 PHOTO_MAP_NAMES.forEach((name,i)=>{const texture=source[i].clone();texture.wrapS=texture.wrapT=RepeatWrapping;texture.anisotropy=Math.min(8,anisotropy)
  if(name.endsWith('Diffuse'))texture.colorSpace=SRGBColorSpace
  maps[name]=texture
 })
 return {maps,dispose:()=>Object.values(maps).forEach(texture=>texture.dispose())}
}
export function repeatPhotoMaps(maps:PhotoMaps,prefix:string,x:number,y:number){
 for(const [name,texture] of Object.entries(maps))if(name.startsWith(prefix)){texture.repeat.set(x,y);texture.updateMatrix()}
}

/** Detail and light response only; keep the selected albedo, existing image
 * maps, mesh buffers, transforms, identities and costs intact. */
export function refinePhotoSurfaces(root:Object3D,maps:PhotoMaps){
 const originals=new Map<Mesh,Material|Material[]>(),owned=new Map<Material,Material>(),geometries=new Map<Mesh,{source:BufferGeometry;copy:BufferGeometry}>()
 root.updateMatrixWorld(true)
 root.traverse(object=>{
  if(!(object instanceof Mesh))return
  const convert=(source:Material)=>{
   if(!(source instanceof MeshStandardMaterial))return source
   const name=source.name+' '+object.name
   const wall=/primary_wall|secondary_wall|_accent\b|FacadeDesignBatch_wall|Photo_neighbour_wall/i.test(name)
   const paving=/_paving\b|_stone\b|Photo_neighbour_plinth/i.test(name)
   const landscape=/_landscape\b/i.test(name)
   const glass=source instanceof MeshPhysicalMaterial&&source.transmission>0&&/glass|glaz/i.test(name)
   if(!wall&&!paving&&!landscape&&!glass)return source
   const prior=owned.get(source);if(prior)return prior
   const material=source.clone()
   if(wall){material.normalMap??=maps['painted_plaster_wall-nor_gl'];material.normalScale.set(.2,.2);material.roughnessMap??=maps['painted_plaster_wall-Rough']}
   if(paving){material.normalMap??=maps['concrete_floor_02-nor_gl'];material.normalScale.set(.18,.18);material.roughnessMap??=maps['concrete_floor_02-Rough']}
   if(landscape){material.map??=maps['lawn-Diffuse'];material.normalMap??=maps['lawn-nor_gl'];material.normalScale.set(.22,.22);material.roughnessMap??=maps['lawn-Rough']}
   if(glass&&material instanceof MeshPhysicalMaterial){material.color.set('#f4f8f7');material.opacity=1;material.transparent=false;material.transmission=Math.max(.96,material.transmission);material.roughness=Math.min(.035,material.roughness);material.thickness=.008;material.ior=1.5;material.attenuationColor.set('#f4f8f7');material.attenuationDistance=20}
   material.needsUpdate=true;owned.set(source,material);return material
  }
  const before=object.material,after=Array.isArray(before)?before.map(convert):convert(before)
  if(Array.isArray(before)?before.some((m,i)=>m!==(after as Material[])[i]):before!==after){
   originals.set(object,before);object.material=after
   const needsUV=(Array.isArray(after)?after:[after]).some(m=>m instanceof MeshStandardMaterial&&(m.normalMap||m.roughnessMap||m.map))
   if(needsUV&&!object.geometry.getAttribute('uv')){
    // Blender's untextured procedural surfaces often omit UVs in glTF. Add a
    // private world-metre projection; never move vertices or alter topology.
    const source=object.geometry,copy=source.clone(),position=copy.getAttribute('position'),normal=copy.getAttribute('normal'),uv=new Float32Array(position.count*2)
    const point=new Vector3(),direction=new Vector3(),normalMatrix=new Matrix3().getNormalMatrix(object.matrixWorld)
    for(let i=0;i<position.count;i++){
     point.fromBufferAttribute(position,i).applyMatrix4(object.matrixWorld)
     if(normal)direction.fromBufferAttribute(normal,i).applyNormalMatrix(normalMatrix);else direction.set(0,1,0)
     const ax=Math.abs(direction.x),ay=Math.abs(direction.y),az=Math.abs(direction.z)
     uv[i*2]=ax>ay&&ax>az?-point.z:point.x;uv[i*2+1]=ay>ax&&ay>az?-point.z:point.y
    }
    copy.setAttribute('uv',new Float32BufferAttribute(uv,2));object.geometry=copy;geometries.set(object,{source,copy})
   }
  }
 })
 return {count:owned.size,restore:()=>{originals.forEach((material,mesh)=>{mesh.material=material});geometries.forEach(({source,copy},mesh)=>{mesh.geometry=source;copy.dispose()});owned.forEach(material=>material.dispose())}}
}

/** Architectural photograph rather than a distant plot overview. */
export function photoCameraPose(building:BuildingModel,aspect:number,bounds?:Box3){
 const rects=building.floors.flatMap(f=>f.footprint),x=Math.min(...rects.map(r=>r.x))/1000,z=-Math.max(...rects.map(r=>r.y+r.h))/1000
 const width=Math.max(...rects.map(r=>r.x+r.w))/1000-x,depth=-Math.min(...rects.map(r=>r.y))/1000-z
 const grade=(Math.min(...building.floors.map(f=>f.elevationMm))-(building.structuralSizing?.plinthHeightMm??400))/1000
 const low=grade-.15,high=Math.max(...building.floors.map(f=>f.elevationMm+f.heightMm))/1000
 const valid=bounds&&!bounds.isEmpty(),min=new Vector3(valid?bounds.min.x:x-.6,low,valid?bounds.min.z:z-.6),max=new Vector3(valid?bounds.max.x:x+width+.6,valid?Math.max(high+.5,bounds.max.y):high+2.5,valid?bounds.max.z:z+depth+.6)
 const fov=36,half=Math.tan(fov*Math.PI/360),target=min.clone().add(max).multiplyScalar(.5),direction=new Vector3(.6,-.03,-1).normalize()
 const right=new Vector3().crossVectors(new Vector3(0,1,0),direction).normalize(),up=new Vector3().crossVectors(direction,right).normalize()
 let distance=1
 // Fit projected corners, including the near face's depth. A 2D width/height
 // fit alone clips roofs and foreground balconies on deep or narrow houses.
 for(const px of [min.x,max.x])for(const py of [min.y,max.y])for(const pz of [min.z,max.z]){
  const corner=new Vector3(px,py,pz).sub(target)
  distance=Math.max(distance,corner.dot(direction)+Math.max(Math.abs(corner.dot(right))/(half*Math.max(.3,aspect)),Math.abs(corner.dot(up))/half)*1.1)
 }
 const position=target.clone().addScaledVector(direction,distance*1.04)
 position.y=Math.max(grade+1.65,position.y)
 return {target,position,fov}
}
