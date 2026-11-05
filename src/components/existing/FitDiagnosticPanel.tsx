import { useState, useMemo } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Wand2,
  Maximize2,
  Minimize2,
  Sliders,
  Compass,
} from 'lucide-react'
import {
  type RawSurvey,
} from '@/lib/existing/digitizer.ts'
import {
  type Survey,
  SURVEY_SETBACKS,
} from '@/lib/existing/survey.ts'
import {
  autoScaleToFitPlot,
  calculateRequiredPlot,
  autoAddWindowToRoom,
  autoWidenAllDoors,
  type RemediationChangeReport,
} from '@/lib/existing/remediation.ts'
import { type NbcHealthReport } from '@/lib/existing/nbcPreflight.ts'
import { Button } from '@/components/ui/Button.tsx'
import { cx } from '@/lib/cx.ts'

interface FitDiagnosticPanelProps {
  rawSurvey: RawSurvey
  activeSurvey: Survey | null
  scaleMPerPx: number
  plotWidthM: number
  plotDepthM: number
  nbcReport: NbcHealthReport | null
  onUpdateSurvey: (newSurvey: RawSurvey) => void
  onUpdateScale: (newScale: number) => void
  onUpdatePlot: (plot: { plotWidthM: number; plotDepthM: number }) => void
}

export function FitDiagnosticPanel({
  rawSurvey,
  scaleMPerPx,
  plotWidthM,
  plotDepthM,
  nbcReport,
  onUpdateSurvey,
  onUpdateScale,
  onUpdatePlot,
}: FitDiagnosticPanelProps) {
  const [lastActionReport, setLastActionReport] = useState<RemediationChangeReport | null>(null)

  // Measure current building dimensions in metres
  const footprint = useMemo(() => {
    const rooms = rawSurvey?.elements?.rooms || []
    if (!rooms.length) return { w: 0, d: 0, minX: 0, maxX: 0, minY: 0, maxY: 0 }
    const minX = Math.min(...rooms.map((r) => r.box.x))
    const maxX = Math.max(...rooms.map((r) => r.box.x + r.box.w))
    const minY = Math.min(...rooms.map((r) => r.box.y))
    const maxY = Math.max(...rooms.map((r) => r.box.y + r.box.h))

    return {
      w: +((maxX - minX) * scaleMPerPx).toFixed(2),
      d: +((maxY - minY) * scaleMPerPx).toFixed(2),
      minX,
      maxX,
      minY,
      maxY,
    }
  }, [rawSurvey?.elements?.rooms, scaleMPerPx])

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

  // Diagnostics list
  const diagnostics = useMemo(() => {
    const items: {
      id: string
      type: 'setback' | 'ventilation' | 'door-width' | 'circulation'
      severity: 'error' | 'warn' | 'ok'
      title: string
      whatIsNotFitting: string
      whatNeedsToChange: string
      actions: { label: string; primary?: boolean; run: () => void }[]
    }[] = []

    // 1. SETBACK OVERFLOW
    if (isPlotOverflow) {
      items.push({
        id: 'diag-setback',
        type: 'setback',
        severity: 'error',
        title: 'Building Exceeds Plot Buildable Area',
        whatIsNotFitting: `Building footprint (${footprint.w} × ${footprint.d} m) is larger than your buildable area (${buildable.w} × ${buildable.d} m) after mandatory municipal setbacks (1.5 m sides, 3.3 m rear, 2.3 m front). It overflows by ${Math.max(0, overflowW).toFixed(1)} m in width and ${Math.max(0, overflowD).toFixed(1)} m in depth.`,
        whatNeedsToChange: `Choose how you want to resolve the fit: Either automatically scale down the building footprint to fit inside the ${plotWidthM} × ${plotDepthM} m plot, or expand your plot dimensions to at least ${requiredPlot.requiredPlotWidthM} × ${requiredPlot.requiredPlotDepthM} m.`,
        actions: [
          {
            label: `Auto-Scale House to Fit Plot (${buildable.w} × ${buildable.d} m)`,
            primary: true,
            run: () => {
              const res = autoScaleToFitPlot(rawSurvey, scaleMPerPx, plotWidthM, plotDepthM)
              onUpdateSurvey(res.updatedRaw)
              onUpdateScale(res.updatedScaleMPerPx)
              setLastActionReport(res.report)
            },
          },
          {
            label: `Expand Plot to ${requiredPlot.requiredPlotWidthM} × ${requiredPlot.requiredPlotDepthM} m`,
            run: () => {
              onUpdatePlot({
                plotWidthM: requiredPlot.requiredPlotWidthM,
                plotDepthM: requiredPlot.requiredPlotDepthM,
              })
              setLastActionReport({
                action: 'Expanded plot',
                details: `Plot updated to ${requiredPlot.requiredPlotWidthM} × ${requiredPlot.requiredPlotDepthM} m to comfortably accommodate the building and full setbacks.`,
              })
            },
          },
        ],
      })
    }

    // 2. UNVENTILATED ROOMS
    const ventCheck = nbcReport?.checks.find((c) => c.id === 'ventilation')
    if (ventCheck && ventCheck.status !== 'pass' && ventCheck.offendingRoomIds.length > 0) {
      items.push({
        id: 'diag-vent',
        type: 'ventilation',
        severity: 'warn',
        title: 'Rooms Lacking Exterior Ventilation',
        whatIsNotFitting: `${ventCheck.offendingRoomIds.join(', ')} does not have any window opening on an exterior wall, violating National Building Code natural light and ventilation rules.`,
        whatNeedsToChange: `Add a standard 1.2 m window on the exterior wall of each unventilated room to allow fresh air and sunlight.`,
        actions: ventCheck.offendingRoomIds.map((rId) => ({
          label: `Auto-Add 1.2m Window to ${rId}`,
          primary: true,
          run: () => {
            const res = autoAddWindowToRoom(rawSurvey, rId, scaleMPerPx)
            onUpdateSurvey(res.updatedRaw)
            setLastActionReport(res.report)
          },
        })),
      })
    }

    // 3. NARROW DOORS
    const accessCheck = nbcReport?.checks.find((c) => c.id === 'accessibility')
    if (accessCheck && accessCheck.status !== 'pass') {
      items.push({
        id: 'diag-doors',
        type: 'door-width',
        severity: 'warn',
        title: 'Door Clear Widths Under 900 mm',
        whatIsNotFitting: `${accessCheck.offendingOpeningIndices.length} door(s) are narrower than 900 mm. Narrow doorways obstruct furniture delivery and wheelchair movement.`,
        whatNeedsToChange: `Widen all internal circulation doors to 900 mm and main entrance to 1000 mm.`,
        actions: [
          {
            label: 'Widen All Doors to Standard 900 mm',
            primary: true,
            run: () => {
              const res = autoWidenAllDoors(rawSurvey, scaleMPerPx)
              onUpdateSurvey(res.updatedRaw)
              setLastActionReport(res.report)
            },
          },
        ],
      })
    }

    return items
  }, [
    isPlotOverflow,
    footprint,
    buildable,
    overflowW,
    overflowD,
    plotWidthM,
    plotDepthM,
    requiredPlot,
    rawSurvey,
    scaleMPerPx,
    nbcReport,
    onUpdateSurvey,
    onUpdateScale,
    onUpdatePlot,
  ])

  return (
    <div className="rounded-md border border-line bg-bg-raised p-5 shadow-sm space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-line">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-accent/10 text-accent">
            <Sliders size={18} />
          </div>
          <div>
            <h3 className="font-display text-base font-semibold text-ink">
              Fit Diagnostics & Remediation Assistant
            </h3>
            <p className="text-xs text-ink-dim">
              Live inspection of building dimensions, plot setbacks, and code requirements.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span
            className={cx(
              'px-2.5 py-1 text-xs font-mono font-medium rounded-full border flex items-center gap-1.5',
              diagnostics.length === 0
                ? 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300'
                : 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300'
            )}
          >
            {diagnostics.length === 0 ? (
              <>
                <CheckCircle2 size={13} />
                <span>Fits Perfectly</span>
              </>
            ) : (
              <>
                <AlertTriangle size={13} />
                <span>{diagnostics.length} Issues Detected</span>
              </>
            )}
          </span>
        </div>
      </div>

      {/* Success Banner when Action Executed */}
      {lastActionReport && (
        <div className="flex items-center justify-between gap-2 p-3 rounded-md border border-emerald-200 bg-emerald-50 dark:border-emerald-900/50 dark:bg-emerald-950/30 text-emerald-900 dark:text-emerald-200 text-xs animate-in fade-in">
          <div className="flex items-center gap-2">
            <Wand2 size={15} className="text-emerald-600 dark:text-emerald-400 flex-none" />
            <span className="font-medium">{lastActionReport.action}:</span>
            <span>{lastActionReport.details}</span>
          </div>
          <button
            type="button"
            onClick={() => setLastActionReport(null)}
            className="text-[0.7rem] underline font-mono"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Live Metrics Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
        <div className="p-3 rounded-md border border-line bg-bg-inset">
          <span className="text-ink-dim block text-[0.7rem] uppercase tracking-wider font-mono">House Footprint</span>
          <span className="text-base font-semibold text-ink font-mono mt-0.5 block">
            {footprint.w} × {footprint.d} m
          </span>
          <span className="text-[0.68rem] text-ink-dim">{(footprint.w * footprint.d).toFixed(1)} m² area</span>
        </div>

        <div className="p-3 rounded-md border border-line bg-bg-inset">
          <span className="text-ink-dim block text-[0.7rem] uppercase tracking-wider font-mono">Your Plot</span>
          <span className="text-base font-semibold text-ink font-mono mt-0.5 block">
            {plotWidthM} × {plotDepthM} m
          </span>
          <span className="text-[0.68rem] text-ink-dim">{(plotWidthM * plotDepthM).toFixed(1)} m² plot</span>
        </div>

        <div className="p-3 rounded-md border border-line bg-bg-inset">
          <span className="text-ink-dim block text-[0.7rem] uppercase tracking-wider font-mono">Buildable Envelope</span>
          <span className="text-base font-semibold text-ink font-mono mt-0.5 block">
            {buildable.w} × {buildable.d} m
          </span>
          <span className="text-[0.68rem] text-ink-dim">After 1.5m sides, 3.3m rear, 2.3m front</span>
        </div>

        <div className="p-3 rounded-md border border-line bg-bg-inset">
          <span className="text-ink-dim block text-[0.7rem] uppercase tracking-wider font-mono">Plot Fit Status</span>
          <span
            className={cx(
              'text-base font-semibold font-mono mt-0.5 block',
              isPlotOverflow ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'
            )}
          >
            {isPlotOverflow ? `Overflows ${Math.max(overflowW, overflowD).toFixed(1)}m` : 'Fits inside plot'}
          </span>
          <span className="text-[0.68rem] text-ink-dim">
            {isPlotOverflow ? 'Adjustment required' : 'Setbacks fully satisfied'}
          </span>
        </div>
      </div>

      {/* Interactive Quick-Fit Slider */}
      <div className="p-3.5 rounded-md border border-line bg-bg-inset flex flex-wrap items-center justify-between gap-4 text-xs">
        <div className="flex items-center gap-2">
          <Compass size={16} className="text-accent" />
          <div>
            <span className="font-semibold text-ink block">Proportional Building Footprint Adjuster</span>
            <span className="text-ink-dim text-[0.72rem]">
              Drag to scale the building footprint up or down in real time.
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => onUpdateScale(+(scaleMPerPx * 0.95).toFixed(6))}
            className="p-1.5 rounded hover:bg-bg-inset border border-line text-ink"
            title="Scale down 5%"
          >
            <Minimize2 size={13} />
          </button>

          <span className="font-mono text-xs font-semibold text-ink w-24 text-center">
            {footprint.w} × {footprint.d} m
          </span>

          <button
            type="button"
            onClick={() => onUpdateScale(+(scaleMPerPx * 1.05).toFixed(6))}
            className="p-1.5 rounded hover:bg-bg-inset border border-line text-ink"
            title="Scale up 5%"
          >
            <Maximize2 size={13} />
          </button>
        </div>
      </div>

      {/* DIAGNOSTIC CARDS: What is not fitting, what needs to change, and interactive fixes */}
      {diagnostics.length > 0 ? (
        <div className="space-y-3 pt-1">
          {diagnostics.map((item) => (
            <div
              key={item.id}
              className={cx(
                'rounded-md border p-4 space-y-3 transition-all',
                item.severity === 'error'
                  ? 'border-rose-200 bg-rose-50/40 dark:border-rose-900/40 dark:bg-rose-950/20'
                  : 'border-amber-200 bg-amber-50/40 dark:border-amber-900/40 dark:bg-amber-950/20'
              )}
            >
              <div className="flex items-center gap-2">
                <AlertTriangle
                  size={16}
                  className={item.severity === 'error' ? 'text-rose-500' : 'text-amber-500'}
                />
                <h4 className="font-semibold text-xs text-ink">{item.title}</h4>
              </div>

              {/* 1. What is not fitting */}
              <div className="text-xs space-y-1">
                <span className="font-mono text-[0.68rem] uppercase tracking-wider text-rose-600 dark:text-rose-400 font-semibold block">
                  What is not fitting:
                </span>
                <p className="text-ink leading-relaxed">{item.whatIsNotFitting}</p>
              </div>

              {/* 2. What needs to change */}
              <div className="text-xs space-y-1 pt-1 border-t border-black/5 dark:border-white/5">
                <span className="font-mono text-[0.68rem] uppercase tracking-wider text-amber-600 dark:text-amber-400 font-semibold block">
                  What is needed to be changed:
                </span>
                <p className="text-ink-dim leading-relaxed">{item.whatNeedsToChange}</p>
              </div>

              {/* 3. Action Buttons that mutate the model according to user input */}
              <div className="pt-2 flex flex-wrap gap-2">
                {item.actions.map((act, i) => (
                  <Button
                    key={i}
                    size="sm"
                    variant={act.primary ? 'primary' : 'ghost'}
                    onClick={act.run}
                    className="flex items-center gap-1.5"
                  >
                    <Wand2 size={13} />
                    <span>{act.label}</span>
                  </Button>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="p-4 rounded-md border border-emerald-200 bg-emerald-50/50 dark:border-emerald-900/30 dark:bg-emerald-950/20 flex items-center gap-3 text-xs text-emerald-900 dark:text-emerald-200">
          <CheckCircle2 size={18} className="text-emerald-600 dark:text-emerald-400 flex-none" />
          <div>
            <span className="font-semibold block">All checks passing!</span>
            <span>
              Your building fits inside the plot after setbacks, meets natural ventilation standards, and complies with NBC door widths.
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

