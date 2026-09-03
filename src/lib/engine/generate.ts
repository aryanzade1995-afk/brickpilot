import {
  type Rect,
  type Point,
  snap,
  rectArea,
  rectBottom,
  rectRight,
  rectCenter,
  sharedEdge,
  toSqm,
  rectUnionBBox,
  rectUnionArea,
  rectUnionEdges,
} from '../geometry.ts'
import type { CanonicalModel, FloorProgram, Relationship, SpaceReq } from '../model/canonical.ts'
import { themeOf } from '../model/themes.ts'
import { squarify } from './treemap.ts'
import { planMassing } from './massing/grammar.ts'
import type { MassingCtx } from './massing/archetypes.ts'
import type { FloorMassing, MassingPlan, MassingRequest, MassingType } from './massing/types.ts'
import { MASSING_LABEL } from './massing/types.ts'

const MASSING_BLURB: Partial<Record<MassingType, string>> = {
  rectangular: 'One clean block — the shortest walls, the simplest structure.',
  'l-shape': 'Two legs around a sheltered corner court; the sleeping wing steps back upstairs.',
  't-shape': 'A cross-axis block — a public bar across a private stem.',
  'u-shape': 'Three wings embracing an open court on one side.',
  courtyard: 'Rooms wrap a true central courtyard — light and air to every side.',
  'rear-courtyard': 'A private court held at the back, away from the road.',
  'offset-box': 'The upper floor slides off the lower — a deep shadow line and a covered edge.',
  'split-volume': 'Two volumes of different height joined by a glazed link.',
  cantilever: 'The upper floor reaches out past the ground — a sheltered entry beneath.',
  stepped: 'Each floor shifts, its roof the terrace of the one above.',
  interlocking: 'Two volumes overlap and pass through each other.',
  'central-core': 'A tidy tower set back on a broad ground-floor podium.',
  'side-wing': 'A tall main house with a low service wing alongside.',
  'front-projection': 'A projecting room reaches toward the street; the upper floor bridges over the entry.',
  asymmetric: 'A free composition of unequal volumes with a bold cantilever.',
}
import type { Design, FloorPlan, Opening, PlacedRoom, StairRun, Wall } from './types.ts'
import { validate } from '../rules/index.ts'

const EXT_WALL = 230
const INT_WALL = 115
const STAIR_LEN = 4000
const DOOR = 900

const ZONE_ORDER: Record<string, number> = {
  social: 0,
  service: 1,
  sacred: 2,
  work: 3,
  private: 4,
  outdoor: 5,
  circulation: 6,
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

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
    blurb: 'The stair sits centrally and the plan opens into a living wing and a sleeping wing, each with its own aspect.',
  },
]

export type GenerateOpts = {
  /** kept for back-compat — maps onto an archetype hint */
  strategy?: Strategy
  massing?: MassingType | 'auto' | 'random'
  diversity?: MassingRequest['diversity']
  seed?: number
}

/**
 * A handful of validated schemes from one brief — the "directions" the user
 * picks between. Now genuinely different architectures: the auto pick plus
 * distinct alternates, all from the same seed.
 */
export type DirectionResult = {
  /** the concrete archetype this direction resolved to */
  massing: MassingType
  /** the seed that produced it — written to the brief when pinned */
  seed: number
  label: string
  blurb: string
  design: Design
}

export function generateDirections(model: CanonicalModel): DirectionResult[] {
  const seed = model.brief.variation
  const want = model.brief.style.massing
  const base = { design: generate(model, { massing: want, seed }), seed }
  const out = [base]
  const seenTypes = new Set([base.design.massingType])

  // Offer a genuine spread: the auto pick, then a curated ladder of structurally
  // distinct archetypes (compact → notched → split → projecting). Each is kept
  // only if it validates hard-clean AND resolved to a new massing type.
  const ladder: (MassingType | 'auto')[] = [
    'auto',
    'l-shape',
    'courtyard',
    'cantilever',
    'side-wing',
    'split-volume',
    'stepped',
    'central-core',
    'front-projection',
    'rectangular',
  ]
  for (const m of ladder) {
    if (out.length >= 4) break
    const altSeed = seed + out.length * 977
    const d = generate(model, { massing: m, seed: altSeed })
    if (seenTypes.has(d.massingType)) continue
    // don't offer a broken alternate — it must pass the hard checks
    if (!validate(d).hardChecksPass) continue
    seenTypes.add(d.massingType)
    out.push({ design: d, seed: altSeed })
  }

  return out.map(({ design, seed: s }) => ({
    massing: design.massingType,
    seed: s,
    label: MASSING_LABEL[design.massingType],
    blurb: MASSING_BLURB[design.massingType] ?? 'A distinct architectural massing from the same brief.',
    design,
  }))
}

export function generate(model: CanonicalModel, opts: Strategy | GenerateOpts = {}): Design {
  const o: GenerateOpts = typeof opts === 'string' ? { strategy: opts } : opts
  const grid = model.grid
  const large = model.brief.project.buildingType === 'large-villa'

  const req: MassingRequest = {
    type:
      o.massing ??
      (o.strategy === 'wing-split' ? 'side-wing' : o.strategy === 'orthogonal-core' ? 'rectangular' : model.brief.style.massing),
    diversity: o.diversity ?? model.brief.style.diversity,
    seed: o.seed ?? model.brief.variation,
  }

  const envelope: Rect = {
    x: model.setbacksMm.W,
    y: model.setbacksMm.N,
    w: model.envelope.width,
    h: model.envelope.depth,
  }
  const plotRect: Rect = { x: 0, y: 0, w: model.plot.width, h: model.plot.depth }

  // --- front strip: covered outdoor sits between the house and the road ---
  const outdoorIds = new Set(model.floors[0].spaces.filter((s) => s.outdoor).map((s) => s.id))
  const twoCar = model.brief.spaces.occupants >= 4
  const parkD = 5200
  const verandahD = 2600
  let frontStrip = 0
  if (outdoorIds.has('parking')) frontStrip = parkD
  else if (outdoorIds.has('verandah') || outdoorIds.has('courtyard')) frontStrip = verandahD
  if (frontStrip > 0) frontStrip += 300

  // --- house footprint ---
  const plotArea = model.plot.width * model.plot.depth
  let houseW = snap(Math.min(envelope.w, 22000), grid)
  let houseH = snap(clamp(envelope.h - frontStrip, 6000, 18000), grid)

  if (large) {
    // A large villa is sized to its (inflated) programme, not to the whole plot
    // — grander rooms that stay believable rather than ballooning to fill a big
    // site. The ground footprint must hold the busiest single floor; shape it to
    // the plot aspect and cap it under the concept coverage limit.
    const floorProg = (spaces: SpaceReq[]) =>
      spaces.filter((s) => !s.outdoor).reduce((a, s) => a + s.target, 0) * 1e6
    const busiest = Math.max(...model.floors.map((fp) => floorProg(fp.spaces)))
    const envH = clamp(envelope.h - frontStrip, 6000, 24000)
    const envW = Math.min(envelope.w, 30000)
    const budget = Math.min((busiest / 0.62) * 1.15, plotArea * 0.56)
    houseW = snap(clamp(Math.sqrt(budget * (envW / envH)), 11000, envW), grid)
    houseH = snap(clamp(budget / houseW, 9000, envH), grid)
  }
  // --- the buildable ground rectangle the massing grammar carves blocks from ---
  const env: Rect = {
    x: snap(envelope.x + (envelope.w - houseW) / 2, grid),
    y: envelope.y,
    w: houseW,
    h: houseH,
  }
  const coreW = snap(clamp(model.brief.levels.stairWidth * 2 + 600, 2400, 2900), grid)

  const floorProgSqm = model.floors.map(
    (fp) => fp.spaces.filter((s) => !s.outdoor).reduce((a, s) => a + s.target, 0) + 12,
  )
  const mctx: MassingCtx = {
    storeys: model.brief.levels.storeys,
    coreW,
    entrySide: model.entrySide,
    grid,
    plotW: model.plot.width,
    plotD: model.plot.depth,
    floorProgSqm,
    roofBias: themeOf(model.brief).roofBias,
  }
  // brief-key is the variation-independent hash (before the `-<variation>` tail)
  // so a pinned direction reproduces exactly when its seed is written to the brief
  const briefKey = model.seed.split('-')[0]
  const plan = planMassing(env, mctx, req, briefKey)

  // the stair core sits in the column every storey shares (planMassing.placeCore)
  const gbb = rectUnionBBox(plan.floors[0].blocks)
  const coreRect: Rect = {
    x: clamp(snap(plan.coreBlock.x, grid), gbb.x, rectRight(gbb) - coreW),
    y: snap(plan.coreBlock.y, grid),
    w: coreW,
    h: Math.min(plan.coreBlock.h, STAIR_LEN + 900),
  }
  const stairRect: Rect = {
    x: coreRect.x + INT_WALL,
    y: coreRect.y + INT_WALL,
    w: coreRect.w - INT_WALL * 2,
    h: STAIR_LEN,
  }

  const ctx: Ctx = { houseRect: gbb, coreRect, stairRect, envelope, grid, twoCar, large, plan }
  const floors = model.floors.map((fp, i) => buildFloor(fp, model, ctx, plan.floors[i]))

  const groundMm2 = rectUnionArea(floors[0].footprint)
  const builtMm2 = floors.reduce((a, f) => a + rectUnionArea(f.footprint), 0)
  const outdoorMm2 = floors[0].rooms
    .filter((r) => r.outdoor)
    .reduce((a, r) => a + rectArea(r.rect), 0)
  const builtAreaSqm = toSqm(builtMm2)
  const coverage = (groundMm2 + outdoorMm2 * 0.5) / rectArea(plotRect)
  const heightM = Math.round((floors.length * model.brief.levels.floorToFloor + 1) * 10) / 10

  const doors = floors.reduce(
    (n, f) => n + f.openings.filter((o) => o.kind === 'door' || o.kind === 'entry').length,
    0,
  )
  const windows = floors.reduce((n, f) => n + f.openings.filter((o) => o.kind === 'window').length, 0)

  return {
    id: `${model.seed}-${plan.type}-${req.seed}`,
    seed: model.seed,
    algorithm: 'massing-grammar-v1',
    candidate: plan.type,
    massingType: plan.type,
    model,
    floors,
    builtAreaSqm,
    footprintSqm: toSqm(groundMm2),
    coveredFootprintSqm: toSqm(groundMm2 + outdoorMm2),
    heightM,
    coverage,
    openingCounts: { doors, windows },
  }
}

type Ctx = {
  /** bbox of the ground floor's blocks — the many clamp/snap sites use this */
  houseRect: Rect
  coreRect: Rect
  stairRect: Rect
  envelope: Rect
  grid: number
  twoCar: boolean
  large: boolean
  plan: MassingPlan
}

function buildFloor(
  fp: FloorProgram,
  model: CanonicalModel,
  ctx: Ctx,
  fm: FloorMassing,
): FloorPlan {
  const { coreRect, stairRect, envelope, grid, twoCar } = ctx
  const rooms: PlacedRoom[] = []
  const blocks = fm.blocks
  const houseRect = rectUnionBBox(blocks)

  const core = fp.spaces.filter((s) => s.zone === 'circulation')
  const outdoor = fp.spaces.filter((s) => s.outdoor)
  const interior = [...fp.spaces.filter((s) => s.zone !== 'circulation' && !s.outdoor)].sort(
    (a, b) => (ZONE_ORDER[a.zone] ?? 9) - (ZONE_ORDER[b.zone] ?? 9),
  )

  // ---- the block that carries the vertical core, and the core strip within it.
  // planMassing guarantees a block on every storey covers the canonical coreRect
  // column, so the stair lands at the same (x,y) on each floor.
  const coreCx = coreRect.x + coreRect.w / 2
  const coreCy = coreRect.y + Math.min(coreRect.h, STAIR_LEN) / 2
  const coreBlock =
    blocks.find(
      (b) =>
        coreCx >= b.x - 2 &&
        coreCx <= rectRight(b) + 2 &&
        coreRect.y >= b.y - 2 &&
        rectBottom(b) >= coreRect.y + STAIR_LEN - 2,
    ) ??
    blocks.find((b) => coreCx >= b.x && coreCx <= rectRight(b) && coreCy >= b.y && coreCy <= rectBottom(b)) ??
    [...blocks].sort((a, b) => rectArea(b) - rectArea(a))[0]
  const coreStrip: Rect = {
    x: clamp(snap(coreRect.x, grid), coreBlock.x, Math.max(coreBlock.x, rectRight(coreBlock) - coreRect.w)),
    y: coreRect.y,
    w: coreRect.w,
    h: rectBottom(coreBlock) - coreRect.y,
  }

  // ---- core strip, north→south: [stair] [circulation?] [foyer / lobby] ----
  const stairSpace = core.find((s) => s.id === 'stair')
  const frontSpace = core.find((s) => s.id === 'foyer' || s.id.startsWith('lobby'))
  const circSpace = core.find((s) => s.id.startsWith('circ'))

  const southStart = stairSpace ? stairRect.y + stairRect.h : coreStrip.y
  let cursor = southStart
  const southH = rectBottom(coreStrip) - southStart

  if (stairSpace) {
    rooms.push(place(stairSpace, { x: coreStrip.x, y: coreStrip.y, w: coreStrip.w, h: stairRect.h }))
  }
  if (circSpace && southH > 3200) {
    const circH = snap(clamp(southH * 0.42, 1600, 3200), grid)
    rooms.push(place(circSpace, { x: coreStrip.x, y: cursor, w: coreStrip.w, h: circH }))
    cursor += circH
  }
  if (frontSpace) {
    rooms.push(
      place(frontSpace, { x: coreStrip.x, y: cursor, w: coreStrip.w, h: rectBottom(coreStrip) - cursor }),
    )
  }

  // ---- main area: treemap of interior spaces, bedrooms carrying their ensuite ----
  const bathFor = new Map<string, SpaceReq>()
  const consumed = new Set<string>()
  model.relationships
    .filter((rel) => rel.kind === 'adjacent')
    .forEach((rel) => {
      const bed = interior.find((s) => s.id === rel.a && s.zone === 'private')
      const bath = interior.find((s) => s.id === rel.b && s.wet)
      if (bed && bath) {
        bathFor.set(bed.id, bath)
        consumed.add(bath.id)
      }
    })

  const units = interior
    .filter((s) => !consumed.has(s.id))
    .map((s) => {
      const bath = bathFor.get(s.id)
      return { id: s.id, weight: s.target + (bath?.target ?? 0), room: s, bath }
    })

  // a ring plan (courtyard / U) or any multi-block footprint fills its spare
  // bands with halls so every wing stays connected
  const court = fp.level === 0 ? ctx.plan.courtyard : null
  const multiRegion = blocks.length > 1 || !!court

  const snapRect = (r: Rect): Rect => {
    const x = clamp(snap(r.x, grid), houseRect.x, rectRight(houseRect) - grid)
    const y = clamp(snap(r.y, grid), houseRect.y, rectBottom(houseRect) - grid)
    return {
      x,
      y,
      w: Math.min(snap(r.w, grid), rectRight(houseRect) - x),
      h: Math.min(snap(r.h, grid), rectBottom(houseRect) - y),
    }
  }

  const fill = (us: typeof units, region: Rect, tag = '') => {
    if (region.w < 1500 || region.h < 1500) return

    // An empty region (a spare wing on a sparse upper floor, or a connecting
    // band of a courtyard / U ring on any floor) becomes one hall — it fills the
    // footprint and, on a ring plan, is the corridor that keeps every wing
    // reachable.
    if (us.length === 0) {
      if (fp.level > 0 || multiRegion) {
        rooms.push(place(hallSpace(fp.level, tag, toSqm(rectArea(region))), snapRect(region)))
      }
      return
    }

    // A sparse upper floor leaves the treemap more area than the programme needs,
    // so every room inflates past its brief maximum. Carve the surplus off as a
    // hall strip against the core (a staple of Indian house planning, and a tidy
    // circulation spine) so the real rooms land near their target sizes.
    let roomRegion = region
    const surplus = toSqm(rectArea(region)) - us.reduce((a, u) => a + u.weight, 0)
    if (fp.level > 0 && surplus >= 8) {
      let hallW = snap((surplus * 1e6) / region.h, grid)
      hallW = Math.min(hallW, snap(region.w * 0.4, grid))
      if (hallW >= 2000 && region.w - hallW >= 3800) {
        rooms.push(
          place(hallSpace(fp.level, tag, surplus), snapRect({ ...region, w: hallW })),
        )
        roomRegion = { x: region.x + hallW, y: region.y, w: region.w - hallW, h: region.h }
      }
    }

    const cells = squarify(us.map((u) => ({ id: u.id, weight: u.weight })), roomRegion)
    for (const u of us) {
      const cell = cells.get(u.id)
      if (!cell) continue
      if (!u.bath) {
        rooms.push(place(u.room, snapRect(cell)))
        continue
      }
      const [bedRect, bathRect] = splitEnsuite(cell, u.bath.target, coreStrip)
      rooms.push(place(u.room, snapRect(bedRect)))
      rooms.push(place(u.bath, snapRect(bathRect)))
    }
  }

  // ---- one or more fillable regions per block (block minus the core strip,
  // minus the courtyard on the ground floor) ----
  const subtract = (r: Rect, hole: Rect): Rect[] => {
    const ix = Math.max(r.x, hole.x)
    const iy = Math.max(r.y, hole.y)
    const ir = Math.min(rectRight(r), rectRight(hole))
    const ib = Math.min(rectBottom(r), rectBottom(hole))
    if (ir - ix < 200 || ib - iy < 200) return [r] // no meaningful overlap
    const out: Rect[] = []
    if (ix - r.x > 1800) out.push({ x: r.x, y: r.y, w: snap(ix - r.x, grid), h: r.h })
    if (rectRight(r) - ir > 1800) out.push({ x: snap(ir, grid), y: r.y, w: snap(rectRight(r) - ir, grid), h: r.h })
    if (iy - r.y > 1800) out.push({ x: r.x, y: r.y, w: r.w, h: snap(iy - r.y, grid) })
    if (rectBottom(r) - ib > 1800) out.push({ x: r.x, y: snap(ib, grid), w: r.w, h: snap(rectBottom(r) - ib, grid) })
    return out.length ? out : [r]
  }
  const regions: { r: Rect; tag: string }[] = []
  blocks.forEach((b, bi) => {
    let pieces: Rect[] = [b]
    if (b === coreBlock) pieces = pieces.flatMap((p) => subtract(p, { ...coreStrip, y: houseRect.y, h: houseRect.h }))
    if (court) pieces = pieces.flatMap((p) => subtract(p, court))
    pieces.filter((p) => p.w > 2400 && p.h > 2400).forEach((r, pi) => regions.push({ r, tag: `b${bi}${pi}` }))
  })
  if (regions.length === 0) regions.push({ r: houseRect, tag: 'm' })

  // ---- distribute the units: largest-first into the region with the most slack ----
  const buckets: (typeof units)[] = regions.map(() => [])
  const load = regions.map(() => 0)
  for (const u of [...units].sort((a, b) => b.weight - a.weight)) {
    let bi = 0
    let best = -Infinity
    regions.forEach((rg, i) => {
      const slack = toSqm(rectArea(rg.r)) - load[i]
      if (slack > best) {
        best = slack
        bi = i
      }
    })
    buckets[bi].push(u)
    load[bi] += u.weight
  }
  regions.forEach((rg, i) => fill(buckets[i], rg.r, rg.tag))

  sealGaps(rooms, grid)
  repairNarrow(rooms, grid)
  sealGaps(rooms, grid)
  repairWindows(rooms, enclosedOutline(rooms))

  // ---- outdoor ----
  if (fp.level === 0 && outdoor.length > 0) {
    layoutFrontYard(outdoor, rooms, { houseRect, envelope, grid, twoCar, large: ctx.large })
  } else if (fp.level > 0) {
    for (const s of outdoor) {
      if (!s.id.startsWith('balcony')) continue
      const w = snap(clamp(houseRect.w * 0.4, 2400, 4200), grid)
      const d = 1500
      rooms.push(
        place(s, {
          x: snap(houseRect.x + houseRect.w / 2 - w / 2, grid),
          y: rectBottom(houseRect),
          w,
          h: d,
        }),
      )
    }
  }

  // the massing defines the outline (a rect union), not where rooms happened to land
  const outline = houseRect
  const walls = deriveWalls(rooms, blocks, court)
  const openings: Opening[] = []
  deriveDoors(rooms, model.relationships, openings)
  const entryRoom = rooms.find((r) => r.id === 'foyer' || r.id.startsWith('lobby'))
  if (entryRoom && fp.level === 0) {
    addEntry(entryRoom, outline, model.brief.entry.mainDoorWidth, openings)
  }
  // a full-height door on the facade behind every balcony
  for (const b of rooms) {
    if (!b.outdoor || !b.id.startsWith('balcony')) continue
    const at = { x: Math.round(b.rect.x + b.rect.w / 2), y: rectBottom(outline) }
    openings.push({ kind: 'door', at, orient: 'h', width: clamp(b.rect.w - 700, 900, 1600) })
  }
  // window rhythm on every daylight facade, clear of the doors above — the
  // spacing and proportion are set by the chosen design character. The mullion
  // grid is anchored to the ground footprint so stacked storeys line up.
  deriveWindows(rooms, outline, openings, themeOf(model.brief).windows, ctx.houseRect)

  const { reachable, unreachableRooms } = repairReachability(rooms, openings, fp.level)
  const stair = stairSpace ? makeStair(stairRect, model.brief.levels.floorToFloor) : undefined

  return {
    level: fp.level,
    name: fp.name,
    outline,
    footprint: blocks,
    roof: fm.roof,
    courtyard: court,
    rooms,
    walls,
    openings,
    stair,
    reachable,
    unreachableRooms,
  }
}

/* ---------------------------------- layout --------------------------------- */

function layoutFrontYard(
  outdoor: SpaceReq[],
  rooms: PlacedRoom[],
  o: { houseRect: Rect; envelope: Rect; grid: number; twoCar: boolean; large: boolean },
) {
  const { houseRect, envelope, grid, twoCar, large } = o
  const frontY = rectBottom(houseRect) + 200
  const availH = rectBottom(envelope) - frontY - 100
  let cx = houseRect.x

  const sizeFor = (s: SpaceReq): { w: number; h: number } => {
    if (s.id === 'parking') return { w: twoCar ? 5200 : 3000, h: Math.min(availH, 5000) }
    if (s.id === 'verandah') return { w: large ? 4200 : 3400, h: Math.min(availH, large ? 3200 : 2600) }
    // courtyard / forecourt — a large villa gets a generous entrance court
    return { w: large ? 4600 : 3200, h: Math.min(availH, large ? 4400 : 3200) }
  }

  for (const s of outdoor) {
    const { w, h } = sizeFor(s)
    let ww = snap(w, grid)
    if (cx + ww > rectRight(houseRect)) ww = rectRight(houseRect) - cx
    if (ww < 1500) break
    rooms.push(place(s, { x: cx, y: frontY, w: ww, h: snap(h, grid) }))
    cx += ww + 200
  }
}

/**
 * Carve an ensuite bath out of a bedroom cell, pushed to the interior (core)
 * side. The split axis is chosen so the bedroom keeps ≥ 2.4 m and the bath ≥
 * 1.5 m; if the cell is too small to honour both, the tighter constraint (the
 * bedroom) wins and the bath takes what's left.
 */
function splitEnsuite(cell: Rect, bathTargetSqm: number, coreStrip: Rect): [Rect, Rect] {
  const BED_MIN = 2400
  const BATH_MIN = 1500
  const bathArea = bathTargetSqm * 1e6
  const nearCoreWest = Math.abs(cell.x - rectRight(coreStrip)) < cell.w

  // width the bath would need on each axis, clamped so the bedroom keeps BED_MIN
  const bwV = clamp(bathArea / cell.h, BATH_MIN, Math.max(BATH_MIN, cell.w - BED_MIN))
  const bhH = clamp(bathArea / cell.w, BATH_MIN, Math.max(BATH_MIN, cell.h - BED_MIN))

  const vertOk = cell.w - bwV >= BED_MIN && cell.w >= BED_MIN + BATH_MIN
  const horizOk = cell.h - bhH >= BED_MIN && cell.h >= BED_MIN + BATH_MIN
  // prefer splitting along the longer axis when both work
  const splitVert = vertOk && (!horizOk || cell.w >= cell.h)

  if (splitVert) {
    return nearCoreWest
      ? [
          { x: cell.x + bwV, y: cell.y, w: cell.w - bwV, h: cell.h },
          { x: cell.x, y: cell.y, w: bwV, h: cell.h },
        ]
      : [
          { x: cell.x, y: cell.y, w: cell.w - bwV, h: cell.h },
          { x: cell.x + cell.w - bwV, y: cell.y, w: bwV, h: cell.h },
        ]
  }
  if (horizOk) {
    return [
      { x: cell.x, y: cell.y + bhH, w: cell.w, h: cell.h - bhH },
      { x: cell.x, y: cell.y, w: cell.w, h: bhH },
    ]
  }
  // neither axis leaves both rooms legal — split the longer axis in a way that
  // at least keeps the bedroom square-ish; repairNarrow mops up the rest
  if (cell.w >= cell.h) {
    const bw = clamp(cell.w * 0.36, BATH_MIN, cell.w - 2000)
    return [
      { x: cell.x + (nearCoreWest ? bw : 0), y: cell.y, w: cell.w - bw, h: cell.h },
      { x: nearCoreWest ? cell.x : cell.x + cell.w - bw, y: cell.y, w: bw, h: cell.h },
    ]
  }
  const bh = clamp(cell.h * 0.36, BATH_MIN, cell.h - 2000)
  return [
    { x: cell.x, y: cell.y + bh, w: cell.w, h: cell.h - bh },
    { x: cell.x, y: cell.y, w: cell.w, h: bh },
  ]
}

/**
 * Widen any habitable room the treemap left below the concept minimum width by
 * sliding its party wall into the adjacent room(s) on one side — a column of
 * stacked neighbours counts, as long as together they fully cover the narrow
 * room's span and each stays above the minimum. The enclosed outline and every
 * unrelated party wall are untouched.
 */
function repairNarrow(rooms: PlacedRoom[], grid: number) {
  const enc = rooms.filter((r) => !r.outdoor)
  for (const r of enc) {
    const habitable = r.zone === 'private' || r.zone === 'social' || r.zone === 'work'
    // habitable rooms want 2.4 m; a wet/service room only needs to clear its own
    // 1.3 m concept minimum
    const MIN = habitable ? 2400 : r.zone === 'service' ? 1400 : 0
    if (MIN === 0) continue
    for (let pass = 0; pass < 2; pass++) {
      const nx = r.rect.w < MIN && r.rect.w <= r.rect.h
      const ny = r.rect.h < MIN && r.rect.h < r.rect.w
      if (!nx && !ny) break
      const need = snap((nx ? MIN - r.rect.w : MIN - r.rect.h) + 50, grid)

      // donors on a given side that cover the narrow room's whole span
      const pick = (side: 'lo' | 'hi') => {
        const ds = enc.filter((o) => {
          if (o === r || o.zone === 'circulation') return false
          const edgeOk = nx
            ? side === 'lo'
              ? Math.abs(rectRight(o.rect) - r.rect.x) < 2
              : Math.abs(o.rect.x - rectRight(r.rect)) < 2
            : side === 'lo'
              ? Math.abs(rectBottom(o.rect) - r.rect.y) < 2
              : Math.abs(o.rect.y - rectBottom(r.rect)) < 2
          if (!edgeOk) return false
          // the donor must stay above ITS own minimum, not the narrow room's
          const oMin =
            o.zone === 'private' || o.zone === 'social' || o.zone === 'work'
              ? 2400
              : o.zone === 'service'
                ? 1400
                : 1200
          return nx ? o.rect.w - need >= oMin : o.rect.h - need >= oMin
        })
        if (!ds.length) return null
        const cov = nx
          ? ds.reduce((a, o) => a + Math.max(0, Math.min(rectBottom(o.rect), rectBottom(r.rect)) - Math.max(o.rect.y, r.rect.y)), 0)
          : ds.reduce((a, o) => a + Math.max(0, Math.min(rectRight(o.rect), rectRight(r.rect)) - Math.max(o.rect.x, r.rect.x)), 0)
        const span = nx ? r.rect.h : r.rect.w
        return cov >= span - 2 * grid ? ds : null
      }

      const lo = pick('lo')
      const hi = lo ? null : pick('hi')
      const donors = lo ?? hi
      if (!donors) break

      if (nx) {
        if (lo) {
          for (const o of donors) o.rect = { ...o.rect, w: o.rect.w - need }
          r.rect = { ...r.rect, x: r.rect.x - need, w: r.rect.w + need }
        } else {
          for (const o of donors) o.rect = { ...o.rect, x: o.rect.x + need, w: o.rect.w - need }
          r.rect = { ...r.rect, w: r.rect.w + need }
        }
      } else if (lo) {
        for (const o of donors) o.rect = { ...o.rect, h: o.rect.h - need }
        r.rect = { ...r.rect, y: r.rect.y - need, h: r.rect.h + need }
      } else {
        for (const o of donors) o.rect = { ...o.rect, y: o.rect.y + need, h: o.rect.h - need }
        r.rect = { ...r.rect, h: r.rect.h + need }
      }
      r.area = toSqm(rectArea(r.rect))
      for (const o of donors) o.area = toSqm(rectArea(o.rect))
    }
  }
}

/**
 * Independent grid-snapping of treemap cells leaves hairline gaps (≤ a module or
 * two) between neighbouring rooms — enough to break `sharedEdge`, so a door or
 * reachability link can't be found. Close them: pull each room's right / bottom
 * edge out to meet the nearest room just past it (when they share real span).
 */
function sealGaps(rooms: PlacedRoom[], grid: number) {
  const enc = rooms.filter((r) => !r.outdoor)
  for (const r of enc) {
    for (const axis of ['x', 'y'] as const) {
      const far = axis === 'x' ? rectRight(r.rect) : rectBottom(r.rect)
      let snapTo: number | null = null
      for (const o of enc) {
        if (o === r) continue
        const oNear = axis === 'x' ? o.rect.x : o.rect.y
        const overlap =
          axis === 'x'
            ? Math.min(rectBottom(r.rect), rectBottom(o.rect)) - Math.max(r.rect.y, o.rect.y)
            : Math.min(rectRight(r.rect), rectRight(o.rect)) - Math.max(r.rect.x, o.rect.x)
        if (overlap < 600) continue
        const gap = oNear - far
        if (gap > 5 && gap <= grid * 2 && (snapTo === null || oNear < snapTo)) snapTo = oNear
      }
      if (snapTo === null) continue
      r.rect =
        axis === 'x' ? { ...r.rect, w: snapTo - r.rect.x } : { ...r.rect, h: snapTo - r.rect.y }
      r.area = toSqm(rectArea(r.rect))
    }
  }
}

/** swap any daylight-hungry room that ended up landlocked with a perimeter
 *  service room — but only when the swap-in footprint is one the habitable room
 *  can actually live in (min dimension + not a big area cut) */
function repairWindows(rooms: PlacedRoom[], outline: Rect) {
  const onPerimeter = (r: PlacedRoom) =>
    Math.abs(r.rect.x - outline.x) < 2 ||
    Math.abs(rectRight(r.rect) - rectRight(outline)) < 2 ||
    Math.abs(r.rect.y - outline.y) < 2 ||
    Math.abs(rectBottom(r.rect) - rectBottom(outline)) < 2

  const HABIT_MIN = 2400
  for (const r of rooms) {
    if (r.outdoor || !r.wantsWindow || onPerimeter(r)) continue
    const swap = rooms.find((o) => {
      if (o.outdoor || o.wantsWindow || o.zone === 'circulation' || !onPerimeter(o)) return false
      // the room we'd move into must still be habitable
      if (Math.min(o.rect.w, o.rect.h) < HABIT_MIN) return false
      if (rectArea(o.rect) < rectArea(r.rect) * 0.72) return false
      return Math.abs(rectArea(o.rect) - rectArea(r.rect)) < rectArea(r.rect) * 0.6
    })
    if (!swap) continue
    const tmp = r.rect
    r.rect = swap.rect
    swap.rect = tmp
    r.area = toSqm(rectArea(r.rect))
    swap.area = toSqm(rectArea(swap.rect))
  }
}

/* ---------------------------------- helpers -------------------------------- */

function place(s: SpaceReq, rect: Rect): PlacedRoom {
  return {
    id: s.id,
    name: s.name,
    zone: s.zone,
    rect,
    area: toSqm(rectArea(rect)),
    outdoor: s.outdoor,
    wantsWindow: s.wantsWindow,
  }
}

/** A slack-absorbing hall so treemap rooms don't inflate past the brief. */
function hallSpace(level: number, tag: string, sqm: number): SpaceReq {
  return {
    id: `hall${level}${tag}`,
    name: 'Hall',
    zone: 'circulation',
    target: sqm,
    min: 6,
    max: 999,
    wantsWindow: false,
    wet: false,
    outdoor: false,
  }
}

function enclosedOutline(rooms: PlacedRoom[]): Rect {
  const enc = rooms.filter((r) => !r.outdoor)
  const x0 = Math.min(...enc.map((r) => r.rect.x))
  const y0 = Math.min(...enc.map((r) => r.rect.y))
  const x1 = Math.max(...enc.map((r) => rectRight(r.rect)))
  const y1 = Math.max(...enc.map((r) => rectBottom(r.rect)))
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

/** exterior walls trace the rect-union boundary (+ the courtyard hole); interior
 *  walls are room–room shared edges that don't lie on that boundary */
function deriveWalls(rooms: PlacedRoom[], blocks: Rect[], hole: Rect | null): Wall[] {
  const boundary = rectUnionEdges(blocks, hole)
  const walls: Wall[] = boundary.map((e) => ({
    a: e.a,
    b: e.b,
    thickness: EXT_WALL,
    kind: 'exterior' as const,
  }))

  const onBoundary = (seg: { a: Point; b: Point }): boolean => {
    const horiz = Math.abs(seg.a.y - seg.b.y) < 2
    return boundary.some((e) => {
      const eh = Math.abs(e.a.y - e.b.y) < 2
      if (eh !== horiz) return false
      if (horiz) {
        if (Math.abs(e.a.y - seg.a.y) > 2) return false
        const s0 = Math.min(seg.a.x, seg.b.x)
        const s1 = Math.max(seg.a.x, seg.b.x)
        const e0 = Math.min(e.a.x, e.b.x)
        const e1 = Math.max(e.a.x, e.b.x)
        return Math.min(s1, e1) - Math.max(s0, e0) > 400
      }
      if (Math.abs(e.a.x - seg.a.x) > 2) return false
      const s0 = Math.min(seg.a.y, seg.b.y)
      const s1 = Math.max(seg.a.y, seg.b.y)
      const e0 = Math.min(e.a.y, e.b.y)
      const e1 = Math.max(e.a.y, e.b.y)
      return Math.min(s1, e1) - Math.max(s0, e0) > 400
    })
  }

  const enc = rooms.filter((r) => !r.outdoor)
  const seen = new Set<string>()
  for (let i = 0; i < enc.length; i++) {
    for (let j = i + 1; j < enc.length; j++) {
      const e = sharedEdge(enc[i].rect, enc[j].rect)
      if (!e || e.length < 400) continue
      const key = `${Math.round(e.seg.a.x)},${Math.round(e.seg.a.y)},${Math.round(e.seg.b.x)},${Math.round(e.seg.b.y)}`
      if (seen.has(key)) continue
      seen.add(key)
      if (onBoundary(e.seg)) continue
      walls.push({ a: e.seg.a, b: e.seg.b, thickness: INT_WALL, kind: 'interior' })
    }
  }
  return walls
}

type WindowSpec = {
  mullionMm: number
  widthMm: number
  minRoomSqm: number
  perFacade: number
}

/**
 * At most one window per habitable room and no more than `perFacade` on any one
 * facade of a storey — the largest rooms win. Windows snap to a shared per-facade
 * mullion grid so they line up between storeys. Small rooms (baths, utility,
 * pooja) get none. The rhythm is a design-character choice.
 */
function deriveWindows(
  rooms: PlacedRoom[],
  outline: Rect,
  out: Opening[],
  spec: WindowSpec,
  gridRef: Rect,
) {
  const MULLION = spec.mullionMm // window-column spacing (mm)
  const MIN_ROOM = spec.minRoomSqm // m² — smaller habitable rooms get no massing window
  const WIN_W = spec.widthMm

  const edges = [
    { orient: 'h' as const, fixed: outline.y, lo: outline.x, hi: rectRight(outline), glo: gridRef.x, ghi: rectRight(gridRef) },
    { orient: 'h' as const, fixed: rectBottom(outline), lo: outline.x, hi: rectRight(outline), glo: gridRef.x, ghi: rectRight(gridRef) },
    { orient: 'v' as const, fixed: outline.x, lo: outline.y, hi: rectBottom(outline), glo: gridRef.y, ghi: rectBottom(gridRef) },
    { orient: 'v' as const, fixed: rectRight(outline), lo: outline.y, hi: rectBottom(outline), glo: gridRef.y, ghi: rectBottom(gridRef) },
  ]

  const touchesEdge = (r: PlacedRoom, orient: 'h' | 'v', fixed: number) =>
    orient === 'h'
      ? Math.abs(r.rect.y - fixed) < 2 || Math.abs(rectBottom(r.rect) - fixed) < 2
      : Math.abs(r.rect.x - fixed) < 2 || Math.abs(rectRight(r.rect) - fixed) < 2

  for (const e of edges) {
    const span = e.hi - e.lo
    if (span < 2400) continue
    // the column grid is fixed to the ground footprint (glo/ghi) so windows on
    // every storey snap to the same lines and stack vertically
    const gspan = e.ghi - e.glo
    const cols = Math.max(1, Math.round((gspan - 1400) / MULLION))
    const line = (i: number) => Math.round(e.glo + (gspan * (i + 0.5)) / cols)

    // biggest rooms on this facade first, capped
    const facadeRooms = rooms
      .filter(
        (r) =>
          !r.outdoor &&
          r.wantsWindow &&
          r.area >= MIN_ROOM &&
          touchesEdge(r, e.orient, e.fixed) &&
          (e.orient === 'h'
            ? rectRight(r.rect) - r.rect.x
            : rectBottom(r.rect) - r.rect.y) >= 1600,
      )
      .sort((a, b) => b.area - a.area)
      .slice(0, spec.perFacade)

    for (const r of facadeRooms) {
      const rlo = e.orient === 'h' ? r.rect.x : r.rect.y
      const rhi = e.orient === 'h' ? rectRight(r.rect) : rectBottom(r.rect)
      const rc = (rlo + rhi) / 2

      // nearest mullion column landing inside this room AND on this storey's
      // wall, else the room centre
      let along = Math.round(rc)
      let best = Infinity
      const wLo = Math.max(rlo, e.lo) + 600
      const wHi = Math.min(rhi, e.hi) - 600
      for (let i = 0; i < cols; i++) {
        const c = line(i)
        if (c > wLo && c < wHi && Math.abs(c - rc) < best) {
          best = Math.abs(c - rc)
          along = c
        }
      }

      const perpOf = (o: Opening) => (e.orient === 'h' ? o.at.y : o.at.x)
      const alongOf = (o: Opening) => (e.orient === 'h' ? o.at.x : o.at.y)
      const clash = out.some(
        (o) => Math.abs(perpOf(o) - e.fixed) < 400 && Math.abs(alongOf(o) - along) < 1300,
      )
      if (clash) continue
      const at: Point = e.orient === 'h' ? { x: along, y: e.fixed } : { x: e.fixed, y: along }
      out.push({ kind: 'window', at, orient: e.orient, width: Math.min(WIN_W, rhi - rlo - 1000) })
    }
  }
}

function deriveDoors(rooms: PlacedRoom[], rels: Relationship[], out: Opening[]) {
  const byId = new Map(rooms.map((r) => [r.id, r]))
  for (const rel of rels) {
    if (rel.kind === 'separated') continue
    const a = byId.get(rel.a)
    const b = byId.get(rel.b)
    if (!a || !b) continue
    const e = sharedEdge(a.rect, b.rect)
    if (!e || e.length < DOOR + 200) continue
    const mid = midOf(e.seg)
    if (out.some((o) => near(o.at, mid, 400))) continue
    out.push({ kind: 'door', at: mid, orient: e.side === 'N' || e.side === 'S' ? 'h' : 'v', width: DOOR, swing: 1 })
  }
}

function addEntry(foyer: PlacedRoom, outline: Rect, width: number, out: Opening[]) {
  const onSouth = Math.abs(rectBottom(foyer.rect) - rectBottom(outline)) < 2
  const onWest = Math.abs(foyer.rect.x - outline.x) < 2
  if (onSouth || !onWest) {
    out.push({ kind: 'entry', at: { x: rectCenter(foyer.rect).x, y: rectBottom(foyer.rect) }, orient: 'h', width, swing: -1 })
  } else {
    out.push({ kind: 'entry', at: { x: foyer.rect.x, y: rectCenter(foyer.rect).y }, orient: 'v', width, swing: 1 })
  }
}

function repairReachability(rooms: PlacedRoom[], openings: Opening[], level: number) {
  const enc = rooms.filter((r) => !r.outdoor)
  const adj = new Map<string, Set<string>>()
  enc.forEach((r) => adj.set(r.id, new Set()))
  const linkPair = (a: string, b: string) => {
    adj.get(a)?.add(b)
    adj.get(b)?.add(a)
  }

  for (let i = 0; i < enc.length; i++) {
    for (let j = i + 1; j < enc.length; j++) {
      const e = sharedEdge(enc[i].rect, enc[j].rect)
      if (!e) continue
      const mid = midOf(e.seg)
      if (openings.some((o) => (o.kind === 'door' || o.kind === 'entry') && near(o.at, mid, Math.max(700, e.length / 2)))) {
        linkPair(enc[i].id, enc[j].id)
      }
    }
  }

  const start =
    enc.find((r) => (level === 0 ? r.id === 'foyer' : r.id.startsWith('lobby'))) ??
    enc.find((r) => r.id === 'stair') ??
    enc[0]
  if (!start) return { reachable: false, unreachableRooms: enc.map((r) => r.id) }

  const seen = bfs(start.id, adj)
  let changed = true
  while (changed) {
    changed = false
    for (const r of enc) {
      if (seen.has(r.id)) continue
      let best: { other: string; len: number; mid: Point; orient: 'h' | 'v' } | null = null
      for (const other of enc) {
        if (!seen.has(other.id)) continue
        const e = sharedEdge(r.rect, other.rect)
        if (!e || e.length < DOOR) continue
        if (!best || e.length > best.len)
          best = { other: other.id, len: e.length, mid: midOf(e.seg), orient: e.side === 'N' || e.side === 'S' ? 'h' : 'v' }
      }
      if (best) {
        openings.push({ kind: 'door', at: best.mid, orient: best.orient, width: DOOR, swing: 1 })
        linkPair(r.id, best.other)
        for (const id of bfs(r.id, adj)) seen.add(id)
        changed = true
      }
    }
  }

  const unreachableRooms = enc.filter((r) => !seen.has(r.id)).map((r) => r.id)
  return { reachable: unreachableRooms.length === 0, unreachableRooms }
}

function bfs(startId: string, adj: Map<string, Set<string>>): Set<string> {
  const seen = new Set<string>([startId])
  const q = [startId]
  while (q.length) {
    const cur = q.shift() as string
    for (const n of adj.get(cur) ?? []) {
      if (!seen.has(n)) {
        seen.add(n)
        q.push(n)
      }
    }
  }
  return seen
}

function makeStair(rect: Rect, floorToFloor: number): StairRun {
  const risers = Math.max(14, Math.round((floorToFloor * 1000) / 175))
  const perFlight = Math.ceil(risers / 2)
  const flightW = rect.w / 2
  const treads: Point[][] = []
  const run = rect.h * 0.86
  const going = run / perFlight
  for (let i = 1; i < perFlight; i++) {
    const y = rect.y + i * going
    treads.push([{ x: rect.x, y }, { x: rect.x + flightW, y }])
  }
  for (let i = 1; i < perFlight; i++) {
    const y = rect.y + run - i * going
    treads.push([{ x: rect.x + flightW, y }, { x: rect.x + rect.w, y }])
  }
  return { rect, treads, direction: 'up' }
}

const midOf = (seg: { a: Point; b: Point }): Point => ({ x: (seg.a.x + seg.b.x) / 2, y: (seg.a.y + seg.b.y) / 2 })
const near = (a: Point, b: Point, tol: number) => Math.abs(a.x - b.x) <= tol && Math.abs(a.y - b.y) <= tol
