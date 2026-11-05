import {BufferGeometry,Float32BufferAttribute,Group,Mesh,MeshStandardMaterial,type Object3D} from 'three'
import type {WalkthroughGeometryPayload} from '../walkthrough/delivery.ts'
import {STAIR_GUARD_VERSION} from '../walkthrough/stairGuards.ts'

/** Replay canonical guards in older exports before extracting collision. */
export function reconcileStairGuardContacts(root:Object3D,geometry:WalkthroughGeometryPayload){
 if(root.getObjectByName('Current_Stair_Guards'))return
 const parts=new Map<string,typeof geometry.faces>()
 for(const face of geometry.faces){
  if(!/_Guard_[01]_(?:rail|post|bar)(?:_|$)/.test(face.canonicalSurfaceId))continue
  const group=parts.get(face.canonicalSurfaceId)??[];group.push(face);parts.set(face.canonicalSurfaceId,group)
 }
 if(!parts.size)return
 const previous:Object3D[]=[]
 let material:MeshStandardMaterial|undefined
 root.traverse(o=>{
  if(!parts.has(o.userData.stair_guard_part_id??o.name.replace(/\.\d+$/,'')))return
  previous.push(o)
  if(o instanceof Mesh){const m=Array.isArray(o.material)?o.material[0]:o.material;if(m instanceof MeshStandardMaterial)material??=m}
 })
 const layer=new Group();layer.name='Current_Stair_Guards';layer.userData.stair_guard_version=STAIR_GUARD_VERSION
 const finish=material?.clone()??new MeshStandardMaterial({color:'#41474b',metalness:.85,roughness:.3})
 for(const [id,faces] of parts){
  const positions:number[]=[]
  for(const face of faces)for(let i=1;i<face.vertices.length-1;i++)for(const p of [face.vertices[0],face.vertices[i],face.vertices[i+1]])positions.push(...p)
  const buffer=new BufferGeometry();buffer.setAttribute('position',new Float32BufferAttribute(positions,3));buffer.computeVertexNormals()
  const mesh=new Mesh(buffer,finish);mesh.name=id;mesh.castShadow=mesh.receiveShadow=true
  mesh.userData={stair_guard_part_id:id,stair_guard_version:STAIR_GUARD_VERSION}
  layer.add(mesh)
 }
 previous.forEach(o=>{o.visible=false})
 root.add(layer)
}
