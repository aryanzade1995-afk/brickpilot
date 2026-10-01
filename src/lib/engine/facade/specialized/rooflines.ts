import { rectUnionEdges, type Rect } from '../../../geometry.ts'
import { uncoveredArea } from '../../massing/families.ts'
import { massRect } from '../../massing/transforms.ts'
import { add, assembly, resolveAnchor, type GrammarContext } from './context.ts'
import type { GrammarAnchor, GrammarType } from './types.ts'

const overlaps = (a: Rect, b: Rect) => Math.min(a.x + a.w, b.x + b.w) > Math.max(a.x, b.x) &&
  Math.min(a.y + a.h, b.y + b.h) > Math.max(a.y, b.y)
function subtract(rect: Rect, cuts: Rect[]): Rect[] {
  let pieces = [rect]
  for (const cut of cuts) pieces = pieces.flatMap((r) => {
    if (!overlaps(r, cut)) return [r]
    const x0 = Math.max(r.x, cut.x), x1 = Math.min(r.x + r.w, cut.x + cut.w)
    const y0 = Math.max(r.y, cut.y), y1 = Math.min(r.y + r.h, cut.y + cut.h)
    return [{ x: r.x, y: r.y, w: x0 - r.x, h: r.h }, { x: x1, y: r.y, w: r.x + r.w - x1, h: r.h },
      { x: x0, y: r.y, w: x1 - x0, h: y0 - r.y }, { x: x0, y: y1, w: x1 - x0, h: r.y + r.h - y1 }].filter((p) => p.w > 0 && p.h > 0)
  })
  return pieces
}
export function roofPad(ctx: GrammarContext) {
  const top = [...ctx.building.floors].sort((a, b) => a.level - b.level).at(-1)!
  const stair = ctx.building.stairs.find((s) => s.floorId === top.id)
  if (!stair || ['gable', 'hip', 'mono-slope'].includes(ctx.dna.roofType)) return null
  const voids = [stair.rect, ...ctx.building.shafts.filter((s) => s.floorId === top.id).map((s) => s.rect)]
  const blocked = ctx.massing.masses.filter((m) => m.usage === 'roof').flatMap((m) => subtract(massRect(m), voids))
  blocked.push(...ctx.building.shafts.filter((s) => s.floorId === top.id).map((s) => s.rect))
  const width = ctx.limits.minRoofPadWidthMm, depth = ctx.limits.minRoofPadDepthMm, half = ctx.limits.roofRouteWidthMm / 2
  const r = stair.rect, side = stair.startSide ?? 'N'
  const sx = side === 'E' ? r.x + r.w + half : side === 'W' ? r.x - half : r.x + r.w / 2
  const sy = side === 'S' ? r.y + r.h + half : side === 'N' ? r.y - half : r.y + r.h / 2
  const clear = (p: Rect) => uncoveredArea([p], top.footprint) <= 2 && !blocked.some((b) => overlaps(p, b)) && !overlaps(p, r)
  for (const plate of top.footprint) for (let x = plate.x + 200; x + width <= plate.x + plate.w - 200; x += 400)
    for (let y = plate.y + 200; y + depth <= plate.y + plate.h - 200; y += 400) {
      const pad = { x, y, w: width, h: depth }, px = x + width / 2, py = y + depth / 2
      const horizontal = (xx: number, yy: number, to: number): Rect => ({ x: Math.min(xx, to) - half, y: yy - half, w: Math.abs(xx - to) + half * 2, h: half * 2 })
      const vertical = (xx: number, yy: number, to: number): Rect => ({ x: xx - half, y: Math.min(yy, to) - half, w: half * 2, h: Math.abs(yy - to) + half * 2 })
      const routes = [[horizontal(sx, sy, px), vertical(px, sy, py)], [vertical(sx, sy, py), horizontal(sx, py, px)]]
      if (clear(pad) && routes.some((route) => route.every(clear))) return { pad, top, routes: routes.find((route) => route.every(clear))! }
    }
  return null
}

export function makeRoofline(ctx: GrammarContext, type: string) {
  if (['gable', 'hip', 'mono-slope'].includes(ctx.dna.roofType)) return null
  const top = [...ctx.building.floors].sort((a, b) => a.level - b.level).at(-1)!
  const anchor: GrammarAnchor = { kind: 'ROOF', sourceId: top.id, floorId: top.id }
  const a = resolveAnchor(ctx, anchor), unit = assembly('ROOFLINE', type as GrammarType, top.id)
  if (['PERGOLA', 'ROOF_TERRACE', 'SCREENED_TERRACE'].includes(type)) {
    const candidate = roofPad(ctx)
    if (!candidate) return null
    const p = candidate.pad, u = p.x - a.x, v = p.y - a.y
    if (type === 'ROOF_TERRACE') {
      for (let i = 0; i < 4; i++) add(ctx, unit, anchor, 'finish', u + p.w * i / 4, v, 0, p.w / 4 - 10, p.h, 35, 'stone')
    } else if (type === 'PERGOLA') {
      for (const x of [u, u + p.w - 100]) for (const y of [v, v + p.h - 100])
        add(ctx, unit, anchor, 'post', x, y, 0, 100, 100, 2200, 'timber')
      for (let i = 0; i < 6; i++) add(ctx, unit, anchor, 'beam', u + (p.w - 70) * i / 5, v, 2100, 70, p.h, 100, 'timber')
      for (const y of [v, v + p.h - 100]) add(ctx, unit, anchor, 'beam', u, y, 2000, p.w, 100, 100, 'timber')
    } else {
      // Two open sides keep the entire source-stair approach unobstructed.
      const route = candidate.routes
      for (const edge of [{ x: p.x, y: p.y + p.h - 70, w: p.w, h: 70 }, { x: p.x + p.w - 70, y: p.y, w: 70, h: p.h }]) {
        if (route.some((r) => overlaps(r, edge))) continue
        const horizontal = edge.w > edge.h
        const count = Math.max(3, Math.floor((horizontal ? edge.w : edge.h) / 280))
        for (let i = 0; i <= count; i++) add(ctx, unit, anchor, 'screen', edge.x - a.x + (horizontal ? (edge.w - 50) * i / count : 0),
          edge.y - a.y + (horizontal ? 0 : (edge.h - 50) * i / count), 0, horizontal ? 50 : 70, horizontal ? 70 : 50, 1600, 'timber')
      }
    }
  } else if (type === 'ROOFTOP_FRAME') {
    const mass = ctx.massing.masses.filter((m) => m.usage === 'roof' && m.width >= 1300 && m.depth >= 1000)
      .sort((a, b) => b.width * b.depth - a.width * a.depth)[0]
    if (!mass) return null
    const cap: GrammarAnchor = { kind: 'ROOF_MASS', sourceId: mass.id, floorId: top.id }
    const host = resolveAnchor(ctx, cap)
    for (const x of [80, host.w - 200]) for (const y of [80, host.d - 200]) add(ctx, unit, cap, 'post', x, y, 0, 120, 120, 1400, 'stone')
    for (const y of [80, host.d - 200]) add(ctx, unit, cap, 'beam', 80, y, 1400, host.w - 160, 120, 160, 'stone')
    for (const x of [80, host.w - 200]) add(ctx, unit, cap, 'beam', x, 200, 1400, 120, host.d - 400, 160, 'stone')
  } else {
    const blockers = ctx.massing.masses.filter((m) => m.usage === 'roof').map(massRect)
    blockers.push(...ctx.building.shafts.filter((s) => s.floorId === top.id).map((s) => s.rect))
    blockers.push(...ctx.building.stairs.filter((s) => s.floorId === top.id).map((s) => s.rect))
    let index = 0
    for (const edge of rectUnionEdges(top.footprint, top.courtyard)) {
      const h = edge.side === 'N' || edge.side === 'S', positive = edge.side === 'S' || edge.side === 'E'
      const fixed = h ? edge.a.y : edge.a.x, start = h ? edge.a.x : edge.a.y, end = h ? edge.b.x : edge.b.y
      const thickness = type === 'PLANTER_PARAPET' ? 260 : 120
      const inset = type === 'OFFSET_PARAPET' ? 180 : 0
      const r = h ? { x: start, y: fixed - (positive ? thickness + inset : -inset), w: end - start, h: thickness } :
        { x: fixed - (positive ? thickness + inset : -inset), y: start, w: thickness, h: end - start }
      for (const piece of subtract(r, blockers).filter((p) => Math.max(p.w, p.h) >= 400)) {
        const height = type === 'STEPPED_PARAPET' ? (index++ % 2 ? 900 : 1250) : 900
        const u = piece.x - a.x, v = piece.y - a.y
        if (type === 'STEPPED_PARAPET' && Math.max(piece.w, piece.h) >= 1200) {
          add(ctx, unit, anchor, 'rail', u, v, 0, h ? piece.w / 2 : piece.w, h ? piece.h : piece.h / 2, 900, 'wall')
          add(ctx, unit, anchor, 'rail', u + (h ? piece.w / 2 : 0), v + (h ? 0 : piece.h / 2), 0,
            h ? piece.w / 2 : piece.w, h ? piece.h : piece.h / 2, 1250, 'wall')
        } else add(ctx, unit, anchor, 'rail', u, v, 0, piece.w, piece.h, height, 'wall')
        if (type === 'PLANTER_PARAPET') add(ctx, unit, anchor, 'finish', u + 25, v + 25, height,
          piece.w - 50, piece.h - 50, 60, 'landscape')
        if (type === 'OFFSET_PARAPET') add(ctx, unit, anchor, 'cap', u, v, height, piece.w, piece.h, 60, 'stone')
      }
    }
  }
  return unit.parts.length ? unit : null
}
