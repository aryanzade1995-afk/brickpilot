import { subtractRegions } from '../solar/regions.ts'
import { planToThreeGlb } from './coordinates.ts'
import type { Rect } from '../geometry.ts'
import { sceneId, type SceneSolid, type SceneSurface } from './sceneTypes.ts'

const EPS = 1e-7
/** Exact boundary of a union of source-aligned boxes. Internal and coplanar
 * duplicate faces disappear; intersecting walls/columns/beams need no offsets.
 * Solids remain semantic/collision inputs; only exposed surfaces are rendered.
 */
export function exposedSurfaces(input: SceneSolid[]): SceneSurface[] {
  const solids = [...input].sort((a, b) => a.id.localeCompare(b.id)), result: SceneSurface[] = []
  const lo = (s: SceneSolid, axis: number) => [s.boundsMm.x, s.boundsMm.y, s.boundsMm.z][axis]
  const hi = (s: SceneSolid, axis: number) => lo(s, axis) + [s.boundsMm.w, s.boundsMm.d, s.boundsMm.h][axis]
  for (const solid of solids) for (const axis of [0, 1, 2]) for (const sign of [-1, 1]) {
    const axes = [0, 1, 2].filter(a => a !== axis), plane = sign > 0 ? hi(solid, axis) : lo(solid, axis)
    const rect = { x: lo(solid, axes[0]), y: lo(solid, axes[1]), w: hi(solid, axes[0]) - lo(solid, axes[0]), h: hi(solid, axes[1]) - lo(solid, axes[1]) }
    const cuts: Rect[] = []
    for (const other of solids) {
      if (other === solid) continue
      const crosses = sign > 0 ? lo(other, axis) <= plane + EPS && hi(other, axis) > plane + EPS : hi(other, axis) >= plane - EPS && lo(other, axis) < plane - EPS
      const coincides = Math.abs((sign > 0 ? hi(other, axis) : lo(other, axis)) - plane) < EPS && other.id < solid.id
      if (!crosses && !coincides) continue
      const x = Math.max(rect.x, lo(other, axes[0])), y = Math.max(rect.y, lo(other, axes[1]))
      const w = Math.min(rect.x + rect.w, hi(other, axes[0])) - x, h = Math.min(rect.y + rect.h, hi(other, axes[1])) - y
      if (w > EPS && h > EPS) cuts.push({ x, y, w, h })
    }
    for (const part of subtractRegions([rect], cuts)) {
      let vertices = [[part.x, part.y], [part.x + part.w, part.y], [part.x + part.w, part.y + part.h], [part.x, part.y + part.h]].map(([a, b]) => {
        const p = [0, 0, 0]; p[axis] = plane; p[axes[0]] = a; p[axes[1]] = b
        const w = planToThreeGlb({ x: p[0], y: p[1], z: p[2] }); return [w.x, w.y, w.z] as [number, number, number]
      })
      const normal: [number, number, number] = axis === 0 ? [sign, 0, 0] : axis === 1 ? [0, 0, -sign] : [0, sign, 0]
      const a = vertices[0], b = vertices[1], c = vertices[2], u = b.map((v, i) => v - a[i]), v = c.map((n, i) => n - a[i])
      const cross = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
      if (cross.reduce((n, x, i) => n + x * normal[i], 0) < 0) vertices = vertices.reverse()
      result.push({ id: sceneId(solid.id, 'face', axis, sign, plane, part.x, part.y, part.w, part.h), solidId: solid.id,
        sourceIds: [...solid.sourceIds], floorId: solid.floorId, role: solid.role, vertices, normal })
    }
  }
  return result
}
