import type { BuildingModel } from '../engine/buildingModel.ts'
import type { Rect } from '../geometry.ts'
import { tankBank } from '../engine/terrace.ts'

export type TerraceObjectExtent = { id: string; kind: 'lounger' | 'parasol' | 'bench' | 'planter'; rectMm: Rect; heightMm: number }
/** Ordered subtraction must match geometry.plates: free[0]/free[1] locate the
 * exporter's furniture. A union-normalized decomposition would move those objects. */
function orderedSubtract(rect: Rect, cuts: Rect[]): Rect[] {
  return cuts.reduce<Rect[]>((pieces, cut) => pieces.flatMap(p => {
    const x0 = Math.max(p.x, cut.x), y0 = Math.max(p.y, cut.y), x1 = Math.min(p.x + p.w, cut.x + cut.w), y1 = Math.min(p.y + p.h, cut.y + cut.h)
    if (x1 <= x0 || y1 <= y0) return [p]
    return [{ x: p.x, y: p.y, w: x0 - p.x, h: p.h }, { x: x1, y: p.y, w: p.x + p.w - x1, h: p.h },
      { x: x0, y: p.y, w: x1 - x0, h: y0 - p.y }, { x: x0, y: y1, w: x1 - x0, h: p.y + p.h - y1 }].filter(r => r.w > .01 && r.h > .01)
  }), [rect])
}

/** Exact plan extents of geometry.terrace_objects; no new furniture is generated.
 * Parasol uses the complete canopy projection. Planting clearance is applied by
 * the roof policy rather than pretending to perform a foliage/shadow simulation. */
export function realizedTerraceObjects(building: BuildingModel): TerraceObjectExtent[] {
  const terrace = building.roofTerrace, top = [...building.floors].sort((a, b) => a.level - b.level).at(-1)
  if (!terrace || !top) return []
  const bank = tankBank(terrace)
  const blockers = [terrace.mumty, bank, ...building.shafts.filter(s => s.floorId === top.id).map(s => s.rect),
    ...building.stairs.filter(s => s.floorId === top.id).map(s => s.rect)].filter((r): r is Rect => r !== null)
  const grown = blockers.map(r => ({ x: r.x - 600, y: r.y - 600, w: r.w + 1200, h: r.h + 1200 }))
  const free = terrace.slab.flatMap(s => {
    const inner = { x: s.x + 750, y: s.y + 750, w: s.w - 1500, h: s.h - 1500 }
    return inner.w > 0 && inner.h > 0 ? orderedSubtract(inner, grown) : []
  }).sort((a, b) => b.w * b.h - a.w * a.h)
  const objects: TerraceObjectExtent[] = [], a = free[0]
  if (a) {
    if (a.w >= 3200 && a.h >= 2200) {
      const cx = a.x + 1400, cy = a.y + 1100
      for (let i = 0; i < 2; i++) objects.push({ id: `Terrace_Lounger_${i + 1}`, kind: 'lounger',
        rectMm: { x: cx - 950, y: cy + (i - .5) * 900 - 325, w: 1900, h: 650 }, heightMm: 510 })
      const px = a.w >= 4800 ? cx + 1700 : cx, py = a.w >= 4800 ? cy : cy + 1700
      objects.push({ id: 'Terrace_Parasol', kind: 'parasol', rectMm: { x: px - 1250, y: py - 1250, w: 2500, h: 2500 }, heightMm: 2375 })
    }
    if (free.length > 1 || a.w >= 6000) {
      const t = free.length > 1 ? free[1] : a
      const x = free.length > 1 ? t.x + t.w / 2 : a.x + a.w - 1400, y = t.y + t.h - 450
      if (t.w >= 1800 && t.h >= 900) objects.push({ id: 'Terrace_Bench', kind: 'bench', rectMm: { x: x - 800, y: y - 210, w: 1600, h: 420 }, heightMm: 460 })
    }
  }
  const keep = [terrace.mumty, bank].filter((r): r is Rect => r !== null)
  let placed = 0
  for (const slab of terrace.slab) for (let index = 0; index < Math.max(0, Math.floor(slab.w / 2600)); index++) {
    if (placed >= 6) break
    const x = slab.x + 1300 + index * 2600, r = { x: x - 650, y: slab.y + slab.h - 1020, w: 1300, h: 420 }
    if (keep.some(k => r.x < k.x + k.w + 300 && r.x + r.w > k.x - 300 && r.y < k.y + k.h + 300 && r.y + r.h > k.y - 300)) continue
    if (r.x + r.w > slab.x + slab.w - 200) continue
    placed++; objects.push({ id: `Terrace_Planter_${placed}`, kind: 'planter', rectMm: r, heightMm: 1100 })
  }
  return objects
}
