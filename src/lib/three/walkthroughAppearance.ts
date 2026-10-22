import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import type { WalkthroughAppearancePayload } from '../walkthrough/delivery.ts'
import { applyWalkthroughMaterialBindings, disposeWalkthroughAsset } from './loadWalkthroughAsset.ts'

type AppearanceGeometry = Pick<WalkthroughAppearancePayload, 'bindings' | 'furniture' | 'skins'>
export function walkthroughRoomAppearanceSignature(app: AppearanceGeometry, roomId: string | null) {
  const furniture = app.furniture.filter(p => p.roomId === roomId), skins = (app.skins ?? []).filter(p => p.roomId === roomId)
  const keys = [...new Set([...furniture, ...skins].map(p => p.binding))].sort()
  return JSON.stringify([furniture, skins, Object.fromEntries(keys.map(k => [k, app.bindings[k]]))])
}

/** Keep the actual Blender meshes, bevels, normals and embedded materials.
 * Regroup with attach() to preserve global transforms under glTF axis roots.
 * Only rooms subsequently changed by the user need replacement geometry. */
export function adoptBlenderWalkthroughAppearance(model: THREE.Group, exported: Partial<AppearanceGeometry>) {
  const root = new THREE.Group(); root.userData.assetKind = 'walkthrough-live-appearance'; model.add(root); model.updateMatrixWorld(true)
  const imported: THREE.Object3D[] = []; model.traverse(o => { if (o.userData.assetKind === 'walkthrough-furniture') imported.push(o) })
  const roomGroups = new Map<string | null, THREE.Group>()
  for (const furnishing of imported) {
    const meshes: THREE.Mesh[] = []; furnishing.traverse(o => { if (o instanceof THREE.Mesh) meshes.push(o) })
    for (const mesh of meshes) {
      const roomId = mesh.userData.roomId || null
      let group = roomGroups.get(roomId)
      if (!group) { group = new THREE.Group(); group.userData.roomId = roomId; group.userData.source = 'blender-glb';
        if (exported.furniture && exported.bindings) group.userData.appearanceSignature = walkthroughRoomAppearanceSignature({ furniture: exported.furniture, skins: exported.skins ?? [], bindings: exported.bindings }, roomId)
        root.add(group); roomGroups.set(roomId, group) }
      group.attach(mesh)
    }
    furnishing.removeFromParent()
  }
  // Already-selected materials must not be flattened/replaced on first load.
  model.traverse(o => { const look = exported.bindings?.[o.userData.materialBinding]; if (look) o.userData.resolvedLook = JSON.stringify(look) })
  return root
}

/** Same canonical fitted parts/skins as Blender. Batch identical room looks;
 * keep these separate from the immutable architectural GLB and its cache. */
export async function buildWalkthroughAppearanceGroup(app: WalkthroughAppearancePayload, isCurrent = () => true) {
  const root = new THREE.Group(); root.userData.assetKind = 'walkthrough-live-appearance'
  const groups = new Map<string, { geometries: THREE.BufferGeometry[]; binding: string; ids: string[]; roomId: string | null }>()
  const add = (geometry: THREE.BufferGeometry, binding: string, id: string, roomId: string | null) => {
    // Match Blender's world-metre UV convention; no room-size stretching.
    const p = geometry.attributes.position, n = geometry.attributes.normal, uv = new Float32Array(p.count * 2)
    for (let i = 0; i < p.count; i++) {
      const axis = [Math.abs(n.getX(i)), Math.abs(n.getY(i)), Math.abs(n.getZ(i))].indexOf(Math.max(Math.abs(n.getX(i)), Math.abs(n.getY(i)), Math.abs(n.getZ(i))))
      uv[i * 2] = axis === 0 ? -p.getZ(i) : p.getX(i); uv[i * 2 + 1] = axis === 1 ? -p.getZ(i) : p.getY(i)
    }
    geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
    const key = JSON.stringify([roomId, app.bindings[binding]]), group = groups.get(key) ?? { geometries: [], binding, ids: [], roomId }
    group.geometries.push(geometry.index ? geometry.toNonIndexed() : geometry); if (geometry.index) geometry.dispose()
    group.ids.push(id); groups.set(key, group)
  }
  try {
    for (const p of app.furniture) {
      const radius = Math.min(p.bevelM ?? .004, Math.min(...p.size) * .18, .025)
      const g = p.shape === 'cyl' ? new THREE.CylinderGeometry(.5, .5, 1, 24) : p.shape === 'ball' ? new THREE.SphereGeometry(.5, 24, 12) : new RoundedBoxGeometry(...p.size, 2, radius)
      if (p.shape !== 'box') g.scale(...p.size)
      g.rotateY(p.rotation); g.translate(...p.position); add(g, p.binding, p.id, p.roomId)
    }
    for (const f of app.skins ?? []) {
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(f.vertices.flat(), 3)); g.setIndex([0, 1, 2, 0, 2, 3]); g.computeVertexNormals(); add(g, f.binding, f.id, f.roomId)
    }
    for (const g of groups.values()) {
      const geometry = mergeGeometries(g.geometries); g.geometries.forEach(x => x.dispose()); g.geometries = []
      if (!geometry) throw new Error('Selected product geometry could not be prepared.')
      const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial()); mesh.userData = { materialBinding: g.binding, materialTileM: 1, partIds: g.ids, roomId: g.roomId }
      mesh.castShadow = mesh.receiveShadow = true; root.add(mesh)
    }
    root.userData.textureWarnings = await applyWalkthroughMaterialBindings(root, app.bindings, isCurrent)
    return root
  } catch (error) { for (const g of groups.values()) g.geometries.forEach(x => x.dispose()); disposeWalkthroughAsset(root); throw error }
}

/** Identity excludes colours/maps: material-only changes keep all collision bodies. */
export const walkthroughFurnishingGeometryKey = (app: WalkthroughAppearancePayload) => JSON.stringify([app.furniture, app.skins?.map(f => [f.id, f.vertices])])

/** Stage only changed rooms. Unchanged room groups are transferred at commit,
 * never cloned or disposed, so a paint/floor edit retains every furnishing mesh.
 * Cancellation owns only the new groups and cannot damage the displayed scene. */
export async function prepareWalkthroughAppearanceUpdate(app: WalkthroughAppearancePayload, previous: THREE.Group | null, isCurrent = () => true) {
  const root = new THREE.Group(); root.userData.assetKind = 'walkthrough-live-appearance'
  const reuse: THREE.Object3D[] = [], rooms = new Set([...app.furniture, ...(app.skins ?? [])].map(p => p.roomId))
  let committed = false
  try {
    for (const roomId of rooms) {
      const furniture = app.furniture.filter(p => p.roomId === roomId), skins = (app.skins ?? []).filter(p => p.roomId === roomId)
      const keys = [...new Set([...furniture, ...skins].map(p => p.binding))].sort()
      const bindings = Object.fromEntries(keys.map(k => [k, app.bindings[k]])), signature = walkthroughRoomAppearanceSignature(app, roomId)
      const old = previous?.children.find(g => g.userData.roomId === roomId && g.userData.appearanceSignature === signature)
      if (old) { reuse.push(old); continue }
      const group = await buildWalkthroughAppearanceGroup({ ...app, furniture, skins, bindings }, isCurrent)
      group.userData.roomId = roomId; group.userData.appearanceSignature = signature; root.add(group)
    }
    if (!isCurrent()) throw new DOMException('Superseded finish update', 'AbortError')
    return { group: root, commit() {
      if (committed) return root
      if (!isCurrent()) throw new DOMException('Superseded finish update', 'AbortError')
      reuse.forEach(g => root.add(g)); committed = true
      root.userData.textureWarnings = root.children.flatMap(g => g.userData.textureWarnings ?? [])
      return root
    }, dispose() { disposeWalkthroughAsset(root) } }
  } catch (error) { disposeWalkthroughAsset(root); throw error }
}
