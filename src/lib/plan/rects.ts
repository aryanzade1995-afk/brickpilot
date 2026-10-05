import { rectArea, rectBottom, rectRight, type Rect } from '../geometry.ts'

/* Small rectangle algebra for the plan editor. Integer millimetres throughout. */

export const MODULE = 100
export const snapMm = (v: number) => Math.round(v / MODULE) * MODULE
export const sameRect = (a: Rect, b: Rect) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h

export function intersect(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y)
  const r = Math.min(rectRight(a), rectRight(b)), d = Math.min(rectBottom(a), rectBottom(b))
  return r - x > 0 && d - y > 0 ? { x, y, w: r - x, h: d - y } : null
}
export const overlapArea = (a: Rect, b: Rect) => { const i = intersect(a, b); return i ? rectArea(i) : 0 }
export const contains = (outer: Rect, inner: Rect) =>
  inner.x >= outer.x && inner.y >= outer.y && rectRight(inner) <= rectRight(outer) && rectBottom(inner) <= rectBottom(outer)

/** a minus b, as at most four rectangles */
export function subtract(a: Rect, b: Rect): Rect[] {
  const i = intersect(a, b)
  if (!i) return [a]
  const out: Rect[] = []
  if (i.y > a.y) out.push({ x: a.x, y: a.y, w: a.w, h: i.y - a.y })
  if (rectBottom(i) < rectBottom(a)) out.push({ x: a.x, y: rectBottom(i), w: a.w, h: rectBottom(a) - rectBottom(i) })
  if (i.x > a.x) out.push({ x: a.x, y: i.y, w: i.x - a.x, h: i.h })
  if (rectRight(i) < rectRight(a)) out.push({ x: rectRight(i), y: i.y, w: rectRight(a) - rectRight(i), h: i.h })
  return out
}

/** the exact union of some rectangles as a minimal-ish set of disjoint rectangles (coordinate compression, then merging) */
export function unionRects(rects: Rect[]): Rect[] {
  if (!rects.length) return []
  const xs = [...new Set(rects.flatMap((r) => [r.x, rectRight(r)]))].sort((p, q) => p - q)
  const ys = [...new Set(rects.flatMap((r) => [r.y, rectBottom(r)]))].sort((p, q) => p - q)
  const filled = (cx: number, cy: number) => rects.some((r) => cx > r.x && cx < rectRight(r) && cy > r.y && cy < rectBottom(r))
  // runs of filled cells per row, then merge identical runs of consecutive rows into taller rectangles
  type Run = { x0: number; x1: number; y0: number; y1: number }
  let open: Run[] = []
  const done: Run[] = []
  for (let j = 0; j < ys.length - 1; j++) {
    const row: [number, number][] = []
    let start = -1
    for (let i = 0; i < xs.length - 1; i++) {
      const on = filled((xs[i] + xs[i + 1]) / 2, (ys[j] + ys[j + 1]) / 2)
      if (on && start < 0) start = i
      if ((!on || i === xs.length - 2) && start >= 0) { row.push([xs[start], xs[on ? i + 1 : i]]); start = -1 }
    }
    const next: Run[] = []
    for (const [x0, x1] of row) {
      const same = open.find((o) => o.x0 === x0 && o.x1 === x1 && o.y1 === ys[j])
      if (same) { same.y1 = ys[j + 1]; next.push(same); open = open.filter((o) => o !== same) }
      else next.push({ x0, x1, y0: ys[j], y1: ys[j + 1] })
    }
    done.push(...open)
    open = next
  }
  done.push(...open)
  return done.map((r) => ({ x: r.x0, y: r.y0, w: r.x1 - r.x0, h: r.y1 - r.y0 }))
}

/** do two rectangles together form one rectangle (they touch along a full shared edge)? */
export function joinIfRect(a: Rect, b: Rect): Rect | null {
  if (a.y === b.y && a.h === b.h && (rectRight(a) === b.x || rectRight(b) === a.x)) return { x: Math.min(a.x, b.x), y: a.y, w: a.w + b.w, h: a.h }
  if (a.x === b.x && a.w === b.w && (rectBottom(a) === b.y || rectBottom(b) === a.y)) return { x: a.x, y: Math.min(a.y, b.y), w: a.w, h: a.h + b.h }
  return null
}

/** length of the shared boundary of two touching rectangles (0 when they do not touch) */
export function touchLength(a: Rect, b: Rect): number {
  if (rectRight(a) === b.x || rectRight(b) === a.x) return Math.max(0, Math.min(rectBottom(a), rectBottom(b)) - Math.max(a.y, b.y))
  if (rectBottom(a) === b.y || rectBottom(b) === a.y) return Math.max(0, Math.min(rectRight(a), rectRight(b)) - Math.max(a.x, b.x))
  return 0
}

export const sqm = (r: Rect) => Math.round((r.w * r.h) / 1e5) / 10
export const m = (mm: number) => (mm / 1000).toFixed(1)
