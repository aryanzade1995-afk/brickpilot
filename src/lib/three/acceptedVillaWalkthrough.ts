import { Box3, Mesh, Vector3, type Group } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { disposeWalkthroughAsset } from './loadWalkthroughAsset.ts'
import type { AcceptedMeshCollision } from '../walkthrough/navigation.ts'

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
  const scene = await parseAcceptedVilla(await response.arrayBuffer(), planId)
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
export function acceptedVillaCollision(scene: Group): AcceptedMeshCollision {
  scene.updateMatrixWorld(true)
  const meshes: Mesh[] = []; let count = 0, indexCount = 0
  scene.traverseVisible(o => {
    if (!(o instanceof Mesh)) return
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
  return { vertices, indices }
}
