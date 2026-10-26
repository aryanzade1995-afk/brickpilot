import { Box3, Mesh, Vector3, type Group } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { disposeWalkthroughAsset } from './loadWalkthroughAsset.ts'
import type { AcceptedMeshCollision, AcceptedDoor } from '../walkthrough/navigation.ts'
import type { SceneOpening } from '../walkthrough/sceneTypes.ts'

export function acceptedVillaUrl(url: string) {
  if (!/^\/api\/villas\/[a-f0-9-]{36}\/files\/[a-zA-Z0-9_-]+\.glb$/.test(url)) throw new Error('Select the accepted Blender villa from 3D Massing.')
  return url
}

/** Parse the very same file used in BlenderVillaPanel. No prepareVillaScene,
 * material resolver, replacement furniture, recentering or geometry repair.
 * Its glTF Y-up transform already maps plan x/y mm to x/-z metres. */
export async function parseAcceptedVilla(bytes: ArrayBuffer, planId: string) {
  const { scene } = await new GLTFLoader().parseAsync(bytes, '')
  let matching = false, foreign = false, meshes = 0
  scene.traverse(o => {
    const id = o.userData.source_plan_id ?? o.userData.sourcePlanId
    if (id) { matching ||= id === planId; foreign ||= id !== planId }
    if (o instanceof Mesh) {
      meshes++
      // Renderer flags are not serialized by glTF. Geometry/materials stay intact.
      o.castShadow = !(Array.isArray(o.material) ? o.material : [o.material]).every(m => m.transparent)
      o.receiveShadow = true
    }
  })
  if (!matching || foreign || !meshes) { disposeWalkthroughAsset(scene); throw new Error('This Blender model does not match the current house.') }
  return scene
}

export async function loadAcceptedVilla(url: string, planId: string, signal?: AbortSignal) {
  const response = await fetch(acceptedVillaUrl(url), { signal })
  if (!response.ok) throw new Error('The accepted Blender villa is unavailable. Open 3D Massing to check its export.')
  const bytes=await response.arrayBuffer(),scene = await parseAcceptedVilla(bytes, planId)
  scene.userData.acceptedSourceSha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('')
  if (signal?.aborted) { disposeWalkthroughAsset(scene); throw new DOMException('Cancelled', 'AbortError') }
  return scene
}

/** Framing only: retain the exported backdrop in the scene, but do not let its
 * 100m presentation plane push the camera away from the actual villa. */
export function acceptedVillaBounds(scene: Group) {
  scene.updateMatrixWorld(true)
  const bounds = new Box3()
  scene.traverseVisible(o => {
    if (!(o instanceof Mesh)) return
    for (let parent = o; parent; parent = parent.parent as Mesh) if (parent.userData.presentation_only || parent.name.startsWith('Ground_Context')) return
    bounds.expandByObject(o)
  })
  return bounds.isEmpty() ? new Box3().setFromObject(scene) : bounds
}

/** Build collision from actual displayed triangles, with all parent transforms
 * baked into a separate copy. Holes, detailed stairs, glass and furniture keep
 * their real extents. Closed doors remain closed, exactly as exported. */
export function acceptedVillaCollision(scene: Group, openings: SceneOpening[] = []): AcceptedMeshCollision {
  reconcileAcceptedOpenPortals(scene, openings)
  scene.updateMatrixWorld(true)
  const doors = acceptedVillaDoors(scene, openings)
  const meshes: Mesh[] = []; let count = 0, indexCount = 0
  scene.traverseVisible(o => {
    if (!(o instanceof Mesh)) return
    if (o.userData.walkthroughDoorId) return
    for (let parent = o.parent; parent; parent = parent.parent) if (parent.userData.assetKind === 'walkthrough-live-appearance' || parent.userData.assetKind === 'walkthrough-furniture') return
    if ('isSkinnedMesh' in o || 'isInstancedMesh' in o || o.morphTargetInfluences?.some(v => v !== 0)) throw new Error('This accepted model needs an animated-mesh collision adapter before walking.')
    const p = o.geometry.getAttribute('position')
    if (!p) return
    meshes.push(o); count += p.count; indexCount += o.geometry.index?.count ?? p.count
  })
  if (!count || indexCount > 6_000_000 || indexCount % 3) throw new Error('This accepted model exceeds the supported walking mesh size.')
  const vertices = new Float32Array(count * 3), indices = new Uint32Array(indexCount), point = new Vector3()
  let vertexOffset = 0, indexOffset = 0
  for (const mesh of meshes) {
    const p = mesh.geometry.getAttribute('position'), index = mesh.geometry.index
    for (let i = 0; i < p.count; i++) {
      point.fromBufferAttribute(p, i).applyMatrix4(mesh.matrixWorld)
      vertices.set(point.toArray(), (vertexOffset + i) * 3)
    }
    const reverse = mesh.matrixWorld.determinant() < 0
    for (let i = 0, n = index?.count ?? p.count; i < n; i += 3) {
      for (let k = 0; k < 3; k++) indices[indexOffset + i + k] = vertexOffset + (index ? index.getX(i + (reverse && k ? 3 - k : k)) : i + (reverse && k ? 3 - k : k))
    }
    vertexOffset += p.count; indexOffset += index?.count ?? p.count
  }
  return { vertices, indices, ...(doors.length ? { doors } : {}) }
}

/** Old Blender exports sometimes gave a source-declared open portal sliding
 * glass despite leaf:false. Remove only that explicitly identified assembly,
 * from both rendering and physics; never punch holes in walls or windows.
 * New exports obey the same opening precedence in geometry/openings.py. */
export function reconcileAcceptedOpenPortals(scene: Group, openings: SceneOpening[]) {
  const open = new Set(openings.filter(o => o.kind !== 'window' && o.operation === 'open').map(o => o.sourceId))
  scene.traverse(o => {
    if (!(o instanceof Mesh) || !open.has(o.userData.source_id)) return
    const source = o.userData.source_id, name = o.userData.finish_parent ?? o.name
    if (name === `Door_${source}_Leaf` || name === `Door_${source}_Handle` || name.startsWith(`Door_${source}_Sliding`)) {
      o.visible = false; o.userData.sourceOpenPortal = true
    }
  })
}

/** Adapt the actual exported leaves, never replacement boxes in the scene.
 * Frames, tracks, windows and open stair portals remain fixed. Older GLBs have
 * source IDs + stable Blender names; newer exports may carry leaf metadata.
 * A two-track slider has one moving sash and one fixed sash: half-width access.
 */
export function acceptedVillaDoors(scene: Group, openings: SceneOpening[]): AcceptedDoor[] {
  const result: AcceptedDoor[] = []
  for (const opening of openings.filter(o => o.kind !== 'window' && o.operation !== 'open')) {
    const parts: Mesh[] = []
    scene.traverseVisible(o => { if (o instanceof Mesh && o.userData.source_id === opening.sourceId) parts.push(o) })
    const source = opening.sourceId
    const groups = [
      { suffix: 'single', names: [`Door_${source}_Leaf`, `Door_${source}_Handle`], hinge: opening.hinge ?? 'a', swing: opening.swing ?? 1, operation: 'hinged' },
      { suffix: 'left', names: [`MainEntry_${source}_Leaf_Left`, `MainEntry_${source}_CarvedPanel_Left_`, `MainEntry_${source}_Handle_-1`, `Door_${source}_Leaf_Left`, `Door_${source}_Handle_Left`], hinge: 'a', swing: opening.swing ?? 1, operation: 'hinged' },
      { suffix: 'right', names: [`MainEntry_${source}_Leaf_Right`, `MainEntry_${source}_CarvedPanel_Right_`, `MainEntry_${source}_Handle_1`, `Door_${source}_Leaf_Right`, `Door_${source}_Handle_Right`], hinge: 'b', swing: opening.swing ?? 1, operation: 'hinged' },
      { suffix: 'slider', names: [`Door_${source}_SlidingLeft_`], hinge: 'a', swing: 1, operation: 'sliding' },
      { suffix: 'surface', names: [`Door_${source}_SurfaceSlide_`], hinge: 'a', swing: 1, operation: 'sliding' },
    ] as const
    for (const group of groups) {
      // Exported finish profiles are independent meshes (e.g. timber slats).
      // Their explicit finish_parent must follow the leaf too, otherwise the
      // opened door leaves an invisible-looking solid finish across the exit.
      const members = parts.filter(p => (group.suffix !== 'surface' || p.userData.opening_operation === 'surface-sliding-door') && (group.names.some(name => [p.name, p.userData.finish_parent].some(part => typeof part === 'string' && (name.endsWith('_') ? part.startsWith(name) : part === name))) ||
        group.suffix === 'single' && opening.emergencyExit && p.name.startsWith('EmergencyDoor_ReleaseBar')))
      if (!members.length) continue
      const box = new Box3(); members.forEach(p => box.expandByObject(p))
      if (box.isEmpty()) continue
      const id = `${opening.id}:${group.suffix}`
      members.forEach(p => { p.userData.walkthroughDoorId = id })
      const fixed = new Box3()
      if (group.operation === 'sliding') parts.filter(p => p.name.startsWith(`Door_${source}_SlidingRight_`)).forEach(p => fixed.expandByObject(p))
      const movement = !fixed.isEmpty() ? fixed.getCenter(new Vector3()).sub(box.getCenter(new Vector3())) : null
      const slide = members.find(p => Array.isArray(p.userData.slide_translation_mm))?.userData.slide_translation_mm as number[] | undefined
      result.push({ id, openingId: opening.id, hinge: group.hinge, swing: group.swing as 1 | -1, operation: group.operation,
        ...(slide?.length === 3 && slide.every(Number.isFinite) ? { translation: [slide[0]/1000, slide[2]/1000, -slide[1]/1000] as [number, number, number] } : movement ? { translation: (opening.orient === 'h' ? [movement.x, 0, 0] : [0, 0, movement.z]) as [number, number, number] } : {}),
        collider: { id, sourceIds: [source], floorId: opening.floorId, kind: 'door', min: box.min.toArray(), max: box.max.toArray() } })
    }
  }
  return result
}
