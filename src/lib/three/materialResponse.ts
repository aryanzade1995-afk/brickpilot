import {Mesh,MeshStandardMaterial,type Object3D} from 'three'

/** Reflection response only: retain selected colours, texture maps, roughness,
 * opacity and geometry. Shared slots are processed once, never every frame. */
export function refineMaterialResponse(root:Object3D) {
 const seen=new Set<MeshStandardMaterial>()
 root.traverse(object=>{
  if(!(object instanceof Mesh))return
  for(const m of Array.isArray(object.material)?object.material:[object.material]){
   if(!(m instanceof MeshStandardMaterial)||seen.has(m)||m.userData.bakedLighting)continue
   seen.add(m)
   // Avoid white reflection-card patches on matte walls; retain readable
   // highlights on polished surfaces and bathroom metalwork.
   if(m.metalness<.1&&m.roughness>=.7)m.envMapIntensity=Math.min(m.envMapIntensity,.25)
   for(const texture of [m.map,m.normalMap,m.roughnessMap,m.metalnessMap])if(texture)texture.anisotropy=Math.min(8,Math.max(4,texture.anisotropy))
  }
 })
 return seen.size
}
