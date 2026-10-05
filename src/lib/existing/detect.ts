import type { Detections, Pt } from './types.ts'

/* Lightweight, free, deterministic image analysis (no model, no network): grayscale -> blur -> gradients ->
 * long vertical edge pairs (columns) and long horizontal edge pairs (beams). It only proposes; every
 * detection carries a confidence and the user corrects and confirms it. */

export type ImageLike = { data: Uint8ClampedArray | Uint8Array | number[]; width: number; height: number }
export type RawColumn = { x: number; width: number; y0: number; y1: number; confidence: number }
export type RawBeam = { x0: number; x1: number; y: number; thickness: number; confidence: number }
export type RawFooting = { x: number; y: number; w: number; h: number; confidence: number }
export type RawAnalysis = { columns: RawColumn[]; beams: RawBeam[]; footings?: RawFooting[]; scale: number; width: number; height: number; engine?: 'opencv' | 'basic' }

const MAX_SIDE = 640

export function gray(img: ImageLike): { g: Float32Array; w: number; h: number; scale: number } {
  const scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height))
  const w = Math.max(8, Math.round(img.width * scale)), h = Math.max(8, Math.round(img.height * scale))
  const g = new Float32Array(w * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    // box average of the source pixels this one covers
    const sx0 = Math.floor(x / scale), sx1 = Math.max(sx0 + 1, Math.floor((x + 1) / scale))
    const sy0 = Math.floor(y / scale), sy1 = Math.max(sy0 + 1, Math.floor((y + 1) / scale))
    let sum = 0, n = 0
    for (let yy = sy0; yy < Math.min(sy1, img.height); yy++) for (let xx = sx0; xx < Math.min(sx1, img.width); xx++) {
      const i = (yy * img.width + xx) * 4
      sum += 0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2]; n++
    }
    g[y * w + x] = n ? sum / n : 0
  }
  // 3x3 box blur
  const b = new Float32Array(w * h)
  const px = (x: number, y: number) => g[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))]
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += px(x + dx, y + dy)
    b[y * w + x] = s / 9
  }
  return { g: b, w, h, scale }
}

type Edge = { pos: number; a: number; b: number; sign: number; strength: number }

/** long straight edge runs along one axis; `vertical` scans y for each x */
export function edgeRuns(g: Float32Array, w: number, h: number, vertical: boolean, minLen: number): { edges: Edge[]; grad: Float32Array } {
  const grad = new Float32Array(w * h)
  const vals: number[] = []
  for (let y = 3; y < h - 3; y++) for (let x = 3; x < w - 3; x++) {
    const d = vertical ? g[y * w + x + 1] - g[y * w + x - 1] : g[(y + 1) * w + x] - g[(y - 1) * w + x]
    grad[y * w + x] = d
    if (Math.abs(d) > 2) vals.push(Math.abs(d))
  }
  vals.sort((p, q) => p - q)
  const p97 = vals.length ? vals[Math.floor(vals.length * 0.97)] : 0
  const thr = Math.max(8, p97 * 0.3)
  const outer = vertical ? w : h, inner = vertical ? h : w
  const at = (o: number, i: number) => (vertical ? grad[i * w + o] : grad[o * w + i])
  const runs: Edge[] = []
  for (let o = 3; o < outer - 3; o++) {
    let start = -1, gap = 0, sign = 0, sum = 0, n = 0
    const close = (end: number) => {
      if (start >= 0 && end - start >= minLen) runs.push({ pos: o, a: start, b: end, sign, strength: sum / Math.max(1, n) })
      start = -1; gap = 0; sign = 0; sum = 0; n = 0
    }
    for (let i = 3; i < inner - 3; i++) {
      const d = at(o, i), s = Math.sign(d)
      if (Math.abs(d) > thr) {
        if (start < 0) { start = i; sign = s }
        gap = 0; sum += Math.abs(d); n++
      } else if (start >= 0) {
        gap++
        if (gap > 2) close(i - gap)
      }
    }
    if (start >= 0) close(inner - 4 - gap)
  }
  // merge neighbouring positions (an edge is 1 to 3 pixels wide)
  const merged: Edge[] = []
  for (const r of runs.sort((p, q) => p.pos - q.pos)) {
    const last = merged[merged.length - 1]
    const overlap = last ? Math.min(last.b, r.b) - Math.max(last.a, r.a) : 0
    if (last && r.pos - last.pos <= 2 && overlap > 0.5 * Math.min(last.b - last.a, r.b - r.a)) {
      last.pos = (last.pos * (last.b - last.a) + r.pos * (r.b - r.a)) / ((last.b - last.a) + (r.b - r.a))
      last.a = Math.min(last.a, r.a); last.b = Math.max(last.b, r.b); last.strength = Math.max(last.strength, r.strength)
    } else merged.push({ ...r })
  }
  return { edges: merged.sort((p, q) => p.pos - q.pos), grad }
}

/** bars = two opposite-sign parallel edges close together that overlap along their length */
function pairEdges(edges: Edge[], grad: Float32Array, w: number, vertical: boolean, minGap: number, maxGap: number, minOverlap: number) {
  const g = (o: number, i: number) => (vertical ? grad[i * w + Math.round(o)] : grad[Math.round(o) * w + i])
  const out: { pos: number; gap: number; a: number; b: number; strength: number }[] = []
  for (let i = 0; i < edges.length; i++) for (let j = i + 1; j < edges.length; j++) {
    const e = edges[i], f = edges[j], gap = f.pos - e.pos
    if (gap < minGap) continue
    if (gap > maxGap) break
    const a = Math.max(e.a, f.a), b = Math.min(e.b, f.b)
    if (b - a < minOverlap) continue
    // the two edges of a bar step in opposite directions on (nearly) every row
    let opposite = 0, rows = 0
    for (let i = a; i <= b; i += 2) { rows++; if (g(e.pos, i) * g(f.pos, i) < 0) opposite++ }
    if (rows === 0 || opposite / rows < 0.7) continue
    out.push({ pos: (e.pos + f.pos) / 2, gap, a, b, strength: Math.min(e.strength, f.strength) })
  }
  return out
}

export function analyzeImage(img: ImageLike): RawAnalysis {
  const { g, w, h, scale } = gray(img)
  const columns: RawColumn[] = []
  const v = edgeRuns(g, w, h, true, Math.max(12, Math.round(h * 0.08)))
  for (const p of pairEdges(v.edges, v.grad, w, true, 3, Math.round(w * 0.14), Math.max(12, Math.round(h * 0.08)))) {
    const len = p.b - p.a
    const confidence = Math.min(1, 0.45 * Math.min(1, len / (h * 0.22)) + 0.4 * Math.min(1, p.strength / 45) + 0.15)
    columns.push({ x: p.pos, width: p.gap, y0: p.a, y1: p.b, confidence })
  }
  const kept: RawColumn[] = []
  for (const c of columns.sort((a, b) => b.confidence - a.confidence)) {
    const clash = kept.some((k) => Math.abs(k.x - c.x) < Math.max(k.width, c.width) * 0.9)
    if (!clash) kept.push(c)
  }
  const beams: RawBeam[] = []
  const hz = edgeRuns(g, w, h, false, Math.max(20, Math.round(w * 0.12)))
  for (const p of pairEdges(hz.edges, hz.grad, w, false, 3, Math.round(h * 0.1), Math.max(20, Math.round(w * 0.12)))) {
    const len = p.b - p.a
    beams.push({ x0: p.a, x1: p.b, y: p.pos, thickness: p.gap, confidence: Math.min(1, 0.5 * Math.min(1, len / (w * 0.3)) + 0.35 * Math.min(1, p.strength / 45) + 0.15) })
  }
  const keptBeams: RawBeam[] = []
  for (const b of beams.sort((p, q) => q.confidence - p.confidence)) {
    const clash = keptBeams.some((k) => Math.abs(k.y - b.y) < Math.max(k.thickness, b.thickness) && Math.min(k.x1, b.x1) - Math.max(k.x0, b.x0) > 0.5 * (b.x1 - b.x0))
    if (!clash) keptBeams.push(b)
  }
  return { columns: kept.slice(0, 40).sort((a, b) => a.x - b.x), beams: keptBeams.slice(0, 20), scale, width: w, height: h, engine: 'basic' }
}

/** Turn the raw analysis into editable detections in the original picture pixel coordinates. */
export function toDetections(raw: RawAnalysis): Detections {
  const s = 1 / raw.scale
  const columns = raw.columns.map((c, i) => ({
    id: `col-${i + 1}`, img: { x: Math.round(c.x * s), y: Math.round(c.y1 * s) } as Pt, top: { x: Math.round(c.x * s), y: Math.round(c.y0 * s) } as Pt,
    widthPx: Math.round(c.width * s), confidence: Math.round(c.confidence * 100) / 100, source: 'auto' as const, confirmed: false,
  }))
  const beams: Detections['beams'] = []
  let n = 0
  const seen = new Set<string>()
  const link = (a: (typeof columns)[number], b: (typeof columns)[number], conf: number) => {
    const key = [a.id, b.id].sort().join('|')
    // a beam runs along one row of columns: both bases are at about the same height in the picture
    if (a.id === b.id || seen.has(key) || Math.abs(a.img.y - b.img.y) > Math.max(16, 0.05 * raw.height * s)) return
    seen.add(key); n++
    beams.push({ id: `beam-${n}`, a: a.id, b: b.id, confidence: Math.round(Math.min(conf, a.confidence, b.confidence) * 100) / 100, source: 'auto', confirmed: false })
  }
  for (const b of raw.beams) {
    // a beam bar runs between columns (the columns break it) or across several: join every column pair it reaches
    const tol = Math.max(24, (columns.reduce((m, c) => m + c.widthPx, 0) / Math.max(1, columns.length)) * 2)
    // a floor-level (plinth) beam meets the column feet; a roof-level beam meets their tops
    const atHeight = columns.filter((c) => (c.top && Math.abs(c.top.y - b.y * s) <= Math.max(18, b.thickness * s * 3)) || Math.abs(c.img.y - b.y * s) <= Math.max(18, b.thickness * s * 3))
    const near = (x: number) => atHeight.filter((c) => Math.abs(c.img.x - x) <= tol).sort((p, q) => Math.abs(p.img.x - x) - Math.abs(q.img.x - x))[0]
    const left = near(b.x0 * s), right = near(b.x1 * s)
    if (left && right) link(left, right, b.confidence)
    const inside = atHeight.filter((c) => c.img.x >= b.x0 * s - tol && c.img.x <= b.x1 * s + tol).sort((p, q) => p.img.x - q.img.x)
    for (let k = 0; k < inside.length - 1; k++) link(inside[k], inside[k + 1], b.confidence)
  }
  const footings = (raw.footings ?? []).map((f, i) => ({ id: `foot-${i + 1}`, img: { x: Math.round(f.x * s), y: Math.round(f.y * s) } as Pt,
    confidence: Math.round(f.confidence * 100) / 100, source: 'auto' as const, confirmed: false }))
  return { columns, beams, footings, walls: [],
    seen: { foundation: footings.length > 0, columns: columns.length > 0, beams: beams.length > 0, slab: false, walls: false } }
}
