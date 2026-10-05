import type { DetBeam, DetColumn, Pt } from './types.ts'

/* Automatic clean-up and calibration of what the photo analysis found. No browser or model code here, so it can be tested. */

export type Mask = { base: Pt; top: Pt; widthPx: number; heightPx: number; bbox: { x0: number; y0: number; x1: number; y1: number } }

const median = (v: number[]) => { const s = [...v].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0 }
const iou = (a: Mask['bbox'], b: Mask['bbox']) => {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0), h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0)
  if (w <= 0 || h <= 0) return 0
  const i = w * h, u = (a.x1 - a.x0) * (a.y1 - a.y0) + (b.x1 - b.x0) * (b.y1 - b.y0) - i
  return i / u
}

/** one mask per physical column, and only masks that look like the others: columns of one structure are alike in width and height,
 *  so a pole, a tree or a stack of rebar that happens to be tall and narrow is dropped */
export function consistentColumns(masks: Mask[]): Mask[] {
  const unique: Mask[] = []
  for (const m of masks) if (!unique.some((u) => iou(u.bbox, m.bbox) > 0.4)) unique.push(m)
  if (unique.length < 3) return unique
  const w = median(unique.map((m) => m.widthPx)), h = median(unique.map((m) => m.heightPx))
  return unique.filter((m) => m.widthPx >= w * 0.5 && m.widthPx <= w * 1.9 && m.heightPx >= h * 0.5 && m.heightPx <= h * 1.7)
}

/** the four ground corners of the structure, from the column bases: back-left, back-right, front-right, front-left.
 *  null when the photo shows only one line of columns (the other side cannot be seen) */
export function autoCorners(columns: Pick<DetColumn, 'img'>[]): Pt[] | null {
  if (columns.length < 4) return null
  const pts = columns.map((c) => c.img).sort((a, b) => a.y - b.y)
  const spread = pts[pts.length - 1].y - pts[0].y
  const xs = pts.map((p) => p.x)
  const width = Math.max(...xs) - Math.min(...xs)
  // a single row of columns is level with the ground line: little vertical spread compared with its length
  if (spread < width * 0.12) return null
  // split rows at the largest vertical gap
  let cut = 0, gap = 0
  for (let i = 1; i < pts.length; i++) if (pts[i].y - pts[i - 1].y > gap) { gap = pts[i].y - pts[i - 1].y; cut = i }
  if (gap < spread * 0.25) return null
  const back = pts.slice(0, cut), front = pts.slice(cut)
  const left = (g: Pt[]) => g.reduce((a, p) => (p.x < a.x ? p : a))
  const right = (g: Pt[]) => g.reduce((a, p) => (p.x > a.x ? p : a))
  return [left(back), right(back), right(front), left(front)]
}

/** beams the first analysis found, carried onto the final columns by position */
export function carryBeams(oldColumns: DetColumn[], oldBeams: DetBeam[], columns: DetColumn[]): DetBeam[] {
  const near = (c: DetColumn) => {
    let best: DetColumn | null = null, d = Infinity
    for (const n of columns) { const dd = Math.hypot(n.img.x - c.img.x, n.img.y - c.img.y); if (dd < d) { d = dd; best = n } }
    return best && d <= Math.max(30, best.widthPx * 2) ? best : null
  }
  const out: DetBeam[] = []
  const seen = new Set<string>()
  for (const b of oldBeams) {
    const a = oldColumns.find((c) => c.id === b.a), c = oldColumns.find((x) => x.id === b.b)
    const na = a && near(a), nb = c && near(c)
    if (!na || !nb || na.id === nb.id) continue
    const key = [na.id, nb.id].sort().join('|')
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ id: `beam-${out.length + 1}`, a: na.id, b: nb.id, confidence: b.confidence, source: 'auto', confirmed: true })
  }
  return out
}
