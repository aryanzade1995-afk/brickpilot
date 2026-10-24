import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { planToThreeGlb } from '../solar/coordinates.ts'
import { plumbingSegments, type VillaPlumbing } from './villaPlumbing.ts'
export const PIPE_COLORS = { water: '#2484a0', drain: '#64716d', vent: '#967b68' } as const
export { plumbingSegments } from './villaPlumbing.ts'
export function createPlumbingGroup(layout: VillaPlumbing, xray=false) {
  const root=new THREE.Group();root.name='Formstead_Service_Pipelines';root.userData={formstead_plumbing:true,source_plan_id:layout.planId,plumbing_signature:layout.signature,qualifications:layout.notes,review:layout.issues}
  const pieces=new Map<keyof typeof PIPE_COLORS,THREE.BufferGeometry[]>(),joints=new Set<string>()
  const add=(system:keyof typeof PIPE_COLORS,g:THREE.BufferGeometry)=>pieces.set(system,[...(pieces.get(system)??[]),g])
  for(const segment of plumbingSegments(layout)){
    const a=planToThreeGlb(segment.from),b=planToThreeGlb(segment.to),from=new THREE.Vector3(a.x,a.y,a.z),to=new THREE.Vector3(b.x,b.y,b.z),length=from.distanceTo(to),r=segment.diameterMm/2000
    if(length<.0001)continue
    const matrix=new THREE.Matrix4().compose(from.clone().add(to).multiplyScalar(.5),new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),to.clone().sub(from).normalize()),new THREE.Vector3(1,1,1))
    add(segment.system,new THREE.CylinderGeometry(r,r,length,12,1).applyMatrix4(matrix))
    for(const p of [from,to]){const key=JSON.stringify([segment.system,p.toArray(),r]);if(joints.has(key))continue;joints.add(key);add(segment.system,new THREE.SphereGeometry(r*1.1,10,6).translate(p.x,p.y,p.z))}
  }
  for(const [system,parts]of pieces){const geometry=mergeGeometries(parts,false);parts.forEach(g=>g.dispose());if(!geometry)continue
    const material=new THREE.MeshStandardMaterial({color:PIPE_COLORS[system],roughness:.44,metalness:.12,depthTest:!xray,depthWrite:!xray,transparent:xray,opacity:xray?.8:1})
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
