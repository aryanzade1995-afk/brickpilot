import type { Rect } from '../../geometry.ts'
import { rectRight, rectBottom, rectUnionArea, snap } from '../../geometry.ts'
import type { Rng } from './rng.ts'
import { STATS } from './stats.ts'
import type { Direction, Diversity, FloorMassing, MassingPlan, MassingType, RoofSpec } from './types.ts'

/* ------------------------------------------------------------------ *
 *  One pure function per massing archetype:
 *    (env, ctx, rng, diversity) -> MassingPlan
 *  `env` is the buildable ground rectangle (plot - setbacks - front strip),
 *  already centred and capped by the caller. All coords are plot-mm.
 * ------------------------------------------------------------------ */

export type MassingCtx = {
  storeys: number // additional floors above ground (0..3)
  coreW: number // stair-core strip width, mm
  entrySide: Direction
  grid: number
  plotW: number
  plotD: number
  /** rough per-floor programme areas (m²), ground-first — sizes the upper blocks */
  floorProgSqm: number[]
  /** kerala / tropical want pitched roofs; modern wants flat; some want a mix */
  roofBias: 'flat' | 'pitched' | 'mixed'
}

const G = 100
const sn = (v: number) => snap(v, G)
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
const area = (r: Rect) => r.w * r.h
const bbox = (rs: Rect[]): Rect => {
  const x = Math.min(...rs.map((r) => r.x))
  const y = Math.min(...rs.map((r) => r.y))
  return { x, y, w: Math.max(...rs.map(rectRight)) - x, h: Math.max(...rs.map(rectBottom)) - y }
}
/** fraction of `r` covered by the union of `blocks` */
const covFrac = (r: Rect, blocks: Rect[]): number => {
  let c = 0
  for (const s of blocks) {
    const ox = Math.max(0, Math.min(rectRight(r), rectRight(s)) - Math.max(r.x, s.x))
    const oy = Math.max(0, Math.min(rectBottom(r), rectBottom(s)) - Math.max(r.y, s.y))
    c += ox * oy
  }
  return c / Math.max(1, area(r))
}
const shrinkTo = (r: Rect, targetSqm: number): Rect => {
  const k = Math.sqrt(clamp((targetSqm * 1e6) / area(r), 0.42, 1))
  const w = sn(Math.max(r.w * k, 6000))
  const h = sn(Math.max(r.h * k, 6000))
  return { x: sn(r.x + (r.w - w) / 2), y: r.y, w, h }
}
/** shrink keeping the NW corner fixed — for an edge core, so the stair column
 *  never moves off the west wall as the floors step in */
const shrinkCorner = (r: Rect, targetSqm: number): Rect => {
  const k = Math.sqrt(clamp((targetSqm * 1e6) / area(r), 0.42, 1))
  return { x: r.x, y: r.y, w: sn(Math.max(r.w * k, 6000)), h: sn(Math.max(r.h * k, 6000)) }
}
/** clamp a block inside `bound`, keeping it at least 2.4 m each way */
const within = (b: Rect, bound: Rect): Rect => {
  const x = clamp(b.x, bound.x, Math.max(bound.x, rectRight(bound) - 2400))
  const y = clamp(b.y, bound.y, Math.max(bound.y, rectBottom(bound) - 2400))
  return {
    x: sn(x),
    y: sn(y),
    w: sn(clamp(b.w, 2400, rectRight(bound) - x)),
    h: sn(clamp(b.h, 2400, rectBottom(bound) - y)),
  }
}

/** offset amplitude by diversity level (metres) */
const amp = (d: Diversity) => ({ low: 0.9, medium: 1.7, high: 2.6, extreme: 3.6 })[d]
/** cantilever projection cap by diversity (mm) — validation hard limit is 1800 */
const cantMax = (d: Diversity) => ({ low: 700, medium: 1100, high: 1500, extreme: 1750 })[d]

/** the top-storey roof for a style's `roofBias` */
export const flatRoof = (bias: 'flat' | 'pitched' | 'mixed', rng: Rng): RoofSpec => {
  const pitchChance = bias === 'pitched' ? 1 : bias === 'mixed' ? 0.5 : 0
  return pitchChance > 0 && rng.chance(pitchChance)
    ? { kind: rng.pick(['hip', 'gable', 'mono-slope'] as const), pitchDeg: rng.int(16, 28) }
    : { kind: rng.chance(0.5) ? 'flat-parapet' : 'flat' }
}

/** m² of footprint a floor's programme really needs (rooms + circulation + walls) */
const progNeed = (ctx: MassingCtx, level: number): number =>
  (ctx.floorProgSqm[level] ?? ctx.floorProgSqm[ctx.floorProgSqm.length - 1] ?? 60) / 0.72

/**
 * The upper-floor footprint area we aim for. On a tight plot (programme ≈ the
 * whole ground floor) the upper floor stays near-full; only genuine slack lets
 * it shrink, and never past half the ground floor.
 */
const upperTarget = (ctx: MassingCtx, level: number, groundSqm: number): number =>
  clamp(progNeed(ctx, level), groundSqm * 0.5, groundSqm)

type Arch = (env: Rect, ctx: MassingCtx, rng: Rng, d: Diversity) => MassingPlan

/* ---------------------------------- helpers -------------------------------- */

const plan = (
  type: MassingType,
  floors: FloorMassing[],
  coreBlock: Rect,
  entrySide: Direction,
  courtyard: Rect | null = null,
): MassingPlan => ({ type, floors, coreBlock, courtyard, entrySide })

const floor = (level: number, blocks: Rect[], roof: RoofSpec, cantilevers: number[] = []): FloorMassing => ({
  level,
  blocks: blocks.map((b) => ({ x: sn(b.x), y: sn(b.y), w: sn(b.w), h: sn(b.h) })),
  cantilevers,
  roof,
})

/** ground block filling `env`, optionally inset (so an upper floor can oversail
 *  it while still staying inside the setback line) */
const groundBlock = (env: Rect, inset = 0): Rect => ({
  x: sn(env.x + inset),
  y: env.y,
  w: sn(Math.min(env.w - inset * 2, 22000)),
  h: sn(env.h - inset),
})

/** how much a cantilever / offset archetype may inset its ground block: only the
 *  slack the envelope has over the ground-floor programme, capped by diversity */
const insetBudget = (env: Rect, ctx: MassingCtx, d: Diversity): number => {
  const need = progNeed(ctx, 0) * 1e6
  const have = env.w * env.h
  const slack = clamp((have - need) / have, 0, 0.34)
  return Math.min(cantMax(d), sn((env.w * slack) / 2))
}

/** stack N upper floors that shrink toward the (west-edge) core — the baseline */
function shrinkStack(g: Rect, ctx: MassingCtx, rng: Rng, bias: 'flat' | 'pitched' | 'mixed'): FloorMassing[] {
  const out = [floor(0, [g], { kind: bias === 'flat' ? 'flat' : 'flat-parapet' })]
  const groundSqm = area(g) / 1e6
  let prev = g
  for (let l = 1; l <= ctx.storeys; l++) {
    const t = upperTarget(ctx, l, groundSqm)
    const b = within(shrinkCorner(prev, t), g)
    out.push(floor(l, [b], l === ctx.storeys ? flatRoof(bias, rng) : { kind: 'flat' }))
    prev = b
  }
  return out
}

/* --------------------------------- archetypes ------------------------------- */

const rectangular: Arch = (env, ctx, rng) => {
  const g = groundBlock(env)
  // stair-core drawn to one edge — one contiguous fillable region, the shortest
  // walls, the simplest structure (the old "orthogonal core")
  return plan('rectangular', shrinkStack(g, ctx, rng, ctx.roofBias), coreWest(g, ctx), ctx.entrySide)
}

const coreCentre = (g: Rect, ctx: MassingCtx): Rect => ({
  x: sn(g.x + (g.w - ctx.coreW) / 2),
  y: g.y,
  w: ctx.coreW,
  h: Math.min(g.h, 5000),
})
const coreWest = (g: Rect, ctx: MassingCtx): Rect => ({ x: g.x, y: g.y, w: ctx.coreW, h: Math.min(g.h, 5000) })
const coreEast = (g: Rect, ctx: MassingCtx): Rect => ({ x: sn(rectRight(g) - ctx.coreW), y: g.y, w: ctx.coreW, h: Math.min(g.h, 5000) })

/**
 * L / T — a full-height main leg plus a lower foot that shares its whole inner
 * edge. Upstairs is a single clean volume over the main leg (its width the full
 * rectangle on a tight plot), so the foot's flat roof becomes a terrace.
 */
function lOrT(type: 'l-shape' | 't-shape'): Arch {
  return (env, ctx, rng, d) => {
    const g = groundBlock(env)
    const flip = type === 'l-shape' && rng.chance(0.5)
    // the main leg: a full-height strip down one side (or the centre, for a T)
    const legW = sn(clamp(g.w * rng.range(0.52, 0.64), 6000, g.w - 4200))
    const footW = g.w - legW
    const footH = sn(clamp(g.h * rng.range(0.46, 0.62), 3600, g.h - 3600))
    const leg: Rect =
      type === 't-shape'
        ? { x: sn(g.x + (g.w - legW) / 2), y: g.y, w: legW, h: g.h }
        : { x: flip ? sn(rectRight(g) - legW) : g.x, y: g.y, w: legW, h: g.h }
    const footAtBottom = rng.chance(0.5)
    const foot: Rect = {
      x: type === 't-shape' || flip ? g.x : sn(rectRight(leg)),
      y: footAtBottom ? sn(rectBottom(g) - footH) : g.y,
      w: type === 't-shape' ? sn((g.w - legW) / 2) : footW,
      h: footH,
    }
    const groundBlocks = [leg, within(foot, g)].filter((b) => b.w > 2400 && b.h > 2400)

    const floors: FloorMassing[] = [floor(0, groundBlocks, { kind: 'flat-parapet' })]
    const rectBase = bbox(groundBlocks)
    const eastCore = flip
    for (let l = 1; l <= ctx.storeys; l++) {
      // roomy plot → perch over the main leg; tight plot → span the rectangle
      const roomy = progNeed(ctx, l) < area(leg) / 1e6 - 6
      let b = roomy ? leg : rectBase
      b = shrinkCorner(b, upperTarget(ctx, l, area(rectBase) / 1e6))
      if (eastCore) b = { ...b, x: sn(rectRight(rectBase) - b.w) }
      b = within(b, g)
      const cant = covFrac(b, groundBlocks) < 0.6 ? [0] : []
      floors.push(floor(l, [b], l === ctx.storeys ? flatRoof(ctx.roofBias, rng) : { kind: 'flat' }, cant))
    }
    void d
    return plan(type, floors, within(flip ? coreEast(leg, ctx) : coreWest(leg, ctx), g), ctx.entrySide)
  }
}

/** U / courtyard / rear-courtyard — a ring (or C) of blocks around a void */
function courtLike(type: 'u-shape' | 'courtyard' | 'rear-courtyard'): Arch {
  return (env, ctx, rng, d) => {
    const g = groundBlock(env)
    const bandW = sn(clamp(Math.min(g.w, g.h) * rng.range(0.26, 0.34), 3400, 6500))
    // the south band carries the stair + entry foyer, so it must be deep enough
    const southD = Math.max(bandW, sn(6200))
    const openN = type === 'u-shape' && rng.chance(0.5)
    const cw = sn(g.w - 2 * bandW)
    const northD = openN ? 0 : bandW
    const ch = sn(g.h - southD - northD)
    if (cw < 2600 || ch < 3000) return rectangular(env, ctx, rng, d)

    const court: Rect = { x: sn(g.x + bandW), y: sn(g.y + northD), w: cw, h: ch }
    const bands: Rect[] = []
    if (!openN) bands.push({ x: g.x, y: g.y, w: g.w, h: bandW }) // north band
    bands.push({ x: g.x, y: sn(rectBottom(court)), w: g.w, h: sn(rectBottom(g) - rectBottom(court)) }) // south band (deep)
    bands.push({ x: g.x, y: court.y, w: bandW, h: court.h }) // west band
    bands.push({ x: rectRight(court), y: court.y, w: sn(rectRight(g) - rectRight(court)), h: court.h }) // east band
    const southBand = bands.find((b) => Math.abs(rectBottom(b) - rectBottom(g)) < 2 && b.w > cw)!
    const groundBlocks = bands.filter((b) => b.w > 2000 && b.h > 2000)

    const floors: FloorMassing[] = [floor(0, groundBlocks, { kind: 'flat-parapet' })]
    let carry = groundBlocks
    for (let l = 1; l <= ctx.storeys; l++) {
      // the upper floor keeps the south band (with the core) plus 0-1 more; the
      // rest of the ring becomes roof terrace
      const extra = rng.chance(0.5) ? 0 : 1
      const rest = carry.filter((b) => b !== southBand).sort((a, b) => area(b) - area(a)).slice(0, extra)
      const keep = [southBand, ...rest].filter((b) => b.w > 2000 && b.h > 2000)
      floors.push(
        floor(l, keep.map((b) => within(b, g)), l === ctx.storeys ? flatRoof(ctx.roofBias, rng) : { kind: 'flat' }),
      )
      carry = keep
    }
    const keepCourt = type !== 'u-shape'
    return plan(
      type,
      floors,
      within({ x: sn(court.x), y: southBand.y, w: ctx.coreW, h: southBand.h }, g),
      ctx.entrySide,
      keepCourt ? court : null,
    )
  }
}

const cantilever: Arch = (env, ctx, rng, d) => {
  // inset the ground block only as far as the plot has slack over the programme,
  // so a tight site keeps a full ground floor and the cantilever just reads as
  // the upper floor oversailing the (shrunk) storey below
  const m = insetBudget(env, ctx, d)
  const g = groundBlock(env, m)
  const floors: FloorMassing[] = [floor(0, [g], { kind: 'flat' })]
  const groundSqm = area(g) / 1e6
  let prev = g
  for (let l = 1; l <= ctx.storeys; l++) {
    let b = within(shrinkCorner(prev, upperTarget(ctx, l, groundSqm)), env)
    const proj = sn(rng.range(cantMax(d) * 0.55, cantMax(d)))
    // oversail the storey below on 1-2 sides, always staying inside the setback
    b = within({ ...b, h: sn(b.h + proj) }, env)
    if (rng.chance(0.5)) b = within({ ...b, w: sn(b.w + proj) }, env)
    const below = prev
    const cant =
      b.x < below.x - 150 || rectRight(b) > rectRight(below) + 150 || rectBottom(b) > rectBottom(below) + 150
        ? [0]
        : []
    floors.push(floor(l, [b], l === ctx.storeys ? flatRoof(ctx.roofBias, rng) : { kind: 'flat' }, cant))
    prev = b
  }
  return plan('cantilever', floors, within(coreWest(g, ctx), g), ctx.entrySide)
}

const stepped: Arch = (env, ctx, rng, d) => {
  const g = groundBlock(env)
  // step east and/or south only (the core lives on the west wall; north is the
  // setback line) and never further than the plot's slack allows
  const dir = rng.pick([
    { dx: 1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: 1, dy: 1 },
  ] as const)
  const slack = Math.max(sn(600), insetBudget(env, ctx, d) * 2)
  // real per-floor moves top out around STATS.offsetRatioP90 of the span
  const statCap = sn(STATS.offsetRatioP90 * Math.min(g.w, g.h))
  const step = Math.min(sn(amp(d) * 1000), slack, statCap)
  const floors: FloorMassing[] = [floor(0, [g], { kind: 'flat-parapet' })]
  let prev = g
  for (let l = 1; l <= ctx.storeys; l++) {
    const t = upperTarget(ctx, l, area(g) / 1e6)
    const s = shrinkCorner(prev, t)
    const b = within(
      { x: sn(s.x + dir.dx * step), y: sn(s.y + dir.dy * step), w: s.w, h: s.h },
      g,
    )
    // the lower floor's roof past the step is a walkable terrace
    floors.push(floor(l, [b], l === ctx.storeys ? flatRoof(ctx.roofBias, rng) : { kind: 'flat' }))
    prev = b
  }
  return plan('stepped', floors, within(coreWest(g, ctx), g), ctx.entrySide)
}

const offsetBox: Arch = (env, ctx, rng, d) => {
  // inset the ground block only by the plot's genuine slack; on a tight site it
  // stays full and the "offset" reads as the upper floor sliding off the storey
  // below (which shrank toward the core)
  const m = insetBudget(env, ctx, d)
  const g = groundBlock(env, m)
  const floors: FloorMassing[] = [floor(0, [g], { kind: 'flat' })]
  const groundSqm = area(g) / 1e6
  let prev = g
  const dirSign = rng.sign()
  const slideCap = STATS.offsetRatioP90 * Math.min(g.w, g.h)
  for (let l = 1; l <= ctx.storeys; l++) {
    const s = shrinkCorner(prev, upperTarget(ctx, l, groundSqm))
    const slide = sn(Math.min(amp(d) * 1000, slideCap)) * dirSign
    const b = within({ ...s, x: sn(s.x + slide) }, env)
    const overhangs =
      b.x < prev.x - 200 || rectRight(b) > rectRight(prev) + 200 || rectBottom(b) > rectBottom(prev) + 200
    floors.push(floor(l, [b], l === ctx.storeys ? flatRoof(ctx.roofBias, rng) : { kind: 'flat' }, overhangs ? [0] : []))
    prev = b
  }
  return plan('offset-box', floors, within(coreWest(g, ctx), g), ctx.entrySide)
}

/**
 * split-volume / interlocking — two ground volumes that share a full edge. The
 * "split" reads in the massing: the two blocks are offset on the cross axis
 * (split-volume) or one slides into the other and rises (interlocking), and only
 * one carries the upper floor. The plan stays a connected rect-union.
 */
function twinVolume(type: 'split-volume' | 'interlocking'): Arch {
  return (env, ctx, rng, d) => {
    const g = groundBlock(env)
    const along = g.w >= g.h ? 'x' : 'y'
    const aFrac = rng.range(0.44, 0.56)
    const shove = sn((type === 'interlocking' ? 0.16 : 0.1) * amp(d) * 1000 + 400)
    let a: Rect
    let b: Rect
    if (along === 'x') {
      const aw = sn(g.w * aFrac)
      a = { x: g.x, y: g.y, w: aw, h: g.h }
      // B butts A's east edge; nudged north or south so the join reads as a step
      const off = rng.chance(0.5) ? shove : -shove
      b = { x: sn(rectRight(a)), y: clamp(sn(g.y + off), g.y - 0, g.y + g.h * 0.18), w: sn(rectRight(g) - rectRight(a)), h: sn(g.h * rng.range(0.82, 1)) }
    } else {
      const ah = sn(g.h * aFrac)
      a = { x: g.x, y: g.y, w: g.w, h: ah }
      const off = rng.chance(0.5) ? shove : -shove
      b = { x: clamp(sn(g.x + off), g.x, g.x + g.w * 0.18), y: sn(rectBottom(a)), w: sn(g.w * rng.range(0.82, 1)), h: sn(rectBottom(g) - rectBottom(a)) }
    }
    const groundBlocks = [a, within(b, g)].filter((r) => r.w > 2400 && r.h > 2400)
    const gU = rectUnionArea(groundBlocks) / 1e6
    const floors: FloorMassing[] = [floor(0, groundBlocks, { kind: 'flat-parapet' })]
    const big = [...groundBlocks].sort((p, q) => area(q) - area(p))[0]
    for (let l = 1; l <= ctx.storeys; l++) {
      // the upper floor is one volume: it perches on the larger block when the
      // plot has slack, else spans the whole footprint
      const base = progNeed(ctx, l) < gU * 0.78 ? big : bbox(groundBlocks)
      const up = within(shrinkCorner(base, upperTarget(ctx, l, gU)), g)
      floors.push(floor(l, [up], l === ctx.storeys ? flatRoof(ctx.roofBias, rng) : { kind: 'flat' }))
    }
    return plan(type, floors, within(coreWest(a, ctx), g), ctx.entrySide)
  }
}

const sideWing: Arch = (env, ctx, rng, d) => {
  const g = groundBlock(env)
  const flip = rng.chance(0.5)
  const wingW = sn(clamp(g.w * rng.range(0.3, 0.4), 4000, g.w - 6000))
  const mainW = g.w - wingW
  const wingH = sn(clamp(g.h * rng.range(0.58, 0.82), 5000, g.h))
  // `main` is the full-height block; put the stair core on its OUTER edge so the
  // upper floors keep one contiguous fillable region
  const main: Rect = { x: flip ? sn(g.x + wingW) : g.x, y: g.y, w: mainW, h: g.h }
  const wing: Rect = { x: flip ? g.x : sn(g.x + mainW), y: rng.chance(0.5) ? g.y : sn(rectBottom(g) - wingH), w: wingW, h: wingH }
  const core = flip ? coreEast(g, ctx) : coreWest(g, ctx)
  const floors: FloorMassing[] = [floor(0, [main, wing], { kind: 'flat-parapet' })]
  // Upstairs is a clean rectangle over the whole footprint — the low wing simply
  // stops at one storey and its flat roof reads as a terrace. Keeping every upper
  // floor the full width keeps the stair column on the outer wall.
  const rectBase = bbox([main, wing])
  const eastCore = core.x > g.x + g.w / 2
  for (let l = 1; l <= ctx.storeys; l++) {
    const roomy = progNeed(ctx, l) < area(rectBase) / 1e6 - 12
    let b = rectBase
    if (roomy) {
      const s = shrinkCorner(rectBase, upperTarget(ctx, l, area(rectBase) / 1e6))
      // pull the shrink toward the core wall, not away from it
      b = eastCore ? { ...s, x: sn(rectRight(rectBase) - s.w) } : s
    }
    const cant = covFrac(b, [main, wing]) < 0.6 ? [0] : []
    floors.push(floor(l, [b], l === ctx.storeys ? flatRoof(ctx.roofBias, rng) : { kind: 'flat' }, cant))
  }
  void d
  return plan('side-wing', floors, within(core, g), ctx.entrySide)
}

const frontProjection: Arch = (env, ctx, rng, d) => {
  const g = groundBlock(env)
  const projD = sn(clamp(amp(d) * 1400, 1600, g.h * 0.32))
  const projW = sn(clamp(g.w * rng.range(0.34, 0.5), 4000, g.w - 3000))
  const main: Rect = { x: g.x, y: g.y, w: g.w, h: sn(g.h - projD) }
  const proj: Rect = { x: sn(g.x + (g.w - projW) * rng.range(0.15, 0.85)), y: sn(rectBottom(main)), w: projW, h: projD }
  const floors: FloorMassing[] = [floor(0, [main, within(proj, g)], { kind: 'flat-parapet' })]
  const gU = rectUnionArea([main, within(proj, g)]) / 1e6
  let prev = bbox([main, proj])
  for (let l = 1; l <= ctx.storeys; l++) {
    let b = within(shrinkTo(prev, upperTarget(ctx, l, gU)), g)
    const cant: number[] = []
    if (l === 1 && rng.chance(0.55)) {
      // the upper floor projects over the ground-floor projection (double-height entry / porch)
      b = { ...b, y: sn(Math.max(g.y, proj.y - rng.range(400, cantMax(d)))), h: sn(b.h + 1000) }
      cant.push(0)
    }
    floors.push(floor(l, [b], l === ctx.storeys ? flatRoof(ctx.roofBias, rng) : { kind: 'flat' }, cant))
    prev = b
  }
  return plan('front-projection', floors, within(coreCentre(main, ctx), g), ctx.entrySide)
}

const centralCore: Arch = (env, ctx, rng, d) => {
  const g = groundBlock(env)
  const floors: FloorMassing[] = [floor(0, [g], { kind: 'flat-parapet' })]
  let prev = g
  for (let l = 1; l <= ctx.storeys; l++) {
    // upper floors stay centred and shrink evenly (a tidy tower-on-podium)
    const t = upperTarget(ctx, l, area(g) / 1e6)
    const k = Math.sqrt(clamp((t * 1e6) / area(prev), 0.4, 1))
    const w = sn(prev.w * k)
    const h = sn(prev.h * k)
    const b = within({ x: sn(prev.x + (prev.w - w) / 2), y: sn(prev.y + (prev.h - h) / 2), w, h }, g)
    floors.push(floor(l, [b], l === ctx.storeys ? flatRoof(ctx.roofBias, rng) : { kind: 'flat' }))
    prev = b
  }
  void d
  return plan('central-core', floors, within(coreCentre(g, ctx), g), ctx.entrySide)
}

const asymmetric: Arch = (env, ctx, rng, d) => {
  // a free composition: 2 ground blocks of unequal size that share a full edge,
  // upper floor perched and cantilevered off the larger one
  const g = groundBlock(env)
  const split = rng.range(0.52, 0.64)
  const horiz = g.w >= g.h
  const a: Rect = horiz
    ? { x: g.x, y: g.y, w: sn(g.w * split), h: g.h }
    : { x: g.x, y: g.y, w: g.w, h: sn(g.h * split) }
  // block B butts against A's far edge and runs the rest of the plot; it is
  // deliberately shorter on the cross axis so the join reads as an L/step
  const b: Rect = horiz
    ? { x: sn(rectRight(a)), y: g.y, w: sn(rectRight(g) - rectRight(a)), h: sn(g.h * rng.range(0.74, 0.96)) }
    : { x: g.x, y: sn(rectBottom(a)), w: sn(g.w * rng.range(0.74, 0.96)), h: sn(rectBottom(g) - rectBottom(a)) }
  const groundBlocks = [a, within(b, g)].filter((r) => r.w > 2400 && r.h > 2400)
  const gU = rectUnionArea(groundBlocks) / 1e6
  const floors: FloorMassing[] = [floor(0, groundBlocks, { kind: 'flat-parapet' })]
  // perch the upper floor over the larger ground volume when the plot has slack,
  // else over the whole footprint
  let host = progNeed(ctx, 1) < gU * 0.72 ? groundBlocks[0] : bbox(groundBlocks)
  for (let l = 1; l <= ctx.storeys; l++) {
    let up = within(shrinkTo(host, upperTarget(ctx, l, gU)), g)
    const proj = sn(rng.range(cantMax(d) * 0.5, cantMax(d)))
    const projected = rng.chance(0.5)
      ? within({ ...up, h: sn(up.h + proj) }, env)
      : within({ ...up, w: sn(up.w + proj) }, env)
    const cant = area(projected) > area(up) + 1e5 ? [0] : []
    floors.push(floor(l, [projected], l === ctx.storeys ? flatRoof(ctx.roofBias, rng) : { kind: 'flat' }, cant))
    host = projected
  }
  // core at the outer edge of the larger block so its whole inner face is free
  // to open onto the second block
  return plan('asymmetric', floors, within(coreWest(groundBlocks[0], ctx), g), ctx.entrySide)
}

export const ARCHETYPES: Record<MassingType, Arch> = {
  rectangular,
  'l-shape': lOrT('l-shape'),
  't-shape': lOrT('t-shape'),
  'u-shape': courtLike('u-shape'),
  courtyard: courtLike('courtyard'),
  'rear-courtyard': courtLike('rear-courtyard'),
  'offset-box': offsetBox,
  'split-volume': twinVolume('split-volume'),
  cantilever,
  stepped,
  interlocking: twinVolume('interlocking'),
  'central-core': centralCore,
  'side-wing': sideWing,
  'front-projection': frontProjection,
  asymmetric,
}

/** union area (m²) of a floor's blocks */
export const floorAreaSqm = (fm: FloorMassing): number => rectUnionArea(fm.blocks) / 1e6
