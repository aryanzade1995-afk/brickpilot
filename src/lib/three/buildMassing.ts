import type { Design, FloorPlan, Opening } from '../engine/types.ts'
import type { Rect } from '../geometry.ts'
import type { CanonicalModel } from '../model/canonical.ts'
import { themeOf, type RailStyle, type ThemeDef } from '../model/themes.ts'
import { ARTICULATION } from '../../architecture/dims.ts'
import type {
  ChajjaSpec,
  DesignSpec,
  FinBankSpec,
  FloorArticulation,
  ParapetSpec,
  SlabEdgeSpec,
  SlatScreenSpec,
} from '../../architecture/types.ts'

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
  /* ---- articulation: the geometry that gives the facade depth ---- */
  /** plastered jamb / head returns lining an opening */
  | 'reveal'
  /** projecting weathered window sill */
  | 'sill'
  /** aluminium master frame + sash + mullions */
  | 'winframe'
  /** cantilevered weather hood over an opening */
  | 'chajja'
  /** vertical brise-soleil */
  | 'fin'
  /** exposed floor-plate edge + drip */
  | 'fascia'
  /** projecting parapet cap stone */
  | 'coping'
  /** timber batten / jaali slat */
  | 'louver'

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
const PANE_SHRINK = 0.006 // pane a hair smaller than the void — avoids an exact coincident plane
const CANOPY_TOP = 2.75 // carport canopy top, metres above FFL
const CANOPY_T = 0.26
const COL = 0.3 // square column
const HT_MM = (EXT_T * 1000) / 2 // exterior half-thickness, mm

const BAND: Record<Opening['kind'], { sill: number; head: number }> = {
  window: { sill: 0.85, head: 2.2 },
  door: { sill: 0, head: 2.3 },
  entry: { sill: 0, head: 2.5 },
}

/* ---- articulation: the facade-depth numbers, in METRES ---------------------
 * Sourced from the DesignSpec when the architectural pass resolved one, else
 * from `dims.ARTICULATION` directly — so the study model articulates the same
 * whether or not a spec is available. One reveal depth and one plate
 * projection per building; never a per-window roll. */
type Art = {
  jamb: number
  head: number
  sillProj: number
  sillThick: number
  sillEar: number
  sillDrip: number
  frame: number
  sash: number
  glass: number
  sashSetback: number
  mullionSpacing: number
  plinthProj: number
  plinthBand: number
  /** the resolved per-storey elements, or null when no spec was supplied */
  floor: (level: number) => FloorArticulation | null
}

function makeArt(spec: DesignSpec | null | undefined, T: ThemeDef): Art {
  const A = ARTICULATION
  const r = spec?.articulation.defaultReveal
  const pl = spec?.articulation.plinth
  return {
    jamb: (r?.jambMm ?? (A.reveal.jambMm[0] + A.reveal.jambMm[1]) / 2) / 1000,
    head: (r?.headMm ?? (A.reveal.jambMm[0] + A.reveal.jambMm[1]) / 2 + A.reveal.headExtraMm) / 1000,
    sillProj: (r?.sillProjMm ?? A.sill.projMm) / 1000,
    sillThick: (r?.sillThickMm ?? A.sill.thickMm) / 1000,
    sillEar: (r?.sillEarMm ?? A.sill.earMm) / 1000,
    sillDrip: A.sill.dripMm / 1000,
    frame: (r?.frameMm ?? A.frame.masterMm) / 1000,
    sash: (r?.sashMm ?? A.frame.sashMm) / 1000,
    glass: (r?.glassMm ?? A.frame.glassMm) / 1000,
    sashSetback: A.frame.sashSetbackMm / 1000,
    mullionSpacing: A.frame.mullionSpacingMm / 1000,
    // the theme still owns the plinth projection — it is a style call, and the
    // spec agrees with it to within a few mm
    plinthProj: (pl?.projMm ?? T.massing.plinthProjMm) / 1000,
    plinthBand: (pl?.bandMm ?? A.plinth.bandMm) / 1000,
    floor: (level: number) => spec?.floors.find((f) => f.level === level)?.articulation ?? null,
  }
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

/**
 * @param spec  the resolved architectural DesignSpec, when the architecture pass
 *              produced one. It drives the facade articulation — reveals, sills,
 *              chhajjas, fins, screens, plate edges, parapet coping. Omit it and
 *              the builder falls back to `dims.ARTICULATION` defaults, so the
 *              study model is never worse than it was.
 */
export function buildMassing(design: Design, spec?: DesignSpec | null): Massing {
  const { model } = design
  const T = themeOf(model.brief)
  const art = makeArt(spec, T)
  const plotW = model.plot.width
  const plotD = model.plot.depth
  const H = model.brief.levels.floorToFloor
  const y0 = PLINTH_H
  const plinthProj = art.plinthProj
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
  push(
    'plinth',
    'plinth',
    0,
    [wx(g.x + g.w / 2), PLINTH_H / 2, wz(g.y + g.h / 2)],
    [m(g.w) + EXT_T + 2 * plinthProj, PLINTH_H, m(g.h) + EXT_T + 2 * plinthProj],
  )

  for (const floor of floors) {
    const L = floor.level
    const baseY = y0 + L * H
    const wallTop = baseY + H
    const blocks = blocksOf(floor)
    const above = floors.find((f) => f.level === L + 1)

    // ---- classify openings onto facades once for the whole storey ----
    const oFull = floor.outline
    const face: Record<Side, FaceOp[]> = { N: [], S: [], E: [], W: [] }
    const interiorOps: Opening[] = []
    const TOL = 450
    for (const op of floor.openings) {
      const band = op.kind === 'window' ? winBand : BAND[op.kind]
      const rec = { width: op.width, sill: band.sill, head: band.head }
      let placed = false
      if (op.orient === 'h') {
        if (Math.abs(op.at.y - oFull.y) < TOL) {
          face.N.push({ at: op.at.x, ...rec })
          placed = true
        } else if (Math.abs(op.at.y - (oFull.y + oFull.h)) < TOL) {
          face.S.push({ at: op.at.x, ...rec })
          placed = true
        }
      } else if (Math.abs(op.at.x - oFull.x) < TOL) {
        face.W.push({ at: op.at.y, ...rec })
        placed = true
      } else if (Math.abs(op.at.x - (oFull.x + oFull.w)) < TOL) {
        face.E.push({ at: op.at.y, ...rec })
        placed = true
      }
      if (!placed) interiorOps.push(op)
    }
    const gm = T.windows.groupMm
    const fa = art.floor(L)
    // when the architectural pass resolved hoods for this storey it owns them —
    // the theme fallback would otherwise double them up
    const cj = fa && fa.chajjas.length ? 0 : T.massing.chajjaMm

    // openings that fall on a given block's edge (so a facade plane only gets
    // the voids that actually pierce it)
    const opsOnEdge = (b: Rect, side: Side): FaceOp[] => {
      const src = face[side]
      return src.filter((f) =>
        side === 'N' || side === 'S'
          ? Math.abs((side === 'N' ? b.y : b.y + b.h) - (side === 'N' ? oFull.y : oFull.y + oFull.h)) < TOL &&
            f.at >= b.x - 60 &&
            f.at <= b.x + b.w + 60
          : Math.abs((side === 'W' ? b.x : b.x + b.w) - (side === 'W' ? oFull.x : oFull.x + oFull.w)) < TOL &&
            f.at >= b.y - 60 &&
            f.at <= b.y + b.h + 60,
      )
    }

    blocks.forEach((o, bi) => {
      const ox0 = o.x
      const ox1 = o.x + o.w
      const oy0 = o.y
      const oy1 = o.y + o.h
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

      // ---- one segmented solid plane per facade ----
      addWall('W', oy0, oy1, ox0, baseY, wallTop, opsOnEdge(o, 'W'), L, gm, cj, `w${bid}W`, art, push, wx, wz, m)
      addWall('E', oy0, oy1, ox1, baseY, wallTop, opsOnEdge(o, 'E'), L, gm, cj, `w${bid}E`, art, push, wx, wz, m)
      addWall('N', ox0 + HT_MM, ox1 - HT_MM, oy0, baseY, wallTop, opsOnEdge(o, 'N'), L, gm, cj, `w${bid}N`, art, push, wx, wz, m)
      addWall('S', ox0 + HT_MM, ox1 - HT_MM, oy1, baseY, wallTop, opsOnEdge(o, 'S'), L, gm, cj, `w${bid}S`, art, push, wx, wz, m)

      // The articulation pass expresses the floor line as a real projecting
      // plate with a fascia and a drip. That IS the string course — drawing the
      // theme's band as well stacks three horizontals on one floor line.
      const artPlate = !!fa && fa.slabEdges.length > 0 && L >= 1
      if (T.massing.stringCourseMm > 0 && L >= 1 && !artPlate) {
        stringCourse(o, baseY, L, T.massing.stringCourseMm / 1000, push, wx, wz, m)
      }
      if (T.accents.cladFacade) {
        buildCladding(o, opsOnEdge(o, 'S'), baseY, wallTop, L, T.accents.cladWidthMm, push, wx, wz, m)
      }
      // likewise the apron — the plate edge already reads as the overhang
      if (T.modern && L >= 1 && T.modern.cantileverMm > 0 && !artPlate) {
        cantileverApron(o, baseY, L, T.modern.cantileverMm / 1000, push, wx, wz, m)
      }
      if (T.modern?.baffleScreen) {
        baffleScreen(o, opsOnEdge(o, 'S'), baseY, wallTop, L, push, wx, wz, m)
      }

      // ---- roof: a pitched cap where the storey is the last over this block
      // (top floor, or a lower wing with nothing standing on it); a flat
      // terrace where a floor above steps back off it ----
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
          push,
          wx,
          wz,
          m,
        )
      } else if (exposed && L !== topLevel && T.roofBias !== 'flat') {
        // a lower wing of a pitched-roof style still gets a small pitched cap
        buildPitchedRoof(o, wallTop, L, 'hip', T.roof.pitchDeg, T, push, wx, wz, m)
      } else if (L === topLevel) {
        buildRoof(o, wallTop, L, T, push, wx, wz, m, !!fa && fa.parapets.length > 0)
      } else if (cover) {
        buildTerrace(o, cover, wallTop, L, T, push, wx, wz, m)
      }
    })

    // ---- ARTICULATION: the facade depth the architectural pass resolved ----
    // Emitted once per storey, not per block: every rect is already in absolute
    // plot coordinates, so it never has to be matched back to a viewer block.
    if (fa) {
      for (const c of fa.chajjas) emitChajja(c, baseY, push, wx, wz, m)
      for (const f of fa.fins) emitFins(f, baseY, push, wx, wz, m)
      for (const sc of fa.screens) emitScreen(sc, baseY, push, wx, wz, m)
      // the ground plate sits on the plinth and has no edge to express
      if (L > 0) for (const se of fa.slabEdges) emitSlabEdge(se, baseY, push, wx, wz, m)
      for (const pa of fa.parapets) emitParapet(pa, wallTop, push, wx, wz, m)
    }

    const o = oFull

    // ---- interior partitions — own group, hidden until exploded ----
    for (let i = 0; i < floor.walls.length; i++) {
      const w = floor.walls[i]
      if (w.kind !== 'interior') continue
      segmentPartition(w, interiorOps, baseY, H, L, `p${L}-${i}`, push, wx, wz, m)
    }

    // ---- outdoor rooms ----
    const covers = floor.rooms.filter((r) => r.outdoor && !r.id.startsWith('balcony'))
    for (const r of floor.rooms) {
      if (r.outdoor && r.id.startsWith('balcony'))
        buildBalcony(
          r.rect,
          baseY,
          L,
          T.massing.balconyDepthMm / 1000,
          T.accents.railStyle,
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
        push,
        wx,
        wz,
        m,
      )
    }

    // ---- entry threshold: a colonnaded verandah, a double-height glazed
    // portal, or a simple portico — whichever the style calls for ----
    if (L === 0) {
      const entry = floor.openings.find((op) => op.kind === 'entry')
      if (T.verandah) {
        buildVerandah(oFull, entry, floor.courtyard ?? null, y0, H, T, push, wx, wz, m)
      } else if (T.doubleHeightEntry && entry && topLevel >= 1) {
        buildDoubleHeightEntry(entry, y0, H, push, wx, wz, m)
      } else if (entry) {
        buildPorch(entry, y0, H, push, wx, wz, m)
      }
    }

    // ---- stair — only the flights that actually go up to a floor above ----
    if (floor.stair && L < topLevel) {
      for (const s of buildStair(floor.stair.rect, H)) {
        push(`stair-${L}-${s.tag}`, 'stair', L, [wx(s.x), baseY + s.y, wz(s.z)], s.size)
      }
    }

    // ---- terrace garden on the flat roof where a lower floor steps out ----
    if (T.landscape.terraceGarden && L < topLevel) {
      const up = floors.find((f) => f.level === L + 1)
      if (up) buildTerraceGarden(o, up.outline, wallTop, L, push, wx, wz, m)
    }
  }

  // ---- dark riven-stone feature pier framing the entrance ----
  if (T.accents.featureColumn) {
    const entry = floors[0].openings.find((op) => op.kind === 'entry')
    if (entry) {
      const w = 660
      const gap = 260
      // hard against the door, offset toward the building centre so the upper
      // storeys sit behind it instead of leaving a lone stick at the corner
      const toCentre = entry.at.x <= g.x + g.w / 2 ? 1 : -1
      const px = clamp(
        entry.at.x + toCentre * (entry.width / 2 + gap + w / 2),
        g.x + 500,
        g.x + g.w - 500,
      )
      // rise only through the storeys whose plan actually covers this x
      let reached = 1
      for (const f of floors) {
        if (px >= f.outline.x - 60 && px <= f.outline.x + f.outline.w + 60) reached = f.level + 1
        else break
      }
      const rise = clamp(reached, Math.min(2, floors.length), floors.length)
      const pz = wz(g.y + g.h) + EXT_T / 2 + 0.07

      if (T.modern?.featureTower) {
        // a slender stair/feature tower rising ~1.9 m above the top roofline,
        // its street face wrapped in vertical baffle fins
        const tw = 1500 // mm
        const td = 0.9 // m, depth
        const top = y0 + floors.length * H + 1.9
        const twx = wx(px)
        push('feat-tower', 'feature', 0, [twx, top / 2, pz], [m(tw), top, td])
        push('feat-tower-cap', 'roof', 0, [twx, top + 0.06, pz], [m(tw) + 0.28, 0.12, td + 0.28])
        // vertical fins on the south (street) face
        const finZ = pz + td / 2 + 0.08
        const finBot = y0 + 1.6
        const finH = top - finBot - 0.25
        const fins = Math.max(5, Math.round(tw / 210))
        for (let i = 0; i <= fins; i++) {
          const fx = wx(px - tw / 2 + (tw * i) / fins)
          push(`feat-tower-fin${i}`, 'screen', 0, [fx, finBot + finH / 2, finZ], [0.045, finH, 0.14])
        }
      } else {
        const total = rise * H + 0.14
        push('feat-pier', 'feature', 0, [wx(px), y0 + total / 2, pz], [m(w), total, 0.24])
        push('feat-pier-cap', 'roof', 0, [wx(px), y0 + total + 0.05, pz], [m(w) + 0.1, 0.1, 0.32])
      }
    }
  }

  // ---- perforated timber jaali over the entrance ----
  if (T.accents.jaali) {
    const entry = floors[0].openings.find((op) => op.kind === 'entry')
    if (entry) jaaliScreen(entry, g, floors, y0, H, push, wx, wz)
  }

  // ---- roof services: stair mumty + water tank on the top terrace ----
  if (T.landscape.roofServices) {
    const tf = floors[floors.length - 1]
    roofServices(tf, y0 + tf.level * H + H, push, wx, wz, m)
  }

  // ---- a slatted pergola + planting over part of the top terrace ----
  if (T.modern?.roofPergola) {
    const tf = floors[floors.length - 1]
    roofPergola(tf.outline, y0 + tf.level * H + H - SLAB_T, push, wx, wz, m)
  }

  buildLandscape(model, floors[0], T, push, wx, wz, m)

  const storeys = floors.length
  return {
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
  tag: string,
  art: Art,
  push: Push,
  wx: XF,
  wz: XF,
  m: XF,
) {
  const horizontal = side === 'N' || side === 'S'
  const outward = side === 'S' || side === 'E' ? 1 : -1
  if (a1 - a0 < 120) return

  /** a box spanning `from`..`to` along the wall, `yb`..`yt` high, at the wall plane */
  const solid = (from: number, to: number, yb: number, yt: number, sub: string) => {
    const len = m(to - from)
    const h = yt - yb
    if (len <= 0.04 || h <= 0.04) return
    const mid = (from + to) / 2
    const px = horizontal ? wx(mid) : wx(fixed)
    const pz = horizontal ? wz(fixed) : wz(mid)
    push(`${tag}-${sub}`, 'wall', level, [px, (yb + yt) / 2, pz], horizontal ? [len, h, EXT_T] : [EXT_T, h, len])
  }

  /**
   * A box sitting at a given DEPTH through the wall. `d0`/`d1` are measured
   * inward from the outer wall face, so 0 is flush outside and EXT_T is flush
   * inside. This is what makes a reveal readable: every part of the opening
   * assembly knows exactly how far back it sits.
   */
  const atDepth = (
    from: number,
    to: number,
    yb: number,
    yt: number,
    d0: number,
    d1: number,
    kind: MassKind,
    sub: string,
  ) => {
    const len = m(to - from)
    const h = yt - yb
    const th = d1 - d0
    if (len <= 0.012 || h <= 0.012 || th <= 0.004) return
    const mid = (from + to) / 2
    const faceMm = fixed + outward * (EXT_T * 500)
    const cMm = faceMm - outward * ((d0 + d1) / 2) * 1000
    const px = horizontal ? wx(mid) : wx(cMm)
    const pz = horizontal ? wz(cMm) : wz(mid)
    push(`${tag}-${sub}`, kind, level, [px, (yb + yt) / 2, pz], horizontal ? [len, h, th] : [th, h, len])
  }

  /** a box PROJECTING out past the wall face — sills, hoods, drips */
  const proud = (
    from: number,
    to: number,
    yb: number,
    yt: number,
    p0: number,
    p1: number,
    kind: MassKind,
    sub: string,
  ) => {
    const len = m(to - from)
    const h = yt - yb
    const th = p1 - p0
    if (len <= 0.012 || h <= 0.004 || th <= 0.004) return
    const mid = (from + to) / 2
    const faceMm = fixed + outward * (EXT_T * 500)
    const cMm = faceMm + outward * ((p0 + p1) / 2) * 1000
    const px = horizontal ? wx(mid) : wx(cMm)
    const pz = horizontal ? wz(cMm) : wz(mid)
    push(`${tag}-${sub}`, kind, level, [px, (yb + yt) / 2, pz], horizontal ? [len, h, th] : [th, h, len])
  }

  const clean = ops
    .map((o) => ({ s: o.at - o.width / 2, e: o.at + o.width / 2, sill: o.sill, head: o.head }))
    .filter((o) => o.e > a0 + 150 && o.s < a1 - 150)
    .sort((p, q) => p.s - q.s)

  let cursor = a0
  clean.forEach((o, i) => {
    // keep the opening exactly where the plan grid put it (so stacked storeys
    // line up); shrink it symmetrically if it grazes the wall end, and skip it
    // if it can't fit or overlaps the previous pier
    let s = o.s
    let e = o.e
    const lo = a0 + 110
    const hi = a1 - 110
    if (s < lo) {
      const d = lo - s
      s += d
      e -= d
    }
    if (e > hi) {
      const d = e - hi
      e -= d
      s += d
    }
    if (e - s < 400 || s < cursor + 80) return
    const sillY = baseY + o.sill
    const headY = Math.min(baseY + o.head, wallTop - 0.08)
    solid(cursor, s, baseY, wallTop, `p${i}`) // pier
    if (sillY - baseY > 0.08) solid(s, e, baseY, sillY, `sp${i}`) // spandrel under a window
    if (wallTop - headY > 0.08) solid(s, e, headY, wallTop, `hd${i}`) // header

    const isWindow = o.head - o.sill < 2.0 // doors / entries keep an open reveal
    // a reveal has to stay inside the wall it is cut through
    const jamb = Math.min(art.jamb, EXT_T - 0.03)
    const head = Math.min(art.head, EXT_T - 0.02)
    const jambMm = jamb * 1000
    const wMm = e - s

    // ---- 1. reveal returns: the lining that makes a jamb catch light -------
    // Without these an opening reads as a black rectangle painted on a flat
    // plane; with them you see the wall's real thickness at every edge.
    atDepth(s, s + jambMm, sillY, headY, 0, jamb, 'reveal', `rvL${i}`)
    atDepth(e - jambMm, e, sillY, headY, 0, jamb, 'reveal', `rvR${i}`)
    atDepth(s, e, headY - 0.001, headY + Math.min(head, 0.09), 0, head, 'reveal', `rvH${i}`)

    // ---- 2. sill: a projecting weathered nose, windows only ---------------
    if (isWindow && art.sillProj > 0.005) {
      const ear = art.sillEar * 1000
      const s0 = Math.max(a0 + 20, s - ear)
      const e0 = Math.min(a1 - 20, e + ear)
      proud(s0, e0, sillY - art.sillThick, sillY, -jamb, art.sillProj, 'sill', `sl${i}`)
      // a down-turned drip, so water leaves the wall instead of staining it
      proud(s0, e0, sillY - art.sillThick - art.sillDrip, sillY - art.sillThick, art.sillProj - 0.02, art.sillProj, 'sill', `sld${i}`)
    }

    // ---- 3. glazing assembly: master frame -> sash -> glass, each at depth --
    const glassDepth = jamb
    const frameFront = Math.max(0.01, glassDepth - art.frame)
    const pl = m(wMm)
    const ph = headY - sillY
    if (pl > 0.1 && ph > 0.1) {
      const paneFixed = fixed + outward * (HT_MM - (glassDepth + art.glass / 2) * 1000)
      const pmid = (s + e) / 2
      const ppx = horizontal ? wx(pmid) : wx(paneFixed)
      const ppz = horizontal ? wz(paneFixed) : wz(pmid)
      push(
        `${tag}-gl${i}`,
        'glass',
        level,
        [ppx, (sillY + headY) / 2, ppz],
        horizontal
          ? [pl - 2 * PANE_SHRINK, ph - 2 * PANE_SHRINK, art.glass]
          : [art.glass, ph - 2 * PANE_SHRINK, pl - 2 * PANE_SHRINK],
      )

      if (isWindow) {
        const fMm = art.frame * 1000
        const sMm = art.sash * 1000
        // 3a. master frame — the outer ring fixed into the reveal
        atDepth(s, s + fMm, sillY, headY, frameFront, glassDepth, 'winframe', `mfL${i}`)
        atDepth(e - fMm, e, sillY, headY, frameFront, glassDepth, 'winframe', `mfR${i}`)
        atDepth(s, e, sillY, sillY + art.frame, frameFront, glassDepth, 'winframe', `mfB${i}`)
        atDepth(s, e, headY - art.frame, headY, frameFront, glassDepth, 'winframe', `mfT${i}`)
        // 3b. sash — the opening leaf, set back inside the master
        const sashFront = frameFront + art.sashSetback
        const si0 = s + fMm
        const si1 = e - fMm
        const sy0 = sillY + art.frame
        const sy1 = headY - art.frame
        if (si1 - si0 > 200 && sy1 - sy0 > 0.2) {
          atDepth(si0, si0 + sMm, sy0, sy1, sashFront, glassDepth, 'winframe', `sL${i}`)
          atDepth(si1 - sMm, si1, sy0, sy1, sashFront, glassDepth, 'winframe', `sR${i}`)
          atDepth(si0, si1, sy0, sy0 + art.sash, sashFront, glassDepth, 'winframe', `sB${i}`)
          atDepth(si0, si1, sy1 - art.sash, sy1, sashFront, glassDepth, 'winframe', `sT${i}`)
          // 3c. sash mullions — a wide slider reads divided, not as one sheet
          const spanM = m(si1 - si0)
          const bays = Math.max(1, Math.round(spanM / Math.max(0.6, Math.min(art.mullionSpacing, groupMm / 1000))))
          for (let k = 1; k < bays; k++) {
            const c = si0 + ((si1 - si0) * k) / bays
            atDepth(c - sMm / 2, c + sMm / 2, sy0, sy1, sashFront, glassDepth, 'winframe', `mu${i}_${k}`)
          }
        }

        // ---- 4. chhajja — the theme fallback, when no spec resolved one ----
        if (chajjaMm > 200 && headY + 0.2 < wallTop) {
          const projM = chajjaMm / 1000
          const earMm = 170
          const cy = headY + 0.055
          proud(s - earMm, e + earMm, cy, cy + 0.09, -EXT_T / 2, projM, 'chajja', `cj${i}`)
          proud(s - earMm, e + earMm, cy - 0.055, cy + 0.09, projM - 0.05, projM, 'chajja', `cjd${i}`)
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
      return { s: c - d.width / 2, e: c + d.width / 2 }
    })
    .filter((d) => d.e > p0 && d.s < p1)
    .sort((a, b) => a.s - b.s)

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
    const pt = 0.02
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

function buildRoof(
  o: Rect,
  wallTop: number,
  L: number,
  T: ThemeDef,
  push: Push,
  wx: XF,
  wz: XF,
  m: XF,
  /** the articulation pass already put a real parapet + coping here */
  hasArtParapet = false,
) {
  const cxw = wx(o.x + o.w / 2)
  const czw = wz(o.y + o.h / 2)
  const roofT = T.roof.thickMm / 1000
  const eave = T.roof.eaveMm / 1000
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
  // a real parapet supersedes the steel rail — you do not get both
  if (!hasArtParapet) {
    guardRail(gx0, gz0, gx1, gz0, wallTop, L, `groof-${L}-n`, push, wx, wz, m, gr)
    guardRail(gx0, gz1, gx1, gz1, wallTop, L, `groof-${L}-s`, push, wx, wz, m, gr)
    guardRail(gx0, gz0, gx0, gz1, wallTop, L, `groof-${L}-w`, push, wx, wz, m, gr)
    guardRail(gx1, gz0, gx1, gz1, wallTop, L, `groof-${L}-e`, push, wx, wz, m, gr)
  }

  // ---- flat-band: the signature bold white fascia beam wrapping the slab ----
  if (T.roof.style === 'flat-band') {
    const band = T.roof.bandMm / 1000
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

  const parH = hasArtParapet ? 0 : T.roof.parapetMm / 1000
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
  push: Push,
  wx: XF,
  wz: XF,
  m: XF,
) {
  const eave = Math.max(T.roof.eaveMm, 500) / 1000
  const wallW = m(o.w) + EXT_T
  const wallD = m(o.h) + EXT_T
  const rw = wallW + 2 * eave
  const rd = wallD + 2 * eave
  const cxw = wx(o.x + o.w / 2)
  const czw = wz(o.y + o.h / 2)
  // ridge runs along the longer plan axis
  const ridge: 'x' | 'z' = o.w >= o.h ? 'x' : 'z'
  const span = (ridge === 'x' ? rd : rw) / 2
  const rise = Math.min(span * Math.tan((pitchDeg * Math.PI) / 180), 3.4)
  const fasciaT = T.roof.thickMm / 1000

  // thin eave fascia sitting on top of the wall, all round
  push(`eave-${L}-n`, 'roof', L, [cxw, wallTop + fasciaT / 2, wz(o.y) - EXT_T / 2 - eave + 0.06], [rw, fasciaT, 0.12])
  push(`eave-${L}-s`, 'roof', L, [cxw, wallTop + fasciaT / 2, wz(o.y + o.h) + EXT_T / 2 + eave - 0.06], [rw, fasciaT, 0.12])
  push(`eave-${L}-w`, 'roof', L, [wx(o.x) - EXT_T / 2 - eave + 0.06, wallTop + fasciaT / 2, czw], [0.12, fasciaT, rd])
  push(`eave-${L}-e`, 'roof', L, [wx(o.x + o.w) + EXT_T / 2 + eave - 0.06, wallTop + fasciaT / 2, czw], [0.12, fasciaT, rd])

  const form = kind === 'mono-slope' ? 'mono' : kind === 'gable' ? 'gable' : 'hip'
  const low = form === 'mono' ? (ridge === 'x' ? 'z-' : 'x-') : undefined
  push(
    `pitch-${L}`,
    'prism',
    L,
    [cxw, wallTop + fasciaT + rise / 2, czw],
    [rw, rise, rd],
    { form, ridge, low },
  )
}

/** a vertical timber-batten cladding panel on the entry (plan-south) facade,
 *  framed in a slim white L, positioned clear of the door and windows */
function buildCladding(
  o: Rect,
  southOps: FaceOp[],
  baseY: number,
  wallTop: number,
  L: number,
  widthMm: number,
  push: Push,
  wx: XF,
  wz: XF,
  m: XF,
) {
  const a0 = o.x + HT_MM
  const a1 = o.x + o.w - HT_MM
  if (a1 - a0 < widthMm + 800) return
  // widest clear stretch on the south face, away from any opening
  const blocked = southOps
    .map((op) => ({ s: op.at - op.width / 2 - 400, e: op.at + op.width / 2 + 400 }))
    .sort((p, q) => p.s - q.s)
  let best = { s: a0, e: a0, len: 0 }
  let cur = a0
  for (const b of [...blocked, { s: a1, e: a1 }]) {
    if (b.s - cur > best.len) best = { s: cur, e: b.s, len: b.s - cur }
    cur = Math.max(cur, b.e)
  }
  if (best.len < widthMm) return
  const cw = Math.min(widthMm, best.len - 200)
  const cx = best.s + (best.len - cw) / 2 + cw / 2
  const z = wz(o.y + o.h) + EXT_T / 2 + 0.02
  const h = wallTop - baseY - 0.12
  push(`clad-${L}`, 'clad', L, [wx(cx), baseY + 0.06 + h / 2, z], [m(cw), h, 0.05])
  // slim white frame: top rail + two jambs
  const ft = 0.12
  push(`cladf-${L}-t`, 'roof', L, [wx(cx), baseY + 0.06 + h + ft / 2, z + 0.01], [m(cw) + 2 * ft, ft, 0.09])
  push(`cladf-${L}-l`, 'roof', L, [wx(cx - cw / 2) - ft / 2, baseY + 0.06 + h / 2, z + 0.01], [ft, h, 0.09])
  push(`cladf-${L}-r`, 'roof', L, [wx(cx + cw / 2) + ft / 2, baseY + 0.06 + h / 2, z + 0.01], [ft, h, 0.09])
}

/* ---------------------- contemporary-villa moves (modernist) ---------------------- */

/** an upper storey cantilevering over the recessed ground floor on the street
 *  (plan-south) side — a projecting floor apron + a shallow skirt below it.
 *  Massing only; the walls and windows stay on the plan. */
function cantileverApron(
  o: Rect,
  baseY: number,
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
  push(`cant-${L}`, 'band', L, [cxw, baseY - apronT / 2 + 0.12, southZ + projM / 2], [w, apronT, projM + 0.12])
  // shallow skirt hanging under the front edge so the cantilever reads as mass
  push(`cant-skirt-${L}`, 'band', L, [cxw, baseY - 0.42, southZ + projM - 0.06], [w, 0.78, 0.12])
}

/** vertical brise-soleil fins over the widest glazed opening on the street
 *  (plan-south) facade of a storey. */
function baffleScreen(
  o: Rect,
  southOps: FaceOp[],
  baseY: number,
  wallTop: number,
  L: number,
  push: Push,
  wx: XF,
  wz: XF,
  m: XF,
) {
  const w0 = southOps.filter((op) => op.head - op.sill > 1.2).sort((a, b) => b.width - a.width)[0]
  if (!w0 || w0.width < 900) return
  const sMm = w0.at - w0.width / 2 - 150
  const spanMm = w0.width + 300
  const z = wz(o.y + o.h) + EXT_T / 2 + 0.15
  const yb = baseY + Math.max(0.1, w0.sill - 0.25)
  const yt = Math.min(wallTop - 0.12, baseY + w0.head + 0.35)
  const h = yt - yb
  if (h < 1) return
  const n = Math.max(4, Math.round(spanMm / 260))
  for (let i = 0; i <= n; i++) {
    push(`baf-${L}-${i}`, 'screen', L, [wx(sMm + (spanMm * i) / n), yb + h / 2, z], [0.04, h, 0.16])
  }
  push(`baf-${L}-t`, 'screen', L, [wx(sMm + spanMm / 2), yt, z], [m(spanMm) + 0.08, 0.05, 0.16])
  push(`baf-${L}-b`, 'screen', L, [wx(sMm + spanMm / 2), yb, z], [m(spanMm) + 0.08, 0.05, 0.16])
}

/** a slatted pergola + a planter run over part of the top terrace */
function roofPergola(o: Rect, deckY: number, push: Push, wx: XF, wz: XF, m: XF) {
  const pw = Math.min(o.w * 0.55, 4400)
  const pd = Math.min(o.h * 0.45, 3800)
  if (pw < 2200 || pd < 1900) return
  const px = o.x + 400
  const pz0 = o.y + o.h - pd - 350 // drawn toward the street edge
  const top = deckY + 2.4
  for (const z of [pz0, pz0 + pd]) {
    push(`perg-b${Math.round(z)}`, 'shade', 0, [wx(px + pw / 2), top, wz(z)], [m(pw) + 0.2, 0.12, 0.1])
  }
  const n = Math.max(5, Math.round(pw / 430))
  for (let i = 0; i <= n; i++) {
    push(`perg-s${i}`, 'shade', 0, [wx(px + (pw * i) / n), top + 0.03, wz(pz0 + pd / 2)], [0.09, 0.07, m(pd) + 0.16])
  }
  for (const [cx, cz] of [
    [px, pz0],
    [px + pw, pz0],
    [px, pz0 + pd],
    [px + pw, pz0 + pd],
  ] as const) {
    push(`perg-p${Math.round(cx)}-${Math.round(cz)}`, 'railing', 0, [wx(cx), deckY + 1.2, wz(cz)], [0.09, 2.4, 0.09])
  }
  push('perg-plnt', 'planter', 0, [wx(px + pw / 2), deckY + 0.22, wz(pz0 - 250)], [m(pw), 0.44, 0.7])
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

  push(`can-${L}-${id}`, 'canopy', L, [cxm, topY - CANOPY_T / 2, czm], [wM + 0.25, CANOPY_T, dM + 0.25])

  // a paved parking pad, a touch proud of the lawn, with a low kerb and
  // painted bay lines so it reads as a real parking space
  push(`cpad-${L}-${id}`, 'paving', L, [cxm, 0.05, czm], [wM + 0.3, 0.1, dM + 0.3])
  const bays = wM > 5 ? 2 : 1
  for (let i = 1; i < bays; i++) {
    const bx = wx(cW) + (wM / bays) * i
    push(`bay-${L}-${id}-${i}`, 'slab', L, [bx, 0.11, czm], [0.08, 0.02, dM * 0.9])
  }

  const colTop = y0 + CANOPY_TOP - CANOPY_T // canopy soffit
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
      const pt = 0.02
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
}

/** flat-roof entry portico — two columns, a downstand beam, tiered steps */
function buildPorch(entry: Opening, y0: number, H: number, push: Push, wx: XF, wz: XF, m: XF) {
  if (entry.orient !== 'h') return // only the plan-south entry gets the porch
  const cx = entry.at.x
  const zFace = entry.at.y
  const w = m(entry.width) + 1.9 // canopy width, metres
  const projMm = 2450 // how far the portico reaches out from the facade
  const topY = y0 + Math.min(BAND.entry.head + 0.55, H - 0.12)

  // two-tier threshold steps
  push('estep0', 'plinth', 0, [wx(cx), y0 - 0.02, wz(zFace + 520)], [w * 0.6, 0.16, 1.0])
  push('estep1', 'plinth', 0, [wx(cx), y0 - 0.12, wz(zFace + 940)], [w * 0.72, 0.16, 0.58])

  // thin flat canopy slab + a slim downstand edge beam + crisp outer lip
  push('eporch', 'canopy', 0, [wx(cx), topY - 0.08, wz(zFace + projMm / 2)], [w, 0.16, m(projMm)])
  push('eporch-beam', 'canopy', 0, [wx(cx), topY - 0.2, wz(zFace + projMm - 130)], [w, 0.18, 0.16])
  push('eporch-lip', 'roof', 0, [wx(cx), topY + 0.01, wz(zFace + projMm)], [w + 0.08, 0.12, 0.09])

  // two square columns at the outer corners — from the ground, on a base pad
  const colH = topY - 0.22
  const half = entry.width / 2 + 520
  const colZ = zFace + projMm - 320
  for (const s of [-1, 1] as const) {
    const px = cx + s * half
    push(`eporch-col${s < 0 ? 'l' : 'r'}`, 'column', 0, [wx(px), colH / 2, wz(colZ)], [0.26, colH, 0.26])
    push(`eporch-colbase${s < 0 ? 'l' : 'r'}`, 'plinth', 0, [wx(px), 0.07, wz(colZ)], [0.44, 0.14, 0.44])
  }
}

/**
 * A covered verandah / sit-out on a colonnade along the entry (plan-south)
 * facade of the ground floor — the recognisably-Indian shaded threshold. Skips
 * the bay over the entry door. `wrapCourt` extends a matching run along the
 * courtyard's near edge.
 */
function buildVerandah(
  g: Rect,
  entry: Opening | undefined,
  court: Rect | null,
  y0: number,
  H: number,
  T: ThemeDef,
  push: Push,
  wx: XF,
  wz: XF,
  m: XF,
) {
  const v = T.verandah
  if (!v) return
  const col = T.columns ?? { style: 'square' as const, sizeMm: 300 }
  const depth = Math.max(v.depthMm, 1500) / 1000
  const headY = y0 + Math.min(BAND.entry.head + 0.35, H - 0.2)
  const beamT = 0.22
  const colH = headY - beamT

  const colGeo = (px: number, pz: number, tag: string) => {
    const s = col.sizeMm / 1000
    if (col.style === 'round') {
      // an octagon-ish stack of thin boxes reads round enough at this scale
      push(`${tag}a`, 'column', 0, [wx(px), colH / 2, wz(pz)], [s, colH, s])
      push(`${tag}b`, 'column', 0, [wx(px), colH / 2, wz(pz)], [s * 0.72, colH, s * 1.18])
      push(`${tag}c`, 'column', 0, [wx(px), colH / 2, wz(pz)], [s * 1.18, colH, s * 0.72])
    } else if (col.style === 'tapered') {
      push(`${tag}base`, 'column', 0, [wx(px), colH * 0.12, wz(pz)], [s * 1.25, colH * 0.24, s * 1.25])
      push(`${tag}sh`, 'column', 0, [wx(px), colH * 0.56, wz(pz)], [s, colH * 0.64, s])
      push(`${tag}cap`, 'column', 0, [wx(px), colH - colH * 0.06, wz(pz)], [s * 1.3, colH * 0.12, s * 1.3])
    } else {
      push(`${tag}`, 'column', 0, [wx(px), colH / 2, wz(pz)], [s, colH, s])
    }
    push(`${tag}pad`, 'plinth', 0, [wx(px), 0.06, wz(pz)], [s * 1.5, 0.12, s * 1.5])
  }

  const run = (a: number, b: number, faceZ: number, dir: 1 | -1, key: string) => {
    const span = b - a
    if (span < 3200) return
    const zEdge = faceZ + dir * depth * 1000
    const cxw = wx((a + b) / 2)
    // deck at grade + flat canopy slab + edge beam
    push(`${key}-deck`, 'paving', 0, [cxw, y0 - 0.06, wz((faceZ + zEdge) / 2)], [m(span), 0.12, depth])
    push(`${key}-slab`, 'canopy', 0, [cxw, headY - 0.08, wz((faceZ + zEdge) / 2)], [m(span) + 0.2, 0.16, depth + 0.1])
    push(`${key}-beam`, 'canopy', 0, [cxw, headY - 0.24, wz(zEdge)], [m(span) + 0.2, beamT, 0.16])
    // columns, skipping the entry bay
    const n = Math.max(2, Math.round(span / 2900))
    const doorX = entry && entry.orient === 'h' ? entry.at.x : null
    for (let i = 0; i <= n; i++) {
      const px = a + (span * i) / n
      if (doorX != null && Math.abs(px - doorX) < entry!.width / 2 + 700) continue
      colGeo(px, zEdge - dir * (col.sizeMm / 2), `${key}-c${i}`)
    }
  }

  run(g.x + 300, g.x + g.w - 300, g.y + g.h, 1, 'ver-s')
  if (v.wrapCourt && court) {
    run(court.x + 200, court.x + court.w - 200, court.y + court.h, 1, 'ver-ct')
  }
}

/**
 * A two-storey glazed portal at the entrance: two feature piers rising through
 * the first floor, a tall recessed glass plane between them and a flat lintel
 * across the top. Reads as a double-height entry without voiding the slab.
 */
function buildDoubleHeightEntry(entry: Opening, y0: number, H: number, push: Push, wx: XF, wz: XF, m: XF) {
  if (entry.orient !== 'h') return
  const cx = entry.at.x
  const zFace = entry.at.y
  const portalW = m(entry.width) + 2.6
  const top = y0 + 2 * H - 0.15
  const pierW = 0.34
  const proj = 0.9 // how far the portal steps forward of the facade

  // threshold step
  push('dh-step', 'plinth', 0, [wx(cx), y0 - 0.05, wz(zFace + 420)], [portalW * 0.7, 0.16, 0.9])

  // two full-height piers
  for (const s of [-1, 1] as const) {
    const px = cx + s * (portalW / 2 - pierW / 2)
    push(`dh-pier${s < 0 ? 'l' : 'r'}`, 'feature', 0, [wx(px), top / 2, wz(zFace + proj / 2)], [pierW, top, proj + 0.3])
  }
  // recessed tall glass between the piers
  const gW = portalW - 2 * pierW - 0.1
  push('dh-glass', 'glass', 0, [wx(cx), y0 + (top - y0) / 2 + 0.1, wz(zFace + 0.16)], [gW, top - y0 - 0.4, 0.08])
  // slim mullions
  const mull = Math.max(1, Math.round(gW / 1.3))
  for (let i = 1; i < mull; i++) {
    push(`dh-mull${i}`, 'clad', 0, [wx(cx - gW / 2 + (gW * i) / mull), y0 + (top - y0) / 2 + 0.1, wz(zFace + 0.2)], [0.05, top - y0 - 0.5, 0.06])
  }
  // lintel beam + a slim projecting hood
  push('dh-lintel', 'feature', 0, [wx(cx), top + 0.12, wz(zFace + proj / 2)], [portalW, 0.36, proj + 0.3])
  push('dh-hood', 'roof', 0, [wx(cx), top + 0.02, wz(zFace + proj + 0.35)], [portalW + 0.2, 0.14, 0.7])
}

/** a stair mumty + a water tank on a stand, on the top terrace */
function roofServices(tf: FloorPlan, deckY: number, push: Push, wx: XF, wz: XF, m: XF) {
  const o = tf.outline

  // --- stair mumty: a small enclosed box giving terrace access ---
  const mw = Math.min(2200, o.w - 1100)
  const md = Math.min(2500, o.h - 1100)
  if (mw > 1400 && md > 1400) {
    const st = tf.stair?.rect
    const mx = st
      ? clamp(st.x + st.w / 2, o.x + mw / 2 + 300, o.x + o.w - mw / 2 - 300)
      : o.x + o.w - mw / 2 - 600
    const mz = st
      ? clamp(st.y + st.h / 2, o.y + md / 2 + 300, o.y + o.h - md / 2 - 300)
      : o.y + md / 2 + 600
    const mh = 2.35
    const wt = 0.12
    push('mumty-n', 'mumty', 0, [wx(mx), deckY + mh / 2, wz(mz - md / 2)], [m(mw), mh, wt])
    push('mumty-s', 'mumty', 0, [wx(mx), deckY + mh / 2, wz(mz + md / 2)], [m(mw), mh, wt])
    push('mumty-w', 'mumty', 0, [wx(mx - mw / 2), deckY + mh / 2, wz(mz)], [wt, mh, m(md)])
    push('mumty-e', 'mumty', 0, [wx(mx + mw / 2), deckY + mh / 2, wz(mz)], [wt, mh, m(md)])
    // a dark opening on the terrace-facing (south) side
    push('mumty-door', 'glass', 0, [wx(mx), deckY + 1.05, wz(mz + md / 2)], [Math.min(m(mw) - 0.6, 1.1), 2.0, 0.09])
    // flat cap + slim projecting lip
    push('mumty-roof', 'roof', 0, [wx(mx), deckY + mh + 0.06, wz(mz)], [m(mw) + 0.34, 0.12, m(md) + 0.34])
    push('mumty-lip', 'roof', 0, [wx(mx), deckY + mh + 0.16, wz(mz)], [m(mw) + 0.48, 0.06, m(md) + 0.48])
  }

  // --- square water tank on a slim frame, tucked to a rear corner ---
  const near = o.x + o.w - 720
  const nz = o.y + 720
  const legH = 0.85
  const tk = 0.9
  const th = 0.95
  const legs: [number, number][] = [
    [near - tk / 2 + 0.08, nz - tk / 2 + 0.08],
    [near + tk / 2 - 0.08, nz - tk / 2 + 0.08],
    [near - tk / 2 + 0.08, nz + tk / 2 - 0.08],
    [near + tk / 2 - 0.08, nz + tk / 2 - 0.08],
  ]
  legs.forEach(([lx, lz], i) => {
    push(`tank-leg${i}`, 'railing', 0, [wx(lx), deckY + legH / 2, wz(lz)], [0.07, legH, 0.07])
  })
  push('tank-frame', 'railing', 0, [wx(near), deckY + legH, wz(nz)], [tk + 0.12, 0.05, tk + 0.12])
  push('tank', 'tank', 0, [wx(near), deckY + legH + th / 2, wz(nz)], [tk, th, tk])
}

/** a perforated timber jaali rising over the entrance (stairwell light) */
function jaaliScreen(entry: Opening, g: Rect, floors: FloorPlan[], y0: number, H: number, push: Push, wx: XF, wz: XF) {
  if (entry.orient !== 'h') return
  const storeys = Math.min(2, floors.length)
  const yb = y0 + 3.0
  const yt = y0 + storeys * H - 0.35
  const h = yt - yb
  if (h < 1.2) return
  const w = 1.5
  const cx = clamp(entry.at.x, g.x + w / 2 + 300, g.x + g.w - w / 2 - 300)
  const z = wz(g.y + g.h) + EXT_T / 2 + 0.05
  const bar = 0.045
  push('jaali-t', 'screen', 0, [wx(cx), yt - bar, z], [w + 0.16, bar * 1.7, 0.11])
  push('jaali-b', 'screen', 0, [wx(cx), yb + bar, z], [w + 0.16, bar * 1.7, 0.11])
  push('jaali-l', 'screen', 0, [wx(cx - w / 2), yb + h / 2, z], [bar * 1.7, h, 0.11])
  push('jaali-r', 'screen', 0, [wx(cx + w / 2), yb + h / 2, z], [bar * 1.7, h, 0.11])
  const cols = Math.max(4, Math.round(w / 0.2))
  for (let i = 1; i < cols; i++) {
    push(`jaali-v${i}`, 'screen', 0, [wx(cx - w / 2 + (w * i) / cols), yb + h / 2, z], [bar, h, 0.08])
  }
  const rows = Math.max(4, Math.round(h / 0.24))
  for (let i = 1; i < rows; i++) {
    push(`jaali-h${i}`, 'screen', 0, [wx(cx), yb + (h * i) / rows, z], [w, bar, 0.08])
  }
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
function buildStair(rect: Rect, H: number) {
  const risers = Math.max(14, Math.round((H * 1000) / 172))
  const perFlight = Math.ceil(risers / 2)
  const flightWmm = Math.max((rect.w - 120) / 2, 300)
  const flightW = flightWmm / 1000
  const runMm = rect.h * 0.84
  const goingMm = runMm / perFlight
  const going = goingMm / 1000
  const rise = H / risers
  const landY = perFlight * rise
  const out: { tag: string; x: number; y: number; z: number; size: Vec3 }[] = []

  const xA = rect.x + 60 + flightWmm / 2
  const xB = rect.x + 60 + flightWmm + 120 + flightWmm / 2

  for (let i = 0; i < perFlight; i++) {
    const topA = (i + 1) * rise // solid block: floor of storey up to this tread
    out.push({
      tag: `a${i}`,
      x: xA,
      y: topA / 2,
      z: rect.y + goingMm * (i + 0.5),
      size: [flightW, topA, Math.max(going * 1.02, 0.05)],
    })
    const topB = landY + (i + 1) * rise // second flight climbs off the landing
    out.push({
      tag: `b${i}`,
      x: xB,
      y: topB / 2,
      z: rect.y + runMm - goingMm * (i + 0.5),
      size: [flightW, topB, Math.max(going * 1.02, 0.05)],
    })
  }

  // mid landing slab
  const landDepth = Math.max((rect.h - runMm) / 1000, 0.6)
  out.push({
    tag: 'land',
    x: rect.x + rect.w / 2,
    y: landY - 0.09,
    z: rect.y + runMm + (landDepth * 1000) / 2,
    size: [Math.max(rect.w / 1000, 0.4), 0.18, landDepth],
  })
  // a spine wall between the two flights
  out.push({
    tag: 'spine',
    x: (xA + xB) / 2,
    y: H / 2,
    z: rect.y + runMm / 2,
    size: [0.12, H, Math.max(runMm / 1000, 0.4)],
  })
  return out
}

/* ================================================================== *
 *  ARTICULATION EMITTERS
 *
 *  Each of these takes one resolved element from `DesignSpec.floors[].
 *  articulation` — already in the plot frame, in mm — and turns it into
 *  boxes. The resolver decided *how far* everything projects; these only
 *  decide how to draw it. Blender's `generator/articulation.py` reads the
 *  same specs and builds the same shapes, so the study model and the baked
 *  GLB never disagree.
 *
 *  Convention: every articulation rect is already positioned OUTSIDE the
 *  wall face, so there is no "which way is out" arithmetic here.
 * ================================================================== */

/** a box from a plot-frame rect extruded between two world heights */
function fromRect(
  id: string,
  kind: MassKind,
  level: number,
  r: Rect,
  y0: number,
  y1: number,
  push: Push,
  wx: XF,
  wz: XF,
  m: XF,
) {
  const h = y1 - y0
  if (h <= 0.004 || r.w <= 4 || r.h <= 4) return
  push(id, kind, level, [wx(r.x + r.w / 2), (y0 + y1) / 2, wz(r.y + r.h / 2)], [m(r.w), h, m(r.h)])
}

/** grow a rect outward on every side */
const grow = (r: Rect, by: number): Rect => ({ x: r.x - by, y: r.y - by, w: r.w + 2 * by, h: r.h + 2 * by })

/** a cantilevered weather hood, with the down-turned drip that makes it read */
function emitChajja(c: ChajjaSpec, baseY: number, push: Push, wx: XF, wz: XF, m: XF) {
  const y0 = baseY + c.atMm / 1000
  const th = c.thickMm / 1000
  fromRect(`art-${c.id}`, 'chajja', c.level, c.rect, y0, y0 + th, push, wx, wz, m)
  if (c.dripMm <= 0) return
  // the drip is a fin turned down at the OUTER edge only — a hood without one
  // stains the wall it is meant to protect
  const horiz = c.side === 'N' || c.side === 'S'
  const lip: Rect = horiz
    ? { x: c.rect.x, y: c.side === 'S' ? c.rect.y + c.rect.h - 70 : c.rect.y, w: c.rect.w, h: 70 }
    : { x: c.side === 'E' ? c.rect.x + c.rect.w - 70 : c.rect.x, y: c.rect.y, w: 70, h: c.rect.h }
  fromRect(`art-${c.id}-drip`, 'chajja', c.level, lip, y0 - c.dripMm / 1000, y0 + th, push, wx, wz, m)
}

/** vertical brise-soleil across one opening */
function emitFins(f: FinBankSpec, baseY: number, push: Push, wx: XF, wz: XF, m: XF) {
  const y0 = baseY + f.fromMm / 1000
  const y1 = baseY + f.toMm / 1000
  if (y1 - y0 < 0.15) return
  const horiz = f.side === 'N' || f.side === 'S'
  const along = horiz ? f.rect.w : f.rect.h
  const n = Math.max(2, f.count)
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1)
    const c = (horiz ? f.rect.x : f.rect.y) + t * along
    const r: Rect = horiz
      ? { x: c - f.thickMm / 2, y: f.rect.y, w: f.thickMm, h: f.rect.h }
      : { x: f.rect.x, y: c - f.thickMm / 2, w: f.rect.w, h: f.thickMm }
    fromRect(`art-${f.id}-${i}`, 'fin', f.level, r, y0, y1, push, wx, wz, m)
  }
}

/** a battened louver / jaali plane — balcony privacy, stair core light */
function emitScreen(sc: SlatScreenSpec, baseY: number, push: Push, wx: XF, wz: XF, m: XF) {
  const y0 = baseY + sc.fromMm / 1000
  const y1 = baseY + sc.toMm / 1000
  if (y1 - y0 < 0.2) return
  const horiz = sc.side === 'N' || sc.side === 'S'
  const along = horiz ? sc.rect.w : sc.rect.h
  const [face, depth] = sc.slatMm
  const n = Math.max(2, sc.count)
  // the plane stands off whatever is behind it, so light passes between
  const plane: Rect = horiz
    ? { x: sc.rect.x, y: sc.side === 'S' ? sc.rect.y + sc.rect.h - depth : sc.rect.y, w: sc.rect.w, h: depth }
    : { x: sc.side === 'E' ? sc.rect.x + sc.rect.w - depth : sc.rect.x, y: sc.rect.y, w: depth, h: sc.rect.h }

  for (let i = 0; i < n; i++) {
    const c = (horiz ? plane.x : plane.y) + ((i + 0.5) * along) / n
    const r: Rect = horiz
      ? { x: c - face / 2, y: plane.y, w: face, h: plane.h }
      : { x: plane.x, y: c - face / 2, w: plane.w, h: face }
    fromRect(`art-${sc.id}-${i}`, 'louver', sc.level, r, y0, y1, push, wx, wz, m)
  }
  // head + sill rails carrying the battens
  const rail = sc.railMm / 1000
  fromRect(`art-${sc.id}-rb`, 'louver', sc.level, plane, y0, y0 + rail, push, wx, wz, m)
  fromRect(`art-${sc.id}-rt`, 'louver', sc.level, plane, y1 - rail, y1, push, wx, wz, m)
}

/**
 * The expressed edge of a floor plate. The band hangs BELOW finished floor and
 * stops `shadowGapMm` short of it, so the plate reads as a separate horizontal
 * element with a dark line above it rather than a bulge in the wall.
 */
function emitSlabEdge(se: SlabEdgeSpec, baseY: number, push: Push, wx: XF, wz: XF, m: XF) {
  const fascia = se.fasciaMm / 1000
  const gap = se.shadowGapMm / 1000
  const top = baseY - gap
  const bot = top - fascia
  fromRect(`art-${se.id}`, 'fascia', se.level, se.rect, bot, top, push, wx, wz, m)
  if (se.dripMm > 0) {
    // a crisp nose on the underside — this is the line that reads from the street
    fromRect(`art-${se.id}-drip`, 'fascia', se.level, grow(se.rect, se.dripMm), bot, bot + 25 / 1000, push, wx, wz, m)
  }
}

/**
 * Parapet upstand + projecting coping cap, and a batten screen above the solid
 * base where the terrace is occupied. Four walls, not one box, so the roof deck
 * stays open.
 */
function emitParapet(pa: ParapetSpec, wallTop: number, push: Push, wx: XF, wz: XF, m: XF) {
  const t = pa.thickMm
  const solidTop = wallTop + (pa.heightMm - pa.screenAboveMm) / 1000
  const capBot = wallTop + pa.heightMm / 1000
  const r = pa.rect
  const runs: [string, Rect][] = [
    ['n', { x: r.x, y: r.y, w: r.w, h: t }],
    ['s', { x: r.x, y: r.y + r.h - t, w: r.w, h: t }],
    ['w', { x: r.x, y: r.y + t, w: t, h: r.h - 2 * t }],
    ['e', { x: r.x + r.w - t, y: r.y + t, w: t, h: r.h - 2 * t }],
  ]
  for (const [k, run] of runs) {
    fromRect(`art-${pa.id}-${k}`, 'parapet', pa.level, run, wallTop, solidTop, push, wx, wz, m)
    // batten screen above the solid base on an occupied terrace
    if (pa.screenAboveMm > 0) {
      const horiz = k === 'n' || k === 's'
      const along = horiz ? run.w : run.h
      const n = Math.max(2, Math.floor(along / 220))
      for (let i = 0; i < n; i++) {
        const c = (horiz ? run.x : run.y) + ((i + 0.5) * along) / n
        const slat: Rect = horiz
          ? { x: c - 40, y: run.y, w: 80, h: run.h }
          : { x: run.x, y: c - 40, w: run.w, h: 80 }
        fromRect(`art-${pa.id}-${k}s${i}`, 'louver', pa.level, slat, solidTop, capBot, push, wx, wz, m)
      }
    }
    // the coping cap — a projecting stone, the detail that stops a parapet
    // reading as a wall someone sawed the top off
    fromRect(
      `art-${pa.id}-${k}cap`,
      'coping',
      pa.level,
      grow(run, pa.copingProjMm),
      capBot,
      capBot + pa.copingThickMm / 1000,
      push,
      wx,
      wz,
      m,
    )
  }
}
