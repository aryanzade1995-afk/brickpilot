/* ------------------------------------------------------------------ *
 *  articulationResolver — the facade DEPTH pass.
 *
 *  Everything before this decides *what* is on the facade: which rooms,
 *  which openings, which massing. This pass decides how far each of it
 *  stands proud of — or sits behind — the wall face, which is the whole
 *  difference between a shoebox and a building:
 *
 *      floor plates      project 600–1200 mm  → horizontal shadow line
 *      openings          set back 150–200 mm  → a jamb you can see
 *      sills             project  60 mm       → a weather line
 *      chhajjas          project 450–750 mm   → the Indian sun answer
 *      fins              project 300–450 mm   → west-light control
 *      screens           40×80 battens @120   → balcony + stair privacy
 *      parapet + coping  1000/1500 + 50 cap   → a roof edge, not a cut
 *      plinth            450 + 90 proj        → the building meets ground
 *
 *  Every number comes from `dims.ARTICULATION`; nothing is invented here.
 *  Ranges resolve ONCE per design from the seeded rng, so one building has
 *  one reveal depth and one plate projection — an architect's decision, not
 *  per-window noise. The result is serialisable and is read identically by
 *  `src/lib/three/buildMassing.ts` and `blender/generator/`.
 * ------------------------------------------------------------------ */

import type { Rect } from '../../lib/geometry.ts'
import type { Rng } from '../../lib/engine/shape/rng.ts'
import { ARTICULATION } from '../dims.ts'
import type {
  ArticulationSpec,
  ChajjaSpec,
  DesignGenome,
  Direction4,
  DoorSpec,
  FinBankSpec,
  FloorArticulation,
  MassBlock,
  OpeningReveal,
  ParapetSpec,
  SlabEdgeSpec,
  SlatScreenSpec,
  WindowSpec,
} from '../types.ts'

const A = ARTICULATION
const SIDES: Direction4[] = ['N', 'S', 'E', 'W']
const round = (n: number) => Math.round(n)
const snapTo = (n: number, step: number) => Math.round(n / step) * step
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

/** overhang vocabulary term → where in the chhajja range it lands, 0..1 (−1 = none) */
const OVERHANG_T: Record<string, number> = {
  none: -1,
  shallow: 0.15,
  medium: 0.45,
  deep: 0.8,
  very_deep: 1,
}

/** glazing vocabulary term → how eagerly this design shades its glass */
const GLAZING_SHADE: Record<string, number> = {
  minimal: 0.2,
  modest: 0.4,
  controlled_large: 0.75,
  expansive: 0.95,
  full_glass: 1,
}

/** roof terms whose whole point is a plate reading as separate from the walls */
const FLOATING_ROOFS = new Set(['floating_slab', 'deep_overhang_flat', 'butterfly'])
/** overhang terms deep enough to express the intermediate plates too */
const DEEP_OVERHANGS = new Set(['deep', 'very_deep'])

const FIN_SCREENS = new Set(['vertical_fins', 'horizontal_fins'])
const SLAT_SCREENS = new Set(['louvers', 'wood_screen', 'perforated_screen', 'jaali'])

/* ------------------------------------------------------------------ *
 *  opening reveals
 * ------------------------------------------------------------------ */

/** the one reveal depth this building uses, resolved from the seed */
export type RevealBasis = { jambMm: number; headMm: number }

export function resolveRevealBasis(rng: Rng): RevealBasis {
  const jambMm = snapTo(rng.range(A.reveal.jambMm[0], A.reveal.jambMm[1]), 5)
  return { jambMm, headMm: jambMm + A.reveal.headExtraMm }
}

/**
 * How one opening sits in its wall. A window gets a projecting weathered sill;
 * a door gets a flush threshold. Anything under `minWidthForRevealMm` — a
 * ventilator, a privacy slot — keeps a shallow reveal: a 200 mm jamb around a
 * 500 mm opening reads as a bunker loophole, not a window.
 */
export function resolveOpeningReveal(
  basis: RevealBasis,
  o: { widthMm: number; isDoor: boolean; kind?: string },
): OpeningReveal {
  const small = o.widthMm < A.reveal.minWidthForRevealMm
  const jambMm = small ? round(basis.jambMm * 0.5) : basis.jambMm
  const headMm = small ? jambMm : basis.headMm
  const sill = o.isDoor
    ? { sillProjMm: 0, sillThickMm: 0, sillEarMm: 0, sillFallDeg: 0 }
    : {
        sillProjMm: A.sill.projMm,
        sillThickMm: A.sill.thickMm,
        sillEarMm: A.sill.earMm,
        sillFallDeg: A.sill.fallDeg,
      }
  // a door leaf is never mullioned; a picture window is one sheet of glass;
  // everything else splits on the sash grid
  const mullions =
    o.isDoor || o.kind === 'picture' || o.widthMm <= A.frame.mullionSpacingMm
      ? 0
      : Math.max(1, Math.round(o.widthMm / A.frame.mullionSpacingMm) - 1)
  return {
    jambMm,
    headMm,
    ...sill,
    frameMm: A.frame.masterMm,
    sashMm: A.frame.sashMm,
    glassMm: A.frame.glassMm,
    mullions,
  }
}

/* ------------------------------------------------------------------ *
 *  geometry helpers — everything in the plot frame
 * ------------------------------------------------------------------ */

/** the plan point `centerMm` along a wall segment, plus its run direction */
function centreOf(wall: { a: { x: number; y: number }; b: { x: number; y: number } }, centerMm: number) {
  const dx = wall.b.x - wall.a.x
  const dy = wall.b.y - wall.a.y
  const len = Math.hypot(dx, dy) || 1
  return { x: wall.a.x + (dx / len) * centerMm, y: wall.a.y + (dy / len) * centerMm }
}

/**
 * A plate standing OUTSIDE the wall face on `side`, `alongMm` wide and
 * projecting `projMm` out. Every articulation rect follows this one
 * convention, so a consumer only ever has to extrude the rect upward — it
 * never has to re-derive which way "out" is.
 */
function outwardRect(side: Direction4, centre: { x: number; y: number }, alongMm: number, projMm: number): Rect {
  const half = alongMm / 2
  switch (side) {
    case 'N':
      return { x: centre.x - half, y: centre.y - projMm, w: alongMm, h: projMm }
    case 'S':
      return { x: centre.x - half, y: centre.y, w: alongMm, h: projMm }
    case 'W':
      return { x: centre.x - projMm, y: centre.y - half, w: projMm, h: alongMm }
    default:
      return { x: centre.x, y: centre.y - half, w: projMm, h: alongMm }
  }
}

/* ------------------------------------------------------------------ *
 *  the pass
 * ------------------------------------------------------------------ */

export type ArticulationLevel = {
  level: number
  blocks: MassBlock[]
  windows: WindowSpec[]
  doors: DoorSpec[]
  /** the balcony plates on this storey — screens hang off their outer edge */
  balconies: { id: string; side: Direction4; rect: Rect }[]
}

export type ArticulationInput = {
  genome: DesignGenome
  floorHeightMm: number
  levels: ArticulationLevel[]
  topLevel: number
  rng: Rng
  /** the SAME basis every opening was resolved against — never re-roll it here,
   *  or the facade ends up with two reveal depths on one building */
  basis: RevealBasis
}

export type ArticulationResult = {
  perFloor: FloorArticulation[]
  spec: ArticulationSpec
  basis: RevealBasis
}

export function resolveArticulation(input: ArticulationInput): ArticulationResult {
  const { genome, floorHeightMm, levels, topLevel, rng, basis } = input

  // ---- the design-wide decisions, resolved once so the building is coherent ----
  const overhangT = OVERHANG_T[genome.overhang] ?? 0.45
  const chajjaProj =
    overhangT < 0 ? 0 : snapTo(A.chajja.projMm[0] + (A.chajja.projMm[1] - A.chajja.projMm[0]) * overhangT, 25)
  const finProj = snapTo(rng.range(A.fin.projMm[0], A.fin.projMm[1]), 25)
  const finSpacing = snapTo(rng.range(A.fin.spacingMm[0], A.fin.spacingMm[1]), 25)
  // the plate projection: an explicit genome cantilever wins, else a seeded pick
  const plateProj = genome.cantileverMm
    ? clamp(genome.cantileverMm, A.slabEdge.projMm[0], A.slabEdge.projMm[1])
    : snapTo(rng.range(A.slabEdge.projMm[0], A.slabEdge.projMm[1]), 50)

  const shadeEagerness = GLAZING_SHADE[genome.glazing] ?? 0.6
  const wantsFins = FIN_SCREENS.has(genome.screen) || shadeEagerness >= 0.9
  const wantsSlats = SLAT_SCREENS.has(genome.screen)
  const slatKind: SlatScreenSpec['kind'] =
    genome.screen === 'jaali' || genome.screen === 'perforated_screen' ? 'jaali' : 'louver'

  const perFloor: FloorArticulation[] = []

  for (const lv of levels) {
    const chajjas: ChajjaSpec[] = []
    const fins: FinBankSpec[] = []
    const screens: SlatScreenSpec[] = []
    const slabEdges: SlabEdgeSpec[] = []
    const parapets: ParapetSpec[] = []

    /* ---- chhajjas: a hood over every worthwhile opening on a sunny face ---- */
    if (chajjaProj > 0) {
      const shaded = [
        ...lv.windows.map((w) => ({
          id: w.id,
          side: w.side,
          wall: w.wall,
          centerMm: w.centerMm,
          widthMm: w.widthMm,
          headMm: w.sillMm + w.heightMm,
        })),
        ...lv.doors
          .filter((d) => d.kind === 'entry' || d.kind === 'balcony')
          .map((d) => ({ id: d.id, side: d.side, wall: d.wall, centerMm: d.centerMm, widthMm: d.widthMm, headMm: d.heightMm })),
      ]
      for (const o of shaded) {
        if (o.widthMm < A.chajja.minOpeningMm) continue
        if (!(A.chajja.sides as readonly string[]).includes(o.side)) continue
        const atMm = o.headMm + A.chajja.aboveHeadMm
        // a hood that would collide with the plate above is not a hood
        if (atMm + A.chajja.thickMm > floorHeightMm - 100) continue
        chajjas.push({
          id: `cj${lv.level}-${o.id}`,
          level: lv.level,
          side: o.side,
          overId: o.id,
          rect: outwardRect(o.side, centreOf(o.wall, o.centerMm), o.widthMm + 2 * A.chajja.earMm, chajjaProj),
          atMm,
          thickMm: A.chajja.thickMm,
          projMm: chajjaProj,
          dripMm: A.chajja.dripMm,
        })
      }
    }

    /* ---- fins: vertical brise-soleil on the hot faces ---- */
    if (wantsFins) {
      for (const w of lv.windows) {
        if (w.widthMm < A.fin.minOpeningMm) continue
        if (!(A.fin.sides as readonly string[]).includes(w.side)) continue
        fins.push({
          id: `fin${lv.level}-${w.id}`,
          level: lv.level,
          side: w.side,
          overId: w.id,
          rect: outwardRect(w.side, centreOf(w.wall, w.centerMm), w.widthMm, finProj),
          fromMm: Math.max(0, w.sillMm - A.fin.overrunMm),
          toMm: Math.min(floorHeightMm - 60, w.sillMm + w.heightMm + A.fin.overrunMm),
          count: Math.max(2, Math.floor(w.widthMm / finSpacing) + 1),
          projMm: finProj,
          thickMm: A.fin.thickMm,
          spacingMm: finSpacing,
        })
      }
    }

    /* ---- slat screens: balcony privacy, the recognisably-Indian layer ---- */
    if (wantsSlats) {
      for (const b of lv.balconies) {
        const along = b.side === 'N' || b.side === 'S' ? b.rect.w : b.rect.h
        if (along < 900) continue
        const jaali = slatKind === 'jaali'
        screens.push({
          id: `scr${lv.level}-${b.id}`,
          level: lv.level,
          side: b.side,
          kind: slatKind,
          rect: b.rect,
          fromMm: 0,
          toMm: A.parapet.solidMm,
          slatMm: jaali ? [A.screen.jaaliModuleMm, A.screen.jaaliDepthMm] : [A.screen.battenMm[0], A.screen.battenMm[1]],
          spacingMm: jaali ? A.screen.jaaliModuleMm : A.screen.spacingMm,
          count: Math.max(3, Math.floor(along / (jaali ? A.screen.jaaliModuleMm : A.screen.spacingMm))),
          standoffMm: A.screen.standoffMm,
          railMm: A.screen.railMm,
          host: 'balcony',
        })
      }
    }

    /* ---- floor plate edges: the horizontal shadow lines ----
     * Three reasons a plate projects rather than just showing a trim line:
     *   1. the massing gave this side a real cantilever
     *   2. it is the roof of a design whose roof form is meant to float
     *   3. the design carries a deep overhang, so every plate above ground reads
     * Everything else still gets a 150 mm trim so the storey division is legible. */
    const floatingRoof = lv.level === topLevel && FLOATING_ROOFS.has(genome.roof)
    const deepPlates = lv.level > 0 && DEEP_OVERHANGS.has(genome.overhang)
    for (const b of lv.blocks) {
      const proj: Partial<Record<Direction4, number>> = {}
      let maxProj = 0
      for (const side of SIDES) {
        const cant = b.cantilever[side] ?? 0
        const p =
          cant > 0
            ? clamp(Math.max(cant, plateProj), A.slabEdge.projMm[0], A.slabEdge.projMm[1])
            : floatingRoof || deepPlates
              ? plateProj
              : A.slabEdge.trimProjMm
        proj[side] = p
        maxProj = Math.max(maxProj, p)
      }
      slabEdges.push({
        id: `edge${lv.level}-${b.id}`,
        level: lv.level,
        rect: {
          x: b.rect.x - (proj.W ?? 0),
          y: b.rect.y - (proj.N ?? 0),
          w: b.rect.w + (proj.W ?? 0) + (proj.E ?? 0),
          h: b.rect.h + (proj.N ?? 0) + (proj.S ?? 0),
        },
        projMm: proj,
        atMm: 0,
        fasciaMm: A.slabEdge.fasciaMm,
        shadowGapMm: A.slabEdge.shadowGapMm,
        dripMm: A.slabEdge.dripMm,
        carriesBalcony: maxProj >= A.slabEdge.balconyThresholdMm,
      })
    }

    /* ---- parapet + coping on the roof this storey carries ---- */
    if (lv.level === topLevel && genome.parapet !== false) {
      const occupied = genome.roofDeck === true
      const heightMm = occupied ? A.parapet.screenMm : A.parapet.solidMm
      for (const b of lv.blocks) {
        parapets.push({
          id: `par${lv.level}-${b.id}`,
          level: lv.level,
          blockId: b.id,
          rect: b.rect,
          heightMm,
          thickMm: A.parapet.thickMm,
          // an occupied terrace gets a battened screen above a solid base
          screenAboveMm: occupied ? heightMm - A.parapet.screenSolidBaseMm : 0,
          copingThickMm: A.coping.thickMm,
          copingProjMm: A.coping.projMm,
        })
      }
    }

    perFloor[lv.level] = { chajjas, fins, screens, slabEdges, parapets }
  }

  const spec: ArticulationSpec = {
    plinth: { heightMm: A.plinth.heightMm, projMm: A.plinth.projMm, bandMm: A.plinth.bandMm },
    stringCourse: {
      projMm: A.stringCourse.projMm,
      depthMm: A.stringCourse.depthMm,
      // only a banded composition earns a band at every floor line
      levels: genome.facadeComposition === 'stacked_bands' ? levels.filter((l) => l.level > 0).map((l) => l.level) : [],
    },
    defaultReveal: resolveOpeningReveal(basis, { widthMm: 1200, isDoor: false }),
  }

  return { perFloor, spec, basis }
}
