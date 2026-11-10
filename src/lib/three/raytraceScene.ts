import { Color, Material, Mesh, MeshBasicMaterial, MeshStandardMaterial, RectAreaLight, Scene, Vector3 } from 'three'

/** A read-only snapshot of the visible model. Geometry and texture ownership
 * stays with the existing viewer; only converted unlit materials are owned here. */
export function raytraceScene(source:Scene,golden=false){
  source.updateMatrixWorld(true)
  const scene=new Scene(),owned=new Set<Material>(),converted=new Map<Material,Material>()
  source.traverseVisible(object=>{
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
  // A finite angular sun gives physically sampled penumbras. Sky illumination
  // is supplied separately as an equirectangular environment, not studio cards.
  const position=new Vector3(...(golden?[35,12,-25]:[14,24,-16]) as [number,number,number])
  // Keep the emitter in the far field so the whole neighbourhood sees its
  // emitting face and nearly parallel sunlight, including the distant terrain.
  position.normalize().multiplyScalar(100000)
  const angularSize=.0093,diameter=position.length()*angularSize
  const sun=new RectAreaLight(new Color(golden?'#ffd19c':'#fff2df'),(golden?2:2.5)/(angularSize**2),diameter,diameter)
  sun.position.copy(position);sun.lookAt(0,0,0);scene.add(sun)
  return {scene,dispose:()=>owned.forEach(material=>material.dispose())}
}

export type RaytraceStatus={phase:'preparing'|'rendering'|'complete'|'error';samples:number;target:number;gpu:string;progress:number;message?:string}
export const RAYTRACE_SAMPLES={balanced:64,fine:128} as const
export type RaytraceQuality=keyof typeof RAYTRACE_SAMPLES
