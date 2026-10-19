import type { Rect } from '../geometry.ts'
export type P2 = { x: number; y: number }
export const polygonArea = (p: P2[]) => Math.abs(p.reduce((n, a, i) => { const b = p[(i + 1) % p.length]; return n + a.x * b.y - b.x * a.y }, 0)) / 2
export function polygonBounds(p: P2[]): Rect {
  const xs = p.map(v => v.x), ys = p.map(v => v.y), x = Math.min(...xs), y = Math.min(...ys)
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }
}
export function clipPolygonToRect(points: P2[], rect: Rect): P2[] {
  let result = points
  for (const [axis, boundary, positive] of [['x', rect.x, true], ['x', rect.x + rect.w, false], ['y', rect.y, true], ['y', rect.y + rect.h, false]] as const) {
    const input = result; result = []
    for (let i = 0; i < input.length; i++) {
      const a = input[i], b = input[(i + 1) % input.length]
      const insideA = positive ? a[axis] >= boundary : a[axis] <= boundary
      const insideB = positive ? b[axis] >= boundary : b[axis] <= boundary
      if (insideA) result.push(a)
      if (insideA !== insideB) {
        const t = (boundary - a[axis]) / (b[axis] - a[axis])
        result.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
      }
    }
  }
  return result
}
/** Regions must be the disjoint rectangles supplied by the shared roof model. */
export function polygonFitsRegions(polygon: P2[], regions: Rect[]): boolean {
  const area = polygonArea(polygon)
  return area > 0 && Math.abs(regions.reduce((n, r) => n + polygonArea(clipPolygonToRect(polygon, r)), 0) - area) <= Math.max(.0001, area * 1e-10)
}
/** Strict positive-area overlap by separating axes; shared maintenance boundaries may touch. */
export function polygonsOverlap(a: P2[], b: P2[]): boolean {
  for (const polygon of [a, b]) for (let i = 0; i < polygon.length; i++) {
    const p = polygon[i], q = polygon[(i + 1) % polygon.length], nx = -(q.y - p.y), ny = q.x - p.x
    const av = a.map(v => v.x * nx + v.y * ny), bv = b.map(v => v.x * nx + v.y * ny)
    const tolerance = Math.hypot(nx, ny) * 1e-6
    if (Math.max(...av) <= Math.min(...bv) + tolerance || Math.max(...bv) <= Math.min(...av) + tolerance) return false
  }
  return true
}
export function rectanglePolygon(r: Rect): P2[] {
  return [{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }, { x: r.x + r.w, y: r.y + r.h }, { x: r.x, y: r.y + r.h }]
}
