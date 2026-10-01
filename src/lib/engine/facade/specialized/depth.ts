import { freeFacadeSpans } from '../FacadeGrammar.ts'
import { add, assembly, resolveAnchor, wallAnchor, type GrammarContext } from './context.ts'
import type { GrammarType } from './types.ts'

export function makeDepth(ctx: GrammarContext, zoneId: string, type: string) {
  const zone = ctx.facade.zones.find((z) => z.id === zoneId && z.wallId)
  const wall = ctx.building.walls.find((w) => w.id === zone?.wallId)
  if (!zone || !wall || zone.kind === 'ENTRANCE' || zone.kind === 'BALCONY') return null
  const free = freeFacadeSpans(zone, ctx.building, 160).sort((a, b) => b[1] - b[0] - (a[1] - a[0]))[0]
  if (!free || free[1] - free[0] < 700) return null
  const anchor = wallAnchor(wall), a = resolveAnchor(ctx, anchor)
  const origin = zone.side === 'N' || zone.side === 'S' ? a.x : a.y
  const u = free[0] - origin, width = Math.min(1400, free[1] - free[0])
  const room = ctx.building.rooms.find((r) => r.floorId === zone.floorId && r.id === zone.roomId)
  const unit = assembly('DEPTH', type as GrammarType, wall.id!, room ? [room.semanticId] : [])
  if (type === 'DEEP_RECESS' || type === 'SHALLOW_RECESS') {
    const depth = type === 'DEEP_RECESS' ? ctx.limits.deepRecessMm : ctx.limits.shallowRecessMm
    if (wall.thickness - depth < ctx.limits.minWallRemainderMm) return null
    add(ctx, unit, anchor, 'recess', u, -depth, 450, width, depth, a.h - 1000, 'stone', 'RECESS')
  } else if (type === 'MAIN_FACADE_PLANE') {
    add(ctx, unit, anchor, 'finish', u, 0, 200, width, 20, a.h - 400, 'wall')
  } else if (type === 'CLADDING_PLANE') {
    add(ctx, unit, anchor, 'cladding', u, 45, 250, width, 40, a.h - 500, 'stone')
    for (const at of [u + 50, u + width - 90]) add(ctx, unit, anchor, 'post', at, 0, 300, 40, 45, a.h - 600, 'metal')
  } else if (type === 'PROJECTED_SLAB') {
    add(ctx, unit, anchor, 'slab', u, 0, a.h - 450, width, Math.min(700, ctx.limits.maxProjectionMm), 160, 'concrete')
  } else if (type === 'ARCHITECTURAL_FRAME') {
    const depth = Math.min(ctx.dna.projectionDepth, ctx.limits.maxProjectionMm)
    for (const at of [u, u + width - 120]) add(ctx, unit, anchor, 'post', at, 0, 350, 120, depth, a.h - 700, 'stone')
    for (const z of [230, a.h - 350]) add(ctx, unit, anchor, 'beam', u, 0, z, width, depth, 120, 'stone')
  } else {
    const depth = Math.min(Math.max(ctx.dna.cantileverAmount, 350), ctx.limits.maxCantileverMm)
    add(ctx, unit, anchor, 'box', u, 0, a.h - 700, width, depth, 450, 'wall')
  }
  return unit
}

