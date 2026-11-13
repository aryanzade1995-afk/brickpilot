import { Color, Light, Material, Mesh, MeshBasicMaterial, MeshStandardMaterial, RectAreaLight, Scene, Vector3 } from 'three'

/** A read-only snapshot of the visible model. Geometry and texture ownership
 * stays with the existing viewer; only converted unlit materials are owned here. */
export function raytraceScene(source:Scene,golden=false){
  source.updateMatrixWorld(true)
  const scene=new Scene(),owned=new Set<Material>(),converted=new Map<Material,Material>()
  if(source.userData.photographicExterior){
    scene.environment=source.environment;scene.background=source.background
    scene.environmentIntensity=source.environmentIntensity;scene.backgroundIntensity=source.backgroundIntensity;scene.backgroundBlurriness=source.backgroundBlurriness
    scene.environmentRotation.copy(source.environmentRotation);scene.backgroundRotation.copy(source.backgroundRotation)
  }
  source.traverseVisible(object=>{
    if(object instanceof Light&&object.userData.photographicLight){const light=object.clone();light.matrix.copy(object.matrixWorld);light.matrixAutoUpdate=false;scene.add(light);return}
    if(!(object instanceof Mesh))return
    const materials=Array.isArray(object.material)?object.material:[object.material]
    // Sky/technical shader overlays are raster-only. Real house surfaces,
    // vegetation alpha maps and all visible service layers remain unchanged.
    if(materials.some(m=>!(m instanceof MeshStandardMaterial)&&!(m instanceof MeshBasicMaterial)))return
    const mesh=object.clone(false)
    mesh.matrix.copy(object.matrixWorld);mesh.matrixAutoUpdate=false
    const convert=(m:Material)=>{
      // Terrain receives house/tree shadows but cannot shadow itself. This
      // avoids precision acne on very shallow rays at the distant horizon.
      if(object.name==='Site_terrain'&&m instanceof MeshStandardMaterial){
        const copy:MeshStandardMaterial=m.clone()
        ;(copy as MeshStandardMaterial&{castShadow:boolean}).castShadow=false
        // Kilometre-scale terrain is almost edge-on at the horizon. Its tiny
        // normal-map perturbations create invalid back-facing sample normals;
        // retain its albedo/roughness detail and the near plot's normal maps.
        copy.normalMap=null
        owned.add(copy);return copy
      }
      if(m instanceof MeshStandardMaterial)return m
      let copy=converted.get(m)
      if(!copy&&m instanceof MeshBasicMaterial){
        copy=new MeshStandardMaterial({name:m.name,color:m.color,map:m.map,alphaMap:m.alphaMap,alphaTest:m.alphaTest,opacity:m.opacity,transparent:m.transparent,side:m.side,vertexColors:m.vertexColors,roughness:.8})
        converted.set(m,copy);owned.add(copy)
      }
      return copy??m
    }
    mesh.material=Array.isArray(object.material)?materials.map(convert):convert(object.material)
    scene.add(mesh)
  })
  // Photographed lighting already contains its physical sunlight. Do not add
  // a second remote emitter: it causes grazing-ray instability on Intel GPUs.
  if(source.userData.photographicExterior)return {scene,dispose:()=>owned.forEach(material=>material.dispose())}
  // A finite angular sun gives physically sampled penumbras. Sky illumination
  // is supplied separately as an equirectangular environment, not studio cards.
  const position=new Vector3(...(golden?[35,12,-25]:[14,24,-16]) as [number,number,number])
  position.normalize().multiplyScalar(100000)
  const angularSize=.0093,diameter=position.length()*angularSize
  const power=golden?2:2.5
  const sun=new RectAreaLight(new Color(golden?'#ffd19c':'#fff2df'),power/(angularSize**2),diameter,diameter)
  sun.position.copy(position);sun.lookAt(0,0,0);scene.add(sun)
  return {scene,dispose:()=>owned.forEach(material=>material.dispose())}
}

export type RaytraceStatus={phase:'preparing'|'moving'|'rendering'|'complete'|'error';samples:number;target:number;gpu:string;progress:number;message?:string;elapsedMs?:number;renderWidth?:number;renderHeight?:number;movementFps?:number}
export const RAYTRACE_SAMPLES={balanced:64,fine:128,photo:384} as const
export type RaytraceQuality=keyof typeof RAYTRACE_SAMPLES
