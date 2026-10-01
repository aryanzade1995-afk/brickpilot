import type { Design, FloorPlan, Opening } from '../engine/types.ts'
import type { Rect } from '../geometry.ts'
import { rectUnionEdges } from '../geometry.ts'
import type { CanonicalModel } from '../model/canonical.ts'
import { themeOf, type RailStyle, type ThemeDef } from '../model/themes.ts'
import type { DesignDNA } from '../engine/designDna.ts'
import { planFacade } from '../engine/facade/grammar.ts'
import { terraceLayout, type TerraceLayout } from '../engine/terrace.ts'

/* ------------------------------------------------------------------ *
 *  buildMassing — an architect's white-card study model of the house.
 *
 *  Each storey's four facades are one continuous solid plane, segmented
 *  into pier / spandrel / header pieces around every opening (all the
 *  same `wall` kind, so they merge and never z-fight), with a single
 *  dark pane recessed behind the void. Floor slabs are inset behind the
 *  wall face and below finished-floor, so they only read when exploded.
 *  Roof = a deck flush with top-of-wall + a low mitred kerb parapet.
 *  Plinth meets FFL with no gap. Carport / porch / balcony are single
 *  coherent structures. Everything is a pure function of the Design.
 * ------------------------------------------------------------------ */

export type MassKind =
  | 'plinth'
  | 'slab'
  | 'wall'
  | 'partition'
  | 'glass'
  | 'stair'
  | 'roof'
  | 'prism'
  | 'parapet'
  | 'column'
  | 'canopy'
  | 'railing'
  | 'clad'
  | 'feature'
  | 'shade'
  | 'band'
  | 'screen'
  | 'mumty'
  | 'tank'
  | 'lawn'
  | 'paving'
  | 'planter'
  | 'hedge'
  | 'fence'

/** a sloped roof volume — the box bounds the eaves rectangle, `form` + `ridge`
 *  say how the top is shaped, `low` (mono-slope) which eave sits at the base */
export type RoofPrism = {
  form: 'gable' | 'hip' | 'mono'
  /** ridge runs along this world axis */
  ridge: 'x' | 'z'
  /** mono-slope: the low eave */
  low?: 'x-' | 'x+' | 'z-' | 'z+'
}

export type MassBox = {
  id: string
  kind: MassKind
  /** world-space centre, metres */
  pos: [number, number, number]
  /** full extents, metres */
  size: [number, number, number]
  level: number
  /** only for kind === 'prism' */
  prism?: RoofPrism
}

export type Massing = {
  palette: DesignDNA['materialPalette']
  boxes: MassBox[]
  floors: { level: number; baseY: number }[]
  bounds: { w: number; d: number }
  footprint: { w: number; d: number }
  center: [number, number, number]
  floorHeight: number
  stats: { storeys: number; heightM: number; builtAreaSqm: number; openings: number }
}

/* ---- dimensions, metres --------------------------------------------------- */
const EXT_T = 0.24 // exterior wall thickness
const INT_T = 0.11 // interior partition thickness
const SLAB_T = 0.22 // inset floor plate
const PLINTH_H = 0.4 // base-course height above grade
const ROOF_T = 0.22 // terrace deck
const PARAPET_T = 0.12
const KERB_H = 0.38 // terrace upstand
const RECESS = 0.1 // pane reveal depth behind the outer facade
const PANE_T = 0.06
const PANE_SHRINK = 0.006 // pane a hair smaller than the void — avoids an exact coincident plane
const CANOPY_TOP = 2.75 // carport canopy top, metres above FFL
const COL = 0.3 // square column
const HT_MM = (EXT_T * 1000) / 2 // exterior half-thickness, mm

const BAND: Record<Opening['kind'], { sill: number; head: number }> = {
  window: { sill: 0.85, head: 2.2 },
  door: { sill: 0, head: 2.3 },
  entry: { sill: 0, head: 2.5 },
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

/** deterministic PRNG seeded from the design seed string */
function seededRng(seed: string): () => number {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return () => {
    h = (h + 0x6d2b79f5) | 0
    let t = Math.imul(h ^ (h >>> 15), 1 | h)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

type Vec3 = [number, number, number]
type Push = (id: string, kind: MassKind, level: number, pos: Vec3, size: Vec3, prism?: RoofPrism) => void
type XF = (mm: number) => number
type Side = 'N' | 'S' | 'E' | 'W'
type FaceOp = { at: number; width: number; sill: number; head: number }

/** the real footprint of a storey — a union of axis-aligned blocks (the massing
 *  grammar); falls back to the bounding box for any legacy plan */
const blocksOf = (floor: FloorPlan): Rect[] =>
  floor.footprint && floor.footprint.length ? floor.footprint : [floor.outline]

/** the rect (bbox of the overlapping blocks) standing on `b` from the floor
 *  above — or a degenerate rect clear of `b` on all four sides, so the whole
 *  block reads as a walkable terrace */
function coverAbove(b: Rect, above: FloorPlan | undefined): Rect {
  if (above) {
    const hit = blocksOf(above).filter((u) => {
      const ox = Math.min(b.x + b.w, u.x + u.w) - Math.max(b.x, u.x)
      const oy = Math.min(b.y + b.h, u.y + u.h) - Math.max(b.y, u.y)
      return ox > 800 && oy > 800
    })
    if (hit.length) {
      const x = Math.min(...hit.map((u) => u.x))
      const y = Math.min(...hit.map((u) => u.y))
      return {
        x,
        y,
        w: Math.max(...hit.map((u) => u.x + u.w)) - x,
        h: Math.max(...hit.map((u) => u.y + u.h)) - y,
      }
    }
  }
  return { x: b.x + b.w / 2, y: b.y + b.h / 2, w: 0, h: 0 }
}

export function buildMassing(design: Design): Massing {
  const { model } = design
  const T = themeOf(model.brief)
  const plotW = model.plot.width
  const plotD = model.plot.depth
  const H = model.brief.levels.floorToFloor
  const y0 = PLINTH_H
  const plinthProj = T.massing.plinthProjMm / 1000
  const winBand = { sill: T.windows.sillMm / 1000, head: T.windows.headMm / 1000 }

  const wx: XF = (mm) => (mm - plotW / 2) / 1000
  const wz: XF = (mm) => (mm - plotD / 2) / 1000
  const m: XF = (mm) => mm / 1000

  const boxes: MassBox[] = []
  const push: Push = (id, kind, level, pos, size, prism) => {
    if (size[0] > 0.02 && size[1] > 0.02 && size[2] > 0.02)
      boxes.push({ id, kind, pos, size, level, prism })
  }

  const floors = [...design.floors].sort((a, b) => a.level - b.level)
  const topLevel = floors[floors.length - 1].level
  const g = floors[0].outline

  // ---- plinth: top == finished floor, projects as a base course ----
  for (const [index, block] of blocksOf(floors[0]).entries()) push(
    `plinth-${index}`, 'plinth', 0,
    [wx(block.x + block.w / 2), PLINTH_H / 2, wz(block.y + block.h / 2)],
    [m(block.w) + EXT_T + 2 * plinthProj, PLINTH_H, m(block.h) + EXT_T + 2 * plinthProj],
  )

  for (const floor of floors) {
    const L = floor.level
    const baseY = y0 + L * H
    const wallTop = baseY + H
    const blocks = blocksOf(floor)
    const above = floors.find((f) => f.level === L + 1)

    // ---- classify openings onto facades once for the whole storey ----
    const oFull = floor.outline
    const boundary = rectUnionEdges(blocks, floor.courtyard)
    const face: { side: Side; fixed: number; op: FaceOp }[] = []
    const interiorOps: Opening[] = []
    const TOL = 2
    for (const op of floor.openings) {
      const band = op.kind === 'window' ? winBand : BAND[op.kind]
      const rec = { width: op.width, sill: op.kind === 'window' && op.sill !== undefined ? op.sill / 1000 : band.sill,
        head: op.head !== undefined ? Math.min(op.head / 1000, H - 0.12) : band.head }
      const edge = boundary.find((e) => {
        const horizontal = e.side === 'N' || e.side === 'S'
        if ((op.orient === 'h') !== horizontal) return false
        const fixed = horizontal ? e.a.y : e.a.x
        const along = horizontal ? op.at.x : op.at.y
        const lo = horizontal ? e.a.x : e.a.y
        const hi = horizontal ? e.b.x : e.b.y
        return Math.abs((horizontal ? op.at.y : op.at.x) - fixed) < TOL &&
          along - op.width / 2 >= lo + 110 && along + op.width / 2 <= hi - 110
      })
      if (edge) face.push({ side: edge.side, fixed: edge.side === 'N' || edge.side === 'S' ? edge.a.y : edge.a.x, op: { at: op.orient === 'h' ? op.at.x : op.at.y, ...rec } })
      else interiorOps.push(op)
    }
    const gm = T.windows.groupMm
    const cj = T.massing.chajjaMm

    // Wall faces follow the union perimeter, including courtyard recesses.
    // Drawing every block edge would leave solid walls through joined volumes.
    boundary.forEach((edge, index) => {
      const horizontal = edge.side === 'N' || edge.side === 'S'
      const fixed = horizontal ? edge.a.y : edge.a.x
      const a0 = horizontal ? edge.a.x : edge.a.y
      const a1 = horizontal ? edge.b.x : edge.b.y
      const openings = face.filter((f) => f.side === edge.side && Math.abs(f.fixed - fixed) < TOL && f.op.at >= a0 && f.op.at <= a1).map((f) => f.op)
      addWall(edge.side, a0, a1, fixed, baseY, wallTop, openings, L, gm, cj, design.dna.windowTreatment,
        `w${L}-${index}`, push, wx, wz, m)
    })

    blocks.forEach((o, bi) => {
      const midX = wx(o.x + o.w / 2)
      const midZ = wz(o.y + o.h / 2)
      const bid = `${L}b${bi}`

      // ---- inset floor plate — reads the storey when exploded ----
      push(
        `slab-${bid}`,
        'slab',
        L,
        [midX, baseY - SLAB_T / 2, midZ],
        [Math.max(m(o.w) - 2 * EXT_T, 0.4), SLAB_T, Math.max(m(o.h) - 2 * EXT_T, 0.4)],
      )

      if (T.massing.stringCourseMm > 0 && L >= 1 &&
        ['horizontal-stack', 'layered-facade', 'stepped-composition'].includes(design.dna.facadeComposition)) {
        stringCourse(o, baseY, L, T.massing.stringCourseMm / 1000, push, wx, wz, m)
      }
      // the oversailing upper box is the modern box's signature, whatever its composition
      // only a block whose front edge IS the street face oversails it (a block
      // further back would leave a frame hanging inside the house)
      const onStreet = Math.abs(o.y + o.h - (oFull.y + oFull.h)) < 2
      if (T.modern && L >= 1 && T.modern.cantileverMm > 0 && onStreet &&
        (['floating-box', 'interlocking-volumes', 'split-volume'].includes(design.dna.facadeComposition) ||
          design.dna.styleFamily === 'modern-box')) {
        cantileverApron(o, baseY, bid, L, T.modern.cantileverMm / 1000, push, wx, wz, m)
      }

      // ---- roof: a pitched cap where the storey is the last over this block
      // (top floor, or a lower wing with nothing standing on it); a flat
      // terrace where a floor above steps back off it ----
      // every block after the first tags its roof pieces, or ids repeat per block
      const rpush: Push = bi === 0 ? push : (id, ...rest) => push(`${id}-b${bi}`, ...rest)
      // a block side on the storey's outer perimeter; sides where blocks join
      // get no guard rail, fascia or parapet running across the roof
      const open = Object.fromEntries((['N', 'S', 'W', 'E'] as Side[]).map((side) => {
        const horizontal = side === 'N' || side === 'S'
        const fixed = side === 'N' ? o.y : side === 'S' ? o.y + o.h : side === 'W' ? o.x : o.x + o.w
        const lo = horizontal ? o.x : o.y
        const hi = horizontal ? o.x + o.w : o.y + o.h
        return [side, boundary.some((e) => e.side === side &&
          Math.abs((horizontal ? e.a.y : e.a.x) - fixed) < TOL &&
          Math.min(hi, horizontal ? e.b.x : e.b.y) - Math.max(lo, horizontal ? e.a.x : e.a.y) > 600)]
      })) as Record<Side, boolean>
      const cover = L === topLevel ? null : coverAbove(o, above)
      // coverAbove returns a degenerate rect when nothing stands on this block
      const exposed = L === topLevel || !cover || cover.w < 900 || cover.h < 900
      const rk = floor.roof?.perBlock?.[bi]?.kind ?? floor.roof?.kind ?? 'flat'
      const pitched = rk === 'hip' || rk === 'gable' || rk === 'mono-slope'
      if (exposed && pitched) {
        buildPitchedRoof(
          o,
          wallTop,
          L,
          rk,
          floor.roof?.perBlock?.[bi]?.pitchDeg ?? floor.roof?.pitchDeg ?? T.roof.pitchDeg,
          T,
          design.dna.roofGeometry,
          rpush,
          wx,
          wz,
          m,
        )
      } else if (exposed && L !== topLevel && T.roofBias !== 'flat') {
        // a lower wing of a pitched-roof style still gets a small pitched cap
        buildPitchedRoof(o, wallTop, L, 'hip', T.roof.pitchDeg, T, design.dna.roofGeometry, rpush, wx, wz, m)
      } else if (L === topLevel) {
        buildRoof(o, wallTop, L, T, design.dna.roofGeometry, rpush, wx, wz, m, open)
      } else if (cover) {
        buildTerrace(o, cover, wallTop, L, T, rpush, wx, wz, m)
      }
      if (L === topLevel && exposed)
        buildRoofSignature(o, wallTop, L, bi, pitched, design.dna, push, wx, wz, m,
          !pitched && T.accents.railStyle === 'glass')
    })

    const o = oFull

    // ---- interior partitions — own group, hidden until exploded ----
    for (let i = 0; i < floor.walls.length; i++) {
      const w = floor.walls[i]
      if (w.kind !== 'interior') continue
      segmentPartition(w, interiorOps, baseY, H, L, `p${L}-${i}`, push, wx, wz, m)
    }

    // ---- outdoor rooms ----
    const covers = floor.rooms.filter((r) => r.outdoor && r.id !== 'courtyard' && !r.id.startsWith('balcony'))
    for (const r of floor.rooms) {
      if (r.outdoor && r.id.startsWith('balcony'))
        buildBalcony(
          r.rect,
          baseY,
          L,
          T.massing.balconyDepthMm / 1000,
          design.dna.balconyDesign === 'glass-floating' ? 'glass' :
            design.dna.balconyDesign === 'metal-rail' || design.dna.balconyDesign === 'planter-balcony' ? 'bar' :
              design.dna.balconyDesign === 'timber-screened' ? 'baluster' : T.accents.railStyle,
          design.dna.balconyDesign,
          push,
          wx,
          wz,
          m,
        )
    }
    // one combined canopy over all covered outdoor bays
    if (covers.length > 0) {
      const cov = covers.reduce(
        (acc, r) => ({
          x: Math.min(acc.x, r.rect.x),
          y: Math.min(acc.y, r.rect.y),
          x1: Math.max(acc.x1, r.rect.x + r.rect.w),
          y1: Math.max(acc.y1, r.rect.y + r.rect.h),
        }),
        { x: Infinity, y: Infinity, x1: -Infinity, y1: -Infinity },
      )
      buildCarport(
        { x: cov.x, y: cov.y, w: cov.x1 - cov.x, h: cov.y1 - cov.y },
        g,
        y0,
        L,
        'cover',
        design.dna.roofGeometry,
        push,
        wx,
        wz,
        m,
      )
    }

    // ---- stair — only the flights that actually go up to a floor above ----
    if (floor.stair && L < topLevel) {
      for (const s of buildStair(floor.stair.rect, H, floor.stair.startSide)) {
        push(`stair-${L}-${s.tag}`, 'stair', L, [wx(s.x), baseY + s.y, wz(s.z)], s.size)
      }
    }

    // ---- terrace garden on the flat roof where a lower floor steps out ----
    if (T.landscape.terraceGarden && L < topLevel) {
      const up = floors.find((f) => f.level === L + 1)
      if (up) buildTerraceGarden(o, up.outline, wallTop, L, push, wx, wz, m)
    }
  }

  // ---- roof terrace: stair headroom room, water tank, pergola — laid out by
  //      the engine's terraceLayout(), the same one the 2D terrace sheet draws ----
  const terrace = terraceLayout(design)
  if (terrace) {
    const deckY = y0 + terrace.level * H + H
    roofServices(terrace, terrace.level, deckY, push, wx, wz, m)
    if (terrace.pergola) roofPergola(terrace.pergola, terrace.level, deckY - SLAB_T, push, wx, wz, m)
  }

  buildFacadeGrammar(design, floors, y0, H, push, wx, wz, m)

  if (design.siteFeatures) {
    for (const feature of design.siteFeatures) {
      if (feature.covered) continue
      const r = feature.rect
      const kind: MassKind = feature.kind === 'lawn' ? 'lawn' : feature.kind === 'pool' ? 'glass' : 'paving'
      push(feature.id, kind, 0, [wx(r.x + r.w / 2), feature.kind === 'pool' ? -0.08 : 0.025, wz(r.y + r.h / 2)], [m(r.w), 0.05, m(r.h)])
      if (feature.kind === 'pool') {
        // An actual recessed basin, with four separate coping edges and water below grade.
        push(`${feature.id}_basin`, 'slab', 0, [wx(r.x + r.w / 2), -0.85, wz(r.y + r.h / 2)], [m(r.w), 0.12, m(r.h)])
        for (const edge of [{ x: r.x, y: r.y, w: r.w, h: 120 }, { x: r.x, y: r.y + r.h - 120, w: r.w, h: 120 },
          { x: r.x, y: r.y + 120, w: 120, h: r.h - 240 }, { x: r.x + r.w - 120, y: r.y + 120, w: 120, h: r.h - 240 }])
          push(`${feature.id}_edge_${edge.x}_${edge.y}`, 'paving', 0, [wx(edge.x + edge.w / 2), 0.05, wz(edge.y + edge.h / 2)], [m(edge.w), 0.1, m(edge.h)])
      }
    }
    // Retain the existing boundary-wall treatment, using no independent lawn or driveway.
    if (model.brief.rooms.priorities.compoundWall) buildLandscape({ ...model, brief: { ...model.brief, rooms: { ...model.brief.rooms, priorities: { ...model.brief.rooms.priorities, garden: false } } } }, floors[0], T, push, wx, wz, m)
  } else buildLandscape(model, floors[0], T, push, wx, wz, m)

  const storeys = floors.length
  return {
    palette: design.dna.materialPalette,
    boxes,
    floors: floors.map((f) => ({ level: f.level, baseY: y0 + f.level * H })),
    bounds: { w: plotW / 1000, d: plotD / 1000 },
    /** ground-storey building extent (metres) — for framing the camera */
    footprint: { w: g.w / 1000, d: g.h / 1000 },
    center: [wx(g.x + g.w / 2), y0 + (storeys * H) / 2, wz(g.y + g.h / 2)],
    floorHeight: H,
    stats: {
      storeys,
      heightM: design.heightM,
      builtAreaSqm: design.builtAreaSqm,
      openings: design.openingCounts.doors + design.openingCounts.windows,
    },
  }
}

/** Seeded details attach to plan walls and openings, never inventing a new void. */
function buildFacadeGrammar(
  design: Design, floors: FloorPlan[], y0: number, H: number,
  push: Push, wx: XF, wz: XF, m: XF,
) {
  void floors
  for (const f of planFacade(design).features) {
    const level = Number(f.hostFloorId === 'GF' ? 0 : f.hostFloorId === 'FF' ? 1 : f.hostFloorId === 'SF' ? 2 : 3)
    const outward = f.orient === 'h' ? [0, 1] : [1, 0]
    const x = wx(f.at.x) + outward[0] * (EXT_T / 2 + m(f.depth) / 2)
    const z = wz(f.at.y) + outward[1] * (EXT_T / 2 + m(f.depth) / 2)
    const kind: MassKind = f.type === 'screen-fin' ? 'screen' : f.type === 'horizontal-band' ? 'band' :
      f.type === 'planter-band' ? 'planter' : f.type === 'canopy' ? 'canopy' : 'feature'
    push(f.id, kind, level,
      [x, y0 + level * H + m(f.bottom + f.height / 2), z],
      f.orient === 'h' ? [m(f.width), m(f.height), m(f.depth)] : [m(f.depth), m(f.height), m(f.width)])
  }
}

/* ------------------------------ facade segmentation ------------------------------ */

function addWall(
  side: Side,
  a0: number,
  a1: number,
  fixed: number,
  baseY: number,
  wallTop: number,
  ops: FaceOp[],
  level: number,
  groupMm: number,
  chajjaMm: number,
  windowTreatment: DesignDNA['windowTreatment'],
  tag: string,
  push: Push,
  wx: XF,
  wz: XF,
  m: XF,
) {
  const horizontal = side === 'N' || side === 'S'
  const outward = side === 'S' || side === 'E' ? 1 : -1
  if (a1 - a0 < 120) return

  const solid = (from: number, to: number, yb: number, yt: number, sub: string) => {
    const len = m(to - from)
    const h = yt - yb
    if (len <= 0.04 || h <= 0.04) return
    const mid = (from + to) / 2
    const px = horizontal ? wx(mid) : wx(fixed)
    const pz = horizontal ? wz(fixed) : wz(mid)
    push(
      `${tag}-${sub}`,
      'wall',
      level,
      [px, (yb + yt) / 2, pz],
      horizontal ? [len, h, EXT_T] : [EXT_T, h, len],
    )
  }

  const clean = ops
    .map((o) => ({ s: o.at - o.width / 2, e: o.at + o.width / 2, sill: o.sill, head: o.head }))
    .filter((o) => o.e > a0 + 150 && o.s < a1 - 150)
    .sort((p, q) => p.s - q.s)

  let cursor = a0
  clean.forEach((o, i) => {
    // The plan is authoritative: refuse an impossible opening rather than
    // silently shrinking or moving it in the 3D wall.
    const s = o.s
    const e = o.e
    if (e - s < 400 || s < a0 + 110 || e > a1 - 110 || s < cursor + 80)
      throw new Error(`${tag}: plan opening cannot fit its exterior wall unchanged`)
    const sillY = baseY + o.sill
    const headY = Math.min(baseY + o.head, wallTop - 0.08)
    solid(cursor, s, baseY, wallTop, `p${i}`) // pier
    if (sillY - baseY > 0.08) solid(s, e, baseY, sillY, `sp${i}`) // spandrel under a window
    if (wallTop - headY > 0.08) solid(s, e, headY, wallTop, `hd${i}`) // header

    // one recessed dark pane, smaller than the void on every edge
    const paneFixed = fixed + outward * (HT_MM - (RECESS + PANE_T / 2) * 1000)
    const pl = m(e - s) - 2 * PANE_SHRINK
    const ph = headY - sillY - 2 * PANE_SHRINK
    if (pl > 0.1 && ph > 0.1) {
      const pmid = (s + e) / 2
      const ppx = horizontal ? wx(pmid) : wx(paneFixed)
      const ppz = horizontal ? wz(paneFixed) : wz(pmid)
      push(
        `${tag}-gl${i}`,
        'glass',
        level,
        [ppx, (sillY + headY) / 2, ppz],
        horizontal ? [pl, ph, PANE_T] : [PANE_T, ph, pl],
      )

      // teak frame at the wall face + vertical mullions on wide (grouped) panes
      const isWindow = o.head - o.sill < 2.0 // doors/entry keep an open reveal
      if (isWindow) {
        const fr = 0.08 // frame member size
        const ff = fixed + outward * (HT_MM - fr * 500) // sits in the reveal, flush-ish
        const along = (from: number, to: number, yb: number, yt: number, thin: boolean, sub: string) => {
          const len = m(to - from)
          const hh = yt - yb
          if (len < 0.03 || hh < 0.03) return
          const mid = (from + to) / 2
          const px = horizontal ? wx(mid) : wx(ff)
          const pz = horizontal ? wz(ff) : wz(mid)
          push(
            `${tag}-fr${i}${sub}`,
            'clad',
            level,
            [px, (yb + yt) / 2, pz],
            horizontal ? [len, hh, thin ? fr : fr] : [thin ? fr : fr, hh, len],
          )
        }
        along(s, e, sillY, sillY + fr, false, 'b')
        along(s, e, headY - fr, headY, false, 't')
        along(s, s + Math.round(fr * 1000), sillY, headY, true, 'l')
        along(e - Math.round(fr * 1000), e, sillY, headY, true, 'r')
        const bays = Math.max(1, Math.round((e - s) / groupMm))
        for (let k = 1; k < bays; k++) {
          const c = s + ((e - s) * k) / bays
          along(c - Math.round(fr * 500), c + Math.round(fr * 500), sillY, headY, true, `m${k}`)
        }

        // Treat the verified window opening in place. Surround members sit
        // outside its clear glass bounds, so every DNA variant keeps the same
        // width, sill and head as the plan.
        if (windowTreatment !== 'flush-frame' && windowTreatment !== 'sunshade') {
          const border = windowTreatment === 'projecting-frame' ? 0.16 :
            windowTreatment === 'deep-reveal' ? 0.13 : 0.11
          const depth = windowTreatment === 'projecting-frame' ? 0.3 : 0.18
          const off = outward * (EXT_T / 2 + depth / 2)
          const surroundKind: MassKind = windowTreatment === 'stone-surround' ? 'feature' : 'clad'
          const surround = (sub: string, alongMid: number, yMid: number, alongSize: number, height: number) => {
            push(`${tag}-sur${i}${sub}`, surroundKind, level,
              horizontal ? [wx(alongMid), yMid, wz(fixed) + off] : [wx(fixed) + off, yMid, wz(alongMid)],
              horizontal ? [alongSize, height, depth] : [depth, height, alongSize])
          }
          surround('l', s - border * 500, (sillY + headY) / 2, border, headY - sillY + border * 2)
          surround('r', e + border * 500, (sillY + headY) / 2, border, headY - sillY + border * 2)
          surround('t', (s + e) / 2, headY + border / 2, m(e - s) + border * 2, border)
          surround('b', (s + e) / 2, sillY - border / 2, m(e - s) + border * 2, border)
        }

        // ---- cantilevered chajja (weather-hood) over the window ----
        if ((chajjaMm > 200 || windowTreatment === 'sunshade') && headY + 0.2 < wallTop) {
          const proj = windowTreatment === 'sunshade' ? Math.max(chajjaMm, 450) / 1000 : chajjaMm / 1000
          const cw = m(e - s) + 0.34
          const cyc = headY + 0.055
          const off = outward * (EXT_T / 2 + proj / 2)
          const cd = proj + 0.16
          const cpx = horizontal ? wx((s + e) / 2) : wx(fixed) + off
          const cpz = horizontal ? wz(fixed) + off : wz((s + e) / 2)
          push(
            `${tag}-cj${i}`,
            'shade',
            level,
            [cpx, cyc, cpz],
            horizontal ? [cw, 0.09, cd] : [cd, 0.09, cw],
          )
          // a slim down-turned drip lip on the outer edge
          const lo = outward * (EXT_T / 2 + proj)
          push(
            `${tag}-cjl${i}`,
            'shade',
            level,
            horizontal
              ? [wx((s + e) / 2), cyc + 0.005, wz(fixed) + lo]
              : [wx(fixed) + lo, cyc + 0.005, wz((s + e) / 2)],
            horizontal ? [cw + 0.03, 0.11, 0.05] : [0.05, 0.11, cw + 0.03],
          )
        }
      }
    }
    cursor = e
  })
  solid(cursor, a1, baseY, wallTop, 'pE')
}

/** interior wall as a `partition` box, cut around any interior doorway on its line */
function segmentPartition(
  w: FloorPlan['walls'][number],
  doors: Opening[],
  baseY: number,
  H: number,
  level: number,
  tag: string,
  push: Push,
  wx: XF,
  wz: XF,
  m: XF,
) {
  const horizontal = Math.abs(w.b.x - w.a.x) >= Math.abs(w.b.y - w.a.y)
  const p0 = horizontal ? Math.min(w.a.x, w.b.x) : Math.min(w.a.y, w.b.y)
  const p1 = horizontal ? Math.max(w.a.x, w.b.x) : Math.max(w.a.y, w.b.y)
  const fixed = horizontal ? w.a.y : w.a.x
  if (p1 - p0 < 250) return
  const t = w.thickness ? m(w.thickness) : INT_T
  const top = H - SLAB_T - 0.02

  const gaps = doors
    .filter((d) => (d.orient === 'h') === horizontal)
    .filter((d) => Math.abs((horizontal ? d.at.y : d.at.x) - fixed) < 220)
    .map((d) => {
      const c = horizontal ? d.at.x : d.at.y
      return { s: c - d.width / 2, e: c + d.width / 2, treatment: d.treatment }
    })
    .filter((d) => d.e > p0 && d.s < p1)
    .sort((a, b) => a.s - b.s)

  // a glazed sliding screen fills its gap with a thin glass panel; an open
  // kitchen ('open') leaves the gap empty
  gaps.forEach((d, i) => {
    if (d.treatment !== 'glazed-slide') return
    const mid = (d.s + d.e) / 2
    const len = m(d.e - d.s)
    const gh = Math.min(2.1, top)
    push(`${tag}-slide${i}`, 'glass', level,
      [wx(horizontal ? mid : fixed), baseY + gh / 2, wz(horizontal ? fixed : mid)],
      horizontal ? [len, gh, 0.03] : [0.03, gh, len])
  })

  const seg = (from: number, to: number, sub: string) => {
    if (to - from < 120) return
    const mid = (from + to) / 2
    const len = m(to - from)
    push(
      `${tag}-${sub}`,
      'partition',
      level,
      [wx(horizontal ? mid : fixed), baseY + top / 2, wz(horizontal ? fixed : mid)],
      horizontal ? [len, top, t] : [t, top, len],
    )
  }

  let cur = p0
  gaps.forEach((d, i) => {
    seg(cur, Math.max(cur, d.s), `s${i}`)
    cur = Math.max(cur, d.e)
  })
  seg(cur, p1, 'sE')
}

/* --------------------------------- roof / terrace -------------------------------- */

/** a thin projecting horizontal band wrapping a storey at its floor line */
function stringCourse(o: Rect, baseY: number, L: number, proj: number, push: Push, wx: XF, wz: XF, m: XF) {
  const cxw = wx(o.x + o.w / 2)
  const czw = wz(o.y + o.h / 2)
  const bh = 0.14
  const by = baseY - 0.03
  const t = 0.1
  const rw = m(o.w) + EXT_T + 2 * proj
  const rd = m(o.h) + EXT_T + 2 * proj
  const nz = wz(o.y) - EXT_T / 2 - proj + t / 2
  const sz = wz(o.y + o.h) + EXT_T / 2 + proj - t / 2
  const wxc = wx(o.x) - EXT_T / 2 - proj + t / 2
  const exc = wx(o.x + o.w) + EXT_T / 2 + proj - t / 2
  push(`sc-${L}-n`, 'band', L, [cxw, by, nz], [rw, bh, t])
  push(`sc-${L}-s`, 'band', L, [cxw, by, sz], [rw, bh, t])
  push(`sc-${L}-w`, 'band', L, [wxc, by, czw], [t, bh, rd])
  push(`sc-${L}-e`, 'band', L, [exc, by, czw], [t, bh, rd])
}

/** slim steel guard rail (top + mid rail + posts) along one plan-mm edge */
function guardRail(
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  yBase: number,
  level: number,
  tag: string,
  push: Push,
  wx: XF,
  wz: XF,
  m: XF,
  rail: RailStyle = 'bar',
) {
  const dx = x1 - x0
  const dz = z1 - z0
  const lenMm = Math.hypot(dx, dz)
  if (lenMm < 600) return
  const horiz = Math.abs(dx) >= Math.abs(dz)
  const lm = m(lenMm)
  const mx = wx((x0 + x1) / 2)
  const mz = wz((z0 + z1) / 2)
  const H = 0.95

  if (rail === 'glass') {
    // one frameless panel + a slim capping rail
    const pt = 0.03 // > push()'s 0.02 m floor, or the pane is silently dropped
    push(`${tag}-glass`, 'glass', level, [mx, yBase + H / 2 + 0.06, mz], horiz ? [lm, H - 0.12, pt] : [pt, H - 0.12, lm])
    push(`${tag}-cap`, 'railing', level, [mx, yBase + H, mz], horiz ? [lm + 0.05, 0.05, 0.05] : [0.05, 0.05, lm + 0.05])
    for (const t of [0, 1]) {
      push(`${tag}-p${t}`, 'railing', level, [wx(x0 + dx * t), yBase + H / 2, wz(z0 + dz * t)], [0.05, H, 0.05])
    }
    return
  }

  const rt = 0.036
  for (const h of [H, H * 0.5]) {
    push(`${tag}-r${Math.round(h * 100)}`, 'railing', level, [mx, yBase + h, mz], horiz ? [lm, rt, rt] : [rt, rt, lm])
  }
  const n = Math.max(1, Math.round(lenMm / 2000))
  for (let i = 0; i <= n; i++) {
    const t = i / n
    push(`${tag}-p${i}`, 'railing', level, [wx(x0 + dx * t), yBase + H / 2, wz(z0 + dz * t)], [0.045, H, 0.045])
  }
}

function buildRoof(o: Rect, wallTop: number, L: number, T: ThemeDef,
  geometry: DesignDNA['roofGeometry'] | undefined, allPush: Push, wx: XF, wz: XF, m: XF,
  open: Record<Side, boolean> = { N: true, S: true, W: true, E: true }) {
  // pieces tagged -n/-s/-w/-e belong to one side; drop them on a side where blocks join
  const push: Push = (id, ...rest) => {
    const side = /-([nswe])(?:-|$)/.exec(id)?.[1]?.toUpperCase() as Side | undefined
    if (!side || open[side]) allPush(id, ...rest)
  }
  const cxw = wx(o.x + o.w / 2)
  const czw = wz(o.y + o.h / 2)
  const roofT = T.roof.thickMm / 1000
  const profile = geometry?.profile ?? 'slim'
  const eave = Math.min(Math.max(T.roof.eaveMm / 1000, 0.15) *
    (profile === 'deep-eave' ? 1.35 : profile === 'raised-edge' ? 1.05 : 0.8), 0.95)
  const wallW = m(o.w) + EXT_T
  const wallD = m(o.h) + EXT_T
  const rw = wallW + 2 * eave
  const rd = wallD + 2 * eave

  // thin roof deck flush with top-of-wall (+ any eave oversail)
  push(`roof-${L}`, 'roof', L, [cxw, wallTop - roofT / 2, czw], [rw, roofT, rd])

  // ---- perimeter guard rail — the top slab is a usable terrace ----
  const gx0 = o.x - HT_MM
  const gx1 = o.x + o.w + HT_MM
  const gz0 = o.y - HT_MM
  const gz1 = o.y + o.h + HT_MM
  const gr = T.accents.railStyle
  guardRail(gx0, gz0, gx1, gz0, wallTop, L, `groof-${L}-n`, push, wx, wz, m, gr)
  guardRail(gx0, gz1, gx1, gz1, wallTop, L, `groof-${L}-s`, push, wx, wz, m, gr)
  guardRail(gx0, gz0, gx0, gz1, wallTop, L, `groof-${L}-w`, push, wx, wz, m, gr)
  guardRail(gx1, gz0, gx1, gz1, wallTop, L, `groof-${L}-e`, push, wx, wz, m, gr)

  // ---- flat-band: the signature bold white fascia beam wrapping the slab ----
  if (T.roof.style === 'flat-band') {
    const band = T.roof.bandMm / 1000 + (profile === 'raised-edge' ? 0.22 : profile === 'deep-eave' ? 0.08 : 0)
    const t = 0.14 // fascia beam thickness (how proud it sits)
    // the band centres on the slab edge, projecting past the wall face
    const by = wallTop - roofT / 2 // vertical centre — straddles the deck
    const nz = wz(o.y) - EXT_T / 2 - eave + t / 2
    const sz = wz(o.y + o.h) + EXT_T / 2 + eave - t / 2
    const wxc = wx(o.x) - EXT_T / 2 - eave + t / 2
    const exc = wx(o.x + o.w) + EXT_T / 2 + eave - t / 2
    push(`band-${L}-n`, 'roof', L, [cxw, by, nz], [rw, band, t])
    push(`band-${L}-s`, 'roof', L, [cxw, by, sz], [rw, band, t])
    push(`band-${L}-w`, 'roof', L, [wxc, by, czw], [t, band, rd])
    push(`band-${L}-e`, 'roof', L, [exc, by, czw], [t, band, rd])
    // a slim upstand lip on the outer top edge
    const ly = by + band / 2 + 0.05
    push(`lip-${L}-n`, 'roof', L, [cxw, ly, nz], [rw + 0.04, 0.1, t + 0.04])
    push(`lip-${L}-s`, 'roof', L, [cxw, ly, sz], [rw + 0.04, 0.1, t + 0.04])
    push(`lip-${L}-w`, 'roof', L, [wxc, ly, czw], [t + 0.04, 0.1, rd + 0.04])
    push(`lip-${L}-e`, 'roof', L, [exc, ly, czw], [t + 0.04, 0.1, rd + 0.04])
    return
  }

  if (T.roof.style === 'flat-eave') {
    const fh = 0.16
    const fy = wallTop - roofT - fh / 2
    push(`fas-${L}-n`, 'roof', L, [cxw, fy, wz(o.y) - EXT_T / 2 - eave + PARAPET_T / 2], [rw, fh, PARAPET_T])
    push(`fas-${L}-s`, 'roof', L, [cxw, fy, wz(o.y + o.h) + EXT_T / 2 + eave - PARAPET_T / 2], [rw, fh, PARAPET_T])
    push(`fas-${L}-w`, 'roof', L, [wx(o.x) - EXT_T / 2 - eave + PARAPET_T / 2, fy, czw], [PARAPET_T, fh, rd])
    push(`fas-${L}-e`, 'roof', L, [wx(o.x + o.w) + EXT_T / 2 + eave - PARAPET_T / 2, fy, czw], [PARAPET_T, fh, rd])
  }

  const parH = T.roof.parapetMm / 1000 + (T.roof.parapetMm > 0 && profile === 'raised-edge' ? 0.22 : 0)
  if (parH < 0.05) return
  const pcy = wallTop + parH / 2
  const vLen = Math.max(wallD - 2 * PARAPET_T, 0.2)
  push(`par-${L}-n`, 'parapet', L, [cxw, pcy, wz(o.y) - EXT_T / 2 + PARAPET_T / 2], [wallW, parH, PARAPET_T])
  push(`par-${L}-s`, 'parapet', L, [cxw, pcy, wz(o.y + o.h) + EXT_T / 2 - PARAPET_T / 2], [wallW, parH, PARAPET_T])
  push(`par-${L}-w`, 'parapet', L, [wx(o.x) - EXT_T / 2 + PARAPET_T / 2, pcy, czw], [PARAPET_T, parH, vLen])
  push(`par-${L}-e`, 'parapet', L, [wx(o.x + o.w) + EXT_T / 2 - PARAPET_T / 2, pcy, czw], [PARAPET_T, parH, vLen])
}

/** a real sloped roof volume over a block — a `prism` box the scene renders as a
 *  hip / gable / mono-slope solid, plus a thin eave fascia band under it */
function buildPitchedRoof(
  o: Rect,
  wallTop: number,
  L: number,
  kind: 'hip' | 'gable' | 'mono-slope',
  pitchDeg: number,
  T: ThemeDef,
  geometry: DesignDNA['roofGeometry'] | undefined,
  push: Push,
  wx: XF,
  wz: XF,
  m: XF,
) {
  const profile = geometry?.profile ?? 'slim'
  const eave = Math.max(T.roof.eaveMm, 500) / 1000 * (profile === 'deep-eave' ? 1.3 : profile === 'raised-edge' ? 1.1 : 0.9)
  const wallW = m(o.w) + EXT_T
  const wallD = m(o.h) + EXT_T
  const rw = wallW + 2 * eave
  const rd = wallD + 2 * eave
  const cxw = wx(o.x + o.w / 2)
  const czw = wz(o.y + o.h / 2)
  // A cross ridge is used only on near-square blocks; otherwise it would
  // create an implausibly tall roof across the long side of a narrow wing.
  const longRidge: 'x' | 'z' = o.w >= o.h ? 'x' : 'z'
  const ridge: 'x' | 'z' = geometry?.ridge === 'cross' && Math.max(o.w, o.h) / Math.min(o.w, o.h) <= 1.35
    ? longRidge === 'x' ? 'z' : 'x' : longRidge
  const span = (ridge === 'x' ? rd : rw) / 2
  const actualPitch = clamp(pitchDeg + (geometry?.pitchBiasDeg ?? 0), 14, 32)
  const rise = Math.min(span * Math.tan((actualPitch * Math.PI) / 180), 3.4)
  const fasciaT = T.roof.thickMm / 1000

  // thin eave fascia sitting on top of the wall, all round
  push(`eave-${L}-n`, 'roof', L, [cxw, wallTop + fasciaT / 2, wz(o.y) - EXT_T / 2 - eave + 0.06], [rw, fasciaT, 0.12])
  push(`eave-${L}-s`, 'roof', L, [cxw, wallTop + fasciaT / 2, wz(o.y + o.h) + EXT_T / 2 + eave - 0.06], [rw, fasciaT, 0.12])
  push(`eave-${L}-w`, 'roof', L, [wx(o.x) - EXT_T / 2 - eave + 0.06, wallTop + fasciaT / 2, czw], [0.12, fasciaT, rd])
  push(`eave-${L}-e`, 'roof', L, [wx(o.x + o.w) + EXT_T / 2 + eave - 0.06, wallTop + fasciaT / 2, czw], [0.12, fasciaT, rd])

  const form = kind === 'mono-slope' ? 'mono' : kind === 'gable' ? 'gable' : 'hip'
  const low = form === 'mono' ? (ridge === 'x'
    ? geometry?.monoLowSide === 'second' ? 'z+' : 'z-'
    : geometry?.monoLowSide === 'second' ? 'x+' : 'x-') : undefined
  push(
    `pitch-${L}`,
    'prism',
    L,
    [cxw, wallTop + fasciaT + rise / 2, czw],
    [rw, rise, rd],
    { form, ridge, low },
  )
}

/** One visible roof-edge element per exterior seed. Every element is attached
 * to the front exterior wall above the highest opening; it changes no plan
 * void, column, floor plate or circulation route. */
function buildRoofSignature(o: Rect, wallTop: number, level: number, block: number,
  pitched: boolean, dna: DesignDNA, push: Push, wx: XF, wz: XF, m: XF, outsideGlass = false) {
  const width = Math.min(o.w - 900, 4200)
  if (width < 1600) return
  const start = dna.accentSide === 'left' ? o.x + 450 : o.x + o.w - 450 - width
  const x0 = wx(start)
  const run = m(width)
  const z = wz(o.y + o.h) + EXT_T / 2 + 0.06
  // outer face of the roof guard rail's glass (rail on the wall centreline, 0.03 pane)
  const glassFace = wz(o.y + o.h + HT_MM) + 0.015
  const base = pitched ? wallTop - 0.5 : wallTop
  const h = pitched ? 0.46 : 1.25
  const tag = `sig-${level}-${block}`
  const box = (name: string, kind: MassKind, x: number, y: number,
    w: number, ht: number, depth: number) =>
    // in front of a frameless glass guard rail the element stands just clear of the pane
    push(`${tag}-${name}`, kind, level, [x, y, outsideGlass ? glassFace + 0.01 + depth / 2 : z], [w, ht, depth])

  switch (dna.roofGeometry?.element ?? 'portal') {
    case 'portal': {
      for (const [index, x] of [x0, x0 + run].entries())
        box(`portal-post-${index}`, 'feature', x, base + h / 2, 0.16, h, 0.24)
      box('portal-beam', 'feature', x0 + run / 2, base + h + 0.06, run + 0.24, 0.14, 0.3)
      break
    }
    case 'fins': {
      for (let i = 0; i < 6; i++)
        box(`fin-${i}`, 'screen', x0 + run * i / 5, base + h / 2, 0.11, h, 0.36)
      break
    }
    case 'cornice': {
      for (let i = 0; i < 3; i++)
        box(`cornice-${i}`, 'railing', x0 + run / 2, base + 0.08 + i * (pitched ? 0.14 : 0.24),
          run - i * 0.14, 0.07, 0.18 + i * 0.06)
      break
    }
    case 'screen': {
      for (let i = 0; i < 3; i++)
        box(`screen-${i}`, 'screen', x0 + run * (i + 0.5) / 3,
          base + h * 0.42, run / 3 - 0.15, h * 0.84, 0.18)
      break
    }
  }
}

/* ---------------------- contemporary-villa moves (modernist) ---------------------- */

/** an upper storey cantilevering over the recessed ground floor on the street
 *  (plan-south) side — a projecting floor apron + a shallow skirt below it.
 *  Massing only; the walls and windows stay on the plan. */
function cantileverApron(
  o: Rect,
  baseY: number,
  bid: string,
  L: number,
  projM: number,
  push: Push,
  wx: XF,
  wz: XF,
  m: XF,
) {
  const cxw = wx(o.x + o.w / 2)
  const w = m(o.w) + EXT_T
  const southZ = wz(o.y + o.h) + EXT_T / 2
  const apronT = 0.42
  push(`cant-${bid}`, 'band', L, [cxw, baseY - apronT / 2 + 0.12, southZ + projM / 2], [w, apronT, projM + 0.12])
  // shallow skirt hanging under the front edge so the cantilever reads as mass
  push(`cant-skirt-${bid}`, 'band', L, [cxw, baseY - 0.42, southZ + projM - 0.06], [w, 0.78, 0.12])
}

/** a slatted pergola + a planter run over part of the top terrace */
function roofPergola(p: Rect, level: number, deckY: number, push: Push, wx: XF, wz: XF, m: XF) {
  const pw = p.w
  const pd = p.h
  const px = p.x
  const pz0 = p.y
  const top = deckY + 2.4
  for (const z of [pz0, pz0 + pd]) {
    push(`perg-b${Math.round(z)}`, 'shade', level, [wx(px + pw / 2), top, wz(z)], [m(pw) + 0.2, 0.12, 0.1])
  }
  const n = Math.max(5, Math.round(pw / 430))
  for (let i = 0; i <= n; i++) {
    push(`perg-s${i}`, 'shade', level, [wx(px + (pw * i) / n), top + 0.03, wz(pz0 + pd / 2)], [0.09, 0.07, m(pd) + 0.16])
  }
  for (const [cx, cz] of [
    [px, pz0],
    [px + pw, pz0],
    [px, pz0 + pd],
    [px + pw, pz0 + pd],
  ] as const) {
    push(`perg-p${Math.round(cx)}-${Math.round(cz)}`, 'railing', level, [wx(cx), deckY + 1.2, wz(cz)], [0.09, 2.4, 0.09])
  }
  push('perg-plnt', 'planter', level, [wx(px + pw / 2), deckY + 0.22, wz(pz0 + 450)], [m(pw - 200), 0.44, 0.7])
}

function buildTerrace(
  o: Rect,
  up: Rect,
  wallTop: number,
  L: number,
  T: ThemeDef,
  push: Push,
  wx: XF,
  wz: XF,
  m: XF,
) {
  const exN = up.y - o.y > 400
  const exS = o.y + o.h - (up.y + up.h) > 400
  const exW = up.x - o.x > 400
  const exE = o.x + o.w - (up.x + up.w) > 400

  const cxw = wx(o.x + o.w / 2)
  const czw = wz(o.y + o.h / 2)
  const rw = m(o.w) + EXT_T
  const rd = m(o.h) + EXT_T
  // always cap the storey — a hair below the storey-above soffit so it never
  // z-fights the inset slab, and so equal-footprint floors still get a ceiling
  push(`terr-${L}`, 'roof', L, [cxw, wallTop - SLAB_T - ROOF_T / 2 - 0.01, czw], [rw, ROOF_T, rd])

  const kcy = wallTop + KERB_H / 2
  if (exN)
    push(`kerb-${L}-n`, 'parapet', L, [cxw, kcy, wz(o.y) - EXT_T / 2 + PARAPET_T / 2], [rw, KERB_H, PARAPET_T])
  if (exS)
    push(
      `kerb-${L}-s`,
      'parapet',
      L,
      [cxw, kcy, wz(o.y + o.h) + EXT_T / 2 - PARAPET_T / 2],
      [rw, KERB_H, PARAPET_T],
    )
  if (exW)
    push(`kerb-${L}-w`, 'parapet', L, [wx(o.x) - EXT_T / 2 + PARAPET_T / 2, kcy, czw], [PARAPET_T, KERB_H, rd])
  if (exE)
    push(
      `kerb-${L}-e`,
      'parapet',
      L,
      [wx(o.x + o.w) + EXT_T / 2 - PARAPET_T / 2, kcy, czw],
      [PARAPET_T, KERB_H, rd],
    )

  // ---- a slim steel guard above the kerb on every walkable edge ----
  const dT = wallTop - SLAB_T - 0.01
  const ax0 = o.x - HT_MM
  const ax1 = o.x + o.w + HT_MM
  const az0 = o.y - HT_MM
  const az1 = o.y + o.h + HT_MM
  const gr = T.accents.railStyle
  if (exN) guardRail(ax0, az0, ax1, az0, dT, L, `gt-${L}-n`, push, wx, wz, m, gr)
  if (exS) guardRail(ax0, az1, ax1, az1, dT, L, `gt-${L}-s`, push, wx, wz, m, gr)
  if (exW) guardRail(ax0, az0, ax0, az1, dT, L, `gt-${L}-w`, push, wx, wz, m, gr)
  if (exE) guardRail(ax1, az0, ax1, az1, dT, L, `gt-${L}-e`, push, wx, wz, m, gr)
}

/* --------------------------------- carport / porch ------------------------------- */

function buildCarport(
  rect: Rect,
  ground: Rect,
  y0: number,
  L: number,
  id: string,
  geometry: DesignDNA['roofGeometry'] | undefined,
  push: Push,
  wx: XF,
  wz: XF,
  m: XF,
) {
  const houseS = ground.y + ground.h
  const cN = rect.y > houseS - 800 ? houseS + 120 : rect.y
  const cS = rect.y + rect.h
  const cW = rect.x
  const cE = rect.x + rect.w
  if (cS - cN < 1600 || cE - cW < 1600) return

  const cxm = wx((cW + cE) / 2)
  const czm = wz((cN + cS) / 2)
  const wM = m(cE - cW)
  const dM = m(cS - cN)
  const topY = y0 + CANOPY_TOP
  const profile = geometry?.profile ?? 'slim'
  const canopyT = profile === 'raised-edge' ? 0.38 : profile === 'deep-eave' ? 0.24 : 0.18
  const edge = profile === 'deep-eave' ? 0.25 : profile === 'raised-edge' ? 0.18 : 0.1

  push(`can-${L}-${id}`, 'canopy', L, [cxm, topY - canopyT / 2, czm], [wM + 2 * edge, canopyT, dM + 2 * edge])
  if (profile === 'raised-edge')
    push(`can-fascia-${L}-${id}`, 'band', L,
      [cxm, topY - canopyT - 0.12, wz(cS) + edge - 0.06], [wM + 2 * edge, 0.24, 0.12])

  // a paved parking pad, a touch proud of the lawn, with a low kerb and
  // painted bay lines so it reads as a real parking space
  push(`cpad-${L}-${id}`, 'paving', L, [cxm, 0.05, czm], [wM + 0.3, 0.1, dM + 0.3])
  const bays = wM > 5 ? 2 : 1
  for (let i = 1; i < bays; i++) {
    const bx = wx(cW) + (wM / bays) * i
    push(`bay-${L}-${id}-${i}`, 'slab', L, [bx, 0.11, czm], [0.08, 0.03, dM * 0.9])
  }

  const colTop = topY - canopyT // canopy soffit
  const colBot = 0.02
  const colH = colTop - colBot
  const ins = COL / 2 + 0.14
  const xL = wx(cW) + ins
  const xR = wx(cE) - ins
  const zS = wz(cS) - ins
  const zN = wz(cN) + ins
  const zMid = (wz(cN) + wz(cS)) / 2
  const houseZ = wz(houseS)
  const col = (x: number, z: number, k: string) => {
    if (Math.abs(z - houseZ) < 0.9) return // the house wall carries this edge
    push(`col-${L}-${id}-${k}`, 'column', L, [x, colBot + colH / 2, z], [COL + 0.04, colH, COL + 0.04])
    push(`colbase-${L}-${id}-${k}`, 'plinth', L, [x, 0.09, z], [COL + 0.26, 0.16, COL + 0.26])
  }
  col(xL, zS, 'sw')
  col(xR, zS, 'se')
  col(xL, zN, 'nw')
  col(xR, zN, 'ne')
  if (dM > 5.2) {
    col(xL, zMid, 'mw')
    col(xR, zMid, 'me')
  }
  if (wM > 6.4) col((xL + xR) / 2, zS, 'sm')
}

function buildBalcony(
  rect: Rect,
  baseY: number,
  L: number,
  depthM: number,
  rail: RailStyle,
  treatment: DesignDNA['balconyDesign'],
  push: Push,
  wx: XF,
  wz: XF,
  m: XF,
) {
  const depth = Math.max(rect.h, depthM * 1000)
  const bN = rect.y - 150 // tuck under the facade so it connects
  const bS = rect.y + depth
  const bW = rect.x
  const bE = rect.x + rect.w
  if (bE - bW < 1200) return
  const cxw = wx((bW + bE) / 2)

  // projecting slab, top a step above the finished floor so it clearly reads
  push(`balc-${L}`, 'slab', L, [cxw, baseY - 0.11, wz((bN + bS) / 2)], [m(bE - bW), 0.26, m(bS - bN)])

  const rh = 0.98 // handrail height above the balcony floor
  const y = baseY
  const edges: { from: Vec3; to: Vec3 }[] = [
    { from: [wx(bW), y, wz(bS)], to: [wx(bE), y, wz(bS)] }, // south
    { from: [wx(bW), y, wz(rect.y - 100)], to: [wx(bW), y, wz(bS)] }, // west return
    { from: [wx(bE), y, wz(rect.y - 100)], to: [wx(bE), y, wz(bS)] }, // east return
  ]
  if (treatment === 'solid-parapet') {
    push(`balc-solid-front-${L}`, 'parapet', L,
      [cxw, y + rh / 2, wz(bS)], [m(bE - bW), rh, 0.12])
    push(`balc-solid-left-${L}`, 'parapet', L,
      [wx(bW), y + rh / 2, wz((bN + bS) / 2)], [0.12, rh, m(bS - bN)])
    push(`balc-solid-right-${L}`, 'parapet', L,
      [wx(bE), y + rh / 2, wz((bN + bS) / 2)], [0.12, rh, m(bS - bN)])
    return
  }
  edges.forEach((e, ei) => {
    const horiz = Math.abs(e.to[0] - e.from[0]) >= Math.abs(e.to[2] - e.from[2])
    const len = horiz ? Math.abs(e.to[0] - e.from[0]) : Math.abs(e.to[2] - e.from[2])
    if (len < 0.4) return
    const mx = (e.from[0] + e.to[0]) / 2
    const mz = (e.from[2] + e.to[2]) / 2
    const post = 0.05
    const railT = rail === 'bar' ? 0.035 : 0.06
    const railSize: Vec3 = horiz ? [len + post, railT, railT] : [railT, railT, len + post]

    if (rail === 'glass') {
      const pt = 0.03 // > push()'s 0.02 m floor, or the pane is silently dropped
      push(`balg-${L}-${ei}`, 'glass', L, [mx, y + rh / 2 + 0.06, mz], horiz ? [len, rh - 0.12, pt] : [pt, rh - 0.12, len])
      push(`balc-cap-${L}-${ei}`, 'railing', L, [mx, y + rh, mz], railSize)
      for (const t of [0, 1]) {
        const px = e.from[0] + (e.to[0] - e.from[0]) * t
        const pz = e.from[2] + (e.to[2] - e.from[2]) * t
        push(`balp-${L}-${ei}-${t}`, 'railing', L, [px, y + rh / 2, pz], [post, rh, post])
      }
    } else if (rail === 'bar') {
      // slim black steel: a top handrail + three thin horizontals, end posts only
      for (const f of [1, 0.7, 0.42, 0.14]) {
        push(`balr-${L}-${ei}-${f}`, 'railing', L, [mx, y + rh * f, mz], railSize)
      }
      for (const t of [0, 1]) {
        const px = e.from[0] + (e.to[0] - e.from[0]) * t
        const pz = e.from[2] + (e.to[2] - e.from[2]) * t
        push(`balp-${L}-${ei}-${t}`, 'railing', L, [px, y + rh / 2, pz], [post, rh, post])
      }
    } else {
      push(`balr-${L}-${ei}-top`, 'railing', L, [mx, y + rh, mz], railSize)
      push(`balr-${L}-${ei}-bot`, 'railing', L, [mx, y + 0.12, mz], railSize)
      const n = Math.max(2, Math.round(len / 0.28))
      for (let i = 0; i <= n; i++) {
        const t = i / n
        const px = e.from[0] + (e.to[0] - e.from[0]) * t
        const pz = e.from[2] + (e.to[2] - e.from[2]) * t
        push(`balp-${L}-${ei}-${i}`, 'railing', L, [px, y + rh / 2, pz], [post, rh, post])
      }
    }
  })
  if (treatment === 'planter-balcony')
    push(`balc-planter-${L}`, 'planter', L,
      [cxw, y + 0.28, wz(bS + 180)], [Math.min(m(bE - bW) - 0.3, 3.2), 0.45, 0.32])
}

/** A stair headroom enclosure and water tank only on a usable flat terrace. */
function roofServices({ mumty, tank }: TerraceLayout, level: number, deckY: number, push: Push, wx: XF, wz: XF, m: XF) {
  if (mumty) {
    const mw = mumty.w
    const md = mumty.h
    const mx = mumty.x + mw / 2
    const mz = mumty.y + md / 2
    const mh = 2.35
    const wt = 0.12
    push('mumty-n', 'mumty', level, [wx(mx), deckY + mh / 2, wz(mz - md / 2)], [m(mw), mh, wt])
    push('mumty-s', 'mumty', level, [wx(mx), deckY + mh / 2, wz(mz + md / 2)], [m(mw), mh, wt])
    push('mumty-w', 'mumty', level, [wx(mx - mw / 2), deckY + mh / 2, wz(mz)], [wt, mh, m(md)])
    push('mumty-e', 'mumty', level, [wx(mx + mw / 2), deckY + mh / 2, wz(mz)], [wt, mh, m(md)])
    push('mumty-roof', 'roof', level, [wx(mx), deckY + mh + 0.06, wz(mz)], [m(mw) + 0.34, 0.12, m(md) + 0.34])
    push('mumty-lip', 'roof', level, [wx(mx), deckY + mh + 0.16, wz(mz)], [m(mw) + 0.48, 0.06, m(md) + 0.48])
  }

  if (!tank) return
  const near = tank.x + tank.w / 2
  const nz = tank.y + tank.h / 2
  const legH = 0.85
  const tk = 0.9
  const th = 0.95
  const legs: [number, number][] = [
    [near - 370, nz - 370], [near + 370, nz - 370],
    [near - 370, nz + 370], [near + 370, nz + 370],
  ]
  legs.forEach(([lx, lz], i) => {
    push(`tank-leg${i}`, 'railing', level, [wx(lx), deckY + legH / 2, wz(lz)], [0.07, legH, 0.07])
  })
  push('tank-frame', 'railing', level, [wx(near), deckY + legH, wz(nz)], [tk + 0.12, 0.05, tk + 0.12])
  push('tank', 'tank', level, [wx(near), deckY + legH + th / 2, wz(nz)], [tk, th, tk])
}

/* --------------------------------- site / garden -------------------------------- */

function buildLandscape(
  model: CanonicalModel,
  ground: FloorPlan,
  T: ThemeDef,
  push: Push,
  wx: XF,
  wz: XF,
  m: XF,
) {
  const P = model.brief.rooms.priorities
  if (!P.garden && !P.compoundWall) return

  const rnd = seededRng(model.seed)
  const plotW = model.plot.width
  const plotD = model.plot.depth
  const sb = model.setbacksMm
  const g = ground.outline
  const gx0 = g.x
  const gy0 = g.y
  const gy1 = g.y + g.h
  const carport = ground.rooms.find((r) => r.id === 'parking')
  const entry = ground.openings.find((o) => o.kind === 'entry')
  const driveX = carport ? carport.rect.x + carport.rect.w / 2 : entry ? entry.at.x : plotW / 2

  // ---- lawn covering the plot, just above grade (hard surfaces sit on top) ----
  if (P.garden) {
    push('lawn', 'lawn', 0, [wx(plotW / 2), 0.02, wz(plotD / 2)], [m(plotW - 400), 0.04, m(plotD - 400)])

    // driveway from the approach (plan-south) to the carport / house front
    const driveW = carport ? Math.min(carport.rect.w, 3400) : 3000
    const driveN = carport ? carport.rect.y + carport.rect.h : gy1
    push(
      'drive',
      'paving',
      0,
      [wx(driveX), 0.03, wz((driveN + plotD) / 2)],
      [m(driveW), 0.06, m(plotD - driveN + 200)],
    )
    if (entry) {
      const walkFromY = carport ? carport.rect.y : gy1
      push(
        'walk',
        'paving',
        0,
        [wx(entry.at.x), 0.035, wz((entry.at.y + walkFromY) / 2)],
        [1.4, 0.06, m(Math.abs(walkFromY - entry.at.y) + 400)],
      )
    }
  }

  // ---- compound wall with a gate opening on the approach side ----
  if (P.compoundWall) {
    const wallH = T.landscape.boundaryMm / 1000
    const t = 0.16
    const inset = 150
    const x0 = inset
    const x1 = plotW - inset
    const z0 = inset
    const z1 = plotD - inset
    const cy = wallH / 2
    push('cw-n', 'fence', 0, [wx(plotW / 2), cy, wz(z0)], [m(x1 - x0 + t), wallH, t])
    push('cw-e', 'fence', 0, [wx(x1), cy, wz(plotD / 2)], [t, wallH, m(z1 - z0)])
    push('cw-w', 'fence', 0, [wx(x0), cy, wz(plotD / 2)], [t, wallH, m(z1 - z0)])
    const gateHalf = 1900
    const gL1 = driveX - gateHalf
    const gR0 = driveX + gateHalf
    if (gL1 - x0 > 300) push('cw-sl', 'fence', 0, [wx((x0 + gL1) / 2), cy, wz(z1)], [m(gL1 - x0), wallH, t])
    if (x1 - gR0 > 300) push('cw-sr', 'fence', 0, [wx((gR0 + x1) / 2), cy, wz(z1)], [m(x1 - gR0), wallH, t])
    const gpH = wallH + 0.35
    push('gp-l', 'fence', 0, [wx(gL1), gpH / 2, wz(z1)], [0.3, gpH, 0.3])
    push('gp-r', 'fence', 0, [wx(gR0), gpH / 2, wz(z1)], [0.3, gpH, 0.3])

    // ---- coping course along the top of every run ----
    const cop = 0.09
    const copY = wallH + cop / 2
    push('cw-cop-n', 'fence', 0, [wx(plotW / 2), copY, wz(z0)], [m(x1 - x0 + t) + 0.12, cop, t + 0.12])
    push('cw-cop-e', 'fence', 0, [wx(x1), copY, wz(plotD / 2)], [t + 0.12, cop, m(z1 - z0) + 0.12])
    push('cw-cop-w', 'fence', 0, [wx(x0), copY, wz(plotD / 2)], [t + 0.12, cop, m(z1 - z0) + 0.12])

    // ---- regular piers so the boundary reads as built, not a ribbon ----
    const pierH = wallH + 0.16
    const pierT = 0.32
    const piers = (from: number, to: number, fixed: number, vert: boolean, tag: string) => {
      const n = Math.max(2, Math.round(Math.abs(to - from) / 3600))
      for (let i = 0; i <= n; i++) {
        const p = from + ((to - from) * i) / n
        push(
          `cwp-${tag}${i}`,
          'fence',
          0,
          vert ? [wx(fixed), pierH / 2, wz(p)] : [wx(p), pierH / 2, wz(fixed)],
          [pierT, pierH, pierT],
        )
      }
    }
    piers(x0, x1, z0, false, 'n')
    piers(z0, z1, x0, true, 'w')
    piers(z0, z1, x1, true, 'e')
  }

  if (!P.garden) return

  // ---- front hedge along the approach setback, split around the drive ----
  if (T.landscape.hedgeMm > 0) {
    const hH = T.landscape.hedgeMm / 1000
    const hz = plotD - Math.max(sb.S * 0.45, 500)
    const gap = 2300
    for (const [a, b] of [
      [400, driveX - gap],
      [driveX + gap, plotW - 400],
    ]) {
      if (b - a < 700) continue
      push(`hedge-${Math.round(a)}`, 'hedge', 0, [wx((a + b) / 2), hH / 2, wz(hz)], [m(b - a), hH, 0.55])
    }
  }

  // ---- a few low shrub clumps near the entry walk and front corners ----
  const walkX = entry ? entry.at.x : driveX
  const shrubZ = clamp(gy1 + 900, gy1 + 600, plotD - 500)
  const spots = [
    { x: walkX - 1400, z: shrubZ },
    { x: walkX + 1400, z: shrubZ },
    { x: 700, z: plotD - 700 },
    { x: plotW - 700, z: plotD - 700 },
    { x: gx0 - 500, z: (gy0 + gy1) / 2 },
  ]
  for (let i = 0; i < Math.min(T.landscape.shrubs, spots.length); i++) {
    const s = spots[i]
    const r = m(700 + rnd() * 450)
    const h = m(600 + rnd() * 450)
    push(`shrub-${i}`, 'hedge', 0, [wx(s.x), h / 2, wz(s.z)], [r, h, r])
  }
}

/** planter boxes along the exposed edge of a stepped-back flat roof terrace */
function buildTerraceGarden(
  o: Rect,
  up: Rect,
  wallTop: number,
  L: number,
  push: Push,
  wx: XF,
  wz: XF,
  m: XF,
) {
  const deckTop = wallTop - SLAB_T - 0.01
  const plH = 0.42
  const put = (x: number, z: number, w: number, d: number, tag: string) => {
    if (w < 600 || d < 400) return
    push(`plnt-${L}-${tag}`, 'planter', L, [wx(x + w / 2), deckTop + plH / 2, wz(z + d / 2)], [m(w), plH, m(d)])
  }
  if (o.y + o.h - (up.y + up.h) > 900) put(o.x + 400, o.y + o.h - 750, o.w - 800, 700, 's')
  if (o.x + o.w - (up.x + up.w) > 900) put(o.x + o.w - 750, up.y + 300, 700, up.h - 600, 'e')
  if (up.x - o.x > 900) put(o.x + 300, up.y + 300, 700, up.h - 600, 'w')
}

/* ----------------------------------- stair ----------------------------------- */

/** dog-leg stair: two flights of SOLID steps + a mid landing + a spine wall.
 *  x/z in plan-millimetres; y and size in metres, y relative to the storey base. */
/**
 * A dog-leg stair in its core rect. `startSide` is the edge the first flight
 * leaves from (the landing on the spine); flights run away from it, turn at a
 * landing against the far wall and climb back — the same geometry the plan
 * draws, so 2D and 3D agree.
 */
function buildStair(rect: Rect, H: number, startSide: 'N' | 'S' | 'E' | 'W' = 'N') {
  const alongY = startSide === 'N' || startSide === 'S'
  const W = alongY ? rect.w : rect.h // across the flights
  const R = alongY ? rect.h : rect.w // along the run
  const at = (a: number, b: number) =>
    startSide === 'N' ? { x: rect.x + a, z: rect.y + b }
      : startSide === 'S' ? { x: rect.x + a, z: rect.y + rect.h - b }
        : startSide === 'W' ? { x: rect.x + b, z: rect.y + a }
          : { x: rect.x + rect.w - b, z: rect.y + a }
  const size = (sa: number, sy: number, sb: number): Vec3 => (alongY ? [sa, sy, sb] : [sb, sy, sa])

  const risers = Math.max(14, Math.round((H * 1000) / 172))
  const perFlight = Math.ceil(risers / 2)
  const flightWmm = Math.max((W - 120) / 2, 300)
  const flightW = flightWmm / 1000
  const runMm = R * 0.84
  const goingMm = runMm / perFlight
  const going = goingMm / 1000
  const rise = H / risers
  const landY = perFlight * rise
  const out: { tag: string; x: number; y: number; z: number; size: Vec3 }[] = []

  const aA = 60 + flightWmm / 2
  const aB = 60 + flightWmm + 120 + flightWmm / 2

  for (let i = 0; i < perFlight; i++) {
    const topA = (i + 1) * rise // solid block: floor of storey up to this tread
    out.push({ tag: `a${i}`, ...at(aA, goingMm * (i + 0.5)), y: topA / 2, size: size(flightW, topA, Math.max(going * 1.02, 0.05)) })
    const topB = landY + (i + 1) * rise // second flight climbs off the landing
    out.push({ tag: `b${i}`, ...at(aB, runMm - goingMm * (i + 0.5)), y: topB / 2, size: size(flightW, topB, Math.max(going * 1.02, 0.05)) })
  }

  // mid landing slab
  const landDepth = Math.max((R - runMm) / 1000, 0.6)
  out.push({ tag: 'land', ...at(W / 2, runMm + (landDepth * 1000) / 2), y: landY - 0.09, size: size(Math.max(W / 1000, 0.4), 0.18, landDepth) })
  // a spine wall between the two flights
  out.push({ tag: 'spine', ...at((aA + aB) / 2, runMm / 2), y: H / 2, size: size(0.12, H, Math.max(runMm / 1000, 0.4)) })
  return out
}
