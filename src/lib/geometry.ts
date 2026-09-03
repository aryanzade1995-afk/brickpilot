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

/* ------------------------------------------------------------------ *
 *  Rect-union boundary — trace the outer edges of a union of a few
 *  axis-aligned rectangles (the massing "footprint"). Cell-grid method:
 *  cut the plane on every rect edge, mark cells inside/outside, and emit
 *  the edges that separate the two. Deterministic; O(cells) with cells
 *  ≤ (2n)² for n rects.
 * ------------------------------------------------------------------ */

export type BoundaryEdge = { a: Point; b: Point; side: 'N' | 'S' | 'E' | 'W' }

const uniqSorted = (xs: number[]): number[] => [...new Set(xs.map((v) => Math.round(v)))].sort((a, b) => a - b)

/** union bounding box of a rect list */
export function rectUnionBBox(rects: Rect[]): Rect {
  const x = Math.min(...rects.map((r) => r.x))
  const y = Math.min(...rects.map((r) => r.y))
  const x1 = Math.max(...rects.map(rectRight))
  const y1 = Math.max(...rects.map(rectBottom))
  return { x, y, w: x1 - x, h: y1 - y }
}

/** true if `p` sits strictly inside any rect (grid-cell centres never land on an edge) */
const inAny = (rects: Rect[], px: number, py: number): boolean =>
  rects.some((r) => px > r.x && px < rectRight(r) && py > r.y && py < rectBottom(r))

/** union area in mm² */
export function rectUnionArea(rects: Rect[]): number {
  if (rects.length === 1) return rectArea(rects[0])
  const xs = uniqSorted(rects.flatMap((r) => [r.x, rectRight(r)]))
  const ys = uniqSorted(rects.flatMap((r) => [r.y, rectBottom(r)]))
  let area = 0
  for (let i = 0; i < xs.length - 1; i++) {
    for (let j = 0; j < ys.length - 1; j++) {
      const cx = (xs[i] + xs[i + 1]) / 2
      const cy = (ys[j] + ys[j + 1]) / 2
      if (inAny(rects, cx, cy)) area += (xs[i + 1] - xs[i]) * (ys[j + 1] - ys[j])
    }
  }
  return area
}

/**
 * Outer boundary edges of the rect union, each tagged with the compass
 * direction it faces (outward). Collinear runs are merged. A `hole` (courtyard)
 * subtracts: its boundary edges are emitted too, facing *inward*.
 */
export function rectUnionEdges(rects: Rect[], hole?: Rect | null): BoundaryEdge[] {
  const all = hole ? [...rects] : rects
  const xs = uniqSorted(all.flatMap((r) => [r.x, rectRight(r)]).concat(hole ? [hole.x, rectRight(hole)] : []))
  const ys = uniqSorted(all.flatMap((r) => [r.y, rectBottom(r)]).concat(hole ? [hole.y, rectBottom(hole)] : []))

  const solid = (cx: number, cy: number) =>
    inAny(rects, cx, cy) && !(hole && cx > hole.x && cx < rectRight(hole) && cy > hole.y && cy < rectBottom(hole))

  const vert: BoundaryEdge[] = []
  const horiz: BoundaryEdge[] = []

  // vertical edges: between horizontal neighbours
  for (let i = 0; i < xs.length; i++) {
    for (let j = 0; j < ys.length - 1; j++) {
      const x = xs[i]
      const y0 = ys[j]
      const y1 = ys[j + 1]
      const cy = (y0 + y1) / 2
      const left = i > 0 && solid((xs[i - 1] + x) / 2, cy)
      const right = i < xs.length - 1 && solid((x + xs[i + 1]) / 2, cy)
      if (left !== right) {
        vert.push({ a: { x, y: y0 }, b: { x, y: y1 }, side: right ? 'W' : 'E' })
      }
    }
  }
  // horizontal edges: between vertical neighbours
  for (let j = 0; j < ys.length; j++) {
    for (let i = 0; i < xs.length - 1; i++) {
      const y = ys[j]
      const x0 = xs[i]
      const x1 = xs[i + 1]
      const cx = (x0 + x1) / 2
      const above = j > 0 && solid(cx, (ys[j - 1] + y) / 2)
      const below = j < ys.length - 1 && solid(cx, (y + ys[j + 1]) / 2)
      if (above !== below) {
        horiz.push({ a: { x: x0, y }, b: { x: x1, y }, side: below ? 'N' : 'S' })
      }
    }
  }

  // merge collinear runs sharing an endpoint + side
  const merge = (edges: BoundaryEdge[], axis: 'x' | 'y'): BoundaryEdge[] => {
    const key = (e: BoundaryEdge) => `${axis === 'x' ? e.a.x : e.a.y}|${e.side}`
    const groups = new Map<string, BoundaryEdge[]>()
    for (const e of edges) {
      const g = groups.get(key(e)) ?? []
      g.push(e)
      groups.set(key(e), g)
    }
    const out: BoundaryEdge[] = []
    for (const g of groups.values()) {
      g.sort((p, q) => (axis === 'x' ? p.a.y - q.a.y : p.a.x - q.a.x))
      let cur = { ...g[0], a: { ...g[0].a }, b: { ...g[0].b } }
      for (let k = 1; k < g.length; k++) {
        const nxt = g[k]
        const contiguous = axis === 'x' ? cur.b.y === nxt.a.y : cur.b.x === nxt.a.x
        if (contiguous) cur.b = { ...nxt.b }
        else {
          out.push(cur)
          cur = { ...nxt, a: { ...nxt.a }, b: { ...nxt.b } }
        }
      }
      out.push(cur)
    }
    return out
  }

  return [...merge(vert, 'x'), ...merge(horiz, 'y')]
}
