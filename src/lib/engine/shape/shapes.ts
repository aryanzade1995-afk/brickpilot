import { type Rect, rectRight, rectBottom, snap } from '../../geometry.ts'
import type { Rng } from './rng.ts'
import type { Footprint, Shape, ShapeCtx } from './types.ts'

/* ------------------------------------------------------------------ *
 *  Shape builders — carve the built silhouette for one footprint
 *  shape, sized to the envelope, and mark where the stair column lands.
 *  Room placement (layout/) fills the blocks; buildMassing extrudes.
 *
 *  Coordinate convention: plan-south (the road / entry) is the BOTTOM
 *  edge (larger y); north / back is the top. The house block is
 *  top-aligned in the envelope, the front strip (parking / verandah)
 *  sits below its south edge.
 * ------------------------------------------------------------------ */

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
const MIN_SIDE = 6000

/** the stair column, in a back corner away from the entry front */
function coreCorner(block: Rect, ctx: ShapeCtx, rng: Rng): Rect {
  const g = ctx.grid
  const w = snap(Math.min(ctx.coreW, block.w - 2 * g), g)
  const h = snap(Math.min(ctx.coreH, block.h - 2 * g), g)
  const flip = rng.chance(0.5)
  let x: number
  let y: number
  switch (ctx.entryEdge) {
    case 'S': // entry at the bottom → stair against the top edge
      y = block.y
      x = flip ? rectRight(block) - w : block.x
      break
    case 'N':
      y = rectBottom(block) - h
      x = flip ? rectRight(block) - w : block.x
      break
    case 'W':
      x = rectRight(block) - w
      y = flip ? rectBottom(block) - h : block.y
      break
    default: // 'E'
      x = block.x
      y = flip ? rectBottom(block) - h : block.y
  }
  return { x: snap(x, g), y: snap(y, g), w, h }
}

function singleBlock(shape: Shape, w: number, h: number, ctx: ShapeCtx, rng: Rng): Footprint {
  const g = ctx.grid
  const bw = snap(clamp(w, MIN_SIDE, ctx.env.w), g)
  const bh = snap(clamp(h, MIN_SIDE, ctx.env.h), g)
  const x = snap(ctx.env.x + (ctx.env.w - bw) / 2, g)
  const block: Rect = { x, y: ctx.env.y, w: bw, h: bh }
  return { shape, blocks: [block], core: coreCorner(block, ctx, rng), courtyard: null, entryEdge: ctx.entryEdge }
}

/** a single long block across the plot */
export function rectangle(ctx: ShapeCtx, rng: Rng): Footprint {
  return singleBlock('rectangle', ctx.houseW, ctx.houseH, ctx, rng)
}

/** a single near-square block — geometric-mean side, clamped to the envelope */
export function square(ctx: ShapeCtx, rng: Rng): Footprint {
  const side = Math.sqrt(ctx.houseW * ctx.houseH)
  return singleBlock('square', side, side, ctx, rng)
}

export const SHAPE_BUILDERS: Partial<Record<Shape, (ctx: ShapeCtx, rng: Rng) => Footprint>> = {
  rectangle,
  square,
  // l-shape / t-shape / u-shape / courtyard — Milestone B
}
