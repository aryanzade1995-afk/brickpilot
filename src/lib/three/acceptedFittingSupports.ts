import {Matrix3,Mesh,Raycaster,Vector3,type Group} from 'three'
import type {WalkthroughAppearancePayload} from '../walkthrough/delivery.ts'
import type {WalkthroughGeometryPayload} from '../walkthrough/delivery.ts'
import {isWalkthroughShellMesh} from './walkthroughShell.ts'

export function replaceAcceptedLegacyLights(building:Group,geometry:WalkthroughGeometryPayload,app:WalkthroughAppearancePayload){
 const rooms=new Set(app.furniture.filter(p=>p.sourceIds.includes('ceiling-light')).map(p=>p.roomId))
 const semantic=new Set(geometry.metadata.rooms.filter(r=>rooms.has(r.id)).map(r=>r.semanticId))
 building.traverse(o=>{if(o instanceof Mesh&&/^Interior_.+_WarmCeiling_Diffuser$/.test(o.name)&&semantic.has(o.userData.source_id)){
  o.visible=false;o.userData.replacedBySelectedLighting=true
 }})
}

/** A source-plan mounting face must also exist in the accepted Blender model.
 * Do not display switches, exhausts or luminaires attached to empty air when
 * an exterior composition uses a different realized opening/soffit boundary. */
export function reconcileAcceptedFittingSupports(app:WalkthroughAppearancePayload,building:Group):WalkthroughAppearancePayload{
 building.updateMatrixWorld(true)
 const shell:Mesh[]=[]
 building.traverse(o=>{
  if(!(o instanceof Mesh)||!isWalkthroughShellMesh(o))return
  for(let parent=o.parent;parent;parent=parent.parent)if(['walkthrough-live-appearance','walkthrough-furniture'].includes(parent.userData.assetKind))return
  shell.push(o)
 })
 const ray=new Raycaster(),normalMatrix=new Matrix3(),cache=new Map<string,boolean>(),removed=new Set<string>()
 const furniture=app.furniture.filter(part=>{
  const support=part.support;if(!support)return true
  const key=JSON.stringify([part.roomId,support.group,support.point,support.normal])
  let valid=cache.get(key)
  if(valid===undefined){
   const inward=new Vector3(...support.normal).normalize(),origin=new Vector3(...support.point).addScaledVector(inward,.1)
   ray.set(origin,inward.clone().negate());ray.near=0;ray.far=.16
   valid=ray.intersectObjects(shell,false).some(hit=>hit.face&&Math.abs(hit.face.normal.clone().applyMatrix3(normalMatrix.getNormalMatrix(hit.object.matrixWorld)).normalize().dot(inward))>.9)
   cache.set(key,valid)
  }
  if(!valid)removed.add(part.id)
  return valid
 })
 if(!removed.size)return app
 return {...app,furniture,models:app.models?.filter(m=>!m.replaces.some(id=>removed.has(id))),issues:[...app.issues,{code:'FITTING_SUPPORT_UNAVAILABLE',message:'Some fittings have no supporting wall or ceiling in the accepted villa and are omitted from this view; specification quantities remain unchanged.'}]}
}
