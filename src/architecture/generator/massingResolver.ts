/* ------------------------------------------------------------------ *
 *  massingResolver — turn the floor plan + a seed into a stack of
 *  MassBlocks per storey, applying the style's *volumetric* strategy
 *  (stacked / offset / stepped / cantilever / split / linear) and a
 *  roof form per block. Blocks stay inside the plot minus setbacks;
 *  a cantilever is recorded as an overhang, not a plot breach.
 * ------------------------------------------------------------------ */

import type { Rect } from '../../lib/geometry.ts'
import { rectBottom, rectRight, rectUnionBBox } from '../../lib/geometry.ts'
import type { Design } from '../../lib/engine/types.ts'
import type { Rng } from '../../lib/engine/shape/rng.ts'
import type {
  DesignRequirements,
  Direction4,
  GenerationConstraints,
  MassBlock,
  MassingStrategy,
  PlanShape,
  RoofSpecOut,
  StyleGrammar,
} from '../types.ts'
import { planShapeOf } from './classify.ts'

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
const lerp = (a: number, b: number, t: number) => a + (b - a) * t

export type MassingResult = {
  strategy: MassingStrategy
  planShape: PlanShape
  footprintMm: Rect
  /** blocks indexed by storey level */
  perFloor: MassBlock[][]
}

export function resolveMassing(
  grammar: StyleGrammar,
  req: DesignRequirements,
  constraints: GenerationConstraints,
  rng: Rng,
): MassingResult {
  const design = req.floorPlan
  const planShape = planShapeOf(design.shape)
  const buildable = buildableRect(req, constraints)

  // ---- pick the volumetric strategy allowed by this style + feasible here
  const feasible = grammar.massing.strategies.filter(({ kind }) => strategyFeasible(kind, design, buildable))
  const pool = feasible.length ? feasible : [{ kind: 'stacked' as MassingStrategy, weight: 1 }]
  const strategy = rng.weighted(pool.map((s) => [s.kind, s.weight] as [MassingStrategy, number]))

  const fh = req.floorHeightMm
  const topLevel = design.floors.length - 1
  const perFloor: MassBlock[][] = []

  // the seeded shift direction for offset / stepped strategies (never toward the entry)
  const shiftSide: Direction4 = rng.pick(['N', 'E', 'W'] as const)
  const offsetMm = snap(
    lerp(grammar.massing.storeyOffsetMm[0], grammar.massing.storeyOffsetMm[1], rng.next()),
    100,
  )
  const cantMm = snap(
    clamp(
      lerp(grammar.massing.cantileverMm[0], grammar.massing.cantileverMm[1], rng.next()),
      0,
      constraints.massing.maxCantileverMm,
    ),
    100,
  )

  for (const floor of design.floors) {
    const L = floor.level
    const base = floor.footprint?.length ? floor.footprint : [floor.outline]
    let rects: Rect[] = base.map((r) => ({ ...r }))

    if (L > 0) {
      rects = rects.map((r) => transformUpper(r, strategy, L, { shiftSide, offsetMm, cantMm, buildable }))
    }
    // keep every block inside the buildable envelope (cantilever overhang aside)
    rects = rects.map((r) => intersectRect(r, buildable) ?? r).filter((r) => r.w > 1500 && r.h > 1500)
    if (rects.length === 0) rects = base.map((r) => ({ ...r }))

    perFloor[L] = rects.map((rect, i) => {
      const cantilever: Partial<Record<Direction4, number>> = {}
      if (strategy === 'cantilever' && L > 0) cantilever.S = cantMm
      const roof = L === topLevel ? topRoof(grammar, rect, rng) : terraceRoof(grammar, perFloor, L, rect)
      return {
        id: `m${L}-${i}`,
        level: L,
        rect,
        baseMm: L * fh,
        heightMm: fh,
        cantilever,
        roof,
      }
    })
  }

  const footprintMm = rectUnionBBox(perFloor.flat().map((b) => b.rect))
  return { strategy, planShape, footprintMm, perFloor }
}

/* ------------------------------------------------------------------ */

function buildableRect(req: DesignRequirements, c: GenerationConstraints): Rect {
  return {
    x: c.setbackMinMm.W,
    y: c.setbackMinMm.N,
    w: Math.max(3000, req.plotWidthMm - c.setbackMinMm.W - c.setbackMinMm.E),
    h: Math.max(3000, req.plotDepthMm - c.setbackMinMm.N - c.setbackMinMm.S),
  }
}

function strategyFeasible(kind: MassingStrategy, design: Design, buildable: Rect): boolean {
  const floors = design.floors.length
  const g = design.floors[0].outline
  const slackW = buildable.w - g.w
  const slackH = buildable.h - g.h
  switch (kind) {
    case 'stacked':
      return true
    case 'linear':
      return true
    case 'offset_volumes':
    case 'stepped':
      return floors > 1 && (slackW > 900 || slackH > 900)
    case 'cantilever':
      return floors > 1
    case 'split_mass':
      return g.w > 9000 || g.h > 9000
    default:
      return true
  }
}

type UpperCtx = { shiftSide: Direction4; offsetMm: number; cantMm: number; buildable: Rect }

function transformUpper(r: Rect, strategy: MassingStrategy, level: number, ctx: UpperCtx): Rect {
  const { shiftSide, offsetMm, cantMm, buildable } = ctx
  const k = level // steps compound with height
  switch (strategy) {
    case 'offset_volumes': {
      const d = shiftSide === 'N' ? { x: 0, y: -offsetMm } : shiftSide === 'E' ? { x: offsetMm, y: 0 } : { x: -offsetMm, y: 0 }
      return clampInside({ ...r, x: r.x + d.x, y: r.y + d.y }, buildable)
    }
    case 'stepped': {
      // step back from the shift side (and always a little from the entry/south)
      const back = offsetMm * k
      if (shiftSide === 'N') return { x: r.x, y: r.y + back, w: r.w, h: Math.max(4000, r.h - back - offsetMm) }
      if (shiftSide === 'E') return { x: r.x, y: r.y, w: Math.max(4000, r.w - back), h: r.h }
      return { x: r.x + back, y: r.y, w: Math.max(4000, r.w - back), h: r.h }
    }
    case 'cantilever': {
      // the upper volume oversails the entry (south) side
      const grow = Math.min(cantMm, buildable.y + buildable.h - rectBottom(r) + cantMm)
      return { x: r.x, y: r.y, w: r.w, h: r.h + grow }
    }
    case 'split_mass': {
      // pull the upper volume to the back half, narrower
      const w = Math.max(5000, r.w * 0.62)
      return clampInside({ x: r.x + (r.w - w) / 2, y: r.y, w, h: Math.max(4500, r.h - offsetMm) }, buildable)
    }
    case 'linear':
    case 'stacked':
    default:
      return r
  }
}

function clampInside(r: Rect, b: Rect): Rect {
  const x = clamp(r.x, b.x, rectRight(b) - r.w)
  const y = clamp(r.y, b.y, rectBottom(b) - r.h)
  return { x, y, w: Math.min(r.w, b.w), h: Math.min(r.h, b.h) }
}

function intersectRect(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x)
  const y = Math.max(a.y, b.y)
  const x2 = Math.min(rectRight(a), rectRight(b))
  const y2 = Math.min(rectBottom(a), rectBottom(b))
  if (x2 - x < 1 || y2 - y < 1) return null
  return { x, y, w: x2 - x, h: y2 - y }
}

const snap = (v: number, g: number) => Math.round(v / g) * g

/* ---- roofs ---------------------------------------------------------- */

function topRoof(grammar: StyleGrammar, _rect: Rect, rng: Rng): RoofSpecOut {
  const r = grammar.roof
  const pitchDeg = r.kind === 'flat_parapet' || r.kind === 'flat_band' || r.kind === 'flat_eave'
    ? 0
    : Math.round(lerp(r.pitchDeg[0], r.pitchDeg[1], rng.next()))
  const eaveMm = Math.round(lerp(r.eaveMm[0], r.eaveMm[1], rng.next()))
  const fall: Direction4 | undefined =
    r.kind === 'mono_slope' ? rng.pick(['N', 'S'] as const) : r.kind === 'hip' || r.kind === 'gable' ? 'S' : undefined
  return {
    kind: r.kind,
    pitchDeg,
    eaveMm,
    parapetMm: r.parapetMm,
    bandMm: r.bandMm,
    fall,
    terrace: (r.kind === 'flat_parapet' || r.kind === 'flat_band' || r.kind === 'flat_eave') && rng.chance(r.terraceChance),
  }
}

/** a lower block whose roof is exposed (a stepped-back terrace above it) */
function terraceRoof(grammar: StyleGrammar, perFloor: MassBlock[][], level: number, rect: Rect): RoofSpecOut {
  const above = perFloor[level + 1] ?? []
  const covered = above.some((b) => overlapArea(b.rect, rect) > rect.w * rect.h * 0.7)
  return {
    kind: 'flat_parapet',
    pitchDeg: 0,
    eaveMm: 0,
    parapetMm: covered ? 0 : Math.max(600, grammar.facade.plinthMm * 3),
    bandMm: 0,
    terrace: !covered,
  }
}

function overlapArea(a: Rect, b: Rect): number {
  const w = Math.max(0, Math.min(rectRight(a), rectRight(b)) - Math.max(a.x, b.x))
  const h = Math.max(0, Math.min(rectBottom(a), rectBottom(b)) - Math.max(a.y, b.y))
  return w * h
}
