import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { Look } from './dressRoom.ts'

/** Loads the combined export exactly once. Do not add furniture.glb on top:
 * the combined model already contains the procedural furniture root.
 */
export async function loadWalkthroughAsset(url: string, expectedPlanId: string, signal?: AbortSignal) {
  if (!/^\/api\/walkthrough-assets\/[a-f0-9]{64}\/house\.glb$/.test(url)) throw new Error('Invalid walkthrough asset URL')
  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error('The walkthrough model is unavailable. Generate the assets again.')
  const bytes = await response.arrayBuffer()
  const gltf = await new GLTFLoader().parseAsync(bytes, '')
  if (signal?.aborted) { disposeWalkthroughAsset(gltf.scene); throw new DOMException('Cancelled', 'AbortError') }
  let matching = false, foreign = false
  gltf.scene.traverse(o => {
    if (o.userData.sourcePlanId) { matching ||= o.userData.sourcePlanId === expectedPlanId; foreign ||= o.userData.sourcePlanId !== expectedPlanId }
    if (o instanceof THREE.Mesh) { const materials = Array.isArray(o.material) ? o.material : [o.material]
      o.castShadow = !materials.every(m => m.transparent); o.receiveShadow = true }
  })
  if (!matching || foreign) { disposeWalkthroughAsset(gltf.scene); throw new Error('The walkthrough belongs to a different house.') }
  return gltf.scene
}

/** Runtime finish replacement changes material slots only. Vertex/index buffers,
 * stable surface IDs, world transforms and the architectural model stay intact.
 * Furniture geometry changes use furniture.glb as a separate replacement asset.
 */
export async function applyWalkthroughMaterialBindings(root: THREE.Object3D, bindings: Record<string, Look>, isCurrent = () => true) {
  const prepared = new Map<string, THREE.MeshStandardMaterial>(), textures = new Map<string, THREE.Texture>()
  const warnings = new Set<string>(), failedImages = new Set<string>(), missingKeys = new Set<string>()
  const originalTiles = new Map<string, number>()
  const previousLooks = new Map<string, string>(), originalSizes = new Map<string, number[]>()
  const slots: { mesh: THREE.Mesh; index: number; key: string; multi: boolean }[] = []
  root.traverse(o => {
    if (!(o instanceof THREE.Mesh)) return
    const keys: (string | null)[] = o.userData.materialBindings ?? [o.userData.materialBinding]
    keys.forEach((key, index) => { if (!key) return
      slots.push({ mesh: o, index, key, multi: !!o.userData.materialBindings })
      originalTiles.set(key, o.userData.materialTileM ?? 1)
      originalSizes.set(key, o.userData.materialTileSizeM ?? [o.userData.materialTileM ?? 1, o.userData.materialTileM ?? 1])
      previousLooks.set(key, o.userData.materialBindings ? o.userData.resolvedLooks?.[index] : o.userData.resolvedLook)
    })
  })
  try {
    for (const [key, look] of Object.entries(bindings)) {
      if (!originalTiles.has(key) || previousLooks.get(key) === JSON.stringify(look)) continue
      const material = new THREE.MeshStandardMaterial({ color: look.color, roughness: look.rough, metalness: look.metal ?? 0,
        transparent: (look.opacity ?? 1) < 1, opacity: look.opacity ?? 1, side: (look.opacity ?? 1) < 1 ? THREE.DoubleSide : THREE.FrontSide,
        emissive: look.emissive ?? '#000000', emissiveIntensity: look.glow ?? 0 })
      prepared.set(key, material)
      const image = look.surface?.image
      if (image) {
        if (!image.startsWith('/') || image.startsWith('//') || image.split('/').includes('..')) { warnings.add(image); missingKeys.add(key); continue }
        const size = look.surface?.tileSizeM ?? [look.surface?.tileM ?? 1, look.surface?.tileM ?? 1], original = originalSizes.get(key)!
        const ratios = size.map((n, i) => original[i] / Math.max(.01, n)), textureKey = `${image}:${ratios}`
        let texture = textures.get(textureKey)
        if (!texture && !failedImages.has(image)) { try { texture = await new THREE.TextureLoader().loadAsync(image) } catch { failedImages.add(image); warnings.add(image); missingKeys.add(key); continue }
          texture.colorSpace = THREE.SRGBColorSpace; texture.flipY = false; texture.anisotropy = 8;
          texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.repeat.set(ratios[0], ratios[1]); textures.set(textureKey, texture) }
        if (!texture) { missingKeys.add(key); continue }
        material.map = texture; material.color.set('#ffffff')
        // Preserve original UV buffers; texture repeat handles a changed tile size.
      }
    }
    if (!isCurrent()) throw new DOMException('Superseded finish update', 'AbortError')
    const previous = new Set<THREE.Material>()
    for (const { mesh, index, key, multi } of slots) {
      const material = prepared.get(key)
      if (!material) continue
      if (multi) {
        const materials = Array.isArray(mesh.material) ? [...mesh.material] : [mesh.material]
        previous.add(materials[index]); materials[index] = material; mesh.material = materials
        mesh.userData.resolvedLooks ??= {}; mesh.userData.resolvedLooks[index] = JSON.stringify(bindings[key])
      } else {
        for (const old of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) previous.add(old)
        mesh.material = material; mesh.userData.resolvedLook = JSON.stringify(bindings[key])
      }
      mesh.castShadow = !(Array.isArray(mesh.material) ? mesh.material : [mesh.material]).every(m => m.transparent)
      mesh.userData.materialImageUnavailable = missingKeys.has(key) ? bindings[key].surface?.image : null
    }
    // Some GLBs share old slots with unmodified objects. Dispose only unreferenced slots.
    const retained = new Set<THREE.Material>()
    root.traverse(o => { if (o instanceof THREE.Mesh) for (const m of Array.isArray(o.material) ? o.material : [o.material]) retained.add(m) })
    const usedTextures = new Set<THREE.Texture>(), oldTextures = new Set<THREE.Texture>()
    for (const material of retained) for (const value of Object.values(material)) if (value instanceof THREE.Texture) usedTextures.add(value)
    for (const material of previous) if (!retained.has(material)) {
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) oldTextures.add(value)
      material.dispose()
    }
    for (const texture of oldTextures) if (!usedTextures.has(texture)) texture.dispose()
    for (const material of prepared.values()) if (!retained.has(material)) material.dispose()
    root.traverse(o => { if (o.userData.materialImageUnavailable) warnings.add(o.userData.materialImageUnavailable) })
    return [...warnings]
  } catch (error) { for (const m of prepared.values()) m.dispose(); for (const tex of textures.values()) tex.dispose(); throw error }
}

export function disposeWalkthroughAsset(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>()
  root.traverse(o => { if (!(o instanceof THREE.Mesh)) return; geometries.add(o.geometry)
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) { materials.add(m); for (const value of Object.values(m)) if (value instanceof THREE.Texture) textures.add(value) }
  })
  geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); textures.forEach(t => { (t.source?.data as { close?: () => void })?.close?.(); t.dispose() }); root.clear()
}
