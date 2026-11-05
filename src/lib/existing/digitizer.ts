/**
 * Provider-Agnostic Drawing Digitizer Pipeline for BrickPilot
 *
 * Defines the contract, data structures, and registry for ingesting user plan
 * drawings (hand sketches, grid paper, contractor blueprints) into a validated
 * raw survey with confidence scores and pixel coordinates, and converting it
 * into the canonical Survey schema for downstream consumption.
 */

import { type Survey, surveySchema, SURVEY_DEFAULTS, SURVEY_SETBACKS } from './survey.ts'
import {z} from 'zod'

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
  stairStartSide?: 'N'|'E'|'S'|'W'|null
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
  headM?:number
  sillM?:number
  leaf?:boolean
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
  columns?:{x:number;y:number;sizeMm:number|null}[]
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
// Automatic AI & Computer Vision Drawing Digitizer
// ---------------------------------------------------------------------------

/** Convert the existing reader's normalized geometry, never a substitute layout. */
export function drawingDraftToRaw(value:unknown,width:number,height:number):RawSurvey {
  const draft=surveySchema.parse(value)
  const source=z.object({source:z.object({imageBox:z.tuple([z.number().finite(),z.number().finite(),z.number().finite(),z.number().finite()]),imageSize:z.tuple([z.number().positive(),z.number().positive()])})}).safeParse(value)
  const box=source.success?source.data.source.imageBox:[0,0,width,height]
  const sx=source.success?width/source.data.source.imageSize[0]:1,sy=source.success?height/source.data.source.imageSize[1]:1
  const x0=box[0]*sx,y0=box[1]*sy,w=(box[2]-box[0])*sx,h=(box[3]-box[1])*sy
  if(w<=0||h<=0)throw Error('The drawing reader returned invalid image bounds.')
  const scale=draft.widthM?draft.widthM/w:draft.depthM?draft.depthM/h:undefined
  const provisional=scale??12/width
  const point=(p:{x:number;y:number})=>({x:x0+p.x*w/1000,y:y0+p.y*h/1000})
  return validateRawSurvey({imageWidth:width,imageHeight:height,scaleMPerPx:scale,
    elements:{
      rooms:draft.rooms.map((r,i)=>({id:`room-${i+1}`,name:r.name,type:r.type,box:{...point(r),w:r.w*w/1000,h:r.h*h/1000},stairStartSide:r.stairStartSide,confidence:.65})),
      walls:draft.walls.map((w,i)=>({id:`wall-${i+1}`,a:point(w.a),b:point(w.b),kind:w.kind,...(w.thicknessMm?{thicknessPx:w.thicknessMm/1000/provisional}:{}),confidence:.65})),
      openings:draft.openings.map((o,i)=>({id:`opening-${i+1}`,kind:o.kind,orient:o.orient,at:point(o),widthPx:(o.widthM??(o.kind==='window'?1.2:.9))/provisional,headM:o.headM??undefined,sillM:o.sillM??undefined,swing:o.swing,leaf:o.leaf,confidence:.65})),
      dimensions:[]},
    columns:draft.columns.map(c=>({...point(c),sizeMm:c.sizeMm})),
    metadata:{adapterId:'auto-ai-digitizer',timestamp:Date.now(),notes:[...draft.notes,
      'Detected geometry needs review. Unlabelled construction dimensions use editable standard assumptions.',
      ...(scale?[]:['No readable drawing scale was found. Calibrate a known dimension before continuing.'])].slice(0,30)}})
}

export class AutomaticDrawingDigitizer implements DrawingDigitizer {
  readonly id='auto-ai-digitizer'
  readonly name='Drawing reader'
  readonly description='Reads the uploaded geometry with the configured local drawing reader.'
  async digitize(image:File|Blob,opts?:DigitizeOptions):Promise<RawSurvey>{
    const dims=await getImageDimensions(image)
    const base64=await new Promise<string>((resolve,reject)=>{
      const reader=new FileReader()
      reader.onload=()=>resolve(String(reader.result).split(',')[1])
      reader.onerror=()=>reject(Error('Could not read the drawing image.'))
      reader.readAsDataURL(image)
    })
    const response=await fetch('/api/existing-plan/read',{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({imageBase64:base64,mimeType:image.type||'image/png'}),signal:opts?.signal??AbortSignal.timeout(opts?.timeoutMs??180000)})
    const data=await response.json()
    if(!response.ok)throw Error(data.error||'The drawing reader is unavailable.')
    return drawingDraftToRaw(data.draft,dims.width,dims.height)
  }
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

// Register the automatic AI digitizer as primary and manual trace as fallback
const autoDigitizer = new AutomaticDrawingDigitizer()
const defaultManual = new ManualTraceDigitizer()
registry.set(autoDigitizer.id, autoDigitizer)
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
  // Return the most recently registered non-manual digitizer if available, else manual
  const entries = Array.from(registry.entries()).reverse()
  for (const [key, d] of entries) {
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

  let timer:ReturnType<typeof setTimeout>|undefined
  const controller=new AbortController()
  const abort=()=>controller.abort(opts?.signal?.reason)
  opts?.signal?.addEventListener('abort',abort,{once:true})
  try {
    if(opts?.signal?.aborted)throw new DOMException('Cancelled','AbortError')
    const deadline=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('Drawing reader timed out.'))},opts?.timeoutMs??180000)})
    const survey=validateRawSurvey(await Promise.race([primary.digitize(image,{...opts,signal:controller.signal}),deadline]))
    return {survey,fallbackUsed:false}
  }catch(error){
    if(opts?.signal?.aborted)throw error
    return {survey:await registry.get('manual-trace')!.digitize(image,opts),fallbackUsed:true,error:error instanceof Error?error.message:'Drawing reader failed'}
  }finally{clearTimeout(timer);opts?.signal?.removeEventListener('abort',abort)}
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

  // Derive origin offset from element bounding box if not explicitly set
  const rawAllX = [
    ...raw.elements.walls.flatMap((w) => [w.a.x, w.b.x]),
    ...raw.elements.rooms.flatMap((r) => [r.box.x, r.box.x + r.box.w]),
    ...raw.elements.openings.map((o) => o.at.x),
  ]
  const rawAllY = [
    ...raw.elements.walls.flatMap((w) => [w.a.y, w.b.y]),
    ...raw.elements.rooms.flatMap((r) => [r.box.y, r.box.y + r.box.h]),
    ...raw.elements.openings.map((o) => o.at.y),
  ]

  const originX = originOffsetPx.x !== 0 ? originOffsetPx.x : rawAllX.length ? Math.min(...rawAllX) : 0
  const originY = originOffsetPx.y !== 0 ? originOffsetPx.y : rawAllY.length ? Math.min(...rawAllY) : 0

  const pxToM = (px: number) => +(px * scaleMPerPx).toFixed(3)
  const ptToM = (pt: ImagePointPx) => ({
    x: +(Math.max(0, pt.x - originX) * scaleMPerPx).toFixed(3),
    y: +(Math.max(0, pt.y - originY) * scaleMPerPx).toFixed(3),
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
      r.type === 'store' ? 'utility' : r.type === 'balcony' ? 'utility' : r.type === 'master_bed'
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
      stairStartSide: r.stairStartSide ?? null,
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
    const headM = o.headM ?? (o.kind === 'window' ? SURVEY_DEFAULTS.windowHeadM : SURVEY_DEFAULTS.doorHeadM)
    const sillM = o.kind === 'window' ? o.sillM ?? SURVEY_DEFAULTS.windowSillM : null
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
      leaf: o.leaf ?? true,
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

  const maxX = allX.length ? Math.max(...allX) : pxToM(raw.imageWidth)
  const maxY = allY.length ? Math.max(...allY) : pxToM(raw.imageHeight)

  const widthM = +(maxX + 0.05).toFixed(2)
  const depthM = +(maxY + 0.05).toFixed(2)

  const draft: Survey = {
    widthM: widthM > 0 ? widthM : null,
    depthM: depthM > 0 ? depthM : null,
    heightM: SURVEY_DEFAULTS.heightM,
    plotOffsetXM: SURVEY_SETBACKS.left,
    plotOffsetYM: SURVEY_SETBACKS.rear,
    columns: (raw.columns??[]).map(c=>({...ptToM(c),sizeMm:c.sizeMm??SURVEY_DEFAULTS.columnMm})),
    footings: [],
    beams: [],
    walls,
    rooms,
    openings,
    notes: [
      ...(raw.metadata?.notes??[]),
      `Digitized via ${raw.metadata?.adapterId ?? 'custom adapter'} at ${scaleMPerPx.toFixed(5)} m/px.`,
    ],
  }

  // Validate with surveySchema
  return surveySchema.parse(draft)
}

const coordinate=z.number().finite().min(0).max(65535)
const imagePoint=z.object({x:coordinate,y:coordinate})
const confidence=z.number().finite().min(0).max(1)
const rawSchema=z.object({imageWidth:coordinate.positive(),imageHeight:coordinate.positive(),scaleMPerPx:z.number().finite().positive().optional(),
 columns:z.array(imagePoint.extend({sizeMm:z.number().finite().min(100).max(1500).nullable()})).max(150).optional(),
 elements:z.object({
  rooms:z.array(z.object({id:z.string(),name:z.string().min(1).max(80),type:z.string(),box:imagePoint.extend({w:coordinate.positive(),h:coordinate.positive()}),confidence,stairStartSide:z.enum(['N','S','E','W']).nullable().optional()}).passthrough()).max(100),
  walls:z.array(z.object({id:z.string(),a:imagePoint,b:imagePoint,kind:z.enum(['exterior','interior']),thicknessPx:z.number().finite().positive().optional(),confidence})).max(300),
  openings:z.array(z.object({id:z.string(),kind:z.enum(['entry','door','window']),orient:z.enum(['h','v']),at:imagePoint,widthPx:coordinate.positive(),confidence,swing:z.number().optional(),headM:z.number().finite().positive().optional(),sillM:z.number().finite().min(0).optional(),leaf:z.boolean().optional()})).max(200),
  dimensions:z.array(z.object({id:z.string(),text:z.string(),a:imagePoint,b:imagePoint,confidence,valueM:z.number().finite().positive().optional()})).max(200)}),
 metadata:z.object({adapterId:z.string(),timestamp:z.number().finite(),notes:z.array(z.string().max(500)).max(30).optional()}).optional()})
export function validateRawSurvey(value:unknown):RawSurvey{
 const raw=rawSchema.parse(value)
 const points=[...raw.elements.rooms.flatMap(r=>[{x:r.box.x,y:r.box.y},{x:r.box.x+r.box.w,y:r.box.y+r.box.h}]),...raw.elements.walls.flatMap(w=>[w.a,w.b]),...raw.elements.openings.map(o=>o.at)]
 if(points.some(p=>p.x>raw.imageWidth+.01||p.y>raw.imageHeight+.01))throw Error('Detected geometry extends outside the image. Review the drawing manually.')
 return raw
}
