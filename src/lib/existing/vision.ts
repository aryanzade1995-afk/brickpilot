import { analyzeImage, type ImageLike, type RawAnalysis } from './detect.ts'
import { detectWithOpenCV, type CV } from './detectCv.ts'

/* Lazy loaders. Both libraries are large, so they are only fetched when the Existing Structure page needs them.
 *   - OpenCV (opencv.js, bundled): finds line, bar and blob suggestions.
 *   - SlimSAM (a small pretrained Segment Anything model, run in the browser through transformers.js): turns a point
 *     into a pixel-accurate mask, so a column or footing is measured, not guessed. Downloaded once (about 40 MB) and cached. */

let cvPromise: Promise<{ cv: CV }> | null = null
/** opencv.js is loaded as a plain script. Bundling it turns its internal promise into a copy that can no longer be awaited,
 *  and its module object is itself "thenable", so it is wrapped before anything resolves it. */
export function loadOpenCV(): Promise<{ cv: CV }> {
  cvPromise ??= (async () => {
    const url = (await import('@techstark/opencv-js/dist/opencv.js?url')).default
    await new Promise<void>((resolve, reject) => {
      const el = document.createElement('script')
      el.src = url; el.async = true
      el.onload = () => resolve(); el.onerror = () => reject(new Error('opencv.js could not be loaded'))
      document.head.appendChild(el)
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let cv: any = (window as any).cv
    if (!cv) throw new Error('opencv.js did not start')
    if (typeof cv.then === 'function') cv = await new Promise((resolve) => { cv.then((mod: { then?: unknown }) => { mod.then = undefined; resolve(mod) }) })
    if (!cv.Mat) await new Promise<void>((resolve) => { cv.onRuntimeInitialized = () => resolve() })
    return { cv: cv as CV }
  })()
  cvPromise.catch(() => { cvPromise = null })
  return cvPromise
}

/** OpenCV analysis when it loads, the built-in lightweight analysis when it does not */
export async function analyzePhoto(img: ImageLike): Promise<RawAnalysis> {
  try {
    return detectWithOpenCV((await loadOpenCV()).cv, img)
  } catch (error) {
    console.warn('[existing] OpenCV unavailable, using the lightweight analysis:', error instanceof Error ? error.message : error)
    return analyzeImage(img)
  }
}

/* ------------------------------ segmentation masks ------------------------------ */

export type MaskStats = {
  bbox: { x0: number; y0: number; x1: number; y1: number }
  area: number
  /** where the element meets the ground: bottom of the mask, centred on its feet */
  base: { x: number; y: number }
  top: { x: number; y: number }
  widthPx: number
  heightPx: number
  slender: number
  solidity: number
  iou: number
  /** a coarse outline for drawing, image pixels */
  outline: { x: number; y: number }[]
}

/** measure a binary mask (`data[y * w + x] > 0`) */
export function maskStats(data: ArrayLike<number>, w: number, h: number, iou = 1): MaskStats | null {
  let x0 = w, x1 = 0, y0 = h, y1 = 0, area = 0
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (data[y * w + x]) { area++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
  if (area < 40) return null
  const rowSpan = (y: number) => {
    let a = -1, b = -1
    for (let x = x0; x <= x1; x++) if (data[y * w + x]) { if (a < 0) a = x; b = x }
    return a < 0 ? null : { a, b, w: b - a + 1 }
  }
  const heightPx = y1 - y0 + 1
  const mid: number[] = []
  for (let y = y0 + Math.round(heightPx * 0.2); y <= y0 + Math.round(heightPx * 0.8); y += Math.max(1, Math.round(heightPx / 40))) { const r = rowSpan(y); if (r) mid.push(r.w) }
  mid.sort((p, q) => p - q)
  const widthPx = mid.length ? mid[Math.floor(mid.length / 2)] : x1 - x0 + 1
  // the feet: median centre of the bottom 12% of rows
  const feet: number[] = []
  for (let y = Math.max(y0, y1 - Math.max(2, Math.round(heightPx * 0.12))); y <= y1; y++) { const r = rowSpan(y); if (r) feet.push((r.a + r.b) / 2) }
  feet.sort((p, q) => p - q)
  const topCentres: number[] = []
  for (let y = y0; y <= Math.min(y1, y0 + Math.max(2, Math.round(heightPx * 0.12))); y++) { const r = rowSpan(y); if (r) topCentres.push((r.a + r.b) / 2) }
  topCentres.sort((p, q) => p - q)
  const outline: { x: number; y: number }[] = []
  const step = Math.max(1, Math.round(heightPx / 24))
  const left: { x: number; y: number }[] = [], right: { x: number; y: number }[] = []
  for (let y = y0; y <= y1; y += step) { const r = rowSpan(y); if (r) { left.push({ x: r.a, y }); right.push({ x: r.b, y }) } }
  outline.push(...left, ...right.reverse())
  return {
    bbox: { x0, y0, x1, y1 }, area,
    base: { x: Math.round(feet[Math.floor(feet.length / 2)] ?? (x0 + x1) / 2), y: y1 },
    top: { x: Math.round(topCentres[Math.floor(topCentres.length / 2)] ?? (x0 + x1) / 2), y: y0 },
    widthPx, heightPx, slender: heightPx / Math.max(1, widthPx), solidity: area / ((x1 - x0 + 1) * heightPx), iou, outline,
  }
}

/** does this mask look like a column? tall, narrow, solid, and not a sliver or the whole picture */
export const looksLikeColumn = (m: MaskStats, imgW: number, imgH: number) =>
  m.slender >= 2.2 && m.solidity >= 0.6 && m.heightPx >= imgH * 0.035 && m.heightPx <= imgH * 0.9 && m.widthPx <= imgW * 0.2 && m.widthPx >= 4

/** does this mask look like a footing, pad or pedestal? squarish and solid, a modest part of the picture */
export const looksLikeFooting = (m: MaskStats, imgW: number, imgH: number) => {
  const aspect = (m.bbox.x1 - m.bbox.x0 + 1) / m.heightPx
  return aspect >= 0.4 && aspect <= 4 && m.solidity >= 0.55 && m.area >= imgW * imgH * 0.0015 && m.area <= imgW * imgH * 0.15
}

/* --------------------------------- SAM session --------------------------------- */

export type SamProgress = { stage: 'download' | 'embed' | 'ready'; pct: number; label: string }
export type SamSession = {
  /** prompt a point (image pixels); returns the best mask measured, or null */
  segment: (p: { x: number; y: number }) => Promise<MaskStats | null>
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let samPromise: Promise<{ model: any; processor: any; RawImage: any }> | null = null
async function loadSam(onProgress?: (p: SamProgress) => void) {
  samPromise ??= (async () => {
    const t = await import('@huggingface/transformers')
    t.env.allowLocalModels = false
    const files = new Map<string, { loaded: number; total: number }>()
    const progress_callback = (e: { status: string; file?: string; loaded?: number; total?: number }) => {
      if (e.status === 'progress' && e.file) {
        files.set(e.file, { loaded: e.loaded ?? 0, total: e.total ?? 1 })
        let l = 0, tot = 0
        for (const f of files.values()) { l += f.loaded; tot += f.total }
        onProgress?.({ stage: 'download', pct: tot ? Math.round((l / tot) * 100) : 0, label: `Downloading the segmentation model (${Math.round(l / 1e6)} of ${Math.round(tot / 1e6)} MB)` })
      }
    }
    const [model, processor] = await Promise.all([
      t.SamModel.from_pretrained('Xenova/slimsam-77-uniform', { progress_callback }),
      t.AutoProcessor.from_pretrained('Xenova/slimsam-77-uniform', { progress_callback }),
    ])
    return { model, processor, RawImage: t.RawImage }
  })()
  samPromise.catch(() => { samPromise = null })
  return samPromise
}

/** download the model (first time only) and compute the picture embedding once; clicks after that are fast */
export async function startSam(pixels: { data: Uint8ClampedArray; width: number; height: number }, onProgress?: (p: SamProgress) => void): Promise<SamSession> {
  const { model, processor, RawImage } = await loadSam(onProgress)
  onProgress?.({ stage: 'embed', pct: 100, label: 'Reading the photo with the model' })
  const rgb = new Uint8ClampedArray(pixels.width * pixels.height * 3)
  for (let i = 0, j = 0; i < pixels.data.length; i += 4) { rgb[j++] = pixels.data[i]; rgb[j++] = pixels.data[i + 1]; rgb[j++] = pixels.data[i + 2] }
  const image = new RawImage(rgb, pixels.width, pixels.height, 3)
  const inputs = await processor(image)
  const embeddings = await model.get_image_embeddings(inputs)
  onProgress?.({ stage: 'ready', pct: 100, label: 'Ready' })
  return {
    segment: async (p) => {
      const prompt = await processor(image, { input_points: [[[p.x, p.y]]] })
      const out = await model({ ...embeddings, input_points: prompt.input_points })
      const masks = await processor.post_process_masks(out.pred_masks, prompt.original_sizes, prompt.reshaped_input_sizes)
      const scores = Array.from(out.iou_scores.data as ArrayLike<number>)
      // each point yields several masks: the most specific one that is still confident reads best for a column
      let best = 0
      for (let i = 1; i < scores.length; i++) if (scores[i] > scores[best]) best = i
      const m = masks[0][0][best]
      return maskStats(m.data, m.dims[1], m.dims[0], scores[best])
    },
  }
}

/* ------------------------- automatic column search ------------------------- */

import { consistentColumns, type Mask } from './auto.ts'

/** Prompt the model over a grid of points; every mask that looks like a column is kept, then the set is made consistent.
 *  Points that fall inside a column already found are skipped, so a row of columns costs little more than one prompt each. */
export async function findColumns(session: SamSession, w: number, h: number, onProgress?: (pct: number) => void): Promise<MaskStats[]> {
  const cols = 36, rows = [0.52, 0.62, 0.72, 0.82]
  const found: MaskStats[] = []
  const total = cols * rows.length
  let done = 0
  for (const r of rows) for (let i = 0; i < cols; i++) {
    const x = Math.round(((i + 0.5) / cols) * w), y = Math.round(r * h)
    done++
    if (found.some((m) => x >= m.bbox.x0 && x <= m.bbox.x1 && y >= m.bbox.y0 && y <= m.bbox.y1)) continue
    let m: MaskStats | null = null
    try { m = await session.segment({ x, y }) } catch { m = null }
    if (m && looksLikeColumn(m, w, h)) found.push(m)
    onProgress?.(Math.round((done / total) * 100))
    // let the page repaint between prompts so the progress bar keeps moving
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  const keep = new Set(consistentColumns(found.map((m): Mask => ({ base: m.base, top: m.top, widthPx: m.widthPx, heightPx: m.heightPx, bbox: m.bbox }))))
  return found.filter((m) => [...keep].some((k) => k.base === m.base))
}
