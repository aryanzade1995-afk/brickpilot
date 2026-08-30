/**
 * Small integer-millimetre geometry layer. Everything the engine produces is
 * in whole millimetres so runs are bit-for-bit reproducible (no float drift).
 */

export type Point = { x: number; y: number }
export type Rect = { x: number; y: number; w: number; h: number }
export type Segment = { a: Point; b: Point }

export const snap = (v: number, grid: number): number => Math.round(v / grid) * grid

export const rectArea = (r: Rect): number => r.w * r.h
export const rectRight = (r: Rect): number => r.x + r.w
export const rectBottom = (r: Rect): number => r.y + r.h
export const rectCenter = (r: Rect): Point => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 })

/** mm² → m², rounded to 1 decimal */
export const toSqm = (mm2: number): number => Math.round(mm2 / 1000 / 1000 / 0.1) * 0.1

/** Do two rects overlap on the interior (touching edges do not count)? */
export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < rectRight(b) && rectRight(a) > b.x && a.y < rectBottom(b) && rectBottom(a) > b.y
}

/**
 * The shared edge between two rects if they are edge-adjacent, else null.
 * Returns the overlap as a segment plus which side of `a` it sits on.
 */
export function sharedEdge(
  a: Rect,
  b: Rect,
  tol = 2,
): { seg: Segment; side: 'N' | 'S' | 'E' | 'W'; length: number } | null {
  // vertical shared edge: a's right == b's left  (or vice versa)
  const vy0 = Math.max(a.y, b.y)
  const vy1 = Math.min(rectBottom(a), rectBottom(b))
  if (vy1 - vy0 > tol) {
    if (Math.abs(rectRight(a) - b.x) <= tol) {
      return { seg: { a: { x: rectRight(a), y: vy0 }, b: { x: rectRight(a), y: vy1 } }, side: 'E', length: vy1 - vy0 }
    }
    if (Math.abs(rectRight(b) - a.x) <= tol) {
      return { seg: { a: { x: a.x, y: vy0 }, b: { x: a.x, y: vy1 } }, side: 'W', length: vy1 - vy0 }
    }
  }
  // horizontal shared edge
  const hx0 = Math.max(a.x, b.x)
  const hx1 = Math.min(rectRight(a), rectRight(b))
  if (hx1 - hx0 > tol) {
    if (Math.abs(rectBottom(a) - b.y) <= tol) {
      return { seg: { a: { x: hx0, y: rectBottom(a) }, b: { x: hx1, y: rectBottom(a) } }, side: 'S', length: hx1 - hx0 }
    }
    if (Math.abs(rectBottom(b) - a.y) <= tol) {
      return { seg: { a: { x: hx0, y: a.y }, b: { x: hx1, y: a.y } }, side: 'N', length: hx1 - hx0 }
    }
  }
  return null
}

/** Is this rect edge on the outer boundary of `outer` (i.e. an exterior wall)? */
export function edgeIsExterior(r: Rect, side: 'N' | 'S' | 'E' | 'W', outer: Rect, tol = 2): boolean {
  if (side === 'N') return Math.abs(r.y - outer.y) <= tol
  if (side === 'S') return Math.abs(rectBottom(r) - rectBottom(outer)) <= tol
  if (side === 'W') return Math.abs(r.x - outer.x) <= tol
  return Math.abs(rectRight(r) - rectRight(outer)) <= tol
}

export const segLength = (s: Segment): number => Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y)
export const segMidpoint = (s: Segment): Point => ({ x: (s.a.x + s.b.x) / 2, y: (s.a.y + s.b.y) / 2 })
