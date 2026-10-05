import { create } from 'zustand'
import { analyzeImage, toDetections } from '@/lib/existing/detect.ts'
import { analyzePhoto, findColumns, looksLikeColumn, looksLikeFooting, startSam, type MaskStats, type SamSession } from '@/lib/existing/vision.ts'
import { autoCorners, carryBeams } from '@/lib/existing/auto.ts'
import { sampleSite } from '@/lib/existing/sample.ts'
import { buildAsBuilt, type AsBuiltResult } from '@/lib/existing/asBuilt.ts'
import { planAroundStructure, type ExistingPlan } from '@/lib/existing/plan.ts'
import { defaultAnswers, type Answers, type Calibration, type Detections, type Pt } from '@/lib/existing/types.ts'

export type Tool = 'move' | 'column' | 'beam' | 'footing' | 'remove' | 'seg-column' | 'seg-footing'
export type SamState = { state: 'idle' | 'loading' | 'ready' | 'error'; pct: number; label: string }
type Pixels = { data: Uint8ClampedArray; width: number; height: number }

/** the model session belongs to one photo; kept outside the store because it is not serialisable */
let samSession: SamSession | null = null
export const STEPS = ['Photo', 'Detect and correct', 'Scale and questions', 'As-built map', 'Plan'] as const

const emptyDetections = (): Detections => ({ columns: [], beams: [], footings: [], walls: [],
  seen: { foundation: false, columns: false, beams: false, slab: false, walls: false } })

type State = {
  step: number
  tool: Tool
  imageUrl: string | null
  imageSize: { w: number; h: number } | null
  pixels: Pixels | null
  engine: 'opencv' | 'basic' | null
  sam: SamState
  /** the automatic analysis that runs when a photo is chosen */
  auto: { pct: number; label: string } | null
  lastMask: { x: number; y: number }[] | null
  isSample: boolean
  detections: Detections
  calibration: Calibration
  /** corner points being collected for the four-corner calibration */
  corners: Pt[]
  answers: Answers
  align: boolean
  /** first column picked for a new beam */
  beamFrom: string | null
  asBuilt: AsBuiltResult | null
  plan: ExistingPlan | null
  seed: number
  busy: string | null
  message: string | null

  setStep: (n: number) => void
  setTool: (t: Tool) => void
  loadFile: (file: File) => Promise<void>
  loadSample: () => void
  enableSam: () => Promise<void>
  autoAnalyze: () => Promise<void>
  verifyWithSam: () => Promise<void>
  segmentClick: (kind: 'column' | 'footing', at: Pt) => Promise<void>
  addColumn: (at: Pt) => void
  addFooting: (at: Pt) => void
  moveColumn: (id: string, at: Pt) => void
  removeElement: (id: string) => void
  confirm: (id: string) => void
  confirmAll: () => void
  pickForBeam: (id: string) => void
  addCorner: (at: Pt) => void
  moveCorner: (index: number, at: Pt) => void
  clearCorners: () => void
  setCalibration: (c: Calibration) => void
  setAnswer: <K extends keyof Answers>(key: K, value: Answers[K]) => void
  setAlign: (v: boolean) => void
  setSeen: (key: keyof Detections['seen'], v: boolean) => void
  buildMap: () => AsBuiltResult
  generate: (seed?: number) => ExistingPlan | null
  reset: () => void
}

const nextId = (prefix: string, ids: string[]) => {
  let n = ids.length + 1
  while (ids.includes(`${prefix}-${n}`)) n++
  return `${prefix}-${n}`
}

/** decode a picture to pixels in the browser (capped so detection stays fast) */
async function pixelsOf(url: string): Promise<Pixels> {
  const img = new Image()
  img.src = url
  await img.decode()
  const scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight))
  const width = Math.round(img.naturalWidth * scale), height = Math.round(img.naturalHeight * scale)
  const canvas = document.createElement('canvas')
  canvas.width = width; canvas.height = height
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(img, 0, 0, width, height)
  return { data: ctx.getImageData(0, 0, width, height).data, width, height }
}

export const useExisting = create<State>((set, get) => ({
  step: 0, tool: 'move', imageUrl: null, imageSize: null, pixels: null, engine: null, sam: { state: 'idle', pct: 0, label: '' }, auto: null, lastMask: null, isSample: false,
  detections: emptyDetections(), calibration: { mode: 'none' }, corners: [], answers: defaultAnswers(), align: true,
  beamFrom: null, asBuilt: null, plan: null, seed: 1, busy: null, message: null,

  setStep: (step) => set({ step, message: null }),
  setTool: (tool) => set({ tool, beamFrom: null }),

  loadFile: async (file) => {
    set({ busy: 'Reading the photo…', message: null, auto: { pct: 0, label: 'Reading the photo' } })
    try {
      const url = URL.createObjectURL(file)
      const px = await pixelsOf(url)
      const raw = await analyzePhoto(px)
      samSession = null
      set({ imageUrl: url, imageSize: { w: px.width, h: px.height }, pixels: px, engine: raw.engine ?? 'basic', sam: { state: 'idle', pct: 0, label: '' }, lastMask: null,
        isSample: false, detections: toDetections(raw), calibration: { mode: 'none' }, corners: [], asBuilt: null, plan: null, step: 0, message: null })
    } catch {
      set({ busy: null, auto: null, message: 'That file could not be read as a picture. Try a JPG or PNG.' })
      return
    }
    await get().autoAnalyze()
  },

  autoAnalyze: async () => {
    const st = get()
    if (!st.pixels || !st.imageSize) return
    const { w, h } = st.imageSize
    const fallback = (message: string) => set({ busy: null, auto: null, step: 1, message })
    set({ busy: 'Starting the AI model…', auto: { pct: 0, label: 'Starting the AI model (the first time it downloads about 40 MB)' } })
    try {
      await get().enableSam()
      if (get().sam.state !== 'ready' || !samSession) return fallback('The AI model could not start (it needs a connection the first time). The suggestions below are unchecked: confirm or fix them, or add columns by hand.')
      const session = samSession
      set({ busy: 'Finding every column…', auto: { pct: 0, label: 'Finding every column' } })
      const masks = await findColumns(session, w, h, (pct) => set({ auto: { pct, label: 'Finding every column' } }))
      const old = get().detections
      const columns = masks.sort((a, b) => a.base.x - b.base.x || a.base.y - b.base.y).map((m, i) => ({
        id: `col-${i + 1}`, img: m.base, top: m.top, widthPx: Math.round(m.widthPx), confidence: Math.round(Math.min(0.97, 0.8 + 0.17 * m.iou) * 100) / 100,
        source: 'auto' as const, confirmed: true }))
      // foundation pads the first analysis suspected are kept only when the model confirms them
      set({ auto: { pct: 100, label: 'Checking footings and beams' } })
      const footings: Detections['footings'] = []
      for (const f of old.footings) {
        let m: MaskStats | null = null
        try { m = await session.segment(f.img) } catch { m = null }
        if (m && looksLikeFooting(m, w, h) && !columns.some((c) => Math.abs(c.img.x - f.img.x) < c.widthPx * 2 && Math.abs(c.img.y - f.img.y) < c.widthPx * 2))
          footings.push({ ...f, img: { x: Math.round((m.bbox.x0 + m.bbox.x1) / 2), y: Math.round((m.bbox.y0 + m.bbox.y1) / 2) }, confidence: 0.85, confirmed: true })
      }
      if (!columns.length && !footings.length) return fallback('No columns or footings could be found automatically in this photo. Add them by clicking on the photo, or try a clearer photo taken from further back.')
      const beams = carryBeams(old.columns, old.beams, columns)
      const corners = autoCorners(columns)
      const calibration: Calibration = corners
        ? { mode: 'corners', pts: corners, widthMm: 0, depthMm: 0 }
        : { mode: 'scale', a: columns[0]?.id ?? '', b: columns[columns.length - 1]?.id ?? '', distanceMm: 0 }
      set({ busy: null, auto: null, step: 2, corners: corners ?? [], calibration, asBuilt: null, plan: null, lastMask: null, tool: 'move',
        detections: { columns, beams, footings, walls: old.walls, seen: { ...old.seen, columns: columns.length > 0, foundation: footings.length > 0 || old.seen.foundation } },
        message: null })
    } catch (error) {
      fallback(`The automatic analysis stopped (${error instanceof Error ? error.message : 'unknown error'}). The suggestions are unchecked: confirm or fix them.`)
    }
  },

  loadSample: () => {
    const s = sampleSite()
    const canvas = document.createElement('canvas')
    canvas.width = s.width; canvas.height = s.height
    const ctx = canvas.getContext('2d')!
    ctx.putImageData(new ImageData(new Uint8ClampedArray(s.data as Uint8ClampedArray), s.width, s.height), 0, 0)
    const detections = toDetections(analyzeImage(s))
    for (const x of [...detections.columns, ...detections.beams, ...detections.footings]) x.confirmed = true
    samSession = null
    set({
      imageUrl: canvas.toDataURL('image/png'), imageSize: { w: s.width, h: s.height }, pixels: { data: new Uint8ClampedArray(s.data as Uint8ClampedArray), width: s.width, height: s.height }, engine: 'basic',
      sam: { state: 'idle', pct: 0, label: '' }, lastMask: null, isSample: true, detections,
      // the demo photo shows a 15 m x 7.5 m frame: its four ground corners are known
      calibration: { mode: 'corners', pts: [s.truth.backBase[0], s.truth.backBase[3], s.truth.frontBase[3], s.truth.frontBase[0]], widthMm: s.truth.widthMm, depthMm: s.truth.depthMm },
      corners: [s.truth.backBase[0], s.truth.backBase[3], s.truth.frontBase[3], s.truth.frontBase[0]],
      answers: { ...defaultAnswers(), plotWidthM: 22, plotDepthM: 22, storeysBuilt: 1, storeysWanted: 1, bedroomsWithBath: 1, bedroomsNoBath: 1, sharedBaths: 1 },
      asBuilt: null, plan: null, step: 2, busy: null, auto: null, message: 'Demo site loaded: a 15 m x 7.5 m frame. The scale is already set from its four corners.',
    })
  },

  enableSam: async () => {
    const px = get().pixels
    if (!px || get().sam.state === 'loading') return
    set({ sam: { state: 'loading', pct: 0, label: 'Starting the segmentation model' } })
    try {
      samSession = await startSam(px, (p) => set({ sam: { state: p.stage === 'ready' ? 'ready' : 'loading', pct: p.pct, label: p.label } }))
      set({ sam: { state: 'ready', pct: 100, label: 'Ready' }, tool: 'seg-column' })
    } catch (error) {
      samSession = null
      set({ sam: { state: 'error', pct: 0, label: error instanceof Error ? error.message : 'The model could not start' },
        message: 'The segmentation model could not be loaded (it needs a connection the first time). You can still correct everything by hand.' })
    }
  },

  segmentClick: async (kind, at) => {
    if (!samSession || !get().imageSize) return
    const { w, h } = get().imageSize!
    set({ busy: 'Measuring…' })
    let m: MaskStats | null = null
    try { m = await samSession.segment(at) } catch { m = null }
    if (!m) { set({ busy: null, message: 'Nothing could be measured there. Click on the body of the column or footing.' }); return }
    const ok = kind === 'column' ? looksLikeColumn(m, w, h) : looksLikeFooting(m, w, h)
    if (!ok) {
      set({ busy: null, lastMask: m.outline, message: kind === 'column'
        ? 'That does not look like a column (it should be tall and narrow). Try clicking the middle of the column.'
        : 'That does not look like a footing. Click on the middle of the pad.' })
      return
    }
    const mask = m
    set((s) => {
      const confidence = Math.round(Math.min(0.97, 0.8 + 0.17 * mask.iou) * 100) / 100
      if (kind === 'column') {
        const id = nextId('col', s.detections.columns.map((c) => c.id))
        return { busy: null, lastMask: mask.outline, asBuilt: null, plan: null, message: null, detections: { ...s.detections,
          columns: [...s.detections.columns, { id, img: mask.base, top: mask.top, widthPx: Math.round(mask.widthPx), confidence, source: 'user' as const, confirmed: true }],
          seen: { ...s.detections.seen, columns: true } } }
      }
      const id = nextId('foot', s.detections.footings.map((c) => c.id))
      return { busy: null, lastMask: mask.outline, asBuilt: null, plan: null, message: null, detections: { ...s.detections,
        footings: [...s.detections.footings, { id, img: { x: Math.round((mask.bbox.x0 + mask.bbox.x1) / 2), y: Math.round((mask.bbox.y0 + mask.bbox.y1) / 2) }, confidence, source: 'user' as const, confirmed: true }],
        seen: { ...s.detections.seen, foundation: true } } }
    })
  },

  verifyWithSam: async () => {
    const st = get()
    if (!samSession || !st.imageSize) return
    const { w, h } = st.imageSize
    set({ busy: 'Checking every suggestion against the model…' })
    let kept = 0, dropped = 0
    const columns: Detections['columns'] = []
    for (const c of st.detections.columns) {
      if (c.source === 'user' || c.confirmed) { columns.push(c); continue }
      const mid = { x: c.img.x, y: Math.round(c.top ? (c.top.y + c.img.y) / 2 : c.img.y - 30) }
      let m: MaskStats | null = null
      try { m = await samSession.segment(mid) } catch { m = null }
      if (m && looksLikeColumn(m, w, h) && Math.abs(m.base.x - c.img.x) <= Math.max(25, m.widthPx * 1.5)) {
        kept++
        columns.push({ ...c, img: m.base, top: m.top, widthPx: Math.round(m.widthPx), confidence: Math.round(Math.min(0.95, 0.7 + 0.25 * m.iou) * 100) / 100 })
      } else dropped++
    }
    const footings: Detections['footings'] = []
    for (const f of st.detections.footings) {
      if (f.source === 'user' || f.confirmed) { footings.push(f); continue }
      let m: MaskStats | null = null
      try { m = await samSession.segment(f.img) } catch { m = null }
      if (m && looksLikeFooting(m, w, h)) {
        kept++
        footings.push({ ...f, img: { x: Math.round((m.bbox.x0 + m.bbox.x1) / 2), y: Math.round((m.bbox.y0 + m.bbox.y1) / 2) }, confidence: Math.round(Math.min(0.9, 0.65 + 0.25 * m.iou) * 100) / 100 })
      } else dropped++
    }
    const ids = new Set(columns.map((c) => c.id))
    set((s) => ({ busy: null, asBuilt: null, plan: null,
      detections: { ...s.detections, columns, footings, beams: s.detections.beams.filter((b) => ids.has(b.a) && ids.has(b.b)) },
      message: `The model confirmed ${kept} suggestion${kept === 1 ? '' : 's'} and dropped ${dropped} that did not look like a column or footing. Click anything it missed.` }))
  },

  addColumn: (at) => set((s) => {
    const id = nextId('col', s.detections.columns.map((c) => c.id))
    return { asBuilt: null, plan: null, detections: { ...s.detections, columns: [...s.detections.columns, { id, img: at, widthPx: 20, confidence: 1, source: 'user', confirmed: true }],
      seen: { ...s.detections.seen, columns: true } } }
  }),
  addFooting: (at) => set((s) => {
    const id = nextId('foot', s.detections.footings.map((c) => c.id))
    return { asBuilt: null, plan: null, detections: { ...s.detections, footings: [...s.detections.footings, { id, img: at, confidence: 1, source: 'user', confirmed: true }],
      seen: { ...s.detections.seen, foundation: true } } }
  }),
  moveColumn: (id, at) => set((s) => ({ asBuilt: null, plan: null, detections: { ...s.detections,
    columns: s.detections.columns.map((c) => (c.id === id ? { ...c, img: at, top: c.top ? { x: at.x, y: c.top.y } : c.top, confirmed: true } : c)),
    footings: s.detections.footings.map((f) => (f.id === id ? { ...f, img: at, confirmed: true } : f)) } })),
  removeElement: (id) => set((s) => ({ asBuilt: null, plan: null, detections: { ...s.detections,
    columns: s.detections.columns.filter((c) => c.id !== id),
    footings: s.detections.footings.filter((f) => f.id !== id),
    walls: s.detections.walls.filter((w) => w.id !== id),
    beams: s.detections.beams.filter((b) => b.id !== id && b.a !== id && b.b !== id) } })),
  confirm: (id) => set((s) => ({ asBuilt: null, detections: { ...s.detections,
    columns: s.detections.columns.map((c) => (c.id === id ? { ...c, confirmed: true } : c)),
    beams: s.detections.beams.map((b) => (b.id === id ? { ...b, confirmed: true } : b)),
    footings: s.detections.footings.map((f) => (f.id === id ? { ...f, confirmed: true } : f)),
    walls: s.detections.walls.map((w) => (w.id === id ? { ...w, confirmed: true } : w)) } })),
  confirmAll: () => set((s) => ({ asBuilt: null, detections: { ...s.detections,
    columns: s.detections.columns.map((c) => ({ ...c, confirmed: true })), beams: s.detections.beams.map((b) => ({ ...b, confirmed: true })),
    footings: s.detections.footings.map((f) => ({ ...f, confirmed: true })), walls: s.detections.walls.map((w) => ({ ...w, confirmed: true })) } })),
  pickForBeam: (id) => set((s) => {
    if (!s.beamFrom) return { beamFrom: id }
    if (s.beamFrom === id) return { beamFrom: null }
    const exists = s.detections.beams.some((b) => (b.a === s.beamFrom && b.b === id) || (b.a === id && b.b === s.beamFrom))
    if (exists) return { beamFrom: null }
    const beamId = nextId('beam', s.detections.beams.map((b) => b.id))
    return { beamFrom: null, asBuilt: null, plan: null, detections: { ...s.detections,
      beams: [...s.detections.beams, { id: beamId, a: s.beamFrom, b: id, confidence: 1, source: 'user', confirmed: true }], seen: { ...s.detections.seen, beams: true } } }
  }),

  addCorner: (at) => set((s) => (s.corners.length >= 4 ? s : { corners: [...s.corners, at] })),
  moveCorner: (index, at) => set((s) => ({ corners: s.corners.map((c, i) => (i === index ? at : c)),
    calibration: s.calibration.mode === 'corners' ? { ...s.calibration, pts: s.calibration.pts.map((c, i) => (i === index ? at : c)) } : s.calibration, asBuilt: null })),
  clearCorners: () => set({ corners: [], asBuilt: null, calibration: { mode: 'none' } }),
  setCalibration: (calibration) => set({ calibration, asBuilt: null, plan: null }),
  setAnswer: (key, value) => set((s) => ({ answers: { ...s.answers, [key]: value }, asBuilt: null, plan: null })),
  setAlign: (align) => set({ align, asBuilt: null, plan: null }),
  setSeen: (key, v) => set((s) => ({ detections: { ...s.detections, seen: { ...s.detections.seen, [key]: v } } })),

  buildMap: () => {
    const s = get()
    const asBuilt = buildAsBuilt(s.detections, s.calibration, s.answers, { align: s.align })
    set({ asBuilt, plan: null })
    return asBuilt
  },
  generate: (seed) => {
    const s = get()
    const built = s.asBuilt?.ok ? s.asBuilt : s.buildMap()
    if (!built.ok) return null
    const use = seed ?? s.seed
    const plan = planAroundStructure(built.value, s.answers, use)
    set({ plan, seed: use })
    return plan
  },
  reset: () => { samSession = null; set({ auto: null, step: 0, tool: 'move', imageUrl: null, imageSize: null, pixels: null, engine: null, sam: { state: 'idle', pct: 0, label: '' }, lastMask: null, isSample: false, detections: emptyDetections(), calibration: { mode: 'none' }, corners: [],
    answers: defaultAnswers(), beamFrom: null, asBuilt: null, plan: null, seed: 1, busy: null, message: null }) },
}))
