import type { Rect } from '../geometry.ts'

/**
 * Squarified treemap (Bruls, Huizing & van Wijk, 2000).
 * Lays a weighted list of items into `rect`, keeping each cell's aspect ratio
 * as close to 1 as the algorithm allows. Deterministic — order in, order out.
 */

export type TreemapItem = { id: string; weight: number }

export function squarify(items: TreemapItem[], rect: Rect): Map<string, Rect> {
  const out = new Map<string, Rect>()
  const clean = items.filter((i) => i.weight > 0)
  if (clean.length === 0) return out

  const totalWeight = clean.reduce((s, i) => s + i.weight, 0)
  const totalArea = rect.w * rect.h
  const scaled = clean.map((i) => ({ id: i.id, area: (i.weight / totalWeight) * totalArea }))

  let free: Rect = { ...rect }
  let row: { id: string; area: number }[] = []
  let i = 0

  const worst = (r: { area: number }[], side: number): number => {
    const sum = r.reduce((s, x) => s + x.area, 0)
    const max = Math.max(...r.map((x) => x.area))
    const min = Math.min(...r.map((x) => x.area))
    return Math.max((side * side * max) / (sum * sum), (sum * sum) / (side * side * min))
  }

  const shortestSide = (r: Rect) => Math.min(r.w, r.h)

  const layoutRow = (r: { id: string; area: number }[], f: Rect): Rect => {
    const sum = r.reduce((s, x) => s + x.area, 0)
    if (f.w >= f.h) {
      // place as a column on the left
      const colW = sum / f.h
      let y = f.y
      for (const cell of r) {
        const h = cell.area / colW
        out.set(cell.id, { x: f.x, y, w: colW, h })
        y += h
      }
      return { x: f.x + colW, y: f.y, w: f.w - colW, h: f.h }
    }
    // place as a row on the top
    const rowH = sum / f.w
    let x = f.x
    for (const cell of r) {
      const w = cell.area / rowH
      out.set(cell.id, { x, y: f.y, w, h: rowH })
      x += w
    }
    return { x: f.x, y: f.y + rowH, w: f.w, h: f.h - rowH }
  }

  while (i < scaled.length) {
    const item = scaled[i]
    const side = shortestSide(free)
    const withItem = [...row, item]
    if (row.length === 0 || worst(withItem, side) <= worst(row, side)) {
      row = withItem
      i++
    } else {
      free = layoutRow(row, free)
      row = []
    }
  }
  if (row.length > 0) layoutRow(row, free)

  return out
}
