import type { Rng } from './rng.ts'
import { SHAPE_BUILDERS } from './shapes.ts'
import type { Footprint, Shape, ShapeCtx, ShapeRequest } from './types.ts'

/* ------------------------------------------------------------------ *
 *  pickShape — resolve the brief's shape choice (or `auto`) to a
 *  concrete Footprint. `auto` keys off plot aspect + programme size;
 *  ResPlan's shape_mix is a weak prior (real listing envelopes are
 *  notched, so it over-reports U/T). An explicit shape is honoured,
 *  falling back to `rectangle` if its builder is not available yet.
 * ------------------------------------------------------------------ */

export type { ShapeRequest }

function autoShape(ctx: ShapeCtx, rng: Rng): Shape {
  const aspect = ctx.env.w / Math.max(1, ctx.env.h)
  const big = ctx.programSqm >= 150
  const deep = ctx.env.h >= 15000

  const available = (s: Shape) => s in SHAPE_BUILDERS

  // preference ladder, first available wins
  let ladder: Shape[]
  if (big && deep) ladder = ['courtyard', 'u-shape', 'l-shape', 'rectangle', 'square']
  else if (big) ladder = ['l-shape', 't-shape', 'rectangle', 'square']
  else if (aspect >= 1.35) ladder = ['rectangle', 'square']
  else if (aspect <= 1.2) ladder = ['square', 'rectangle']
  else ladder = rng.chance(0.5) ? ['rectangle', 'square'] : ['square', 'rectangle']

  return ladder.find(available) ?? 'rectangle'
}

export function pickShape(ctx: ShapeCtx, req: ShapeRequest, rng: Rng): Footprint {
  const explicit = req.want !== 'auto' ? SHAPE_BUILDERS[req.want] : undefined
  const build = explicit ?? SHAPE_BUILDERS[autoShape(ctx, rng)] ?? SHAPE_BUILDERS.rectangle!
  return build(ctx, rng)
}
