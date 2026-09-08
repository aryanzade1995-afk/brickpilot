import {
  type Rect,
  type Point,
  type Segment,
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
import { pickShape } from './shape/pick.ts'
import { makeRng, type Rng } from './shape/rng.ts'
import { SHAPE_LABEL, SHAPE_BLURB, type Shape, type ShapeCtx, type Footprint } from './shape/types.ts'
import { layoutFloor } from './layout/place.ts'
import type { Design, FloorPlan, Opening, PlacedRoom, RoofSpec, StairRun, Wall } from './types.ts'
import { validate } from '../rules/index.ts'

export { SHAPE_LABEL }

const EXT_WALL = 230
const INT_WALL = 115
const STAIR_LEN = 4000
const DOOR = 900

/* --- opening placement, tuned to real plans (scripts/opening_stats.json) -----
 * ResPlan (16.3k real South-Asian plans) and SYNBUILD-3D agree: interior doors
 * sit a ~100 mm jamb off the nearest wall corner (84 % within 250 mm in both),
 * their centre ~30 % off the wall midpoint — NOT centred; the hinge lands in the
 * corner and the rest of the wall stays usable. Leaf clear width ~0.9 m
 * (ResPlan p50 0.94 m). Windows centre on the room's exterior wall (ResPlan
 * median 10 % off-centre), one per daylight room + bath (bath 92 %, bed 82 %),
 * living rooms often two; sill ~0.9 m (2-D datasets carry no sill — NBC norm). */
const JAMB = 110
const DOOR_LEAF = 900
const DOOR_CASED = 1500 // leaf-less opening where two living spaces meet on a wide wall (a design choice, not from the data)
const ZONE_PRIVACY: Record<string, number> = {
  social: 0,
  circulation: 1,
  service: 2,
  work: 3,
  sacred: 4,
  private: 5,
  outdoor: 0,
}

type Side4 = 'N' | 'S' | 'E' | 'W'
const SIDE4: Side4[] = ['N', 'S', 'E', 'W']

/**
 * A door/entry on a shared (or exterior) edge, seated a jamb-gap from the end
 * of the run nearer `toward` so the hinge is in a corner. A leaf-less `cased`
 * opening is centred instead. `swing` defaults to opening into the more private
 * of the two rooms.
 */
function doorOnEdge(
  edge: { seg: Segment; side: Side4; length: number },
  opts: {
    toward?: number
    width?: number
    swing?: 1 | -1
    kind?: 'door' | 'entry'
    cased?: boolean
  } = {},
): Opening {
  const horiz = edge.side === 'N' || edge.side === 'S'
  const lo = horiz ? Math.min(edge.seg.a.x, edge.seg.b.x) : Math.min(edge.seg.a.y, edge.seg.b.y)
  const hi = horiz ? Math.max(edge.seg.a.x, edge.seg.b.x) : Math.max(edge.seg.a.y, edge.seg.b.y)
  const fixed = horiz ? edge.seg.a.y : edge.seg.a.x
  const span = hi - lo
  const w = Math.min(opts.width ?? DOOR_LEAF, Math.max(700, span - 120))
  const half = w / 2
  const mid = (lo + hi) / 2
  const atEnd = opts.cased
    ? mid
    : opts.toward !== undefined && opts.toward > mid
      ? hi - JAMB - half
      : lo + JAMB + half
  const along = Math.round(clamp(atEnd, lo + half + 20, hi - half - 20))
  return {
    kind: opts.kind ?? 'door',
    at: horiz ? { x: along, y: fixed } : { x: fixed, y: along },
    orient: horiz ? 'h' : 'v',
    width: Math.round(w),
    swing: opts.swing ?? 1,
  }
}


const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

export type GenerateOpts = {
  /** override the brief's shape choice */
  shape?: Shape | 'auto'
  seed?: number
}

/**
 * A handful of validated schemes from one brief — the "directions" the user
 * picks between: the auto pick plus distinct footprint shapes from the same seed.
 */
export type DirectionResult = {
  /** the footprint shape this direction resolved to */
  shape: Shape
  /** the seed that produced it — written to the brief when pinned */
  seed: number
  label: string
  blurb: string
  design: Design
}

export function generateDirections(model: CanonicalModel): DirectionResult[] {
  const seed = model.brief.variation
  const want = model.brief.style.shape
  const base = { design: generate(model, { shape: want, seed }), seed }
  const out = [base]
  const seen = new Set<Shape>([base.design.shape])

  const ladder: (Shape | 'auto')[] = ['auto', 'rectangle', 'square', 'l-shape', 't-shape', 'u-shape', 'courtyard']
  for (const s of ladder) {
    if (out.length >= 4) break
    const altSeed = seed + out.length * 977
    const d = generate(model, { shape: s, seed: altSeed })
    if (seen.has(d.shape)) continue
    if (!validate(d).hardChecksPass) continue
    seen.add(d.shape)
    out.push({ design: d, seed: altSeed })
  }

  return out.map(({ design, seed: s }) => ({
    shape: design.shape,
    seed: s,
    label: SHAPE_LABEL[design.shape],
    blurb: SHAPE_BLURB[design.shape] ?? 'A distinct footprint shape from the same brief.',
    design,
  }))
}

export function generate(model: CanonicalModel, opts: GenerateOpts = {}): Design {
  const o = opts
  const grid = model.grid
  const large = model.brief.project.buildingType === 'large-villa'

  const seed = o.seed ?? model.brief.variation
  const want = o.shape ?? model.brief.style.shape

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

  // --- house footprint: sized to the busiest floor's programme, not the whole
  // plot, so rooms land near their brief targets instead of ballooning ---
  const plotArea = model.plot.width * model.plot.depth
  // the upper lobby folds into the hub — don't reserve floor area for it
  const busiestSqm =
    Math.max(
      ...model.floors.map((fp) =>
        fp.spaces
          .filter((s) => !s.outdoor && !/^lobby\d+$/.test(s.id))
          .reduce((a, s) => a + s.target, 0),
      ),
    ) * 1e6
  // covered parking sits mostly within the entry-side setback, so it only costs
  // the house the part that spills past it
  const entrySetback = Math.min(model.setbacksMm[model.entrySide] ?? 0, 3200)
  const stripCost = frontStrip > 0 ? Math.max(frontStrip * 0.4, frontStrip - entrySetback * 0.8) : 0
  const envH = clamp(envelope.h - stripCost, 6000, 24000)
  const envW = Math.min(envelope.w, large ? 30000 : 24000)
  // a real floor is ~76 % habitable rooms (rest = walls + the hub's circulation
  // role); +4 % headroom, and never more than ~53 % of the plot
  const budget = Math.min((busiestSqm / 0.76) * (large ? 1.18 : 1.04), plotArea * (large ? 0.56 : 0.53))
  // keep the house close to what the programme needs — a bigger plot buys a
  // garden, not a runaway living room. Aspect follows the plot, capped ~2:1.
  const plotAsp = clamp(envW / envH, 0.5, 2.1)
  let houseW = snap(clamp(Math.sqrt(budget * plotAsp), large ? 11000 : 8000, envW), grid)
  let houseH = snap(clamp(budget / houseW, large ? 9000 : 6800, Math.min(envH, houseW * (large ? 1.4 : 1.3))), grid)
  // --- the buildable ground rectangle a shape carves its blocks from ---
  const env: Rect = {
    x: snap(envelope.x + (envelope.w - houseW) / 2, grid),
    y: envelope.y,
    w: houseW,
    h: houseH,
  }
  // the core column doubles as the ground-floor service run, so it must hold a
  // kitchen (~2.9 m) as well as the stair
  const coreW = snap(clamp(model.brief.levels.stairWidth * 2 + 600, 2600, 3000), grid)
  const coreH = STAIR_LEN + 800

  const programSqm = Math.max(
    ...model.floors.map((fp) => fp.spaces.filter((s) => !s.outdoor).reduce((a, s) => a + s.target, 0)),
  )
  const briefKey = model.seed.split('-')[0]
  const rng = makeRng(seed, briefKey)

  const shapeCtx: ShapeCtx = {
    env,
    houseW,
    houseH,
    coreW,
    coreH,
    entryEdge: model.entrySide,
    grid,
    storeys: model.brief.levels.storeys,
    programSqm,
  }
  const footprint = pickShape(shapeCtx, { want, seed }, rng)

  // the covered porch may run out into the entry-side setback, up to the plot line
  const frontLimitY = model.plot.depth - 200
  const ctx: Ctx = { footprint, envelope, grid, twoCar, large, frontLimitY }
  const roofBias = themeOf(model.brief).roofBias
  const floors = model.floors.map((fp) =>
    buildFloor(fp, model, ctx, roofBias, makeRng(seed, `${briefKey}|${fp.level}`)),
  )

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
    id: `${model.seed}-${footprint.shape}-${seed}`,
    seed: model.seed,
    algorithm: 'real-topology-v1',
    candidate: footprint.shape,
    shape: footprint.shape,
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
  footprint: Footprint
  envelope: Rect
  grid: number
  twoCar: boolean
  large: boolean
  frontLimitY: number
}

/** the top-storey roof for a style's bias; lower storeys are always flat */
function roofFor(bias: 'flat' | 'pitched' | 'mixed', top: boolean, rng: Rng): RoofSpec {
  if (!top) return { kind: 'flat' }
  const pitchChance = bias === 'pitched' ? 1 : bias === 'mixed' ? 0.5 : 0
  return pitchChance > 0 && rng.chance(pitchChance)
    ? { kind: rng.pick(['hip', 'gable', 'mono-slope'] as const), pitchDeg: rng.int(16, 28) }
    : { kind: rng.chance(0.5) ? 'flat-parapet' : 'flat' }
}

function buildFloor(
  fp: FloorProgram,
  model: CanonicalModel,
  ctx: Ctx,
  roofBias: 'flat' | 'pitched' | 'mixed',
  rng: Rng,
): FloorPlan {
  const { footprint, envelope, grid, twoCar, frontLimitY } = ctx
  const court = fp.level === 0 ? footprint.courtyard : null
  const outdoor = fp.spaces.filter((s) => s.outdoor)

  // ---- rooms around the circulation hub, per the ResPlan grammar ----
  const laid = layoutFloor(fp, footprint, model, { grid, large: ctx.large }, rng)
  const rooms = laid.rooms

  sealGaps(rooms, grid)
  repairNarrow(rooms, grid)
  absorbSlivers(rooms)
  sealGaps(rooms, grid)
  repairWindows(rooms, footprint.blocks)

  // "adjust the exterior to the structure" — once the repairs have settled the
  // rooms, redraw a small single-block shell to hug them so the outer wall sits
  // on the partitions, not a grid line the layout drifted off of.
  const blocks = fitShellToRooms(rooms, footprint.blocks, grid)
  const houseRect = rectUnionBBox(blocks)

  // ---- outdoor ----
  if (fp.level === 0 && outdoor.length > 0) {
    layoutFrontYard(outdoor, rooms, { houseRect, envelope, grid, twoCar, large: ctx.large, frontLimitY })
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

  // the footprint defines the outline (a rect union), not where rooms landed
  const outline = houseRect
  const walls = deriveWalls(rooms, blocks, court)
  const openings: Opening[] = []
  deriveDoors(rooms, model.relationships, openings)
  // the ResPlan invariant: every habitable room gets a door onto the hub
  linkToHub(rooms, laid.hubId, openings)
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
  const { reachable, unreachableRooms } = repairReachability(rooms, openings, fp.level)
  // one circulation door per room — drop the extra a relationship + hub link (and
  // any reachability repair) left on a second wall, but only where the plan stays
  // connected without it
  pruneDoors(rooms, laid.hubId, openings, fp.level)
  // one window per daylight room, centred on its exterior wall and clear of the
  // doors already placed — width by room type, per scripts/opening_stats.json.
  deriveWindows(rooms, walls, openings, themeOf(model.brief).windows)
  const stair = laid.stairRect
    ? makeStair(
        {
          x: laid.stairRect.x + INT_WALL,
          y: laid.stairRect.y + INT_WALL,
          w: laid.stairRect.w - 2 * INT_WALL,
          h: STAIR_LEN,
        },
        model.brief.levels.floorToFloor,
      )
    : undefined

  return {
    level: fp.level,
    name: fp.name,
    outline,
    footprint: blocks,
    roof: roofFor(roofBias, fp.level === model.floors.length - 1, rng),
    courtyard: court,
    rooms,
    walls,
    openings,
    stair,
    reachable,
    unreachableRooms,
  }
}

/** a door onto the hub for every habitable room sharing a wall with it */
function linkToHub(rooms: PlacedRoom[], hubId: string | null, out: Opening[]) {
  if (!hubId) return
  const hub = rooms.find((r) => r.id === hubId)
  if (!hub) return
  for (const r of rooms) {
    if (r.id === hubId || r.outdoor) continue
    if (/^bath\d+$/.test(r.id)) continue // an ensuite doors to its bedroom
    const e = sharedEdge(hub.rect, r.rect)
    // the stair→hub link is the ResPlan invariant (step off the flight straight
    // into the lounge) — take it on any wall wide enough for a leaf, so
    // repairReachability never wedges the stair in through a bedroom
    const minEdge = r.id === 'stair' ? DOOR_LEAF : DOOR_LEAF + 120
    if (!e || e.length < minEdge) continue
    // the stair opens to the hub as a wide leaf-less cased opening — it reads as
    // part of the living room / lounge, not a separate stair hall
    const width = r.id === 'stair' ? Math.max(DOOR_LEAF, Math.min(DOOR_CASED, e.length - 120)) : undefined
    const d = doorOnEdge(e, { width, swing: swingInto(e, hub, r) })
    if (out.some((o) => near(o.at, d.at, 500))) continue
    out.push(d)
  }
}

/** does opening `o` sit on the shared wall `e` between two rooms */
function openingOnEdge(o: Opening, e: NonNullable<ReturnType<typeof sharedEdge>>): boolean {
  const horiz = e.side === 'N' || e.side === 'S'
  const fixed = horiz ? e.seg.a.y : e.seg.a.x
  const lo = horiz ? Math.min(e.seg.a.x, e.seg.b.x) : Math.min(e.seg.a.y, e.seg.b.y)
  const hi = horiz ? Math.max(e.seg.a.x, e.seg.b.x) : Math.max(e.seg.a.y, e.seg.b.y)
  const perp = horiz ? o.at.y : o.at.x
  const along = horiz ? o.at.x : o.at.y
  return Math.abs(perp - fixed) <= 160 && along >= lo - 120 && along <= hi + 120
}

/**
 * One way in. `deriveDoors` (relationship pairs), `linkToHub` (a hub door for
 * every room) and `repairReachability` (gap-filling) can each land a door for the
 * same room on a *different* wall — so a bedroom ends up with a door to the hall
 * AND a door to the living room. The ResPlan grammar is a single circulation door
 * per room.
 *
 * For every private / service / work / sacred room we keep exactly ONE
 * circulation door (onto the hub, else a circulation room, else the widest) plus
 * any door to a genuine dead-end sub-room (an ensuite bath, a utility off the
 * kitchen). A redundant door is only actually removed when the plan stays fully
 * connected without it — a door that is some room's sole route stays. The open
 * social core (living / dining / lounge) and circulation rooms are exempt. Runs
 * after `repairReachability` so it cleans up its additions too.
 */
function pruneDoors(rooms: PlacedRoom[], hubId: string | null, out: Opening[], level: number) {
  const enc = rooms.filter((r) => !r.outdoor)
  const parentOf = (id: string) => (/^bath\d+$/.test(id) ? `bed${id.slice(4)}` : null)
  const exempt = (r: PlacedRoom) => r.zone === 'circulation' || r.zone === 'social' || r.id === hubId

  type Link = { o: Opening; a: PlacedRoom; b: PlacedRoom; len: number }
  const links: Link[] = []
  for (const o of out) {
    if (o.kind !== 'door') continue
    let hit: Link | null = null
    for (let i = 0; i < enc.length && !hit; i++) {
      for (let j = i + 1; j < enc.length; j++) {
        const e = sharedEdge(enc[i].rect, enc[j].rect)
        if (e && openingOnEdge(o, e)) {
          hit = { o, a: enc[i], b: enc[j], len: e.length }
          break
        }
      }
    }
    if (hit) links.push(hit)
  }

  // live adjacency — dropping a door mutates this, and we only commit a drop
  // that leaves every room still reachable from the entry root
  const adj = new Map<string, Set<string>>()
  for (const r of enc) adj.set(r.id, new Set())
  for (const l of links) {
    adj.get(l.a.id)?.add(l.b.id)
    adj.get(l.b.id)?.add(l.a.id)
  }
  const root =
    enc.find((r) => (level === 0 ? r.id === 'foyer' : r.id.startsWith('lobby'))) ??
    enc.find((r) => r.id === hubId) ??
    enc.find((r) => r.id === 'stair') ??
    enc[0]
  if (!root) return
  const allReachable = () => bfs(root.id, adj).size === enc.length

  const rank = (o: PlacedRoom) =>
    o.id === hubId ? 4 : o.zone === 'circulation' ? 3 : o.zone === 'social' ? 2 : 1
  const dropped = new Set<Opening>()
  for (const r of enc) {
    if (exempt(r)) continue
    const mine = links.filter((l) => (l.a === r || l.b === r) && !dropped.has(l.o))
    if (mine.length <= 1) continue
    const other = (l: Link) => (l.a === r ? l.b : l.a)
    // a door to a dead-end sub-room (an ensuite / a wet room reachable only
    // through me) is never a candidate
    const isDependent = (l: Link) => {
      const o = other(l)
      if (parentOf(o.id) === r.id || parentOf(r.id) === o.id) return true
      return (
        (adj.get(o.id)?.size ?? 0) === 1 && o.zone !== 'circulation' && o.zone !== 'social'
      )
    }
    // one circulation door stays; try to shed the rest, weakest first, keeping a
    // drop only when the plan is still fully connected without it
    const cands = mine
      .filter((l) => !isDependent(l))
      .sort((p, q) => rank(other(p)) - rank(other(q)) || p.len - q.len)
    let live = cands.length
    for (const l of cands) {
      if (live <= 1) break
      adj.get(l.a.id)?.delete(l.b.id)
      adj.get(l.b.id)?.delete(l.a.id)
      if (allReachable()) {
        dropped.add(l.o)
        live--
      } else {
        adj.get(l.a.id)?.add(l.b.id)
        adj.get(l.b.id)?.add(l.a.id)
      }
    }
  }
  if (dropped.size) for (let i = out.length - 1; i >= 0; i--) if (dropped.has(out[i])) out.splice(i, 1)
}

/* ---------------------------------- layout --------------------------------- */

function layoutFrontYard(
  outdoor: SpaceReq[],
  rooms: PlacedRoom[],
  o: {
    houseRect: Rect
    envelope: Rect
    grid: number
    twoCar: boolean
    large: boolean
    frontLimitY: number
  },
) {
  const { houseRect, envelope, grid, twoCar, large, frontLimitY } = o
  const frontY = rectBottom(houseRect) + 200
  // the porch may spill past the buildable envelope into the entry setback
  const availH = Math.max(rectBottom(envelope), frontLimitY) - frontY - 100
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
 * Widen any habitable room the layout left below the concept minimum width by
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
 * Independent grid-snapping of treemap cells leaves hairline gaps OR small
 * overlaps (≤ a module or three) between neighbouring rooms — enough to break
 * `sharedEdge`, so a door or reachability link can't be found. Align them: pull
 * each room's right / bottom edge to the near edge of the closest room across it
 * (whether that is a small gap to close or a small overlap to trim).
 */
function sealGaps(rooms: PlacedRoom[], grid: number) {
  const enc = rooms.filter((r) => !r.outdoor)
  for (const r of enc) {
    for (const axis of ['x', 'y'] as const) {
      const far = axis === 'x' ? rectRight(r.rect) : rectBottom(r.rect)
      let snapTo: number | null = null
      let bestAbs = Infinity
      for (const o of enc) {
        if (o === r) continue
        const oNear = axis === 'x' ? o.rect.x : o.rect.y
        const overlap =
          axis === 'x'
            ? Math.min(rectBottom(r.rect), rectBottom(o.rect)) - Math.max(r.rect.y, o.rect.y)
            : Math.min(rectRight(r.rect), rectRight(o.rect)) - Math.max(r.rect.x, o.rect.x)
        if (overlap < 600) continue
        const gap = oNear - far // >0 gap, <0 overlap
        const near = axis === 'x' ? r.rect.x : r.rect.y
        // don't collapse r past a sane minimum
        if (oNear - near < 1800) continue
        if (Math.abs(gap) <= grid * 3 && Math.abs(gap) > 2 && Math.abs(gap) < bestAbs) {
          bestAbs = Math.abs(gap)
          snapTo = oNear
        }
      }
      if (snapTo === null) continue
      r.rect =
        axis === 'x' ? { ...r.rect, w: snapTo - r.rect.x } : { ...r.rect, h: snapTo - r.rect.y }
      r.area = toSqm(rectArea(r.rect))
    }
  }
}

/**
 * On a large, sparse floor the treemap can leave one small room as a hairline
 * strip (full-width, ~0.5 m deep) — unreachable and below every minimum. Merge
 * any such sliver into the neighbour it shares the longest edge with, then drop
 * it, so the plan stays clean. Only true slivers go (min dim < 1.3 m OR area
 * < 3.5 m²); everything else is left for `repairNarrow`.
 */
function absorbSlivers(rooms: PlacedRoom[]) {
  for (let pass = 0; pass < 2; pass++) {
    const enc = rooms.filter((r) => !r.outdoor)
    const sliver = enc.find(
      (r) =>
        r.zone !== 'circulation' &&
        (Math.min(r.rect.w, r.rect.h) < 1300 || toSqm(rectArea(r.rect)) < 3.5),
    )
    if (!sliver) return
    let host: PlacedRoom | null = null
    let bestLen = 0
    for (const o of enc) {
      if (o === sliver) continue
      const e = sharedEdge(sliver.rect, o.rect)
      if (e && e.length > bestLen) {
        bestLen = e.length
        host = o
      }
    }
    const i = rooms.indexOf(sliver)
    if (host && bestLen > 300) {
      // `e.side` is the side of the sliver that meets the host; grow the host
      // across it to swallow the sliver, keeping the host's other three bounds
      const e = sharedEdge(sliver.rect, host.rect)!
      const h = host.rect
      const s = sliver.rect
      const grown =
        e.side === 'N'
          ? { ...h, h: rectBottom(s) - h.y } // sliver below → host grows down
          : e.side === 'S'
            ? { ...h, y: s.y, h: rectBottom(h) - s.y } // sliver above → host grows up
            : e.side === 'E'
              ? { ...h, x: s.x, w: rectRight(h) - s.x } // sliver left → host grows left
              : { ...h, w: rectRight(s) - h.x } // sliver right → host grows right
      // only take the merge if the grown host stays clear of every other room
      const clashes = enc.some(
        (o) =>
          o !== host &&
          o !== sliver &&
          Math.min(rectRight(grown), rectRight(o.rect)) - Math.max(grown.x, o.rect.x) > 300 &&
          Math.min(rectBottom(grown), rectBottom(o.rect)) - Math.max(grown.y, o.rect.y) > 300,
      )
      if (!clashes) {
        host.rect = grown
        host.area = toSqm(rectArea(grown))
      }
    }
    // whether or not it merged, the sliver room goes
    rooms.splice(i, 1)
  }
}

/** swap any daylight-hungry room that ended up landlocked with a perimeter
 *  service room — but only when the swap-in footprint is one the habitable room
 *  can actually live in (min dimension + not a big area cut). "Perimeter" is
 *  tested against the real footprint edges, not the bounding box, so a room on
 *  the inner corner of an L / U plan counts as landlocked. */
function repairWindows(rooms: PlacedRoom[], blocks: Rect[]) {
  const edges = rectUnionEdges(blocks)
  const onPerimeter = (r: PlacedRoom) => {
    for (const e of edges) {
      const horiz = Math.abs(e.a.y - e.b.y) < 2
      const elo = horiz ? Math.min(e.a.x, e.b.x) : Math.min(e.a.y, e.b.y)
      const ehi = horiz ? Math.max(e.a.x, e.b.x) : Math.max(e.a.y, e.b.y)
      if (horiz) {
        if (Math.abs(r.rect.y - e.a.y) > 3 && Math.abs(rectBottom(r.rect) - e.a.y) > 3) continue
        if (Math.min(rectRight(r.rect), ehi) - Math.max(r.rect.x, elo) > 1200) return true
      } else {
        if (Math.abs(r.rect.x - e.a.x) > 3 && Math.abs(rectRight(r.rect) - e.a.x) > 3) continue
        if (Math.min(rectBottom(r.rect), ehi) - Math.max(r.rect.y, elo) > 1200) return true
      }
    }
    return false
  }

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

/**
 * "Adjust the exterior to the structure." A rectangle / square footprint is only
 * right if its outer wall sits on the rooms. After the repair passes have nudged
 * the rooms around — more so on a tight plot — the sized block can stand a module
 * or two proud of them on one side, leaving a dead gap between a partition and
 * the facade. Redraw the block as the tight bounding box of the enclosed rooms
 * (never larger than the block it was sized to, so it stays inside the setbacks),
 * and pull any room that pokes out, or falls short, back onto that edge. Returns
 * a fresh array — the caller's `footprint.blocks` is shared across floors.
 */
function fitShellToRooms(rooms: PlacedRoom[], blocks: Rect[], grid: number): Rect[] {
  if (blocks.length !== 1) return blocks.map((b) => ({ ...b }))
  const src = blocks[0]
  const enc = rooms.filter((r) => !r.outdoor)
  if (enc.length < 2) return [{ ...src }]

  const bx0 = Math.min(...enc.map((r) => r.rect.x))
  const by0 = Math.min(...enc.map((r) => r.rect.y))
  const bx1 = Math.max(...enc.map((r) => rectRight(r.rect)))
  const by1 = Math.max(...enc.map((r) => rectBottom(r.rect)))

  // shrink only — clamp every fitted edge inside the block the shape sized
  const fit: Rect = {
    x: snap(clamp(bx0, src.x, rectRight(src)), grid),
    y: snap(clamp(by0, src.y, rectBottom(src)), grid),
    w: 0,
    h: 0,
  }
  fit.w = Math.max(grid, snap(clamp(bx1, src.x, rectRight(src)), grid) - fit.x)
  fit.h = Math.max(grid, snap(clamp(by1, src.y, rectBottom(src)), grid) - fit.y)
  const fitR = rectRight(fit)
  const fitB = rectBottom(fit)
  // no meaningful drift → leave the sized block alone
  if (Math.abs(fit.x - src.x) < grid && Math.abs(fit.y - src.y) < grid && Math.abs(fitR - rectRight(src)) < grid && Math.abs(fitB - rectBottom(src)) < grid) {
    return [{ ...src }]
  }

  // a room within half a metre of a pre-fit extreme is a perimeter room — grow
  // or trim it so its outer edge lands exactly on the fitted shell
  const NEAR = 500
  for (const r of enc) {
    let { x, y, w, h } = r.rect
    if (x - bx0 <= NEAR || x < fit.x) {
      w += x - fit.x
      x = fit.x
    }
    if (y - by0 <= NEAR || y < fit.y) {
      h += y - fit.y
      y = fit.y
    }
    if (bx1 - rectRight(r.rect) <= NEAR || rectRight(r.rect) > fitR) w = fitR - x
    if (by1 - rectBottom(r.rect) <= NEAR || rectBottom(r.rect) > fitB) h = fitB - y
    r.rect = { x, y, w: Math.max(grid, w), h: Math.max(grid, h) }
    r.area = toSqm(rectArea(r.rect))
  }
  return [fit]
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

const WIN_W_BY_KIND: Record<string, number> = {
  living: 1800,
  dining: 1500,
  kitchen: 1200,
  bed: 1350,
  study: 1200,
  bath: 700,
}

const isWet = (r: PlacedRoom) => /bath|toilet|\bwc\b|powder/i.test(`${r.id} ${r.name}`)

function winKind(r: PlacedRoom): keyof typeof WIN_W_BY_KIND {
  if (isWet(r)) return 'bath'
  if (r.id === 'living' || r.id.startsWith('familyLounge') || r.id.startsWith('hall')) return 'living'
  if (r.id === 'dining') return 'dining'
  if (r.id === 'kitchen') return 'kitchen'
  if (r.id === 'study') return 'study'
  return 'bed'
}

/**
 * Exactly one window per daylight room, centred on the room's longest exterior
 * wall. Width is a clean value per room type (living / dining a touch wider) and
 * never a slit; if a door already sits at the centre the window slides to the
 * larger free side, dropping one size only if it has to. A wet room gets a small
 * high window. `walls` carries the real exterior run so an L / U wall resolves.
 */
function deriveWindows(rooms: PlacedRoom[], walls: Wall[], out: Opening[], spec: WindowSpec) {
  const ext = walls.filter((w) => w.kind === 'exterior')
  const CORNER = 500 // minimum pier from either end of the wall run

  /** the exterior wall run coincident with room side `s`, as [lo, hi] along it, or null */
  const run = (rc: Rect, s: Side4): [number, number] | null => {
    const horiz = s === 'N' || s === 'S'
    const line = s === 'N' ? rc.y : s === 'S' ? rectBottom(rc) : s === 'W' ? rc.x : rectRight(rc)
    const rlo = horiz ? rc.x : rc.y
    const rhi = horiz ? rectRight(rc) : rectBottom(rc)
    let lo = Infinity
    let hi = -Infinity
    for (const w of ext) {
      const wHoriz = Math.abs(w.a.y - w.b.y) < 2
      if (wHoriz !== horiz) continue
      if (Math.abs((wHoriz ? w.a.y : w.a.x) - line) > 3) continue
      const wLo = wHoriz ? Math.min(w.a.x, w.b.x) : Math.min(w.a.y, w.b.y)
      const wHi = wHoriz ? Math.max(w.a.x, w.b.x) : Math.max(w.a.y, w.b.y)
      const s0 = Math.max(rlo, wLo)
      const s1 = Math.min(rhi, wHi)
      if (s1 - s0 > 900) {
        lo = Math.min(lo, s0)
        hi = Math.max(hi, s1)
      }
    }
    return hi > lo ? [lo, hi] : null
  }

  for (const r of rooms) {
    if (r.outdoor) continue
    const wet = isWet(r)
    if (!r.wantsWindow && !wet) continue
    if (r.area < 5 && !wet) continue

    const cands = SIDE4
      .map((s) => ({ s, run: run(r.rect, s) }))
      .filter((c): c is { s: Side4; run: [number, number] } => c.run !== null)
    if (!cands.length) continue
    cands.sort((a, b) => b.run[1] - b.run[0] - (a.run[1] - a.run[0]))
    const { s: side, run: rr } = cands[0]
    const horiz = side === 'N' || side === 'S'
    const fixed = side === 'N' ? r.rect.y : side === 'S' ? rectBottom(r.rect) : side === 'W' ? r.rect.x : rectRight(r.rect)
    const runLen = rr[1] - rr[0]
    const mid = (rr[0] + rr[1]) / 2

    const kind = winKind(r)
    const target = kind === 'living' ? clamp(spec.widthMm || 1800, 1800, 2200) : WIN_W_BY_KIND[kind]
    const least = wet ? 550 : 800
    const maxFit = runLen - 2 * CORNER
    if (maxFit < least) continue

    // a door already on this wall line keeps a 250 mm reveal each side
    const blocked = out
      .filter((o) => o.kind !== 'window' && Math.abs((horiz ? o.at.y : o.at.x) - fixed) < 320)
      .map((o) => {
        const c = horiz ? o.at.x : o.at.y
        return [c - o.width / 2 - 250, c + o.width / 2 + 250] as [number, number]
      })
    const clearAt = (a: number, w: number) =>
      a - w / 2 >= rr[0] + CORNER - 1 &&
      a + w / 2 <= rr[1] - CORNER + 1 &&
      !blocked.some(([b0, b1]) => a - w / 2 < b1 && a + w / 2 > b0)

    let width = Math.min(target, maxFit)
    let at = Math.round(mid)
    if (!clearAt(at, width)) {
      let done = false
      for (const w of [width, Math.max(least, width * 0.7)]) {
        for (let d = 200; d <= runLen && !done; d += 200) {
          for (const cand of [mid + d, mid - d]) {
            const a = Math.round(clamp(cand, rr[0] + CORNER + w / 2, rr[1] - CORNER - w / 2))
            if (clearAt(a, w)) {
              at = a
              width = w
              done = true
              break
            }
          }
        }
        if (done) break
      }
      if (!done) continue
    }

    out.push({
      kind: 'window',
      at: horiz ? { x: at, y: fixed } : { x: fixed, y: at },
      orient: horiz ? 'h' : 'v',
      width: Math.round(width),
    })
  }
}

/** the coordinate a door on `edge` should hinge toward — the circulation core */
function coreHint(rooms: PlacedRoom[]): Point {
  const core =
    rooms.find((r) => r.id === 'stair') ??
    rooms.find((r) => r.id === 'foyer' || r.id.startsWith('lobby'))
  return core ? rectCenter(core.rect) : rectCenter(enclosedOutline(rooms.filter((r) => !r.outdoor)))
}

/** which way a door between `a` and `b` should swing on `edge` — into the more private room */
function swingInto(edge: { seg: Segment; side: Side4 }, a: PlacedRoom, b: PlacedRoom): 1 | -1 {
  const horiz = edge.side === 'N' || edge.side === 'S'
  const into = (ZONE_PRIVACY[b.zone] ?? 0) >= (ZONE_PRIVACY[a.zone] ?? 0) ? b : a
  const c = rectCenter(into.rect)
  const line = horiz ? edge.seg.a.y : edge.seg.a.x
  return (horiz ? c.y : c.x) >= line ? 1 : -1
}

function deriveDoors(rooms: PlacedRoom[], rels: Relationship[], out: Opening[]) {
  const byId = new Map(rooms.map((r) => [r.id, r]))
  const hint = coreHint(rooms)
  for (const rel of rels) {
    if (rel.kind === 'separated') continue
    const a = byId.get(rel.a)
    const b = byId.get(rel.b)
    if (!a || !b) continue
    const e = sharedEdge(a.rect, b.rect)
    if (!e || e.length < DOOR_LEAF + 220) continue
    const horiz = e.side === 'N' || e.side === 'S'
    const cased = a.zone === 'social' && b.zone === 'social' && e.length >= 2600
    const d = doorOnEdge(e, {
      toward: horiz ? hint.x : hint.y,
      width: cased ? DOOR_CASED : DOOR_LEAF,
      swing: swingInto(e, a, b),
      cased,
    })
    if (out.some((o) => near(o.at, d.at, 320))) continue
    out.push(d)
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

  // two rooms are linked only by a door that actually sits ON their shared wall
  // — not merely near its midpoint (a nearby door to a *third* room used to
  // create a phantom link and leave the room genuinely doorless).
  const doorOnSharedWall = (o: Opening, e: NonNullable<ReturnType<typeof sharedEdge>>) => {
    const horiz = e.side === 'N' || e.side === 'S'
    const fixed = horiz ? e.seg.a.y : e.seg.a.x
    const lo = horiz ? Math.min(e.seg.a.x, e.seg.b.x) : Math.min(e.seg.a.y, e.seg.b.y)
    const hi = horiz ? Math.max(e.seg.a.x, e.seg.b.x) : Math.max(e.seg.a.y, e.seg.b.y)
    const perp = horiz ? o.at.y : o.at.x
    const along = horiz ? o.at.x : o.at.y
    return Math.abs(perp - fixed) <= 160 && along >= lo - 120 && along <= hi + 120
  }

  for (let i = 0; i < enc.length; i++) {
    for (let j = i + 1; j < enc.length; j++) {
      const e = sharedEdge(enc[i].rect, enc[j].rect)
      if (!e) continue
      if (openings.some((o) => (o.kind === 'door' || o.kind === 'entry') && doorOnSharedWall(o, e))) {
        linkPair(enc[i].id, enc[j].id)
      }
    }
  }

  const start =
    enc.find((r) => (level === 0 ? r.id === 'foyer' : r.id.startsWith('lobby'))) ??
    enc.find((r) => r.id === 'stair') ??
    enc[0]
  if (!start) return { reachable: false, unreachableRooms: enc.map((r) => r.id) }

  const hint = coreHint(rooms)
  const seen = bfs(start.id, adj)
  // an attached bath (`bath2`) belongs to its bedroom (`bed2`)
  const parentOf = (id: string) => (/^bath\d+$/.test(id) ? `bed${id.slice(4)}` : null)
  // how good a host `other` is for a repair door into `r`. An ensuite bath opens
  // ONLY off its own bedroom; a bedroom is never entered through its ensuite or
  // through another bedroom; circulation > social > a study, in a pinch.
  const hostScore = (r: PlacedRoom, other: PlacedRoom, len: number) => {
    const rParent = parentOf(r.id)
    const oParent = parentOf(other.id)
    if (rParent && rParent !== other.id) return -1e9
    if (oParent && oParent !== r.id) return -1e9
    let s = len
    if (rParent === other.id) s += 500000
    else if (other.zone === 'circulation') s += 250000
    else if (other.zone === 'social') s += 120000
    else if (other.zone === 'work') s += 40000
    if (other.zone === 'service') s -= 200000
    if (r.zone === 'private' && other.zone === 'private') s -= 200000
    if (len < 1300) s -= 180000
    return s
  }
  // grow outward through circulation first, ensuite baths last, so a bedroom is
  // connected before the bath that hangs off it
  const REPAIR_ORDER: Record<string, number> = {
    circulation: 0, social: 1, sacred: 2, work: 3, private: 4, service: 5, outdoor: 6,
  }
  let changed = true
  while (changed) {
    changed = false
    const queue = enc
      .filter((r) => !seen.has(r.id))
      .sort((a, b) => (REPAIR_ORDER[a.zone] ?? 9) - (REPAIR_ORDER[b.zone] ?? 9))
    for (const r of queue) {
      if (seen.has(r.id)) continue
      let best: { other: PlacedRoom; score: number; edge: ReturnType<typeof sharedEdge> } | null = null
      let widest: { other: PlacedRoom; len: number; edge: ReturnType<typeof sharedEdge> } | null = null
      for (const other of enc) {
        if (!seen.has(other.id)) continue
        const e = sharedEdge(r.rect, other.rect)
        if (!e || e.length < DOOR) continue
        const score = hostScore(r, other, e.length)
        if (score > -1e8 && (!best || score > best.score)) best = { other, score, edge: e }
        if (score > -1e8 && (!widest || e.length > widest.len)) widest = { other, len: e.length, edge: e }
      }
      // a clean 3 m opening reads better than a door squeezed into a < 1.4 m wall
      if (best && widest && best.edge && best.edge.length < 1400 && widest.len >= 2200) {
        best = { other: widest.other, score: 0, edge: widest.edge }
      }
      if (best && best.edge) {
        const horiz = best.edge.side === 'N' || best.edge.side === 'S'
        openings.push(
          doorOnEdge(best.edge, { toward: horiz ? hint.x : hint.y, swing: swingInto(best.edge, r, best.other) }),
        )
        linkPair(r.id, best.other.id)
        for (const id of bfs(r.id, adj)) seen.add(id)
        changed = true
      }
    }
  }

  // last resort: a room (or cluster) separated from the reachable set by a small
  // gap — bridge it by stretching the room across the gap, then door it. Handles
  // a hole left by an absorbed sliver, or a wing that never quite met the core.
  let bridged = true
  while (bridged) {
    bridged = false
    for (const r of enc) {
      if (seen.has(r.id)) continue
      let pick: { other: PlacedRoom; gap: number; axis: 'x' | 'y'; dir: 1 | -1 } | null = null
      for (const o of enc) {
        if (!seen.has(o.id)) continue
        // horizontal gap (r left/right of o) with vertical overlap
        const vOv = Math.min(rectBottom(r.rect), rectBottom(o.rect)) - Math.max(r.rect.y, o.rect.y)
        const hOv = Math.min(rectRight(r.rect), rectRight(o.rect)) - Math.max(r.rect.x, o.rect.x)
        const cand: { other: PlacedRoom; gap: number; axis: 'x' | 'y'; dir: 1 | -1 }[] = []
        if (vOv > 900) {
          if (o.rect.x - rectRight(r.rect) > 0) cand.push({ other: o, gap: o.rect.x - rectRight(r.rect), axis: 'x', dir: 1 })
          if (r.rect.x - rectRight(o.rect) > 0) cand.push({ other: o, gap: r.rect.x - rectRight(o.rect), axis: 'x', dir: -1 })
        }
        if (hOv > 900) {
          if (o.rect.y - rectBottom(r.rect) > 0) cand.push({ other: o, gap: o.rect.y - rectBottom(r.rect), axis: 'y', dir: 1 })
          if (r.rect.y - rectBottom(o.rect) > 0) cand.push({ other: o, gap: r.rect.y - rectBottom(o.rect), axis: 'y', dir: -1 })
        }
        for (const c of cand) if (c.gap > 2 && c.gap < 2600 && (!pick || c.gap < pick.gap)) pick = c
      }
      if (!pick) continue
      const { axis, dir, gap, other } = pick
      if (axis === 'x') {
        r.rect = dir === 1 ? { ...r.rect, w: r.rect.w + gap } : { ...r.rect, x: r.rect.x - gap, w: r.rect.w + gap }
      } else {
        r.rect = dir === 1 ? { ...r.rect, h: r.rect.h + gap } : { ...r.rect, y: r.rect.y - gap, h: r.rect.h + gap }
      }
      r.area = toSqm(rectArea(r.rect))
      const e = sharedEdge(r.rect, other.rect)
      if (e) {
        const horiz = e.side === 'N' || e.side === 'S'
        openings.push(doorOnEdge(e, { toward: horiz ? hint.x : hint.y, swing: swingInto(e, r, other) }))
        linkPair(r.id, other.id)
        for (const id of bfs(r.id, adj)) seen.add(id)
        bridged = true
      }
    }
  }

  // absolute last resort: a room still cut off (its edges misaligned by
  // rounding, or a wing that only overlaps the reachable set). Snap it to the
  // reachable room it overlaps most and door the shared span — the plan is a
  // concept study, a notional door here beats an unreachable room.
  let forced = true
  while (forced) {
    forced = false
    for (const r of enc) {
      if (seen.has(r.id)) continue
      let host: PlacedRoom | null = null
      let bestOv = 0
      for (const o of enc) {
        if (!seen.has(o.id) || o === r) continue
        const ox = Math.min(rectRight(r.rect), rectRight(o.rect)) - Math.max(r.rect.x, o.rect.x)
        const oy = Math.min(rectBottom(r.rect), rectBottom(o.rect)) - Math.max(r.rect.y, o.rect.y)
        // near-adjacent (small gap) or overlapping on one axis, sharing span on the other
        const score = Math.min(ox, 0) + Math.min(oy, 0) + Math.max(ox, oy)
        if (ox > -2600 && oy > -2600 && (ox > 900 || oy > 900) && score > bestOv) {
          bestOv = score
          host = o
        }
      }
      if (!host) continue
      const mid: Point = {
        x: (Math.max(r.rect.x, host.rect.x) + Math.min(rectRight(r.rect), rectRight(host.rect))) / 2,
        y: (Math.max(r.rect.y, host.rect.y) + Math.min(rectBottom(r.rect), rectBottom(host.rect))) / 2,
      }
      const horiz = Math.abs(r.rect.x + r.rect.w / 2 - (host.rect.x + host.rect.w / 2)) <
        Math.abs(r.rect.y + r.rect.h / 2 - (host.rect.y + host.rect.h / 2))
      openings.push({ kind: 'door', at: mid, orient: horiz ? 'v' : 'h', width: DOOR, swing: 1 })
      linkPair(r.id, host.id)
      for (const id of bfs(r.id, adj)) seen.add(id)
      forced = true
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

const near = (a: Point, b: Point, tol: number) => Math.abs(a.x - b.x) <= tol && Math.abs(a.y - b.y) <= tol
