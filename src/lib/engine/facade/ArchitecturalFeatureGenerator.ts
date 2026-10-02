import type { BuildingModel } from '../buildingModel.ts'
import type { VillaDesignDNA } from '../villaDesignDna.ts'
import { ArchitectureValidator } from '../massing/ArchitectureValidator.ts'
import type { MassingModel } from '../massing/model.ts'
import { makeRng, type Rng } from '../massing/rng.ts'
import { buildFacadeZones, freeFacadeSpans, validateProceduralFeatures, worldPart } from './FacadeGrammar.ts'
import { ARCHITECTURAL_FAMILIES, ARCHITECTURAL_FAMILY_RECIPES, architecturalFamilyFitsPlan,
  type ArchitecturalFamily, type ArchitecturalFamilyRecipe } from './architecturalFamilies.ts'
import { SpecializedGrammarGenerator } from './specialized/SpecializedGrammarGenerator.ts'
import type { GrammarLimits, GrammarOptions } from './specialized/types.ts'
import { type ArchitecturalFeature, type ArchitecturalFeatureType,
  type FacadeZone, type FeaturePart, type FrameParameters, type ProceduralFacadeModel } from './proceduralTypes.ts'

export type FeatureGenerationOptions = {
  usableTerrace?: boolean
  architecturalFamily?: ArchitecturalFamily
  heroFeature?: ArchitecturalFeatureType
  supportingFeatures?: ArchitecturalFeatureType[]
  specialized?: GrammarOptions
  grammarLimits?: Partial<GrammarLimits>
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))
const area = (z: FacadeZone) => z.endMm - z.startMm
const near = (a: number, b: number) => Math.abs(a - b) <= 2

function eligible(type: ArchitecturalFeatureType, zone: FacadeZone): boolean {
  if (type === 'ENTRY_PORTAL' || type === 'DOUBLE_HEIGHT_PORTAL') return zone.kind === 'ENTRANCE'
  if (type === 'COURTYARD_SCREEN') return zone.kind === 'VOID'
  if (type === 'BRIDGE_VOLUME' || type === 'ROOF_FRAME') return zone.kind === 'ROOFLINE'
  if (type === 'PERGOLA_FRAME') return zone.kind === 'ROOFLINE' || zone.kind === 'BALCONY'
  if (type === 'DEEP_OVERHANG') return ['ENTRANCE', 'PRIMARY', 'BALCONY', 'UPPER'].includes(zone.kind)
  if (type === 'VERTICAL_TOWER') return ['STAIR_TOWER', 'PRIMARY', 'UPPER'].includes(zone.kind)
  if (type === 'STONE_SPINE' || type === 'WOOD_SPINE')
    return ['STAIR_TOWER', 'PRIMARY', 'SECONDARY', 'UPPER'].includes(zone.kind)
  if (type === 'JALI_SCREEN' || type === 'VERTICAL_FIN_SCREEN' || type === 'HORIZONTAL_LOUVER')
    return ['PRIMARY', 'SECONDARY', 'STAIR_TOWER', 'UPPER', 'VOID', 'BALCONY'].includes(zone.kind)
  return ['PRIMARY', 'SECONDARY', 'UPPER', 'STAIR_TOWER'].includes(zone.kind)
}

/** Each recipe receives an actual wall/roof zone and emits local face solids. */
function makeFeature(type: ArchitecturalFeatureType, importance: 'hero' | 'support',
  zone: FacadeZone, zones: FacadeZone[], building: BuildingModel, dna: VillaDesignDNA,
  rng: Rng, serial: number, recipe: ArchitecturalFamilyRecipe): ArchitecturalFeature | null {
  const id = `${importance}:${serial}:${type}`
  const parts: FeaturePart[] = []
  const used = new Set([zone.id])
  const add = (host: FacadeZone, role: FeaturePart['role'], u0: number, u1: number,
    z0: number, z1: number, depth: number, offset = 0) => {
    used.add(host.id)
    parts.push(worldPart(host, `${id}:part:${parts.length}`, role,
      Math.round(u0), Math.round(u1), Math.round(z0), Math.round(z1), Math.round(offset), Math.round(depth)))
  }
  const openSide = rng.pick(['LEFT', 'RIGHT'] as const)
  let params: FrameParameters | null = null
  const free = freeFacadeSpans(zone, building).sort((a, b) => b[1] - b[0] - (a[1] - a[0]))[0]
  const zBase = zone.elevationMm, zTop = zBase + zone.heightMm
  const depth = clamp(Math.round(dna.projectionDepth * recipe.projectionScale), 350, 1500)
  const band = (minWidth = 1200, ratio = rng.range(...recipe.spanRatio)) => {
    if (!free || free[1] - free[0] < minWidth) return null
    const width = Math.max(minWidth, Math.round((free[1] - free[0]) * ratio))
    const spare = free[1] - free[0] - width
    const offsetRatio = rng.range(-0.7, 0.7)
    const u0 = Math.round(free[0] + spare * (1 + offsetRatio) / 2)
    return { u0, u1: u0 + width, widthRatio: width / area(zone), offsetRatio }
  }

  if (['C_FRAME', 'L_FRAME', 'RECTANGLE_FRAME', 'FLOATING_FRAME', 'DOUBLE_HEIGHT_FRAME'].includes(type)) {
    const upper = type === 'DOUBLE_HEIGHT_FRAME' ? zones.find((z) => z.floorId !== zone.floorId &&
      z.elevationMm === zTop && z.side === zone.side && near(z.fixedMm, zone.fixedMm) &&
      Math.min(z.endMm, zone.endMm) - Math.max(z.startMm, zone.startMm) >= 1400) : undefined
    if (type === 'DOUBLE_HEIGHT_FRAME' && !upper) return null
    const freeUpper = upper && freeFacadeSpans(upper, building).find(([a, b]) =>
      free && Math.min(b, free[1]) - Math.max(a, free[0]) >= 1400)
    const usable = freeUpper && free ? [Math.max(free[0], freeUpper[0]), Math.min(free[1], freeUpper[1])] as [number, number] : free
    if (!usable || usable[1] - usable[0] < 1400) return null
    const widthRatio = rng.range(...recipe.spanRatio)
    const width = Math.round((usable[1] - usable[0]) * widthRatio)
    if (width / area(zone) < 0.25) return null
    const offsetRatio = rng.range(-0.6, 0.6)
    const u0 = Math.round(usable[0] + ((usable[1] - usable[0] - width) / 2) * (1 + offsetRatio))
    const u1 = u0 + width
    const thickness = clamp(Math.round(width * rng.range(0.055, 0.09)), 140, 300)
    const heightRatio = rng.range(0.72, 0.94)
    const bottom = zBase + Math.round((type === 'FLOATING_FRAME' ? 0.28 : 0.08) * zone.heightMm)
    const topZone = upper ?? zone
    const top = topZone.elevationMm + Math.round(topZone.heightMm * heightRatio)
    const projection = Math.max(350, Math.round(depth * rng.range(0.72, 1)))
    params = { widthRatio: width / area(zone), heightRatio, thicknessMm: thickness,
      projectionMm: projection, offsetRatio, openSide }
    add(zone, 'beam', u0, u1, bottom, bottom + thickness, projection)
    if (upper) {
      add(zone, 'post', u0, u0 + thickness, bottom + thickness, zTop, projection)
      add(zone, 'post', u1 - thickness, u1, bottom + thickness, zTop, projection)
      add(upper, 'post', u0, u0 + thickness, zTop, top - thickness, projection)
      add(upper, 'post', u1 - thickness, u1, zTop, top - thickness, projection)
      add(upper, 'beam', u0, u1, top - thickness, top, projection)
    } else {
      if (type !== 'L_FRAME' && type !== 'C_FRAME') add(zone, 'post', u1 - thickness, u1, bottom + thickness, top - thickness, projection)
      if (type === 'L_FRAME' || type === 'C_FRAME') {
        const left = openSide === 'RIGHT'
        add(zone, 'post', left ? u0 : u1 - thickness, left ? u0 + thickness : u1,
          bottom + thickness, top - thickness, projection)
      } else add(zone, 'post', u0, u0 + thickness, bottom + thickness, top - thickness, projection)
      add(zone, 'beam', u0, u1, top - thickness, top, projection)
    }
    if (type === 'L_FRAME') parts.splice(0, 1) // an L has the upper beam and one upright
  } else if (type === 'CORNER_WRAP_FRAME') {
    const adjacent = zones.find((z) => z.floorId === zone.floorId && z.id !== zone.id &&
      (z.side === 'N' || z.side === 'S') !== (zone.side === 'N' || zone.side === 'S') &&
      (zone.side === 'N' || zone.side === 'S'
        ? near(z.fixedMm, zone.startMm) || near(z.fixedMm, zone.endMm)
        : near(zone.fixedMm, z.startMm) || near(zone.fixedMm, z.endMm)) &&
      (z.side === 'N' || z.side === 'S'
        ? near(zone.fixedMm, z.startMm) || near(zone.fixedMm, z.endMm)
        : near(z.fixedMm, zone.startMm) || near(z.fixedMm, zone.endMm)))
    if (!adjacent) return null
    const closest = (host: FacadeZone, corner: number) => freeFacadeSpans(host, building)
      .filter(([lo, hi]) => hi - lo >= 850)
      .sort((a, b) => Math.min(Math.abs(a[0] - corner), Math.abs(a[1] - corner)) -
        Math.min(Math.abs(b[0] - corner), Math.abs(b[1] - corner)))[0]
    const a = closest(zone, adjacent.fixedMm)
    const b = closest(adjacent, zone.fixedMm)
    if (!a || !b) return null
    const t = 160, z0 = zBase + 350, z1 = zTop - 250
    for (const [host, [lo, hi], corner] of [[zone, a, adjacent.fixedMm],
      [adjacent, b, zone.fixedMm]] as const) {
      const left = Math.abs(lo - corner) < Math.abs(hi - corner)
      const gap = left ? lo - corner : corner - hi
      if (gap < 0 || gap > 700) return null
      const u0 = left ? lo : hi - 840, u1 = u0 + 840
      add(host, 'post', left ? u0 : u1 - t, left ? u0 + t : u1, z0, z1, depth)
      add(host, 'beam', u0, u1, z1 - t, z1, depth)
      if (gap > 0) add(host, 'beam', left ? corner : hi, left ? lo : corner,
        z1 - t, z1, depth, 250)
    }
  } else if (type === 'ENTRY_PORTAL' || type === 'DOUBLE_HEIGHT_PORTAL') {
    const entry = building.doors.find((o) => o.kind === 'entry' && !!o.id && zone.openingIds.includes(o.id))
    if (!entry) return null
    const at = zone.side === 'N' || zone.side === 'S' ? entry.at.x : entry.at.y
    const jamb = clamp(Math.round(entry.width * 0.15), 160, 230)
    const u0 = Math.round(at - entry.width / 2 - jamb - 210)
    const u1 = Math.round(at + entry.width / 2 + jamb + 210)
    if (u0 < zone.startMm + 100 || u1 > zone.endMm - 100) return null
    const upper = type === 'DOUBLE_HEIGHT_PORTAL' ? zones.find((z) => z.elevationMm === zTop &&
      z.side === zone.side && near(z.fixedMm, zone.fixedMm) && u0 >= z.startMm && u1 <= z.endMm) : undefined
    if (type === 'DOUBLE_HEIGHT_PORTAL' && !upper) return null
    const projection = Math.max(500, depth)
    const head = upper ? upper.elevationMm + Math.round(upper.heightMm * 0.87) : zTop - 230
    const firstTop = upper ? zTop : head - 180
    add(zone, 'post', u0, u0 + jamb, zBase, firstTop, projection)
    add(zone, 'post', u1 - jamb, u1, zBase, firstTop, projection)
    if (upper) {
      add(upper, 'post', u0, u0 + jamb, zTop, head - 180, projection)
      add(upper, 'post', u1 - jamb, u1, zTop, head - 180, projection)
      add(upper, 'beam', u0, u1, head - 180, head, projection)
    } else add(zone, 'beam', u0, u1, head - 180, head, projection)
  } else if (type === 'BRIDGE_VOLUME') {
    const other = zones.find((z) => z.kind === 'ROOFLINE' && z.id !== zone.id &&
      z.floorId === zone.floorId && z.side === zone.side && near(z.fixedMm, zone.fixedMm) &&
      z.startMm > zone.endMm + 250 && z.startMm - zone.endMm <= 3000 &&
      Math.abs(z.elevationMm - zBase) < 700)
    if (!other) return null
    used.add(other.id)
    const z0 = Math.max(zBase, other.elevationMm) + 180
    add(zone, 'post', zone.endMm - 280, zone.endMm, zone.elevationMm, z0, depth)
    add(other, 'post', other.startMm, other.startMm + 280, other.elevationMm, z0, depth)
    add(zone, 'box', zone.endMm - 280, other.startMm + 280, z0, z0 + 420, depth)
  } else {
    const selected = band(type === 'JALI_SCREEN' ? 1500 : 1050)
    if (!selected) return null
    const { u0, u1 } = selected
    const width = u1 - u0
    const z0 = zBase + Math.round(zone.heightMm * (type === 'FLOATING_BOX' ? 0.38 : 0.12))
    const z1 = zBase + Math.round(zone.heightMm * 0.88)
    const t = clamp(Math.round(width * 0.06), 110, 220)
    if (type === 'PROJECTED_BOX' || type === 'FLOATING_BOX')
      add(zone, 'box', u0, u1, z0, z1, depth)
    else if (type === 'RECESSED_BOX') {
      add(zone, 'panel', u0 + t, u1 - t, z0 + t, z1 - t, 180)
      add(zone, 'beam', u0, u1, z0, z0 + t, depth)
      add(zone, 'beam', u0, u1, z1 - t, z1, depth)
      add(zone, 'post', u0, u0 + t, z0 + t, z1 - t, depth)
      add(zone, 'post', u1 - t, u1, z0 + t, z1 - t, depth)
    } else if (type === 'INTERLOCKING_BOX') {
      const mid = Math.round((u0 + u1) / 2)
      add(zone, 'box', u0, mid, z0, z0 + (z1 - z0) * 0.7, depth)
      add(zone, 'box', mid, u1, z0 + (z1 - z0) * 0.3, z1, Math.max(350, depth * 0.65))
    } else if (type === 'STONE_SPINE' || type === 'WOOD_SPINE' || type === 'VERTICAL_TOWER') {
      const center = Math.round((u0 + u1) / 2)
      const spineWidth = clamp(Math.round(width * (type === 'VERTICAL_TOWER' ? 0.5 : 0.34)), 450, 1350)
      const left = center - spineWidth / 2
      if (type === 'WOOD_SPINE') {
        for (let i = 0; i < 5; i++) {
          const u = left + spineWidth * (i + 0.5) / 5
          add(zone, 'screen', u - 45, u + 45, zBase + 120, zTop - 120, depth)
        }
      } else add(zone, 'box', left, left + spineWidth,
        zBase + 120, zTop - 120, type === 'VERTICAL_TOWER' ? Math.max(depth, 700) : depth)
    } else if (type === 'JALI_SCREEN' || type === 'COURTYARD_SCREEN' || type === 'VERTICAL_FIN_SCREEN') {
      const count = type === 'VERTICAL_FIN_SCREEN' ? clamp(Math.floor(width / 260), 4, 9) :
        clamp(Math.floor(width / 360), 4, 8)
      if (type !== 'VERTICAL_FIN_SCREEN') {
        add(zone, 'beam', u0, u1, z0, z0 + t, depth)
        add(zone, 'beam', u0, u1, z1 - t, z1, depth)
      }
      for (let i = 0; i < count; i++) {
        const u = Math.round(u0 + t + (width - 2 * t) * (i + 0.5) / count)
        add(zone, 'screen', u - 35, u + 35, z0 + t, z1 - t, depth)
      }
      if (type === 'JALI_SCREEN' || type === 'COURTYARD_SCREEN')
        for (let i = 1; i <= 3; i++) {
          const z = Math.round(z0 + (z1 - z0) * i / 4)
          add(zone, 'screen', u0 + t, u1 - t, z - 35, z + 35, depth)
        }
    } else if (type === 'HORIZONTAL_LOUVER') {
      for (let i = 0; i < 5; i++) {
        const z = Math.round(z0 + (z1 - z0) * (i + 1) / 6)
        add(zone, 'screen', u0, u1, z, z + 90, depth)
      }
    } else if (type === 'DEEP_OVERHANG') {
      add(zone, 'slab', u0, u1, zTop - 320, zTop - 150, Math.max(depth, 800))
    } else if (type === 'PERGOLA_FRAME' || type === 'ROOF_FRAME') {
      const top = zTop - 130
      const footing = zone.kind === 'ROOFLINE' ? zBase : zBase + 100
      add(zone, 'post', u0, u0 + t, footing, top, depth)
      add(zone, 'post', u1 - t, u1, footing, top, depth)
      add(zone, 'beam', u0, u1, top, top + 130, depth)
      if (type === 'PERGOLA_FRAME') for (let i = 1; i <= 3; i++) {
        const u = Math.round(u0 + width * i / 4)
        add(zone, 'beam', u - 45, u + 45, top - 120, top, depth + 300)
      }
    }
  }
  if (!parts.length) return null
  return { id, type, importance, zoneIds: [...used], parameters: params, parts }
}

export class ArchitecturalFeatureGenerator {
  static generate(building: BuildingModel, dna: VillaDesignDNA, massing: MassingModel,
    options: FeatureGenerationOptions = {}): ProceduralFacadeModel {
    if (options.supportingFeatures && options.supportingFeatures.length > 2)
      throw new RangeError('A villa can have at most two supporting features')
    if (dna.sourcePlanId !== building.planId || massing.sourcePlanId !== building.planId)
      throw new Error('Facade inputs belong to different source plans')
    const selectedFamily = options.architecturalFamily ?? dna.architecturalFamily
    const base = { schemaVersion: 2 as const, sourcePlanId: building.planId,
      massingSeed: dna.seed, architecturalFamily: selectedFamily,
      zones: [] as FacadeZone[], features: [] as ArchitecturalFeature[] }
    if (!ARCHITECTURAL_FAMILIES.includes(selectedFamily)) throw new RangeError('Unknown architectural family')
    if (!architecturalFamilyFitsPlan(building, selectedFamily))
      return { ...base, status: 'rejected', attemptsTried: 0,
        issues: [{ code: 'FAMILY_INCOMPATIBLE', message: `${selectedFamily} requires a real source courtyard.` }] }
    try { ArchitectureValidator.assertReadyForGeometry(building, massing) }
    catch (error) { return { ...base, status: 'rejected', attemptsTried: 0,
      issues: [{ code: 'INVALID_MASSING', message: error instanceof Error ? error.message : 'Massing failed validation.' }] } }
    const zones = buildFacadeZones(building, massing)
    const seedRng = makeRng(dna.seed, `${building.planId}|facade-features-v2`)
    // Automatic fallback changes the reported family too; a label is never kept
    // when its defining host geometry cannot fit the actual plan.
    const fallbackFamilies = ARCHITECTURAL_FAMILIES.filter((family) =>
      family !== selectedFamily && architecturalFamilyFitsPlan(building, family))
      .map((family) => ({ family, key: seedRng.next() }))
      .sort((a, b) => a.key - b.key).map(({ family }) => family)
    const families = options.architecturalFamily || options.heroFeature
      ? [selectedFamily] : [selectedFamily, ...fallbackFamilies]
    let attemptsTried = 0
    for (const family of families) {
      const recipe = ARCHITECTURAL_FAMILY_RECIPES[family]
      for (const type of options.heroFeature ? [options.heroFeature] : recipe.heroes) {
        const candidates = zones.filter((zone) => eligible(type, zone) && (!options.usableTerrace || zone.kind !== 'ROOFLINE'))
          .map((zone) => ({ zone, key: makeRng(dna.seed, `facade-zone|${family}|${type}|${zone.id}`).next() }))
          .sort((a, b) => b.zone.endMm - b.zone.startMm - (a.zone.endMm - a.zone.startMm) || a.key - b.key)
        for (const { zone } of candidates) {
          attemptsTried++
          const rng = makeRng(dna.seed, `${building.planId}|${family}|${type}|${zone.id}`)
          const hero = makeFeature(type, 'hero', zone, zones, building, dna, rng, 0, recipe)
          if (!hero || validateProceduralFeatures(building, massing, zones, [hero]).length) continue
          const features = [hero]
          const supportRng = makeRng(dna.seed, `${building.planId}|${family}|supports`)
          const wanted = options.supportingFeatures ?? [...recipe.supports]
            .filter(() => supportRng.range(0, 1) < 0.85)
          for (const supportType of wanted.slice(0, 2)) {
            if (supportType === type || features.some((f) => f.type === supportType)) continue
            for (const host of zones.filter((z) => eligible(supportType, z) && (!options.usableTerrace || z.kind !== 'ROOFLINE') && !features.some((f) => f.zoneIds.includes(z.id)))
              .sort((a, b) => area(b) - area(a))) {
              const candidate = makeFeature(supportType, 'support', host, zones, building, dna,
                makeRng(dna.seed, `${building.planId}|${family}|support|${supportType}|${host.id}`), features.length, recipe)
              if (candidate && !validateProceduralFeatures(building, massing, zones, [...features, candidate]).length) {
                features.push(candidate); break
              }
            }
          }
          const result: ProceduralFacadeModel = { ...base, architecturalFamily: family, zones, features, status: 'valid', attemptsTried, issues: [] }
          result.specialized = SpecializedGrammarGenerator.generate(building, dna, massing, result,
            options.usableTerrace ? { ...options.specialized, ROOFLINE: 'FLAT_PARAPET' } : options.specialized, options.grammarLimits)
          if (result.specialized.status === 'rejected') {
            result.status = 'rejected'
            result.issues = result.specialized.issues.map((issue) => ({ code: issue.code, message: issue.message }))
          }
          if (result.status === 'rejected') continue
          return result
        }
      }
    }
    return { ...base, zones, status: 'rejected', attemptsTried,
      issues: [{ code: 'HERO_UNAVAILABLE', message: options.heroFeature
        ? `${options.heroFeature} has no opening-safe, setback-safe real facade host.`
        : `No ${selectedFamily} hero feature fits the validated exterior facades.` }] }
  }
}
