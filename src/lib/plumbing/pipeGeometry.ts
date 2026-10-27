import fittingAssets from './data/polyhaven-fittings.json' with { type: 'json' }
import { pipeAssembly } from './assembly.ts'
import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { planToThreeGlb } from '../solar/coordinates.ts'
import { plumbingSegments, type VillaPlumbing } from './villaPlumbing.ts'
export const PIPE_COLORS = { water: '#dedbd0', drain: '#55595a', vent: '#99958c' } as const
export { plumbingSegments } from './villaPlumbing.ts'
export function createPlumbingGroup(layout: VillaPlumbing, xray=false) {
  const root=new THREE.Group();root.name='Formstead_Service_Pipelines';root.userData={formstead_plumbing:true,source_plan_id:layout.planId,plumbing_signature:layout.signature,qualifications:layout.notes,review:layout.issues,asset_source:fittingAssets.source,asset_license:fittingAssets.license}
  const pieces=new Map<keyof typeof PIPE_COLORS,THREE.BufferGeometry[]>()
  const add=(system:keyof typeof PIPE_COLORS,g:THREE.BufferGeometry)=>pieces.set(system,[...(pieces.get(system)??[]),g])
  const assembly=layout.assembly??pipeAssembly(plumbingSegments(layout))
  for(const segment of assembly.tubes){
    const a=planToThreeGlb(segment.from),b=planToThreeGlb(segment.to),from=new THREE.Vector3(a.x,a.y,a.z),to=new THREE.Vector3(b.x,b.y,b.z),length=from.distanceTo(to),r=segment.diameterMm/2000
    if(length<.0001)continue
    const matrix=new THREE.Matrix4().compose(from.clone().add(to).multiplyScalar(.5),new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),to.clone().sub(from).normalize()),new THREE.Vector3(1,1,1))
    add(segment.system,new THREE.CylinderGeometry(r,r,length,24,1,true).applyMatrix4(matrix))
  }
  for(const f of assembly.fittings){
    const asset=fittingAssets.parts[f.kind], geometry=new THREE.BufferGeometry()
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(asset.positions,3));geometry.setAttribute('normal',new THREE.Float32BufferAttribute(asset.normals,3));const uv=new Float32Array(asset.positions.length/3*2);for(let i=0;i<asset.positions.length/3;i++){uv[i*2]=Math.atan2(asset.positions[i*3+1],asset.positions[i*3])/(Math.PI*2)+.5;uv[i*2+1]=asset.positions[i*3+2]/asset.nominalDiameterM}geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2))
    const [x,y,z]=f.basis,scale=f.diameterMm/asset.nominalDiameterM/1000,p=planToThreeGlb(f.position)
    const matrix=new THREE.Matrix4().set(x.x*scale,y.x*scale,z.x*scale,p.x,x.z*scale,y.z*scale,z.z*scale,p.y,-x.y*scale,-y.y*scale,-z.y*scale,p.z,0,0,0,1)
    geometry.applyMatrix4(matrix);add(f.system,geometry)
  }
  for(const [system,parts]of pieces){const nonIndexed=parts.map(g=>g.index?g.toNonIndexed():g),geometry=mergeGeometries(nonIndexed,false);new Set([...parts,...nonIndexed]).forEach(g=>g.dispose());if(!geometry)continue
    const material=new THREE.MeshStandardMaterial({color:PIPE_COLORS[system],roughness:.32,metalness:.04,depthTest:!xray,depthWrite:!xray,transparent:xray,opacity:xray?.8:1})
    const mesh=new THREE.Mesh(geometry,material);mesh.name=`Service_${system}`;mesh.userData={formstead_plumbing:true,source_plan_id:layout.planId,plumbing_signature:layout.signature,service:system};mesh.renderOrder=xray?30:0;root.add(mesh)
  }
  return root
}
export function disposePlumbingGroup(root:THREE.Group){root.traverse(o=>{const mesh=o as THREE.Mesh;if(mesh.isMesh){mesh.geometry.dispose();for(const m of Array.isArray(mesh.material)?mesh.material:[mesh.material])m.dispose()}})}

/** Export real opaque service materials even while the viewer uses X-ray.
 * All cached building geometry/materials remain shared and untouched. */
export function plumbingExportScene(source: THREE.Object3D) {
  const root=source.clone(true), materials:THREE.Material[]=[]
  root.traverse(object=>{
    const mesh=object as THREE.Mesh
    if(!mesh.isMesh || !mesh.userData.formstead_plumbing)return
    const copy=(material:THREE.Material)=>{const m=material.clone();m.transparent=false;m.opacity=1;m.depthTest=true;m.depthWrite=true;materials.push(m);return m}
    mesh.material=Array.isArray(mesh.material)?mesh.material.map(copy):copy(mesh.material)
  })
  return {root,dispose:()=>materials.forEach(m=>m.dispose())}
}
