import { uncoveredArea } from '../../massing/families.ts'
import { massRect } from '../../massing/transforms.ts'
import { deriveWorld, intersects, openingWall, overlap, resolveAnchor, sourceOpeningBand, type GrammarContext } from './context.ts'
import { GRAMMAR_TYPES, type GrammarAssembly, type GrammarIssue, type GrammarPart } from './types.ts'

export function validateSpecializedAssemblies(ctx: GrammarContext, assemblies: GrammarAssembly[]): GrammarIssue[] {
  const issues: GrammarIssue[] = [], ids = new Set<string>()
  const add = (code: string, message: string, unit: GrammarAssembly, part?: GrammarPart) =>
    issues.push({ code, message, assemblyId: unit.id, ...(part ? { partId: part.id } : {}) })
  const { building, massing, limits } = ctx
  for (const unit of assemblies) {
    if (!GRAMMAR_TYPES[unit.category]?.some((type) => type === unit.type)) add('UNKNOWN_GRAMMAR', 'Unknown grammar category/type.', unit)
    if (ids.has(unit.id) || !unit.parts.length) add('INVALID_ASSEMBLY', 'Assembly is empty or duplicated.', unit)
    ids.add(unit.id)
    const openings = [...building.doors, ...building.windows].filter((o) => unit.openingIds.includes(o.id!))
    if (openings.length !== unit.openingIds.length || unit.sourceRoomIds.some((id) => !building.rooms.some((r) => r.semanticId === id)))
      add('INVALID_SOURCE', 'Grammar refers to a missing source room or opening.', unit)
    if (unit.category === 'ENTRANCE' && !openings.some((o) => o.kind === 'entry'))
      add('MAIN_DOOR_REQUIRED', 'Entrance must preserve the actual main door.', unit)
    if (unit.category === 'WINDOW' && (!openings.length || openings.some((o) => o.kind !== 'window' ||
      !o.rooms?.some((id) => building.rooms.some((r) => r.floorId === o.floorId && r.id === id && !r.outdoor && unit.sourceRoomIds.includes(r.semanticId))))))
      add('WINDOW_ROOM_REQUIRED', 'Every window must retain its real indoor room.', unit)
    if (unit.category === 'BALCONY' && !unit.sourceRoomIds.some((id) => building.rooms.some((r) => r.semanticId === id && r.outdoor && r.id.startsWith('balcony') &&
      openings.some((o) => o.floorId === r.floorId && o.rooms?.includes(r.id)))))
      add('BALCONY_ACCESS_REQUIRED', 'Balcony must have its source room and access door.', unit)
    for (const part of unit.parts) {
      if (ids.has(part.id)) add('DUPLICATE_PART', 'Part IDs must be unique.', unit, part)
      ids.add(part.id)
      let a: ReturnType<typeof resolveAnchor>
      try { a = resolveAnchor(ctx, part.anchor) } catch (error) { add('INVALID_ANCHOR', String(error), unit, part); continue }
      const b = part.local, r = part.world
      if (!Object.values(b).every(Number.isFinite) || Math.min(b.w, b.d, b.h) <= 0) { add('INVALID_DIMENSIONS', 'Invalid solid dimensions.', unit, part); continue }
      const derived = deriveWorld(ctx, part.anchor, b)
      if ((['x', 'y', 'w', 'h', 'z', 'height'] as const).some((key) => derived[key] !== r[key]))
        add('ARBITRARY_COORDINATES', 'Geometry must derive from its real source anchor.', unit, part)
      const env = building.plot.buildable, t = limits.toleranceMm
      if (r.x < env.x - t || r.y < env.y - t || r.x + r.w > env.x + env.w + t || r.y + r.h > env.y + env.h + t)
        add('GRAMMAR_SETBACK', 'Grammar crosses the source setback envelope.', unit, part)
      const isWall = part.anchor.kind === 'WALL'
      if (isWall && (b.u < -t || b.u + b.w > a.w + t || b.z < -t || b.z + b.h > a.h + t))
        add('HOST_SPAN', 'Part leaves its real host wall span.', unit, part)
      if (part.anchor.kind === 'BALCONY') {
        if (b.u < 0 || b.u + b.w > a.w || b.v < 0 || b.v + b.d > a.d || b.z < -220 || b.z + b.h > a.h)
          add('BALCONY_FOOTPRINT', 'Balcony treatment leaves its authoritative outdoor footprint.', unit, part)
        if (!massing.masses.some((m) => m.usage === 'terrace' && m.sourceRoomIds.includes(part.anchor.sourceId)))
          add('BALCONY_SUPPORT', 'Source balcony slab is missing.', unit, part)
      }
      if (part.anchor.kind === 'ROOF' || part.anchor.kind === 'ROOF_MASS') {
        if (uncoveredArea([r], a.rects) > t || b.z < 0 || b.z + b.h > limits.maxRoofFeatureHeightMm)
          add('ROOF_SUPPORT', 'Roof detail must stay on its real plate/cap.', unit, part)
        for (const stair of building.stairs.filter((s) => s.floorId === part.anchor.floorId)) {
          if (overlap(r.x, r.x + r.w, stair.rect.x, stair.rect.x + stair.rect.w) > t &&
            overlap(r.y, r.y + r.h, stair.rect.y, stair.rect.y + stair.rect.h) > t)
            add('STAIR_EXIT_BLOCKED', 'Roof feature blocks the source stair exit.', unit, part)
        }
        for (const shaft of building.shafts.filter((s) => s.floorId === part.anchor.floorId)) {
          if (overlap(r.x, r.x + r.w, shaft.rect.x, shaft.rect.x + shaft.rect.w) > t &&
            overlap(r.y, r.y + r.h, shaft.rect.y, shaft.rect.y + shaft.rect.h) > t)
            add('SHAFT_BLOCKED', 'Roof feature blocks a source shaft.', unit, part)
        }
      }
      const ownedMullion = unit.category === 'WINDOW' && part.role === 'frame' && b.v < 0 && openings.some((o) => {
        const wall = openingWall(ctx, o.id!)
        if (!wall || wall.id !== part.anchor.sourceId) return false
        const at = o.orient === 'h' ? o.at.x - a.x : o.at.y - a.y, band = sourceOpeningBand(o, a.h)
        return b.u >= at - o.width / 2 && b.u + b.w <= at + o.width / 2 && b.w <= 80 &&
          b.z >= band.sill && b.z + b.h <= band.head && b.d <= wall.thickness
      })
      if (part.operation === 'RECESS') {
        if (!isWall || b.v !== -b.d || b.d > ('wall' in a ? a.wall!.thickness : 0) - limits.minWallRemainderMm)
          add('INVALID_RECESS', 'Recess must carve a source wall and leave its configured rear thickness.', unit, part)
      } else {
        if (isWall && b.v < 0 && !ownedMullion) add('OCCUPIED_SPACE', 'Added depth must remain outside occupied rooms.', unit, part)
        if (isWall && b.v + b.d > (unit.type === 'CANTILEVERED_MASS' || unit.type === 'FLOATING_CANOPY' ? limits.maxCantileverMm : limits.maxProjectionMm))
          add('PROJECTION_LIMIT', 'Projection exceeds its configured limit.', unit, part)
        if (!ownedMullion) for (const mass of massing.masses.filter((m) => m.usage !== 'terrace')) {
          if (intersects(r, { ...massRect(mass), z: mass.elevation, height: mass.height }, t))
            add('OCCUPIED_MASS', 'Detail collides with source building volume.', unit, part)
        }
      }
      for (const column of building.columns) {
        const f = building.floors.find((f) => f.id === column.floorId)!, half = column.size / 2
        const balconyJoint = unit.category === 'BALCONY' && (part.role === 'slab' || part.role === 'beam') &&
          (r.z + r.height <= a.z || b.z >= a.h - 360)
        if (!balconyJoint && intersects(r, { x: column.at.x - half, y: column.at.y - half, w: column.size, h: column.size, z: f.elevationMm, height: f.heightMm }, t))
          add('COLUMN_CONFLICT', 'Detail collides with a source column.', unit, part)
      }
      for (const opening of [...building.doors, ...building.windows]) {
        const wall = openingWall(ctx, opening.id!)
        if (!wall) continue
        const f = building.floors.find((f) => f.id === opening.floorId)!, band = sourceOpeningBand(opening, f.heightMm)
        const horizontal = opening.orient === 'h'
        const along = horizontal ? opening.at.x : opening.at.y, fixed = horizontal ? opening.at.y : opening.at.x
        const u0 = horizontal ? r.x : r.y, u1 = u0 + (horizontal ? r.w : r.h)
        if (overlap(u0, u1, along - opening.width / 2 - limits.openingClearanceMm, along + opening.width / 2 + limits.openingClearanceMm) <= t ||
          overlap(r.z, r.z + r.height, f.elevationMm + band.sill, f.elevationMm + band.head) <= t) continue
        const v0 = horizontal ? r.y : r.x, v1 = v0 + (horizontal ? r.h : r.w)
        const approach = opening.kind === 'window' && unit.category === 'BALCONY' ? wall.thickness / 2 + limits.openingClearanceMm : limits.doorApproachMm
        if (overlap(v0, v1, fixed - approach, fixed + approach) <= t) continue
        const screen = unit.category === 'WINDOW' && unit.openingIds.includes(opening.id!) && part.role === 'screen' && b.w <= 70 && b.v >= 150
        if (!screen && !ownedMullion) add(opening.kind === 'window' ? 'WINDOW_CONFLICT' : 'DOOR_ACCESS_CONFLICT',
          'Detail obstructs an authoritative opening or its clear approach.', unit, part)
      }
      for (const feature of ctx.facade.features) for (const p of feature.parts) if (intersects(r, p.world, t))
        add('HERO_CONFLICT', 'Specialized detail intersects an existing architectural feature.', unit, part)
    }
  }
  for (let i = 0; i < assemblies.length; i++) for (let j = i + 1; j < assemblies.length; j++)
    for (const a of assemblies[i].parts) for (const b of assemblies[j].parts)
      if (intersects(a.world, b.world, limits.toleranceMm)) add('ASSEMBLY_CONFLICT', 'Two grammar assemblies intersect.', assemblies[j], b)
  return issues
}
