import * as THREE from 'three'

/* ------------------------------------------------------------------ *
 *  separateCoplanar — removes z-fighting from an exported building.
 *
 *  The villa arrives from Blender with many faces of different parts
 *  lying in exactly the same plane: a beam flush with the wall face it
 *  sits in, a slab edge flush with the facade, a door surround on its
 *  wall, footings touching underground. Two such faces have the same
 *  depth, so as the camera moves the GPU alternates between them and
 *  the model flickers. Polygon offset cannot help: with a logarithmic
 *  depth buffer the shader writes the depth itself.
 *
 *  Here every axis-aligned face is bucketed by its plane (1 mm). Where
 *  faces of different meshes overlap in one plane, the most important
 *  part keeps its face and each other part's face is pulled back behind
 *  it by 1.5 mm (2 × 1.5 mm for a third, and so on), invisible at any
 *  viewing distance but enough for the depth buffer to separate them.
 * ------------------------------------------------------------------ */

/** which part keeps the shared surface: what is seen (trim, glazing, doors) over walls, over slabs, over structure */
function rank(name: string): number {
  if (/^(PCC|Footing)_/i.test(name)) return 0
  if (/beam|column/i.test(name)) return 1
  if (/slab|deck|tread|landing|plinth/i.test(name)) return 2
  if (/wall/i.test(name)) return 3
  return 4
}

/** a multi-material part arrives as one child mesh per material: its node carries the part's name */
const nameOf = (m: THREE.Object3D) => `${m.name} ${m.parent?.name ?? ''}`

type Tri = { mesh: number; x0: number; y0: number; x1: number; y1: number }

/** repeated until no two parts share a plane: a face that stepped back can land on a third part's plane */
export function separateCoplanar(root: THREE.Object3D, step = 0.0015) {
  const total = { planes: 0, meshes: 0 }
  for (let pass = 0; pass < 4; pass++) {
    const done = onePass(root, step)
    if (!done.planes) break
    total.planes += done.planes
    total.meshes += done.meshes
  }
  return total
}

function onePass(root: THREE.Object3D, step: number) {
  root.updateMatrixWorld(true)
  const meshes: THREE.Mesh[] = []
  root.traverse((o) => {
    const m = o as THREE.Mesh
    if (m.isMesh && m.visible && m.geometry?.getAttribute('position')) meshes.push(m)
  })
  const planes = new Map<string, Tri[]>()
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3()
  const volume = meshes.map((mesh, mi) => {
    const pos = mesh.geometry.getAttribute('position'), index = mesh.geometry.getIndex()
    const count = index ? index.count : pos.count
    const at = (k: number, v: THREE.Vector3) => v.fromBufferAttribute(pos, index ? index.getX(k) : k).applyMatrix4(mesh.matrixWorld)
    for (let k = 0; k + 2 < count; k += 3) {
      at(k, a); at(k + 1, b); at(k + 2, c)
      n.crossVectors(e1.subVectors(b, a), e2.subVectors(c, a))
      const len = n.length()
      if (len < 1e-8) continue
      n.divideScalar(len)
      const ax = Math.abs(n.x) > 0.999 ? 0 : Math.abs(n.y) > 0.999 ? 1 : Math.abs(n.z) > 0.999 ? 2 : -1
      if (ax < 0) continue
      const [u, v] = ax === 0 ? ['y', 'z'] as const : ax === 1 ? ['x', 'z'] as const : ['x', 'y'] as const
      const key = `${ax}|${n.getComponent(ax) > 0 ? 1 : -1}|${Math.round(a.getComponent(ax) * 1000)}`
      const tri = { mesh: mi, x0: Math.min(a[u], b[u], c[u]), y0: Math.min(a[v], b[v], c[v]), x1: Math.max(a[u], b[u], c[u]), y1: Math.max(a[v], b[v], c[v]) }
      const list = planes.get(key)
      if (list) list.push(tri)
      else planes.set(key, [tri])
    }
    const size = new THREE.Box3().setFromObject(mesh).getSize(new THREE.Vector3())
    return size.x * size.y * size.z
  })

  // per mesh, the planes on which it must step back, and by how far
  const moves = new Map<number, { ax: number; sign: number; at: number; by: number }[]>()
  for (const [key, tris] of planes) {
    if (tris.length < 2) continue
    const involved = new Set<number>()
    tris.sort((p, q) => p.x0 - q.x0)
    for (let i = 0; i < tris.length; i++) {
      const p = tris[i]
      for (let j = i + 1; j < tris.length && tris[j].x0 < p.x1 - 0.005; j++) {
        const q = tris[j]
        if (q.mesh === p.mesh) continue
        if (Math.min(p.x1, q.x1) - Math.max(p.x0, q.x0) > 0.005 && Math.min(p.y1, q.y1) - Math.max(p.y0, q.y0) > 0.005) {
          involved.add(p.mesh); involved.add(q.mesh)
        }
      }
    }
    if (involved.size < 2) continue
    const [ax, sign, mm] = key.split('|').map(Number)
    const order = [...involved].sort((p, q) => rank(nameOf(meshes[q])) - rank(nameOf(meshes[p])) || volume[q] - volume[p] || p - q)
    order.slice(1).forEach((mi, i) => {
      const list = moves.get(mi) ?? []
      list.push({ ax, sign, at: mm / 1000, by: (i + 1) * step })
      moves.set(mi, list)
    })
  }

  // step the faces back: only the vertices lying in that plane move, along the face's inward normal
  const w = new THREE.Vector3()
  for (const [mi, list] of moves) {
    const mesh = meshes[mi]
    mesh.geometry = mesh.geometry.clone() // a geometry may be shared with other meshes
    const pos = mesh.geometry.getAttribute('position') as THREE.BufferAttribute
    const inverse = mesh.matrixWorld.clone().invert()
    for (let k = 0; k < pos.count; k++) {
      w.fromBufferAttribute(pos, k).applyMatrix4(mesh.matrixWorld)
      let moved = false
      for (const mv of list) {
        if (Math.abs(w.getComponent(mv.ax) - mv.at) > 0.0006) continue
        w.setComponent(mv.ax, w.getComponent(mv.ax) - mv.sign * mv.by)
        moved = true
      }
      if (moved) {
        w.applyMatrix4(inverse)
        pos.setXYZ(k, w.x, w.y, w.z)
      }
    }
    pos.needsUpdate = true
    mesh.geometry.computeBoundingBox()
    mesh.geometry.computeBoundingSphere()
  }
  return { planes: [...moves.values()].reduce((s, l) => s + l.length, 0), meshes: moves.size }
}
