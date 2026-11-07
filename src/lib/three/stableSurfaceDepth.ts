import {Mesh,type Material,type Object3D} from 'three'

/** Resolve structural/finish ties in screen-depth space, including untouched
 * legacy slab faces. Clone by source slot and priority, never recolour a finish
 * or mutate the shared GLTF material. Requires ordinary (non-logarithmic) depth. */
export function stabilizeSurfaceDepth(root:Object3D){
 const slots=new Map<Material,Map<number,Material>>()
 root.traverse(o=>{
  if(!(o instanceof Mesh))return
  const role=o.userData.material_role,construction=o.userData.construction_role
  const priority=role==='soil'||construction==='compacted-earth-fill'?2:
   role==='concrete'||/^(PCC_|Footing_|Pedestal_|Plinth_.*BEAM)/i.test(o.name)?1:0
  if(!priority)return
  const slot=(source:Material)=>{
   if(source.transparent||!source.depthWrite)return source
   const levels=slots.get(source)??new Map<number,Material>();slots.set(source,levels)
   let material=levels.get(priority)
   if(!material){material=source.clone();material.polygonOffset=true;material.polygonOffsetFactor=priority;material.polygonOffsetUnits=priority*2;levels.set(priority,material)}
   return material
  }
  o.material=Array.isArray(o.material)?o.material.map(slot):slot(o.material)
 })
 return [...slots.values()].flatMap(levels=>[...levels.values()])
}
