import { rectUnionEdges, type Rect } from '../../geometry.ts'
import type { BuildingModel } from '../buildingModel.ts'
import type { Mass, MassingIssue } from './model.ts'
import { assertMass, massRect } from './transforms.ts'
import { intersectionArea, uncoveredArea } from './families.ts'

/** Compares occupied volumes to the plan at every vertical change in the masses. */
export function validateMassing(building: BuildingModel, masses: Mass[], limits: { maxRoofHeightMm?: number } = {}): MassingIssue[] {
  const issues: MassingIssue[] = []
  const add = (code: string, message: string, massId?: string) => issues.push({ code, message, ...(massId ? { massId } : {}) })
  const byId = new Map<string, Mass>()
  const good: Mass[] = []
  for (const m of masses) {
    try { assertMass(m) } catch { add('INVALID_MASS', 'Mass dimensions or rotation are invalid.', m.id); continue }
    if (!['enclosed', 'roof', 'terrace', 'canopy', 'support'].includes(m.usage)) {
      add('INVALID_USAGE', 'Mass must be enclosed, roof or terrace geometry.', m.id); continue
    }
    good.push(m)
    if (byId.has(m.id)) add('DUPLICATE_MASS', 'Mass IDs must be unique.', m.id)
    byId.set(m.id, m)
    const f = building.floors.find((floor) => floor.id === m.sourceFloorId && floor.level === m.floor)
    if (!f) { add('UNKNOWN_FLOOR', 'Mass has no matching source floor.', m.id); continue }
    if (uncoveredArea([massRect(m)], [building.plot.buildable]) > 1)
      add('SETBACK_BREACH', 'Mass extends outside the plan setback envelope.', m.id)
    if (!m.sourceRoomIds.length || m.sourceRoomIds.some((id) =>
      !building.rooms.some((r) => r.floorId === f.id && r.semanticId === id)))
      add('ROOM_PROVENANCE', 'Mass must reference existing rooms on its source floor.', m.id)
    if (m.usage === 'enclosed' && (m.elevation < f.elevationMm || m.elevation + m.height > f.elevationMm + f.heightMm))
      add('FLOOR_HEIGHT_CHANGED', 'Enclosed masses must remain within the source floor height.', m.id)
    if (m.usage === 'roof') {
      const base = f.elevationMm + f.heightMm, roofLimit = limits.maxRoofHeightMm ?? 2000
      if (m.elevation < base || m.elevation + m.height > base + roofLimit || (!m.shell && m.elevation !== base))
        add('ROOF_ELEVATION', `Roof envelopes must remain above their source floor within ${roofLimit} mm.`, m.id)
      if (uncoveredArea([massRect(m)], f.footprint) > 1)
        add('UNSUPPORTED_ROOF', 'Roof envelope leaves its supporting floor plate.', m.id)
      const protectedRects = [
        ...building.stairs.filter((s) => s.floorId === f.id).map((s) => s.rect),
        ...building.shafts.filter((s) => s.floorId === f.id).map((s) => s.rect),
      ]
      if (intersectionArea([massRect(m)], protectedRects) > 1)
        add('CORE_BLOCKED', 'Roof envelope intersects a stair or service shaft.', m.id)
      for (const other of building.floors) {
        if (Math.min(m.elevation + m.height, other.elevationMm + other.heightMm) <= Math.max(m.elevation, other.elevationMm)) continue
        if (intersectionArea([massRect(m)], other.footprint) > 1)
          add('ROOM_VOLUME_BLOCKED', 'Roof envelope overlaps an occupied floor.', m.id)
      }
    }
    if (m.usage === 'terrace') {
      const balconies = building.rooms.filter((r) => r.floorId === f.id && r.outdoor && r.id.startsWith('balcony')).map((r) => r.rect)
      const slabOnFloor = m.elevation + m.height === f.elevationMm && uncoveredArea([massRect(m)], balconies) <= 1
      const slabOnRoof = m.elevation + m.height === f.elevationMm + f.heightMm && uncoveredArea([massRect(m)], f.footprint) <= 1
      if (m.height > 220 || (!slabOnFloor && !slabOnRoof))
        add('TERRACE_CHANGED', 'Terrace slab must coincide with an existing balcony or roof plate.', m.id)
    }
  }
  for (const m of good) {
    const seen = new Set([m.id])
    let parent = m.parentId
    while (parent !== null) {
      if (seen.has(parent)) { add('PARENT_CYCLE', 'Mass parent links contain a cycle.', m.id); break }
      seen.add(parent)
      const host = byId.get(parent)
      if (!host) { add('MISSING_PARENT', 'Mass parent does not exist.', m.id); break }
      parent = host.parentId
    }
  }
  for (const floor of building.floors) {
    const enclosed = good.filter((m) => m.usage === 'enclosed' && m.sourceFloorId === floor.id)
    const base = floor.elevationMm, top = base + floor.heightMm
    const zs = [...new Set([base, top, ...enclosed.flatMap((m) => [m.elevation, m.elevation + m.height])])]
      .filter((z) => z >= base && z <= top).sort((a, b) => a - b)
    for (let i = 0; i < zs.length - 1; i++) {
      const mid = (zs[i] + zs[i + 1]) / 2
      const rects = enclosed.filter((m) => m.elevation < mid && m.elevation + m.height > mid).map(massRect)
      if (uncoveredArea(floor.footprint, rects) > 1 || uncoveredArea(rects, floor.footprint) > 1) {
        add('PLAN_FOOTPRINT_CHANGED', `${floor.id}: massing adds or removes occupied plan area at elevation ${mid} mm.`)
        break
      }
    }
  }
  return issues
}

const edges = (rects: Rect[]) => rectUnionEdges(rects)
  .map((e) => [e.side, e.a.x, e.a.y, e.b.x, e.b.y])
  .sort((a, b) => {
    const aa = JSON.stringify(a), bb = JSON.stringify(b)
    return aa < bb ? -1 : aa > bb ? 1 : 0
  })

/** Actual front/side/top silhouettes, insensitive to mass labels and internal splits. */
export function massingSilhouetteSignature(masses: Mass[]): string {
  const rects = masses.map((m) => ({ m, r: massRect(m) }))
  return JSON.stringify({
    front: edges(rects.map(({ m, r }) => ({ x: r.x, y: m.elevation, w: r.w, h: m.height }))),
    side: edges(rects.map(({ m, r }) => ({ x: r.y, y: m.elevation, w: r.h, h: m.height }))),
    top: edges(rects.map(({ r }) => r)),
  })
}
