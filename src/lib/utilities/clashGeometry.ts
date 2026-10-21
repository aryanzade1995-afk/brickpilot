import type { Point } from '../geometry.ts'

export type XYZ = [number, number, number]
const dot = (a: XYZ, b: XYZ) => a.reduce((s, x, i) => s + x * b[i], 0)
const sub = (a: XYZ, b: XYZ): XYZ => a.map((v, i) => v - b[i]) as XYZ
const clamp = (v: number) => Math.max(0, Math.min(1, v))

/** Closest points on finite segments, including points and parallel segments.
 * XYZ uses plan x, plan y, height, all in mm. */
export function segmentDistance(p: XYZ, q: XYZ, r: XYZ, s: XYZ) {
  const u = sub(q, p), v = sub(s, r), w = sub(p, r)
  const a = dot(u, u), b = dot(u, v), c = dot(v, v), d = dot(u, w), e = dot(v, w)
  let t = 0, h = 0
  if (a < 1e-9) h = c < 1e-9 ? 0 : clamp(e / c)
  else if (c < 1e-9) t = clamp(-d / a)
  else {
    const denominator = a * c - b * b
    t = denominator > 1e-9 ? clamp((b * e - c * d) / denominator) : 0
    h = (b * t + e) / c
    if (h < 0) { h = 0; t = clamp(-d / a) }
    else if (h > 1) { h = 1; t = clamp((b - d) / a) }
  }
  const first = p.map((x, i) => x + t * u[i]) as XYZ, second = r.map((x, i) => x + h * v[i]) as XYZ
  return { first, second, distance: Math.hypot(...sub(first, second)), position: { x: (first[0] + second[0]) / 2, y: (first[1] + second[1]) / 2 }, elevationMm: (first[2] + second[2]) / 2 }
}

export function insidePolygon(p: Point, polygon: Point[]) {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j]
    if (segmentDistance([p.x, p.y, 0], [p.x, p.y, 0], [a.x, a.y, 0], [b.x, b.y, 0]).distance < .01) return true
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

/** Inclusive polygon overlap, including a segment entirely inside the polygon. */
export function segmentPolygon(a: Point, b: Point, polygon: Point[]) {
  if (insidePolygon(a, polygon) || insidePolygon(b, polygon)) return true
  return polygon.some((p, i) => segmentDistance([a.x, a.y, 0], [b.x, b.y, 0], [p.x, p.y, 0], [polygon[(i + 1) % polygon.length].x, polygon[(i + 1) % polygon.length].y, 0]).distance < .01)
}

/** Segment/solid box clipping. Used for actual wall sections incl. sills/heads. */
export function segmentBox(a: XYZ, b: XYZ, low: XYZ, high: XYZ) {
  let start = 0, end = 1
  for (let i = 0; i < 3; i++) {
    const delta = b[i] - a[i]
    if (Math.abs(delta) < 1e-9) { if (a[i] <= low[i] || a[i] >= high[i]) return null }
    else {
      const p = (low[i] - a[i]) / delta, q = (high[i] - a[i]) / delta
      start = Math.max(start, Math.min(p, q)); end = Math.min(end, Math.max(p, q))
      if (start >= end) return null
    }
  }
  return a.map((v, i) => v + (b[i] - v) * (start + end) / 2) as XYZ
}
