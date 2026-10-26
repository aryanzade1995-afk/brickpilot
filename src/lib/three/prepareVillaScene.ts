import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { separateCoplanar } from './separateCoplanar.ts'

// A route remount must not repeat geometry repairs or upload new copies of the
// same static villa. Each canvas gets its own hierarchy and shares prepared data.
const prepared = new WeakMap<THREE.Object3D, Map<string, THREE.Object3D>>()

export function prepareVillaScene(source: THREE.Object3D, anisotropy: number, separateRoofTanks=false) {
  const key=`${anisotropy}:${separateRoofTanks}`
  let variants = prepared.get(source)
  if (!variants) { variants = new Map(); prepared.set(source, variants) }
  let template = variants.get(key)
  if (!template) {
    template = source.clone(true)
    const remove: THREE.Object3D[] = []
    template.traverse(object => {
      // Combined GLBs carry tagged PV. Strip before caching the architecture;
      // the current canonical SolarLayer is then attached exactly once.
      if (separateRoofTanks&&/^Roof_WaterTank_\d+/.test(object.name) || object.userData.formstead_plumbing || object.userData.formstead_solar || object.userData.presentation_only || object.name.startsWith('Ground_Context') ||
        'isLight' in object || 'isCamera' in object) remove.push(object)
    })
    remove.forEach(object => object.removeFromParent())
    template.updateMatrixWorld(true)
    const size = new THREE.Vector3(), textures = new Set<THREE.Texture>()
    template.traverse(object => {
      const mesh = object as THREE.Mesh
      if (!mesh.isMesh) return
      mesh.castShadow = true; mesh.receiveShadow = true
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material])
        for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value)
      if (/_Flutes(\.\d+)?$/.test(mesh.name)) {
        mesh.geometry.computeBoundingBox()
        const box = mesh.geometry.boundingBox!
        const slab = new THREE.BoxGeometry(...box.getSize(new THREE.Vector3()).toArray())
        slab.translate(...box.getCenter(new THREE.Vector3()).toArray())
        mesh.geometry = slab
        mesh.castShadow = false
      } else {
        new THREE.Box3().setFromObject(mesh).getSize(size)
        if (Math.min(size.x, size.y, size.z) <= 0.06) mesh.castShadow = false
      }
    })
    for (const texture of textures) {
      texture.anisotropy = anisotropy; texture.generateMipmaps = true
      texture.minFilter = THREE.LinearMipmapLinearFilter; texture.needsUpdate = true
    }
    separateCoplanar(template)
    batchOpaqueMeshes(template)
    variants.set(key, template)
  }
  return template.clone(true)
}

/** Bake static opaque pieces into one mesh per material/layout. Glass remains
 * separate so Three can still sort panes and transmission correctly. */
function batchOpaqueMeshes(root: THREE.Object3D) {
  root.updateMatrixWorld(true)
  const inverse = root.matrixWorld.clone().invert()
  const groups = new Map<string, THREE.Mesh[]>()
  root.traverse(object => {
    const mesh = object as THREE.Mesh
    if (!mesh.isMesh || 'isSkinnedMesh' in mesh || 'isInstancedMesh' in mesh || mesh.children.length || !mesh.visible ||
      Array.isArray(mesh.material) || mesh.morphTargetInfluences?.length) return
    for (let parent = mesh.parent; parent; parent = parent.parent) if (!parent.visible) return
    const material = mesh.material as THREE.MeshPhysicalMaterial
    if (material.transparent || material.transmission > 0 || !material.depthWrite) return
    const geometry = mesh.geometry
    if (geometry.drawRange.start !== 0 || geometry.drawRange.count !== Infinity) return
    const layout = Object.entries(geometry.attributes).map(([name, attr]) =>
      `${name}:${attr.itemSize}:${attr.normalized}`).sort().join('|')
    const key = `${material.uuid}:${mesh.castShadow}:${mesh.receiveShadow}:${mesh.renderOrder}:${mesh.layers.mask}:${layout}`
    const group = groups.get(key) ?? []
    group.push(mesh); groups.set(key, group)
  })
  for (const meshes of groups.values()) {
    if (meshes.length < 2) continue
    const indexed = meshes.every(mesh => mesh.geometry.index)
    const parts = meshes.map(mesh => {
      const geometry = !indexed && mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone()
      geometry.applyMatrix4(inverse.clone().multiply(mesh.matrixWorld))
      return geometry
    })
    const geometry = mergeGeometries(parts, false)
    parts.forEach(part => part.dispose())
    if (!geometry) continue
    const first = meshes[0], batch = new THREE.Mesh(geometry, first.material)
    batch.name = `VillaBatch_${first.material instanceof THREE.Material ? first.material.name : groups.size}`
    batch.castShadow = first.castShadow; batch.receiveShadow = first.receiveShadow
    batch.renderOrder = first.renderOrder; batch.layers.mask = first.layers.mask
    meshes.forEach(mesh => mesh.removeFromParent())
    root.add(batch)
  }
}
