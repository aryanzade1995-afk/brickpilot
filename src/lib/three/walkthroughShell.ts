import {DoubleSide,Mesh,type Material,type Object3D} from 'three'
export const isWalkthroughShellMesh=(o:Object3D)=>/^(?:(?:GF|FF|SF|TF|F\d+|L\d+)_Wall_|(?:GF|FF|SF|TF|F\d+|L\d+)_(?:(?:Roof_)?Slab_|Terrace_Deck_)|Beam_|Column_)/.test(o.name)
/** Only the opaque architectural shell is two-sided. Thin/legacy exported
 * inward faces must remain visible when approached from either room. Glass,
 * opening geometry, thickness, normals and collision buffers stay untouched. */
export function prepareWalkthroughShell(root:Object3D){
 const owned=new Map<Material,Material>()
 root.traverse(o=>{
  if(!(o instanceof Mesh)||!isWalkthroughShellMesh(o))return
  if(['glass','water'].includes(o.userData.material_role))return
  o.userData.walkthroughOpaqueShell=true
  const convert=(source:Material)=>{
   if(source.userData.walkthroughOpaqueShell)return source
   let material=owned.get(source)
   if(!material){material=source.clone();material.side=DoubleSide;material.transparent=false;material.opacity=1;material.depthWrite=true;material.userData.walkthroughOpaqueShell=true;owned.set(source,material)}
   return material
  }
  o.material=Array.isArray(o.material)?o.material.map(convert):convert(o.material)
 })
}
