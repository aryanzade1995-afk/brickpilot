import { create } from 'zustand'
import { analyzeImage, toDetections } from '@/lib/existing/detect.ts'
import { sampleSite } from '@/lib/existing/sample.ts'
import { buildAsBuilt, type AsBuiltResult } from '@/lib/existing/asBuilt.ts'
import { planAroundStructure, type ExistingPlan } from '@/lib/existing/plan.ts'
import { defaultAnswers, type Answers, type Calibration, type Detections, type Pt } from '@/lib/existing/types.ts'

export type Tool = 'move' | 'column' | 'beam' | 'footing' | 'remove'
export const STEPS = ['Photo', 'Detect and correct', 'Scale and questions', 'As-built map', 'Plan'] as const

const emptyDetections = (): Detections => ({ columns: [], beams: [], footings: [], walls: [],
  seen: { foundation: false, columns: false, beams: false, slab: false, walls: false } })

type State = {
  step: number
  tool: Tool
  imageUrl: string | null
  imageSize: { w: number; h: number } | null
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
async function pixelsOf(url: string): Promise<{ data: Uint8ClampedArray; width: number; height: number }> {
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
  step: 0, tool: 'move', imageUrl: null, imageSize: null, isSample: false,
  detections: emptyDetections(), calibration: { mode: 'none' }, corners: [], answers: defaultAnswers(), align: true,
  beamFrom: null, asBuilt: null, plan: null, seed: 1, busy: null, message: null,

  setStep: (step) => set({ step, message: null }),
  setTool: (tool) => set({ tool, beamFrom: null }),

  loadFile: async (file) => {
    set({ busy: 'Reading the photo and looking for columns and beams…', message: null })
    try {
      const url = URL.createObjectURL(file)
      const px = await pixelsOf(url)
      const detections = toDetections(analyzeImage(px))
      set({ imageUrl: url, imageSize: { w: px.width, h: px.height }, isSample: false, detections, calibration: { mode: 'none' }, corners: [],
        asBuilt: null, plan: null, step: 1, busy: null,
        message: detections.columns.length ? null : 'No columns were found automatically. Add them by clicking on the photo.' })
    } catch {
      set({ busy: null, message: 'That file could not be read as a picture. Try a JPG or PNG.' })
    }
  },

  loadSample: () => {
    const s = sampleSite()
    const canvas = document.createElement('canvas')
    canvas.width = s.width; canvas.height = s.height
    const ctx = canvas.getContext('2d')!
    ctx.putImageData(new ImageData(new Uint8ClampedArray(s.data as Uint8ClampedArray), s.width, s.height), 0, 0)
    const detections = toDetections(analyzeImage(s))
    set({
      imageUrl: canvas.toDataURL('image/png'), imageSize: { w: s.width, h: s.height }, isSample: true, detections,
      // the demo photo shows a 15 m x 7.5 m frame: its four ground corners are known
      calibration: { mode: 'corners', pts: [s.truth.backBase[0], s.truth.backBase[3], s.truth.frontBase[3], s.truth.frontBase[0]], widthMm: s.truth.widthMm, depthMm: s.truth.depthMm },
      corners: [s.truth.backBase[0], s.truth.backBase[3], s.truth.frontBase[3], s.truth.frontBase[0]],
      answers: { ...defaultAnswers(), plotWidthM: 22, plotDepthM: 22, storeysBuilt: 1, storeysWanted: 1, bedroomsWithBath: 1, bedroomsNoBath: 1, sharedBaths: 1 },
      asBuilt: null, plan: null, step: 1, busy: null, message: 'Demo site loaded: a 15 m x 7.5 m frame. The scale is already set from its four corners.',
    })
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
  reset: () => set({ step: 0, tool: 'move', imageUrl: null, imageSize: null, isSample: false, detections: emptyDetections(), calibration: { mode: 'none' }, corners: [],
    answers: defaultAnswers(), beamFrom: null, asBuilt: null, plan: null, seed: 1, busy: null, message: null }),
}))
