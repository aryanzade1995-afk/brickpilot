/**
 * Provider-Agnostic Drawing Digitizer Pipeline for BrickPilot
 *
 * Defines the contract, data structures, and registry for ingesting user plan
 * drawings (hand sketches, grid paper, contractor blueprints) into a validated
 * raw survey with confidence scores and pixel coordinates, and converting it
 * into the canonical Survey schema for downstream consumption.
 */

import { type Survey, surveySchema, SURVEY_DEFAULTS } from './survey.ts'

export interface ImagePointPx {
  x: number
  y: number
}

export interface RawSurveyRoom {
  id: string
  name: string
  type: string
  box: {
    x: number
    y: number
    w: number
    h: number
  }
  confidence: number // 0 to 1
  labelPoint?: ImagePointPx
}

export interface RawSurveyWall {
  id: string
  a: ImagePointPx
  b: ImagePointPx
  thicknessPx?: number
  kind: 'exterior' | 'interior'
  confidence: number // 0 to 1
}

export interface RawSurveyOpening {
  id: string
  kind: 'door' | 'window' | 'entry'
  orient: 'h' | 'v'
  at: ImagePointPx
  widthPx: number
  swing?: number // 1 or -1
  confidence: number // 0 to 1
}

export interface RawSurveyDimension {
  id: string
  text: string
  valueM?: number
  a: ImagePointPx
  b: ImagePointPx
  confidence: number // 0 to 1
}

export interface RawSurvey {
  imageWidth: number
  imageHeight: number
  elements: {
    rooms: RawSurveyRoom[]
    walls: RawSurveyWall[]
    openings: RawSurveyOpening[]
    dimensions: RawSurveyDimension[]
  }
  scaleMPerPx?: number // inferred or calibrated
  metadata?: {
    adapterId: string
    timestamp: number
    notes?: string[]
  }
}

export interface DigitizeOptions {
  signal?: AbortSignal
  timeoutMs?: number
  expectedPlotWidthM?: number
  expectedPlotDepthM?: number
}

export interface DrawingDigitizer {
  id: string
  name: string
  description?: string
  digitize(image: File | Blob, opts?: DigitizeOptions): Promise<RawSurvey>
}

// ---------------------------------------------------------------------------
// Built-in Manual Trace Adapter
// ---------------------------------------------------------------------------

/**
 * Built-in fallback adapter: Returns an empty RawSurvey with the image dimensions.
 * The human-in-the-loop builds or corrects the layout on the overlay.
 */
export class ManualTraceDigitizer implements DrawingDigitizer {
  public readonly id = 'manual-trace'
  public readonly name = 'Manual Trace'
  public readonly description = 'Starts with an empty overlay so you can draw and trace rooms directly.'

  async digitize(image: File | Blob): Promise<RawSurvey> {
    const dims = await getImageDimensions(image)
    return {
      imageWidth: dims.width,
      imageHeight: dims.height,
      elements: {
        rooms: [],
        walls: [],
        openings: [],
        dimensions: [],
      },
      scaleMPerPx: undefined,
      metadata: {
        adapterId: this.id,
        timestamp: Date.now(),
        notes: ['Initialized manual trace layout.'],
      },
    }
  }
}

// ---------------------------------------------------------------------------
// Digitizer Registry
// ---------------------------------------------------------------------------

const registry = new Map<string, DrawingDigitizer>()

// Default register the manual trace digitizer
const defaultManual = new ManualTraceDigitizer()
registry.set(defaultManual.id, defaultManual)

export function registerDigitizer(digitizer: DrawingDigitizer): void {
  registry.set(digitizer.id, digitizer)
}

export function unregisterDigitizer(id: string): boolean {
  if (id === 'manual-trace') return false // protect manual trace
  return registry.delete(id)
}

export function getDigitizer(id?: string): DrawingDigitizer {
  if (id && registry.has(id)) {
    return registry.get(id)!
  }
  // Return the first registered non-manual digitizer if available, else manual
  for (const [key, d] of registry.entries()) {
    if (key !== 'manual-trace') return d
  }
  return registry.get('manual-trace')!
}

export function listDigitizers(): { id: string; name: string; description?: string }[] {
  return Array.from(registry.values()).map((d) => ({
    id: d.id,
    name: d.name,
    description: d.description,
  }))
}

/**
 * Digitizes an image using the specified (or first available) adapter,
 * automatically falling back to ManualTraceDigitizer on timeout or failure.
 */
export async function digitizeWithFallback(
  image: File | Blob,
  preferredId?: string,
  opts?: DigitizeOptions
): Promise<{ survey: RawSurvey; fallbackUsed: boolean; error?: string }> {
  const primary = getDigitizer(preferredId)
  if (primary.id === 'manual-trace') {
    const survey = await primary.digitize(image, opts)
    return { survey, fallbackUsed: false }
  }

  try {
    const timeoutMs = opts?.timeoutMs ?? 20000
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Digitization request timed out')), timeoutMs)
    )
    const survey = await Promise.race([primary.digitize(image, opts), timeoutPromise])
    return { survey, fallbackUsed: false }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Digitizer failed'
    const manual = registry.get('manual-trace')!
    const survey = await manual.digitize(image, opts)
    return { survey, fallbackUsed: true, error: errorMsg }
  }
}

// ---------------------------------------------------------------------------
// Image Validation & Client-side Downscaling
// ---------------------------------------------------------------------------

export interface ImageValidationResult {
  valid: boolean
  error?: string
}

export const MAX_IMAGE_FILE_SIZE_BYTES = 10 * 1024 * 1024 // 10 MB
export const MIN_IMAGE_DIMENSION_PX = 300
export const ALLOWED_IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp']

export function validateImageFile(file: File | Blob): ImageValidationResult {
  if (!ALLOWED_IMAGE_MIME_TYPES.includes(file.type)) {
    return {
      valid: false,
      error: 'Please upload a PNG, JPEG, or WebP image.',
    }
  }
  if (file.size > MAX_IMAGE_FILE_SIZE_BYTES) {
    return {
      valid: false,
      error: `Image size must be under 10 MB (provided ${(file.size / (1024 * 1024)).toFixed(1)} MB).`,
    }
  }
  return { valid: true }
}

/**
 * Reads intrinsic image dimensions from a File or Blob.
 */
export function getImageDimensions(fileOrBlob: File | Blob): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined') {
      // In non-browser (test) environment, fallback to 1000x1000 if not mocked
      resolve({ width: 1000, height: 1000 })
      return
    }
    const url = URL.createObjectURL(fileOrBlob)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve({ width: img.naturalWidth, height: img.naturalHeight })
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Failed to read image dimensions.'))
    }
    img.src = url
  })
}

/**
 * Downscales large images client-side before processing to ensure 60fps canvas performance.
 */
export async function downscaleImageIfNeeded(
  file: File | Blob,
  maxDimension = 2400
): Promise<{ blob: Blob; width: number; height: number; dataUrl: string }> {
  if (typeof window === 'undefined') {
    return { blob: file, width: 1000, height: 1000, dataUrl: '' }
  }

  const dims = await getImageDimensions(file)
  const maxSide = Math.max(dims.width, dims.height)

  if (maxSide <= maxDimension) {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
    return { blob: file, width: dims.width, height: dims.height, dataUrl }
  }

  const scale = maxDimension / maxSide
  const targetW = Math.round(dims.width * scale)
  const targetH = Math.round(dims.height * scale)

  const canvas = document.createElement('canvas')
  canvas.width = targetW
  canvas.height = targetH
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not create canvas 2D context')

  const url = URL.createObjectURL(file)
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image()
    i.onload = () => resolve(i)
    i.onerror = reject
    i.src = url
  })
  URL.revokeObjectURL(url)

  ctx.drawImage(img, 0, 0, targetW, targetH)

  const dataUrl = canvas.toDataURL('image/jpeg', 0.92)
  const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), 'image/jpeg', 0.92))

  return { blob, width: targetW, height: targetH, dataUrl }
}

// ---------------------------------------------------------------------------
// Mapping RawSurvey to Survey
// ---------------------------------------------------------------------------

/**
 * Converts image-space RawSurvey coordinates into real-world Survey metres
 * using a calibrated scale factor (metres per pixel).
 */
export function rawSurveyToSurvey(
  raw: RawSurvey,
  scaleMPerPx: number,
  originOffsetPx: ImagePointPx = { x: 0, y: 0 }
): Survey {
  if (!Number.isFinite(scaleMPerPx) || scaleMPerPx <= 0) {
    throw new Error('A valid positive scale (m/px) is required to convert raw survey.')
  }

  const pxToM = (px: number) => +(px * scaleMPerPx).toFixed(3)
  const ptToM = (pt: ImagePointPx) => ({
    x: pxToM(pt.x - originOffsetPx.x),
    y: pxToM(pt.y - originOffsetPx.y),
  })

  const VALID_ROOM_TYPES = new Set([
    'living',
    'livingDining',
    'dining',
    'kitchen',
    'bed',
    'bath',
    'study',
    'pooja',
    'utility',
    'corridor',
    'foyer',
    'stair',
  ] as const)
  type SurveyRoomType =
    | 'living'
    | 'livingDining'
    | 'dining'
    | 'kitchen'
    | 'bed'
    | 'bath'
    | 'study'
    | 'pooja'
    | 'utility'
    | 'corridor'
    | 'foyer'
    | 'stair'

  // Map rooms
  const rooms = raw.elements.rooms.map((r) => {
    const tl = ptToM({ x: r.box.x, y: r.box.y })
    const type: SurveyRoomType =
      r.type === 'master_bed'
        ? 'bed'
        : VALID_ROOM_TYPES.has(r.type as SurveyRoomType)
        ? (r.type as SurveyRoomType)
        : 'living'

    return {
      name: r.name || 'Room',
      type,
      x: tl.x,
      y: tl.y,
      w: pxToM(r.box.w),
      h: pxToM(r.box.h),
      stairStartSide: null as 'N' | 'S' | 'E' | 'W' | null,
    }
  })

  // Map walls
  const walls = raw.elements.walls.map((w) => {
    const a = ptToM(w.a)
    const b = ptToM(w.b)
    const thicknessMm = w.thicknessPx
      ? Math.round(w.thicknessPx * scaleMPerPx * 1000)
      : w.kind === 'exterior'
      ? SURVEY_DEFAULTS.exteriorWallMm
      : SURVEY_DEFAULTS.interiorWallMm

    return {
      a,
      b,
      thicknessMm,
      kind: w.kind,
    }
  })

  // Map openings
  const openings = raw.elements.openings.map((o) => {
    const at = ptToM(o.at)
    const widthM = o.widthPx ? pxToM(o.widthPx) : o.kind === 'window' ? 1.2 : 0.9
    const headM = o.kind === 'window' ? SURVEY_DEFAULTS.windowHeadM : SURVEY_DEFAULTS.doorHeadM
    const sillM = o.kind === 'window' ? SURVEY_DEFAULTS.windowSillM : null
    const swing: 1 | -1 = o.swing === -1 ? -1 : 1

    return {
      x: at.x,
      y: at.y,
      kind: o.kind,
      orient: o.orient,
      widthM,
      headM,
      sillM,
      swing,
      leaf: true,
      emergencyExit: false,
    }
  })

  // Calculate bounding box in metres
  const allX = [
    ...walls.flatMap((w) => [w.a.x, w.b.x]),
    ...rooms.flatMap((r) => [r.x, r.x + r.w]),
    ...openings.map((o) => o.x),
  ]
  const allY = [
    ...walls.flatMap((w) => [w.a.y, w.b.y]),
    ...rooms.flatMap((r) => [r.y, r.y + r.h]),
    ...openings.map((o) => o.y),
  ]

  const minX = allX.length ? Math.min(...allX) : 0
  const maxX = allX.length ? Math.max(...allX) : pxToM(raw.imageWidth)
  const minY = allY.length ? Math.min(...allY) : 0
  const maxY = allY.length ? Math.max(...allY) : pxToM(raw.imageHeight)

  const widthM = +(maxX - minX).toFixed(2)
  const depthM = +(maxY - minY).toFixed(2)

  const draft: Survey = {
    widthM: widthM > 0 ? widthM : null,
    depthM: depthM > 0 ? depthM : null,
    heightM: SURVEY_DEFAULTS.heightM,
    plotOffsetXM: null,
    plotOffsetYM: null,
    columns: [],
    footings: [],
    beams: [],
    walls,
    rooms,
    openings,
    notes: [
      `Digitized via ${raw.metadata?.adapterId ?? 'custom adapter'} at ${scaleMPerPx.toFixed(5)} m/px.`,
    ],
  }

  // Validate with surveySchema
  return surveySchema.parse(draft)
}

