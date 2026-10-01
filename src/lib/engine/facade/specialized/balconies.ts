import type { BuildingRoom } from '../../buildingModel.ts'
import { add, assembly, balconyAccess, near, resolveAnchor, type GrammarContext } from './context.ts'
import type { GrammarAnchor } from './types.ts'

/** All treatments stay inside the source balcony; no new outdoor room is made. */
export function makeBalcony(ctx: GrammarContext, room: BuildingRoom, type: string) {
  const access = balconyAccess(ctx.building, room)
  const anchor: GrammarAnchor = { kind: 'BALCONY', floorId: room.floorId, sourceId: room.semanticId }
  const a = resolveAnchor(ctx, anchor), W = a.w, D = a.d, H = ctx.limits.railHeightMm
  const floor = ctx.building.floors.find((f) => f.id === room.floorId)!
  const corner = near(room.rect.x, floor.outline.x) || near(room.rect.x + room.rect.w, floor.outline.x + floor.outline.w) ||
    near(room.rect.y, floor.outline.y) || near(room.rect.y + room.rect.h, floor.outline.y + floor.outline.h)
  if ((type === 'CORNER' || type === 'WRAP') && !corner) return null
  if (D - (type === 'PLANTER' ? 260 : 130) < ctx.limits.minBalconyClearDepthMm || W < access.door.width + 400) return null
  const unit = assembly('BALCONY', type as Parameters<typeof assembly>[1], room.semanticId, [room.semanticId], [access.door.id!])
  const rail = (u: number, v: number, w: number, d: number, solid = false) => {
    add(ctx, unit, anchor, solid ? 'rail' : 'glass', u, v, 80, w, d, H - 140, solid ? 'wall' : 'glass')
    add(ctx, unit, anchor, 'rail', u, v, H - 60, w, d, 60, 'metal')
  }
  rail(40, D - 75, W - 80, 35, type === 'RECESSED')
  rail(20, 160, 35, D - 235, type === 'BOXED')
  rail(W - 55, 160, 35, D - 235, type === 'BOXED')
  // Open inner edge at v=0 preserves the exact source access door.
  if (type === 'RECESSED' || type === 'BOXED') {
    for (const u of [0, W - 100]) add(ctx, unit, anchor, 'post', u, 160, 0, 100, D - 160, a.h - 260, 'wall')
    add(ctx, unit, anchor, 'beam', 0, 160, a.h - 260, W, D - 160, 160, 'wall')
    if (type === 'BOXED') add(ctx, unit, anchor, 'slab', 0, D - 180, -220, W, 180, 160, 'stone')
  } else if (type === 'PROJECTED') {
    add(ctx, unit, anchor, 'slab', 0, D - 220, -220, W, 220, 220, 'concrete')
    for (const u of [30, W - 90]) add(ctx, unit, anchor, 'post', u, D - 90, 0, 60, 60, H, 'metal')
  } else if (type === 'FLOATING') {
    add(ctx, unit, anchor, 'slab', 40, 160, -150, W - 80, D - 200, 90, 'concrete')
    for (const u of [120, W - 240]) add(ctx, unit, anchor, 'beam', u, 0, -220, 120, Math.min(D, 700), 120, 'metal')
  } else if (type === 'CORNER' || type === 'WRAP' || type === 'FRAME_INTEGRATED') {
    for (const u of [0, W - 130]) add(ctx, unit, anchor, 'post', u, D - 130, 0, 130, 130, a.h - 280, 'stone')
    add(ctx, unit, anchor, 'beam', 0, D - 180, a.h - 280, W, 180, 180, 'stone')
    if (type !== 'FRAME_INTEGRATED') add(ctx, unit, anchor, 'beam', 0, 100, a.h - 280, 180, D - 280, 180, 'stone')
    if (type === 'WRAP') {
      add(ctx, unit, anchor, 'beam', W - 180, 100, a.h - 280, 180, D - 280, 180, 'stone')
      for (let u = 240; u < W - 240; u += 400) add(ctx, unit, anchor, 'screen', u, D - 130, H + 150, 55, 120, 700, 'timber')
    }
  } else if (type === 'PLANTER') {
    add(ctx, unit, anchor, 'planter', 140, D - 260, 0, W - 280, 220, 450, 'concrete')
    add(ctx, unit, anchor, 'finish', 180, D - 235, 450, W - 360, 165, 60, 'landscape')
  } else {
    const width = type === 'PARTIAL_WIDTH' ? Math.max(1200, Math.round(W * 0.58)) : W
    add(ctx, unit, anchor, 'beam', 0, 160, a.h - 360, width, D - 160, 140, 'wall')
    for (const u of [30, width - 100]) add(ctx, unit, anchor, 'post', u, D - 100, H, 70, 70, a.h - 360 - H, 'metal')
  }
  return unit
}
