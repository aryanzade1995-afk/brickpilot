/* ------------------------------------------------------------------ *
 *  facadeResolver — runs LAST (§9). Every facade element ANCHORS to a
 *  real spec element (a block face, a window, the entry door, a
 *  structural column, the stair) — never a bare world coordinate. The
 *  rect it carries is DERIVED from that anchor so Blender + the
 *  validator can prove the connection.
 *
 *  Verandah / porch / balcony support columns are pushed into the
 *  structural frame here, so the canopy → beam → column → ground chain
 *  is real, not decoration.
 * ------------------------------------------------------------------ */

import type { Point, Rect } from '../../lib/geometry.ts'
import { rectBottom, rectRight } from '../../lib/geometry.ts'
import type { Rng } from '../../lib/engine/shape/rng.ts'
import { STRUCTURE } from '../dims.ts'
import type {
  CladMaterial,
  DesignGenome,
  DesignRequirements,
  DesignSpecFloor,
  Direction4,
  DoorSpec,
  FacadeElement,
  StyleGrammar,
  WindowSpec,
} from '../types.ts'
import type { MassingResult } from './massingResolver.ts'
import { porchStructure, type StructureResult } from './structure.ts'

const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const snap = (v: number) => Math.round(v / 50) * 50

function paletteClad(palette: string): CladMaterial {
  if (/travertine|granite/.test(palette)) return 'travertine'
  if (/laterite/.test(palette)) return 'laterite'
  if (/concrete/.test(palette)) return 'exposed_concrete'
  if (/brick/.test(palette)) return 'brick'
  if (/wood|timber/.test(palette)) return 'teak'
  if (/stone/.test(palette)) return 'stone_warm'
  return 'stone_dark'
}

/** a rect along one side of a block, `bandMm` wide, offset `t` (0..1) along it */
function bandOnBlockSide(b: Rect, side: Direction4, bandMm: number, t: number): Rect {
  const T = 120
  if (side === 'S') return { x: b.x + (b.w - bandMm) * t, y: rectBottom(b) - T, w: bandMm, h: T }
  if (side === 'N') return { x: b.x + (b.w - bandMm) * t, y: b.y, w: bandMm, h: T }
  if (side === 'W') return { x: b.x, y: b.y + (b.h - bandMm) * t, w: T, h: bandMm }
  return { x: rectRight(b) - T, y: b.y + (b.h - bandMm) * t, w: T, h: bandMm }
}

function windowPoint(w: WindowSpec): Point {
  const dx = w.wall.b.x - w.wall.a.x
  const dy = w.wall.b.y - w.wall.a.y
  const len = Math.hypot(dx, dy) || 1
  return { x: w.wall.a.x + (dx / len) * w.centerMm, y: w.wall.a.y + (dy / len) * w.centerMm }
}

export function resolveFacade(
  grammar: StyleGrammar,
  massing: MassingResult,
  req: DesignRequirements,
  windowsByLevel: WindowSpec[][],
  rng: Rng,
  genome: DesignGenome,
  floors: DesignSpecFloor[],
  structure: StructureResult,
): FacadeElement[] {
  const f = grammar.facade
  const out: FacadeElement[] = []
  const fh = req.floorHeightMm
  const nFloors = req.floorPlan.floors.length
  const topLevel = nFloors - 1

  const groundFloor = floors.find((fl) => fl.level === 0)!
  const groundBlocks = massing.perFloor[0] ?? []
  const streetBlock = [...groundBlocks].sort((a, b) => rectBottom(b.rect) - rectBottom(a.rect))[0] ?? groundBlocks[0]
  const topBlock = (massing.perFloor[topLevel] ?? [])[0] ?? streetBlock
  const entryDoor: DoorSpec | undefined = groundFloor.doors.find((d) => d.kind === 'entry')
  const stairRect = req.floorPlan.floors[0].stair?.rect ?? null

  const wantsFins = genome.screen === 'vertical_fins' || genome.screen === 'horizontal_fins'
  const wantsJaali = genome.screen === 'jaali' || genome.screen === 'perforated_screen'
  const wantsWoodScreen = genome.screen === 'wood_screen' || genome.screen === 'louvers'
  const cladMat = paletteClad(genome.materialPalette)

  /* ---- plinth + base cladding — anchored to the ground street block */
  if (f.plinthMm > 0 && streetBlock) {
    out.push({ kind: 'plinth', heightMm: f.plinthMm, projMm: Math.max(80, f.plinthMm * 0.6), anchor: { on: 'block', id: streetBlock.id, side: 'S' } })
  }
  if (f.baseCladding && streetBlock) {
    out.push({ kind: 'base_cladding', material: f.baseCladding, toLevel: nFloors > 1 && rng.chance(0.35) ? 1 : 0, anchor: { on: 'block', id: streetBlock.id, side: 'S' } })
  }

  /* ---- string courses at every floor line — anchored to that storey's street block */
  if (f.stringCourseMm > 0) {
    for (let L = 1; L < nFloors; L++) {
      const blk = (massing.perFloor[L] ?? [])[0] ?? streetBlock
      if (blk) out.push({ kind: 'string_course', level: L, projMm: f.stringCourseMm, anchor: { on: 'block', id: blk.id, side: 'S' } })
    }
  }

  /* ---- chajja hoods over the street windows — anchored to the widest one per floor */
  if (f.chajjaMm > 0) {
    for (let L = 0; L < nFloors; L++) {
      const win = (windowsByLevel[L] ?? []).filter((w) => w.facesStreet).sort((a, b) => b.widthMm - a.widthMm)[0]
      if (win) out.push({ kind: 'chajja', level: L, overWindow: win.id, projMm: f.chajjaMm, anchor: { on: 'window', id: win.id } })
    }
  }

  /* ---- brise-soleil fins over the widest street glazing (genome-gated) */
  if (wantsFins || (genome.screen === 'none' && rng.chance(f.verticalFinsChance * 0.3))) {
    for (let L = 0; L < nFloors; L++) {
      const streetWide = (windowsByLevel[L] ?? [])
        .filter((w) => w.facesStreet && (w.kind === 'standard' || w.kind === 'strip' || w.kind === 'picture'))
        .sort((a, b) => b.widthMm - a.widthMm)[0]
      if (!streetWide) continue
      const depthMm = snap(lerp(f.finDepthMm[0], f.finDepthMm[1], rng.next()))
      const half = streetWide.widthMm / 2 + 200
      const c = windowPoint(streetWide)
      out.push({
        kind: 'fins',
        level: L,
        side: streetWide.side,
        rect: { x: c.x - half, y: c.y - 40, w: half * 2, h: 80 },
        count: Math.max(3, Math.round((streetWide.widthMm + 400) / 320)),
        depthMm,
        anchor: { on: 'window', id: streetWide.id },
      })
      if (rng.chance(0.4)) break
    }
  }

  /* ---- jaali — anchored to the stair, or the street block */
  if (wantsJaali || (wantsWoodScreen && rng.chance(0.5))) {
    const pattern = rng.pick(['square', 'diamond', 'brick'] as const)
    for (const where of f.jaaliWhere) {
      if (where === 'stair' && stairRect) {
        out.push({
          kind: 'jaali',
          level: 0,
          side: 'W',
          rect: { x: stairRect.x, y: stairRect.y + 200, w: 140, h: Math.min(4000, stairRect.h - 400) },
          pattern,
          anchor: { on: 'stair', level: 0 },
        })
      } else if (streetBlock) {
        const s = bandOnBlockSide(streetBlock.rect, 'S', streetBlock.rect.w * 0.7, 0.15)
        out.push({ kind: 'jaali', level: 0, side: 'S', rect: s, pattern, anchor: { on: 'block', id: streetBlock.id, side: 'S' } })
        if (nFloors > 1) {
          const b1 = (massing.perFloor[1] ?? [])[0] ?? streetBlock
          out.push({ kind: 'jaali', level: 1, side: 'S', rect: bandOnBlockSide(b1.rect, 'S', b1.rect.w * 0.7, 0.15), pattern, anchor: { on: 'block', id: b1.id, side: 'S' } })
        }
      }
      if (rng.chance(0.5)) break
    }
  }

  /* ---- cladding panels — a real block face */
  if (f.cladPanels || genome.facadeComposition === 'mixed_material' || genome.facadeComposition === 'stone_volume') {
    const widthMm = snap(lerp(f.cladPanels?.widthMm[0] ?? 1600, f.cladPanels?.widthMm[1] ?? 2200, rng.next()))
    const blk = rng.pick(groundBlocks.length ? groundBlocks : [streetBlock])
    const side = rng.pick(['S', 'E', 'W'] as const)
    const alongMm = side === 'S' ? blk.rect.w : blk.rect.h
    const twoStorey = (genome.facadeComposition === 'stone_volume' || (f.cladPanels?.twoStorey ?? false)) && nFloors > 1
    out.push({
      kind: 'clad',
      level: 0,
      side,
      rect: bandOnBlockSide(blk.rect, side, Math.min(widthMm, alongMm), 0.15 + rng.next() * 0.5),
      material: cladMat,
      twoStorey,
      anchor: { on: 'block', id: blk.id, side },
    })
  }

  /* ---- feature pier beside the entry door (genome featureStone) */
  if (genome.featureStone && entryDoor) {
    const dm = { x: (entryDoor.wall.a.x + entryDoor.wall.b.x) / 2, y: (entryDoor.wall.a.y + entryDoor.wall.b.y) / 2 }
    const off = entryDoor.side === 'S' || entryDoor.side === 'N' ? { x: -(entryDoor.widthMm / 2 + 600), y: 0 } : { x: 0, y: -(entryDoor.widthMm / 2 + 600) }
    out.push({
      kind: 'feature_pier',
      side: entryDoor.side,
      at: { x: dm.x + off.x, y: dm.y + off.y },
      widthMm: 700,
      depthMm: 700,
      topMm: nFloors * fh + 400,
      material: cladMat,
      anchor: { on: 'door', id: entryDoor.id },
    })
  }

  /* ---- feature tower at the stair core (genome featureTower) */
  if (genome.featureTower && stairRect) {
    out.push({
      kind: 'feature_tower',
      at: { x: stairRect.x + stairRect.w / 2, y: stairRect.y + stairRect.h / 2 },
      footprint: { x: stairRect.x, y: stairRect.y, w: Math.max(1600, stairRect.w), h: Math.max(2400, stairRect.h) },
      topMm: nFloors * fh + snap(lerp(1400, 2600, rng.next())),
      cladding: cladMat === 'travertine' ? 'travertine' : 'white_fins',
      anchor: { on: 'stair', level: 0 },
    })
  }

  /* ---- covered verandah — real porch columns pushed into the frame */
  const verRule =
    f.verandah ??
    (genome.balcony === 'wrap_verandah'
      ? { depthMm: [1900, 2400] as [number, number], columns: 'square' as const, columnMm: 300, wrapCourt: false }
      : null)
  let verandahColIds: string[] = []
  if (verRule && streetBlock) {
    const depthMm = snap(lerp(verRule.depthMm[0], verRule.depthMm[1], rng.next()))
    const vRect: Rect = { x: streetBlock.rect.x + 300, y: rectBottom(streetBlock.rect), w: streetBlock.rect.w - 600, h: depthMm }
    const spacing = snap(lerp(2800, 3600, rng.next()))
    const n = Math.max(2, Math.round(vRect.w / spacing) + 1)
    for (let k = 0; k < n; k++) {
      const cx = vRect.x + (vRect.w * k) / (n - 1)
      const col = {
        id: `vercol-0-${k}`,
        gridRef: 'V',
        at: { x: cx, y: rectBottom(vRect) },
        level: 0,
        sizeMm: [verRule.columnMm, verRule.columnMm] as [number, number],
        role: 'verandah' as const,
        alignedBelow: null,
      }
      groundFloor.columns.push(col)
      structure.perFloor[0]?.columns.push(col)
      verandahColIds.push(col.id)
    }
    // a canopy beam over the verandah columns
    structure.perFloor[0]?.beams.push({
      id: 'verbeam-0',
      level: 0,
      a: { x: vRect.x, y: rectBottom(vRect) },
      b: { x: rectRight(vRect), y: rectBottom(vRect) },
      depthMm: STRUCTURE.canopyBeamDepthMm,
      role: 'canopy',
      ends: [verandahColIds[0], verandahColIds[verandahColIds.length - 1]],
    })
    out.push({
      kind: 'verandah',
      level: 0,
      rect: vRect,
      columns: { style: verRule.columns, sizeMm: verRule.columnMm, spacingMm: spacing },
      anchor: { on: 'column', ids: verandahColIds },
    })
  }

  /* ---- entry canopy — canopy → beam → column → ground (§4) */
  const canopyMm = genome.doubleHeightEntrance ? 2000 : grammar.door.entryCanopyMm
  if (entryDoor && (canopyMm > 0 || genome.entrance === 'porte_cochere')) {
    const isBig = genome.doubleHeightEntrance || genome.entrance === 'porte_cochere'
    const dm = { x: (entryDoor.wall.a.x + entryDoor.wall.b.x) / 2, y: (entryDoor.wall.a.y + entryDoor.wall.b.y) / 2 }
    const depthMm = genome.entrance === 'porte_cochere' ? 5000 : Math.max(canopyMm, 1200)
    const widthMm = isBig ? 4200 : 3200
    const cRect: Rect = { x: dm.x - widthMm / 2, y: dm.y, w: widthMm, h: depthMm }
    // porch columns + beam carry the canopy — only for a real projecting porch
    if (depthMm >= 1800) {
      const porch = porchStructure(cRect, 0, 0)
      for (const c of porch.columns) {
        groundFloor.columns.push(c)
        structure.perFloor[0]?.columns.push(c)
      }
      structure.perFloor[0]?.beams.push(porch.beam)
    }
    out.push({
      kind: 'canopy',
      at: { x: dm.x, y: dm.y + depthMm / 2 },
      widthMm,
      depthMm,
      heightMm: isBig ? fh * 1.9 : fh - 200,
      anchor: { on: 'door', id: entryDoor.id },
    })
  }

  /* ---- pergolas — on the roof of a real top block, or over the verandah */
  for (const where of f.pergola) {
    if (where === 'roof' && (genome.roofDeck || rng.chance(0.4)) && topBlock) {
      const r = topBlock.rect
      out.push({
        kind: 'pergola',
        where: 'roof',
        rect: { x: r.x + r.w * 0.5, y: r.y + 400, w: r.w * 0.42, h: r.h * 0.34 },
        anchor: { on: 'roof', blockId: topBlock.id },
      })
    }
    if (where === 'verandah' && verandahColIds.length) {
      const vc = out.find((e) => e.kind === 'verandah')
      if (vc && vc.kind === 'verandah') {
        out.push({
          kind: 'pergola',
          where: 'verandah',
          rect: { x: vc.rect.x + vc.rect.w * 0.28, y: rectBottom(vc.rect) - 200, w: vc.rect.w * 0.34, h: 2000 },
          anchor: { on: 'column', ids: verandahColIds },
        })
      }
    }
  }

  return out
}
