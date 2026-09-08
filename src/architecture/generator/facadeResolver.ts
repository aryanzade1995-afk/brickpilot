/* ------------------------------------------------------------------ *
 *  facadeResolver — the style vocabulary that reads on the elevation:
 *  plinth, base cladding, string courses, chajja hoods, brise-soleil
 *  fins, jaali screens, cladding panels, a feature pier, a slender
 *  feature tower, a columned verandah and pergolas. Seeded — the same
 *  seed always picks the same set, different seeds vary it.
 * ------------------------------------------------------------------ */

import type { Point, Rect } from '../../lib/geometry.ts'
import { rectBottom, rectRight } from '../../lib/geometry.ts'
import type { Rng } from '../../lib/engine/shape/rng.ts'
import type { CladMaterial, DesignGenome, DesignRequirements, Direction4, FacadeElement, StyleGrammar, WindowSpec } from '../types.ts'
import type { MassingResult } from './massingResolver.ts'

const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const snap = (v: number) => Math.round(v / 50) * 50

/** the genome's material palette → the CladMaterial the facade elements use */
function paletteClad(palette: string): CladMaterial {
  if (/travertine|granite/.test(palette)) return 'travertine'
  if (/laterite/.test(palette)) return 'laterite'
  if (/concrete/.test(palette)) return 'exposed_concrete'
  if (/brick/.test(palette)) return 'brick'
  if (/wood|timber/.test(palette)) return 'teak'
  if (/stone/.test(palette)) return 'stone_warm'
  return 'stone_dark'
}

export function resolveFacade(
  grammar: StyleGrammar,
  massing: MassingResult,
  req: DesignRequirements,
  windowsByLevel: WindowSpec[][],
  rng: Rng,
  genome: DesignGenome,
): FacadeElement[] {
  const f = grammar.facade
  const out: FacadeElement[] = []
  const foot = massing.footprintMm
  const fh = req.floorHeightMm
  const floors = req.floorPlan.floors.length
  const entry = entryPoint(foot)
  // the genome's screen / stone / tower decisions gate the stochastic vocabulary
  const wantsFins = genome.screen === 'vertical_fins' || genome.screen === 'horizontal_fins'
  const wantsJaali = genome.screen === 'jaali' || genome.screen === 'perforated_screen'
  const wantsWoodScreen = genome.screen === 'wood_screen' || genome.screen === 'louvers'
  const cladMat = paletteClad(genome.materialPalette)

  // ---- plinth + base cladding (ground band)
  if (f.plinthMm > 0) out.push({ kind: 'plinth', heightMm: f.plinthMm, projMm: Math.max(80, f.plinthMm * 0.6) })
  if (f.baseCladding) out.push({ kind: 'base_cladding', material: f.baseCladding, toLevel: floors > 1 && rng.chance(0.35) ? 1 : 0 })

  // ---- string courses at every floor line
  if (f.stringCourseMm > 0) {
    for (let L = 1; L < floors; L++) out.push({ kind: 'string_course', level: L, projMm: f.stringCourseMm })
  }

  // ---- chajja hoods over every window
  if (f.chajjaMm > 0) {
    for (let L = 0; L < floors; L++) {
      if ((windowsByLevel[L] ?? []).length) out.push({ kind: 'chajja', level: L, overWindow: '*', projMm: f.chajjaMm })
    }
  }

  // ---- brise-soleil fins over the widest street glazing (genome-gated)
  if (wantsFins || (genome.screen === 'none' && rng.chance(f.verticalFinsChance * 0.3))) {
    for (let L = 0; L < floors; L++) {
      const streetWide = (windowsByLevel[L] ?? [])
        .filter((w) => w.facesStreet && (w.kind === 'standard' || w.kind === 'strip' || w.kind === 'picture'))
        .sort((a, b) => b.widthMm - a.widthMm)[0]
      if (!streetWide) continue
      const depthMm = snap(lerp(f.finDepthMm[0], f.finDepthMm[1], rng.next()))
      const half = streetWide.widthMm / 2 + 200
      const c = pointAlong(streetWide)
      out.push({
        kind: 'fins',
        level: L,
        side: streetWide.side,
        rect: { x: c.x - half, y: c.y - 40, w: half * 2, h: 80 },
        count: Math.max(3, Math.round((streetWide.widthMm + 400) / 320)),
        depthMm,
      })
      if (rng.chance(0.4)) break // fins on one storey often reads better than all
    }
  }

  // ---- jaali screens (genome-gated)
  if (wantsJaali || (wantsWoodScreen && rng.chance(0.5))) {
    const pattern = rng.pick(['square', 'diamond', 'brick'] as const)
    for (const where of f.jaaliWhere) {
      if (where === 'street_wall') {
        out.push({ kind: 'jaali', level: 0, side: 'S', rect: streetBand(foot), pattern })
        if (floors > 1) out.push({ kind: 'jaali', level: 1, side: 'S', rect: streetBand(foot), pattern })
      } else if (where === 'entry') {
        out.push({ kind: 'jaali', level: 0, side: 'S', rect: { x: entry.x - 1400, y: foot.y + foot.h - 120, w: 2800, h: 120 }, pattern })
      } else if (where === 'stair') {
        out.push({ kind: 'jaali', level: 0, side: 'W', rect: { x: foot.x, y: foot.y + 400, w: 120, h: Math.min(4000, foot.h - 800) }, pattern })
      } else if (where === 'court') {
        out.push({ kind: 'jaali', level: 0, side: 'N', rect: { x: foot.x + foot.w * 0.3, y: foot.y, w: foot.w * 0.4, h: 120 }, pattern })
      }
      if (rng.chance(0.5)) break
    }
  }

  // ---- cladding panels (a facade band or a feature volume face) — genome material
  if (f.cladPanels || genome.facadeComposition === 'mixed_material' || genome.facadeComposition === 'stone_volume') {
    const widthMm = snap(lerp(f.cladPanels?.widthMm[0] ?? 1600, f.cladPanels?.widthMm[1] ?? 2200, rng.next()))
    const side: Direction4 = rng.pick(['S', 'E', 'W'] as const)
    const at = bandOnSide(foot, side, widthMm, rng)
    const twoStorey = (genome.facadeComposition === 'stone_volume' || (f.cladPanels?.twoStorey ?? false)) && floors > 1
    out.push({ kind: 'clad', level: 0, side, rect: at, material: cladMat, twoStorey })
  }

  // ---- feature pier at the entry (genome featureStone)
  if (genome.featureStone) {
    out.push({
      kind: 'feature_pier',
      side: 'S',
      at: { x: entry.x - 1900, y: foot.y + foot.h },
      widthMm: 700,
      depthMm: 700,
      topMm: floors * fh + 400,
      material: cladMat,
    })
  }

  // ---- slender feature tower at the stair core (genome featureTower)
  if (genome.featureTower) {
    out.push({
      kind: 'feature_tower',
      at: { x: foot.x + 900, y: foot.y + 900 },
      footprint: { x: foot.x + 400, y: foot.y + 400, w: 1800, h: 2600 },
      topMm: floors * fh + snap(lerp(1400, 2600, rng.next())),
      cladding: cladMat === 'travertine' ? 'travertine' : 'white_fins',
    })
  }

  // ---- covered verandah along the entry facade (style rule OR genome wrap_verandah)
  const verRule =
    f.verandah ??
    (genome.balcony === 'wrap_verandah'
      ? { depthMm: [1900, 2400] as [number, number], columns: 'square' as const, columnMm: 300, wrapCourt: false }
      : null)
  const hasVerandah = !!verRule
  if (verRule) {
    const depthMm = snap(lerp(verRule.depthMm[0], verRule.depthMm[1], rng.next()))
    out.push({
      kind: 'verandah',
      level: 0,
      rect: { x: foot.x + 600, y: foot.y + foot.h, w: foot.w - 1200, h: depthMm },
      columns: { style: verRule.columns, sizeMm: verRule.columnMm, spacingMm: snap(lerp(2800, 3600, rng.next())) },
    })
  }

  // ---- entry canopy (genome entrance: canopy depth or double-height)
  const canopyMm = genome.doubleHeightEntrance ? 2000 : grammar.door.entryCanopyMm
  if (canopyMm > 0 || genome.entrance === 'porte_cochere') {
    const isBig = genome.doubleHeightEntrance || genome.entrance === 'porte_cochere'
    out.push({
      kind: 'canopy',
      at: { x: entry.x, y: foot.y + foot.h + Math.max(canopyMm, 2400) / 2 },
      widthMm: isBig ? 4200 : 3200,
      depthMm: genome.entrance === 'porte_cochere' ? 5000 : Math.max(canopyMm, 1200),
      heightMm: isBig ? fh * 1.9 : fh - 200,
    })
  }

  // ---- pergolas
  for (const where of f.pergola) {
    if (where === 'roof' && (genome.roofDeck || rng.chance(0.4))) {
      out.push({ kind: 'pergola', where: 'roof', rect: { x: foot.x + foot.w * 0.5, y: foot.y + 400, w: foot.w * 0.42, h: foot.h * 0.34 } })
    }
    if (where === 'verandah' && hasVerandah) {
      out.push({ kind: 'pergola', where: 'verandah', rect: { x: foot.x + foot.w * 0.28, y: foot.y + foot.h, w: foot.w * 0.34, h: 2000 } })
    }
  }

  return out
}

/* ------------------------------------------------------------------ */

function entryPoint(foot: Rect): Point {
  return { x: foot.x + foot.w * 0.62, y: rectBottom(foot) }
}

function pointAlong(w: WindowSpec): Point {
  const dx = w.wall.b.x - w.wall.a.x
  const dy = w.wall.b.y - w.wall.a.y
  const len = Math.hypot(dx, dy) || 1
  return { x: w.wall.a.x + (dx / len) * w.centerMm, y: w.wall.a.y + (dy / len) * w.centerMm }
}

/** a thin screen band along the street (south) facade — Blender extrudes it up */
function streetBand(foot: Rect): Rect {
  return { x: foot.x + foot.w * 0.08, y: rectBottom(foot) - 120, w: foot.w * 0.84, h: 120 }
}

function bandOnSide(foot: Rect, side: Direction4, widthMm: number, rng: Rng): Rect {
  const t = 0.15 + rng.next() * 0.5
  if (side === 'S') return { x: foot.x + foot.w * t, y: rectBottom(foot) - 120, w: widthMm, h: 120 }
  if (side === 'N') return { x: foot.x + foot.w * t, y: foot.y, w: widthMm, h: 120 }
  if (side === 'W') return { x: foot.x, y: foot.y + foot.h * t, w: 120, h: widthMm }
  return { x: rectRight(foot) - 120, y: foot.y + foot.h * t, w: 120, h: widthMm }
}
