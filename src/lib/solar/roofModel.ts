import { z } from 'zod'
import { solarAllocationPolicySchema } from './policy.ts'
export { solarAllocationPolicySchema } from './policy.ts'
import type { Rect, BoundaryEdge } from '../geometry.ts'
import { rectUnionBBox, rectUnionEdges } from '../geometry.ts'
import type { Design } from '../engine/types.ts'
import { createBuildingModel, type BuildingModel } from '../engine/buildingModel.ts'
import type { MassingModel } from '../engine/massing/model.ts'
import type { ProceduralFacadeModel } from '../engine/facade/proceduralTypes.ts'
import type { VillaDesignDNA } from '../engine/villaDesignDna.ts'
import { massRect } from '../engine/massing/transforms.ts'
import { tankBank, TERRACE_LIMITS } from '../engine/terrace.ts'
import { fnv } from '../engine/massing/rng.ts'
import { solarInputsSchema, type SolarInputs } from '../model/solar.ts'
import { realizedTerraceObjects } from './terraceObjects.ts'
import { connectedRegions, containsPoint, edgeBand, expandRect, insetRegions, intersectRegions,
  portal, regionAreaM2, subtractRegions } from './regions.ts'

/** These are editable planning assumptions, never statutory/structural installation limits. */
export type SolarAllocationPolicy = z.infer<typeof solarAllocationPolicySchema>
export type SolarRoofArchitecture = {
  buildingModel: BuildingModel; massingModel: MassingModel
  facadeGrammar: ProceduralFacadeModel; villaDesignDNA: Pick<VillaDesignDNA, 'roofType'>
}
export type RoofSurfaceKind = 'flat-top-roof' | 'lower-terrace' | 'balcony' | 'canopy' | 'pergola' | 'sloping-roof' | 'roof-envelope'
export type ExclusionKind = 'courtyard' | 'double-height' | 'shaft' | 'skylight' | 'roof-opening' | 'upper-storey' |
  'stair-headroom' | 'parapet' | 'tank-bank' | 'terrace-object' | 'decorative-feature' | 'roof-envelope' | 'reserved-area' | 'protected-access' | 'edge-clearance' | 'access-unreachable'
export type SolarRoofExclusion = {
  id: string; kind: ExclusionKind; regionsMm: Rect[]; clearanceMm: number; reason: string
  bottomMm?: number; topMm?: number
}
export type RoofIssue = { code: string; message: string }
export type SolarRoofSurface = {
  id: string; floorId: string; level: number; kind: RoofSurfaceKind; elevationMm: number
  grossRegionsMm: Rect[]; holes: SolarRoofExclusion[]; regionsMm: Rect[]; edges: BoundaryEdge[]
  obstacles: SolarRoofExclusion[]; exclusions: SolarRoofExclusion[]
  components: { id: string; regionsMm: Rect[]; access: 'modeled' | 'unreachable' | 'unknown' }[]
  access: { status: 'modeled' | 'unavailable' | 'unknown'; entryMm: { x: number; y: number } | null; protectedRegionsMm: Rect[] }
  status: 'concept-usable' | 'excluded' | 'uncertain' | 'no-usable-area'; issues: RoofIssue[]
  usableRegionsMm: Rect[]; roofAreaM2: number; accessibleClearAreaM2: number; usableAreaM2: number; maxSolarFootprintAreaM2: number
}
export type SolarRoofModel = {
  schemaVersion: 1; sourcePlanId: string; roofSignature: string; allocationSignature: string
  allocationInputsSignature: string
  coordinates: 'plan-x-east-y-south-z-up'; units: 'mm'; policy: SolarAllocationPolicy
  orientation: { planNorthBearingDeg: number | null; status: 'unknown' | 'user-provided' }
  surfaces: SolarRoofSurface[]; usableAreaM2: number; maxSolarFootprintAreaM2: number; issues: RoofIssue[]
  qualification: string
}
const rectSchema = z.strictObject({ x: z.number().finite(), y: z.number().finite(), w: z.number().finite().positive(), h: z.number().finite().positive() })
const openingsSchema = z.array(z.strictObject({
  id: z.string().min(1).max(160), level: z.number().int().min(0).max(20),
  kind: z.enum(['skylight', 'roof-opening']), rectMm: rectSchema,
})).max(200).refine(values => new Set(values.map(v => v.id)).size === values.length, 'Opening IDs must be unique')
export type SolarRoofOptions = {
  /** Accepted architecture is needed before marking any source region usable. */
  architecture?: SolarRoofArchitecture
  inputs?: SolarInputs
  policy?: z.input<typeof solarAllocationPolicySchema>
  /** Explicitly represented openings only. No skylights are invented from windows. */
  roofOpenings?: z.input<typeof openingsSchema>
}
function token(prefix: string, value: unknown) {
  const text = JSON.stringify(value)
  return `${prefix}-${fnv(text).toString(16).padStart(8, '0')}${fnv(`${prefix}|${text}`).toString(16).padStart(8, '0')}`
}
export function solarRoofInputsSignature(inputs: SolarInputs) {
  return token('solar-roof-inputs-v1', [inputs.orientation.planNorthBearingDeg, inputs.placement.edgeClearanceMm,
    [...inputs.reservedAreas].sort((a, b) => a.id.localeCompare(b.id))])
}
function exclusion(id: string, kind: ExclusionKind, regionsMm: Rect[], reason: string, clearanceMm = 0): SolarRoofExclusion {
  return { id, kind, regionsMm: subtractRegions(regionsMm), clearanceMm, reason }
}
const area = (regions: Rect[]) => regionAreaM2(regions)
const overlaps = (a: Rect[], b: Rect[]) => intersectRegions(a, b).length > 0
const physicalKinds = new Set<ExclusionKind>(['stair-headroom', 'parapet', 'tank-bank', 'terrace-object', 'decorative-feature', 'roof-envelope'])

type P = { x: number; y: number }
/** Walking centre-space is eroded by half the route width before connectivity is tested.
 * Thus a narrow neck cannot falsely join two areas through a wide source rectangle. */
function accessGraph(base: Rect[], obstacles: Rect[], reservations: Rect[], entry: P, width: number) {
  const free = subtractRegions(insetRegions(base, width / 2), [...obstacles, ...reservations].map(r => expandRect(r, width / 2)))
  const root = free.findIndex(r => containsPoint(r, entry))
  const parent = new Map<number, { previous: number; through: P }>(), reachable = new Set<number>()
  if (root >= 0) {
    const queue = [root]; reachable.add(root)
    for (let i = 0; i < queue.length; i++) for (let j = 0; j < free.length; j++) {
      if (reachable.has(j)) continue
      const through = portal(free[queue[i]], free[j])
      if (through) { reachable.add(j); queue.push(j); parent.set(j, { previous: queue[i], through }) }
    }
  }
  const route = (target: P): Rect[] | null => {
    const found = [...reachable].find(index => containsPoint(free[index], target))
    if (found === undefined) return null
    let node: number = found
    const points = [target]
    while (node !== root) { const edge: { previous: number; through: P } = parent.get(node)!; points.push(edge.through); node = edge.previous }
    points.push(entry); points.reverse()
    const bands: Rect[] = []
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i], b = points[i + 1], half = width / 2
      // Each leg stays inside its convex centre-space rectangle.
      bands.push({ x: Math.min(a.x, b.x) - half, y: a.y - half, w: Math.abs(a.x - b.x) + width, h: width },
        { x: b.x - half, y: Math.min(a.y, b.y) - half, w: width, h: Math.abs(a.y - b.y) + width })
    }
    return subtractRegions(bands)
  }
  return { free, reachable, route }
}

function allocate(surface: SolarRoofSurface, building: BuildingModel, inputs: SolarInputs, policy: SolarAllocationPolicy) {
  const base = surface.regionsMm
  const physical = surface.obstacles.filter(o => physicalKinds.has(o.kind)).flatMap(o => o.regionsMm)
  const relevant = inputs.reservedAreas.filter(r => r.level === surface.level && (!r.roofSurfaceId || r.roofSurfaceId === surface.id || surface.components.some(c => c.id === r.roofSurfaceId)))
  const reservations = relevant.map(r => r.rectMm)
  const unknownRefs = inputs.reservedAreas.filter(r => r.level === surface.level && r.roofSurfaceId && r.roofSurfaceId !== surface.id && !surface.components.some(c => c.id === r.roofSurfaceId))
  if (unknownRefs.length) {
    surface.status = 'uncertain'
    surface.issues.push({ code: 'RESERVATION_SURFACE_CHANGED', message: 'A reserved area references a different roof surface. Review the reservation before allocating panels.' })
    return
  }
  for (const r of relevant) surface.exclusions.push(exclusion(`reserved:${r.id}`, 'reserved-area', intersectRegions(base, [r.rectMm]), 'User-reserved space; kept free of panels and new access routes.'))
  const edgeCuts = policy.edgeClearanceMm > 0 ? surface.edges.map(e => edgeBand(e, policy.edgeClearanceMm)) : []
  surface.exclusions.push(exclusion('edge-clearance', 'edge-clearance', intersectRegions(base, edgeCuts), 'Concept clearance from every outer edge and opening boundary.'))
  const blocked = surface.obstacles.flatMap(o => o.regionsMm.map(r => expandRect(r, o.clearanceMm)))
  let candidates = subtractRegions(base, [...blocked, ...edgeCuts, ...reservations])
  if (!candidates.length) {
    surface.status = 'no-usable-area'; surface.issues.push({ code: 'ROOF_FULLY_EXCLUDED', message: 'Obstacles, edge clearances or reserved space leave no usable roof area.' }); return
  }
  const terrace = building.roofTerrace, stair = building.stairs.find(s => s.floorId === surface.floorId)
  const mumty = surface.obstacles.find(o => o.kind === 'stair-headroom')?.regionsMm[0]
  if (!terrace || !stair || !mumty) {
    surface.status = 'uncertain'
    surface.issues.push({ code: 'ROOF_ACCESS_UNKNOWN', message: 'A modeled stair and headroom exit are required. No ladder or access route is assumed.' }); return
  }
  // roof_services.py puts a 900 mm opening on startSide (N when unspecified).
  const side = stair.startSide ?? 'N', width = policy.accessWidthMm
  if (width > 900) {
    surface.status = 'uncertain'; surface.issues.push({ code: 'ACCESS_EXCEEDS_DOOR', message: 'The requested route is wider than the modeled 900 mm roof exit.' }); return
  }
  const nx = side === 'E' ? 1 : side === 'W' ? -1 : 0, ny = side === 'S' ? 1 : side === 'N' ? -1 : 0
  const door = { x: side === 'E' ? mumty.x + mumty.w : side === 'W' ? mumty.x : mumty.x + mumty.w / 2,
    y: side === 'S' ? mumty.y + mumty.h : side === 'N' ? mumty.y : mumty.y + mumty.h / 2 }
  const entry = { x: door.x + nx * (width / 2 + 1), y: door.y + ny * (width / 2 + 1) }
  const approach = nx ? { x: Math.min(door.x, door.x + nx * (width + 1)), y: door.y - width / 2, w: width + 1, h: width } :
    { x: door.x - width / 2, y: Math.min(door.y, door.y + ny * (width + 1)), w: width, h: width + 1 }
  if (subtractRegions([approach], base).length || overlaps([approach], [...physical, ...reservations])) {
    surface.status = 'uncertain'; surface.access.status = 'unavailable'
    surface.issues.push({ code: 'ROOF_EXIT_BLOCKED', message: 'The headroom exit has no clear full-width approach on this roof.' }); return
  }
  const graph = accessGraph(base, physical, reservations, entry, width)
  if (!graph.reachable.size) {
    surface.status = 'uncertain'; surface.access.status = 'unavailable'
    surface.issues.push({ code: 'ACCESS_ROUTE_BLOCKED', message: 'A continuous maintenance route cannot be established from the roof exit.' }); return
  }
  surface.access = { status: 'modeled', entryMm: door, protectedRegionsMm: [] }
  const centerRegions = [...graph.reachable].map(i => graph.free[i]), protectedRoutes: Rect[] = [approach], reachableCandidates: Rect[] = []
  for (const component of surface.components) component.access = overlaps(component.regionsMm, centerRegions) ? 'modeled' : 'unreachable'
  for (const group of connectedRegions(candidates)) {
    const target = intersectRegions(group, centerRegions).sort((a, b) => b.w * b.h - a.w * a.h)[0]
    const route = target && graph.route({ x: target.x + target.w / 2, y: target.y + target.h / 2 })
    if (route) { protectedRoutes.push(...route); reachableCandidates.push(...group) }
    else surface.exclusions.push(exclusion(token('unreachable', group), 'access-unreachable', group, 'No continuous full-width route from the modeled roof exit.'))
  }
  // A free rectangle beside the tank is not enough: preserve a connected approach to it.
  for (const tank of surface.obstacles.filter(o => o.kind === 'tank-bank').flatMap(o => o.regionsMm)) {
    const half = width / 2 + 1
    const targets = [{ x: tank.x - half, y: tank.y + tank.h / 2 }, { x: tank.x + tank.w + half, y: tank.y + tank.h / 2 },
      { x: tank.x + tank.w / 2, y: tank.y - half }, { x: tank.x + tank.w / 2, y: tank.y + tank.h + half }]
    const route = targets.map(p => graph.route(p)).find(Boolean)
    if (!route) {
      surface.status = 'uncertain'; surface.issues.push({ code: 'TANK_MAINTENANCE_BLOCKED', message: 'The full tank bank has no connected full-width maintenance approach.' }); return
    }
    protectedRoutes.push(...route)
  }
  // Validate routing itself against actual surfaces and physical obstructions.
  const routes = subtractRegions(protectedRoutes)
  if (subtractRegions(routes, base).length || overlaps(routes, [...physical, ...reservations])) {
    surface.status = 'uncertain'; surface.issues.push({ code: 'ROUTE_GEOMETRY_UNCERTAIN', message: 'The proposed access corridor could not be validated against the roof geometry.' }); return
  }
  surface.access.protectedRegionsMm = routes
  surface.exclusions.push(exclusion('protected-access', 'protected-access', routes, 'Continuous concept access from the headroom exit to usable regions and the full tank bank.'))
  candidates = subtractRegions(reachableCandidates, routes)
  surface.usableAreaM2 = area(candidates)
  // Only reachable clear roof contributes to the budget: an inaccessible island
  // must not subsidize full solar coverage on the one accessible terrace.
  const reachableClear = intersectRegions(base, centerRegions.map(r => expandRect(r, width / 2)))
  surface.accessibleClearAreaM2 = area(reachableClear)
  surface.maxSolarFootprintAreaM2 = Math.max(0, Math.min(surface.usableAreaM2,
    surface.accessibleClearAreaM2 * (1 - policy.minFreeTerraceRatio)))
  if (surface.maxSolarFootprintAreaM2 <= 1e-9 || !candidates.length) {
    surface.status = 'no-usable-area'; surface.issues.push({ code: 'SOLAR_ALLOCATION_EMPTY', message: 'Protected access and the separate solar free-space policy leave no installation allocation.' })
    surface.usableAreaM2 = 0; surface.maxSolarFootprintAreaM2 = 0
  } else { surface.usableRegionsMm = candidates; surface.status = 'concept-usable' }
  if (surface.components.some(c => c.access === 'unreachable')) surface.issues.push({ code: 'DISCONNECTED_ROOF_REGION', message: 'Roof islands without a continuous full-width access route are excluded.' })
}

/** Pure, serializable downstream model. Never written into BuildingModel or seed inputs. */
export function buildSolarRoofModel(design: Design, options: SolarRoofOptions = {}): SolarRoofModel {
  const source = createBuildingModel(design), arch = options.architecture, building = arch?.buildingModel ?? source
  const inputs = solarInputsSchema.parse(options.inputs ?? design.model.brief.solar?.inputs ?? {})
  const parsedPolicy = solarAllocationPolicySchema.parse(options.policy ?? {})
  const policy = { ...parsedPolicy, edgeClearanceMm: inputs.placement.edgeClearanceMm ?? parsedPolicy.edgeClearanceMm }
  const openings = openingsSchema.parse(options.roofOpenings ?? [])
  const floors = [...building.floors].sort((a, b) => a.level - b.level), top = floors.at(-1)
  const surfaces: SolarRoofSurface[] = [], modelIssues: RoofIssue[] = []
  const matched = arch && building.planId === source.planId && arch.massingModel.sourcePlanId === source.planId && arch.facadeGrammar.sourcePlanId === source.planId && arch.massingModel.seed === arch.facadeGrammar.massingSeed
  const ready = Boolean(matched && arch?.massingModel.status === 'valid' && arch.facadeGrammar.status === 'valid')
  if (!ready) modelIssues.push({ code: arch ? 'ARCHITECTURE_SOURCE_UNCERTAIN' : 'ARCHITECTURE_DETAILS_REQUIRED', message: 'Matching accepted roof, massing and facade geometry is required before any region is marked usable.' })
  const createSurface = (id: string, floorId: string, level: number, kind: RoofSurfaceKind, elevationMm: number, rects: Rect[], holes: SolarRoofExclusion[] = []): SolarRoofSurface => {
    const gross = subtractRegions(rects), regions = subtractRegions(gross, holes.flatMap(h => h.regionsMm))
    const surface: SolarRoofSurface = { id, floorId, level, kind, elevationMm, grossRegionsMm: gross, holes, regionsMm: regions,
      edges: rectUnionEdges(regions), obstacles: [], exclusions: [...holes],
      components: connectedRegions(regions).map(group => ({ id: `${id}:${token('island', group)}`, regionsMm: group, access: 'unknown' })),
      access: { status: 'unknown', entryMm: null, protectedRegionsMm: [] },
      status: 'excluded', issues: [], usableRegionsMm: [], roofAreaM2: area(regions), accessibleClearAreaM2: 0, usableAreaM2: 0, maxSolarFootprintAreaM2: 0 }
    surfaces.push(surface); return surface
  }
  for (const floor of floors) {
    const elevation = floor.elevationMm + floor.heightMm
    const holes: SolarRoofExclusion[] = [
      ...(floor.courtyard ? [exclusion(`${floor.id}:court`, 'courtyard', [floor.courtyard], 'Source courtyard remains open.')] : []),
      ...(floor.doubleHeightVoids ?? []).map((v, i) => exclusion(`${floor.id}:double-height:${i}`, 'double-height', [v.rect], 'Double-height area excluded even where the renderer supplies an upper ceiling cap; suitability is unverified.')),
      ...building.shafts.filter(s => s.floorId === floor.id).map(s => exclusion(s.id, 'shaft', [s.rect], 'Represented shaft/opening.')),
      ...openings.filter(o => o.level === floor.level).map(o => exclusion(o.id, o.kind, [o.rectMm], 'Explicitly represented roof opening.')),
    ]
    if (floor !== top) {
      const above = floors[floors.indexOf(floor) + 1]
      const covered = [...above.footprint, ...(above.doubleHeightVoids ?? []).map(v => v.rect)]
      const balconyRooms = building.rooms.filter(r => r.floorId === above.id && r.outdoor && r.id.startsWith('balcony'))
      const lower = createSurface(`roof:${floor.id}:lower`, floor.id, floor.level, 'lower-terrace', elevation, floor.footprint,
        [...holes, exclusion(`${above.id}:occupied`, 'upper-storey', covered, 'Covered by the next storey or its double-height ceiling.'),
          ...balconyRooms.map(r => exclusion(r.semanticId, 'reserved-area', [r.rect], 'Source balcony is classified separately.'))])
      lower.issues.push({ code: 'LOWER_TERRACE_UNSUPPORTED', message: 'Exposed lower roof classified separately; solar support, access and loading are not established.' })
      continue
    }
    const sourceKind = design.floors.find(f => f.level === floor.level)?.roof.kind
    const roofType = arch?.villaDesignDNA.roofType
    const sloping = roofType ? ['gable', 'hip', 'mono-slope'].includes(roofType) : !['flat', 'flat-parapet'].includes(sourceKind ?? '')
    const surface = createSurface(`roof:${floor.id}:top`, floor.id, floor.level, sloping ? 'sloping-roof' : 'flat-top-roof', elevation, floor.footprint, holes)
    if (sloping) { surface.issues.push({ code: 'SLOPING_ROOF_UNSUPPORTED', message: 'Sloping roof geometry is outside flat-roof solar support.' }); continue }
    if (arch && !['flat-terrace', 'raised-parapet', 'pergola-terrace'].includes(roofType ?? '')) {
      surface.status = 'uncertain'; surface.issues.push({ code: 'ROOF_FORM_UNKNOWN', message: 'The realized roof form is not an explicitly supported flat roof.' }); continue
    }
    const terrace = building.roofTerrace
    if (terrace?.mumty) {
      // Roof-service walls are centred on mumty edges, 120 mm thick.
      const headroom = exclusion('headroom', 'stair-headroom', [expandRect(terrace.mumty, 60)], 'Full headroom walls and cap, including wall thickness.', policy.obstacleClearanceMm)
      headroom.bottomMm = elevation; headroom.topMm = elevation + 2320; surface.obstacles.push(headroom)
    }
    const bank = terrace ? tankBank(terrace) : null
    if (bank) {
      const tank = exclusion('tank-bank', 'tank-bank', [bank], 'Realized tank-bank tray/stand extent from tankBank, not the original single-tank slot.', policy.obstacleClearanceMm)
      tank.bottomMm = elevation; tank.topMm = elevation + 2000; surface.obstacles.push(tank)
    }
    for (const object of realizedTerraceObjects(building)) {
      const extent = object.kind === 'planter' ? expandRect(object.rectMm, 180) : object.rectMm
      const furniture = exclusion(object.id, 'terrace-object', [extent], `Existing exported terrace ${object.kind}; full footprint retained${object.kind === 'planter' ? ' with a conservative foliage envelope' : ''}.`, policy.obstacleClearanceMm)
      furniture.bottomMm = elevation; furniture.topMm = elevation + object.heightMm; surface.obstacles.push(furniture)
    }
    const guards = surface.edges.map(e => edgeBand(e, TERRACE_LIMITS.parapetThicknessMm))
    surface.obstacles.push(exclusion('parapets', 'parapet', intersectRegions(surface.regionsMm, guards), 'Conservative source parapet footprint on outer and opening edges.'))
    const addWorld = (id: string, boxes: (Rect & { z: number; height: number })[], kind: 'decorative-feature' | 'roof-envelope' = 'decorative-feature', enclose = false) => {
      const aboveRoof = boxes.filter(b => b.height > 0 && b.z + b.height > elevation && overlaps([b], surface.regionsMm))
      if (!aboveRoof.length) return
      const regions = enclose ? [rectUnionBBox(aboveRoof)] : aboveRoof
      const feature = exclusion(id, kind, regions, enclose ? 'Conservative full projected envelope including space below overhead frames/slats.' : 'Projected footprint of existing roof geometry.', policy.obstacleClearanceMm)
      feature.bottomMm = Math.min(...aboveRoof.map(b => b.z)); feature.topMm = Math.max(...aboveRoof.map(b => b.z + b.height))
      surface.obstacles.push(feature)
    }
    for (const feature of arch?.facadeGrammar.features ?? []) addWorld(`feature:${feature.id}`, feature.parts.map(p => p.world), 'decorative-feature', ['SOLAR_SHADE_ROOF', 'PERGOLA_FRAME', 'ROOF_FRAME'].includes(feature.type))
    for (const unit of arch?.facadeGrammar.specialized?.assemblies ?? []) addWorld(`grammar:${unit.id}`, unit.parts.filter(p => p.operation === 'ADD').map(p => p.world), 'decorative-feature', unit.category === 'ROOFLINE' && ['PERGOLA', 'ROOFTOP_FRAME', 'SCREENED_TERRACE'].includes(unit.type))
    for (const m of arch?.massingModel.masses ?? []) if (['roof', 'canopy'].includes(m.usage)) addWorld(`mass:${m.id}`, [{ ...massRect(m), z: m.elevation, height: m.height }], 'roof-envelope')
    for (const canopy of building.modernComposition?.canopies ?? []) addWorld(`composition:${canopy.id}`, [{ ...canopy.rect, z: canopy.bottomMm, height: canopy.thicknessMm }])
    if (terrace?.pergola) surface.obstacles.push(exclusion('terrace-pergola', 'decorative-feature', [terrace.pergola], 'Explicit terrace pergola envelope.', policy.obstacleClearanceMm))
    surface.exclusions.push(...surface.obstacles)
    if (!ready) { surface.status = 'uncertain'; surface.issues.push(...modelIssues); continue }
    if (!terrace || terrace.level !== floor.level || JSON.stringify(subtractRegions(terrace.slab)) !== JSON.stringify(subtractRegions(floor.footprint))) {
      surface.status = 'uncertain'; surface.issues.push({ code: 'TERRACE_SOURCE_UNCERTAIN', message: 'The accepted roof terrace does not match the current top-floor slab.' }); continue
    }
    allocate(surface, building, inputs, policy)
  }
  for (const room of building.rooms.filter(r => r.outdoor && r.id.startsWith('balcony'))) {
    const f = floors.find(f => f.id === room.floorId)!
    const s = createSurface(`balcony:${room.semanticId}`, f.id, f.level, 'balcony', f.elevationMm, [room.rect])
    s.issues.push({ code: 'BALCONY_UNSUPPORTED', message: 'A balcony and its access/guard geometry are not a supported solar roof.' })
  }
  for (const m of arch?.massingModel.masses ?? []) if (m.usage === 'canopy' || m.usage === 'roof') {
    const s = createSurface(`mass:${m.id}`, m.sourceFloorId, m.floor, m.usage === 'canopy' ? 'canopy' : 'roof-envelope', m.elevation + m.height, [massRect(m)])
    s.issues.push({ code: 'ROOF_ADDITION_UNSUPPORTED', message: 'Architectural canopy/envelope geometry is not established as a usable installation slab.' })
  }
  for (const canopy of building.modernComposition?.canopies ?? []) {
    const f = floors.find(f => f.id === canopy.floorId)!
    const s = createSurface(`composition:${canopy.id}`, f.id, f.level, 'canopy', canopy.bottomMm + canopy.thicknessMm, [canopy.rect])
    s.issues.push({ code: 'CANOPY_UNSUPPORTED', message: 'A composition canopy is not a supported solar surface.' })
  }
  const ground = floors[0]
  for (const roof of arch?.facadeGrammar.coveredOutdoor?.roofs ?? []) if (ground && roof.slabs.length) {
    const s = createSurface(`porch:${roof.id}`, ground.id, ground.level, 'canopy', ground.elevationMm + ground.heightMm, roof.slabs)
    s.issues.push({ code: 'PORCH_ROOF_UNSUPPORTED', message: 'A checked porch/verandah roof is represented, but solar loading and installation suitability are not established.' })
  }
  for (const unit of arch?.facadeGrammar.specialized?.assemblies ?? []) if (unit.category === 'ROOFLINE' && ['PERGOLA', 'ROOFTOP_FRAME'].includes(unit.type) && unit.parts.length) {
    const s = createSurface(`pergola:${unit.id}`, top?.id ?? '', top?.level ?? 0, 'pergola', Math.max(...unit.parts.map(p => p.world.z + p.world.height)), [rectUnionBBox(unit.parts.map(p => p.world))])
    s.issues.push({ code: 'PERGOLA_UNSUPPORTED', message: 'An open frame or pergola is not a PV mounting surface.' })
  }
  for (const feature of arch?.facadeGrammar.features ?? []) if (['SOLAR_SHADE_ROOF', 'PERGOLA_FRAME', 'ROOF_FRAME', 'PERGOLA_COURT'].includes(feature.type) && feature.parts.length) {
    const zone = arch?.facadeGrammar.zones?.find(z => feature.zoneIds.includes(z.id)), floor = floors.find(f => f.id === zone?.floorId) ?? top
    const s = createSurface(`frame:${feature.id}`, floor?.id ?? '', floor?.level ?? 0, 'pergola', Math.max(...feature.parts.map(p => p.world.z + p.world.height)), [rectUnionBBox(feature.parts.map(p => p.world))])
    s.issues.push({ code: 'DECORATIVE_SHADE_UNSUPPORTED', message: 'Decorative shade/frame geometry is neither photovoltaic equipment nor a supported installation slab.' })
  }
  if (!top) modelIssues.push({ code: 'NO_ROOF', message: 'The building has no represented roof surface.' })
  // Geometric roof signature excludes user policy/reservations. Allocation changes have a separate key.
  const roofSignature = token('solar-roof-v1', [building.planId, arch?.villaDesignDNA.roofType ?? null,
    surfaces.map(s => [s.id, s.kind, s.elevationMm, s.grossRegionsMm, s.holes, s.obstacles.map(o => ({ ...o, clearanceMm: 0 }))])])
  const orientation = { planNorthBearingDeg: inputs.orientation.planNorthBearingDeg,
    status: inputs.orientation.planNorthBearingDeg === null ? 'unknown' as const : 'user-provided' as const }
  const knownRefs = new Set(surfaces.flatMap(s => [s.id, ...s.components.map(c => c.id)]))
  if (inputs.reservedAreas.some(r => r.roofSurfaceId && !knownRefs.has(r.roofSurfaceId) || !floors.some(f => f.level === r.level))) {
    modelIssues.push({ code: 'RESERVATION_NEEDS_REVIEW', message: 'A saved reservation no longer matches a represented roof surface or floor.' })
    for (const s of surfaces.filter(s => s.kind === 'flat-top-roof')) {
      s.status = 'uncertain'; s.usableRegionsMm = []; s.usableAreaM2 = 0; s.maxSolarFootprintAreaM2 = 0
    }
  }
  return { schemaVersion: 1, sourcePlanId: source.planId, roofSignature,
    allocationInputsSignature: solarRoofInputsSignature(inputs),
    allocationSignature: token('solar-allocation-v1', [roofSignature, ready, policy, orientation, [...inputs.reservedAreas].sort((a, b) => a.id.localeCompare(b.id))]),
    coordinates: 'plan-x-east-y-south-z-up', units: 'mm', policy, orientation, surfaces,
    usableAreaM2: surfaces.reduce((n, s) => n + s.usableAreaM2, 0), maxSolarFootprintAreaM2: surfaces.reduce((n, s) => n + s.maxSolarFootprintAreaM2, 0),
    issues: modelIssues, qualification: 'Concept space allocation only. Roof loading, anchorage, waterproofing, electrical design and actual site conditions require installer/engineer verification. Shading and panel fit are not calculated.' }
}
