import type { BoundaryEdge, Rect } from '../geometry.ts'
import { rectUnionEdges } from '../geometry.ts'

const EPS = 1e-6
const endX = (r: Rect) => r.x + r.w
const endY = (r: Rect) => r.y + r.h
export const validRect = (r: Rect) => [r.x, r.y, r.w, r.h].every(Number.isFinite) && r.w > 0 && r.h > 0
type Interval = [number, number]
function unionIntervals(values: Interval[]): Interval[] {
  const result: Interval[] = []
  for (const [lo, hi] of values.sort((a, b) => a[0] - b[0] || a[1] - b[1])) {
    const last = result.at(-1)
    if (last && lo <= last[1] + EPS) last[1] = Math.max(last[1], hi)
    else result.push([lo, hi])
  }
  return result
}

/** Exact canonical disjoint rectangles for union(sources) minus union(cuts).
 * Sweep intervals rather than treating a bounding box as a roof or rasterizing holes. */
export function subtractRegions(sources: Rect[], cuts: Rect[] = []): Rect[] {
  if (![...sources, ...cuts].every(validRect)) throw new RangeError('Roof rectangles must have finite positive dimensions')
  if (!sources.length) return []
  const xs = [...new Set([...sources, ...cuts].flatMap(r => [r.x, endX(r)]))].sort((a, b) => a - b)
  const result: Rect[] = [], active = new Map<string, Rect>()
  for (let i = 0; i < xs.length - 1; i++) {
    const x = xs[i], next = xs[i + 1], mid = (x + next) / 2
    const intervals = (rects: Rect[]) => unionIntervals(rects.filter(r => r.x < mid && endX(r) > mid).map(r => [r.y, endY(r)]))
    let spans = intervals(sources)
    for (const [lo, hi] of intervals(cuts)) spans = spans.flatMap(([a, b]): Interval[] => hi <= a || lo >= b ? [[a, b]] :
      [...(lo > a ? [[a, lo] as Interval] : []), ...(hi < b ? [[hi, b] as Interval] : [])])
    const keys = new Set<string>()
    for (const [y, bottom] of spans) {
      const h = bottom - y, key = `${y}:${h}`, previous = active.get(key)
      keys.add(key)
      if (previous && Math.abs(endX(previous) - x) < EPS) previous.w += next - x
      else { const r = { x, y, w: next - x, h }; result.push(r); active.set(key, r) }
    }
    for (const key of active.keys()) if (!keys.has(key)) active.delete(key)
  }
  return result.sort((a, b) => a.x - b.x || a.y - b.y || a.w - b.w || a.h - b.h)
}
export function intersectRegions(a: Rect[], b: Rect[]): Rect[] {
  return subtractRegions(a.flatMap(r => b.flatMap(s => {
    const x = Math.max(r.x, s.x), y = Math.max(r.y, s.y)
    const w = Math.min(endX(r), endX(s)) - x, h = Math.min(endY(r), endY(s)) - y
    return w > EPS && h > EPS ? [{ x, y, w, h }] : []
  })))
}
export const regionAreaM2 = (regions: Rect[]) => subtractRegions(regions).reduce((n, r) => n + r.w * r.h / 1e6, 0)
export const expandRect = (r: Rect, mm: number): Rect => ({ x: r.x - mm, y: r.y - mm, w: r.w + 2 * mm, h: r.h + 2 * mm })
export const containsPoint = (r: Rect, p: { x: number; y: number }) => p.x >= r.x - EPS && p.x <= endX(r) + EPS && p.y >= r.y - EPS && p.y <= endY(r) + EPS
export function edgeBand(e: BoundaryEdge, width: number): Rect {
  const horizontal = e.side === 'N' || e.side === 'S'
  return horizontal ? { x: e.a.x - width, y: e.a.y - (e.side === 'S' ? width : 0), w: e.b.x - e.a.x + 2 * width, h: width } :
    { x: e.a.x - (e.side === 'E' ? width : 0), y: e.a.y - width, w: width, h: e.b.y - e.a.y + 2 * width }
}
/** Conservative square clearance at every outer and inner boundary, including re-entrant corners. */
export function insetRegions(regions: Rect[], distance: number): Rect[] {
  return distance > 0 ? subtractRegions(regions, rectUnionEdges(regions).map(e => edgeBand(e, distance))) : subtractRegions(regions)
}
export function portal(a: Rect, b: Rect): { x: number; y: number } | null {
  const x0 = Math.max(a.x, b.x), x1 = Math.min(endX(a), endX(b))
  const y0 = Math.max(a.y, b.y), y1 = Math.min(endY(a), endY(b))
  // Corner-only touching does not provide a route or connect roof islands.
  return (x1 > x0 + EPS && y1 >= y0 - EPS) || (y1 > y0 + EPS && x1 >= x0 - EPS)
    ? { x: (x0 + x1) / 2, y: (y0 + y1) / 2 } : null
}
export function connectedRegions(regions: Rect[]): Rect[][] {
  const remaining = new Set(regions.map((_, index) => index)), result: Rect[][] = []
  while (remaining.size) {
    const first = remaining.values().next().value!, queue = [first], group: Rect[] = []
    remaining.delete(first)
    for (let i = 0; i < queue.length; i++) {
      const r = regions[queue[i]]; group.push(r)
      for (const j of remaining) if (portal(r, regions[j])) { remaining.delete(j); queue.push(j) }
    }
    result.push(group)
  }
  return result
}
