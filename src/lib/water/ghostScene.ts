import { Mesh, MeshStandardMaterial, type Material, type Object3D } from 'three'
/** Change only this viewer's hierarchy, never the GLTF cache or shared materials. */
export function ghostWaterArchitecture(root:Object3D) {
  const originals=new Map<Mesh,Material|Material[]>(),copies=new Map<Material,Material>()
  root.traverse(o=>{if(!(o instanceof Mesh))return
    originals.set(o,o.material)
    const copy=(original:Material)=>{let material=copies.get(original);if(!material){material=original.clone();material.transparent=true;material.opacity=.055;material.depthWrite=false
      if(material instanceof MeshStandardMaterial){material.color.set('#CCD3CC');material.metalness=0;material.roughness=1;material.map=null;if('transmission' in material)material.transmission=0}
      copies.set(original,material)}return material}
    o.material=Array.isArray(o.material)?o.material.map(copy):copy(o.material)
  })
  return ()=>{for(const [mesh,material]of originals)mesh.material=material;for(const material of copies.values())material.dispose()}
}
