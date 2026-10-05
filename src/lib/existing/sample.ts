import type { ImageLike } from './detect.ts'
import type { Pt } from './types.ts'

/** A deterministic demo site photo: two rows of four columns (a 3 x 1 bay frame, 15 m x 7.5 m) seen from the front-left at an
 *  angle, so the back row looks smaller and higher, with a beam along the top of each row and a plinth strip.
 *  Returns RGBA pixels (no canvas needed) plus the true base points and the real size of the frame. */
export function sampleSite(width = 960, height = 600): ImageLike & {
  truth: { columns: number; frontBase: Pt[]; backBase: Pt[]; widthMm: number; depthMm: number }
} {
  const data = new Uint8ClampedArray(width * height * 4)
  const paint = (x0: number, y0: number, x1: number, y1: number, r: number, g: number, b: number) => {
    for (let y = Math.max(0, y0); y < Math.min(height, y1); y++) for (let x = Math.max(0, x0); x < Math.min(width, x1); x++) {
      const i = (y * width + x) * 4
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255
    }
  }
  paint(0, 0, width, height, 176, 205, 232)                          // sky
  paint(0, Math.round(height * 0.50), width, height, 118, 104, 84)   // bare ground
  const frontY = 500, backY = 400
  const front = [150, 360, 570, 780].map((x) => ({ x, y: frontY }))
  const back = [240, 390, 540, 690].map((x) => ({ x, y: backY }))
  const column = (p: Pt, w: number, h: number) => paint(p.x - w / 2, p.y - h, p.x + w / 2, p.y, 170, 170, 165)
  paint(210, backY, 720, backY + 8, 150, 150, 146)                   // back plinth strip
  for (const p of back) column(p, 20, 210)
  paint(back[0].x - 10, backY - 216, back[3].x + 10, backY - 200, 148, 148, 143)   // back beam
  paint(120, frontY, 810, frontY + 12, 150, 150, 146)                // front plinth strip
  for (const p of front) column(p, 28, 300)
  paint(front[0].x - 14, frontY - 306, front[3].x + 14, frontY - 282, 150, 150, 145) // front beam
  return { data, width, height, truth: { columns: 8, frontBase: front, backBase: back, widthMm: 15000, depthMm: 7500 } }
}
