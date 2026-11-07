import { Box3, Mesh, MeshStandardMaterial, Texture, Vector3, type Group, type Object3D, type Material } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

export const EXTINGUISHER_URL = '/safety-assets/fire-extinguisher.glb'
let bytes: Promise<ArrayBuffer> | undefined

const missingBodyTexture=(m:Material)=>m instanceof MeshStandardMaterial&&/^korean_fire_extinguisher_01_body(?:\.\d+)?$/.test(m.name)&&!m.map

/** Older villa exports stripped the asset's Base Color link. Restore the
 * original packed PBR material on the same UVs; do not recolour its labels,
 * hose or gauge, or move/duplicate the accepted safety geometry. */
export function restoreExtinguisherMaterials(root:Object3D,asset:Group){
 const source=new Map<string,Material>(),retired=new Set<Material>()
 asset.traverse(o=>{if(o instanceof Mesh)for(const m of Array.isArray(o.material)?o.material:[o.material])source.set(m.name.replace(/\.\d+$/,''),m)})
 root.traverse(o=>{if(!(o instanceof Mesh))return
  const restore=(m:Material)=>{
   const original=source.get(m.name.replace(/\.\d+$/,''))
   if(!missingBodyTexture(m)||!(original instanceof MeshStandardMaterial)||!original.map)return m
   retired.add(m);return original
  }
  o.material=Array.isArray(o.material)?o.material.map(restore):restore(o.material)
 })
 const retained=new Set<Material>(),textures=new Set<Texture>()
 root.traverse(o=>{if(o instanceof Mesh)for(const m of Array.isArray(o.material)?o.material:[o.material]){retained.add(m);Object.values(m).forEach(v=>{if(v instanceof Texture)textures.add(v)})}})
 const unusedTextures=new Set<Texture>()
 retired.forEach(m=>{if(retained.has(m))return;Object.values(m).forEach(v=>{if(v instanceof Texture&&!textures.has(v))unusedTextures.add(v)});m.dispose()})
 unusedTextures.forEach(t=>t.dispose())
}

/** Replace only legacy safety boxes, leaving architectural transforms intact.
 * Geometry is shared by instances within this house, never across disposed houses. */
export function replaceExtinguisherBoxes(root: Object3D, asset: Group) {
  root.updateMatrixWorld(true)
  const boxes: Mesh[] = []
  root.traverse(o => { if (o instanceof Mesh && /^L\d+_Extinguisher(?:\.\d+)?$/i.test(o.name) && !o.userData.formstead_extinguisher_asset && !o.userData.formstead_extinguisher_replaced) boxes.push(o) })
  for (const box of boxes) {
    if (!box.parent) continue
    const center = new Box3().setFromObject(box).getCenter(new Vector3())
    // The source marker is centred 1.1 m above its floor. This asset
    // includes its own stand, so its base belongs on that floor.
    center.y -= 1.1
    const instance = asset.clone(true)
    instance.name = box.name + '_Detailed'
    instance.position.copy(box.parent.worldToLocal(center))
    instance.userData = { ...box.userData, formstead_extinguisher_asset: true }
    instance.traverse(o => { if(o instanceof Mesh){o.castShadow=true;o.receiveShadow=true} })
    box.parent.add(instance)
    box.visible = false
    box.userData.formstead_extinguisher_replaced = true
  }
}

export async function upgradeExtinguishers(root: Object3D) {
  let needed = false
  root.traverse(o => { if (o instanceof Mesh && ((/^L\d+_Extinguisher(?:\.\d+)?$/i.test(o.name) && !o.userData.formstead_extinguisher_asset && !o.userData.formstead_extinguisher_replaced)||(Array.isArray(o.material)?o.material:[o.material]).some(missingBodyTexture))) needed = true })
  if (!needed) return
  bytes ??= fetch(EXTINGUISHER_URL).then(r => { if(!r.ok)throw new Error('Extinguisher asset unavailable');return r.arrayBuffer() }).catch(e=>{bytes=undefined;throw e})
  const asset = await new GLTFLoader().parseAsync((await bytes).slice(0), '')
  replaceExtinguisherBoxes(root, asset.scene)
  restoreExtinguisherMaterials(root,asset.scene)
  // A material-only repair does not need the parsed template's mesh buffers.
  const used=new Set();root.traverse(o=>{if(o instanceof Mesh)used.add(o.geometry)})
  asset.scene.traverse(o=>{if(o instanceof Mesh&&!used.has(o.geometry))o.geometry.dispose()})
}
