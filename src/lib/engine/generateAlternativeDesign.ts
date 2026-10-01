import type { Design } from './types.ts'
import { validate } from '../rules/index.ts'
import { createBuildingModel } from './buildingModel.ts'
import { createVillaDesignDNA } from './villaDesignDna.ts'
import { MassingGenerator } from './massing/MassingGenerator.ts'
import { ArchitectureValidator, type ArchitectureLimits } from './massing/ArchitectureValidator.ts'
import { MASSING_FAMILIES, type Mass, type MassingFamily } from './massing/model.ts'
import { makeRng } from './massing/rng.ts'
import { subtractCourtyard, massRect } from './massing/transforms.ts'
import { intersectRects } from './massing/families.ts'
import { massingSilhouetteSignature } from './massing/validate.ts'
import { ArchitecturalFeatureGenerator } from './facade/ArchitecturalFeatureGenerator.ts'
import { createVillaShapeFingerprint } from './fingerprint/VillaShapeFingerprint.ts'
import { sharedEdge } from '../geometry.ts'
import { DEFAULT_ENVELOPE_LIMITS } from './massing/envelopeLimits.ts'

/** Central concept limits. These are geometric checks, not engineering certification. */
export const ENVELOPE_LIMITS: ArchitectureLimits = { ...DEFAULT_ENVELOPE_LIMITS }
type Block = [number, number, number, number, number, number?]

/** Rectangles are disjoint in XYZ. Dimensions are ratios of the actual roof plate.
 * These describe unoccupied envelope compositions, not new occupied floor plans. */
function composition(family: MassingFamily, h: number): Block[] {
  switch (family) {
    case 'L_SHAPED': return [[0, 0, .32, 1, h], [.32, .68, .68, .32, h]]
    case 'U_SHAPED': return [[0, 0, .25, 1, h], [.75, 0, .25, 1, h], [.25, 0, .5, .26, h * .65]]
    case 'COURTYARD': return [[0, 0, .25, 1, h], [.75, 0, .25, 1, h], [.25, 0, .5, .25, h], [.25, .75, .5, .25, h]]
    case 'OFFSET_BLOCKS': return [[0, 0, .56, .48, h], [.4, .56, .6, .44, h * .65]]
    case 'INTERLOCKING_BLOCKS': return [[0, .3, .36, .65, h * .65], [.36, .05, .3, .85, h], [.66, .05, .34, .38, h * .5]]
    case 'STACKED_VOLUMES': return [[.08, .12, .84, .76, h * .35], [.28, .28, .45, .42, h * .65, h * .35]]
    case 'STEPPED': return [[0, 0, .33, .85, h], [.33, .15, .34, .7, h * .65], [.67, .3, .33, .55, h * .3]]
    case 'TWIN_WING': return [[0, 0, .3, 1, h], [.7, 0, .3, 1, h * .7]]
    case 'CANTILEVERED': return [[.15, .16, .62, .68, h * .4], [.18, .16, .65, .68, h * .6, h * .4]]
    case 'TERRACED': return [[0, 0, 1, .32, h], [.1, .32, .8, .3, h * .62], [.23, .62, .54, .25, h * .25]]
    case 'LINEAR': return [[.08, .32, .84, .28, h]]
    case 'CLUSTERED': return [[.02, .02, .32, .34, h], [.6, .02, .35, .34, h * .5], [.04, .6, .34, .34, h * .65], [.64, .6, .32, .34, h * .85]]
    case 'SPLIT_VOLUME': return [[0, .12, .42, .78, h], [.64, .2, .36, .66, h * .6]]
    case 'PAVILION': return [[.28, .24, .44, .5, h]]
    case 'ASYMMETRIC': return [[.02, .02, .28, .9, h], [.3, .6, .68, .32, h * .35], [.55, .05, .4, .3, h * .6]]
  }
}

/** Exact-seed production adapter. No call to the floor-plan generator is made.
 * Occupied plates, rooms, walls, stairs and openings remain byte-for-byte fixed. */
export function generateAlternativeDesign(plan: Design, seed: number) {
  if (!Number.isSafeInteger(seed)) throw new RangeError('Architectural seed must be a safe integer')
  if (!validate(plan).hardChecksPass) throw new Error('The source 2D plan has failed validation')
  const buildingModel = createBuildingModel(plan)
  const villaDesignDNA = createVillaDesignDNA(buildingModel, seed, plan.model.brief.style.character)
  const base = MassingGenerator.generate(buildingModel, villaDesignDNA)
  ArchitectureValidator.assertReadyForGeometry(buildingModel, base)
  const top = [...buildingModel.floors].sort((a, b) => a.level - b.level).at(-1)!
  const rng = makeRng(seed, `${buildingModel.planId}|plan-envelope-v1`)
  // A numeric seed selects composition; separate seeded draws determine orientation,
  // proportion, height and position. No material choice drives geometry.
  const family = MASSING_FAMILIES[((seed % MASSING_FAMILIES.length) + MASSING_FAMILIES.length) % MASSING_FAMILIES.length]
  const rotation = rng.int(0, 3), height = rng.int(2100, 3200)
  const margin = rng.range(.01, .1), scale = 1 - margin * 2
  const occupied = base.masses.filter((m) => m.usage !== 'roof')
  const ground = [...buildingModel.floors].sort((a, b) => a.level - b.level)[0]
  const frontY = ground.outline.y + ground.outline.h
  const protectedOutdoor = [...buildingModel.rooms.filter((r) => r.floorId === ground.id && r.outdoor).map((r) => r.rect), ...(buildingModel.siteFeatures ?? []).filter(f => f.kind !== 'lawn').map(f => f.rect)]
  const xStops = [...new Set([buildingModel.plot.buildable.x, buildingModel.plot.buildable.x + buildingModel.plot.buildable.w,
    ...protectedOutdoor.flatMap((r) => [r.x, r.x + r.w])])].sort((a, b) => a - b)
  const forecourts = xStops.slice(0, -1).map((x, i) => ({ x: x + 300, y: frontY,
    w: xStops[i + 1] - x - 600, h: Math.min(4800, buildingModel.plot.buildable.y + buildingModel.plot.buildable.h - frontY - 300) }))
    .filter((r) => r.w >= 1800 && r.h >= 2200 && !protectedOutdoor.some((p) => intersectRects(r, p)))
    .sort((a, b) => b.w * b.h - a.w * a.h)
  const additions: Mass[] = []
  const forecourt = forecourts[0]
  if (forecourt) {
    const rect = { ...forecourt, w: Math.min(5500, forecourt.w), h: Math.round(forecourt.h * rng.range(.55, 1)) }
    const canopyFloors = buildingModel.floors.filter((f) => f.elevationMm + f.heightMm - 220 <= DEFAULT_ENVELOPE_LIMITS.maxSupportHeightMm)
    const level = rng.pick(canopyFloors).level
    const host = occupied.filter((m) => m.usage === 'enclosed' && m.floor === level &&
      (sharedEdge(massRect(m), rect)?.length ?? 0) >= Math.min(rect.w, rect.h) * .5)[0]
    const groundHost = occupied.find((m) => m.usage === 'enclosed' && m.floor === ground.level)
    if (host && groundHost) {
      const elevation = host.elevation + host.height - 220
      for (const [index, x] of [rect.x, rect.x + rect.w - 250].entries()) additions.push({ ...groundHost,
        id: `exterior-pier-${index}`, x, y: rect.y + rect.h - 250, width: 250, depth: 250,
        elevation: ground.elevationMm, height: elevation - ground.elevationMm, role: 'verticalFeature', usage: 'support', parentId: null })
      additions.push({ ...host, id: 'forecourt-canopy', x: rect.x, y: rect.y, width: rect.w, depth: rect.h,
        elevation, height: 220, role: 'livingWing', usage: 'canopy', parentId: host.id,
        bearingSupports: additions.map((m) => m.id) })
    }
  }
  const keepouts = [...buildingModel.stairs, ...buildingModel.shafts].filter((s) => s.floorId === top.id).map((s) => s.rect)
  // Keep a real 1 m route from the stair exit to the south edge of the roof.
  const stair = buildingModel.stairs.find((s) => s.floorId === top.id)
  if (stair) keepouts.push({ x: stair.rect.x + Math.max(0, (stair.rect.w - 1000) / 2),
    y: stair.rect.y, w: 1000, h: top.outline.y + top.outline.h - stair.rect.y })
  const candidate = (attempt: number): Mass[] => {
    let roofs: Mass[] = []
    const blocks = composition(family, height - attempt * 40)
    blocks.forEach(([bx, by, bw, bd, bh, lift = 0], index) => {
      let x = bx, y = by, w = bw, d = bd
      for (let turn = 0; turn < rotation; turn++) [x, y, w, d] = [1 - y - d, x, d, w]
      const rect = { x: Math.round(top.outline.x + (margin + x * scale) * top.outline.w),
        y: Math.round(top.outline.y + (margin + y * scale) * top.outline.h),
        w: Math.round(w * scale * top.outline.w), h: Math.round(d * scale * top.outline.h) }
      for (const plate of top.footprint) {
        const clipped = intersectRects(rect, plate)
        if (!clipped) continue
        const sources = buildingModel.rooms.filter((r) => r.floorId === top.id && !r.outdoor && intersectRects(r.rect, clipped))
        const host = occupied.find((m) => m.sourceFloorId === top.id && m.usage === 'enclosed' && intersectRects(massRect(m), clipped))
        if (!host || !sources.length) continue
        const mass: Mass = { ...host, id: `envelope-${index}-${roofs.length}`, x: clipped.x, y: clipped.y,
          width: clipped.w, depth: clipped.h, height: Math.round(bh), elevation: top.elevationMm + top.heightMm + Math.round(lift),
          rotation: 0, usage: 'roof', shell: true, role: bh > height * .8 ? 'verticalFeature' : 'upperVolume',
          parentId: host.id, sourceRoomIds: sources.map((r) => r.semanticId) }
        let pieces = [mass]
        for (const cut of keepouts) pieces = subtractCourtyard(pieces, cut)
        roofs.push(...pieces.filter((m) => Math.min(m.width, m.depth) >= 500))
      }
    })
    // Source plates can split the bearing mass; attach lifted envelopes to a real host.
    // Adjacent normalized bands can round to a 1 mm overlap. Bake their
    // differences instead of permitting positive intersections in validation.
    const disjoint: Mass[] = []
    for (const mass of roofs) {
      let pieces = [mass]
      for (const prior of disjoint) if (Math.min(mass.elevation + mass.height, prior.elevation + prior.height) >
        Math.max(mass.elevation, prior.elevation)) pieces = subtractCourtyard(pieces, massRect(prior))
      disjoint.push(...pieces.filter((m) => Math.min(m.width, m.depth) >= 500))
    }
    roofs = disjoint.map((m) => ({ ...m, parentId: disjoint.find((p) => p.id !== m.id &&
      p.elevation + p.height === m.elevation && intersectRects(massRect(p), massRect(m)))?.id ?? m.parentId }))
    if (!roofs.length) throw new Error('Roof is too small for an architectural envelope')
    // An optional forecourt treatment may conflict with a source upper plate.
    // Reject that operation and retain the deterministic roof composition.
    return [...occupied, ...roofs, ...(attempt === 0 ? additions : [])]
  }
  const attempt = ArchitectureValidator.tryVariations(buildingModel, 4, candidate, ENVELOPE_LIMITS)
  if (!attempt.report.valid) throw new Error(`Envelope rejected: ${attempt.report.issues.map((i) => i.code).join(', ')}`)
  const massingModel = { ...base, family, generationMode: 'plan-envelope-v1' as const,
    architectureLimits: { ...ENVELOPE_LIMITS }, masses: attempt.masses, architectureReport: attempt.report,
    attemptsTried: attempt.attemptsTried, issues: [], silhouetteSignature: massingSilhouetteSignature(attempt.masses) }
  villaDesignDNA.massingFamily = family
  villaDesignDNA.roofType = 'flat-terrace'
  const actualBlocks = massingModel.masses.filter((m) => m.usage === 'roof')
  const area = actualBlocks.reduce((sum, m) => sum + m.width * m.depth, 0)
  villaDesignDNA.blockCount = actualBlocks.length
  villaDesignDNA.blockRatios = actualBlocks.map((m) => m.width * m.depth / area)
  villaDesignDNA.blockOffsets = actualBlocks.map((m) => ({ xMm: Math.round(m.x + m.width / 2 - top.outline.x - top.outline.w / 2),
    yMm: Math.round(m.y + m.depth / 2 - top.outline.y - top.outline.h / 2) }))
  villaDesignDNA.blockRotations = actualBlocks.map((m) => m.rotation)
  const facadeGrammar = ArchitecturalFeatureGenerator.generate(buildingModel, villaDesignDNA, massingModel)
  if (facadeGrammar.status !== 'valid') throw new Error(`Facade rejected: ${JSON.stringify(facadeGrammar.issues)}`)
  return { schemaVersion: 1 as const, buildingModel, villaDesignDNA, massingModel, facadeGrammar,
    shapeFingerprint: createVillaShapeFingerprint(buildingModel, villaDesignDNA, massingModel, facadeGrammar) }
}
