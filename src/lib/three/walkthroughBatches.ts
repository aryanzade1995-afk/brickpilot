import { Box3, BufferGeometry, Group, Material, Matrix4, Mesh, Texture, Vector3, type Object3D } from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

/** Reversible GPU preparation, never the architectural source or physics model.
 * Keep original meshes/IDs for finish edits. Spatial batches retain frustum
 * culling; moving leaves and transparent glass are deliberately excluded. */
export function batchWalkthroughScene(root: Group) {
  root.updateMatrixWorld(true)
  const inverse = root.matrixWorld.clone().invert(), bounds = new Box3(), centre = new Vector3()
  const groups = new Map<string, { material: Material; meshes: Set<Mesh>; parts: BufferGeometry[]; shadow: boolean; receive: boolean; order: number; mask: number }>()
  const originals = new Set<Mesh>(), batchRoot = new Group()
  const materialKeys = new Map<Material, string>()
  const keyOf = (material: Material) => {
    let key = materialKeys.get(material)
    if (key) return key
    // Independent room slots can have identical GPU uniforms. UUID-based
    // grouping would leave hundreds of identical wall/furniture draw calls.
    const values: Record<string, unknown> = {}
    for (const [name, value] of Object.entries(material).sort(([a], [b]) => a.localeCompare(b))) {
      if (['id', 'uuid', 'name', 'version', 'userData', '_listeners'].includes(name) || typeof value === 'function') continue
      if (value instanceof Texture) {
        const image = value.source?.data
        values[name] = [value.userData.proceduralKey || image?.currentSrc || image?.src || value.source.uuid, value.mapping, value.channel, value.wrapS, value.wrapT,
          value.repeat.toArray(), value.offset.toArray(), value.center.toArray(), value.rotation, value.flipY, value.colorSpace, value.magFilter, value.minFilter]
      } else if (value && typeof value === 'object' && 'toArray' in value && typeof value.toArray === 'function') values[name] = value.toArray()
      else values[name] = value
    }
    key = JSON.stringify(values); materialKeys.set(material, key); return key
  }
  batchRoot.name = 'Walkthrough_GPU_batches'; batchRoot.userData.walkthroughBatch = true
  root.traverseVisible(object => {
    if (!(object instanceof Mesh) || object.userData.walkthroughDoorId || object.userData.walkthroughBatch ||
      'isSkinnedMesh' in object || 'isInstancedMesh' in object || object.morphTargetInfluences?.length || object.children.length) return
    for (let parent: Object3D | null = object.parent; parent; parent = parent.parent) if (parent.userData.walkthroughBatch) return
    const source = object.geometry, count = source.index?.count ?? source.getAttribute('position')?.count ?? 0
    if (!count || source.drawRange.start !== 0 || source.drawRange.count !== Infinity) return
    const materials = Array.isArray(object.material) ? object.material : [object.material]
    // A mesh is all-or-nothing, otherwise hiding it would lose its glass slots.
    if (materials.some(m => m.transparent || ('transmission' in m && Number(m.transmission) > 0) || !m.depthWrite)) return
    const matrix = new Matrix4().multiplyMatrices(inverse, object.matrixWorld)
    bounds.setFromObject(object).getCenter(centre)
    const cell = [Math.floor(centre.x / 8), Math.floor(centre.y / 3), Math.floor(centre.z / 8)].join(':')
    const layout = (Object.entries(source.attributes) as [string, { itemSize: number; normalized: boolean }][]).map(([k, a]) => `${k}:${a.itemSize}:${a.normalized}`).sort().join('|')
    for (const slot of source.groups.length ? source.groups : [{ start: 0, count, materialIndex: 0 }]) {
      // Three ignores group materialIndex when the mesh has one material.
      // BoxGeometry still has six face groups; all six must survive batching.
      const material = Array.isArray(object.material) ? materials[slot.materialIndex ?? 0] : materials[0]
      if (!material || slot.count <= 0) continue
      const key = `${cell}|${keyOf(material)}|${object.castShadow}|${object.receiveShadow}|${object.renderOrder}|${object.layers.mask}|${layout}`
      const group = groups.get(key) ?? { material, meshes: new Set<Mesh>(), parts: [] as BufferGeometry[], shadow: object.castShadow, receive: object.receiveShadow, order: object.renderOrder, mask: object.layers.mask }
      const part = source.clone(), indices: number[] = []
      for (let i = slot.start; i < Math.min(count, slot.start + slot.count); i += 3) {
        const at = (k: number) => source.index ? source.index.getX(k) : k
        indices.push(at(i), at(i + (matrix.determinant() < 0 ? 2 : 1)), at(i + (matrix.determinant() < 0 ? 1 : 2)))
      }
      part.clearGroups(); part.setIndex(indices); part.applyMatrix4(matrix)
      group.parts.push(part); group.meshes.add(object); groups.set(key, group); originals.add(object)
    }
  })
  try {
    for (const group of groups.values()) {
      const geometry = mergeGeometries(group.parts, false)
      if (!geometry) throw new Error('Walkthrough batching failed; original meshes are retained.')
      geometry.computeBoundingSphere()
      const mesh = new Mesh(geometry, group.material)
      mesh.name = 'Walkthrough_static'; mesh.userData.walkthroughBatch = true
      mesh.userData.sourceMeshIds = [...group.meshes].map(m => m.uuid)
      mesh.castShadow = group.shadow; mesh.receiveShadow = group.receive; mesh.renderOrder = group.order; mesh.layers.mask = group.mask
      batchRoot.add(mesh)
    }
    originals.forEach(m => { m.visible = false }); root.add(batchRoot)
  } catch (error) { batchRoot.traverse(o => { if (o instanceof Mesh) o.geometry.dispose() }); throw error }
  finally { for (const group of groups.values()) group.parts.forEach(p => p.dispose()) }
  let released = false
  return { before: originals.size, after: batchRoot.children.length, release() {
    if (released) return; released = true
    originals.forEach(m => { m.visible = true }); batchRoot.removeFromParent()
    batchRoot.traverse(o => { if (o instanceof Mesh) o.geometry.dispose() }); batchRoot.clear()
  } }
}

/** Keep glass faces/frames, reflections and all their collisions. Browser
 * walkthrough glazing uses alpha + the same environment rather than a second
 * full-house transmission pass. Shared originals stay intact for export. */
export function prepareWalkthroughGlazing(root: Group) {
  const prepared = new Map<Material, Material>()
  root.traverse(o => {
    if (!(o instanceof Mesh)) return
    const convert = (material: Material) => {
      if (!('transmission' in material) || Number(material.transmission) <= 0) return material
      let next = prepared.get(material)
      if (!next) {
        next = material.clone(); (next as Material & { transmission: number }).transmission = 0
        next.transparent = true; next.opacity = o.userData.material_role === 'water' ? .7 : .28; next.depthWrite = false
        next.userData.walkthroughGlazing = true; prepared.set(material, next)
      }
      return next
    }
    o.material = Array.isArray(o.material) ? o.material.map(convert) : convert(o.material)
    if ((Array.isArray(o.material) ? o.material : [o.material]).every(m => m.transparent)) o.castShadow = false
  })
}
