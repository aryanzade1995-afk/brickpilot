import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  UploadCloud,
  FileImage,
  ArrowRight,
  RotateCcw,
  Sliders,
  CheckCircle2,
  AlertTriangle,
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
import { type Answers } from '@/lib/existing/types.ts'
import { Button } from '@/components/ui/Button.tsx'
import { DrawingCanvasReviewer } from './DrawingCanvasReviewer.tsx'
import { NbcHealthBadgePanel } from './NbcHealthBadgePanel.tsx'
import { cx } from '@/lib/cx.ts'

const STORAGE_KEY = 'brickpilot_drawing_review_v1'

interface SavedState {
  rawSurvey: RawSurvey
  scaleMPerPx: number
  imageUrl: string
  answers: Answers
}

export function StartFromPlanFlow() {
  const navigate = useNavigate()
  const existingStore = useExisting()
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  // Pipeline step: 'upload' | 'review' | 'snapped'
  const [pipelineStep, setPipelineStep] = useState<'upload' | 'review'>('upload')

  // Upload & Image state
  const [isDragging, setIsDragging] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [imageUrl, setImageUrl] = useState<string | null>(null)

  // Survey & Calibration state
  const [rawSurvey, setRawSurvey] = useState<RawSurvey | null>(null)
  const [scaleMPerPx, setScaleMPerPx] = useState<number>(0.01) // default 100px = 1m
  const [answers, setAnswers] = useState<Answers>(existingStore.answers)

  // Snapping Diff & Undo state
  const [snappedDiff, setSnappedDiff] = useState<SnappingDiff | null>(null)
  const [preSnappedSurvey, setPreSnappedSurvey] = useState<Survey | null>(null)
  const [activeSurvey, setActiveSurvey] = useState<Survey | null>(null)

  // NBC Health Report
  const [nbcReport, setNbcReport] = useState<NbcHealthReport | null>(null)

  // Restore draft state on mount if present
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        const parsed: SavedState = JSON.parse(saved)
        if (parsed.rawSurvey && parsed.imageUrl) {
          setRawSurvey(parsed.rawSurvey)
          setScaleMPerPx(parsed.scaleMPerPx || 0.01)
          setImageUrl(parsed.imageUrl)
          setAnswers(parsed.answers || existingStore.answers)
          setPipelineStep('review')
        }
      }
    } catch {
      // Ignore corrupted local storage
    }
  }, [existingStore.answers])

  // Save draft state to localStorage
  const saveDraft = (survey: RawSurvey, scale: number, img: string, ans: Answers) => {
    try {
      const data: SavedState = { rawSurvey: survey, scaleMPerPx: scale, imageUrl: img, answers: ans }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
    } catch {
      // Storage quota exceeded or disabled
    }
  }

  // Handle image upload and initiate digitization
  const processImageFile = async (file: File) => {
    setErrorMessage(null)
    const validation = validateImageFile(file)
    if (!validation.valid) {
      setErrorMessage(validation.error ?? 'Invalid image file.')
      return
    }

    setIsProcessing(true)
    try {
      // 1. Downscale large images client-side for responsive 60fps canvas performance
      const { dataUrl, width } = await downscaleImageIfNeeded(file)
      setImageUrl(dataUrl)

      // 2. Digitize using pluggable digitizer (falls back gracefully to ManualTraceDigitizer)
      const { survey: raw, fallbackUsed, error } = await digitizeWithFallback(file)

      if (fallbackUsed && error) {
        // Disclose fallback info non-blockingly
        console.warn('Digitizer fallback activated:', error)
      }

      // Default scale: assume house spans ~70% of image width for a standard ~12m plot
      const initialScale = +(12.0 / (width * 0.7)).toFixed(5)

      setRawSurvey(raw)
      setScaleMPerPx(initialScale)

      const defPlot = defaultPlot(10, 8)
      const updatedAnswers: Answers = {
        ...answers,
        plotWidthM: defPlot.widthM,
        plotDepthM: defPlot.depthM,
        storeysBuilt: 1,
        storeysWanted: 1,
      }
      setAnswers(updatedAnswers)
      saveDraft(raw, initialScale, dataUrl, updatedAnswers)
      setPipelineStep('review')
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to process drawing image.')
    } finally {
      setIsProcessing(false)
    }
  }

  // Update Survey whenever rawSurvey or scale changes
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

  // Final Handoff: Build 2D Plan -> Studio -> Navigate
  const handleBuild2DPlan = () => {
    if (!activeSurvey) return
    setErrorMessage(null)

    try {
      // 1. Ensure snapping is applied if not already
      let finalSurvey = activeSurvey
      if (!snappedDiff) {
        const { snappedSurvey } = applyIndianConstructionSnapping(activeSurvey)
        finalSurvey = snappedSurvey
      }

      // 2. Validate measured structure
      const asBuilt = measuredStructure(finalSurvey, answers, true)

      // 3. Brief generation & studio store handoff
      const brief = briefFromAnswers(answers)

      // Ingest into Studio store
      useStudio.getState().loadExisting(brief, asBuilt.structure, 1)

      // Clear draft storage
      localStorage.removeItem(STORAGE_KEY)

      // Navigate cleanly to 2D plan workspace
      navigate('/workspace/plan')
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Please check your drawing measurements.')
    }
  }

  return (
    <div className="w-full space-y-6">
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

      {/* STEP 1: UPLOAD SCREEN */}
      {pipelineStep === 'upload' && (
        <div className="max-w-2xl mx-auto py-8">
          <div
            role="button"
            tabIndex={0}
            onClick={() => fileInputRef.current?.click()}
            onKeyDown={(e) => e.key === 'Enter' && fileInputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault()
              setIsDragging(true)
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => {
              e.preventDefault()
              setIsDragging(false)
              const file = e.dataTransfer.files?.[0]
              if (file) void processImageFile(file)
            }}
            className={cx(
              'flex flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed p-12 text-center transition-all cursor-pointer',
              isDragging
                ? 'border-accent bg-accent/5 scale-[1.01]'
                : 'border-line bg-surface hover:border-accent/70 hover:bg-surface-elevated'
            )}
          >
            <div className="p-4 rounded-full bg-accent/10 text-accent">
              <UploadCloud size={32} />
            </div>
            <div>
              <h2 className="font-display text-2xl font-semibold text-ink-primary">
                Upload your house or contractor plan
              </h2>
              <p className="mt-2 text-sm text-ink-muted max-w-md">
                Drop your hand-drawn sketch, grid-paper plan, or architect blueprint here. Supports PNG, JPEG, and WebP up to 10 MB.
              </p>
            </div>
            <Button disabled={isProcessing} className="mt-2">
              <FileImage size={15} />
              <span>{isProcessing ? 'Processing image…' : 'Choose Plan Drawing'}</span>
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void processImageFile(file)
              }}
            />
          </div>

          <div className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs text-ink-muted">
            <div className="p-4 rounded-xl border border-line bg-surface">
              <span className="font-semibold text-ink-primary block mb-1">1. Pluggable Digitizer</span>
              Extracts rooms, walls, and doors in memory. Zero external server uploads without explicit authorization.
            </div>
            <div className="p-4 rounded-xl border border-line bg-surface">
              <span className="font-semibold text-ink-primary block mb-1">2. Interactive Review</span>
              Calibrate scale with 2 points, adjust room boundaries, and fine-tune door swings on an overlay.
            </div>
            <div className="p-4 rounded-xl border border-line bg-surface">
              <span className="font-semibold text-ink-primary block mb-1">3. Construction Ready</span>
              Snaps centrelines to 230/115 mm brick masonry and verifies against Indian NBC rules.
            </div>
          </div>
        </div>
      )}

      {/* STEP 2: INTERACTIVE CAD OVERLAY REVIEWER */}
      {pipelineStep === 'review' && imageUrl && rawSurvey && (
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
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setPipelineStep('upload')
                  setImageUrl(null)
                  setRawSurvey(null)
                  localStorage.removeItem(STORAGE_KEY)
                }}
              >
                Upload Different Drawing
              </Button>

              {!snappedDiff ? (
                <Button variant="ghost" size="sm" onClick={handleApplySnapping} className="flex items-center gap-1.5">
                  <Sliders size={14} />
                  <span>Snap to Construction Grid</span>
                </Button>
              ) : (
                <Button variant="ghost" size="sm" onClick={handleUndoSnapping} className="flex items-center gap-1.5">
                  <RotateCcw size={14} />
                  <span>Undo Snapping</span>
                </Button>
              )}

              <Button onClick={handleBuild2DPlan} className="flex items-center gap-2">
                <span>Build 2D Plan</span>
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
              setRawSurvey(updated)
              saveDraft(updated, scaleMPerPx, imageUrl, answers)
            }}
            onChangeScale={(newScale) => {
              setScaleMPerPx(newScale)
              saveDraft(rawSurvey, newScale, imageUrl, answers)
            }}
            plotWidthM={answers.plotWidthM}
            plotDepthM={answers.plotDepthM}
          />

          {/* NBC Pre-Flight Compliance Preview */}
          {nbcReport && (
            <NbcHealthBadgePanel
              report={nbcReport}
              onPlotChangeRequested={() => {
                const nextW = prompt('Enter real plot width in metres (e.g. 15):', String(answers.plotWidthM || 15))
                const nextD = prompt('Enter real plot length in metres (e.g. 18):', String(answers.plotDepthM || 18))
                if (nextW && nextD) {
                  const w = parseFloat(nextW)
                  const d = parseFloat(nextD)
                  if (w > 0 && d > 0) {
                    const nextAns = { ...answers, plotWidthM: w, plotDepthM: d }
                    setAnswers(nextAns)
                    saveDraft(rawSurvey, scaleMPerPx, imageUrl, nextAns)
                  }
                }
              }}
            />
          )}
        </div>
      )}
    </div>
  )
}

