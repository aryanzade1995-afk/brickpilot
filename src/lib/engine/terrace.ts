import { type Rect, rectBottom, rectRight } from '../geometry.ts'
import { themeOf } from '../model/themes.ts'
import type { Design, FloorPlan } from './types.ts'

/* ------------------------------------------------------------------ *
 *  The roof terrace over the top floor: stair headroom room ("mumty"),
 *  water tank and pergola. One layout, read by BOTH the 3D builder and
 *  the 2D terrace sheet, so the two can never disagree.
 * ------------------------------------------------------------------ */

export type TerraceLayout = {
  /** the storey whose roof this is */
  level: number
  /** walkable roof: the top floor's footprint */
  slab: Rect[]
  outline: Rect
  /** stair headroom room — encloses the whole stair so the flight is covered */
  mumty: Rect | null
  tank: Rect | null
  /** slatted pergola over a deck, if the design has one */
  pergola: Rect | null
}

const overlaps = (a: Rect, b: Rect, gap = 0) =>
  a.x < rectRight(b) + gap && rectRight(a) + gap > b.x && a.y < rectBottom(b) + gap && rectBottom(a) + gap > b.y

/** stair headroom room + water tank on a flat top roof */
export function roofServiceLayout(tf: FloorPlan): { mumty: Rect | null; tank: Rect } {
  const o = tf.outline
  const st = tf.stair?.rect
  let mumty: Rect | null = null
  if (st) {
    // the headroom room is the stair enclosure itself
    mumty = { ...st }
  } else {
    const mw = Math.min(2200, o.w - 1100)
    const md = Math.min(2500, o.h - 1100)
    if (mw > 1400 && md > 1400) mumty = { x: rectRight(o) - mw - 600, y: o.y + 600, w: mw, h: md }
  }
  // the tank takes the first roof corner clear of the headroom room
  const T = 1100
  const corners: Rect[] = [
    { x: rectRight(o) - 720 - T / 2, y: o.y + 720 - T / 2, w: T, h: T },
    { x: o.x + 720 - T / 2, y: o.y + 720 - T / 2, w: T, h: T },
    { x: rectRight(o) - 720 - T / 2, y: rectBottom(o) - 720 - T / 2, w: T, h: T },
    { x: o.x + 720 - T / 2, y: rectBottom(o) - 720 - T / 2, w: T, h: T },
  ]
  const tank = corners.find((c) => !mumty || !overlaps(c, mumty, 300)) ?? corners[0]
  return { mumty, tank }
}

/** where a pergola of up to 4.4 × 3.8 m fits on the roof, clear of `blocked` */
export function pergolaLayout(o: Rect, blocked: Rect[]): Rect | null {
  const pw = Math.min(o.w * 0.55, 4400)
  const pd = Math.min(o.h * 0.45, 3800)
  if (pw < 2200 || pd < 1900) return null
  const candidates: [number, number][] = [
    [o.x + 400, o.y + o.h - pd - 350],
    [o.x + o.w - pw - 400, o.y + o.h - pd - 350],
    [o.x + 400, o.y + 350],
    [o.x + o.w - pw - 400, o.y + 350],
  ]
  const safe = candidates.find(([x, z]) => blocked.every((r) =>
    x + pw + 300 <= r.x || x - 300 >= r.x + r.w || z + pd + 300 <= r.y || z - 300 >= r.y + r.h))
  return safe ? { x: safe[0], y: safe[1], w: pw, h: pd } : null
}

const isFlat = (f: FloorPlan) => f.roof.kind === 'flat' || f.roof.kind === 'flat-parapet'

/** the top-floor roof terrace, or null when the top roof is pitched */
export function terraceLayout(design: Design): TerraceLayout | null {
  const tf = design.floors[design.floors.length - 1]
  if (!tf || !isFlat(tf)) return null
  const T = themeOf(design.model.brief)
  const services = T.landscape.roofServices ? roofServiceLayout(tf) : { mumty: null, tank: null }
  let pergola: Rect | null = null
  if (design.dna.roofDesign === 'pergola-terrace') {
    const blocked = tf.rooms.filter((r) => r.id === 'stair' || r.id === 'lift').map((r) => r.rect)
    if (services.mumty) blocked.push(services.mumty)
    if (services.tank) blocked.push(services.tank)
    // a roof of several blocks: the pergola stands wholly on one, largest first
    const decks = tf.footprint.length === 1 ? [tf.outline] : [...tf.footprint].sort((a, b) => b.w * b.h - a.w * a.h)
    for (const deck of decks) if (!pergola) pergola = pergolaLayout(deck, blocked)
  }
  return { level: tf.level, slab: tf.footprint, outline: tf.outline, mumty: services.mumty, tank: services.tank, pergola }
}
