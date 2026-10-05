import type { ImageLike, RawAnalysis, RawBeam, RawColumn, RawFooting } from './detect.ts'

/* OpenCV pipeline for site photos (runs in the browser through opencv.js, no server, no model download):
 *   resize -> gray -> CLAHE (even out sun and shade) -> blur -> Canny (thresholds from the image median)
 *   -> probabilistic Hough line segments -> keep the near-vertical ones around the photo's own vertical
 *   direction (so a tilted camera still works) -> merge collinear pieces into long lines
 *   -> pair parallel lines into slender bars (columns), rejecting anything that is not tall and narrow
 *   -> horizontal lines that tie neighbouring columns together are beams
 *   -> grey concrete blobs near the ground, squarish and solid, are candidate footings.
 * It only proposes. Every result carries a confidence and the user corrects it. */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type CV = any

const MAX_SIDE = 960

type Seg = { x1: number; y1: number; x2: number; y2: number; len: number; ang: number }
type VLine = { x: number; y0: number; y1: number; strength: number; tilt: number }
type HLine = { x0: number; x1: number; y0: number; y1: number; strength: number }

const median = (v: number[]) => { const s = [...v].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0 }
const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v))

export function detectWithOpenCV(cv: CV, img: ImageLike, debug?: Record<string, number>): RawAnalysis {
  const scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height))
  const w = Math.max(32, Math.round(img.width * scale)), h = Math.max(32, Math.round(img.height * scale))
  const mats: { delete: () => void }[] = []
  const keep = <T extends { delete: () => void }>(m: T): T => { mats.push(m); return m }
  try {
    const rgba = keep(cv.matFromArray(img.height, img.width, cv.CV_8UC4, Array.from(img.data as ArrayLike<number>)))
    const small = keep(new cv.Mat())
    cv.resize(rgba, small, new cv.Size(w, h), 0, 0, cv.INTER_AREA)
    const gray = keep(new cv.Mat())
    cv.cvtColor(small, gray, cv.COLOR_RGBA2GRAY)
    const eq = keep(new cv.Mat())
    const clahe = new cv.CLAHE(2.5, new cv.Size(8, 8)); clahe.apply(gray, eq); clahe.delete()
    const blur = keep(new cv.Mat())
    cv.GaussianBlur(eq, blur, new cv.Size(5, 5), 0)

    // Canny thresholds from the picture itself (a dark and a bright photo need different ones)
    const m = median(Array.from(blur.data as Uint8Array).filter((_, i) => i % 7 === 0))
    const edges = keep(new cv.Mat())
    cv.Canny(blur, edges, Math.max(18, 0.55 * m), Math.max(55, 1.2 * m))
    // close one-pixel gaps so a long edge is one run
    const kernel = keep(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3)))
    cv.morphologyEx(edges, edges, cv.MORPH_CLOSE, kernel)

    const lines = keep(new cv.Mat())
    cv.HoughLinesP(edges, lines, 1, Math.PI / 180, 38, Math.round(h * 0.07), Math.max(8, Math.round(h * 0.012)))
    const segs: Seg[] = []
    for (let i = 0; i < Math.floor(lines.data32S.length / 4); i++) {
      const [x1, y1, x2, y2] = [lines.data32S[i * 4], lines.data32S[i * 4 + 1], lines.data32S[i * 4 + 2], lines.data32S[i * 4 + 3]]
      const len = Math.hypot(x2 - x1, y2 - y1)
      // angle from vertical, in degrees, -90..90
      const ang = (Math.atan2(x2 - x1, y2 - y1) * 180) / Math.PI
      segs.push({ x1, y1, x2, y2, len, ang: ang > 90 ? ang - 180 : ang < -90 ? ang + 180 : ang })
    }
    const nearV = segs.filter((s) => Math.abs(s.ang) < 25)
    // the photo's own vertical direction (a tilted camera leans every vertical the same way)
    const weighted: number[] = []
    for (const s of nearV) for (let k = 0; k < Math.min(8, Math.round(s.len / 10)); k++) weighted.push(s.ang)
    const tilt = median(weighted)
    const tol = 7
    const vSegs = nearV.filter((s) => Math.abs(s.ang - tilt) < tol && s.len >= h * 0.06)
    const hSegs = segs.filter((s) => Math.abs(Math.abs(s.ang) - 90) < 14 && s.len >= w * 0.08)

    // ---- merge collinear vertical pieces into long lines ----
    const midX = (s: Seg, y: number) => (Math.abs(s.y2 - s.y1) < 1 ? (s.x1 + s.x2) / 2 : s.x1 + ((y - s.y1) * (s.x2 - s.x1)) / (s.y2 - s.y1))
    const rows = Math.round(h * 0.5)
    const vlines: VLine[] = []
    for (const s of [...vSegs].sort((a, b) => midX(a, rows) - midX(b, rows))) {
      const x = midX(s, rows), y0 = Math.min(s.y1, s.y2), y1 = Math.max(s.y1, s.y2)
      const host = vlines.find((l) => Math.abs(l.x - x) <= Math.max(3, w * 0.004) && y0 <= l.y1 + h * 0.06 && y1 >= l.y0 - h * 0.06)
      if (host) { host.y0 = Math.min(host.y0, y0); host.y1 = Math.max(host.y1, y1); host.strength += s.len; host.x = (host.x * 0.7 + x * 0.3) }
      else vlines.push({ x, y0, y1, strength: s.len, tilt: s.ang })
    }
    const tallEnough = vlines.filter((l) => l.y1 - l.y0 >= h * 0.1).sort((a, b) => a.x - b.x)
    if (debug) Object.assign(debug, { segs: segs.length, nearV: nearV.length, vSegs: vSegs.length, vlines: vlines.length, tall: tallEnough.length, tilt })

    // ---- pair parallel lines into slender bars: these are the columns ----
    const gradX = keep(new cv.Mat()); cv.Sobel(blur, gradX, cv.CV_16S, 1, 0)
    const edgeDensity = (xa: number, xb: number, ya: number, yb: number) => {
      let on = 0, n = 0
      for (let y = Math.max(0, Math.round(ya)); y < Math.min(h, Math.round(yb)); y += 3) for (let x = Math.max(0, Math.round(xa) + 4); x < Math.min(w, Math.round(xb) - 3); x += 2) { n++; if (edges.data[y * w + x]) on++ }
      return n ? on / n : 1
    }
    type Cand = RawColumn & { score: number; lo: number; hi: number }
    const cands: Cand[] = []
    for (let i = 0; i < tallEnough.length; i++) for (let j = i + 1; j < tallEnough.length; j++) {
      const a = tallEnough[i], b = tallEnough[j], gap = b.x - a.x
      if (gap < Math.max(6, w * 0.011)) continue
      if (gap > w * 0.17) break
      const y0 = Math.max(a.y0, b.y0), y1 = Math.min(a.y1, b.y1), ov = y1 - y0
      if (ov < h * 0.09) continue
      const shorter = Math.min(a.y1 - a.y0, b.y1 - b.y0)
      if (ov / shorter < 0.6) continue
      if ((y1 - y0) / gap < 2.6) continue            // a column is slender: tall compared with its width
      const dens = edgeDensity(a.x, b.x, y0, y1)
      if (debug) debug.pairs = (debug.pairs ?? 0) + 1
      if (dens > 0.3) { if (debug) debug.busy = (debug.busy ?? 0) + 1; continue }                       // the face of a column is smooth, a window or a wall is busy
      const score = clamp(0.3 * clamp(ov / (h * 0.35)) + 0.25 * clamp((a.strength + b.strength) / (2.2 * ov)) + 0.25 * clamp(1 - dens / 0.3) +
        0.1 * clamp(1 - Math.abs(a.tilt - b.tilt) / 4) + 0.1 * clamp(ov / shorter))
      cands.push({ x: (a.x + b.x) / 2, width: gap, y0, y1, confidence: 0, score, lo: a.x, hi: b.x })
    }
    // best first; drop overlaps in x (a column and the gap beside it are not two columns)
    const columns: RawColumn[] = []
    for (const c of cands.sort((p, q) => q.score - p.score)) {
      const clash = columns.some((k) => Math.abs(k.x - c.x) < Math.max(k.width, c.width) * 0.8 && Math.min(k.y1, c.y1) - Math.max(k.y0, c.y0) > 0.4 * Math.min(k.y1 - k.y0, c.y1 - c.y0))
      if (!clash) columns.push({ x: c.x, width: c.width, y0: c.y0, y1: c.y1, // classical vision alone is a suggestion: it can reach 0.75, only AI segmentation or the user raises it further
      confidence: Math.round(clamp(0.2 + c.score * 0.6, 0.1, 0.75) * 100) / 100 })
    }
    columns.sort((p, q) => p.x - q.x)

    // ---- beams: horizontal lines that tie neighbouring columns together ----
    const hlines: HLine[] = []
    for (const s of [...hSegs].sort((p, q) => Math.min(p.x1, p.x2) - Math.min(q.x1, q.x2))) {
      const x0 = Math.min(s.x1, s.x2), x1 = Math.max(s.x1, s.x2)
      const y = s.x1 < s.x2 ? s.y1 : s.y2, yEnd = s.x1 < s.x2 ? s.y2 : s.y1
      const host = hlines.find((l) => Math.abs((l.y0 + l.y1) / 2 - (y + yEnd) / 2) <= Math.max(4, h * 0.012) && x0 <= l.x1 + w * 0.05 && x1 >= l.x0 - w * 0.05)
      if (host) { host.x0 = Math.min(host.x0, x0); host.x1 = Math.max(host.x1, x1); host.strength += s.len }
      else hlines.push({ x0, x1, y0: y, y1: yEnd, strength: s.len })
    }
    const beams: RawBeam[] = []
    for (let i = 0; i < columns.length - 1; i++) {
      const a = columns[i], b = columns[i + 1]
      if (b.x - a.x > w * 0.5) continue
      for (const edge of ['top', 'base'] as const) {
        const ya = edge === 'top' ? a.y0 : a.y1, yb = edge === 'top' ? b.y0 : b.y1
        const hit = hlines.filter((l) => l.x0 <= a.x + a.width && l.x1 >= b.x - b.width && Math.abs((l.y0 + l.y1) / 2 - (ya + yb) / 2) <= Math.max(h * 0.07, Math.abs(ya - yb) + 10))
          .sort((p, q) => q.strength - p.strength)[0]
        if (hit) {
          const cover = clamp((Math.min(hit.x1, b.x) - Math.max(hit.x0, a.x)) / Math.max(1, b.x - a.x))
          beams.push({ x0: a.x, x1: b.x, y: (hit.y0 + hit.y1) / 2, thickness: Math.max(4, h * 0.02), confidence: Math.round(clamp(0.2 + 0.5 * cover * clamp(hit.strength / (0.9 * (b.x - a.x))), 0.1, 0.75) * 100) / 100 })
          break
        }
      }
    }

    // ---- footings: grey concrete blobs near the ground, squarish and solid ----
    const footings: RawFooting[] = []
    const hsv = keep(new cv.Mat()); const rgb = keep(new cv.Mat())
    cv.cvtColor(small, rgb, cv.COLOR_RGBA2RGB); cv.cvtColor(rgb, hsv, cv.COLOR_RGB2HSV)
    const mask = keep(new cv.Mat())
    cv.inRange(hsv, new cv.Mat(h, w, hsv.type(), [0, 0, 95, 0]), new cv.Mat(h, w, hsv.type(), [180, 55, 215, 255]), mask)
    const big = keep(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(9, 9)))
    cv.morphologyEx(mask, mask, cv.MORPH_OPEN, big); cv.morphologyEx(mask, mask, cv.MORPH_CLOSE, big)
    const contours = keep(new cv.MatVector()), hier = keep(new cv.Mat())
    cv.findContours(mask, contours, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE)
    for (let i = 0; i < contours.size(); i++) {
      const cnt = contours.get(i), area = cv.contourArea(cnt), r = cv.boundingRect(cnt)
      cnt.delete()
      const aspect = r.width / Math.max(1, r.height)
      const solid = area / Math.max(1, r.width * r.height)
      if (area < w * h * 0.002 || area > w * h * 0.06 || aspect < 0.45 || aspect > 2.6 || solid < 0.78) continue
      if (r.y + r.height / 2 < h * 0.35) continue         // footings sit in the lower part of the picture
      footings.push({ x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height, confidence: Math.round(clamp(0.25 + 0.4 * solid, 0.1, 0.6) * 100) / 100 })
    }
    footings.sort((p, q) => q.confidence - p.confidence)
    return { columns, beams, footings: footings.slice(0, 12), scale, width: w, height: h, engine: 'opencv' }
  } finally {
    for (const mat of mats) try { mat.delete() } catch { /* already released */ }
  }
}
