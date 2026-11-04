import { useState, useRef, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  UploadCloud,
  FileImage,
  ArrowRight,
  ArrowLeft,
  RotateCw,
  RotateCcw,
  Sliders,
  CheckCircle2,
  AlertTriangle,
  Building2,
  Home,
  Compass,
  Layers,
  Sparkles,
  Check,
} from 'lucide-react'
import {
  validateImageFile,
  downscaleImageIfNeeded,
  digitizeWithFallback,
  rawSurveyToSurvey,
  type RawSurvey,
} from '@/lib/existing/digitizer.ts'
import { applyIndianConstructionSnapping, type SnappingDiff } from '@/lib/existing/snapping.ts'
import { checkNbcHealth, type NbcHealthReport } from '@/lib/existing/nbcPreflight.ts'
import { defaultPlot, measuredStructure, type Survey } from '@/lib/existing/survey.ts'
import { briefFromAnswers } from '@/lib/existing/plan.ts'
import { useStudio } from '@/state/studio.ts'
import { useExisting } from '@/state/existing.ts'
import { type Answers, type RoadSide } from '@/lib/existing/types.ts'
import type { BuildingType, Character } from '@/lib/model/brief.ts'
import { Button } from '@/components/ui/Button.tsx'
import { DrawingCanvasReviewer } from './DrawingCanvasReviewer.tsx'
import { InteractiveFitQuestioner } from './InteractiveFitQuestioner.tsx'
import { StyleSelectorCard } from './StyleSelectorCard.tsx'
import { cx } from '@/lib/cx.ts'

const STORAGE_KEY = 'brickpilot_drawing_review_v2'

export type FlowStep = 'project' | 'upload' | 'review' | 'remediation' | 'style'

interface FloorSlot {
  level: number
  label: string
  imageUrl: string | null
  rawSurvey: RawSurvey | null
  scaleMPerPx: number
  orientation: 'landscape' | 'portrait' | null
}

interface SavedState {
  step: FlowStep
  projectName: string
  storeysWanted: number
  buildingType: BuildingType
  character: Character
  plinthHeight?: 'standard' | 'raised' | 'flood'
  rawSurvey: RawSurvey | null
  scaleMPerPx: number
  imageUrl: string | null
  answers: Answers
}

/** In-memory canvas-based 90-degree image rotation helper */
async function rotateDataUrl(dataUrl: string, degrees = 90): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')
      if (!ctx) return resolve(dataUrl)
      if (degrees === 90 || degrees === 270) {
        canvas.width = img.height
        canvas.height = img.width
      } else {
        canvas.width = img.width
        canvas.height = img.height
      }
      ctx.translate(canvas.width / 2, canvas.height / 2)
      ctx.rotate((degrees * Math.PI) / 180)
      ctx.drawImage(img, -img.width / 2, -img.height / 2)
      resolve(canvas.toDataURL('image/png'))
    }
    img.src = dataUrl
  })
}

export function StartFromPlanFlow() {
  const navigate = useNavigate()
  const existingStore = useExisting()
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const targetUploadLevelRef = useRef<number>(0)

  // Wizard state: 'project' | 'upload' | 'review' | 'remediation' | 'style'
  const [currentStep, setCurrentStep] = useState<FlowStep>('project')

  // Project configuration
  const [projectName, setProjectName] = useState<string>('My Villa')
  const [storeysWanted, setStoreysWanted] = useState<number>(1)
  const [buildingType, setBuildingType] = useState<BuildingType>('villa')
  const [character, setCharacter] = useState<Character>('modern-box')
  const [plinthHeight, setPlinthHeight] = useState<'standard' | 'raised' | 'flood'>('standard')

  // Floor drawing slots
  const [activeLevel, setActiveLevel] = useState<number>(0)
  const [floorSlots, setFloorSlots] = useState<Record<number, FloorSlot>>({
    0: { level: 0, label: 'Ground Floor', imageUrl: null, rawSurvey: null, scaleMPerPx: 0.01, orientation: null },
    1: { level: 1, label: 'First Floor', imageUrl: null, rawSurvey: null, scaleMPerPx: 0.01, orientation: null },
    2: { level: 2, label: 'Second Floor', imageUrl: null, rawSurvey: null, scaleMPerPx: 0.01, orientation: null },
  })

  // Primary active drawing & survey state (for active level)
  const [isDragging, setIsDragging] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [scaleMPerPx, setScaleMPerPx] = useState<number>(0.01)
  const [answers, setAnswers] = useState<Answers>(existingStore.answers)

  // Snapping Diff & Undo state
  const [snappedDiff, setSnappedDiff] = useState<SnappingDiff | null>(null)
  const [preSnappedSurvey, setPreSnappedSurvey] = useState<Survey | null>(null)
  const [activeSurvey, setActiveSurvey] = useState<Survey | null>(null)

  // NBC Health Report
  const [nbcReport, setNbcReport] = useState<NbcHealthReport | null>(null)

  // Active floor slot shorthand
  const currentFloor = floorSlots[activeLevel] || floorSlots[0]
  const imageUrl = currentFloor?.imageUrl ?? null
  const rawSurvey = currentFloor?.rawSurvey ?? null

  // Restore draft state on mount if present
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        const parsed: SavedState = JSON.parse(saved)
        if (parsed.projectName) setProjectName(parsed.projectName)
        if (parsed.storeysWanted) setStoreysWanted(parsed.storeysWanted)
        if (parsed.buildingType) setBuildingType(parsed.buildingType)
        if (parsed.character) setCharacter(parsed.character)
        if (parsed.plinthHeight) setPlinthHeight(parsed.plinthHeight)
        if (parsed.rawSurvey && parsed.imageUrl) {
          setScaleMPerPx(parsed.scaleMPerPx || 0.01)
          setFloorSlots((prev) => ({
            ...prev,
            0: {
              ...prev[0],
              imageUrl: parsed.imageUrl,
              rawSurvey: parsed.rawSurvey,
              scaleMPerPx: parsed.scaleMPerPx || 0.01,
            },
          }))
          setAnswers(parsed.answers || existingStore.answers)
          if (parsed.step) setCurrentStep(parsed.step)
        }
      }
    } catch {
      // Ignore corrupted local storage
    }
  }, [existingStore.answers])

  // Save draft state to localStorage
  const saveDraft = (survey: RawSurvey | null, scale: number, img: string | null, ans: Answers, step: FlowStep) => {
    try {
      const data: SavedState = {
        step,
        projectName,
        storeysWanted,
        buildingType,
        character,
        plinthHeight,
        rawSurvey: survey,
        scaleMPerPx: scale,
        imageUrl: img,
        answers: ans,
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
    } catch {
      // Storage quota exceeded or disabled
    }
  }

  // Handle image upload and initiate digitization for a specific floor level
  const processImageFile = async (file: File, level = activeLevel) => {
    setErrorMessage(null)
    const validation = validateImageFile(file)
    if (!validation.valid) {
      setErrorMessage(validation.error ?? 'Invalid image file.')
      return
    }

    setIsProcessing(true)
    try {
      // 1. Downscale large images client-side for responsive canvas performance
      const { dataUrl, width, height } = await downscaleImageIfNeeded(file)
      const orientation = width >= height ? 'landscape' : 'portrait'

      // 2. Digitize using pluggable digitizer (falls back gracefully to in-memory synthesis / manual)
      const { survey: raw } = await digitizeWithFallback(file)

      // Default scale: assume house spans ~70% of image width for a standard ~12m plot
      const initialScale = +(12.0 / (width * 0.7)).toFixed(5)

      setFloorSlots((prev) => ({
        ...prev,
        [level]: {
          ...prev[level],
          imageUrl: dataUrl,
          rawSurvey: raw,
          scaleMPerPx: initialScale,
          orientation,
        },
      }))

      if (level === 0) {
        setScaleMPerPx(initialScale)
        const defPlot = defaultPlot(15, 18)
        const updatedAnswers: Answers = {
          ...answers,
          plotWidthM: defPlot.widthM,
          plotDepthM: defPlot.depthM,
          storeysBuilt: storeysWanted,
          storeysWanted,
        }
        setAnswers(updatedAnswers)
        saveDraft(raw, initialScale, dataUrl, updatedAnswers, 'review')
        // Advance to review step once primary plan is processed
        setCurrentStep('review')
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to process drawing image.')
    } finally {
      setIsProcessing(false)
    }
  }

  // Handle 90° image rotation for horizontal/vertical plans
  const handleRotateImage = async (level = activeLevel) => {
    const slot = floorSlots[level]
    if (!slot?.imageUrl) return
    setIsProcessing(true)
    try {
      const rotatedUrl = await rotateDataUrl(slot.imageUrl, 90)
      const nextOrientation = slot.orientation === 'landscape' ? 'portrait' : 'landscape'
      setFloorSlots((prev) => ({
        ...prev,
        [level]: {
          ...prev[level],
          imageUrl: rotatedUrl,
          orientation: nextOrientation,
        },
      }))
    } finally {
      setIsProcessing(false)
    }
  }

  // Update Survey & NBC whenever rawSurvey or scale changes
  useEffect(() => {
    if (!rawSurvey || !scaleMPerPx) return
    try {
      const surveyMetres = rawSurveyToSurvey(rawSurvey, scaleMPerPx)
      setActiveSurvey(surveyMetres)

      // Compute live NBC health
      const report = checkNbcHealth(surveyMetres, {
        plotWidthM: answers.plotWidthM,
        plotDepthM: answers.plotDepthM,
      })
      setNbcReport(report)
    } catch {
      // Survey coordinates in draft state
    }
  }, [rawSurvey, scaleMPerPx, answers.plotWidthM, answers.plotDepthM])

  // Automatic Construction Snapping
  const handleApplySnapping = () => {
    if (!activeSurvey) return
    setPreSnappedSurvey(structuredClone(activeSurvey))

    const { snappedSurvey, diff } = applyIndianConstructionSnapping(activeSurvey)
    setActiveSurvey(snappedSurvey)
    setSnappedDiff(diff)

    // Recompute NBC report on snapped survey
    const report = checkNbcHealth(snappedSurvey, {
      plotWidthM: answers.plotWidthM,
      plotDepthM: answers.plotDepthM,
    })
    setNbcReport(report)
  }

  // Undo Snapping
  const handleUndoSnapping = () => {
    if (preSnappedSurvey) {
      setActiveSurvey(preSnappedSurvey)
      setSnappedDiff(null)
      setPreSnappedSurvey(null)
      const report = checkNbcHealth(preSnappedSurvey, {
        plotWidthM: answers.plotWidthM,
        plotDepthM: answers.plotDepthM,
      })
      setNbcReport(report)
    }
  }

  // Final Handoff: Build 3D Model -> Studio -> Navigate
  const handleGenerate3DModel = () => {
    if (!activeSurvey) return
    setErrorMessage(null)

    try {
      // 1. Ensure snapping is applied for structural accuracy
      let finalSurvey = activeSurvey
      if (!snappedDiff) {
        const { snappedSurvey } = applyIndianConstructionSnapping(activeSurvey)
        finalSurvey = snappedSurvey
      }

      // Safeguard: Ensure plot dimensions comfortably accommodate the structure and offsets
      const minPlotW = Math.ceil((finalSurvey.widthM || 10) + (finalSurvey.plotOffsetXM || 1.5) + 1.5)
      const minPlotD = Math.ceil((finalSurvey.depthM || 12) + (finalSurvey.plotOffsetYM || 2.0) + 2.0)
      const safeAnswers: Answers = {
        ...answers,
        plotWidthM: Math.max(answers.plotWidthM || 15, minPlotW),
        plotDepthM: Math.max(answers.plotDepthM || 18, minPlotD),
        storeysWanted,
        storeysBuilt: storeysWanted,
      }

      // 2. Validate measured structure
      const asBuilt = measuredStructure(finalSurvey, safeAnswers, true)

      // 3. Generate Brief with Project Name, Typology, Selected Style, and Plinth Height
      const brief = briefFromAnswers(
        safeAnswers,
        {
          name: projectName || 'My Family Villa',
          buildingType,
          character,
          plinthHeight,
        }
      )

      // 4. Ingest into Studio Store (compiles brief and builds exactly 1 3D model for this plan)
      useStudio.getState().loadExisting(brief, asBuilt.structure, 1)

      // 5. Clear draft storage
      localStorage.removeItem(STORAGE_KEY)

      // 6. Navigate cleanly to 2D plan and 3D massing workspace
      navigate('/workspace/plan')
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Please check your drawing measurements.')
    }
  }

  // Stepper progress indicator items
  const steps: { key: FlowStep; label: string; number: number }[] = [
    { key: 'project', label: '1. Project Info', number: 1 },
    { key: 'upload', label: '2. Upload Drawings', number: 2 },
    { key: 'review', label: '3. CAD Review', number: 3 },
    { key: 'remediation', label: '4. Fit & Code Q&A', number: 4 },
    { key: 'style', label: '5. Architectural Style', number: 5 },
  ]

  const currentStepIndex = steps.findIndex((s) => s.key === currentStep)

  return (
    <div className="w-full space-y-6">
      {/* GLOBAL STEPPER HEADER */}
      <div className="w-full rounded-2xl border border-line bg-surface p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="font-display font-semibold text-lg text-ink-primary">
              Start From My Plan
            </span>
            <span className="text-xs font-mono text-ink-muted">/ Ingestion Wizard</span>
          </div>

          {/* Stepper pills */}
          <nav aria-label="Wizard Steps" className="flex items-center gap-1.5 sm:gap-2">
            {steps.map((st, i) => {
              const isPassed = currentStepIndex > i
              const isCurrent = currentStep === st.key
              return (
                <button
                  key={st.key}
                  type="button"
                  disabled={!isPassed && !isCurrent}
                  onClick={() => setCurrentStep(st.key)}
                  className={cx(
                    'px-3 py-1.5 rounded-xl text-xs font-mono transition-all flex items-center gap-1.5',
                    isCurrent
                      ? 'bg-accent text-white font-semibold shadow-sm'
                      : isPassed
                      ? 'bg-accent/10 text-accent hover:bg-accent/20 cursor-pointer'
                      : 'text-ink-muted/50 cursor-not-allowed'
                  )}
                >
                  {isPassed ? <Check size={12} /> : <span>{st.number}.</span>}
                  <span className="hidden md:inline">{st.label.replace(/^\d+\.\s*/, '')}</span>
                </button>
              )
            })}
          </nav>
        </div>
      </div>

      {/* ERROR BANNER */}
      {errorMessage && (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 p-4 rounded-xl border border-rose-300 bg-rose-50/80 dark:border-rose-900/40 dark:bg-rose-950/20 text-rose-800 dark:text-rose-200 text-sm"
        >
          <div className="flex items-center gap-2">
            <AlertTriangle size={16} className="text-rose-500 flex-none" />
            <span>{errorMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setErrorMessage(null)}
            className="text-xs underline font-mono"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* -------------------------------------------------------------------------- */}
      {/* STEP 1: PROJECT SETUP (NAME, FLOORS, TYPOLOGY) */}
      {/* -------------------------------------------------------------------------- */}
      {currentStep === 'project' && (
        <div className="max-w-2xl mx-auto py-6 space-y-8">
          <div>
            <h2 className="font-display text-3xl font-semibold text-ink-primary">
              Project Name & Floor Count
            </h2>
            <p className="mt-2 text-sm text-ink-muted leading-relaxed">
              Name your project and select how many floors your drawing represents. We will prepare drawing slots for each level.
            </p>
          </div>

          <div className="space-y-6 rounded-2xl border border-line bg-surface p-6 shadow-sm">
            {/* Project Name Field */}
            <div className="space-y-2">
              <label htmlFor="project-name-input" className="text-xs font-mono uppercase tracking-wider text-ink-muted">
                Project Name
              </label>
              <input
                id="project-name-input"
                type="text"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                placeholder="e.g. Shanti Villa, Lakeview Residence"
                className="w-full px-4 py-3 rounded-xl border border-line bg-surface-elevated text-base text-ink-primary font-medium focus:outline-none focus:ring-2 focus:ring-accent"
              />
              <span className="text-[0.75rem] text-ink-muted">
                This will appear on your architectural reports, 3D title blocks, and BOQ estimates.
              </span>
            </div>

            {/* Floor Count / Storeys Wanted */}
            <div className="space-y-2">
              <label className="text-xs font-mono uppercase tracking-wider text-ink-muted">
                Number of Floors to Build
              </label>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { count: 1, label: 'Single Storey', sub: 'Ground Only' },
                  { count: 2, label: '2 Storeys', sub: 'G+1 Villa' },
                  { count: 3, label: '3 Storeys', sub: 'G+2 Villa' },
                ].map((item) => (
                  <button
                    key={item.count}
                    type="button"
                    onClick={() => {
                      setStoreysWanted(item.count)
                      setAnswers((prev) => ({ ...prev, storeysWanted: item.count, storeysBuilt: item.count }))
                    }}
                    className={cx(
                      'p-4 rounded-xl border-2 text-left transition-all',
                      storeysWanted === item.count
                        ? 'border-accent bg-accent/5 ring-2 ring-accent/20'
                        : 'border-line bg-surface hover:border-accent/40 hover:bg-surface-elevated'
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-sm text-ink-primary">{item.label}</span>
                      {storeysWanted === item.count && <Check size={14} className="text-accent" />}
                    </div>
                    <span className="text-xs text-ink-muted block mt-1">{item.sub}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Typology Selection */}
            <div className="space-y-2">
              <label className="text-xs font-mono uppercase tracking-wider text-ink-muted">
                Building Typology
              </label>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { type: 'villa' as const, label: 'Villa / Bungalow', sub: 'Standard family scale with compact block' },
                  { type: 'large-villa' as const, label: 'Large Estate Villa', sub: 'Expansive wings, double-height volumes' },
                ].map((item) => (
                  <button
                    key={item.type}
                    type="button"
                    onClick={() => setBuildingType(item.type)}
                    className={cx(
                      'p-4 rounded-xl border-2 text-left transition-all',
                      buildingType === item.type
                        ? 'border-accent bg-accent/5 ring-2 ring-accent/20'
                        : 'border-line bg-surface hover:border-accent/40 hover:bg-surface-elevated'
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-sm text-ink-primary">{item.label}</span>
                      {buildingType === item.type && <Check size={14} className="text-accent" />}
                    </div>
                    <span className="text-xs text-ink-muted block mt-1">{item.sub}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="flex justify-end">
            <Button
              size="lg"
              onClick={() => setCurrentStep('upload')}
              className="flex items-center gap-2"
            >
              <span>Continue to Drawing Upload</span>
              <ArrowRight size={16} />
            </Button>
          </div>
        </div>
      )}

      {/* -------------------------------------------------------------------------- */}
      {/* STEP 2: DRAWING UPLOAD (SINGLE OR MULTI-FLOOR, ANY ORIENTATION) */}
      {/* -------------------------------------------------------------------------- */}
      {currentStep === 'upload' && (
        <div className="max-w-3xl mx-auto py-6 space-y-8">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="font-display text-3xl font-semibold text-ink-primary">
                Upload Plan Drawing{storeysWanted > 1 ? 's' : ''}
              </h2>
              <p className="mt-2 text-sm text-ink-muted leading-relaxed">
                Upload your hand-drawn sketch, contractor blueprint, or grid plan. Vertical (portrait) and horizontal (landscape) drawings are automatically supported.
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setCurrentStep('project')}>
              <ArrowLeft size={14} />
              <span>Back</span>
            </Button>
          </div>

          {/* Floor tabs if multi-storey */}
          {storeysWanted > 1 && (
            <div className="flex items-center gap-2 border-b border-line pb-2">
              {Array.from({ length: storeysWanted }).map((_, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => setActiveLevel(idx)}
                  className={cx(
                    'px-4 py-2 rounded-xl text-xs font-mono transition-all flex items-center gap-2 border',
                    activeLevel === idx
                      ? 'border-accent bg-accent text-white font-semibold'
                      : 'border-line bg-surface text-ink-muted hover:text-ink-primary'
                  )}
                >
                  <Layers size={13} />
                  <span>{floorSlots[idx]?.label ?? `Level ${idx}`}</span>
                  {floorSlots[idx]?.imageUrl && <Check size={12} />}
                </button>
              ))}
            </div>
          )}

          {/* Active Level Upload Card */}
          <div
            role="button"
            tabIndex={0}
            onClick={() => {
              targetUploadLevelRef.current = activeLevel
              fileInputRef.current?.click()
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                targetUploadLevelRef.current = activeLevel
                fileInputRef.current?.click()
              }
            }}
            onDragOver={(e) => {
              e.preventDefault()
              setIsDragging(true)
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => {
              e.preventDefault()
              setIsDragging(false)
              const file = e.dataTransfer.files?.[0]
              if (file) void processImageFile(file, activeLevel)
            }}
            className={cx(
              'flex flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed p-10 text-center transition-all cursor-pointer',
              isDragging
                ? 'border-accent bg-accent/5 scale-[1.01]'
                : 'border-line bg-surface hover:border-accent/70 hover:bg-surface-elevated'
            )}
          >
            {currentFloor.imageUrl ? (
              <div className="space-y-4 w-full flex flex-col items-center">
                <div className="relative max-w-sm max-h-60 overflow-hidden rounded-xl border border-line bg-black/5 p-2">
                  <img
                    src={currentFloor.imageUrl}
                    alt={currentFloor.label}
                    className="max-h-52 w-auto object-contain mx-auto rounded"
                  />
                  <div className="absolute top-3 right-3 flex items-center gap-1.5">
                    <span className="text-[0.65rem] font-mono px-2 py-0.5 rounded-full bg-black/70 text-white backdrop-blur">
                      {currentFloor.orientation === 'landscape' ? 'Horizontal' : 'Vertical'}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={(e) => {
                      e.stopPropagation()
                      void handleRotateImage(activeLevel)
                    }}
                    className="flex items-center gap-1.5 text-xs"
                  >
                    <RotateCw size={13} />
                    <span>Rotate 90°</span>
                  </Button>

                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={(e) => {
                      e.stopPropagation()
                      targetUploadLevelRef.current = activeLevel
                      fileInputRef.current?.click()
                    }}
                    className="text-xs"
                  >
                    Change Drawing
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <div className="p-4 rounded-full bg-accent/10 text-accent">
                  <UploadCloud size={32} />
                </div>
                <div>
                  <h3 className="font-display text-xl font-semibold text-ink-primary">
                    Upload {currentFloor.label} Drawing
                  </h3>
                  <p className="mt-1.5 text-xs text-ink-muted max-w-md">
                    Drop your hand-drawn sketch, contractor plan, or architect blueprint. Supports PNG, JPEG, and WebP up to 10 MB.
                  </p>
                </div>
                <Button disabled={isProcessing} className="mt-2">
                  <FileImage size={15} />
                  <span>{isProcessing ? 'Processing image…' : 'Choose Drawing Image'}</span>
                </Button>
              </>
            )}

            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void processImageFile(file, targetUploadLevelRef.current)
              }}
            />
          </div>

          {/* Action Row */}
          {floorSlots[0].imageUrl && (
            <div className="flex items-center justify-between pt-4 border-t border-line">
              <span className="text-xs font-mono text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                <CheckCircle2 size={14} />
                <span>Plan extracted into memory</span>
              </span>

              <Button
                size="lg"
                onClick={() => setCurrentStep('review')}
                className="flex items-center gap-2"
              >
                <span>Study Drawing & Review Plan</span>
                <ArrowRight size={16} />
              </Button>
            </div>
          )}
        </div>
      )}

      {/* -------------------------------------------------------------------------- */}
      {/* STEP 3: CAD OVERLAY REVIEWER & SCALE CALIBRATION */}
      {/* -------------------------------------------------------------------------- */}
      {currentStep === 'review' && imageUrl && rawSurvey && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="font-display text-2xl font-semibold text-ink-primary">
                Review & Calibrate Your Plan
              </h2>
              <p className="mt-1 text-sm text-ink-muted">
                Inspect detected rooms and walls against the drawing. Use the two-point tool to calibrate real-world scale.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <Button variant="ghost" size="sm" onClick={() => setCurrentStep('upload')}>
                <ArrowLeft size={14} />
                <span>Uploads</span>
              </Button>

              {!snappedDiff ? (
                <Button variant="ghost" size="sm" onClick={handleApplySnapping} className="flex items-center gap-1.5">
                  <Sliders size={14} />
                  <span>Snap Masonry Grid</span>
                </Button>
              ) : (
                <Button variant="ghost" size="sm" onClick={handleUndoSnapping} className="flex items-center gap-1.5">
                  <RotateCcw size={14} />
                  <span>Undo Snapping</span>
                </Button>
              )}

              <Button onClick={() => setCurrentStep('remediation')} className="flex items-center gap-2">
                <span>Proceed to Fit & Code Q&A</span>
                <ArrowRight size={14} />
              </Button>
            </div>
          </div>

          {/* Snapping Diff Summary Alert */}
          {snappedDiff && (
            <div className="flex items-center justify-between p-3.5 rounded-xl border border-emerald-200 bg-emerald-50/70 dark:border-emerald-900/40 dark:bg-emerald-950/20 text-emerald-900 dark:text-emerald-200 text-xs">
              <div className="flex items-center gap-2">
                <CheckCircle2 size={16} className="text-emerald-600 dark:text-emerald-400 flex-none" />
                <span className="font-medium">Indian Construction Snapping Applied:</span>
                <span>{snappedDiff.summary}</span>
              </div>
              <button
                type="button"
                onClick={handleUndoSnapping}
                className="underline text-emerald-700 dark:text-emerald-300 font-mono text-[0.7rem]"
              >
                Undo Snap
              </button>
            </div>
          )}

          {/* Interactive Canvas Reviewer */}
          <DrawingCanvasReviewer
            imageUrl={imageUrl}
            rawSurvey={rawSurvey}
            scaleMPerPx={scaleMPerPx}
            onChangeSurvey={(updated) => {
              setFloorSlots((prev) => ({
                ...prev,
                [activeLevel]: { ...prev[activeLevel], rawSurvey: updated },
              }))
              saveDraft(updated, scaleMPerPx, imageUrl, answers, currentStep)
            }}
            onChangeScale={(newScale) => {
              setScaleMPerPx(newScale)
              setFloorSlots((prev) => ({
                ...prev,
                [activeLevel]: { ...prev[activeLevel], scaleMPerPx: newScale },
              }))
              saveDraft(rawSurvey, newScale, imageUrl, answers, currentStep)
            }}
            plotWidthM={answers.plotWidthM}
            plotDepthM={answers.plotDepthM}
          />
        </div>
      )}

      {/* -------------------------------------------------------------------------- */}
      {/* STEP 4: INTERACTIVE Q&A & FIT REMEDIATION */}
      {/* -------------------------------------------------------------------------- */}
      {currentStep === 'remediation' && rawSurvey && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="font-display text-2xl font-semibold text-ink-primary">
                Fit Diagnostics & Code Q&A Assistant
              </h2>
              <p className="mt-1 text-sm text-ink-muted">
                Confirm your plot dimensions and resolve any building setbacks or natural ventilation issues before choosing your style.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <Button variant="ghost" size="sm" onClick={() => setCurrentStep('review')}>
                <ArrowLeft size={14} />
                <span>Back to Review</span>
              </Button>

              <Button onClick={() => setCurrentStep('style')} className="flex items-center gap-2">
                <span>Select Architectural Style</span>
                <ArrowRight size={14} />
              </Button>
            </div>
          </div>

          <InteractiveFitQuestioner
            rawSurvey={rawSurvey}
            activeSurvey={activeSurvey}
            scaleMPerPx={scaleMPerPx}
            plotWidthM={answers.plotWidthM || 15}
            plotDepthM={answers.plotDepthM || 18}
            roadSide={answers.roadSide || 'N'}
            nbcReport={nbcReport}
            snappedDiff={snappedDiff}
            onUpdateSurvey={(newSurvey) => {
              setFloorSlots((prev) => ({
                ...prev,
                [activeLevel]: { ...prev[activeLevel], rawSurvey: newSurvey },
              }))
              saveDraft(newSurvey, scaleMPerPx, imageUrl, answers, currentStep)
            }}
            onUpdateScale={(newScale) => {
              setScaleMPerPx(newScale)
              setFloorSlots((prev) => ({
                ...prev,
                [activeLevel]: { ...prev[activeLevel], scaleMPerPx: newScale },
              }))
              saveDraft(rawSurvey, newScale, imageUrl, answers, currentStep)
            }}
            onUpdatePlot={({ plotWidthM, plotDepthM }) => {
              const updated = { ...answers, plotWidthM, plotDepthM }
              setAnswers(updated)
              saveDraft(rawSurvey, scaleMPerPx, imageUrl, updated, currentStep)
            }}
            onUpdateRoadSide={(side) => {
              const updated = { ...answers, roadSide: side }
              setAnswers(updated)
              saveDraft(rawSurvey, scaleMPerPx, imageUrl, updated, currentStep)
            }}
            onApplySnapping={handleApplySnapping}
            onUndoSnapping={handleUndoSnapping}
          />
        </div>
      )}

      {/* -------------------------------------------------------------------------- */}
      {/* STEP 5: ARCHITECTURAL STYLE SELECTION */}
      {/* -------------------------------------------------------------------------- */}
      {currentStep === 'style' && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="font-display text-2xl font-semibold text-ink-primary">
                Select Your Villa Style
              </h2>
              <p className="mt-1 text-sm text-ink-muted">
                Choose the architectural elevation and exterior vocabulary. The system will build 1 high-fidelity 3D model according to your plan diagram.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <Button variant="ghost" size="sm" onClick={() => setCurrentStep('remediation')}>
                <ArrowLeft size={14} />
                <span>Back to Fit Check</span>
              </Button>

              <Button
                size="lg"
                onClick={handleGenerate3DModel}
                className="flex items-center gap-2 bg-accent text-white hover:bg-accent/90"
              >
                <Sparkles size={16} />
                <span>Generate 3D Model & Open Studio</span>
              </Button>
            </div>
          </div>

          {/* Style Selector Component */}
          <StyleSelectorCard
            buildingType={buildingType}
            character={character}
            plinthHeight={plinthHeight}
            onChangeBuildingType={setBuildingType}
            onChangeCharacter={setCharacter}
            onChangePlinthHeight={setPlinthHeight}
          />
        </div>
      )}
    </div>
  )
}
