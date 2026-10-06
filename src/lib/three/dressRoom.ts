import type { Design } from '../engine/types.ts'
import { createBuildingModel } from '../engine/buildingModel.ts'
import { roomFurnishing, type InteriorConfiguration } from '../interior/preview.ts'
import { interiorFinishes, type InteriorFinishes, type Surface } from '../interior/finishes.ts'
import type { Piece } from '../interior/layout.ts'
import type { DollMat, Dresser } from './buildDollhouse.ts'

/* ------------------------------------------------------------------ *
 *  dressRoom — one room of the furnished 3D view, dressed exactly as the
 *  360 preview dresses it: the same pieces in the same places (from
 *  roomFurnishing, the 360's own placer), built and coloured the way the
 *  Blender renderer builds them (blender/interior_furniture.py,
 *  interior_finishes.py, interior_bathroom.py), in the interior style and
 *  furniture density chosen in the 360 panel and the finishes chosen on
 *  Finishes & Cost. Room-local metres: x east, z south, y up from the floor.
 * ------------------------------------------------------------------ */

type Side = 'N' | 'S' | 'E' | 'W'
type V3 = [number, number, number]

/** how a surface looks: colour, sheen, and for floors and tiles the pattern at its real size */
export type Look = {
  color: string
  rough: number
  metal?: number
  opacity?: number
  emissive?: string
  glow?: number
  surface?: { pattern: Surface['pattern']; tileM: number; image?: string }
}
export type DressBox = { id: string; look: Look; pos: V3; size: V3; shape?: 'box' | 'cyl' | 'ball'; rot?: number
  /** the rounded edge the 360 renderer gives this part (Blender bevel), metres */
  bevel?: number }
export type DressedRoom = {
  boxes: DressBox[]
  floor: Look
  wall: Look
  /** full-height tiles in a bathroom; a backsplash over the counter walls in a kitchen */
  tiles?: { look: Look; zone: 'full' | 'backsplash'; sides: Side[] }
}

type Role = 'wood' | 'panel' | 'soft' | 'accent' | 'cream' | 'stone' | 'metal' | 'rug'
/** blender/interior_preview.py STYLES: the furniture by role, per interior style (colour, roughness, metallic) */
const STYLES: Record<string, Record<Role, [string, number, number]>> = {
  modern: { wood: ['#5A4636', .45, 0], panel: ['#E8E5E0', .4, 0], soft: ['#8E8A84', .85, 0], accent: ['#3F5A57', .8, 0],
    cream: ['#EEEAE2', .9, 0], stone: ['#D9D6D0', .2, 0], metal: ['#2B2B2B', .35, 1], rug: ['#B8B1A6', .95, 0] },
  contemporary: { wood: ['#7A5C44', .45, 0], panel: ['#D8D1C7', .45, 0], soft: ['#A39B8F', .85, 0], accent: ['#8A6E5A', .8, 0],
    cream: ['#F1ECE3', .9, 0], stone: ['#CFC8BD', .25, 0], metal: ['#6B6B6B', .3, 1], rug: ['#C9BFB0', .95, 0] },
  minimal: { wood: ['#C8AE8C', .5, 0], panel: ['#F3F2EF', .45, 0], soft: ['#DAD6CF', .9, 0], accent: ['#BFB8AC', .85, 0],
    cream: ['#F7F5F1', .9, 0], stone: ['#EDEBE7', .2, 0], metal: ['#D9D9D9', .3, 1], rug: ['#E6E1D8', .95, 0] },
  luxury: { wood: ['#3B2A20', .3, 0], panel: ['#2F2B28', .3, 0], soft: ['#5B4A3E', .7, 0], accent: ['#1F3A3D', .6, 0],
    cream: ['#E9E1D3', .8, 0], stone: ['#EDE7DF', .1, 0], metal: ['#C9A15A', .25, 1], rug: ['#7D6B5B', .95, 0] },
  'indian-contemporary': { wood: ['#6E4426', .4, 0], panel: ['#E4D7C3', .45, 0], soft: ['#B3563A', .8, 0], accent: ['#C68A2E', .75, 0],
    cream: ['#F0E6D6', .9, 0], stone: ['#D8CDBB', .3, 0], metal: ['#B08D57', .3, 1], rug: ['#9E3B2E', .95, 0] },
  scandinavian: { wood: ['#D2B48C', .55, 0], panel: ['#F4F3F0', .5, 0], soft: ['#C9C6BF', .9, 0], accent: ['#93A69A', .85, 0],
    cream: ['#FAF8F4', .9, 0], stone: ['#E8E6E1', .3, 0], metal: ['#1E1E1E', .4, 1], rug: ['#E3DDD2', .95, 0] },
}

const look = (color: string, rough = 0.6, metal = 0, extra: Partial<Look> = {}): Look => ({ color, rough, metal, ...extra })
const scale = (hex: string, k: number) => '#' + [1, 3, 5].map((i) => Math.min(255, Math.round(parseInt(hex.slice(i, i + 2), 16) * k)).toString(16).padStart(2, '0')).join('')
export const surfaceLook = (s: Surface): Look => ({ color: s.color, rough: s.rough, surface: { pattern: s.pattern, tileM: s.tileM, image: s.image } })

export function stylePalette(style: string) {
  const s = STYLES[style] ?? STYLES.modern
  const role = (r: Role) => look(s[r][0], s[r][1], s[r][2])
  return {
    wood: role('wood'), panel: role('panel'), fabric: role('soft'), accent: role('accent'), cream: role('cream'), stone: role('stone'),
    metal: role('metal'), rug: role('rug'), rugBorder: look(scale(s.rug[0], 0.55), 0.95),
    linen: look('#EFE9DF', 0.9), ceramic: look('#EDE8DF', 0.2), leaf: look('#3C6534', 0.6), soil: look('#3B2A1E', 0.95),
    shade: look('#F3E9D6', 0.7, 0, { emissive: '#FFC785', glow: 0.8 }), groove: look('#0B0B0B', 0.8), screen: look('#050506', 0.08),
    plant: look('#3E6B3A', 0.7), lamp: look('#F2E6D0', 0.8, 0, { emissive: '#FFD9A8', glow: 0.9 }), glass: look('#E6F2F7', 0.05, 0, { opacity: 0.3 }),
  }
}
type Palette = ReturnType<typeof stylePalette>

/** blender/interior_preview.py ROLE: what each rule-placed fixture box is made of */
const ROLE: Record<DollMat, keyof Palette> = {
  wood: 'wood', door: 'wood', panel: 'panel', sage: 'accent', blush: 'accent', clay: 'fabric', cream: 'cream', stone: 'stone', metal: 'metal',
  ceramic: 'cream', rug: 'rug', art: 'accent', glass: 'glass', stair: 'wood', floor: 'stone', wall: 'panel', plant: 'plant', lamp: 'lamp',
}

/** a deterministic 0..n-1 from a string — the bookshelf's books are the same every time */
const seeded = (text: string, n: number) => {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  return (h >>> 0) % n
}

const ANGLE: Record<Side, number> = { S: 0, E: Math.PI / 2, N: Math.PI, W: (3 * Math.PI) / 2 }

/** one designed piece as the Blender Builder composes it (blender/interior_furniture.py) */
function buildPiece(p: Piece, m: Palette, put: (b: DressBox) => void) {
  const add = put
  const a = ANGLE[p.face], c = Math.cos(a), s = Math.sin(a)
  const along = p.face === 'N' || p.face === 'S'
  const at = (lx: number, lz: number): [number, number] => [p.x + lx * c + lz * s, p.z - lx * s + lz * c]
  const part = (name: string, lx: number, lz: number, y0: number, y1: number, sx: number, sz: number, lk: Look, bevel = 0.004, shape: DressBox['shape'] = 'box') => {
    const [x, z] = at(lx, lz)
    add({ id: `${p.id}-${name}`, look: lk, pos: [x, (y0 + y1) / 2, z], size: along ? [sx, y1 - y0, sz] : [sz, y1 - y0, sx], shape, bevel })
  }
  const cyl = (name: string, lx: number, lz: number, y0: number, y1: number, r: number, lk: Look) => part(name, lx, lz, y0, y1, 2 * r, 2 * r, lk, 0, 'cyl')
  const ball = (name: string, lx: number, lz: number, y: number, [sx, sy, sz]: V3, lk: Look) => {
    const [x, z] = at(lx, lz)
    add({ id: `${p.id}-${name}`, look: lk, pos: [x, y, z], size: [2 * sx, 2 * sy, 2 * sz], shape: 'ball' })
  }
  const legs = (w: number, d: number, y0: number, y1: number, size: number, lk: Look, inset = 0.06) => {
    for (const [i, [sx, sz]] of ([[-1, -1], [1, -1], [-1, 1], [1, 1]] as const).entries()) part(`leg${i}`, sx * (w / 2 - inset), sz * (d / 2 - inset), y0, y1, size, size, lk)
  }
  const { w, d, h } = p
  const sofa = (armchair: boolean) => {
    const arm = armchair ? 0.14 : 0.16
    legs(w - 0.1, d - 0.1, 0, 0.1, 0.05, m.wood)
    part('base', 0, 0, 0.1, 0.3, w, d, m.fabric, 0.02)
    const n = armchair ? 1 : w >= 1.9 ? 3 : 2, inner = w - 2 * arm, cw = inner / n
    for (let i = 0; i < n; i++) {
      const lx = -inner / 2 + cw * (i + 0.5)
      part(`seat${i}`, lx, 0.08, 0.3, 0.46, cw - 0.012, d - 0.24, m.fabric, 0.045)
      part(`back${i}`, lx, -d / 2 + 0.17, 0.42, h, cw - 0.012, 0.2, m.fabric, 0.06)
    }
    part('backframe', 0, -d / 2 + 0.06, 0.3, h - 0.06, w, 0.12, m.fabric, 0.02)
    for (const side of [-1, 1]) part(`arm${side}`, side * (w / 2 - arm / 2), 0, 0.1, armchair ? 0.6 : 0.62, arm, d, m.fabric, 0.04)
    if (!armchair) for (const side of [-1, 1]) part(`cushion${side}`, side * (inner / 2 - 0.26), -d / 2 + 0.33, 0.46, 0.86, 0.42, 0.13, m.accent, 0.06)
  }
  const chair = (dining: boolean) => {
    legs(0.42, 0.42, 0, 0.44, 0.03, dining ? m.wood : m.metal, 0.03)
    part('seat', 0, 0.02, 0.44, 0.5, 0.46, 0.46, dining ? m.fabric : m.accent, 0.02)
    part('back', 0, -0.2, 0.5, h, 0.44, 0.04, dining ? m.wood : m.accent, 0.012)
  }
  const sideboard = () => {
    legs(w, d, 0, 0.14, 0.035, m.metal, 0.05)
    part('body', 0, 0, 0.14, h, w, d, m.wood)
    cyl('vase', -w * 0.3, 0, h, h + 0.32, 0.07, m.ceramic)
  }
  switch (p.type) {
    case 'sofa': return sofa(false)
    case 'armchair': return sofa(true)
    case 'coffee-table':
      part('top', 0, 0, h - 0.04, h, w, d, m.wood)
      part('shelf', 0, 0, 0.12, 0.14, w - 0.12, d - 0.12, m.wood)
      legs(w, d, 0, h - 0.04, 0.035, m.metal, 0.04)
      part('book1', -w * 0.2, 0.02, h, h + 0.035, 0.26, 0.2, m.accent)
      part('book2', -w * 0.2, 0.02, h + 0.035, h + 0.06, 0.22, 0.17, m.cream)
      return cyl('vase', w * 0.22, 0, h, h + 0.22, 0.05, m.ceramic)
    case 'tv-unit':
      part('plinth', 0, -0.02, 0, 0.06, w - 0.04, d - 0.06, m.groove)
      part('body', 0, 0, 0.06, h, w, d, m.wood)
      return cyl('decor', w * 0.38, 0, h, h + 0.28, 0.06, m.ceramic)
    case 'tv': {
      const y = p.y ?? 0.95
      part('bezel', 0, 0, y, y + h, w, 0.035, m.groove)
      return part('screen', 0, 0.019, y + 0.012, y + h - 0.012, w - 0.024, 0.002, m.screen)
    }
    case 'rug':
      part('rug', 0, 0, 0, 0.012, w, d, m.rugBorder)
      return part('rug-field', 0, 0, 0.012, 0.0135, w - 0.2, d - 0.2, m.rug)
    case 'side-table':
      cyl('top', 0, 0, h - 0.03, h, w / 2, m.wood)
      cyl('stem', 0, 0, 0.02, h - 0.03, 0.025, m.metal)
      return cyl('foot', 0, 0, 0, 0.02, w * 0.32, m.metal)
    case 'floor-lamp':
      cyl('foot', 0, 0, 0, 0.025, 0.15, m.metal)
      cyl('pole', 0, 0, 0.025, h - 0.3, 0.012, m.metal)
      return cyl('shade', 0, 0, h - 0.34, h, 0.2, m.shade)
    case 'table-lamp': {
      const y = p.y ?? 0.5
      cyl('base', 0, 0, y, y + 0.22, 0.06, m.ceramic)
      return cyl('shade', 0, 0, y + 0.22, y + 0.45, 0.14, m.shade)
    }
    case 'plant':
      cyl('pot', 0, 0, 0, 0.36, 0.17, m.ceramic)
      cyl('soil', 0, 0, 0.34, 0.36, 0.15, m.soil)
      for (let i = 0; i < 7; i++) {
        const t = i * 2.4, r = 0.05 + 0.03 * (i % 3)
        ball(`leaf${i}`, Math.cos(t) * r, Math.sin(t) * r, 0.62 + 0.09 * (i % 4), [0.09, 0.3, 0.09], m.leaf)
      }
      return
    case 'bed': {
      const low = (p.variant ?? '').includes('low'), bw = w - 0.1
      part('plinth', 0, 0.02, 0, 0.08, bw - 0.1, d - 0.14, m.groove)
      part('frame', 0, 0.03, 0.08, 0.3, bw, d - 0.06, m.wood, 0.01)
      part('mattress', 0, 0.05, 0.3, 0.52, bw - 0.06, d - 0.16, m.linen, 0.05)
      const duvet = (d - 0.16) * 0.68, dz = d / 2 - 0.08 - duvet / 2
      part('duvet', 0, dz, 0.5, 0.57, bw + 0.02, duvet, m.cream, 0.03)
      for (const side of [-1, 1]) part(`drape${side}`, side * (bw / 2 + 0.015), dz, 0.3, 0.57, 0.03, duvet, m.cream, 0.01)
      part('throw', 0, d / 2 - 0.4, 0.57, 0.6, bw + 0.03, 0.42, m.accent, 0.012)
      const n = bw < 1.4 ? 1 : 2
      for (let i = 0; i < n; i++) part(`pillow${i}`, n === 1 ? 0 : (i - 0.5) * (bw / 2), -d / 2 + 0.33, 0.52, 0.68, Math.min(0.62, bw / n - 0.12), 0.4, m.linen, 0.07)
      const top = low ? 0.85 : h
      part('headboard', 0, -d / 2 + 0.04, 0.08, top, w, 0.08, m.wood)
      return part('headpad', 0, -d / 2 + 0.1, 0.5, top - 0.06, w - 0.12, 0.06, m.fabric, 0.03)
    }
    case 'nightstand':
      legs(w, d, 0, 0.1, 0.03, m.metal, 0.03)
      part('body', 0, 0, 0.1, h, w, d, m.wood)
      return part('knob', 0, d / 2 + 0.01, h - 0.11, h - 0.09, 0.08, 0.015, m.metal)
    case 'wardrobe': {
      part('plinth', 0, -0.03, 0, 0.08, w - 0.02, d - 0.06, m.groove)
      part('body', 0, 0, 0.08, h, w, d, m.panel)
      const n = Math.max(2, Math.round(w / 0.55))
      for (let i = 0; i < n; i++) part(`handle${i}`, -w / 2 + (w * (i + 0.5)) / n + (w / n / 2 - 0.06) * (i % 2 === 0 ? 1 : -1), d / 2 + 0.015, 0.95, 1.35, 0.016, 0.02, m.metal)
      return
    }
    case 'desk':
      part('top', 0, 0, h - 0.03, h, w, d, m.wood)
      for (const side of [-1, 1]) part(`side${side}`, side * (w / 2 - 0.02), 0, 0, h - 0.03, 0.035, d - 0.04, m.wood)
      part('laptop', -w * 0.15, 0.02, h, h + 0.018, 0.33, 0.23, m.groove)
      return cyl('cup', w * 0.3, -0.1, h, h + 0.1, 0.04, m.ceramic)
    case 'chair': return chair(false)
    case 'dining-chair': return chair(true)
    case 'dining-table':
      part('top', 0, 0, h - 0.04, h, w, d, m.wood, 0.006)
      legs(w, d, 0, h - 0.04, 0.06, m.wood, 0.1)
      part('runner', 0, 0, h, h + 0.004, (w > d ? w : 0.32) * (w > d ? 0.6 : 1), w > d ? 0.32 : d * 0.6, m.linen)
      return cyl('bowl', 0, 0, h + 0.004, h + 0.09, 0.14, m.ceramic)
    case 'sideboard': case 'console': return sideboard()
    case 'bookshelf': {
      for (const side of [-1, 1]) part(`side${side}`, side * (w / 2 - 0.012), 0, 0, h, 0.025, d, m.wood)
      part('back', 0, -d / 2 + 0.01, 0, h, w, 0.02, m.wood)
      const levels = 5, books = [m.accent, m.fabric, m.cream, m.wood]
      for (let k = 0; k <= levels; k++) {
        const y = 0.04 + (k * (h - 0.06)) / levels
        part(`shelf${k}`, 0, 0, y, y + 0.022, w - 0.03, d - 0.01, m.wood)
        if (k === levels) continue
        // runs of books by colour, the same every time for this piece
        let x = -w / 2 + 0.05, i = 0
        while (x < w / 2 - 0.2 && i < 8) {
          const run = 0.12 + 0.04 * seeded(`${p.id}${k}${i}w`, 4), bh = 0.2 + 0.03 * seeded(`${p.id}${k}${i}h`, 4)
          if (seeded(`${p.id}${k}${i}gap`, 5) === 0) x += 0.1
          if (x + run > w / 2 - 0.05) break
          part(`book${k}-${i}`, x + run / 2, 0.02, y + 0.022, y + 0.022 + bh, run, d - 0.08, books[seeded(`${p.id}${k}${i}c`, 4)])
          x += run + 0.01
          i++
        }
      }
      return
    }
    // curtains, wall art and pendant lights hang above the cut line of the cut-away: there is no wall or ceiling there
    default: return
  }
}

const FITTING_METAL: Record<NonNullable<InteriorFinishes['fittings']>['finish'], Look> = {
  chrome: look('#D9DBDE', 0.12, 1), black: look('#080808', 0.4, 0.6), gold: look('#C9A15A', 0.22, 1),
}
const SINK_METAL: Record<NonNullable<InteriorFinishes['kitchenSink']>['finish'], Look> = {
  steel: look('#BBC0C3', 0.3, 0.7), black: look('#252729', 0.3), white: look('#F2F2EE', 0.3),
}

export type Building = ReturnType<typeof createBuildingModel>

/**
 * Dress one room for the furnished 3D view. `fin` is interiorFinishes for this room (null leaves the style's colours).
 * Throws where the 360 itself cannot isolate the room (a double-height gallery); the caller falls back.
 */
export function dressRoom(design: Design, building: Building, level: number, roomId: string, style: string, density: InteriorConfiguration['furnitureDensity'], fin: InteriorFinishes | null): DressedRoom {
  const { dims, furniture, pieces } = roomFurnishing(design, level, roomId, density, building)
  const m = stylePalette(style)
  const boxes: DressBox[] = []
  const add = (b: DressBox) => {
    if (b.size.every((v) => v > 0.004)) boxes.push(b)
  }
  for (const p of pieces) buildPiece(p, m, add)

  const ceramic = look('#F7F6F2', 0.12)
  const fittings = fin?.fittings ? FITTING_METAL[fin.fittings.finish] : null
  const counter = fin?.counter ? surfaceLook(fin.counter) : null
  const cab = fin?.cabinets
  const cabLook = !cab ? null : cab.glass ? look('#CCDBE0', 0.05, 0, { opacity: 0.6 })
    : cab.image ? look(cab.color, cab.gloss ? 0.18 : 0.4, 0, { surface: { pattern: 'image', tileM: 0.8, image: cab.image } }) : look(cab.color, cab.gloss ? 0.18 : 0.55)
  const find = (suffix: string) => furniture.find((b) => b.id.endsWith(suffix))
  const skip = new Set<string>()
  const hw = dims.w / 2, hd = dims.d / 2
  const nearest = (x: number, z: number): Side => {
    const gaps: Record<Side, number> = { N: z + hd, S: hd - z, W: x + hw, E: hw - x }
    return (Object.keys(gaps) as Side[]).sort((p, q) => gaps[p] - gaps[q])[0]
  }
  const oriented = (side: Side, w: number, h: number, d: number): V3 => (side === 'N' || side === 'S' ? [w, h, d] : [d, h, w])

  // ---- the bathroom fixtures chosen on Finishes & Cost (interior_bathroom.apply_bathroom)
  const wc = find('-wc'), sanitary = fin?.sanitary
  if (wc && sanitary) {
    skip.add(wc.id)
    const cistern = find('-cistern')
    if (cistern) skip.add(cistern.id)
    const [x, , z] = wc.pos, [w, , d] = wc.size, kind = sanitary.wc
    const bowlY = kind === 'indian' ? 0.035 : 0.39, bowlH = kind === 'indian' ? 0.06 : 0.18
    add({ id: `${roomId}-toilet`, look: ceramic, pos: [x, bowlY, z], size: [w * 0.96, bowlH, d * 0.91], shape: 'cyl' })
    if (kind === 'floor') add({ id: `${roomId}-toilet-pedestal`, look: ceramic, pos: [x, 0.16, z], size: [w * 0.5, 0.3, d * 0.56], bevel: 0.065 })
    if (kind === 'indian') for (const side of [-1, 1]) add({ id: `${roomId}-pan-foot${side}`, look: ceramic, pos: [x + side * w * 0.33, 0.035, z], size: [w * 0.2, 0.05, d * 0.72] })
    if (kind === 'wall') {
      const side = nearest(x, z)
      const pos: V3 = side === 'N' ? [x, 1.1, -hd + 0.04] : side === 'S' ? [x, 1.1, hd - 0.04] : side === 'W' ? [-hw + 0.04, 1.1, z] : [hw - 0.04, 1.1, z]
      add({ id: `${roomId}-flush-plate`, look: fittings ?? m.metal, pos, size: oriented(side, 0.2, 0.12, 0.015) })
    }
    // an Indian pan's cistern is high on the wall, above the cut line of the cut-away
    if (cistern && kind === 'floor') add({ id: `${roomId}-selected-cistern`, look: ceramic, pos: cistern.pos, size: cistern.size, bevel: 0.04 })
  }
  const basin = find('-basin'), basinChoice = fin?.basin
  if (basin && basinChoice) {
    skip.add(basin.id)
    const model = basinChoice.profile?.model ?? 'basin-oval'
    const vanity = find('-vanity')
    let [x, y, z] = basin.pos, [w, h, d] = basin.size
    if (model === 'basin-pedestal' && vanity) {
      skip.add(vanity.id)
      add({ id: `${roomId}-basin-pedestal`, look: ceramic, pos: [x, 0.37, z], size: [Math.min(w, d) * 0.38, 0.74, Math.min(w, d) * 0.38], shape: 'cyl' })
    }
    if (model === 'basin-square') w = d = Math.min(w, d)
    if (model === 'basin-undermount') {
      y -= 0.1
      if (vanity) { skip.add(vanity.id); add({ id: vanity.id, look: m.panel, pos: [vanity.pos[0], vanity.pos[1] - 0.09, vanity.pos[2]], size: [vanity.size[0], vanity.size[1] - 0.18, vanity.size[2]] }) }
    }
    const rect = ['basin-rectangle', 'basin-square', 'basin-undermount'].includes(model)
    add({ id: `${roomId}-selected-basin`, look: ceramic, pos: [x, y, z], size: [w, h, d], shape: rect ? 'box' : 'cyl' })
    const side = nearest(x, z), [dx, dz] = { N: [0, -1], S: [0, 1], W: [-1, 0], E: [1, 0] }[side]
    const mx = x + dx * w * 0.3, mz = z + dz * d * 0.3
    add({ id: `${roomId}-basin-mixer`, look: fittings ?? m.metal, pos: [mx, y + h / 2 + 0.08, mz], size: [0.036, 0.16, 0.036], shape: 'cyl' })
    add({ id: `${roomId}-basin-spout`, look: fittings ?? m.metal, pos: [mx - dx * 0.05, y + h / 2 + 0.14, mz - dz * 0.05], size: [dx ? 0.12 : 0.025, 0.025, dz ? 0.12 : 0.025] })
  }
  const glassBox = find('-shower-glass')
  if (glassBox && fin?.enclosure) {
    skip.add(glassBox.id)
    const accent = fin.enclosure.profile?.accent ?? '#AEB8BD'
    add({ id: glassBox.id, look: look('#E6F2F5', 0.03, 0, { opacity: 0.3 }), pos: glassBox.pos, size: glassBox.size })
    const horizontal = glassBox.size[0] > glassBox.size[2], span = horizontal ? glassBox.size[0] : glassBox.size[2]
    for (const off of [-span / 2, span / 2]) {
      const pos: V3 = [...glassBox.pos]
      pos[horizontal ? 0 : 2] += off
      add({ id: `${roomId}-enclosure-post${off > 0 ? 1 : 0}`, look: look(accent, 0.18, 1), pos, size: [0.022, glassBox.size[1], 0.022] })
    }
  }

  // ---- the kitchen as the 360 fits it (interior_finishes.kitchen_details): shutters and drawers on the base cabinets,
  //      handles or a handleless groove, a recessed plinth, and the chosen sink set into an opening in the worktop
  const handles = look('#C4C7CB', 0.18, 1), recess = look('#1F2224', 0.6)
  const hardware = fin?.kitchenHardware
  const frontOf = (side: Side, [x, y, z]: V3, depth: number): V3 => {
    const off = depth / 2 + 0.002
    return side === 'N' ? [x, y, z + off] : side === 'S' ? [x, y, z - off] : side === 'W' ? [x + off, y, z] : [x - off, y, z]
  }
  if (cabLook) for (const f of furniture) {
    if (f.mat !== 'panel' || !/-counter\d*$/.test(f.id)) continue
    const [x, y, z] = f.pos, [sx, sy, sz] = f.size
    const side = nearest(x, z), [width, depth] = side === 'N' || side === 'S' ? [sx, sz] : [sz, sx]
    const n = Math.max(1, Math.ceil(width / 0.6)), doorH = sy - 0.12, doorY = y + 0.04, rows = hardware?.drawers ? 3 : 1
    for (let k = 0; k < n; k++) {
      const a = -width / 2 + ((k + 0.5) * width) / n
      const centre: V3 = side === 'N' || side === 'S' ? [x + a, doorY, z] : [x, doorY, z + a]
      const front = frontOf(side, centre, depth)
      for (let row = 0; row < rows; row++) {
        const p: V3 = [front[0], doorY - doorH / 2 + ((row + 0.5) * doorH) / rows, front[2]]
        add({ id: `${f.id}-front-${k}-${row}`, look: cabLook, pos: p, size: oriented(side, width / n - 0.006, doorH / rows - 0.006, 0.018) })
        add({ id: `${f.id}-handle-${k}-${row}`, look: hardware?.handleless ? recess : handles, pos: frontOf(side, [p[0], p[1] + (doorH / rows) * 0.35, p[2]], 0.035), size: oriented(side, Math.min(0.18, (width / n) * 0.5), 0.015, 0.025) })
      }
    }
    add({ id: `${f.id}-toe`, look: recess, pos: frontOf(side, [x, 0.06, z], depth - 0.025), size: oriented(side, width - 0.02, 0.1, 0.015) })
  }
  const sinkBox = find('-sink'), sinkChoice = fin?.kitchenSink
  const sinkTop = sinkBox && furniture.find((f) => f.id.includes('-top') && f.mat === 'stone' && Math.abs(sinkBox.pos[0] - f.pos[0]) < f.size[0] / 2 && Math.abs(sinkBox.pos[2] - f.pos[2]) < f.size[2] / 2)
  if (sinkBox && sinkChoice && counter && sinkTop) {
    const [x, , z] = sinkBox.pos, [tx, ty, tz] = sinkTop.pos, [tw, th, td] = sinkTop.size
    const sw = Math.min(sinkBox.size[0], tw - 0.06), sd = Math.min(sinkBox.size[2], td - 0.06)
    const left = tx - tw / 2, right = tx + tw / 2, near = tz - td / 2, far = tz + td / 2
    const a = x - sw / 2, b = x + sw / 2, c = z - sd / 2, d = z + sd / 2
    if (Math.min(sw, sd) >= 0.15 && a > left && b < right && c > near && d < far) {
      skip.add(sinkTop.id).add(sinkBox.id)
      // four worktop strips leave a real opening, so the sink is seen set into the counter
      for (const [tag, pos, size] of [
        ['left', [(left + a) / 2, ty, tz], [a - left, th, td]], ['right', [(b + right) / 2, ty, tz], [right - b, th, td]],
        ['near', [x, ty, (near + c) / 2], [sw, th, c - near]], ['far', [x, ty, (d + far) / 2], [sw, th, far - d]],
      ] as [string, V3, V3][]) add({ id: `${sinkTop.id}-${tag}`, look: counter, pos, size })
      const rim = ty + th / 2 + 0.006, bottom = rim - 0.14, metal = SINK_METAL[sinkChoice.finish]
      // the cabinet under the sink stops below the bowl
      const body = furniture.find((f) => f.id === sinkTop.id.replace('-top', '-counter'))
      if (body) {
        const h = Math.min(body.size[1], bottom - 0.04)
        skip.add(body.id)
        add({ id: body.id, look: cabLook ?? m.panel, pos: [body.pos[0], h / 2, body.pos[2]], size: [body.size[0], h, body.size[2]], bevel: 0.008 })
      }
      for (const [tag, pos, size] of [
        ['n', [x, rim, c], [sw + 0.025, 0.012, 0.025]], ['s', [x, rim, d], [sw + 0.025, 0.012, 0.025]],
        ['w', [a, rim, z], [0.025, 0.012, sd]], ['e', [b, rim, z], [0.025, 0.012, sd]],
      ] as [string, V3, V3][]) add({ id: `${roomId}-sink-rim-${tag}`, look: metal, pos, size })
      const longX = sw >= sd
      for (let k = 0; k < sinkChoice.bowls; k++) {
        const [bw, bd] = longX ? [sw / sinkChoice.bowls, sd] : [sw, sd / sinkChoice.bowls]
        const [bx, bz] = longX ? [a + (k + 0.5) * bw, z] : [x, c + (k + 0.5) * bd]
        add({ id: `${roomId}-sink-bowl-${k}`, look: metal, pos: [bx, bottom, bz], size: [bw - 0.012, 0.012, bd - 0.012] })
        for (const [tag, pos, size] of [
          ['n', [bx, (rim + bottom) / 2, bz - bd / 2], [bw, 0.14, 0.012]], ['s', [bx, (rim + bottom) / 2, bz + bd / 2], [bw, 0.14, 0.012]],
          ['w', [bx - bw / 2, (rim + bottom) / 2, bz], [0.012, 0.14, bd]], ['e', [bx + bw / 2, (rim + bottom) / 2, bz], [0.012, 0.14, bd]],
        ] as [string, V3, V3][]) add({ id: `${roomId}-sink-${k}-${tag}`, look: metal, pos, size })
        add({ id: `${roomId}-sink-drain-${k}`, look: handles, pos: [bx, bottom + 0.008, bz], size: [0.046, 0.003, 0.046], shape: 'cyl' })
      }
      // the faucet: a riser at the back edge, arching over to the middle of the bowl
      const tap = find('-tap')
      if (tap) {
        skip.add(tap.id)
        const [fx, , fz] = tap.pos
        add({ id: `${roomId}-faucet-riser`, look: handles, pos: [fx, rim + 0.15, fz], size: [0.028, 0.3, 0.028], shape: 'cyl' })
        const mx = (fx + x) / 2, mz = (fz + z) / 2
        add({ id: `${roomId}-faucet-arch`, look: handles, pos: [mx, rim + 0.3, mz], size: [Math.max(0.028, Math.abs(x - fx) + 0.028), 0.028, Math.max(0.028, Math.abs(z - fz) + 0.028)] })
        add({ id: `${roomId}-faucet-spout`, look: handles, pos: [x, rim + 0.26, z], size: [0.028, 0.08, 0.028], shape: 'cyl' })
      }
    }
  }

  // ---- every other fitted piece: the style's material, or the finish chosen for it (interior_finishes.apply_finishes)
  for (const f of furniture) {
    if (skip.has(f.id)) continue
    const fid = f.id
    let lk: Look = m[ROLE[f.mat]] ?? m.panel
    if (counter && fid.includes('-top') && f.mat === 'stone') lk = counter
    else if (cabLook && (fid.includes('-counter') || fid.includes('-upper') || fid.includes('wall-cabinet')) && f.mat === 'panel') lk = cabLook
    else if (fin?.kitchenSink && /-sink$/.test(fid)) lk = SINK_METAL[fin.kitchenSink.finish]
    else if (fittings && f.mat === 'metal' && /tap|shower|sink/.test(fid)) lk = fittings
    else if (sanitary && f.mat === 'ceramic') lk = ceramic
    // fitted pieces have the 360's softened edges; sanitary ware is moulded, so rounder still
    add({ id: fid, look: lk, pos: f.pos, size: f.size, bevel: f.mat === 'ceramic' ? Math.min(...f.size) / 3 : 0.008 })
  }

  // nothing above the cut line of the cut-away: no water heater, wall cabinets, shower head, fans or ceiling lights

  // ---- floor, paint, tiles
  const wall = fin ? look(fin.walls.color, fin.walls.rough, fin.walls.metallic ? 0.35 : 0) : m.panel
  const floor = fin ? surfaceLook(fin.floor) : m.stone
  let tiles: DressedRoom['tiles']
  if (fin?.wallTiles) {
    const sides = new Set<Side>()
    if (fin.wallTiles.zone === 'backsplash') for (const f of furniture) if (/-counter\d*$/.test(f.id) && f.mat === 'panel') sides.add(nearest(f.pos[0], f.pos[2]))
    tiles = { look: surfaceLook(fin.wallTiles), zone: fin.wallTiles.zone, sides: [...sides] }
  }
  return { boxes, floor, wall, tiles }
}

/** the house-wide choices: door leaves (internal, main), window frames and glass */
export function houseLooks(fin: InteriorFinishes | null) {
  if (!fin) return null
  const doorLook = (d: InteriorFinishes['door']) => d.glass ? look('#D9EBF0', 0.03, 0, { opacity: 0.35 })
    : d.image ? look(d.color, 0.45, 0, { surface: { pattern: 'image', tileM: 1.0, image: d.image } }) : look(d.color, 0.45)
  return {
    door: doorLook(fin.door),
    mainDoor: doorLook(fin.mainDoor),
    frame: look(fin.windowFrame.color, 0.35, fin.windowFrame.color === '#B9BDC1' ? 0.6 : 0),
    slim: fin.windowFrame.slim,
    style: fin.windowFrame.style,
    grills: fin.grills.bars || fin.grills.mesh ? {
      look: look(fin.grills.stainless ? '#B7BABD' : '#4F5357', 0.25, 1),
      mesh: fin.grills.mesh, spacing: fin.grills.mesh ? 0.055 : fin.grills.decorative ? 0.12 : 0.16, decorative: fin.grills.decorative,
    } : null,
    glass: look(fin.glazing.solar ? '#A6B8C2' : '#E6F2FA', fin.glazing.frosted ? 0.65 : 0.03, 0, { opacity: fin.glazing.frosted ? 0.7 : 0.28 }),
  }
}


/** Dress the whole house for the furnished 3D view: each room in its own Finishes & Cost choices, the 360 panel's
 *  interior style and furniture density. Rebuilt whenever any of those change, so the view follows them live. */
export function furnishedDresser(design: Design, style: string, density: InteriorConfiguration['furnitureDensity']): Dresser {
  const building = createBuildingModel(design)
  const finishesOf = (level: number, roomId: string) => {
    try { return interiorFinishes(design, level, roomId) } catch { return null }
  }
  const first = design.floors.flatMap((f) => f.rooms.filter((r) => !r.outdoor).map((r) => [f.level, r.id] as const))[0]
  return {
    room: (level, roomId) => dressRoom(design, building, level, roomId, style, density, finishesOf(level, roomId)),
    house: first ? houseLooks(finishesOf(first[0], first[1])) : null,
  }
}
