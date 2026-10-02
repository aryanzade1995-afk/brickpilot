import { rectUnionEdges, type Rect } from '../../../geometry.ts'
import type { BuildingModel, BuildingRoom, BuildingWall } from '../../buildingModel.ts'
import type { MassingModel } from '../../massing/model.ts'
import type { VillaDesignDNA } from '../../villaDesignDna.ts'
import { massRect } from '../../massing/transforms.ts'
import type { ProceduralFacadeModel } from '../proceduralTypes.ts'
import type { GrammarAnchor, GrammarAssembly, GrammarCategory, GrammarLimits, GrammarLocalBox, GrammarPart, GrammarType } from './types.ts'

export type GrammarContext = { building: BuildingModel; dna: VillaDesignDNA; massing: MassingModel; facade: ProceduralFacadeModel; limits: GrammarLimits }
export const near = (a: number, b: number) => Math.abs(a - b) <= 2
export const overlap = (a: number, b: number, c: number, d: number) => Math.min(b, d) - Math.max(a, c)
export const intersects = (a: GrammarPart['world'], b: GrammarPart['world'], tolerance = 1) =>
  overlap(a.x, a.x + a.w, b.x, b.x + b.w) > tolerance && overlap(a.y, a.y + a.h, b.y, b.y + b.h) > tolerance &&
  overlap(a.z, a.z + a.height, b.z, b.z + b.height) > tolerance
export function wallSide(building: BuildingModel, wall: BuildingWall) {
  const floor = building.floors.find((f) => f.id === wall.floorId)!
  const h = near(wall.a.y, wall.b.y)
  const mid = h ? (wall.a.x + wall.b.x) / 2 : (wall.a.y + wall.b.y) / 2
  const edge = rectUnionEdges([...floor.footprint,...(floor.doubleHeightVoids??[]).map(v=>v.rect)], floor.courtyard).find((e) =>
    (e.side === 'N' || e.side === 'S') === h && near(h ? e.a.y : e.a.x, h ? wall.a.y : wall.a.x) &&
    mid >= (h ? e.a.x : e.a.y) && mid <= (h ? e.b.x : e.b.y))
  if (!edge) throw new Error(`Wall ${wall.id} is not a real exterior face`)
  return edge.side
}
export function balconyAccess(building: BuildingModel, room: BuildingRoom) {
  const door = building.doors.find((d) => d.floorId === room.floorId && d.rooms?.includes(room.id) &&
    d.rooms.some((id) => building.rooms.some((r) => r.floorId === room.floorId && r.id === id && !r.outdoor)))
  if (!door) throw new Error(`${room.semanticId} has no source room access`)
  const r = room.rect
  const side = door.orient === 'h' ? near(door.at.y, r.y) ? 'S' : near(door.at.y, r.y + r.h) ? 'N' : null :
    near(door.at.x, r.x) ? 'E' : near(door.at.x, r.x + r.w) ? 'W' : null
  if (!side) throw new Error(`${room.semanticId} access does not lie on its edge`)
  return { door, side }
}
export function resolveAnchor(ctx: GrammarContext, anchor: GrammarAnchor) {
  const { building, massing } = ctx
  const floor = building.floors.find((f) => f.id === anchor.floorId)
  if (!floor) throw new Error('Missing anchor floor')
  if (anchor.kind === 'WALL') {
    const wall = building.walls.find((w) => w.id === anchor.sourceId && w.floorId === floor.id && w.kind === 'exterior')
    if (!wall) throw new Error('Missing exterior wall anchor')
    const side = wallSide(building, wall), horizontal = side === 'N' || side === 'S'
    const lo = horizontal ? Math.min(wall.a.x, wall.b.x) : Math.min(wall.a.y, wall.b.y)
    const hi = horizontal ? Math.max(wall.a.x, wall.b.x) : Math.max(wall.a.y, wall.b.y)
    const normal = side === 'S' || side === 'E' ? 1 : -1
    const fixed = (horizontal ? wall.a.y : wall.a.x) + normal * wall.thickness / 2
    return { x: horizontal ? lo : fixed, y: horizontal ? fixed : lo, z: floor.elevationMm,
      side, w: hi - lo, d: wall.thickness, h: floor.heightMm, rects: [] as Rect[], wall }
  }
  if (anchor.kind === 'BALCONY') {
    const room = building.rooms.find((r) => r.semanticId === anchor.sourceId && r.floorId === floor.id && r.outdoor && r.id.startsWith('balcony'))
    if (!room) throw new Error('Missing source balcony')
    const { side } = balconyAccess(building, room)
    const r = room.rect, h = side === 'N' || side === 'S'
    return { x: side === 'W' ? r.x + r.w : r.x, y: side === 'N' ? r.y + r.h : r.y,
      z: floor.elevationMm, side, w: h ? r.w : r.h, d: h ? r.h : r.w,
      h: floor.heightMm, rects: [r], room }
  }
  const mass = anchor.kind === 'ROOF_MASS' ? massing.masses.find((m) => m.id === anchor.sourceId && m.sourceFloorId === floor.id && m.usage === 'roof') : undefined
  if (anchor.kind === 'ROOF_MASS' && !mass) throw new Error('Missing roof mass anchor')
  if (anchor.kind === 'ROOF' && anchor.sourceId !== floor.id) throw new Error('Invalid roof plate anchor')
  const r = mass ? massRect(mass) : floor.outline
  return { x: r.x, y: r.y, z: mass ? mass.elevation + mass.height : floor.elevationMm + floor.heightMm,
    side: 'S' as const, w: r.w, d: r.h, h: ctx.limits.maxRoofFeatureHeightMm,
    rects: mass ? [r] : [...floor.footprint,...(floor.doubleHeightVoids??[]).map(v=>v.rect)], mass }
}
export function deriveWorld(ctx: GrammarContext, anchor: GrammarAnchor, b: GrammarLocalBox): GrammarPart['world'] {
  const a = resolveAnchor(ctx, anchor), horizontal = a.side === 'N' || a.side === 'S'
  const fixed = horizontal ? a.y : a.x, along = (horizontal ? a.x : a.y) + b.u
  const positive = a.side === 'S' || a.side === 'E'
  const normal = positive ? fixed + b.v : fixed - b.v - b.d
  return { x: horizontal ? along : normal, y: horizontal ? normal : along,
    w: horizontal ? b.w : b.d, h: horizontal ? b.d : b.w, z: a.z + b.z, height: b.h }
}
export function assembly(category: GrammarCategory, type: GrammarType, id: string,
  sourceRoomIds: string[] = [], openingIds: string[] = []): GrammarAssembly {
  return { id: `${category}:${id}:${type}`, category, type, sourceRoomIds, openingIds, parts: [] }
}
export function add(ctx: GrammarContext, unit: GrammarAssembly, anchor: GrammarAnchor,
  role: GrammarPart['role'], u: number, v: number, z: number, w: number, d: number, h: number,
  material: GrammarPart['material'] = 'stone', operation: GrammarPart['operation'] = 'ADD') {
  const local = Object.fromEntries(Object.entries({ u, v, z, w, d, h }).map(([key, n]) => [key, Math.round(n)])) as GrammarLocalBox
  const collection = unit.category === 'BALCONY' ? 'BALCONIES' : unit.category === 'ROOFLINE' ? 'ROOF' :
    unit.category === 'WINDOW' ? 'WINDOWS' : 'FACADE'
  unit.parts.push({ id: `${unit.id}:${unit.parts.length}`, anchor, local, role, operation, material,
    collection, world: deriveWorld(ctx, anchor, local) })
}
export function wallAnchor(wall: BuildingWall): GrammarAnchor { return { kind: 'WALL', sourceId: wall.id!, floorId: wall.floorId } }
export function openingWall(ctx: GrammarContext, openingId: string) {
  const o = [...ctx.building.doors, ...ctx.building.windows].find((o) => o.id === openingId)!
  return ctx.building.walls.find((w) => w.kind === 'exterior' && w.floorId === o.floorId &&
    (near(w.a.y, w.b.y) ? 'h' : 'v') === o.orient &&
    near(o.orient === 'h' ? w.a.y : w.a.x, o.orient === 'h' ? o.at.y : o.at.x) &&
    (o.orient === 'h' ? o.at.x : o.at.y) - o.width / 2 >= Math.min(o.orient === 'h' ? w.a.x : w.a.y, o.orient === 'h' ? w.b.x : w.b.y) - 2 &&
    (o.orient === 'h' ? o.at.x : o.at.y) + o.width / 2 <= Math.max(o.orient === 'h' ? w.a.x : w.a.y, o.orient === 'h' ? w.b.x : w.b.y) + 2)
}
export function sourceOpeningBand(opening: { kind: string; sill?: number; head?: number }, height: number) {
  return { sill: opening.kind === 'window' ? opening.sill ?? 850 : 0,
    head: Math.min(opening.head ?? (opening.kind === 'window' ? 2200 : opening.kind === 'entry' ? 2500 : 2300), height - 120) }
}
