import { placeSiteFeatures } from './planner/siteFeatures.ts'
import { rectArea, rectUnionArea, toSqm } from '../geometry.ts'
import type { CanonicalModel } from '../model/canonical.ts'
import { themeOf } from '../model/themes.ts'
import { makeRng, type Rng } from './massing/rng.ts'
import type { Diversity, MassingType, RoofSpec } from './massing/types.ts'
import { deriveDesignDNA, type InspirationPreferences } from './designDna.ts'
import { selectExteriorDirections } from './variation.ts'
import type { Design } from './types.ts'
import { planVilla, type PlateFamily } from './planner/index.ts'
import { validate } from '../rules/index.ts'
import { preferenceScore, strictVastuFailures, type PreferenceScore } from './score.ts'

/* ------------------------------------------------------------------ *
 *  generate() — the deterministic rule + constraint planner
 *  (./planner) produces every coordinate; this file only chooses which
 *  plate family / seed variant to try, and rejects any candidate that
 *  fails a mandatory validator. Nothing upstream (brief UI, LLM) ever
 *  supplies geometry.
 * ------------------------------------------------------------------ */

export type Strategy = 'orthogonal-core' | 'wing-split'

export const STRATEGIES: { id: Strategy; label: string; blurb: string }[] = [
  {
    id: 'orthogonal-core',
    label: 'Orthogonal core',
    blurb: 'A compact block with the stair and services drawn to one edge — the shortest walls and the simplest structure.',
  },
  {
    id: 'wing-split',
    label: 'Split wings',
    blurb: 'A plate that steps back upstairs, leaving a terrace over the ground floor.',
  },
]

export type GenerateOpts = {
  /** kept for back-compat — maps onto a plate family */
  strategy?: Strategy
  massing?: MassingType | 'auto' | 'random'
  /** accepted for back-compat; the planner varies by seed, not by distortion */
  diversity?: Diversity
  seed?: number
}

export type DirectionResult = {
  /** the concrete plate family this direction resolved to */
  massing: MassingType
  /** the seed that produced it — written to the brief when pinned */
  seed: number
  label: string
  blurb: string
  design: Design
  novelty: number
}

/** every massing request maps onto a plate family the planner can prove valid */
const FAMILY_OF: Record<MassingType, PlateFamily> = {
  rectangular: 'rectangular',
  'central-core': 'rectangular',
  stepped: 'stepped',
  'offset-box': 'stepped',
  cantilever: 'stepped',
  'split-volume': 'stepped',
  'side-wing': 'stepped',
  'l-shape': 'l-shape',
  't-shape': 'l-shape',
  'front-projection': 'l-shape',
  interlocking: 'l-shape',
  asymmetric: 'l-shape',
  courtyard: 'courtyard',
  'rear-courtyard': 'courtyard',
  'u-shape': 'courtyard',
}

/** the top-storey roof for a style's `roofBias` */
const topRoof = (_bias: 'flat' | 'pitched' | 'mixed', _rng: Rng): RoofSpec => ({ kind: 'flat-parapet' })

const FAMILIES: PlateFamily[] = ['rectangular', 'stepped', 'l-shape', 'courtyard']

export function generateDirections(model: CanonicalModel, inspiration?: InspirationPreferences | null): DirectionResult[] {
  if (model.envelope.width < 6000 || model.envelope.depth < 6000) return []
  const plan = generate(model)
  if (!validate(plan, { checkFacade: false }).hardChecksPass) return []
  const level = model.brief.style.diversity === 'low' ? 'subtle' :
    model.brief.style.diversity === 'extreme' || model.brief.style.diversity === 'high' ? 'bold' : 'balanced'
  return selectExteriorDirections(plan, 4, level, inspiration).map(({ design, novelty }, index) => ({
    massing: design.massingType,
    seed: design.dna.seed,
    label: `Direction ${'ABCD'[index]} — ${design.dna.facadeComposition.replaceAll('-', ' ')}`,
    blurb: `${design.dna.entranceDesign.replaceAll('-', ' ')} · ${design.dna.featureElement.replaceAll('-', ' ')} · ${design.dna.materialPalette.replaceAll('-', ' ')}`,
    design,
    novelty,
  }))
}

export type Candidate = { design: Design; score: PreferenceScore; strictOk: boolean }

/**
 * Every deterministic variant that passes every mandatory validator, in
 * generation order, each with its preference score. Empty when none pass.
 */
export function generateCandidates(model: CanonicalModel, opts: Strategy | GenerateOpts = {}): {
  passing: Candidate[]
  fallback: Design
} {
  const o: GenerateOpts = typeof opts === 'string' ? { strategy: opts } : opts
  const requested = o.massing ??
    (o.strategy === 'wing-split' ? 'stepped' : o.strategy === 'orthogonal-core' ? 'rectangular' : model.brief.style.massing)
  const seed = o.seed ?? model.brief.variation
  const briefKey = model.seed.split('-')[0]

  let families: PlateFamily[]
  if (model.brief.rooms.priorities.courtyard) families = ['courtyard']
  else if (requested === 'auto' || requested === 'random') {
    const rng = makeRng(seed, `${briefKey}|family|${requested}`)
    const pool = FAMILIES.filter(f => f !== 'rectangular')
    const first = requested === 'random' ? rng.pick(pool) : rng.weighted(pool.map((f) =>
      [f, 2] as [PlateFamily, number]))
    families = [first, ...pool.filter((f) => f !== first)]
  } else families = [FAMILY_OF[requested]]

  // Vastu needs more orientations / mirrors to choose from
  const attempts = model.brief.lifestyle.vastu === 'ignore' ? 6 : 12
  const cap = model.brief.lifestyle.vastu === 'strict' ? MAX_CANDIDATES_STRICT : MAX_CANDIDATES
  const passing: Candidate[] = []
  const seen = new Set<string>()
  let best: Design | null = null
  let bestErrors = Infinity
  let bestWarnings = Infinity
  for (const family of families) {
    for (let attempt = 0; attempt < attempts && passing.length < cap; attempt++) {
      const d = generateOne(model, family, seed + attempt * 31, briefKey)
      if (!d) continue
      const report = validate(d, { checkFacade: false })
      if (report.hardChecksPass) {
        // different seeds can land on the same layout; score each layout once
        const key = layoutKey(d)
        if (seen.has(key)) continue
        seen.add(key)
        passing.push({ design: d, score: preferenceScore(d), strictOk: strictVastuFailures(d).length === 0 })
        continue
      }
      if (report.counts.error < bestErrors || (report.counts.error === bestErrors && report.counts.warning < bestWarnings)) {
        best = d
        bestErrors = report.counts.error
        bestWarnings = report.counts.warning
      }
    }
  }
  return { passing, fallback: best ?? generateOne(model, 'rectangular', seed, briefKey, true)! }
}

/** rooms and their rectangles — two candidates with the same key are the same plan */
const layoutKey = (d: Design) =>
  d.floors.map((f) => f.rooms.map((r) => `${r.id}${r.rect.x},${r.rect.y},${r.rect.w},${r.rect.h}`).join(';')).join('|')

/**
 * Upper bound on scored candidates, so generation stays fast (Case A: ~0.25 s
 * at 12, ~0.6 s at 24). Strict Vastu searches further: in Case A the best
 * strict-compliant plan scored 8.4 within 24 candidates but only 6.6 within 12.
 */
export const MAX_CANDIDATES = 12
export const MAX_CANDIDATES_STRICT = 24

/**
 * The best-scoring plan among every variant that passes the mandatory
 * validators (ties go to the earliest, so the result is deterministic).
 * Strict Vastu first drops candidates with a north-east toilet or a
 * misplaced kitchen; if that drops all of them the best one is kept and
 * the validator reports VASTU_STRICT_UNMET. If nothing passes, the
 * least-failing plan is returned and reported as failing.
 */
export function generate(model: CanonicalModel, opts: Strategy | GenerateOpts = {}): Design {
  const { passing, fallback } = generateCandidates(model, opts)
  if (!passing.length) return fallback
  const strict = model.brief.lifestyle.vastu === 'strict'
  const pool = strict && passing.some((c) => c.strictOk) ? passing.filter((c) => c.strictOk) : passing
  return pool.reduce((a, b) => ((model.brief.site.openSpace?.mode === 'maxBuild' ? b.design.coveredFootprintSqm > a.design.coveredFootprintSqm : b.score.total > a.score.total) ? b : a)).design
}

function generateOne(model: CanonicalModel, family: PlateFamily, seed: number, briefKey: string, force = false): Design | null {
  const theme = themeOf(model.brief)
  const rng = makeRng(seed, `${briefKey}|plan`)
  const pick = rng.int(0, 3)
  const mirror = rng.chance(0.5)
  const roofRng = makeRng(seed, `${briefKey}|roof`)
  const roof = topRoof(theme.roofBias, roofRng)
  // layout traits are keyed independently of the resolved family so a pinned
  // direction regenerates identically from (resolved family, seed)
  const provisional = deriveDesignDNA(briefKey, seed, model.brief.style.character, 'rectangular', 'balanced', model.brief.style.personality)

  const plan = planVilla(model, {
    family: force ? 'rectangular' : family,
    pick, mirror,
    order: rng.int(1, 1_000_000),
    dna: provisional,
    themeWindowMm: theme.windows.widthMm,
    roofFor: (_level, top) => (top ? roof : { kind: 'flat' }),
  })
  if (!plan) return null
  const massingType: MassingType = plan.structure.family
  // the resolved family must reproduce: a request that silently degraded
  // (e.g. a court that did not fit) is not this family's plan
  if (!force && massingType !== family && !(family === 'stepped' && massingType === 'rectangular')) return null
  const dna = deriveDesignDNA(briefKey, seed, model.brief.style.character, massingType, 'balanced', model.brief.style.personality)
  const floors = plan.floors
  for (const floor of floors) for (const door of floor.openings.filter(o => o.kind === 'entry')) {
    const requested = model.brief.entry.design
    door.entranceDesign = requested && requested !== 'auto' ? requested : model.brief.style.character === 'modern-box' ? 'wide-pivot' : model.brief.style.character === 'contemporary-indian' ? 'framed-portico' : model.brief.style.character === 'courtyard-indian' ? 'indian-carved' : 'stone-surround'
    door.head = Math.min(2600, Math.round(model.brief.levels.floorToFloor * 1000) - 300)
  }

  const groundMm2 = rectUnionArea(floors[0].footprint)
  const builtMm2 = floors.reduce((a, f) => a + rectUnionArea(f.footprint), 0)
  const outdoorMm2 = floors[0].rooms
    .filter((r) => r.outdoor && r.id !== 'courtyard')
    .reduce((a, r) => a + rectArea(r.rect), 0)
  const doors = floors.reduce((n, f) => n + f.openings.filter((op) => op.kind === 'door' || op.kind === 'entry').length, 0)
  const windows = floors.reduce((n, f) => n + f.openings.filter((op) => op.kind === 'window').length, 0)

  const site = placeSiteFeatures(model, floors[0])
  return {
    siteFeatures: site.features, siteNotes: [...(model.siteNotes ?? []), ...site.notes],
    id: `${model.seed}-${massingType}-${seed}`,
    seed: model.seed,
    algorithm: 'rule-constraint-planner-v1',
    candidate: massingType,
    massingType,
    dna,
    model,
    floors,
    builtAreaSqm: toSqm(builtMm2),
    footprintSqm: toSqm(groundMm2),
    coveredFootprintSqm: toSqm(groundMm2 + outdoorMm2),
    heightM: Math.round((floors.length * model.brief.levels.floorToFloor + 1) * 10) / 10,
    coverage: (groundMm2 + outdoorMm2 * 0.5) / (model.plot.width * model.plot.depth),
    openingCounts: { doors, windows },
    structure: plan.structure,
  }
}
