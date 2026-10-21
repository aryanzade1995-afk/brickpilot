import type { Point, Rect } from '../geometry.ts'

/** Shared canonical polyline helpers. Plan coordinates are millimetres. */
export function route(from: Point, to: Point, verticalFirst = false): Point[] {
  const points = [from, verticalFirst ? { x: from.x, y: to.y } : { x: to.x, y: from.y }, to]
  return points.filter((p, i) => !i || p.x !== points[i - 1].x || p.y !== points[i - 1].y).map(p => ({ ...p }))
}
export const orthogonal = (path: Point[]) => path.every((p, i) => Number.isFinite(p.x) && Number.isFinite(p.y) && (!i || p.x === path[i - 1].x || p.y === path[i - 1].y))
export function alongPath(path: Point[], distance: number) {
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i], dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy)
    if (length && distance <= length) return { x: a.x + dx * distance / length, y: a.y + dy * distance / length, angle: Math.atan2(dy, dx) * 180 / Math.PI }
    distance -= length
  }
  return null
}
export function simplifyPath(points: Point[]) {
  const result: Point[] = []
  for (const p of points) {
    const a = result.at(-2), b = result.at(-1)
    if (b && b.x === p.x && b.y === p.y) continue
    if (a && b && ((a.x === b.x && b.x === p.x) || (a.y === b.y && b.y === p.y)) && (b.x - a.x) * (p.x - b.x) + (b.y - a.y) * (p.y - b.y) >= 0) result.pop()
    result.push({ ...p })
  }
  return result
}

/** Two paths around an inset room perimeter. Entry/exit spokes remain
 * orthogonal. Callers still validate every segment against actual walls/voids. */
export function perimeterRoutes(from: Point, to: Point, r: Rect): Point[][] {
  const w = r.w, h = r.h, length = 2 * (w + h)
  const anchor = (p: Point) => [
    { at: p.x - r.x, p: { x: p.x, y: r.y }, distance: Math.abs(p.y - r.y) },
    { at: w + p.y - r.y, p: { x: r.x + w, y: p.y }, distance: Math.abs(p.x - r.x - w) },
    { at: w + h + r.x + w - p.x, p: { x: p.x, y: r.y + h }, distance: Math.abs(p.y - r.y - h) },
    { at: 2 * w + h + r.y + h - p.y, p: { x: r.x, y: p.y }, distance: Math.abs(p.x - r.x) },
  ].sort((a, b) => a.distance - b.distance)[0]
  const a = anchor(from), b = anchor(to)
  const corners = [{ at: 0, p: { x: r.x, y: r.y } }, { at: w, p: { x: r.x + w, y: r.y } }, { at: w + h, p: { x: r.x + w, y: r.y + h } }, { at: 2 * w + h, p: { x: r.x, y: r.y + h } }]
  const clockwise = (start: typeof a, end: typeof b) => {
    const distance = (end.at - start.at + length) % length
    return [start.p, ...corners.map(c => ({ ...c, delta: (c.at - start.at + length) % length })).filter(c => c.delta > .01 && c.delta < distance - .01).sort((x, y) => x.delta - y.delta).map(c => c.p), end.p]
  }
  return [clockwise(a, b), clockwise(b, a).reverse()].map(p => simplifyPath([...route(from, a.p), ...p, ...route(b.p, to)]))
}
