import { type Rect, rectBottom, rectRight, rectUnionArea, rectUnionEdges } from '../geometry.ts'
import { uncoveredArea } from './massing/families.ts'
import type { Design, FloorPlan } from './types.ts'

/* ------------------------------------------------------------------ *
 *  The roof terrace over the top floor: stair headroom room ("mumty"),
 *  water tank. One layout, read by BOTH the 3D builder and
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
export function roofServiceLayout(tf: FloorPlan): { mumty: Rect | null; tank: Rect | null } {
  const o = tf.outline
  const st = tf.stair?.rect
  let mumty: Rect | null = null
  if (st) {
    // the headroom room is the stair enclosure itself
    mumty = { ...st }
  }
  // the tank takes the first roof corner clear of the headroom room
  const T = 1100
  const corners: Rect[] = [
    { x: rectRight(o) - 720 - T / 2, y: o.y + 720 - T / 2, w: T, h: T },
    { x: o.x + 720 - T / 2, y: o.y + 720 - T / 2, w: T, h: T },
    { x: rectRight(o) - 720 - T / 2, y: rectBottom(o) - 720 - T / 2, w: T, h: T },
    { x: o.x + 720 - T / 2, y: rectBottom(o) - 720 - T / 2, w: T, h: T },
  ]
  const allCorners = tf.footprint.flatMap(p => [
    { x:p.x+180, y:p.y+180, w:T, h:T },
    { x:p.x+p.w-T-180, y:p.y+180, w:T, h:T },
    { x:p.x+180, y:p.y+p.h-T-180, w:T, h:T },
    { x:p.x+p.w-T-180, y:p.y+p.h-T-180, w:T, h:T },
  ])
  const tank = [...corners, ...allCorners].find(c => uncoveredArea([c], tf.footprint) <= 1 && (!mumty || !overlaps(c,mumty,300))) ?? null
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
  const services = roofServiceLayout(tf)
  return { level: tf.level, slab: tf.footprint, outline: tf.outline, mumty: services.mumty, tank: services.tank, pergola: null }
}

export const TERRACE_LIMITS = { minFreeRatio: .8, planningClearanceMargin: .01, parapetThicknessMm: 120, headroomHeightMm: 2200, tankStandHeightMm: 800 } as const
export function terraceFreeRatio(layout: TerraceLayout, extra: Rect[] = []): number {
  const guards = rectUnionEdges(layout.slab).map(e => {
    const horizontal=e.side==='N'||e.side==='S', t=TERRACE_LIMITS.parapetThicknessMm
    return horizontal ? {x:e.a.x,y:e.a.y-(e.side==='S'?t:0),w:e.b.x-e.a.x,h:t} : {x:e.a.x-(e.side==='E'?t:0),y:e.a.y,w:t,h:e.b.y-e.a.y}
  })
  const blocked=[...guards,...extra,...(layout.mumty?[layout.mumty]:[]),...(layout.tank?[layout.tank]:[])]
  // Clip all obstructions against the actual union rather than its bounding box.
  const cuts=blocked.flatMap(c=>layout.slab.flatMap(p=>{
   const x=Math.max(p.x,c.x),y=Math.max(p.y,c.y),w=Math.min(p.x+p.w,c.x+c.w)-x,h=Math.min(p.y+p.h,c.y+c.h)-y
   return w>0&&h>0?[{x,y,w,h}]:[]
  }))
  return 1-rectUnionArea(cuts)/rectUnionArea(layout.slab)
}

/** The water-tank slot, widened along the roof edge to carry up to three tanks where the deck and the
 *  stair room leave room. The engine's own `tank` slot stays one tank; this is only what is drawn. */
export function tankBank(layout: TerraceLayout): Rect | null {
  const t = layout.tank
  if (!t) return null
  const T = t.w
  const onRoof = (r: Rect) => layout.slab.some(p => r.x >= p.x && r.y >= p.y && rectRight(r) <= rectRight(p) && rectBottom(r) <= rectBottom(p))
  const clear = (r: Rect) => !layout.mumty || !overlaps(r, layout.mumty, 300)
  for (const n of [2, 1]) {                        // extra tanks beyond the first
    const grow = n * (T + 100)
    const options: Rect[] = [
      { ...t, w: t.w + grow }, { ...t, x: t.x - grow, w: t.w + grow },
      { ...t, h: t.h + grow }, { ...t, y: t.y - grow, h: t.h + grow },
    ]
    const found = options.find(r => onRoof(r) && clear(r))
    if (found) return found
  }
  return t
}
