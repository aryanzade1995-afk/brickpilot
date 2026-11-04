import { useState, useMemo } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Wand2,
  Maximize2,
  Minimize2,
  Compass,
  Check,
  HelpCircle,
  Sliders,
  Sparkles,
} from 'lucide-react'
import { type RawSurvey } from '@/lib/existing/digitizer.ts'
import { type Survey, SURVEY_SETBACKS } from '@/lib/existing/survey.ts'
import {
  autoScaleToFitPlot,
  calculateRequiredPlot,
  autoAddWindowToRoom,
  autoWidenAllDoors,
  type RemediationChangeReport,
} from '@/lib/existing/remediation.ts'
import { type NbcHealthReport } from '@/lib/existing/nbcPreflight.ts'
import { applyIndianConstructionSnapping, type SnappingDiff } from '@/lib/existing/snapping.ts'
import {
  sqmToGuntha,
  sqmToSqft,
  calculatePlotFromGuntha,
  GUNTHA_PRESETS,
  SQM_PER_GUNTHA,
} from '@/lib/existing/units.ts'
import { Button } from '@/components/ui/Button.tsx'
import { cx } from '@/lib/cx.ts'
import type { RoadSide } from '@/lib/existing/types.ts'

interface InteractiveFitQuestionerProps {
  rawSurvey: RawSurvey
  activeSurvey: Survey | null
  scaleMPerPx: number
  plotWidthM: number
  plotDepthM: number
  roadSide: RoadSide
  nbcReport: NbcHealthReport | null
  snappedDiff: SnappingDiff | null
  onUpdateSurvey: (newSurvey: RawSurvey) => void
  onUpdateScale: (newScale: number) => void
  onUpdatePlot: (plot: { plotWidthM: number; plotDepthM: number }) => void
  onUpdateRoadSide: (roadSide: RoadSide) => void
  onApplySnapping: () => void
  onUndoSnapping: () => void
}

export function InteractiveFitQuestioner({
  rawSurvey,
  scaleMPerPx,
  plotWidthM,
  plotDepthM,
  roadSide,
  nbcReport,
  snappedDiff,
  onUpdateSurvey,
  onUpdateScale,
  onUpdatePlot,
  onUpdateRoadSide,
  onApplySnapping,
  onUndoSnapping,
}: InteractiveFitQuestionerProps) {
  const [lastActionReport, setLastActionReport] = useState<RemediationChangeReport | null>(null)
  const [selectedResolution, setSelectedResolution] = useState<'scale' | 'expand' | 'manual'>('scale')
  const [manualPlotW, setManualPlotW] = useState(String(plotWidthM))
  const [manualPlotD, setManualPlotD] = useState(String(plotDepthM))

  // Measure current building dimensions in metres
  const footprint = useMemo(() => {
    const rooms = rawSurvey?.elements?.rooms || []
    const walls = rawSurvey?.elements?.walls || []
    const openings = rawSurvey?.elements?.openings || []
    const doors = openings.filter((o) => o.kind === 'door' || o.kind === 'entry')

    if (!rooms.length) return { w: 0, d: 0, roomCount: 0, wallCount: walls.length, doorCount: doors.length }
    const minX = Math.min(...rooms.map((r) => r.box.x))
    const maxX = Math.max(...rooms.map((r) => r.box.x + r.box.w))
    const minY = Math.min(...rooms.map((r) => r.box.y))
    const maxY = Math.max(...rooms.map((r) => r.box.y + r.box.h))

    return {
      w: +((maxX - minX) * scaleMPerPx).toFixed(2),
      d: +((maxY - minY) * scaleMPerPx).toFixed(2),
      roomCount: rooms.length,
      wallCount: walls.length,
      doorCount: doors.length,
    }
  }, [rawSurvey, scaleMPerPx])

  // Buildable area inside plot after setbacks
  const buildable = useMemo(() => {
    const w = +(plotWidthM - (SURVEY_SETBACKS.left + SURVEY_SETBACKS.right)).toFixed(2)
    const d = +(plotDepthM - (SURVEY_SETBACKS.rear + SURVEY_SETBACKS.road)).toFixed(2)
    return { w: Math.max(0, w), d: Math.max(0, d) }
  }, [plotWidthM, plotDepthM])

  // Calculate setback overflow
  const overflowW = +(footprint.w - buildable.w).toFixed(2)
  const overflowD = +(footprint.d - buildable.d).toFixed(2)
  const isPlotOverflow = overflowW > 0 || overflowD > 0

  // Minimum required plot
  const requiredPlot = useMemo(
    () => calculateRequiredPlot(rawSurvey, scaleMPerPx),
    [rawSurvey, scaleMPerPx]
  )

  // Plot Area in Guntha & Sq Ft
  const plotAreaM2 = plotWidthM * plotDepthM
  const currentGuntha = sqmToGuntha(plotAreaM2)
  const plotAreaSqft = sqmToSqft(plotAreaM2)

  // Ventilation check
  const ventCheck = nbcReport?.checks?.find((c) => c.id === 'ventilation')
  const unventilatedRooms = ventCheck && ventCheck.status !== 'pass' ? (ventCheck.offendingRoomIds || []) : []

  // Accessibility / doors check
  const accessCheck = nbcReport?.checks?.find((c) => c.id === 'accessibility')
  const narrowDoorsCount = accessCheck && accessCheck.status !== 'pass' ? (accessCheck.offendingOpeningIndices?.length || 0) : 0

  return (
    <div className="w-full space-y-6">
      {/* SUCCESS ACTION BANNER */}
      {lastActionReport && (
        <div className="flex items-center justify-between gap-3 p-4 rounded-xl border border-emerald-300 bg-emerald-50 dark:border-emerald-900/60 dark:bg-emerald-950/40 text-emerald-900 dark:text-emerald-200 text-sm">
          <div className="flex items-center gap-2.5">
            <Wand2 size={18} className="text-emerald-600 dark:text-emerald-400 flex-none" />
            <div>
              <span className="font-semibold">{lastActionReport.action}: </span>
              <span>{lastActionReport.details}</span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setLastActionReport(null)}
            className="text-xs font-mono underline hover:text-emerald-700"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* QUESTION 1: SITE CONFIRMATION */}
      <div className="rounded-2xl border border-line bg-surface p-6 shadow-sm space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-accent/10 text-accent">
              <Compass size={20} />
            </div>
            <div>
              <h3 className="font-display text-lg font-semibold text-ink-primary">
                1. Site Dimensions & Road Frontage Confirmation
              </h3>
              <p className="text-xs text-ink-muted">
                The AI measured your drawn building footprint as{' '}
                <strong className="text-ink-primary">{footprint.w} m wide × {footprint.d} m deep</strong>{' '}
                ({footprint.roomCount} rooms, {footprint.wallCount} walls).
              </p>
            </div>
          </div>
          <span className="text-xs font-mono px-2.5 py-1 rounded-full bg-surface-elevated border border-line text-ink-muted">
            Step 1 of 3
          </span>
        </div>

        {/* Guntha & Area Summary Banner */}
        <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-xl border border-line bg-surface-elevated text-xs">
          <div className="flex items-center gap-2.5">
            <span className="font-semibold text-accent font-mono text-sm">{currentGuntha} Guntha</span>
            <span className="text-ink-muted">({Math.round(plotAreaM2)} m² / {plotAreaSqft.toLocaleString('en-IN')} sq ft)</span>
          </div>
          <span className="text-[0.7rem] text-ink-muted font-mono">1 Guntha = 1,089 sq ft ≈ 101.17 m² (33 × 33 ft)</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-1">
          {/* Plot Width */}
          <div className="space-y-1.5">
            <label className="text-xs font-mono uppercase tracking-wider text-ink-muted">
              Plot Width (m)
            </label>
            <div className="relative">
              <input
                type="number"
                min="6"
                max="80"
                step="0.5"
                value={plotWidthM}
                onChange={(e) => {
                  const val = parseFloat(e.target.value)
                  if (val > 0) {
                    onUpdatePlot({ plotWidthM: val, plotDepthM })
                    setManualPlotW(String(val))
                  }
                }}
                className="w-full px-3.5 py-2.5 rounded-xl border border-line bg-surface-elevated text-sm text-ink-primary font-mono focus:outline-none focus:ring-2 focus:ring-accent"
              />
              <span className="absolute right-3.5 top-2.5 text-xs text-ink-muted font-mono">m</span>
            </div>
            <span className="text-[0.7rem] text-ink-muted">East-West frontage width</span>
          </div>

          {/* Plot Depth */}
          <div className="space-y-1.5">
            <label className="text-xs font-mono uppercase tracking-wider text-ink-muted">
              Plot Depth (m)
            </label>
            <div className="relative">
              <input
                type="number"
                min="6"
                max="80"
                step="0.5"
                value={plotDepthM}
                onChange={(e) => {
                  const val = parseFloat(e.target.value)
                  if (val > 0) {
                    onUpdatePlot({ plotWidthM, plotDepthM: val })
                    setManualPlotD(String(val))
                  }
                }}
                className="w-full px-3.5 py-2.5 rounded-xl border border-line bg-surface-elevated text-sm text-ink-primary font-mono focus:outline-none focus:ring-2 focus:ring-accent"
              />
              <span className="absolute right-3.5 top-2.5 text-xs text-ink-muted font-mono">m</span>
            </div>
            <span className="text-[0.7rem] text-ink-muted">North-South depth</span>
          </div>

          {/* Road Edge */}
          <div className="space-y-1.5">
            <label className="text-xs font-mono uppercase tracking-wider text-ink-muted">
              Road Access Side
            </label>
            <div className="grid grid-cols-4 gap-1.5">
              {(['N', 'E', 'S', 'W'] as RoadSide[]).map((side) => (
                <button
                  key={side}
                  type="button"
                  onClick={() => onUpdateRoadSide(side)}
                  className={cx(
                    'py-2 rounded-xl text-xs font-mono font-medium border transition-colors',
                    roadSide === side
                      ? 'border-accent bg-accent text-white'
                      : 'border-line bg-surface-elevated text-ink-muted hover:text-ink-primary'
                  )}
                >
                  {side === 'N' ? 'North' : side === 'E' ? 'East' : side === 'S' ? 'South' : 'West'}
                </button>
              ))}
            </div>
            <span className="text-[0.7rem] text-ink-muted">Direction your plot faces the road</span>
          </div>
        </div>

        {/* Quick Guntha Presets */}
        <div className="space-y-1.5 pt-2 border-t border-line/60">
          <label className="text-[0.7rem] font-mono uppercase tracking-wider text-ink-muted">
            Quick Guntha Plot Sizing Presets:
          </label>
          <div className="flex flex-wrap gap-1.5">
            {GUNTHA_PRESETS.map((g) => {
              const isSelected = Math.abs(currentGuntha - g) < 0.08
              return (
                <button
                  key={g}
                  type="button"
                  onClick={() => {
                    const aspect = plotDepthM > 0 && plotWidthM > 0 ? plotDepthM / plotWidthM : 1.2
                    const res = calculatePlotFromGuntha(g, aspect)
                    onUpdatePlot({ plotWidthM: res.widthM, plotDepthM: res.depthM })
                    setManualPlotW(String(res.widthM))
                    setManualPlotD(String(res.depthM))
                  }}
                  className={cx(
                    'px-2.5 py-1 rounded-lg text-xs font-mono border transition-colors cursor-pointer',
                    isSelected
                      ? 'border-accent bg-accent text-white font-semibold shadow-xs'
                      : 'border-line bg-surface-elevated text-ink-muted hover:text-ink-primary hover:border-accent/40'
                  )}
                >
                  {g} Guntha <span className="opacity-75 text-[0.65rem]">({Math.round(g * SQM_PER_GUNTHA)} m²)</span>
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* QUESTION 2: FIT & SETBACK RESOLUTION (WHAT IS NOT FITTING & HOW TO RESOLVE) */}
      <div className="rounded-2xl border border-line bg-surface p-6 shadow-sm space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div
              className={cx(
                'p-2.5 rounded-xl',
                isPlotOverflow ? 'bg-amber-500/10 text-amber-500' : 'bg-emerald-500/10 text-emerald-500'
              )}
            >
              {isPlotOverflow ? <AlertTriangle size={20} /> : <CheckCircle2 size={20} />}
            </div>
            <div>
              <h3 className="font-display text-lg font-semibold text-ink-primary">
                2. Building Setback & Fit Analysis
              </h3>
              <p className="text-xs text-ink-muted">
                Mandatory Indian bylaws: 1.5 m side setbacks, 3.3 m rear setback, 2.3 m front road setback.
              </p>
            </div>
          </div>
          <span
            className={cx(
              'text-xs font-mono px-2.5 py-1 rounded-full border',
              isPlotOverflow
                ? 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300'
                : 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300'
            )}
          >
            {isPlotOverflow ? 'Action Required' : 'Fits Safely'}
          </span>
        </div>

        {/* What is not fitting diagnosis */}
        {isPlotOverflow ? (
          <div className="space-y-4">
            <div className="p-4 rounded-xl border border-amber-200 bg-amber-50/70 dark:border-amber-900/40 dark:bg-amber-950/20 text-amber-900 dark:text-amber-200 text-xs space-y-1.5">
              <span className="font-semibold block text-sm">What is not fitting:</span>
              <p>
                Your drawn house footprint (<strong className="font-mono">{footprint.w} × {footprint.d} m</strong>)
                is larger than the available buildable zone (<strong className="font-mono">{buildable.w} × {buildable.d} m</strong>)
                on this {plotWidthM} × {plotDepthM} m plot.
              </p>
              <p className="text-[0.75rem] text-amber-800/80 dark:text-amber-300/80">
                It overflows by {overflowW > 0 ? `${overflowW} m in width` : ''}{overflowW > 0 && overflowD > 0 ? ' and ' : ''}{overflowD > 0 ? `${overflowD} m in depth` : ''}.
              </p>
            </div>

            {/* What needs to be changed (Resolution Choices) */}
            <div className="space-y-3">
              <label className="text-xs font-mono uppercase tracking-wider text-ink-muted">
                Choose How You Want to Resolve the Overflow:
              </label>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* CHOICE A: AUTO-SCALE HOUSE */}
                <div
                  role="radio"
                  tabIndex={0}
                  aria-checked={selectedResolution === 'scale'}
                  onClick={() => setSelectedResolution('scale')}
                  onKeyDown={(e) => (e.key === ' ' || e.key === 'Enter') && setSelectedResolution('scale')}
                  className={cx(
                    'flex flex-col justify-between p-4 rounded-xl border-2 transition-all cursor-pointer text-left',
                    selectedResolution === 'scale'
                      ? 'border-accent bg-accent/5 ring-2 ring-accent/20'
                      : 'border-line bg-surface hover:border-accent/40 hover:bg-surface-elevated'
                  )}
                >
                  <div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Minimize2 size={16} className="text-accent" />
                        <h4 className="font-semibold text-sm text-ink-primary">Option A: Auto-Scale House</h4>
                      </div>
                      <span className="text-[0.65rem] font-mono px-2 py-0.5 rounded-full bg-accent/10 text-accent font-semibold">
                        Recommended
                      </span>
                    </div>
                    <p className="mt-2 text-xs text-ink-muted leading-relaxed">
                      Proportionally scale down the house dimensions so it fits inside the {buildable.w} × {buildable.d} m
                      buildable envelope without changing your plot size.
                    </p>
                  </div>
                  <Button
                    size="sm"
                    className="mt-4 w-full"
                    onClick={(e) => {
                      e.stopPropagation()
                      const res = autoScaleToFitPlot(rawSurvey, scaleMPerPx, plotWidthM, plotDepthM)
                      onUpdateSurvey(res.updatedRaw)
                      onUpdateScale(res.updatedScaleMPerPx)
                      setLastActionReport(res.report)
                    }}
                  >
                    <Wand2 size={14} />
                    <span>Auto-Scale House to Fit</span>
                  </Button>
                </div>

                {/* CHOICE B: EXPAND LOT SIZE */}
                <div
                  role="radio"
                  tabIndex={0}
                  aria-checked={selectedResolution === 'expand'}
                  onClick={() => setSelectedResolution('expand')}
                  onKeyDown={(e) => (e.key === ' ' || e.key === 'Enter') && setSelectedResolution('expand')}
                  className={cx(
                    'flex flex-col justify-between p-4 rounded-xl border-2 transition-all cursor-pointer text-left',
                    selectedResolution === 'expand'
                      ? 'border-accent bg-accent/5 ring-2 ring-accent/20'
                      : 'border-line bg-surface hover:border-accent/40 hover:bg-surface-elevated'
                  )}
                >
                  <div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Maximize2 size={16} className="text-accent" />
                        <h4 className="font-semibold text-sm text-ink-primary">Option B: Enlarge Plot Size</h4>
                      </div>
                      <span className="text-[0.65rem] font-mono px-2 py-0.5 rounded-full bg-surface-elevated border border-line text-ink-muted">
                        Keep Dimensions
                      </span>
                    </div>
                    <p className="mt-2 text-xs text-ink-muted leading-relaxed">
                      Keep your house the exact size you drew and expand your plot dimensions to at least{' '}
                      <strong className="text-ink-primary font-mono">
                        {requiredPlot.requiredPlotWidthM} × {requiredPlot.requiredPlotDepthM} m ({requiredPlot.areaGuntha} Guntha / {requiredPlot.areaSqft.toLocaleString('en-IN')} sq ft)
                      </strong>.
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="mt-4 w-full"
                    onClick={(e) => {
                      e.stopPropagation()
                      onUpdatePlot({
                        plotWidthM: requiredPlot.requiredPlotWidthM,
                        plotDepthM: requiredPlot.requiredPlotDepthM,
                      })
                      setManualPlotW(String(requiredPlot.requiredPlotWidthM))
                      setManualPlotD(String(requiredPlot.requiredPlotDepthM))
                      setLastActionReport({
                        action: 'Plot Expanded',
                        details: `Plot size increased to ${requiredPlot.requiredPlotWidthM} × ${requiredPlot.requiredPlotDepthM} m (${requiredPlot.areaGuntha} Guntha) to fit full house footprint and setbacks.`,
                      })
                    }}
                  >
                    <Maximize2 size={14} />
                    <span>Expand Plot to {requiredPlot.requiredPlotWidthM} × {requiredPlot.requiredPlotDepthM} m ({requiredPlot.areaGuntha} G)</span>
                  </Button>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="p-4 rounded-xl border border-emerald-200 bg-emerald-50/70 dark:border-emerald-900/40 dark:bg-emerald-950/20 text-emerald-900 dark:text-emerald-200 text-xs flex items-center gap-3">
            <CheckCircle2 size={18} className="text-emerald-600 dark:text-emerald-400 flex-none" />
            <div>
              <span className="font-semibold block text-sm">Perfect Setback Fit</span>
              <span>
                Your building footprint ({footprint.w} × {footprint.d} m) fits safely inside your {plotWidthM} × {plotDepthM} m
                plot with generous setbacks on all four sides.
              </span>
            </div>
          </div>
        )}
      </div>

      {/* QUESTION 3: BUILDING CODE (NBC) AUTOMATIC FIXES & MASONRY SNAPPING */}
      <div className="rounded-2xl border border-line bg-surface p-6 shadow-sm space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-accent/10 text-accent">
              <Sliders size={20} />
            </div>
            <div>
              <h3 className="font-display text-lg font-semibold text-ink-primary">
                3. Building Code (NBC) & Masonry Snapping
              </h3>
              <p className="text-xs text-ink-muted">
                Ensure structural wall thickness (230 mm exterior, 115 mm interior) and statutory room ventilation.
              </p>
            </div>
          </div>
          <span className="text-xs font-mono px-2.5 py-1 rounded-full bg-surface-elevated border border-line text-ink-muted">
            Step 3 of 3
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Construction Snapping */}
          <div className="p-4 rounded-xl border border-line bg-surface-elevated space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="font-semibold text-xs text-ink-primary">Indian Masonry Grid</h4>
              {snappedDiff && (
                <span className="p-1 rounded-full bg-emerald-500 text-white text-[0.6rem]">
                  <Check size={10} />
                </span>
              )}
            </div>
            <p className="text-xs text-ink-muted leading-relaxed">
              Straighten angles to 90°, align room centrelines, and set walls to 230 mm external / 115 mm internal.
            </p>
            <div className="pt-2">
              {!snappedDiff ? (
                <Button size="sm" variant="ghost" className="w-full text-xs" onClick={onApplySnapping}>
                  <Wand2 size={13} />
                  <span>Snap Grid (230/115 mm)</span>
                </Button>
              ) : (
                <Button size="sm" variant="quiet" className="w-full text-xs" onClick={onUndoSnapping}>
                  <span>Undo Snapping</span>
                </Button>
              )}
            </div>
          </div>

          {/* Exterior Ventilation */}
          <div className="p-4 rounded-xl border border-line bg-surface-elevated space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="font-semibold text-xs text-ink-primary">Exterior Ventilation</h4>
              {unventilatedRooms.length === 0 ? (
                <span className="p-1 rounded-full bg-emerald-500 text-white text-[0.6rem]">
                  <Check size={10} />
                </span>
              ) : (
                <span className="text-[0.65rem] font-mono text-amber-500 font-semibold">
                  {unventilatedRooms.length} Needs Window
                </span>
              )}
            </div>
            <p className="text-xs text-ink-muted leading-relaxed">
              {unventilatedRooms.length === 0
                ? 'All habitable rooms have at least one exterior wall window.'
                : `${unventilatedRooms.join(', ')} lacks an exterior window.`}
            </p>
            <div className="pt-2">
              {unventilatedRooms.length > 0 && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="w-full text-xs"
                  onClick={() => {
                    let updated = rawSurvey
                    unventilatedRooms.forEach((rId) => {
                      const res = autoAddWindowToRoom(updated, rId, scaleMPerPx)
                      updated = res.updatedRaw
                    })
                    onUpdateSurvey(updated)
                    setLastActionReport({
                      action: 'Windows Added',
                      details: `Added 1.2 m standard exterior windows to ${unventilatedRooms.join(', ')}.`,
                    })
                  }}
                >
                  <Wand2 size={13} />
                  <span>Auto-Add Windows</span>
                </Button>
              )}
            </div>
          </div>

          {/* Door Widths */}
          <div className="p-4 rounded-xl border border-line bg-surface-elevated space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="font-semibold text-xs text-ink-primary">Circulation Doors</h4>
              {narrowDoorsCount === 0 ? (
                <span className="p-1 rounded-full bg-emerald-500 text-white text-[0.6rem]">
                  <Check size={10} />
                </span>
              ) : (
                <span className="text-[0.65rem] font-mono text-amber-500 font-semibold">
                  {narrowDoorsCount} Narrow
                </span>
              )}
            </div>
            <p className="text-xs text-ink-muted leading-relaxed">
              {narrowDoorsCount === 0
                ? 'All doors meet or exceed 900 mm clear accessibility width.'
                : `${narrowDoorsCount} door(s) are narrower than 900 mm.`}
            </p>
            <div className="pt-2">
              {narrowDoorsCount > 0 && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="w-full text-xs"
                  onClick={() => {
                    const res = autoWidenAllDoors(rawSurvey, scaleMPerPx)
                    onUpdateSurvey(res.updatedRaw)
                    setLastActionReport(res.report)
                  }}
                >
                  <Wand2 size={13} />
                  <span>Widen Doors to 900 mm</span>
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
