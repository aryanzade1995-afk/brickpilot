/* ------------------------------------------------------------------ *
 *  designGenome — compose + validate + repair a DesignGenome.
 *
 *      resolveGenome(pattern, requirements, constraints, planShape, rng)
 *        → picks every architectural decision, seeded, in dependency
 *          order, filtered by the compatibility rules and gated by the
 *          plot / floor-count / parking requirements
 *        → validateGenome() re-checks every pair
 *        → repairGenome() swaps the offending (later) pick for the
 *          best compatible alternative from the style pattern
 *
 *  The genome is the ONE design intent every downstream resolver
 *  (massing / roof / balcony / facade / window) reads, so a seed
 *  produces a coherent villa rather than a bag of independent picks.
 * ------------------------------------------------------------------ */

import type { Rng } from '../../lib/engine/shape/rng.ts'
import type { DesignGenome, DesignRequirements, GenerationConstraints, PlanShape } from '../types.ts'
import type { PlanFigure } from './architecturalVocabulary.ts'
import { CHARACTERISTICS } from './architecturalVocabulary.ts'
import { affinityWeight, figureAllowsMassing, isPickAllowed } from './compatibilityRules.ts'
import { feasibleMassing, MASSING_LIBRARY } from './massingLibrary.ts'
import { isFlatRoof, ROOF_LIBRARY } from './roofLibrary.ts'
import { FACADE_COMPOSITION_LIBRARY, SCREEN_LIBRARY } from './facadeLibrary.ts'
import { BALCONY_LIBRARY } from './balconyLibrary.ts'
import { ENTRANCE_LIBRARY, ENTRANCE_TYPE_POSITIONS } from './entranceLibrary.ts'
import { GLAZING_LIBRARY, WINDOW_STRATEGY_LIBRARY } from './windowLibrary.ts'
import { COURTYARD_LIBRARY, LANDSCAPE_LIBRARY, PARKING_LIBRARY } from './courtyardLibrary.ts'
import type { StylePattern, Weighted } from './stylePatterns.ts'

/* ---- plan shape (engine) → plan figure (vocabulary) --------------- */

export function planShapeToFigure(shape: PlanShape): PlanFigure {
  switch (shape) {
    case 'square':
      return 'square'
    case 'rectangular':
      return 'rectangular'
    case 'l_shape':
      return 'l_shape'
    case 't_shape':
      return 't_shape'
    case 'u_shape':
      return 'u_shape'
    case 'courtyard':
      return 'courtyard'
    default:
      return 'rectangular'
  }
}

/* ---- the seeded weighted pick ------------------------------------- */

type PickOpts<T> = {
  /** structural gate — false removes the option before weighting */
  allow?: (t: T) => boolean
  /** current field→term picks, for compatibility + affinity */
  current: Record<string, string>
  field: string
}

function weightedPick<T extends string>(rng: Rng, entries: Weighted<T>[], opts: PickOpts<T>): T {
  const scored: [T, number][] = []
  for (const [term, w] of entries) {
    if (w <= 0) continue
    if (opts.allow && !opts.allow(term)) continue
    if (!isPickAllowed(opts.current, opts.field, term).ok) continue
    scored.push([term, w * affinityWeight(opts.current, opts.field, term)])
  }
  if (scored.length === 0) {
    // every preferred option was gated out — take the first that passes `allow`
    const fallback = entries.find(([t]) => !opts.allow || opts.allow(t))
    return (fallback?.[0] ?? entries[0][0]) as T
  }
  return rng.weighted(scored)
}

const lerpInt = (a: number, b: number, t: number) => Math.round(a + (b - a) * t)
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

/* ================================================================== *
 *  resolveGenome
 * ================================================================== */

/** extra weighted picks a reference set contributes, keyed by pattern field */
export type GenomeHints = Partial<Record<string, Weighted<string>[]>>

/** concat reference hints onto the style pattern's weighted lists */
function mergeHints(pattern: StylePattern, hints?: GenomeHints): StylePattern {
  if (!hints) return pattern
  const merged = { ...pattern } as unknown as Record<string, unknown>
  for (const [field, extra] of Object.entries(hints)) {
    const base = merged[field]
    if (Array.isArray(base) && Array.isArray(extra)) merged[field] = [...base, ...extra]
  }
  return merged as unknown as StylePattern
}

export function resolveGenome(
  stylePattern: StylePattern,
  req: DesignRequirements,
  constraints: GenerationConstraints,
  planShape: PlanShape,
  rng: Rng,
  hints?: GenomeHints,
): DesignGenome {
  const pattern = mergeHints(stylePattern, hints)
  const cur: Record<string, string> = {}
  const set = <T extends string>(field: string, term: T): T => {
    cur[field] = term
    return term
  }

  const floors = req.floors
  const plotW = req.plotWidthMm
  const buildableW = plotW - constraints.setbackMinMm.W - constraints.setbackMinMm.E
  const buildableH = req.plotDepthMm - constraints.setbackMinMm.N - constraints.setbackMinMm.S
  // rough slack: half the buildable minus a nominal 8 m ground footprint on the freer axis
  const slackMm = Math.max(0, Math.max(buildableW, buildableH) - 8000)

  /* 1 — plan figure comes from the engine's chosen footprint, not re-picked */
  const planFigure = set('planFigure', planShapeToFigure(planShape))

  /* 2 — massing composition: feasible for floors + slack + figure */
  const feasible = new Set(feasibleMassing(floors, slackMm))
  const massingComposition = set(
    'massingComposition',
    weightedPick(rng, pattern.massing, {
      current: cur,
      field: 'massingComposition',
      allow: (m) => feasible.has(m) && figureAllowsMassing(planFigure, m),
    }),
  )
  const mEntry = MASSING_LIBRARY[massingComposition as keyof typeof MASSING_LIBRARY]

  /* 3 — volume count: intersect style band with massing band */
  const vcLo = Math.max(pattern.volumeCount[0], mEntry.params.volumeCount[0])
  const vcHi = Math.max(vcLo, Math.min(pattern.volumeCount[1], mEntry.params.volumeCount[1]))
  const volumeCount = clamp(rng.int(vcLo, vcHi), 1, 4)

  /* 4 — upper-floor strategy (only meaningful with an upper storey) */
  const upperFloorStrategy = set(
    'upperFloorStrategy',
    floors > 1
      ? weightedPick(rng, pattern.upperFloor, { current: cur, field: 'upperFloorStrategy' })
      : 'stacked_plumb',
  )

  /* 5 — vertical void */
  const voidStrategy = set('voidStrategy', weightedPick(rng, pattern.voidStrategy, { current: cur, field: 'voidStrategy' }))

  /* 6 — roof: compatible with the massing move */
  const roof = set(
    'roof',
    weightedPick(rng, pattern.roof, {
      current: cur,
      field: 'roof',
      allow: (r) => (floors > 1 ? true : ROOF_LIBRARY[r].deckCapable || !isFlatRoof(r) || r === 'flat_slab' || r === 'floating_slab'),
    }),
  )
  const rEntry = ROOF_LIBRARY[roof as keyof typeof ROOF_LIBRARY]
  const overhang = set('overhang', rEntry.overhang)
  const roofDeck = rEntry.deckCapable && rng.chance(pattern.id === 'minimal_indian' ? 0.35 : 0.55)
  const parapet = rEntry.parapet

  /* 7 — entrance: porte-cochere / porch need plot width */
  const entrance = set(
    'entrance',
    weightedPick(rng, pattern.entrance, {
      current: cur,
      field: 'entrance',
      allow: (e) => {
        if (e === 'porte_cochere') return buildableW >= 11000 && req.parking > 0
        if (e === 'porch') return buildableW >= 8000
        if (e === 'covered_courtyard_entry') return ['l_shape', 't_shape', 'u_shape', 'courtyard'].includes(planFigure)
        return true
      },
    }),
  )
  const eEntry = ENTRANCE_LIBRARY[entrance as keyof typeof ENTRANCE_LIBRARY]
  const entrancePosition = set('entrancePosition', rng.pick(ENTRANCE_TYPE_POSITIONS[entrance as keyof typeof ENTRANCE_TYPE_POSITIONS]))
  const doubleHeightEntrance = (eEntry.doubleHeight || voidStrategy === 'double_height_entrance') && floors > 1

  /* 8 — balcony: one type, realised only where a wall supports it downstream */
  const balcony = set(
    'balcony',
    weightedPick(rng, pattern.balcony, {
      current: cur,
      field: 'balcony',
      allow: (b) => (floors > 1 ? true : !BALCONY_LIBRARY[b].upperOnly),
    }),
  )
  const bEntry = BALCONY_LIBRARY[balcony as keyof typeof BALCONY_LIBRARY]
  const balconyPosition =
    bEntry.recessed || balcony === 'none'
      ? 'upper_front'
      : rng.pick(['upper_front', 'upper_front_corner', 'upper_side', 'wrap'] as const)
  const balconyCount =
    balcony === 'none' ? 0 : clamp(Math.min(bEntry.maxPerFloor, Math.ceil(req.bedrooms / 3)), 1, bEntry.maxPerFloor)

  /* 9 — facade composition + screen */
  const facadeComposition = set(
    'facadeComposition',
    weightedPick(rng, pattern.facadeComposition, { current: cur, field: 'facadeComposition' }),
  )
  const fcEntry = FACADE_COMPOSITION_LIBRARY[facadeComposition as keyof typeof FACADE_COMPOSITION_LIBRARY]
  const screen = set(
    'screen',
    weightedPick(rng, pattern.screen, {
      current: cur,
      field: 'screen',
      allow: (s) => fcEntry.screens.includes(s),
    }),
  )

  /* 10 — material palette */
  const materialPalette = set('materialPalette', weightedPick(rng, pattern.materialPalette, { current: cur, field: 'materialPalette' }))
  const featureStone =
    /stone|travertine|granite|laterite/.test(materialPalette) && rng.chance(0.6) && facadeComposition !== 'glass_box'
  const featureTower = mEntry.verticalEmphasis !== 'none' && rng.chance(pattern.id === 'modern_indian' ? 0.5 : 0.2)

  /* 11 — glazing + window strategy */
  const glazing = set(
    'glazing',
    weightedPick(rng, pattern.glazing, {
      current: cur,
      field: 'glazing',
      allow: (g) => (facadeComposition === 'glass_box' ? g === 'expansive' || g === 'full_glass' : true),
    }),
  )
  const windowStrategy = set(
    'windowStrategy',
    weightedPick(rng, pattern.windowStrategy, { current: cur, field: 'windowStrategy' }),
  )
  const cornerGlazing = WINDOW_STRATEGY_LIBRARY[windowStrategy as keyof typeof WINDOW_STRATEGY_LIBRARY].cornerGlazing

  /* 12 — courtyard: forced present if the engine gave a court figure */
  const engineHasCourt = planShape === 'courtyard' || planShape === 'u_shape'
  const courtyard = set(
    'courtyard',
    weightedPick(rng, pattern.courtyard, {
      current: cur,
      field: 'courtyard',
      allow: (c) => {
        if (c === 'none') return !engineHasCourt
        const ce = COURTYARD_LIBRARY[c]
        return ce.figures.includes(planFigure) && Math.min(buildableW, buildableH) >= ce.minDimMm + 6000
      },
    }),
  )

  /* 13 — parking integration (needs the requirement + plot width) */
  const parking = set(
    'parking',
    req.parking <= 0
      ? 'none'
      : weightedPick(rng, pattern.parking, {
          current: cur,
          field: 'parking',
          allow: (p) => p === 'none' || buildableW >= PARKING_LIBRARY[p].minPlotWidthMm,
        }),
  )

  /* 14 — landscape (court-dependent strategies need a court) */
  const landscape = set(
    'landscape',
    weightedPick(rng, pattern.landscape, {
      current: cur,
      field: 'landscape',
      allow: (l) => !LANDSCAPE_LIBRARY[l].needsCourt || courtyard !== 'none',
    }),
  )

  /* 15 — geometry magnitudes sampled from the massing entry */
  const storeyOffsetMm = mEntry.params.storeyOffsetMm
    ? lerpInt(mEntry.params.storeyOffsetMm[0], mEntry.params.storeyOffsetMm[1], rng.next())
    : 0
  const cantileverMm = mEntry.params.cantileverMm
    ? clamp(
        lerpInt(mEntry.params.cantileverMm[0], mEntry.params.cantileverMm[1], rng.next()),
        0,
        constraints.massing.maxCantileverMm,
      )
    : 0

  /* 16 — coverage targets from the style proportion rules */
  const groundCoverage = +lerp(pattern.proportion.groundCoverage[0], pattern.proportion.groundCoverage[1], rng.next()).toFixed(3)
  const upperCoverage = +lerp(pattern.proportion.upperCoverage[0], pattern.proportion.upperCoverage[1], rng.next()).toFixed(3)

  /* 17 — descriptive characteristics: union of every pick's tags */
  const tags = new Set<string>([
    ...pattern.signatureCharacteristics,
    ...mEntry.characteristics,
    ...rEntry.characteristics,
    ...fcEntry.characteristics,
    ...SCREEN_LIBRARY[screen as keyof typeof SCREEN_LIBRARY].characteristics,
    ...bEntry.characteristics,
    ...COURTYARD_LIBRARY[courtyard as keyof typeof COURTYARD_LIBRARY].characteristics,
    ...GLAZING_LIBRARY[glazing as keyof typeof GLAZING_LIBRARY].characteristics,
    ...(doubleHeightEntrance ? ['transparent_ground'] : []),
    ...(cantileverMm > 0 ? ['cantilever'] : []),
  ])
  const characteristics = [...tags].filter((t) => (CHARACTERISTICS as readonly string[]).includes(t)).slice(0, 12)

  const genome: DesignGenome = {
    style: pattern.id,
    seed: req.seed,
    planFigure,
    massingComposition,
    volumeCount,
    compositionBalance: mEntry.balance,
    horizontalEmphasis: mEntry.horizontalEmphasis,
    verticalEmphasis: mEntry.verticalEmphasis,
    upperFloorStrategy,
    voidStrategy,
    groundCoverage,
    upperCoverage,
    storeyOffsetMm,
    cantileverMm,
    roof,
    overhang,
    roofDeck,
    parapet,
    entrance,
    entrancePosition,
    doubleHeightEntrance,
    balcony,
    balconyPosition,
    balconyCount,
    facadeComposition,
    screen,
    materialPalette,
    featureStone,
    featureTower,
    glazing,
    windowStrategy,
    cornerGlazing,
    courtyard,
    parking,
    landscape,
    characteristics,
    repaired: [],
  }

  return repairGenome(genome, pattern, rng)
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t

/* ================================================================== *
 *  validate + repair
 * ================================================================== */

/** every ordered (field, later-field) pair the genome touches, for the check */
const GENOME_FIELDS = [
  'planFigure',
  'massingComposition',
  'upperFloorStrategy',
  'voidStrategy',
  'roof',
  'entrance',
  'balcony',
  'facadeComposition',
  'screen',
  'materialPalette',
  'glazing',
  'windowStrategy',
  'courtyard',
  'parking',
  'landscape',
] as const

export function validateGenome(g: DesignGenome): { ok: boolean; issues: string[] } {
  const cur = genomeToMap(g)
  const issues: string[] = []
  for (const field of GENOME_FIELDS) {
    const term = cur[field]
    if (!term) continue
    // check against every OTHER already-set field
    const partial: Record<string, string> = {}
    for (const f2 of GENOME_FIELDS) {
      if (f2 === field) break
      partial[f2] = cur[f2]
    }
    const res = isPickAllowed(partial, field, term)
    if (!res.ok) issues.push(`${field}=${term}: ${res.reason}`)
  }
  if (!figureAllowsMassing(g.planFigure as PlanFigure, g.massingComposition as keyof typeof MASSING_LIBRARY)) {
    issues.push(`massingComposition=${g.massingComposition} not valid for planFigure=${g.planFigure}`)
  }
  if (g.balcony !== 'none' && BALCONY_LIBRARY[g.balcony as keyof typeof BALCONY_LIBRARY].upperOnly && g.upperFloorStrategy === 'stacked_plumb' && g.volumeCount < 2) {
    // single-storey with an upper-only balcony
    issues.push(`balcony=${g.balcony} needs an upper storey`)
  }
  return { ok: issues.length === 0, issues }
}

/** swap any conflicting (later) pick for the best compatible pattern alternative */
export function repairGenome(g: DesignGenome, pattern: StylePattern, rng: Rng): DesignGenome {
  let genome = { ...g }
  const repaired = [...g.repaired]

  for (let pass = 0; pass < 3; pass++) {
    const { ok, issues } = validateGenome(genome)
    if (ok) break
    for (const issue of issues) {
      const field = issue.split('=')[0] as (typeof GENOME_FIELDS)[number]
      const entries = (pattern as unknown as Record<string, Weighted<string>[]>)[patternKey(field)]
      if (!entries) continue
      const map = genomeToMap(genome)
      const partial: Record<string, string> = {}
      for (const f2 of GENOME_FIELDS) {
        if (f2 === field) break
        partial[f2] = map[f2]
      }
      const alt = entries.find(([t]) => t !== map[field] && isPickAllowed(partial, field, t).ok)
      if (alt) {
        genome = applyField(genome, field, alt[0])
        repaired.push(`${field}: ${map[field]} → ${alt[0]}`)
      }
    }
  }

  // last resort: if massing still doesn't fit the figure, force a safe composition
  if (!figureAllowsMassing(genome.planFigure as PlanFigure, genome.massingComposition as keyof typeof MASSING_LIBRARY)) {
    const safe = feasibleMassing(2, 0).find((m) => figureAllowsMassing(genome.planFigure as PlanFigure, m)) ?? 'stacked_volumes'
    repaired.push(`massingComposition: ${genome.massingComposition} → ${safe} (figure fallback)`)
    genome = applyField(genome, 'massingComposition', safe)
  }
  void rng
  return { ...genome, repaired }
}

function patternKey(field: string): string {
  if (field === 'roof') return 'roof'
  if (field === 'balcony') return 'balcony'
  return field
}

function applyField(g: DesignGenome, field: string, term: string): DesignGenome {
  const next = { ...g, [field]: term }
  if (field === 'massingComposition') {
    const e = MASSING_LIBRARY[term as keyof typeof MASSING_LIBRARY]
    next.compositionBalance = e.balance
    next.horizontalEmphasis = e.horizontalEmphasis
    next.verticalEmphasis = e.verticalEmphasis
  }
  if (field === 'roof') {
    const e = ROOF_LIBRARY[term as keyof typeof ROOF_LIBRARY]
    next.overhang = e.overhang
    next.parapet = e.parapet
    next.roofDeck = next.roofDeck && e.deckCapable
  }
  return next
}

export function genomeToMap(g: DesignGenome): Record<string, string> {
  return {
    planFigure: g.planFigure,
    massingComposition: g.massingComposition,
    upperFloorStrategy: g.upperFloorStrategy,
    voidStrategy: g.voidStrategy,
    roof: g.roof,
    entrance: g.entrance,
    balcony: g.balcony,
    facadeComposition: g.facadeComposition,
    screen: g.screen,
    materialPalette: g.materialPalette,
    glazing: g.glazing,
    windowStrategy: g.windowStrategy,
    courtyard: g.courtyard,
    parking: g.parking,
    landscape: g.landscape,
  }
}

/* ---- human-readable one-liner ------------------------------------ */

export function genomeSummary(g: DesignGenome): string {
  const bits = [
    g.massingComposition.replace(/_/g, ' '),
    `${g.volumeCount} vol`,
    g.planFigure.replace(/_/g, ' '),
    g.roof.replace(/_/g, ' '),
    g.balcony !== 'none' ? g.balcony.replace(/_/g, ' ') : null,
    g.courtyard !== 'none' ? `${g.courtyard.replace(/_/g, ' ')} court` : null,
    g.doubleHeightEntrance ? 'double-height entry' : g.entrance.replace(/_/g, ' '),
    g.screen !== 'none' ? g.screen.replace(/_/g, ' ') : null,
    g.materialPalette.replace(/_/g, ' '),
  ].filter(Boolean)
  return bits.join(' · ')
}
