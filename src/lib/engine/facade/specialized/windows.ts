import type { BuildingWindow } from '../../buildingModel.ts'
import { add, assembly, near, openingWall, resolveAnchor, sourceOpeningBand, wallAnchor, type GrammarContext } from './context.ts'
import type { GrammarType } from './types.ts'

export function makeWindows(ctx: GrammarContext, windows: BuildingWindow[], type: string) {
  if (!windows.length) return null
  const first = windows[0], wall = openingWall(ctx, first.id!)
  if (!wall) return null
  const axis = first.orient, fixed = axis === 'h' ? first.at.y : first.at.x
  let group = [first]
  if (type === 'HORIZONTAL_BAND' || type === 'FRAME_GROUPED') {
    group = windows.filter((w) => w.floorId === first.floorId && w.orient === axis && near(axis === 'h' ? w.at.y : w.at.x, fixed))
    if (group.length < 2) return null
  } else if (type === 'VERTICAL_STACK') {
    group = windows.filter((w) => w.orient === axis && near(w.at.x, first.at.x) && near(w.at.y, first.at.y) && w.width === first.width)
    if (new Set(group.map((w) => w.floorId)).size < 2) return null
  } else if (type === 'CORNER_GLAZING') {
    const other = windows.find((w) => w.floorId === first.floorId && w.orient !== axis &&
      w.rooms?.some((id) => id != null && first.rooms?.includes(id)) &&
      Math.hypot(w.at.x - first.at.x, w.at.y - first.at.y) < first.width / 2 + w.width / 2 + 650)
    if (!other) return null
    group = [first, other]
  }
  const roomIds = ctx.building.rooms.filter((r) => group.some((o) => o.floorId === r.floorId && o.rooms?.includes(r.id))).map((r) => r.semanticId)
  if (!roomIds.length || ctx.building.rooms.some((r) => roomIds.includes(r.semanticId) && r.outdoor)) return null
  const unit = assembly('WINDOW', type as GrammarType, first.id!, roomIds, group.map((w) => w.id!))
  for (const opening of group) {
    const host = openingWall(ctx, opening.id!)
    if (!host) return null
    const anchor = wallAnchor(host), a = resolveAnchor(ctx, anchor)
    const band = sourceOpeningBand(opening, a.h)
    if (type === 'FLOOR_TO_CEILING' && (band.sill > 80 || band.head < a.h - 400)) return null
    const at = opening.orient === 'h' ? opening.at.x - a.x : opening.at.y - a.y
    const lo = at - opening.width / 2, hi = at + opening.width / 2
    const c = ctx.limits.openingClearanceMm
    if (lo - c - 65 < 0 || hi + c + 65 > a.w) return null
    const env = ctx.building.plot.buildable
    const available = a.side === 'N' ? a.y - env.y : a.side === 'S' ? env.y + env.h - a.y :
      a.side === 'W' ? a.x - env.x : env.x + env.w - a.x
    const depth = Math.min(type === 'FLOOR_TO_CEILING' ? 170 : type === 'CORNER_GLAZING' ? 110 : 70, available - 40)
    if (depth < 20) return null
    for (const u of [lo - c - 65, hi + c]) add(ctx, unit, anchor, 'frame', u, 40, band.sill, 65, depth, band.head - band.sill, 'metal')
    add(ctx, unit, anchor, 'frame', lo - c - 65, 40, band.head + c, opening.width + 2 * (c + 65), depth, 65, 'metal')
    add(ctx, unit, anchor, 'beam', at - 25, 0, band.head + c, 50, 40, 65, 'metal')
    if (type === 'ASYMMETRIC') {
      add(ctx, unit, anchor, 'post', hi + c, 70, band.sill - Math.min(120, band.sill), 65, 200, band.head - band.sill + 120, 'stone')
      add(ctx, unit, anchor, 'slab', lo, 0, band.head + 120, opening.width * 0.65, 380, 80, 'stone')
    } else if (type === 'SCREENED') {
      const count = Math.max(3, Math.floor(opening.width / 280))
      for (let i = 1; i <= count; i++) add(ctx, unit, anchor, 'screen', lo + opening.width * i / (count + 1) - 25,
        180, band.sill, 50, 140, band.head - band.sill, 'timber')
    } else if (type === 'ALIGNED' || type === 'FLOOR_TO_CEILING') {
      // Real mullion inside the existing aperture; the clear wall hole is unchanged.
      add(ctx, unit, anchor, 'frame', at - 18, -host.thickness / 2 - 20, band.sill + 55,
        36, 40, band.head - band.sill - 110, 'metal')
    } else if (type === 'HORIZONTAL_BAND' || type === 'FRAME_GROUPED') {
      add(ctx, unit, anchor, 'slab', lo - c, 40, band.head + (type === 'HORIZONTAL_BAND' ? 180 : 110),
        opening.width + c * 2, type === 'HORIZONTAL_BAND' ? 450 : 280, type === 'HORIZONTAL_BAND' ? 90 : 160, 'stone')
      if (type === 'FRAME_GROUPED' && band.sill >= 150)
        add(ctx, unit, anchor, 'frame', lo - c, 40, band.sill - 130, opening.width + c * 2, 280, 80, 'stone')
    } else if (type === 'VERTICAL_STACK') {
      for (const u of [lo - c - 65, hi + c]) add(ctx, unit, anchor, 'post', u, depth, 0, 65, 80, a.h, 'stone')
    }
  }
  if (type === 'HORIZONTAL_BAND' || type === 'FRAME_GROUPED') {
    // Join the actual adjacent window headers, even when they belong to different rooms.
    const ordered = [...group].sort((a, b) => (axis === 'h' ? a.at.x - b.at.x : a.at.y - b.at.y))
    for (let i = 0; i < ordered.length - 1; i++) {
      const left = ordered[i], right = ordered[i + 1]
      const start = (axis === 'h' ? left.at.x : left.at.y) + left.width / 2
      const end = (axis === 'h' ? right.at.x : right.at.y) - right.width / 2
      if (end <= start) continue
      for (const host of ctx.building.walls.filter((w) => w.kind === 'exterior' && w.floorId === left.floorId &&
        (near(w.a.y, w.b.y) ? 'h' : 'v') === axis && near(axis === 'h' ? w.a.y : w.a.x, fixed))) {
        const anchor = wallAnchor(host), a = resolveAnchor(ctx, anchor), origin = axis === 'h' ? a.x : a.y
        const lo = Math.max(start, origin), hi = Math.min(end, origin + a.w)
        if (hi - lo < 20) continue
        add(ctx, unit, anchor, 'beam', lo - origin, 40, Math.max(sourceOpeningBand(left, a.h).head, sourceOpeningBand(right, a.h).head) + 180,
          hi - lo, type === 'HORIZONTAL_BAND' ? 450 : 280, type === 'HORIZONTAL_BAND' ? 90 : 160, 'stone')
      }
    }
  }
  return unit
}
