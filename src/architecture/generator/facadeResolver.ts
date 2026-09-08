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
import type { DesignRequirements, Direction4, FacadeElement, StyleGrammar, WindowSpec } from '../types.ts'
import type { MassingResult } from './massingResolver.ts'

const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const snap = (v: number) => Math.round(v / 50) * 50

export function resolveFacade(
  grammar: StyleGrammar,
  massing: MassingResult,
  req: DesignRequirements,
  windowsByLevel: WindowSpec[][],
  rng: Rng,
): FacadeElement[] {
  const f = grammar.facade
  const out: FacadeElement[] = []
  const foot = massing.footprintMm
  const fh = req.floorHeightMm
  const floors = req.floorPlan.floors.length
  const entry = entryPoint(foot)

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

  // ---- brise-soleil fins over the widest street glazing
  if (rng.chance(f.verticalFinsChance)) {
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

  // ---- jaali screens
  if (rng.chance(f.jaaliScreenChance)) {
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

  // ---- cladding panels (a facade band or a feature volume face)
  if (f.cladPanels) {
    const widthMm = snap(lerp(f.cladPanels.widthMm[0], f.cladPanels.widthMm[1], rng.next()))
    const side: Direction4 = rng.pick(['S', 'E', 'W'] as const)
    const at = bandOnSide(foot, side, widthMm, rng)
    out.push({ kind: 'clad', level: 0, side, rect: at, material: f.cladPanels.material, twoStorey: f.cladPanels.twoStorey && floors > 1 })
  }

  // ---- feature pier at the entry
  if (f.featurePier && rng.chance(f.featurePier.chance)) {
    out.push({
      kind: 'feature_pier',
      side: 'S',
      at: { x: entry.x - 1900, y: foot.y + foot.h },
      widthMm: 700,
      depthMm: 700,
      topMm: floors * fh + 400,
      material: f.featurePier.material,
    })
  }

  // ---- slender feature tower at the stair core (above the roofline)
  if (rng.chance(grammar.massing.featureTowerChance)) {
    out.push({
      kind: 'feature_tower',
      at: { x: foot.x + 900, y: foot.y + 900 },
      footprint: { x: foot.x + 400, y: foot.y + 400, w: 1800, h: 2600 },
      topMm: floors * fh + snap(lerp(1400, 2600, rng.next())),
      cladding: f.cladPanels?.material === 'travertine' ? 'travertine' : 'white_fins',
    })
  }

  // ---- covered verandah along the entry facade
  if (f.verandah) {
    const depthMm = snap(lerp(f.verandah.depthMm[0], f.verandah.depthMm[1], rng.next()))
    out.push({
      kind: 'verandah',
      level: 0,
      rect: { x: foot.x + 600, y: foot.y + foot.h, w: foot.w - 1200, h: depthMm },
      columns: { style: f.verandah.columns, sizeMm: f.verandah.columnMm, spacingMm: snap(lerp(2800, 3600, rng.next())) },
    })
  }

  // ---- entry canopy
  if (grammar.door.entryCanopyMm > 0) {
    out.push({
      kind: 'canopy',
      at: { x: entry.x, y: foot.y + foot.h + grammar.door.entryCanopyMm / 2 },
      widthMm: grammar.door.doubleHeightEntry ? 4200 : 3200,
      depthMm: grammar.door.entryCanopyMm,
      heightMm: grammar.door.doubleHeightEntry ? fh * 1.9 : fh - 200,
    })
  }

  // ---- pergolas
  for (const where of f.pergola) {
    if (where === 'roof' && rng.chance(0.7)) {
      out.push({ kind: 'pergola', where: 'roof', rect: { x: foot.x + foot.w * 0.5, y: foot.y + 400, w: foot.w * 0.42, h: foot.h * 0.34 } })
    }
    if (where === 'verandah' && f.verandah) {
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
