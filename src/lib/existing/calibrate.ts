import type { Calibration, DetColumn, Pt } from './types.ts'

/** Image pixels → plan millimetres. Deterministic maths only: a scale from one known distance, or a 4-corner homography. */
export type ToPlan = (p: Pt) => Pt

/** 8x8 Gaussian elimination: the perspective transform taking four image points onto a W x D rectangle */
export function homography(src: Pt[], widthMm: number, depthMm: number): ToPlan | null {
  if (src.length !== 4) return null
  const dst: Pt[] = [{ x: 0, y: 0 }, { x: widthMm, y: 0 }, { x: widthMm, y: depthMm }, { x: 0, y: depthMm }]
  const A: number[][] = []
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i], { x: u, y: v } = dst[i]
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u])
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y, v])
  }
  for (let c = 0; c < 8; c++) {
    let p = c
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r
    if (Math.abs(A[p][c]) < 1e-9) return null
    ;[A[c], A[p]] = [A[p], A[c]]
    for (let r = 0; r < 8; r++) {
      if (r === c) continue
      const f = A[r][c] / A[c][c]
      for (let k = c; k < 9; k++) A[r][k] -= f * A[c][k]
    }
  }
  const h = A.map((row, i) => row[8] / row[i])
  return ({ x, y }) => {
    const w = h[6] * x + h[7] * y + 1
    return { x: (h[0] * x + h[1] * y + h[2]) / w, y: (h[3] * x + h[4] * y + h[5]) / w }
  }
}

/** Build the image → plan mapping, or say what is missing. */
export function buildMapping(cal: Calibration, columns: DetColumn[]): { toPlan: ToPlan | null; note: string; mmPerPx?: number } {
  if (cal.mode === 'corners') {
    if (!Number.isFinite(cal.widthMm+cal.depthMm) || cal.widthMm<=0 || cal.depthMm<=0) return {toPlan:null,note:'Enter both measured dimensions before continuing.'}
    const toPlan = homography(cal.pts, cal.widthMm, cal.depthMm)
    return toPlan ? { toPlan, note: 'Perspective corrected from the four corners you marked.' }
      : { toPlan: null, note: 'The four corners must form a four-sided shape.' }
  }
  if (cal.mode === 'scale') {
    const a = columns.find((c) => c.id === cal.a), b = columns.find((c) => c.id === cal.b)
    if (!a || !b || cal.distanceMm <= 0) return { toPlan: null, note: 'Pick two columns and enter the distance between them.' }
    const px = Math.hypot(a.img.x - b.img.x, a.img.y - b.img.y)
    if (px < 8) return { toPlan: null, note: 'The two columns are too close together in the image to set a scale.' }
    const s = cal.distanceMm / px
    return { toPlan: ({ x, y }) => ({ x: x * s, y: y * s }), mmPerPx: s,
      note: 'One known distance sets the scale. This assumes the photo is taken straight on or from above; use the four-corner method if it is at an angle.' }
  }
  return { toPlan: null, note: 'Calibrate the image with one known distance or the four corners of the structure.' }
}
