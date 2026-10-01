import type { BuildingDoor } from '../../buildingModel.ts'
import { add, assembly, openingWall, resolveAnchor, sourceOpeningBand, wallAnchor, wallSide, type GrammarContext } from './context.ts'
import type { GrammarType } from './types.ts'

export function makeEntrance(ctx: GrammarContext, entry: BuildingDoor, type: string) {
  const wall = openingWall(ctx, entry.id!)
  if (!wall) return null
  const anchor = wallAnchor(wall), a = resolveAnchor(ctx, anchor)
  const floor = ctx.building.floors.find((f) => f.id === entry.floorId)!
  const band = sourceOpeningBand(entry, floor.heightMm)
  const center = (entry.orient === 'h' ? entry.at.x - a.x : entry.at.y - a.y)
  const margin = type === 'DOUBLE_HEIGHT_PORTAL' ? 370 : type === 'COURTYARD_ENTRY' ? 120 : 220
  const lo = center - entry.width / 2 - margin, hi = center + entry.width / 2 + margin
  if (lo < 30 || hi > a.w - 30 || a.h < band.head + 300) return null
  const side = wallSide(ctx.building, wall)
  if (type === 'SIDE_ENTRY' && side === ctx.building.orientation.roadPlanSide) return null
  const courtyard = ctx.building.floors.some((f) => f.courtyard && (side === 'N' || side === 'S'
    ? entry.at.x >= f.courtyard.x && entry.at.x <= f.courtyard.x + f.courtyard.w &&
      (Math.abs(entry.at.y - f.courtyard.y) <= 2 || Math.abs(entry.at.y - f.courtyard.y - f.courtyard.h) <= 2)
    : entry.at.y >= f.courtyard.y && entry.at.y <= f.courtyard.y + f.courtyard.h &&
      (Math.abs(entry.at.x - f.courtyard.x) <= 2 || Math.abs(entry.at.x - f.courtyard.x - f.courtyard.w) <= 2)))
  if (type === 'COURTYARD_ENTRY' && !courtyard) return null
  const unit = assembly('ENTRANCE', type as GrammarType, entry.id!,
    ctx.building.rooms.filter((r) => r.floorId === entry.floorId && entry.rooms?.includes(r.id)).map((r) => r.semanticId), [entry.id!])
  const top = band.head + 100
  if (type === 'DOUBLE_HEIGHT_PORTAL') {
    const upper = ctx.building.walls.find((w) => w.kind === 'exterior' && ctx.building.floors.find((f) => f.id === w.floorId)?.level === floor.level + 1 &&
      wallSide(ctx.building, w) === side && Math.abs(entry.orient === 'h' ? w.a.y - wall.a.y : w.a.x - wall.a.x) <= 2 &&
      Math.min(entry.orient === 'h' ? w.a.x : w.a.y, entry.orient === 'h' ? w.b.x : w.b.y) <= (entry.orient === 'h' ? entry.at.x : entry.at.y) - entry.width / 2 - margin &&
      Math.max(entry.orient === 'h' ? w.a.x : w.a.y, entry.orient === 'h' ? w.b.x : w.b.y) >= (entry.orient === 'h' ? entry.at.x : entry.at.y) + entry.width / 2 + margin)
    if (!upper) return null
    const upperAnchor = wallAnchor(upper), up = resolveAnchor(ctx, upperAnchor)
    const delta = entry.orient === 'h' ? a.x - up.x : a.y - up.y
    for (const u of [lo, hi - 140]) {
      add(ctx, unit, anchor, 'post', u, 0, 0, 140, 450, a.h, 'stone')
      add(ctx, unit, upperAnchor, 'post', u + delta, 0, 0, 140, 450, up.h - 350, 'stone')
    }
    add(ctx, unit, upperAnchor, 'beam', lo + delta, 0, up.h - 350, hi - lo, 450, 180, 'stone')
  } else if (type === 'RECESSED_ENTRY') {
    const depth = Math.min(ctx.limits.deepRecessMm, wall.thickness - ctx.limits.minWallRemainderMm)
    for (const u of [lo, hi - 140]) add(ctx, unit, anchor, 'recess', u, -depth, 120, 140, depth, band.head - 240, 'stone', 'RECESS')
    add(ctx, unit, anchor, 'beam', lo, 0, top, hi - lo, 420, 130, 'wall')
  } else if (type === 'FLOATING_CANOPY') {
    add(ctx, unit, anchor, 'slab', lo, 0, top, hi - lo, Math.min(900, ctx.limits.maxCantileverMm), 120, 'concrete')
    for (const u of [lo + 70, hi - 150]) add(ctx, unit, anchor, 'beam', u, 0, top - 80, 80, 300, 80, 'metal')
  } else {
    const material = type === 'WOOD_PORTAL' ? 'timber' : 'stone'
    const depth = type === 'STONE_ENTRY' ? 550 : type === 'COURTYARD_ENTRY' ? 650 : 320
    const jambWidth = type === 'COURTYARD_ENTRY' ? 80 : 150
    for (const u of [lo, hi - jambWidth]) add(ctx, unit, anchor, 'post', u, 0, 0, jambWidth, depth, top, material)
    add(ctx, unit, anchor, 'beam', lo, 0, top, hi - lo, depth, 150, material)
    if (type === 'WOOD_PORTAL' || type === 'SIDE_ENTRY') for (let i = 0; i < 4; i++)
      add(ctx, unit, anchor, 'screen', lo + (hi - lo) * i / 4, 0, top + 150, 45, depth, 120, material)
    if (type === 'COURTYARD_ENTRY') for (const u of [lo + 15, hi - 60])
      add(ctx, unit, anchor, 'screen', u, depth, 0, 45, 160, top, 'timber')
  }
  return unit
}
