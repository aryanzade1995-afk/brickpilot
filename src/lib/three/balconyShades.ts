import { Box3, BoxGeometry, Matrix4, Mesh, Vector3, type Object3D } from 'three'

/** Upgrade older, explicitly tagged balcony shades from their exported source
 * slab. Work in world metres (glTF Y-up), then map back into the owned root.
 * Never infer a balcony from a window, or cover an untagged outdoor area. */
export function completeBalconyShades(root: Object3D) {
  root.updateMatrixWorld(true)
  const groups = new Map<string, Mesh[]>(), slabs = new Map<string, Mesh>()
  root.traverse(object => {
    if (!(object instanceof Mesh)) return
    if (/_Balcony_.+_Slab$/.test(object.name) && object.userData.source_id)
      slabs.set(object.userData.source_id, object)
    if (object.userData.grammar_category !== 'BALCONY' || !object.userData.source_anchor_id) return
    const key = object.userData.source_anchor_id as string
    const group = groups.get(key) ?? []
    group.push(object); groups.set(key, group)
  })
  let added = 0
  for (const [id, parts] of groups) {
    if (parts.some(p => p.userData.fullBalconyShade)) continue
    const slab = slabs.get(id)
    if (!slab) continue
    const floor = new Box3().setFromObject(slab)
    // Existing beams establish the real canopy height; do not invent one for
    // balconies that were never shaded in the accepted model.
    const overhead = parts.filter(p => /_Beam_|_Slab_/.test(p.name) && new Box3().setFromObject(p).min.y > floor.max.y + 2)
    if (!overhead.length) continue
    const top = Math.max(...overhead.map(p => new Box3().setFromObject(p).max.y))
    const covers = parts.filter(p => /_Beam_|_Slab_/.test(p.name))
    if (covers.some(p => {
      const b = new Box3().setFromObject(p)
      return b.min.y > floor.max.y + 2 && b.min.x <= floor.min.x + .01 && b.max.x >= floor.max.x - .01 && b.min.z <= floor.min.z + .01 && b.max.z >= floor.max.z - .01
    })) continue
    const size = floor.getSize(new Vector3()), centre = floor.getCenter(new Vector3())
    const source = overhead[0]
    // Only add the missing roof skin; do not stretch shared GLB buffers or
    // change the door, guard, floor, posts or the accepted plan.
    const cover = new Mesh(new BoxGeometry(size.x, .1, size.z), source.material)
    cover.name = `BalconyFullShade_${id}`
    cover.userData = { ...source.userData, fullBalconyShade: true }
    const transform = new Matrix4().makeTranslation(centre.x, top - .05, centre.z)
    cover.applyMatrix4(root.matrixWorld.clone().invert().multiply(transform))
    cover.castShadow = true; cover.receiveShadow = true
    root.add(cover); added++
  }
  return added
}
