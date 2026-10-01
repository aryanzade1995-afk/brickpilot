import { rectUnionEdges, sharedEdge, type Rect } from '../../geometry.ts'
import type { BuildingModel } from '../buildingModel.ts'
import { MAX_BEAM_SPAN, MAX_CANTILEVER } from '../planner/program.ts'
import { reachability } from '../planner/index.ts'
import { intersectRects, intersectionArea, uncoveredArea } from './families.ts'
import type { Mass, MassingModel } from './model.ts'
import { assertMass, massRect } from './transforms.ts'
import { validateMassing } from './validate.ts'
import { DEFAULT_ENVELOPE_LIMITS } from './envelopeLimits.ts'

export type ArchitectureCategory = 'plot' | 'rooms' | 'floors' | 'structure' | 'openings' | 'masses' | 'balconies'
export type ArchitectureIssue = {
  code: string
  category: ArchitectureCategory
  message: string
  massId?: string
  sourceId?: string
}
export type ArchitectureReport = { valid: boolean; issues: ArchitectureIssue[] }
export type ArchitectureLimits = {
  /** Concept geometry limit, in millimetres. Defaults to the existing planner limit. */
  maxCantileverMm?: number
  /** Small fragments left by cutting roofs/volumes are rejected. */
  minRoofWidthMm?: number
  minEnclosedWidthMm?: number
  maxRoofHeightMm?: number
  minRoofSupportRatio?: number
  maxRoofProjectionMm?: number
  minSupportSectionMm?: number
  maxSupportHeightMm?: number
  minCanopyClearanceMm?: number
  maxCanopyThicknessMm?: number
  minCanopyWidthMm?: number
  maxCanopySpanMm?: number
}
export type VariationAttempt = {
  masses: Mass[]
  report: ArchitectureReport
  attemptsTried: number
}

const EPS_AREA = 1 // mm²; integer-millimetre plan geometry
const same = (a: number, b: number) => Math.abs(a - b) <= 2
const finiteRect = (r: Rect) => [r.x, r.y, r.w, r.h].every(Number.isFinite) && r.w > 0 && r.h > 0
const zOverlap = (a: Mass, b: Mass) => Math.min(a.elevation + a.height, b.elevation + b.height) - Math.max(a.elevation, b.elevation)
const onLine = (o: { orient: 'h' | 'v'; at: { x: number; y: number } }) => o.orient === 'h' ? o.at.y : o.at.x
const along = (o: { orient: 'h' | 'v'; at: { x: number; y: number } }) => o.orient === 'h' ? o.at.x : o.at.y

/** Geometric gate for a candidate derived from an already checked 2D Design. */
export class ArchitectureValidator {
  /** Future mesh exporters must call this at the boundary, even for cached results. */
  static assertReadyForGeometry(building: BuildingModel, result: MassingModel,
    limits: ArchitectureLimits = result.architectureLimits ?? {}): Mass[] {
    if (result.sourcePlanId !== building.planId || result.status !== 'valid' || !result.architectureReport?.valid)
      throw new Error('Massing result has not passed architecture validation for this plan.')
    const fresh = ArchitectureValidator.validate(building, result.masses, limits)
    if (!fresh.valid)
      throw new Error(`Architecture validation failed: ${fresh.issues.map((issue) => issue.code).join(', ')}`)
    return result.masses
  }

  static validate(building: BuildingModel, masses: Mass[], limits: ArchitectureLimits = {}): ArchitectureReport {
    const issues: ArchitectureIssue[] = []
    const add = (category: ArchitectureCategory, code: string, message: string, sourceId?: string, massId?: string) =>
      issues.push({ category, code, message, ...(sourceId ? { sourceId } : {}), ...(massId ? { massId } : {}) })
    const maxCantilever = limits.maxCantileverMm ?? MAX_CANTILEVER
    const minRoof = limits.minRoofWidthMm ?? 250
    const minEnclosed = limits.minEnclosedWidthMm ?? 300
    const envelope = { ...DEFAULT_ENVELOPE_LIMITS, ...limits }
    if (![maxCantilever, minRoof, minEnclosed].every((n) => Number.isFinite(n) && n > 0))
      throw new RangeError('Architecture limits must be finite positive millimetres')
    if (Object.values(envelope).some((n) => !Number.isFinite(n) || n <= 0)) throw new RangeError('Envelope limits must be finite positive values')
    if (!building.floors.length) add('floors', 'NO_FLOORS', 'Candidate has no source floor plan.')
    if (!building.rooms.some((r) => !r.outdoor)) add('rooms', 'NO_ROOMS', 'Candidate has no source occupied rooms.')
    if (!masses.length) add('masses', 'NO_MASSES', 'Candidate has no architectural volumes.')

    const roofSupport = limits.minRoofSupportRatio ?? 1
    if (!Number.isFinite(roofSupport) || roofSupport < 0.7 || roofSupport > 1 ||
      !Number.isFinite(limits.maxRoofHeightMm ?? 2000) || (limits.maxRoofHeightMm ?? 2000) < 1 ||
      (limits.maxRoofHeightMm ?? 2000) > 3600) throw new RangeError('Invalid roof envelope limits')
    for (const issue of validateMassing(building, masses, limits)) {
      const category: ArchitectureCategory = issue.code === 'SETBACK_BREACH' ? 'plot'
        : issue.code === 'PLAN_FOOTPRINT_CHANGED' || issue.code === 'ROOM_PROVENANCE' ? 'rooms'
          : issue.code === 'UNSUPPORTED_ROOF' || issue.code === 'ROOM_VOLUME_BLOCKED' ? 'structure'
            : issue.code === 'TERRACE_CHANGED' ? 'balconies' : 'masses'
      add(category, issue.code, issue.message, undefined, issue.massId)
    }
    const good: Mass[] = []
    for (const m of masses) {
      try { assertMass(m) } catch { continue }
      const r = massRect(m)
      good.push(m)
      if (r.x < 0 || r.y < 0 || r.x + r.w > building.plot.widthMm || r.y + r.h > building.plot.depthMm)
        add('plot', 'PROPERTY_BOUNDARY', 'Volume crosses the property boundary.', undefined, m.id)
      const min = m.usage === 'enclosed' ? minEnclosed : m.usage === 'roof' ? minRoof : 0
      if (Math.min(r.w, r.h) < min)
        add('masses', 'THIN_VOLUME', `Volume has a plan dimension below ${min} mm.`, undefined, m.id)
      if (m.usage === 'roof') {
        // Look at every host; mass ordering carries no geometric meaning.
        const support = masses.filter((host) => host !== m && (host.usage === 'enclosed' || (m.shell && host.shell)) &&
          host.sourceFloorId === m.sourceFloorId && same(host.elevation + host.height, m.elevation))
          .filter((host) => { try { assertMass(host); return true } catch { return false } })
        const excess = uncoveredArea([r], support.map(massRect))
        const ratio = 1 - excess / (r.w * r.h)
        if (ratio + 1e-6 < roofSupport || (!m.shell && excess > EPS_AREA))
          add('masses', 'FLOATING_VOLUME', 'Roof volume has no continuous support from occupied mass below.', undefined, m.id)
        if (excess > EPS_AREA) {
          const hosts = support.map(massRect)
          const xs = [...new Set([r.x, r.x + r.w, ...hosts.flatMap((h) => [h.x, h.x + h.w])])].filter((x) => x >= r.x && x <= r.x + r.w)
          const ys = [...new Set([r.y, r.y + r.h, ...hosts.flatMap((h) => [h.y, h.y + h.h])])].filter((y) => y >= r.y && y <= r.y + r.h)
          const projection = hosts.length ? Math.max(...xs.flatMap((x) => ys.map((y) => Math.min(...hosts.map((h) =>
            Math.hypot(Math.max(h.x - x, 0, x - h.x - h.w), Math.max(h.y - y, 0, y - h.y - h.h))))))) : Infinity
          if (projection > (limits.maxRoofProjectionMm ?? maxCantilever) + 1) add('structure', 'CANTILEVER_EXCEEDED', 'Roof projection exceeds the configured limit.', undefined, m.id)
        }
      }
      if (m.usage === 'support') {
        const ground = Math.min(...building.floors.map((f) => f.elevationMm))
        if (!same(m.elevation, ground) || Math.min(r.w, r.h) < envelope.minSupportSectionMm || m.height > envelope.maxSupportHeightMm)
          add('structure', 'INVALID_ENVELOPE_SUPPORT', 'Exterior pier must bear at ground level with a usable section.', undefined, m.id)
        if (intersectionArea([r], building.rooms.map((room) => room.rect)) > EPS_AREA)
          add('plot', 'CIRCULATION_BLOCKED', 'An exterior pier intersects a room, parking or existing outdoor circulation.', undefined, m.id)
      }
      if (m.usage === 'canopy') {
        if (m.elevation < envelope.minCanopyClearanceMm || m.height > envelope.maxCanopyThicknessMm ||
          Math.min(r.w, r.h) < envelope.minCanopyWidthMm || Math.max(r.w, r.h) > envelope.maxCanopySpanMm)
          add('structure', 'INVALID_CANOPY', 'Canopy needs head clearance and spans within the configured concept beam limit.', undefined, m.id)
        const bearings = good.concat(masses).filter((p) => m.bearingSupports?.includes(p.id) && p.usage === 'support' &&
          same(p.elevation + p.height, m.elevation) && intersectRects(massRect(p), r))
        const unique = new Map(bearings.map((p) => [p.id, p]))
        if (unique.size < 2 || [...unique.values()].some((p) => uncoveredArea([massRect(p)], [r]) > EPS_AREA))
          add('structure', 'CANOPY_SUPPORT_MISSING', 'Canopy must have at least two valid piers within its footprint.', undefined, m.id)
        const host = masses.find((p) => p.id === m.parentId && p.usage === 'enclosed')
        const contact = host && sharedEdge(massRect(host), r)
        if (!contact || contact.length < Math.min(r.w, r.h) * .5 || host!.elevation + host!.height < m.elevation)
          add('structure', 'CANOPY_HOST_MISSING', 'Canopy must bear along a real occupied building edge.', undefined, m.id)
      }
    }

    // Every usable room retains its exact rectangle throughout its occupied floor height.
    for (const room of building.rooms.filter((r) => !r.outdoor)) {
      const floor = building.floors.find((f) => f.id === room.floorId)
      if (!floor || !finiteRect(room.rect)) {
        add('rooms', 'INVALID_SOURCE_ROOM', 'Source room or floor has invalid dimensions.', room.semanticId)
        continue
      }
      const relevant = good.filter((m) => m.usage === 'enclosed' && m.sourceFloorId === floor.id &&
        m.sourceRoomIds.includes(room.semanticId))
      const zs = [...new Set([floor.elevationMm, floor.elevationMm + floor.heightMm,
        ...relevant.flatMap((m) => [m.elevation, m.elevation + m.height])])]
        .filter((z) => z >= floor.elevationMm && z <= floor.elevationMm + floor.heightMm).sort((a, b) => a - b)
      for (let i = 0; i < zs.length - 1; i++) {
        const mid = (zs[i] + zs[i + 1]) / 2
        const covering = relevant.filter((m) => m.elevation < mid && m.elevation + m.height > mid).map(massRect)
        if (uncoveredArea([room.rect], covering) > EPS_AREA) {
          add('rooms', 'ROOM_DESTROYED', 'Candidate removes usable area or height from an existing room.', room.semanticId)
          break
        }
      }
    }
    for (const m of good.filter((x) => x.usage === 'enclosed')) {
      const reference = building.rooms.filter((r) => r.floorId === m.sourceFloorId &&
        !r.outdoor && m.sourceRoomIds.includes(r.semanticId)).map((r) => r.rect)
      if (reference.length && uncoveredArea([massRect(m)], reference) > EPS_AREA)
        add('rooms', 'ROOM_PROVENANCE_GEOMETRY', 'Occupied mass extends beyond the rooms it names.', undefined, m.id)
    }

    const floors = [...building.floors].sort((a, b) => a.level - b.level)
    for (let i = 0; i < floors.length; i++) {
      const floor = floors[i]
      const plate = floor.footprint
      if (!plate.length || plate.some((r) => !finiteRect(r))) {
        add('floors', 'INVALID_FLOOR_PLATE', 'Source floor plate has invalid geometry.', floor.id)
        continue
      }
      const slabRects = building.slabs.filter((s) => s.floorId === floor.id)
      if (slabRects.length && (slabRects.some((s) => !finiteRect(s.rect) || s.thicknessMm <= 0 ||
        s.thicknessMm > 500 || !same(s.topMm, floor.elevationMm)) ||
        uncoveredArea(plate, slabRects.map((s) => s.rect)) > EPS_AREA ||
        uncoveredArea(slabRects.map((s) => s.rect), plate) > EPS_AREA))
        add('structure', 'INVALID_SLAB', 'Slabs must match the existing floor plate and finished level.', floor.id)
      if (i > 0) {
        const below = floors[i - 1]
        const cantileverZones = building.supportZones.filter((z) => z.floorId === floor.id &&
          z.support === 'cantilever').map((z) => z.rect)
        const support = [...below.footprint, ...cantileverZones]
        if (uncoveredArea(plate, support) > EPS_AREA)
          add('structure', 'UPPER_UNSUPPORTED', 'Upper floor extends beyond lower plate and declared supports.', floor.id)
        for (const rect of plate) {
          const excess = uncoveredArea([rect], below.footprint)
          const depth = excess / Math.max(rect.w, rect.h)
          if (depth > maxCantilever + 1)
            add('structure', 'CANTILEVER_EXCEEDED', `Upper projection exceeds ${maxCantilever} mm.`, floor.id)
        }
      }
      const levelRooms = building.rooms.filter((r) => r.floorId === floor.id)
      const levelDoors = building.doors.filter((d) => d.floorId === floor.id)
      if (levelDoors.length && reachability(levelRooms, levelDoors, floor.level).length)
        add('rooms', 'ROOM_DISCONNECTED', 'A source room is unreachable through existing doors and stairs.', floor.id)
    }
    if (building.stairs.length) {
      const first = building.stairs.find((s) => s.floorId === floors[0]?.id)?.rect
      for (const floor of floors) {
        const stair = building.stairs.find((s) => s.floorId === floor.id)
        if (!stair || !first || !finiteRect(stair.rect) ||
          stair.rect.x !== first.x || stair.rect.y !== first.y ||
          stair.rect.w !== first.w || stair.rect.h !== first.h)
          add('floors', 'STAIR_DISCONNECTED', 'Stair core must align on every occupied level.', floor.id)
      }
    }

    for (const column of building.columns) {
      if (!Number.isFinite(column.at.x) || !Number.isFinite(column.at.y) || column.size <= 0)
        add('structure', 'INVALID_COLUMN', 'Column coordinates or size are invalid.', column.id)
      const index = floors.findIndex((f) => f.id === column.floorId)
      if (index > 0 && !building.columns.some((other) => other.floorId === floors[index - 1].id &&
        same(other.at.x, column.at.x) && same(other.at.y, column.at.y)))
        add('structure', 'COLUMN_MISALIGNED', 'Upper column has no aligned column below.', column.id)
    }
    for (const beam of building.beams) {
      const span = Math.hypot(beam.b.x - beam.a.x, beam.b.y - beam.a.y)
      if (!Number.isFinite(span) || span <= 0 || span > MAX_BEAM_SPAN || !same(beam.span, span))
        add('structure', 'INVALID_BEAM', 'Beam span is invalid or exceeds the concept limit.', beam.id)
    }

    // The 2D plan owns all openings. Re-check their geometry before any mesh builder sees them.
    const openings = [...building.doors, ...building.windows]
    for (const o of openings) {
      const floor = floors.find((f) => f.id === o.floorId)
      if (!floor || !Number.isFinite(o.width) || o.width <= 0 ||
        !Number.isFinite(o.at.x) || !Number.isFinite(o.at.y)) {
        add('openings', 'INVALID_OPENING', 'Opening dimensions or floor are invalid.', o.id)
        continue
      }
      const horizontal = o.orient === 'h'
      const lo = along(o) - o.width / 2, hi = along(o) + o.width / 2
      if (o.kind === 'door') {
        const a = building.rooms.find((r) => r.floorId === floor.id && r.id === o.rooms?.[0])
        const b = building.rooms.find((r) => r.floorId === floor.id && r.id === o.rooms?.[1])
        const shared = a && b && sharedEdge(a.rect, b.rect)
        const edgeHorizontal = shared && (shared.side === 'N' || shared.side === 'S')
        const edge = shared?.seg
        if (!edge || horizontal !== edgeHorizontal || !same(onLine(o), horizontal ? edge.a.y : edge.a.x) ||
          lo < (horizontal ? edge.a.x : edge.a.y) - 1 || hi > (horizontal ? edge.b.x : edge.b.y) + 1)
          add('openings', 'DOOR_INACCESSIBLE', 'Door no longer fits the wall shared by its rooms.', o.id)
      } else {
        const boundary = rectUnionEdges(floor.footprint, floor.courtyard)
        if (!boundary.some((edge) => {
          const edgeHorizontal = edge.side === 'N' || edge.side === 'S'
          return horizontal === edgeHorizontal && same(onLine(o), horizontal ? edge.a.y : edge.a.x) &&
            lo >= (horizontal ? edge.a.x : edge.a.y) + 110 &&
            hi <= (horizontal ? edge.b.x : edge.b.y) - 110
        })) add('openings', 'EXTERIOR_OPENING_LOST', 'Entry or required window has no valid exterior wall.', o.id)
      }
      for (const c of building.columns.filter((column) => column.floorId === floor.id)) {
        if (same(horizontal ? c.at.y : c.at.x, onLine(o)) &&
          Math.abs((horizontal ? c.at.x : c.at.y) - along(o)) < o.width / 2 + c.size / 2)
          add('openings', 'OPENING_ON_COLUMN', 'Opening intersects a column.', o.id)
      }
    }
    for (let i = 0; i < openings.length; i++) for (let j = i + 1; j < openings.length; j++) {
      const a = openings[i], b = openings[j]
      if (a.floorId === b.floorId && a.orient === b.orient && same(onLine(a), onLine(b)) &&
        Math.min(along(a) + a.width / 2, along(b) + b.width / 2) -
        Math.max(along(a) - a.width / 2, along(b) - b.width / 2) > 1)
        add('openings', 'OPENINGS_OVERLAP', 'Two openings overlap on one wall.', `${a.id}/${b.id}`)
    }

    for (const room of building.rooms.filter((r) => r.outdoor && r.id.startsWith('balcony'))) {
      const floor = floors.find((f) => f.id === room.floorId)
      const access = building.doors.some((d) => d.floorId === room.floorId && d.kind === 'door' &&
        d.rooms?.includes(room.id) && d.rooms.some((id) => id && id !== room.id &&
          building.rooms.some((other) => other.floorId === room.floorId && other.id === id && !other.outdoor)))
      if (!access) add('balconies', 'BALCONY_INACCESSIBLE', 'Balcony lacks a door from an occupied room.', room.semanticId)
      const slabs = good.filter((m) => m.usage === 'terrace' && m.sourceFloorId === room.floorId &&
        floor && same(m.elevation + m.height, floor.elevationMm)).map(massRect)
      if (uncoveredArea([room.rect], slabs) > EPS_AREA)
        add('balconies', 'BALCONY_SLAB_MISSING', 'Balcony slab no longer covers the source balcony.', room.semanticId)
      if (floor && intersectionArea([room.rect], floor.footprint) > EPS_AREA)
        add('balconies', 'BALCONY_WALL_COLLISION', 'Balcony overlaps an enclosed room or wall plate.', room.semanticId)
      const below = floor && floors.find((f) => f.level === floor.level - 1)
      if (below) {
        const excess = uncoveredArea([room.rect], below.footprint)
        if (excess / Math.max(room.rect.w, room.rect.h) > maxCantilever + 1)
          add('balconies', 'BALCONY_CANTILEVER_EXCEEDED', 'Balcony projection exceeds the configured concept limit.', room.semanticId)
      }
    }
    for (const room of building.rooms.filter((r) => r.outdoor && !r.id.startsWith('balcony'))) {
      const floor = floors.find((f) => f.id === room.floorId)
      if (!floor || !finiteRect(room.rect)) continue
      const blocking = good.filter((m) => m.elevation < floor.elevationMm + 2400 &&
        m.elevation + m.height > floor.elevationMm && m.usage === 'enclosed').map(massRect)
      if (intersectionArea([room.rect], blocking) > EPS_AREA)
        add('plot', 'OUTDOOR_ACCESS_BLOCKED', 'Parking, courtyard or outdoor circulation is blocked.', room.semanticId)
    }

    // Intentional contact along a face is allowed. A balcony slab may bear on
    // the last 220 mm of an enclosed lower storey; other positive overlaps are not.
    for (let i = 0; i < good.length; i++) for (let j = i + 1; j < good.length; j++) {
      const a = good[i], b = good[j]
      if (zOverlap(a, b) <= 1 || !intersectRects(massRect(a), massRect(b))) continue
      const terrace = a.usage === 'terrace' ? a : b.usage === 'terrace' ? b : null
      const other = terrace === a ? b : a
      if (terrace && other.usage === 'enclosed' && other.floor < terrace.floor &&
        same(terrace.elevation + terrace.height, floors.find((f) => f.id === terrace.sourceFloorId)?.elevationMm ?? NaN)) continue
      add('masses', 'MASS_INTERSECTION', 'Two unrelated candidate volumes occupy the same space.', `${a.id}/${b.id}`)
    }
    return { valid: issues.length === 0, issues }
  }

  /** Deterministic, bounded retry. A failed transform never reaches downstream geometry. */
  static tryVariations(building: BuildingModel, maxAttempts: number,
    createCandidate: (attempt: number) => Mass[], limits: ArchitectureLimits = {}): VariationAttempt {
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 32)
      throw new RangeError('Variation attempts must be an integer from 1 to 32')
    let last: ArchitectureReport = { valid: false, issues: [] }
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const masses = createCandidate(attempt)
        last = ArchitectureValidator.validate(building, masses, limits)
        if (last.valid) return { masses, report: last, attemptsTried: attempt + 1 }
      } catch (error) {
        last = { valid: false, issues: [{ category: 'masses', code: 'TRANSFORM_FAILED',
          message: error instanceof Error ? error.message : 'Candidate transformation failed.' }] }
      }
    }
    return { masses: [], report: last, attemptsTried: maxAttempts }
  }
}
