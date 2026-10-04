import type { Design } from '../engine/types.ts'
import { segLength } from '../geometry.ts'
import { measuredArea, roomQuantityKind, type Quantities } from './quantities.ts'
import { quantityRules as rules } from './data/quantityRules.ts'
import { boqRules } from './data/boqRules.ts'

export type RoomMeasures = { id: string; semanticId: string; floor: number; name: string; kind: string; values: Record<string, number> }
/** Price-independent allocations over the authoritative take-off. Never writes room geometry. */
export function boqMeasures(design: Design, q: Quantities) {
  const a = boqRules.allowances, extra: Record<string, number> = { one: 1, plotArea: design.model.plot.width * design.model.plot.depth / 1e6 }
  const rooms: RoomMeasures[] = []
  let exterior = 0, mainDoors = 0, balconyArea = 0, stairArea = 0, canopy = 0
  const tolerance = rules.toleranceMm
  for (const floor of design.floors) {
    const takeoff = q.perFloor.find(f => f.level === floor.level)!, size = q.structureSizing.floors.find(f => f.level === floor.level)!
    const height = design.model.brief.levels.floorToFloor - size.slabThicknessMm / 1000
    const holes = [...(floor.courtyard ? [floor.courtyard] : []), ...(floor.doubleHeightVoids ?? []).map(v => v.rect)]
    const weights = new Map<string, number>()
    let exteriorFloor = 0
    for (const wall of floor.walls.filter(w => w.kind !== 'parapet')) {
      const horizontal = Math.abs(wall.a.y - wall.b.y) <= tolerance
      const lo = horizontal ? Math.min(wall.a.x, wall.b.x) : Math.min(wall.a.y, wall.b.y)
      const hi = horizontal ? Math.max(wall.a.x, wall.b.x) : Math.max(wall.a.y, wall.b.y)
      const fixed = horizontal ? wall.a.y : wall.a.x
      const wallHeight = wall.heightMm ?? height * 1000
      const hosted = floor.openings.filter(o => o.orient === (horizontal ? 'h' : 'v') &&
        Math.abs((horizontal ? o.at.y : o.at.x) - fixed) <= tolerance &&
        (horizontal ? o.at.x : o.at.y) - o.width / 2 >= lo - tolerance && (horizontal ? o.at.x : o.at.y) + o.width / 2 <= hi + tolerance)
      const cuts = hosted.map(o => ({ x: (horizontal ? o.at.x : o.at.y) - o.width / 2,
        y: o.kind === 'window' ? o.sill ?? rules.openingLimits.defaultSillMm : 0, w: o.width,
        h: (o.head ?? rules.openingLimits[`${o.kind}HeadMm`]) - (o.kind === 'window' ? o.sill ?? rules.openingLimits.defaultSillMm : 0) }))
      const area = measuredArea([{ x: lo, y: 0, w: segLength(wall), h: wallHeight }], cuts)
      if (wall.kind === 'exterior') exteriorFloor += area
      for (const id of wall.rooms ?? []) if (id) weights.set(id, (weights.get(id) ?? 0) + area)
    }
    exteriorFloor += (takeoff.items.parapet?.NetSideArea ?? 0) * 2
    exterior += exteriorFloor
    const floorRooms: RoomMeasures[] = []
    for (const room of floor.rooms) {
      const area = measuredArea([room.rect], holes), p = 2 * (room.rect.w + room.rect.h) / 1000, kind = roomQuantityKind(room)
      if (room.outdoor) { if (/balcony/i.test(`${room.id} ${room.semanticId}`)) balconyArea += area; continue }
      const openingAreaBelow = (top: number) => floor.openings.filter(o => o.rooms?.includes(room.id)).reduce((n, o) => {
        const sill = o.kind === 'window' ? (o.sill ?? rules.openingLimits.defaultSillMm) / 1000 : 0
        const head = (o.head ?? rules.openingLimits[`${o.kind}HeadMm`]) / 1000
        return n + o.width / 1000 * Math.max(0, Math.min(top, head) - sill)
      }, 0)
      const doorLength = floor.openings.filter(o => o.kind !== 'window' && o.rooms?.includes(room.id)).reduce((n, o) => n + o.width / 1000, 0)
      const wetTiles = kind === 'bath' ? Math.max(0, p * Math.min(height, rules.finishes.wetTileHeightMm / 1000) - openingAreaBelow(Math.min(height, rules.finishes.wetTileHeightMm / 1000))) : 0
      const dado = kind === 'kitchen' ? p * rules.finishes.kitchenDadoWallRatio * rules.finishes.kitchenDadoHeightMm / 1000 : 0
      const run = kind === 'kitchen' ? p * a.kitchenRunRatio : 0
      const floorKind = ['living', 'bedroom', 'kitchen', 'bath'].includes(kind) ? kind : 'other'
      floorRooms.push({ id: `${floor.level}:${room.semanticId || room.id}`, semanticId: room.semanticId || room.id,
        floor: floor.level, name: `${floor.name} · ${room.name}`, kind,
        values: { [`floor:${floorKind}`]: area, skirting: kind === 'bath' ? 0 : Math.max(0, p - doorLength) * rules.finishes.skirtingHeightMm / 1000,
          wetTiles, dado, bathWaterproofing: kind === 'bath' ? area : 0, ceiling: area,
          counter: run * a.counterDepthM, cabinets: run * a.cabinetFaceHeightM, sink: kind === 'kitchen' ? 1 : 0,
          sanitary: kind === 'bath' ? 1 : 0, cp: kind === 'bath' ? 1 : 0, heater: kind === 'bath' ? 1 : 0,
          fans: boqRules.fansByRoom[kind] ?? 0, paint: Math.max(0, (weights.get(room.id) ?? p * height) - wetTiles - dado) } })
    }
    // Preserve the measured total, including unattributed circulation walls; do not invent extra face area.
    const interiorPaint = Math.max(0, (takeoff.items['paint.walls']?.NetSideArea ?? 0) - exteriorFloor)
    const sum = floorRooms.reduce((n, r) => n + r.values.paint, 0)
    for (const room of floorRooms) room.values.paint = sum ? interiorPaint * room.values.paint / sum : 0
    const ceilingArea = takeoff.items['plaster.ceiling']?.NetArea ?? 0
    const roomArea = floorRooms.reduce((n, r) => n + r.values.ceiling, 0)
    for (const room of floorRooms) room.values.ceiling = roomArea ? ceilingArea * room.values.ceiling / roomArea : 0
    rooms.push(...floorRooms)
    if (floor.stair) stairArea += floor.stair.rect.w * floor.stair.rect.h / 1e6
    for (const o of floor.openings.filter(o => o.kind === 'entry' && !o.emergencyExit && o.leaf !== false)) {
      mainDoors += o.width * (o.head ?? rules.openingLimits.entryHeadMm) / 1e6
      canopy += o.width / 1000 * a.canopyProjectionM
    }
  }
  const item = (id: string, field: 'NetArea' | 'NetSideArea' | 'Count') => q.total.items[id]?.[field] ?? 0
  Object.assign(extra, { exteriorPlaster: exterior, interiorPlaster: Math.max(0, item('plaster.walls', 'NetSideArea') - exterior),
    exteriorPaint: Math.min(exterior, item('paint.walls', 'NetSideArea')), mainDoors, internalDoors: Math.max(0, q.doorArea - mainDoors),
    doorCount: q.doorCount, windowFrames: q.windowArea, balconyArea, stairArea, canopy, cladding: exterior * a.claddingRatio,
    waterPipes: item('plumbing.points', 'Count') * a.waterPipeMetresPerPoint,
    drainPipes: item('plumbing.points', 'Count') * a.drainPipeMetresPerPoint,
    wires: item('electrical.points', 'Count') * a.wireMetresPerPoint,
    lights: Math.ceil(item('electrical.points', 'Count') * a.lightsPerPoint),
    tanks: (q.tanks.overheadLitres + q.tanks.undergroundLitres) / a.tankRateCapacityLitres,
    boards: design.floors.length * a.boardsPerFloor, earthing: a.earthingSets,
    foundationSide: q.total.formworkM2.footings ?? 0,
    gate: design.model.brief.rooms.priorities.compoundWall ? rules.site.gateWidthMm * rules.site.compoundHeightMm / 1e6 : 0 })
  return { extra, rooms }
}
