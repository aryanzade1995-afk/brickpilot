import { Box3, Group, Mesh, MeshStandardMaterial, Vector3, type Object3D } from 'three'

export const SHADE_CONTROL='visual-model-balcony-shade'
export const SHADE_CHOICES=[['original','Original shade'],['sage','Sage canopy'],['sand','Sand canopy'],['terracotta','Terracotta modules']] as const
export type ShadeChoice=typeof SHADE_CHOICES[number][0]
export function shadeChoice(value:unknown):ShadeChoice{return SHADE_CHOICES.some(([id])=>id===value)?value as ShadeChoice:'original'}

/** Only source-tagged balconies with an already accepted overhead frame.
 * No inference from windows, arbitrary terraces or room bounding boxes. */
export function shadeAnchors(root:Object3D){
 root.updateMatrixWorld(true)
 const slabs=new Map<string,Mesh>(),parts=new Map<string,Mesh[]>()
 root.traverse(o=>{if(!(o instanceof Mesh))return
  if(/_Balcony_.+_Slab$/.test(o.name)&&o.userData.source_id)slabs.set(o.userData.source_id,o)
  if(o.userData.grammar_category==='BALCONY'&&o.userData.source_anchor_id){const id=o.userData.source_anchor_id;parts.set(id,[...(parts.get(id)??[]),o])}
 })
 return [...slabs].flatMap(([id,slab])=>{
  const floor=new Box3().setFromObject(slab),overhead=(parts.get(id)??[]).filter(o=>/_Beam_|_Slab_/.test(o.name)&&new Box3().setFromObject(o).min.y>floor.max.y+2)
  if(!overhead.length)return []
  return [{id,box:floor,top:Math.max(...overhead.map(o=>new Box3().setFromObject(o).max.y))}]
 })
}

/** Sibling layer; never mutate accepted geometry/materials or seed inputs. */
export function createShadeOverlay(source:Object3D,asset:Object3D,choice:ShadeChoice){
 const root=new Group(),owned:MeshStandardMaterial[]=[]
 root.name='Formstead_Shade_Variation';root.userData.formstead_shade=true
 if(choice==='original')return {root,dispose:()=>{}}
 const box=new Box3().setFromObject(asset),size=box.getSize(new Vector3()),center=box.getCenter(new Vector3())
 if(Math.min(size.x,size.y,size.z)<=0)return {root,dispose:()=>{}}
 for(const anchor of shadeAnchors(source)){
  const extent=anchor.box.getSize(new Vector3()),at=anchor.box.getCenter(new Vector3())
  const count=choice==='terracotta'?Math.max(2,Math.ceil(extent.x/2)):1
  for(let i=0;i<count;i++){
   const group=new Group(),copy=asset.clone(true)
   copy.position.sub(new Vector3(center.x,box.min.y,center.z))
   copy.traverse(o=>{if(!(o instanceof Mesh))return;o.castShadow=true;o.receiveShadow=true
    if(choice==='sage')return
    const material=new MeshStandardMaterial({color:choice==='sand'?'#C9B695':'#B06D4F',roughness:.88,metalness:0});o.material=material;owned.push(material)
   })
   group.add(copy);group.scale.set(extent.x/count/size.x,.28/size.y,extent.z/size.z)
   group.position.set(anchor.box.min.x+extent.x*(i+.5)/count,anchor.top+.025,at.z)
   group.userData={formstead_shade:true,source_anchor_id:anchor.id};root.add(group)
  }
 }
 return {root,dispose:()=>owned.forEach(m=>m.dispose())}
}
