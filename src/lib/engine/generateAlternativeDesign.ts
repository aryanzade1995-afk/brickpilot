import type { Design } from './types.ts'
import { validate } from '../rules/index.ts'
import { createBuildingModel } from './buildingModel.ts'
import { createVillaDesignDNA } from './villaDesignDna.ts'
import { MassingGenerator } from './massing/MassingGenerator.ts'
import { ArchitectureValidator, type ArchitectureLimits } from './massing/ArchitectureValidator.ts'
import { MASSING_FAMILIES, type Mass } from './massing/model.ts'
import { makeRng } from './massing/rng.ts'
import { massRect } from './massing/transforms.ts'
import { intersectRects } from './massing/families.ts'
import { massingSilhouetteSignature } from './massing/validate.ts'
import { ArchitecturalFeatureGenerator } from './facade/ArchitecturalFeatureGenerator.ts'
import { createVillaShapeFingerprint } from './fingerprint/VillaShapeFingerprint.ts'
import { sharedEdge } from '../geometry.ts'
import { DEFAULT_ENVELOPE_LIMITS } from './massing/envelopeLimits.ts'

/** Central concept limits. These are geometric checks, not engineering certification. */
export const ENVELOPE_LIMITS: ArchitectureLimits = { ...DEFAULT_ENVELOPE_LIMITS }
/** Exact-seed production adapter. No call to the floor-plan generator is made.
 * Occupied plates, rooms, walls, stairs and openings remain byte-for-byte fixed. */
export function generateAlternativeDesign(plan: Design, seed: number) {
  if (!Number.isSafeInteger(seed)) throw new RangeError('Architectural seed must be a safe integer')
  if (!validate(plan).hardChecksPass) throw new Error('The source 2D plan has failed validation')
  const buildingModel = createBuildingModel(plan)
  const villaDesignDNA = createVillaDesignDNA(buildingModel, seed, plan.model.brief.style.character)
  const base = MassingGenerator.generate(buildingModel, villaDesignDNA)
  ArchitectureValidator.assertReadyForGeometry(buildingModel, base)
  const top = buildingModel.floors.at(-1)!
  const rng = makeRng(seed, `${buildingModel.planId}|plan-envelope-v1`)
  // A numeric seed selects composition; separate seeded draws determine orientation,
  // proportion, height and position. No material choice drives geometry.
  const family = MASSING_FAMILIES[((seed % MASSING_FAMILIES.length) + MASSING_FAMILIES.length) % MASSING_FAMILIES.length]
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
  // Keep the actual top roof clear. Variation belongs on exterior facades and supported canopies.
  const candidate = (attempt: number): Mass[] => [...occupied, ...(attempt === 0 ? additions : [])]
  const attempt = ArchitectureValidator.tryVariations(buildingModel, 4, candidate, ENVELOPE_LIMITS)
  if (!attempt.report.valid) throw new Error(`Envelope rejected: ${attempt.report.issues.map((i) => i.code).join(', ')}`)
  const massingModel = { ...base, family, generationMode: 'plan-envelope-v1' as const,
    architectureLimits: { ...ENVELOPE_LIMITS }, masses: attempt.masses, architectureReport: attempt.report,
    attemptsTried: attempt.attemptsTried, issues: [], silhouetteSignature: massingSilhouetteSignature(attempt.masses) }
  villaDesignDNA.massingFamily = family
  villaDesignDNA.roofType = 'flat-terrace'
  const actualBlocks = massingModel.masses.filter((m) => m.usage === 'enclosed' || m.usage === 'canopy')
  const area = actualBlocks.reduce((sum, m) => sum + m.width * m.depth, 0)
  villaDesignDNA.blockCount = actualBlocks.length
  villaDesignDNA.blockRatios = actualBlocks.map((m) => m.width * m.depth / area)
  villaDesignDNA.blockOffsets = actualBlocks.map((m) => ({ xMm: Math.round(m.x + m.width / 2 - top.outline.x - top.outline.w / 2),
    yMm: Math.round(m.y + m.depth / 2 - top.outline.y - top.outline.h / 2) }))
  villaDesignDNA.blockRotations = actualBlocks.map((m) => m.rotation)
  const facadeGrammar = ArchitecturalFeatureGenerator.generate(buildingModel, villaDesignDNA, massingModel, { usableTerrace: true })
  if (facadeGrammar.status !== 'valid') throw new Error(`Facade rejected: ${JSON.stringify(facadeGrammar.issues)}`)
  return { schemaVersion: 1 as const, buildingModel, villaDesignDNA, massingModel, facadeGrammar,
    shapeFingerprint: createVillaShapeFingerprint(buildingModel, villaDesignDNA, massingModel, facadeGrammar) }
}
