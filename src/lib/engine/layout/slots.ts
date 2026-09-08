import { type Rect, rectBottom, rectRight } from '../../geometry.ts'

/* ------------------------------------------------------------------ *
 *  sliceRegion — guillotine a rect into weighted cells along one
 *  axis. Every cell spans the full CROSS dimension of the region, so
 *  each cell touches both cross edges — and therefore the circulation
 *  hub, which always sits on one of them. The adjacency-aware
 *  replacement for the old `squarify` treemap.
 * ------------------------------------------------------------------ */

export type SliceCell = {
  id: string
  /** relative size along the slice axis (area weight ÷ cross length) */
  weight: number
  /** hard minimum along the slice axis, mm */
  minMain: number
}

export type SliceOpts = {
  axis: 'x' | 'y'
  /** stack from the low edge (default) or the high edge of `region` */
  from?: 'lo' | 'hi'
}

/**
 * Lay `cells` end-to-end across `region` along `opts.axis`. Cells shorter than
 * `minMain` after the weighted split borrow length from the largest cells;
 * if the region simply cannot hold every minimum, the last cells are dropped
 * (the caller places what fits — `repairNarrow` cleans up the rest downstream).
 */
export function sliceRegion(region: Rect, cells: SliceCell[], opts: SliceOpts): Map<string, Rect> {
  const out = new Map<string, Rect>()
  const live = cells.filter((c) => c.weight > 0 || c.minMain > 0)
  if (live.length === 0) return out

  const along = opts.axis === 'x' ? region.w : region.h
  const cross = opts.axis === 'x' ? region.h : region.w
  if (along < 400 || cross < 400) return out

  const kept = [...live]
  // if the minimums simply don't fit, scale them down together (cram) — the
  // caller's repairNarrow / sealGaps clean up afterwards; never drop a room
  const minSum = kept.reduce((s, c) => s + c.minMain, 0)
  const minScale = minSum > along ? along / minSum : 1

  // weighted split, then lift each below its (scaled) minimum, paying from the largest
  const wsum = kept.reduce((s, c) => s + Math.max(c.weight, 1e-6), 0)
  const len = kept.map((c) =>
    Math.max(c.minMain * minScale, (Math.max(c.weight, 1e-6) / wsum) * along),
  )
  let over = len.reduce((s, l) => s + l, 0) - along
  for (let guard = 0; over > 1 && guard < 400; guard++) {
    let bi = 0
    for (let i = 1; i < len.length; i++) if (len[i] > len[bi]) bi = i
    const give = Math.min(over, len[bi] - kept[bi].minMain * minScale)
    if (give <= 0.5) break
    len[bi] -= give
    over -= give
  }

  let cursor = opts.from === 'hi' ? along : 0
  kept.forEach((c, i) => {
    const l = Math.min(len[i], along)
    const lo = opts.from === 'hi' ? cursor - l : cursor
    const rect: Rect =
      opts.axis === 'x'
        ? { x: region.x + lo, y: region.y, w: l, h: region.h }
        : { x: region.x, y: region.y + lo, w: region.w, h: l }
    out.set(c.id, rect)
    cursor = opts.from === 'hi' ? cursor - l : cursor + l
  })
  return out
}

/** true if `a` and `b` share an axis-aligned wall segment longer than `min` mm */
export function touches(a: Rect, b: Rect, min = 600): boolean {
  const vy = Math.min(rectBottom(a), rectBottom(b)) - Math.max(a.y, b.y)
  const hx = Math.min(rectRight(a), rectRight(b)) - Math.max(a.x, b.x)
  if (vy > min && (Math.abs(rectRight(a) - b.x) < 2 || Math.abs(rectRight(b) - a.x) < 2)) return true
  if (hx > min && (Math.abs(rectBottom(a) - b.y) < 2 || Math.abs(rectBottom(b) - a.y) < 2)) return true
  return false
}
