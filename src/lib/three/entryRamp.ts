import { BufferGeometry, Float32BufferAttribute, Group, Mesh, MeshStandardMaterial, CylinderGeometry, Quaternion, Vector3 } from 'three'
import type { EntryRamp } from '../engine/entryRamp.ts'
import { planToThreeGlb } from '../solar/coordinates.ts'

/** The same authored vertices exported by Blender. No second ramp sizing. */
export function createEntryRampGroup(ramp:EntryRamp) {
  const root=new Group();root.name='Accessible_Entry_Ramp';root.userData.formstead_entry_ramp=true
  if(ramp.status!=='ready')return root
  const concrete=new MeshStandardMaterial({color:'#C5C0B4',roughness:.88}),metal=new MeshStandardMaterial({color:'#9CA4A0',roughness:.3,metalness:.75})
  for(const solid of ramp.solids){
    const geometry=new BufferGeometry()
    geometry.setAttribute('position',new Float32BufferAttribute(solid.verticesMm.flatMap(([x,y,z])=>{const p=planToThreeGlb({x,y,z});return [p.x,p.y,p.z]}),3));geometry.setIndex(solid.indices);geometry.computeVertexNormals()
    const mesh=new Mesh(geometry,concrete);mesh.name=solid.id;mesh.userData={source_id:solid.id,formstead_entry_ramp:true};mesh.receiveShadow=true;mesh.castShadow=true;root.add(mesh)
  }
  for(const rail of ramp.rails){
    const a=planToThreeGlb(rail.from),b=planToThreeGlb(rail.to),start=new Vector3(a.x,a.y,a.z),end=new Vector3(b.x,b.y,b.z),delta=end.clone().sub(start)
    const mesh=new Mesh(new CylinderGeometry(rail.radiusMm/1000,rail.radiusMm/1000,delta.length(),16),metal)
    mesh.position.copy(start).add(end).multiplyScalar(.5);mesh.quaternion.copy(new Quaternion().setFromUnitVectors(new Vector3(0,1,0),delta.normalize()));mesh.name=rail.id;mesh.userData={source_id:rail.id,formstead_entry_ramp:true};root.add(mesh)
  }
  return root
}
export function disposeEntryRampGroup(root:Group){const materials=new Set<MeshStandardMaterial>();root.traverse(o=>{if(o instanceof Mesh){o.geometry.dispose();for(const m of Array.isArray(o.material)?o.material:[o.material])materials.add(m as MeshStandardMaterial)}});materials.forEach(m=>m.dispose())}
