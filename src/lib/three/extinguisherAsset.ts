import { Box3, Mesh, Vector3, type Group, type Object3D } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

export const EXTINGUISHER_URL = '/safety-assets/fire-extinguisher.glb'
let bytes: Promise<ArrayBuffer> | undefined

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
  root.traverse(o => { if (o instanceof Mesh && /^L\d+_Extinguisher(?:\.\d+)?$/i.test(o.name) && !o.userData.formstead_extinguisher_asset && !o.userData.formstead_extinguisher_replaced) needed = true })
  if (!needed) return
  bytes ??= fetch(EXTINGUISHER_URL).then(r => { if(!r.ok)throw new Error('Extinguisher asset unavailable');return r.arrayBuffer() }).catch(e=>{bytes=undefined;throw e})
  const asset = await new GLTFLoader().parseAsync((await bytes).slice(0), '')
  replaceExtinguisherBoxes(root, asset.scene)
}
