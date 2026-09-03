import type { Rect } from '../../geometry.ts'
import { rectRight, rectBottom } from '../../geometry.ts'
import { makeRng } from './rng.ts'
import { ARCHETYPES, flatRoof, floorAreaSqm, type MassingCtx } from './archetypes.ts'
import { STATS } from './stats.ts'
import { MASSING_TYPES, type FloorMassing, type MassingPlan, type MassingRequest, type MassingType } from './types.ts'

/** archetypes whose ground floor is a single rectangle (vs a rect-union) */
const SINGLE_BLOCK = new Set<MassingType>([
  'rectangular',
  'offset-box',
  'cantilever',
  'stepped',
  'central-core',
])

/* ------------------------------------------------------------------ *
 *  planMassing — choose an archetype (auto / random / explicit), run
 *  it, validate the geometry, and re-roll on failure. Pure + seeded.
 * ------------------------------------------------------------------ */

const MIN_FLOOR_SQM = 26
const MAX_CANT_MM = 1800

const sn = (v: number) => Math.round(v / 100) * 100
const g0 = (r: Rect) => r.w * r.h

/** clamp every block hard inside the setback rectangle — no floor may oversail
 *  the building line, only the floor below it */
function clampToEnv(plan: MassingPlan, env: Rect): void {
  const fix = (b: Rect): Rect => {
    const x = Math.min(Math.max(b.x, env.x), rectRight(env) - 2400)
    const y = Math.min(Math.max(b.y, env.y), rectBottom(env) - 2400)
    return { x: sn(x), y: sn(y), w: sn(Math.min(b.w, rectRight(env) - x)), h: sn(Math.min(b.h, rectBottom(env) - y)) }
  }
  for (const fm of plan.floors) fm.blocks = fm.blocks.map(fix)
  if (plan.courtyard) plan.courtyard = fix(plan.courtyard)
  plan.coreBlock = fix(plan.coreBlock)
}

const bboxOf = (rs: Rect[]): Rect => {
  const x = Math.min(...rs.map((r) => r.x))
  const y = Math.min(...rs.map((r) => r.y))
  return { x, y, w: Math.max(...rs.map(rectRight)) - x, h: Math.max(...rs.map(rectBottom)) - y }
}

/** the stair core footprint that must be covered on every storey */
function coreFootprint(plan: MassingPlan): Rect {
  const c = plan.coreBlock
  return { x: c.x, y: c.y, w: Math.max(c.w, 2400), h: Math.min(Math.max(c.h, 4200), 5200) }
}

/**
 * Drop the stair core into the column every storey shares (the intersection of
 * the per-floor bounding boxes), as near as possible to where the archetype put
 * it. Returns false when there is no such column tall/wide enough for a stair —
 * the plan is then rejected and re-rolled.
 */
function placeCore(plan: MassingPlan, ctx: MassingCtx): boolean {
  const bbs = plan.floors.map((fm) => bboxOf(fm.blocks))
  const ix = Math.max(...bbs.map((b) => b.x))
  const iy = Math.max(...bbs.map((b) => b.y))
  const ir = Math.min(...bbs.map(rectRight))
  const ib = Math.min(...bbs.map(rectBottom))
  const need = 4200
  if (ir - ix < ctx.coreW + 200 || ib - iy < need + 200) return false
  const want = plan.coreBlock
  const cx = Math.min(Math.max(want.x, ix), ir - ctx.coreW)
  plan.coreBlock = { x: sn(cx), y: sn(iy), w: ctx.coreW, h: Math.min(sn(ib - iy), 5000) }
  return true
}

/** fraction of `r` covered by the union of `blocks` */
function coveredFrac(r: Rect, blocks: Rect[]): number {
  let cover = 0
  for (const s of blocks) {
    const ox = Math.max(0, Math.min(rectRight(r), rectRight(s)) - Math.max(r.x, s.x))
    const oy = Math.max(0, Math.min(rectBottom(r), rectBottom(s)) - Math.max(r.y, s.y))
    cover += ox * oy
  }
  return cover / Math.max(1, g0(r))
}

/** every upper block must be mostly carried by the floor below, unless it is a
 *  declared cantilever projecting no more than MAX_CANT_MM */
function stackingOk(fm: FloorMassing, below: FloorMassing): boolean {
  const supp = below.blocks
  return fm.blocks.every((b, i) => {
    const bArea = b.w * b.h
    if (bArea <= 0) return false
    // supported fraction ≈ overlap with the union below
    let cover = 0
    for (const s of supp) {
      const ox = Math.max(0, Math.min(rectRight(b), rectRight(s)) - Math.max(b.x, s.x))
      const oy = Math.max(0, Math.min(rectBottom(b), rectBottom(s)) - Math.max(b.y, s.y))
      cover += ox * oy
    }
    const frac = cover / bArea
    if (frac >= 0.5) return true
    if (!fm.cantilevers.includes(i)) return false
    // a cantilever: the unsupported reach must be modest
    const bbBelow = { x: Math.min(...supp.map((s) => s.x)), y: Math.min(...supp.map((s) => s.y)) }
    const bbBelowR = Math.max(...supp.map(rectRight))
    const bbBelowB = Math.max(...supp.map(rectBottom))
    const reach = Math.max(
      bbBelow.x - b.x,
      rectRight(b) - bbBelowR,
      bbBelow.y - b.y,
      rectBottom(b) - bbBelowB,
    )
    return reach <= MAX_CANT_MM && frac >= 0.3
  })
}

function connected(blocks: Rect[]): boolean {
  if (blocks.length <= 1) return true
  const seen = new Set<number>([0])
  const q = [0]
  while (q.length) {
    const i = q.shift()!
    for (let j = 0; j < blocks.length; j++) {
      if (seen.has(j)) continue
      const a = blocks[i]
      const b = blocks[j]
      // overlap OR share an edge of usable length
      const ox = Math.min(rectRight(a), rectRight(b)) - Math.max(a.x, b.x)
      const oy = Math.min(rectBottom(a), rectBottom(b)) - Math.max(a.y, b.y)
      if (ox > -1 && oy > -1 && (ox > 800 || oy > 800)) {
        seen.add(j)
        q.push(j)
      }
    }
  }
  return seen.size === blocks.length
}

export function validateMassingPlan(plan: MassingPlan, env: Rect, ctx?: MassingCtx): boolean {
  const tol = 260 // a grid module of snapping slack — no real oversail past the line
  const groundSqm = floorAreaSqm(plan.floors[0])
  const progNeed = (l: number) =>
    ((ctx?.floorProgSqm[l] ?? ctx?.floorProgSqm[ctx.floorProgSqm.length - 1] ?? 60) as number) / 0.72
  const core = coreFootprint(plan)
  for (let l = 0; l < plan.floors.length; l++) {
    const fm = plan.floors[l]
    if (fm.blocks.length === 0) return false
    for (const b of fm.blocks) {
      if (b.w < 2400 || b.h < 2400) return false
      if (b.x < env.x - tol || b.y < env.y - tol || rectRight(b) > rectRight(env) + tol || rectBottom(b) > rectBottom(env) + tol)
        return false
    }
    if (!connected(fm.blocks)) return false
    const fa = floorAreaSqm(fm)
    if (fa < (l === 0 ? MIN_FLOOR_SQM : MIN_FLOOR_SQM * 0.7)) return false
    // an upper floor must be big enough to hold its programme — not shrunk to a token
    if (l > 0 && ctx) {
      const floor_min = 0.7 * Math.min(groundSqm, progNeed(l))
      if (fa < floor_min) return false
    }
    // the stair core must be (almost) fully covered on every storey, or the
    // stair won't line up vertically
    if (coveredFrac(core, fm.blocks) < 0.9) return false
    if (l > 0 && !stackingOk(fm, plan.floors[l - 1])) return false
  }
  if (plan.courtyard) {
    const c = plan.courtyard
    if (c.w < 2200 || c.h < 2200) return false
    // the court must be a genuine void — no ground block interior covers it
    const covered = plan.floors[0].blocks.some((b) => {
      const ox = Math.min(rectRight(b), rectRight(c)) - Math.max(b.x, c.x)
      const oy = Math.min(rectBottom(b), rectBottom(c)) - Math.max(b.y, c.y)
      return ox > 1200 && oy > 1200
    })
    if (covered) return false
  }
  return true
}

/** how well an archetype fits a brief — 0..1, higher is better */
function fitScore(t: MassingType, ctx: MassingCtx, env: Rect): number {
  const aspect = env.w / env.h // >1 wide, <1 deep
  const elong = Math.max(aspect, 1 / aspect)
  const s = ctx.storeys
  // how tightly the ground-floor programme fills the buildable envelope
  const tight = ((ctx.floorProgSqm[0] ?? 60) / 0.72) / (g0(env) / 1e6)
  let score = 0.4
  const add = (c: boolean, v: number) => {
    if (c) score += v
  }
  // area-losing archetypes (a notch, a court, split volumes, a low wing) only
  // make sense when the plot has room to spare
  const AREA_LOSING: MassingType[] = [
    'l-shape', 't-shape', 'u-shape', 'courtyard', 'rear-courtyard',
    'split-volume', 'interlocking', 'side-wing', 'front-projection', 'asymmetric', 'offset-box', 'cantilever',
  ]
  if (AREA_LOSING.includes(t)) {
    if (tight > 0.95) score -= 0.5
    else if (tight > 0.82) score -= 0.22
  }
  if ((t === 'rectangular' || t === 'central-core' || t === 'stepped') && tight > 0.9) score += 0.25
  // real multi-storey buildings are non-rectangular only ~1 in 5 (STATS); a
  // gentle nudge toward simple rectangles so the `auto` mix leans that way
  // without losing the L / U / courtyard / split forms
  const nonRectPull = (0.5 - STATS.nonRectShare) * 0.28
  score += SINGLE_BLOCK.has(t) ? nonRectPull : -nonRectPull
  switch (t) {
    case 'rectangular':
      add(elong < 1.4, 0.15)
      add(s <= 1, 0.1)
      break
    case 'l-shape':
      add(elong > 1.15 && elong < 2.2, 0.3)
      add(env.w > 12000 && env.h > 11000, 0.2)
      break
    case 't-shape':
      add(elong < 1.5, 0.2)
      add(env.w > 13000, 0.15)
      break
    case 'u-shape':
    case 'courtyard':
      add(elong < 1.3 && env.w > 14000 && env.h > 14000, 0.45)
      add(ctx.floorProgSqm[0] > 120, 0.15)
      break
    case 'rear-courtyard':
      add(env.h > 15000, 0.35)
      break
    case 'cantilever':
      add(s >= 1, 0.35)
      add(ctx.roofBias === 'flat', 0.1)
      break
    case 'stepped':
      add(s >= 2, 0.4)
      break
    case 'offset-box':
      add(s >= 1, 0.3)
      add(elong > 1.2, 0.1)
      break
    case 'split-volume':
      add(elong > 1.5, 0.35)
      add(env.w > 16000 || env.h > 16000, 0.15)
      break
    case 'interlocking':
      add(s >= 1 && elong > 1.3, 0.35)
      break
    case 'central-core':
      add(elong < 1.25 && s >= 2, 0.35)
      break
    case 'side-wing':
      add(elong > 1.4, 0.35)
      break
    case 'front-projection':
      add(env.h > 12000, 0.3)
      add(s >= 1, 0.1)
      break
    case 'asymmetric':
      add(s >= 1, 0.25)
      add(elong > 1.2, 0.15)
      break
  }
  return Math.min(1, score)
}

export function planMassing(
  env: Rect,
  ctx: MassingCtx,
  req: MassingRequest,
  briefKey: string,
): MassingPlan {
  const attempt = (t: MassingType, salt: number): MassingPlan | null => {
    try {
      const rng = makeRng(req.seed, `${briefKey}|${t}|${salt}`)
      const p = ARCHETYPES[t](env, ctx, rng, req.diversity)
      clampToEnv(p, env)
      if (!placeCore(p, ctx)) return null
      // a G+0 house never runs the archetype's per-storey roof loop, so give its
      // single storey the style's roof here
      const top = p.floors[p.floors.length - 1]
      if (ctx.roofBias !== 'flat' && (top.roof.kind === 'flat' || top.roof.kind === 'flat-parapet')) {
        top.roof = flatRoof(ctx.roofBias, makeRng(req.seed, `${briefKey}|${t}|${salt}|roof`))
      }
      return validateMassingPlan(p, env, ctx) ? p : null
    } catch {
      return null
    }
  }

  const tryType = (t: MassingType): MassingPlan | null => {
    for (let k = 0; k < 6; k++) {
      const p = attempt(t, k)
      if (p) return p
    }
    return null
  }

  if (req.type !== 'auto' && req.type !== 'random') {
    return tryType(req.type) ?? tryType('rectangular') ?? forceRect(env, ctx)
  }

  const rng = makeRng(req.seed, `${briefKey}|choose`)
  if (req.type === 'random') {
    const order = [...MASSING_TYPES].sort(() => rng.next() - 0.5)
    for (const t of order) {
      const p = tryType(t)
      if (p) return p
    }
    return forceRect(env, ctx)
  }

  // auto: score every archetype, add seed jitter so the pick genuinely varies,
  // then a weighted choice over the leading half
  const scored = MASSING_TYPES.map(
    (t) => [t, Math.max(0.05, fitScore(t, ctx, env) + rng.range(-0.28, 0.28))] as [MassingType, number],
  ).sort((a, b) => b[1] - a[1])
  const pool = scored.slice(0, 7)
  const chosen = rng.weighted(pool)
  return tryType(chosen) ?? tryType(scored[0][0]) ?? tryType('rectangular') ?? forceRect(env, ctx)
}

/** last-resort: a plain rectangular stack that always validates. Upper floors
 *  shrink toward the core only as far as their programme allows. */
function forceRect(env: Rect, ctx: MassingCtx): MassingPlan {
  const g: Rect = { x: sn(env.x), y: sn(env.y), w: sn(Math.min(env.w, 22000)), h: sn(env.h) }
  const groundSqm = g0(g) / 1e6
  const floors: FloorMassing[] = [{ level: 0, blocks: [g], cantilevers: [], roof: { kind: 'flat' } }]
  let prev = g
  for (let l = 1; l <= ctx.storeys; l++) {
    const need = (ctx.floorProgSqm[l] ?? ctx.floorProgSqm[ctx.floorProgSqm.length - 1] ?? 60) / 0.72
    const k = Math.sqrt(Math.min(1, Math.max(0.78, need / groundSqm)))
    // NW-anchored: the west wall and the stair column never move
    const b: Rect = { x: g.x, y: g.y, w: sn(prev.w * k), h: sn(prev.h * k) }
    floors.push({ level: l, blocks: [b], cantilevers: [], roof: { kind: 'flat' } })
    prev = b
  }
  return {
    type: 'rectangular',
    floors,
    coreBlock: { x: g.x, y: g.y, w: ctx.coreW, h: Math.min(g.h, 5000) },
    courtyard: null,
    entrySide: ctx.entrySide,
  }
}
