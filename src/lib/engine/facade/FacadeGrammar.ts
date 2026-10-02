import { rectUnionEdges, sharedEdge, type Rect } from '../../geometry.ts'
import type { BuildingModel } from '../buildingModel.ts'
import type { MassingModel } from '../massing/model.ts'
import { massRect } from '../massing/transforms.ts'
import { siteFacadeZones, interiorRoofZones } from './siteZones.ts'
import { ELEMENT_LIMITS } from './elementLimits.ts'
import { terraceFreeRatio, TERRACE_LIMITS } from '../terrace.ts'
import { uncoveredArea } from '../massing/families.ts'
import type { ArchitecturalFeature, FacadeIssue, FacadeSide, FacadeZone, FeaturePart } from './proceduralTypes.ts'

const center = (a: number, b: number) => (a + b) / 2
const overlap = (a0: number, a1: number, b0: number, b1: number) => Math.min(a1, b1) - Math.max(a0, b0)
const line = (side: FacadeSide, r: Rect) => side === 'N' ? r.y : side === 'S' ? r.y + r.h :
  side === 'W' ? r.x : r.x + r.w
const span = (side: FacadeSide, r: Rect): [number, number] => side === 'N' || side === 'S'
  ? [r.x, r.x + r.w] : [r.y, r.y + r.h]
const same = (a: number, b: number) => Math.abs(a - b) <= 2
const sideOfWall = (wall: BuildingModel['walls'][number], edges: ReturnType<typeof rectUnionEdges>) => {
  const h = same(wall.a.y, wall.b.y)
  const lo = h ? Math.min(wall.a.x, wall.b.x) : Math.min(wall.a.y, wall.b.y)
  const hi = h ? Math.max(wall.a.x, wall.b.x) : Math.max(wall.a.y, wall.b.y)
  const fixed = h ? wall.a.y : wall.a.x
  return edges.find((edge) => (edge.side === 'N' || edge.side === 'S') === h &&
    same(h ? edge.a.y : edge.a.x, fixed) &&
    overlap(lo, hi, h ? edge.a.x : edge.a.y, h ? edge.b.x : edge.b.y) >= hi - lo - 2)?.side
}

/** The complete real exterior is classified before placing any feature. */
export function buildFacadeZones(building: BuildingModel, massing: MassingModel): FacadeZone[] {
  const zones: FacadeZone[] = []
  const rooms = building.rooms
  for (const floor of building.floors) {
    const boundary = rectUnionEdges([...floor.footprint,...(floor.doubleHeightVoids??[]).map(v=>v.rect)], floor.courtyard)
    for (const wall of building.walls.filter((w) => w.floorId === floor.id && w.kind === 'exterior')) {
      const side = sideOfWall(wall, boundary)
      if (!side) continue
      const h = side === 'N' || side === 'S'
      const start = h ? Math.min(wall.a.x, wall.b.x) : Math.min(wall.a.y, wall.b.y)
      const end = h ? Math.max(wall.a.x, wall.b.x) : Math.max(wall.a.y, wall.b.y)
      const fixed = h ? wall.a.y : wall.a.x
      const host = rooms.find((r) => r.floorId === floor.id && r.id === wall.rooms?.[0])
      const touchingBalcony = rooms.some((r) => r.floorId === floor.id && r.outdoor && r.id.startsWith('balcony') &&
        host && sharedEdge(host.rect, r.rect)?.side === side &&
        same(line(side, host.rect), fixed) && overlap(start, end, ...span(side, r.rect)) > 0)
      const outX = h ? center(start, end) : fixed + (side === 'W' ? -1 : 1)
      const outY = h ? fixed + (side === 'N' ? -1 : 1) : center(start, end)
      const facesVoid = floor.courtyard && outX > floor.courtyard.x && outX < floor.courtyard.x + floor.courtyard.w &&
        outY > floor.courtyard.y && outY < floor.courtyard.y + floor.courtyard.h
      const openings = [...building.doors, ...building.windows].filter((o) => o.floorId === floor.id &&
        o.orient === (h ? 'h' : 'v') && same(h ? o.at.y : o.at.x, fixed) &&
        overlap(start, end, (h ? o.at.x : o.at.y) - o.width / 2, (h ? o.at.x : o.at.y) + o.width / 2) > 0)
      const kind = facesVoid ? 'VOID' : openings.some((o) => o.kind === 'entry') ? 'ENTRANCE' :
        touchingBalcony ? 'BALCONY' : host?.id === 'stair' ? 'STAIR_TOWER' :
          host?.zone === 'service' ? 'SERVICE' : floor.level > 0 ? 'UPPER' :
            side === building.orientation.roadPlanSide ? 'PRIMARY' : 'SECONDARY'
      const hostMassIds = massing.masses.filter((m) => m.usage === 'enclosed' && m.sourceFloorId === floor.id &&
        host && m.sourceRoomIds.includes(host.semanticId)).map((m) => m.id)
      zones.push({ id: `wall:${wall.id}`, kind, floorId: floor.id, wallId: wall.id ?? null,
        hostMassIds, roomId: host?.id ?? null, side, fixedMm: fixed, startMm: start, endMm: end,
        elevationMm: floor.elevationMm, heightMm: floor.heightMm,
        openingIds: openings.flatMap((o) => o.id ? [o.id] : []) })
    }
  }
  const top = [...building.floors].sort((a, b) => a.level - b.level).at(-1)
  if (top) {
    const roofs = massing.masses.filter((m) => m.usage === 'roof' && m.sourceFloorId === top.id)
    if (!roofs.length) for (const edge of rectUnionEdges([...top.footprint,...(top.doubleHeightVoids??[]).map(v=>v.rect)], top.courtyard)) {
      const h = edge.side === 'N' || edge.side === 'S'
      const lo = h ? edge.a.x : edge.a.y, hi = h ? edge.b.x : edge.b.y
      zones.push({ id: `slab-edge:${top.id}:${edge.side}:${h ? edge.a.y : edge.a.x}:${lo}:${hi}`, kind: 'ROOFLINE',
        floorId: top.id, wallId: null, hostMassIds: building.slabs.filter(s => s.floorId === top.id).map(s => `slab:${s.id}`),
        roomId: null, side: edge.side, fixedMm: h ? edge.a.y : edge.a.x, startMm: lo, endMm: hi,
        elevationMm: top.elevationMm + top.heightMm, heightMm: 1800, openingIds: [] })
    }
    for (const edge of rectUnionEdges(roofs.map(massRect))) {
      const side = edge.side
      const h = side === 'N' || side === 'S'
      const start = h ? edge.a.x : edge.a.y
      const end = h ? edge.b.x : edge.b.y
      const fixed = h ? edge.a.y : edge.a.x
      for (const host of roofs.filter((m) => same(line(side, massRect(m)), fixed) &&
        overlap(start, end, ...span(side, massRect(m))) > 0)) {
        const [a, b] = span(side, massRect(host))
        const lo = Math.max(start, a), hi = Math.min(end, b)
        zones.push({ id: `roof:${host.id}:${side}:${lo}:${hi}`, kind: 'ROOFLINE',
          floorId: top.id, wallId: null, hostMassIds: [host.id], roomId: null,
          side, fixedMm: fixed, startMm: lo, endMm: hi,
          elevationMm: host.elevation + host.height, heightMm: 1800, openingIds: [] })
      }
    }
  }
  return [...zones, ...interiorRoofZones(zones), ...siteFacadeZones(building)]
}

/** Every absolute box is derived from local face coordinates and an outward normal. */
export function worldPart(zone: FacadeZone, id: string, role: FeaturePart['role'],
  u0Mm: number, u1Mm: number, z0Mm: number, z1Mm: number, offsetMm: number, depthMm: number): FeaturePart {
  const fixed = zone.fixedMm
  const world = zone.side === 'N' ? { x: u0Mm, y: fixed - offsetMm - depthMm, w: u1Mm - u0Mm, h: depthMm } :
    zone.side === 'S' ? { x: u0Mm, y: fixed + offsetMm, w: u1Mm - u0Mm, h: depthMm } :
      zone.side === 'W' ? { x: fixed - offsetMm - depthMm, y: u0Mm, w: depthMm, h: u1Mm - u0Mm } :
        { x: fixed + offsetMm, y: u0Mm, w: depthMm, h: u1Mm - u0Mm }
  return { id, zoneId: zone.id, role, u0Mm, u1Mm, z0Mm, z1Mm, offsetMm, depthMm,
    world: { ...world, z: z0Mm, height: z1Mm - z0Mm } }
}

/** Solid wall spans with openings and columns reserved, even before 3D geometry exists. */
export function freeFacadeSpans(zone: FacadeZone, building: BuildingModel, clearanceMm = 180): [number, number][] {
  let free: [number, number][] = [[zone.startMm + 100, zone.endMm - 100]]
  const h = zone.side === 'N' || zone.side === 'S'
  const cuts = [...building.doors, ...building.windows].filter((o) => o.floorId === zone.floorId &&
    o.orient === (h ? 'h' : 'v') && same(h ? o.at.y : o.at.x, zone.fixedMm))
    .map((o): [number, number] => [(h ? o.at.x : o.at.y) - o.width / 2 - clearanceMm,
      (h ? o.at.x : o.at.y) + o.width / 2 + clearanceMm])
  for (const c of building.columns.filter((c) => c.floorId === zone.floorId &&
    same(h ? c.at.y : c.at.x, zone.fixedMm))) {
    const at = h ? c.at.x : c.at.y
    cuts.push([at - c.size / 2 - clearanceMm, at + c.size / 2 + clearanceMm])
  }
  for (const [a, b] of cuts) free = free.flatMap(([lo, hi]): [number, number][] =>
    b <= lo || a >= hi ? [[lo, hi]] : [[lo, Math.min(hi, a)], [Math.max(lo, b), hi]]
      .filter(([x, y]) => y > x) as [number, number][])
  return free.filter(([a, b]) => b - a >= 400)
}

/** Checks anchors, world derivation, boundaries, existing openings and size. */
export function validateProceduralFeatures(building: BuildingModel, massing: MassingModel,
  zones: FacadeZone[], features: ArchitecturalFeature[]): FacadeIssue[] {
  const issues: FacadeIssue[] = []
  const add = (code: string, message: string, featureId?: string, zoneId?: string) =>
    issues.push({ code, message, ...(featureId ? { featureId } : {}), ...(zoneId ? { zoneId } : {}) })
  const zoneIds = new Set(zones.map((z) => z.id))
  if (zoneIds.size !== zones.length) add('DUPLICATE_ZONE', 'Exterior zone IDs must be unique.')
  for (const z of zones) {
    const siteHost = z.anchorKind === 'gate' || z.anchorKind === 'pool-sitout'
      ? siteFacadeZones(building).some(expected => JSON.stringify(expected) === JSON.stringify(z)) : false
    const host = siteHost || (z.wallId ? building.walls.some((w) => w.id === z.wallId && w.floorId === z.floorId && w.kind === 'exterior') :
      z.hostMassIds.some((id) => massing.masses.some((m) => m.id === id && m.usage === 'roof') ||
        building.slabs.some(s => `slab:${s.id}` === id && s.floorId === z.floorId))
    )
    if (!host || z.endMm <= z.startMm || z.heightMm <= 0)
      add('INVALID_ZONE_HOST', 'Facade zone lacks real exterior geometry.', undefined, z.id)
    if (z.anchorKind === 'roof-interior' && !interiorRoofZones(zones).some(expected => JSON.stringify(expected) === JSON.stringify(z)))
      add('INVALID_ZONE_HOST', 'Inward roof anchor must derive from a real roof edge.', undefined, z.id)
  }
  const ground = [...building.floors].sort((a, b) => a.level - b.level)[0]
  const porches = ground ? building.rooms.filter((room) => room.floorId === ground.id && room.outdoor &&
    (room.id === 'parking' || room.id === 'verandah'))
    // the roof slab (200 mm under the first floor level) and the rail above it;
    // a portal or screen standing under the porch roof is fine
    .map((room) => ({ rect: room.rect, z0: ground.elevationMm + ground.heightMm - 220, z1: ground.elevationMm + ground.heightMm + 1100 })) : []
  const heroes = features.filter((f) => f.importance === 'hero')
  if (heroes.length !== 1 || features.length > 3 || features.some((f) => f.importance === 'support' && f.parts.length === 0))
    add('FEATURE_BUDGET', 'A facade needs one hero and at most two supporting features.')
  const partIds = new Set<string>()
  for (const feature of features) {
    if (!feature.parts.length) add('EMPTY_FEATURE', 'Feature has no geometric parts.', feature.id)
    for (const zoneId of feature.zoneIds) if (!zoneIds.has(zoneId))
      add('UNANCHORED_FEATURE', 'Feature declares a missing facade zone.', feature.id, zoneId)
    if (feature.importance === 'hero' && !feature.parts.some((p) => p.offsetMm + p.depthMm >= 300))
      add('NO_SILHOUETTE', 'Hero must project enough to alter the exterior silhouette.', feature.id)
    for (const part of feature.parts) {
      if (partIds.has(part.id)) add('DUPLICATE_PART', 'Feature part IDs must be unique.', feature.id)
      partIds.add(part.id)
      const zone = zones.find((z) => z.id === part.zoneId)
      if (!zone || !feature.zoneIds.includes(part.zoneId)) { add('UNANCHORED_PART', 'Feature part lacks its declared facade zone.', feature.id, part.zoneId); continue }
      const nums = [part.u0Mm, part.u1Mm, part.z0Mm, part.z1Mm, part.offsetMm, part.depthMm]
      const bridge = feature.type === 'BRIDGE_VOLUME' && feature.zoneIds.length === 2 &&
        feature.zoneIds.some((id) => id !== zone.id && zones.some((other) => other.id === id &&
          other.side === zone.side && same(other.fixedMm, zone.fixedMm) &&
          overlap(part.u0Mm, part.u1Mm, other.startMm, other.endMm) >= 200 &&
          part.u0Mm >= Math.min(zone.startMm, other.startMm) - 2 &&
          part.u1Mm <= Math.max(zone.endMm, other.endMm) + 2)) &&
        overlap(part.u0Mm, part.u1Mm, zone.startMm, zone.endMm) >= 200
      if (!nums.every(Number.isFinite) || part.u1Mm <= part.u0Mm || part.z1Mm <= part.z0Mm ||
        part.offsetMm < 0 || part.depthMm <= 0 ||
        (!bridge && (part.u0Mm < zone.startMm - 2 || part.u1Mm > zone.endMm + 2)) ||
        part.z0Mm < zone.elevationMm - 2 || part.z1Mm > zone.elevationMm + zone.heightMm + 2) {
        add('INVALID_PART', 'Part lies outside its host facade span or has invalid dimensions.', feature.id, zone.id)
        continue
      }
      const derived = worldPart(zone, part.id, part.role, part.u0Mm, part.u1Mm,
        part.z0Mm, part.z1Mm, part.offsetMm, part.depthMm)
      if ((['x', 'y', 'z', 'w', 'h', 'height'] as const).some((key) => derived.world[key] !== part.world[key]))
        add('ARBITRARY_COORDINATES', 'World geometry does not derive from the declared facade anchor.', feature.id, zone.id)
      const r = part.world
      const env = zone.anchorKind === 'gate' ? { x: 0, y: 0, w: building.plot.widthMm, h: building.plot.depthMm } : building.plot.buildable
      if (r.x < env.x - 1 || r.y < env.y - 1 || r.x + r.w > env.x + env.w + 1 ||
        r.y + r.h > env.y + env.h + 1)
        add('FEATURE_SETBACK', 'Projected feature crosses the source setback envelope.', feature.id, zone.id)
      for (const mass of massing.masses.filter((m) => m.usage !== 'terrace')) {
        const mr = massRect(mass)
        if (overlap(r.x, r.x + r.w, mr.x, mr.x + mr.w) > 1 &&
          overlap(r.y, r.y + r.h, mr.y, mr.y + mr.h) > 1 &&
          overlap(r.z, r.z + r.height, mass.elevation, mass.elevation + mass.height) > 1)
          add('FEATURE_MASS_COLLISION', 'Projected feature intersects an existing building volume.', feature.id, zone.id)
      }
      // a covered car porch / verandah gets a roof on posts (with a balcony
      // rail on top) in the 3D model: its storey and the rail above stay clear
      // (a double-height entrance frame rises through the porch roof, which
      // the 3D model cuts around it)
      for (const porch of feature.type === 'DOUBLE_HEIGHT_PORTAL' ? [] : porches) {
        if (overlap(r.x, r.x + r.w, porch.rect.x, porch.rect.x + porch.rect.w) > 1 &&
          overlap(r.y, r.y + r.h, porch.rect.y, porch.rect.y + porch.rect.h) > 1 &&
          overlap(r.z, r.z + r.height, porch.z0, porch.z1) > 1)
          add('FEATURE_PORCH_COLLISION', 'Feature intersects a covered porch roof or its rail.', feature.id, zone.id)
      }
      for (const column of building.columns) {
        const floor = building.floors.find((f) => f.id === column.floorId)
        if (!floor) continue
        const half = column.size / 2
        if (overlap(r.x, r.x + r.w, column.at.x - half, column.at.x + half) > 1 &&
          overlap(r.y, r.y + r.h, column.at.y - half, column.at.y + half) > 1 &&
          overlap(r.z, r.z + r.height, floor.elevationMm, floor.elevationMm + floor.heightMm) > 1)
          add('FEATURE_COLUMN_COLLISION', 'Projected feature intersects an existing column.', feature.id, zone.id)
      }
      const h = zone.side === 'N' || zone.side === 'S'
      for (const opening of [...building.doors, ...building.windows].filter((o) =>
        o.orient === (h ? 'h' : 'v') && same(h ? o.at.y : o.at.x, zone.fixedMm))) {
        const floor = building.floors.find((f) => f.id === opening.floorId)
        if (!floor) continue
        const at = h ? opening.at.x : opening.at.y
        const low = floor.elevationMm + (opening.kind === 'window' ? opening.sill ?? 850 : 0)
        const high = floor.elevationMm + Math.min(opening.head ?? (opening.kind === 'window' ? 2600 : 2500), floor.heightMm - 120)
        const glazing = opening.kind === 'window' && part.role === 'glass' && feature.type === 'BAY_WINDOW' &&
          zone.openingIds.includes(opening.id!) && part.u0Mm >= at-opening.width/2 && part.u1Mm <= at+opening.width/2 &&
          part.z0Mm >= low && part.z1Mm <= high && part.materialHint === 'glass'
        const screen = opening.kind === 'window' && feature.type === 'PERFORATED_BRICK_WALL' &&
          part.role === 'screen' && part.offsetMm >= ELEMENT_LIMITS.screenOffsetMm
        if (!glazing && !screen && overlap(part.u0Mm, part.u1Mm, at - opening.width / 2, at + opening.width / 2) > 1 &&
          overlap(part.z0Mm, part.z1Mm, low, high) > 1)
          add('FEATURE_OPENING_COLLISION', 'Feature intersects a door or window opening.', feature.id, zone.id)
      }
      if (zone.anchorKind === 'roof-interior' && uncoveredArea([r], building.floors.find(f => f.id === zone.floorId)!.footprint) > 1)
        add('ROOF_SUPPORT', 'Roof element must remain on the actual walkable slab.', feature.id, zone.id)
      if (zone.anchorKind === 'pool-sitout') {
        const sit = building.siteFeatures?.find(f => f.id === zone.sourceSiteId)
        if (!sit || uncoveredArea([r],[sit.rect]) > 1)
          add('PAVILION_HOST', 'Pool pavilion must stay on its source sit-out.', feature.id, zone.id)
      }
    }
  }
  const screenFeatures = features.filter(f => f.type === 'PERFORATED_BRICK_WALL')
  for (const feature of screenFeatures) for (const id of feature.zoneIds) {
    const zone = zones.find(z => z.id === id)
    if (!zone) continue
    for (const opening of building.windows.filter(w => zone.openingIds.includes(w.id!))) {
      const floor = building.floors.find(f => f.id === opening.floorId)!
      const at = zone.side === 'N' || zone.side === 'S' ? opening.at.x : opening.at.y
      const low = floor.elevationMm + (opening.sill ?? 850), high = floor.elevationMm + (opening.head ?? 2600)
      const occlusion = feature.parts.reduce((sum,p) => sum + Math.max(0,overlap(p.u0Mm,p.u1Mm,at-opening.width/2,at+opening.width/2)) * Math.max(0,overlap(p.z0Mm,p.z1Mm,low,high)),0)
      if (occlusion / (opening.width * (high-low)) > ELEMENT_LIMITS.maximumScreenOcclusion)
        add('SCREEN_OCCLUSION', 'Brick screen obscures too much of the source window.', feature.id, zone.id)
    }
  }
  if (building.roofTerrace) {
    const parts = features.flatMap(f => f.parts).filter(p => zones.find(z => z.id === p.zoneId)?.anchorKind === 'roof-interior')
    const floorLevel = [...building.floors].sort((a,b) => a.level-b.level).at(-1)!
    const top = floorLevel.elevationMm + floorLevel.heightMm
    const services = [building.roofTerrace.mumty,building.roofTerrace.tank].filter(r => r !== null)
    for (const p of parts) if (services.some(r => overlap(p.world.x,p.world.x+p.world.w,r.x-300,r.x+r.w+300)>0 && overlap(p.world.y,p.world.y+p.world.h,r.y-300,r.y+r.h+300)>0))
      add('TERRACE_SERVICE_COLLISION','Roof element blocks the stair enclosure or tank.',undefined,p.zoneId)
    if (terraceFreeRatio(building.roofTerrace,parts.filter(p => p.world.z < top + ELEMENT_LIMITS.roofHeadroomMm).map(p=>p.world)) < TERRACE_LIMITS.minFreeRatio)
      add('TERRACE_FREE_AREA','Roof elements leave less than 80% usable terrace.')
  }
  for (let i = 0; i < features.length; i++) for (let j = i + 1; j < features.length; j++) {
    for (const a of features[i].parts) for (const b of features[j].parts) {
      const x = overlap(a.world.x, a.world.x + a.world.w, b.world.x, b.world.x + b.world.w)
      const y = overlap(a.world.y, a.world.y + a.world.h, b.world.y, b.world.y + b.world.h)
      const z = overlap(a.world.z, a.world.z + a.world.height, b.world.z, b.world.z + b.world.height)
      if (x > 1 && y > 1 && z > 1)
        add('FEATURE_INTERSECTION', 'Two selected architectural features intersect.', features[j].id, b.zoneId)
    }
  }
  return issues
}

export class FacadeGrammar {
  static buildZones = buildFacadeZones
  static freeSpans = freeFacadeSpans
  static worldPart = worldPart
  static validate = validateProceduralFeatures
}
