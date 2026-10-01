import type { BuildingModel, BuildingRoom } from '../buildingModel.ts'
import type { VillaDesignDNA } from '../villaDesignDna.ts'
import { makeRng } from './rng.ts'
import { assessMassingFamilies, intersectRects } from './families.ts'
import { massRect, stepBackMass, subtractCourtyard, type MassSide } from './transforms.ts'
import { massingSilhouetteSignature } from './validate.ts'
import { ArchitectureValidator } from './ArchitectureValidator.ts'
import type { Mass, MassingFamily, MassingModel, MassRole } from './model.ts'
import { rectUnionArea } from '../../geometry.ts'

function roleOf(room: BuildingRoom, level: number): MassRole {
  if (room.id === 'stair') return 'stairTower'
  if (room.id === 'foyer') return 'entrance'
  if (room.zone === 'social') return 'livingWing'
  if (room.zone === 'private') return 'bedroomWing'
  return level > 0 ? 'upperVolume' : 'primary'
}

/** Merge coplanar adjacent program volumes, never fill a gap between them. */
function mergeMasses(input: Mass[]): Mass[] {
  const out = input.map((m) => ({ ...m, sourceRoomIds: [...m.sourceRoomIds] }))
  let changed = true
  while (changed) {
    changed = false
    outer: for (let i = 0; i < out.length; i++) for (let j = i + 1; j < out.length; j++) {
      const a = out[i], b = out[j]
      if (a.floor !== b.floor || a.height !== b.height || a.elevation !== b.elevation ||
        a.role !== b.role || a.usage !== b.usage || a.rotation || b.rotation) continue
      const joinX = a.y === b.y && a.depth === b.depth && (a.x + a.width === b.x || b.x + b.width === a.x)
      const joinY = a.x === b.x && a.width === b.width && (a.y + a.depth === b.y || b.y + b.depth === a.y)
      if (!joinX && !joinY) continue
      out[i] = { ...a, x: Math.min(a.x, b.x), y: Math.min(a.y, b.y),
        width: joinX ? a.width + b.width : a.width, depth: joinY ? a.depth + b.depth : a.depth,
        parentId: a.parentId === b.parentId ? a.parentId : null,
        sourceRoomIds: [...new Set([...a.sourceRoomIds, ...b.sourceRoomIds])].sort() }
      out.splice(j, 1); changed = true; break outer
    }
  }
  return out
}

/** Family-specific roof envelope grouping follows actual program volumes.
 * No recipe has permission to move an occupied room or invent a floor plate. */
function roofGroup(family: MassingFamily, x: number, y: number, room: BuildingRoom, phase: number): number {
  switch (family) {
    case 'L_SHAPED': return x > 0.55 ? 2 : y > 0.55 ? 1 : 0
    case 'U_SHAPED': return x < 0.32 ? 0 : x > 0.68 ? 2 : 1
    case 'COURTYARD': return Math.abs(x - 0.5) > Math.abs(y - 0.5) ? x < 0.5 ? 0 : 2 : y < 0.5 ? 1 : 3
    case 'OFFSET_BLOCKS': return x + y > 1 ? 2 : 0
    case 'INTERLOCKING_BLOCKS': return (x > 0.5 ? 1 : 0) + (y > 0.5 ? 1 : 0)
    case 'STACKED_VOLUMES': return room.zone === 'private' ? 2 : room.zone === 'social' ? 0 : 1
    case 'STEPPED': return Math.min(3, Math.floor((phase % 2 ? y : x) * 4))
    case 'TWIN_WING': return x < 0.45 ? 2 : x > 0.55 ? 0 : 1
    case 'CANTILEVERED': return y > 0.5 ? 2 : 0
    case 'TERRACED': return Math.min(2, Math.floor((1 - y) * 3))
    case 'LINEAR': return Math.min(3, Math.floor((phase % 2 ? x : y) * 4))
    case 'CLUSTERED': return (x > 0.5 ? 1 : 0) + (y > 0.5 ? 2 : 0)
    case 'SPLIT_VOLUME': return x > 0.5 ? 2 : 0
    case 'PAVILION': return room.zone === 'social' ? 2 : x > 0.5 ? 1 : 0
    case 'ASYMMETRIC': return x * 0.65 + y * 0.35 > 0.55 ? 3 : 0
  }
}

export class MassingGenerator {
  static generate(building: BuildingModel, dna: VillaDesignDNA,
    options: { family?: MassingFamily | 'auto' } = {}): MassingModel {
    if (!Number.isSafeInteger(dna.seed)) throw new RangeError('Massing seed must be a safe integer')
    if (!Number.isInteger(dna.blockCount) || dna.blockCount < 2 || dna.blockCount > 4)
      throw new RangeError('Massing blockCount must be an integer from 2 to 4')
    if (!Number.isFinite(dna.recessDepth) || dna.recessDepth < 0)
      throw new RangeError('Massing recessDepth must be finite and nonnegative')
    if (dna.sourcePlanId !== building.planId) throw new Error('VillaDesignDNA belongs to a different floor plan')
    if (!building.floors.length) throw new Error('Massing requires an existing floor plan')
    const familyAssessments = assessMassingFamilies(building)
    const compatible = familyAssessments.filter((f) => f.compatible)
    const rng = makeRng(dna.seed, `${building.planId}|massing-v1`)
    const family = options.family === 'auto'
      ? compatible.length ? rng.pick(compatible).family : dna.massingFamily
      : options.family ?? dna.massingFamily
    const base = { schemaVersion: 1 as const, sourcePlanId: building.planId, seed: dna.seed,
      units: 'mm' as const, family, familyAssessments, architectureReport: null, attemptsTried: 0 }
    const match = familyAssessments.find((f) => f.family === family)
    if (!match?.compatible) return { ...base, status: 'rejected', masses: [], silhouetteSignature: null,
      issues: [{ code: 'INCOMPATIBLE_FAMILY', message: match?.reason ?? 'Unknown massing family.' }] }

    const sortedFloors = [...building.floors].sort((a, b) => a.level - b.level)
    const ground = sortedFloors[0], top = sortedFloors.at(-1)!
    const multi = sortedFloors.length > 1
    const coverage = multi ? Number((rectUnionArea(top.footprint) / rectUnionArea(ground.footprint)).toFixed(4)) : 0
    const offsetX = multi ? Math.round(top.outline.x + top.outline.w / 2 - ground.outline.x - ground.outline.w / 2) : 0
    const offsetY = multi ? Math.round(top.outline.y + top.outline.h / 2 - ground.outline.y - ground.outline.h / 2) : 0
    if (dna.upperFloorCoverage !== coverage || dna.upperFloorOffset.xMm !== offsetX || dna.upperFloorOffset.yMm !== offsetY)
      return { ...base, status: 'rejected', masses: [], silhouetteSignature: null,
        issues: [{ code: 'DNA_PLAN_CONFLICT', message: 'DNA upper-floor coverage or offset differs from the existing plan.' }] }

    const floorOf = (id: string) => building.floors.find((f) => f.id === id)!
    const rooms = [...building.rooms].filter((r) => !r.outdoor)
      .sort((a, b) => a.semanticId < b.semanticId ? -1 : a.semanticId > b.semanticId ? 1 : 0)
    const enclosed = mergeMasses(rooms.map((r): Mass => {
      const f = floorOf(r.floorId)
      return { id: `mass-${r.semanticId}`, floor: f.level, sourceFloorId: f.id, sourceRoomIds: [r.semanticId],
        x: r.rect.x, y: r.rect.y, width: r.rect.w, depth: r.rect.h, height: f.heightMm,
        elevation: f.elevationMm, rotation: 0, role: roleOf(r, f.level), parentId: null, usage: 'enclosed' }
    }))

    const candidate = (attempt: number): Mass[] => {
      const attemptRng = attempt === 0 ? rng : makeRng(dna.seed, `${building.planId}|massing-v1|retry-${attempt}`)
      // Upper room coordinates stay fixed. Exposed roof envelopes change heights
      // across whole program wings, producing real elevation silhouettes.
      const groups = dna.blockCount
      const roofHeights = Array.from({ length: groups }, (_, i) =>
        Math.round(300 + i * 1200 / (groups - 1)) + attemptRng.int(0, 500))
      const roofRecesses = Array.from({ length: groups }, () => ({
        side: attemptRng.pick(['N', 'S', 'E', 'W'] as const),
        depth: attemptRng.pick([0, dna.recessDepth, Math.min(1200, dna.recessDepth * 2)]),
      }))
      const phase = attemptRng.int(0, 3)
      const roofs: Mass[] = []
      const keepouts = [
        ...building.stairs.filter((s) => s.floorId === top.id).map((s) => s.rect),
        ...building.shafts.filter((s) => s.floorId === top.id).map((s) => s.rect),
      ]
      for (const r of rooms.filter((r) => r.floorId === top.id)) {
        const x = (r.rect.x + r.rect.w / 2 - top.outline.x) / top.outline.w
        const y = (r.rect.y + r.rect.h / 2 - top.outline.y) / top.outline.h
        const group = (roofGroup(family, x, y, r, phase) + phase) % groups
        const parent = enclosed.find((m) => m.sourceRoomIds.includes(r.semanticId))!
        const roof: Mass = { ...parent, id: `roof-${r.semanticId}`, sourceRoomIds: [r.semanticId],
          x: r.rect.x, y: r.rect.y, width: r.rect.w, depth: r.rect.h,
          elevation: top.elevationMm + top.heightMm, height: roofHeights[group],
          role: group === groups - 1 ? 'verticalFeature' : 'upperVolume', parentId: parent.id, usage: 'roof' }
        const recess = roofRecesses[group]
        const span = (['N', 'S'] as MassSide[]).includes(recess.side) ? roof.depth : roof.width
        let pieces = [stepBackMass(roof, recess.side, Math.min(recess.depth, Math.floor(span * 0.25)))]
        for (const keepout of keepouts) pieces = subtractCourtyard(pieces, keepout)
        // Cutting around a shaft may leave a hairline sliver; omit that unoccupied fragment.
        roofs.push(...pieces.filter((piece) => Math.min(piece.width, piece.depth) >= 250))
      }
      const terraces: Mass[] = building.rooms.filter((r) => r.outdoor && r.id.startsWith('balcony')).map((r) => {
        const f = floorOf(r.floorId)
        return { id: `terrace-${r.semanticId}`, sourceFloorId: f.id, sourceRoomIds: [r.semanticId],
          floor: f.level, x: r.rect.x, y: r.rect.y, width: r.rect.w, depth: r.rect.h,
          elevation: f.elevationMm - 220, height: 220, rotation: 0, role: 'terraceVolume', parentId: null, usage: 'terrace' }
      })
      const masses = [...enclosed, ...mergeMasses(roofs), ...terraces]
      for (const m of masses.filter((m) => m.usage === 'roof')) {
        if (m.parentId && !enclosed.some((p) => p.id === m.parentId)) m.parentId = null
        if (!m.parentId) m.parentId = enclosed.find((p) => p.floor === m.floor &&
          intersectRects(massRect(p), massRect(m)))?.id ?? null
      }
      return masses
    }
    const attempt = ArchitectureValidator.tryVariations(building, 8, candidate)
    const { masses, report, attemptsTried } = attempt
    return { ...base, status: report.valid ? 'valid' : 'rejected', masses,
      architectureReport: report, attemptsTried,
      issues: report.issues.map(({ code, message, massId }) => ({ code, message, ...(massId ? { massId } : {}) })),
      silhouetteSignature: report.valid ? massingSilhouetteSignature(masses) : null }
  }
}
