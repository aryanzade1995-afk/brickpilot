import { useEffect, useRef, useState, type FC } from 'react'
import { CheckCircle2, AlertTriangle, XCircle, ShieldCheck, DoorOpen, ChevronDown, ChevronRight, Info } from 'lucide-react'
import type { Design } from '@/lib/engine/types.ts'
import type { CanonicalModel } from '@/lib/model/canonical.ts'
import type { ImpactDocument } from '@/lib/impact/schema.ts'
import type { ImpactCheck } from '@/lib/impact/analysis.ts'
import type { ImpactSummary } from '@/lib/impact/summary.ts'
import { FloorDrawing } from '@/lib/draw/FloorDrawing.tsx'
import { SvgRampElevation } from './charts/SvgRampElevation.tsx'
import { AssumptionBadge } from './AssumptionBadge.tsx'

export interface AccessibilityPillarProps {
  summary: ImpactSummary['accessibility']
  design: Design
  model: CanonicalModel
  checks: ImpactCheck[]
  doc: ImpactDocument
  onSaveDoc: (next: ImpactDocument) => void
}

export const AccessibilityPillar: FC<AccessibilityPillarProps> = ({
  summary,
  design,
  model,
  checks,
  doc,
  onSaveDoc,
}) => {
  const [activeFloorLevel, setActiveFloorLevel] = useState(0)
  const [assumptionsOpen, setAssumptionsOpen] = useState(false)
  const [drawingInView, setDrawingInView] = useState(true)
  const drawingRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (drawingInView) return
    const el = drawingRef.current
    if (!el) return
    if (typeof IntersectionObserver === 'undefined') {
      setDrawingInView(true)
      return
    }
    const obs = new IntersectionObserver(
      entries => {
        if (entries[0]?.isIntersecting) {
          setDrawingInView(true)
          obs.disconnect()
        }
      },
      { rootMargin: '200px 0px' }
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [drawingInView])

  const {
    verdict,
    reasons,
    routeDefinitionNote,
    doors,
    passRouteCount,
    totalRouteDoors,
    totalDoors,
    narrowestRouteDoorMm,
    narrowestDoorMm,
    ramp,
    rampModel,
  } = summary

  // Coordinate transform for FloorDrawing overlay:
  const padL = 3400
  const padB = 3400
  const padT = 1800
  const padR = 1800
  const vb = `${-padL} ${-padT} ${model.plot.width + padL + padR} ${model.plot.depth + padT + padB}`

  const currentFloor = design.floors.find(f => f.level === activeFloorLevel) ?? design.floors[0]
  const floorDoors = doors.filter(d => d.floorId === (currentFloor.prefix ?? `L${currentFloor.level}`))

  // Safety checklist completion ring
  const checkedSafetySet = new Set(doc.safetyChecks)
  const totalSafetyItems = checks.length
  const completedCount = checks.filter(c => checkedSafetySet.has(c.id)).length
  const completionPct = totalSafetyItems > 0 ? Math.round((completedCount / totalSafetyItems) * 100) : 0

  const toggleSafetyCheck = (id: string) => {
    const next = new Set(checkedSafetySet)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onSaveDoc({ ...doc, safetyChecks: Array.from(next) })
  }

  // Verdict style mapping
  const verdictBadge = {
    Pass: { bg: 'bg-emerald-50', text: 'text-emerald-900', icon: CheckCircle2, border: 'border-emerald-300' },
    Partial: { bg: 'bg-amber-50', text: 'text-amber-900', icon: AlertTriangle, border: 'border-amber-300' },
    Fail: { bg: 'bg-rose-50', text: 'text-rose-900', icon: XCircle, border: 'border-rose-300' },
  }[verdict]

  const VerdictIcon = verdictBadge.icon

  return (
    <div className="space-y-6">
      {/* Header & Verdict Banner */}
      <div className="rounded-xl border border-line bg-bg-raised p-5 sm:p-6 shadow-2xs">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <span className="font-mono text-xs uppercase tracking-wider text-ink-dim">
              Pillar 04 · Universal Accessibility & Life Safety
            </span>
            <h2 className="font-display text-2xl font-medium text-ink mt-1">Harmonised Barrier-Free & Safety Audit</h2>
            <p className="mt-1.5 font-sans text-sm text-ink-dim max-w-2xl leading-relaxed">
              Audits the continuous accessible circulation route against DEPwD 2021 guidelines (≥900 mm clear width) and entrance ramp gradients (≤1:12).
            </p>
          </div>

          {/* Status Verdict Pill */}
          <div
            className={`inline-flex items-center gap-2.5 rounded-xl border ${verdictBadge.border} ${verdictBadge.bg} px-4 py-2.5 ${verdictBadge.text}`}
          >
            <VerdictIcon size={20} className="shrink-0" aria-hidden />
            <div>
              <span className="block font-display text-base font-bold uppercase tracking-wider">
                DEPwD 2021: {verdict}
              </span>
              <span className="block font-mono text-xs">
                {reasons[0] ?? 'Accessible route fully compliant.'}
              </span>
            </div>
          </div>
        </div>

        {/* Route Definition Assumption Banner */}
        <div className="mt-4 flex flex-wrap items-center gap-2.5 rounded-xl border border-line bg-bg p-3.5 font-sans text-xs sm:text-sm text-ink-dim">
          <Info size={16} className="text-sky-700 shrink-0" aria-hidden />
          <span className="font-semibold text-ink">Accessible Route Definition:</span>
          <span className="flex-1">{routeDefinitionNote}</span>
          <AssumptionBadge
            label="Accessible Route"
            value="Route-Only Audit"
            notes={routeDefinitionNote}
          />
        </div>

        {/* 3 Metric Summary Cards */}
        <div className="mt-5 grid gap-4 sm:grid-cols-3 border-t border-line pt-5">
          <div className="rounded-xl border border-line bg-bg p-4 flex flex-col justify-between">
            <span className="font-mono text-xs uppercase tracking-wider text-ink-dim block">Accessible Route Doors</span>
            <p className="mt-2 font-display text-2xl font-semibold tracking-tight text-ink">
              {passRouteCount} / {totalRouteDoors} Compliant
            </p>
            <p className="mt-1 font-mono text-xs text-ink-dim">
              {totalDoors} total doors ({totalDoors - totalRouteDoors} informational storage/closets)
            </p>
          </div>

          <div className="rounded-xl border border-line bg-bg p-4 flex flex-col justify-between">
            <span className="font-mono text-xs uppercase tracking-wider text-ink-dim block">Narrowest Route Opening</span>
            <p
              className={`mt-2 font-display text-2xl font-semibold tracking-tight ${
                narrowestRouteDoorMm && narrowestRouteDoorMm >= 900 ? 'text-emerald-800' : 'text-amber-800'
              }`}
            >
              {narrowestRouteDoorMm ? `${narrowestRouteDoorMm} mm` : 'N/A'}
            </p>
            <p className="mt-1 font-mono text-xs text-ink-dim">
              {narrowestRouteDoorMm && narrowestRouteDoorMm < 900
                ? '▲ Route door needs widening to ≥ 900 mm'
                : '✓ Full wheelchair transit clearance'}
              {narrowestDoorMm ? ` (Overall min: ${narrowestDoorMm} mm)` : ''}
            </p>
          </div>

          <div className="rounded-xl border border-line bg-bg p-4 flex flex-col justify-between">
            <span className="font-mono text-xs uppercase tracking-wider text-ink-dim block">Entrance Ramp</span>
            <p className="mt-2 font-display text-2xl font-semibold tracking-tight text-ink">
              {ramp.gradientRatio ? `1:${ramp.gradientRatio} Gradient` : 'Not Configured'}
            </p>
            <p className="mt-1 font-mono text-xs text-ink-dim">
              {ramp.reason}
            </p>
          </div>
        </div>
      </div>

      {/* Hero 1: Embedded FloorDrawing with Door SVG Pins */}
      <section aria-label="Floor plan doorway accessibility map">
        <div className="rounded-xl border border-line bg-bg-raised p-5 sm:p-6 shadow-2xs">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div>
              <span className="font-mono text-xs uppercase tracking-wider text-ink-dim">Floor Plan Audit</span>
              <h3 className="font-display text-xl font-medium text-ink mt-0.5 flex items-center gap-2">
                <DoorOpen size={20} className="text-accent" aria-hidden />
                2D Doorway Accessibility Map
              </h3>
              <p className="mt-1 font-sans text-xs sm:text-sm text-ink-dim">
                Route doors are prominent with green/red status; utility and closet doors are shown as informational.
              </p>
            </div>

            {/* Floor Level Tabs */}
            {design.floors.length > 1 && (
              <div className="flex rounded-lg border border-line bg-bg-inset p-1 text-xs">
                {design.floors.map(f => (
                  <button
                    key={f.level}
                    type="button"
                    onClick={() => setActiveFloorLevel(f.level)}
                    className={`rounded-md px-3.5 py-1.5 font-mono font-medium transition-colors cursor-pointer ${
                      activeFloorLevel === f.level
                        ? 'bg-bg-raised text-ink shadow-xs font-semibold'
                        : 'text-ink-dim hover:text-ink'
                    }`}
                  >
                    Level {f.level}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Interactive Plan Canvas with Overlay Pins */}
          <div
            ref={drawingRef}
            className="relative mx-auto max-w-3xl overflow-hidden rounded-xl border border-line bg-white p-3 min-h-[420px]"
          >
            {drawingInView ? (
              <>
                <div className="pointer-events-none w-full">
                  <FloorDrawing
                    floor={currentFloor}
                    model={model}
                  />
                </div>

                {/* Absolute SVG Overlay Layer for 900mm Door Pins */}
                <svg
                  viewBox={vb}
                  preserveAspectRatio="xMidYMid meet"
                  className="pointer-events-none absolute inset-0 h-full w-full select-none"
                  role="img"
                  style={{ fontFamily: 'var(--font-mono), monospace' }}
                  aria-label="Doorway pin overlay indicating compliant route doors (green), narrow route doors (red), and secondary storage doors (slate)."
                >
                  <defs>
                    <filter id="pinShadow" x="-20%" y="-20%" width="140%" height="140%">
                      <feDropShadow dx="0" dy="40" stdDeviation="50" floodOpacity="0.35" />
                    </filter>
                  </defs>

                  {floorDoors.map(d => {
                    const isPass = d.passes900mm
                    const isRoute = d.isRouteDoor
                    const color = isRoute
                      ? isPass ? '#059669' : '#e11d48'
                      : '#64748b'
                    const radius = isRoute ? 180 : 130
                    const tagWidth = isRoute ? 640 : 540
                    const tagX = -tagWidth / 2

                    return (
                      <g key={d.id} transform={`translate(${d.at.x}, ${d.at.y})`} filter="url(#pinShadow)">
                        <circle
                          cx="0"
                          cy="0"
                          r={radius}
                          fill={color}
                          stroke="#ffffff"
                          strokeWidth={isRoute ? '40' : '25'}
                        />
                        <text
                          x="0"
                          y={isRoute ? '50' : '40'}
                          textAnchor="middle"
                          fill="#ffffff"
                          fontSize={isRoute ? '140' : '100'}
                          fontWeight="bold"
                        >
                          {isRoute ? (isPass ? '✓' : '!') : 'i'}
                        </text>
                        <rect
                          x={tagX}
                          y="-360"
                          width={tagWidth}
                          height="200"
                          rx="40"
                          fill="#171717"
                          stroke="#ffffff"
                          strokeWidth="20"
                        />
                        <text
                          x="0"
                          y="-220"
                          textAnchor="middle"
                          fill="#ffffff"
                          fontSize="115"
                          fontWeight="bold"
                        >
                          {isRoute ? `${d.width} mm` : `${d.width}mm (Info)`}
                        </text>
                      </g>
                    )
                  })}
                </svg>
              </>
            ) : (
              <div className="flex h-[420px] w-full flex-col items-center justify-center gap-2 text-ink-dim">
                <div className="h-8 w-8 rounded-full border-2 border-line border-t-accent animate-spin" />
                <span className="font-mono text-xs">Loading 2D floor plan…</span>
              </div>
            )}
          </div>

          {/* Legend */}
          <div className="mt-4 flex flex-wrap items-center justify-center gap-6 font-mono text-xs text-ink-dim">
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-full bg-emerald-600 border border-white shadow-2xs" />
              <span>Compliant Route Door (≥900 mm)</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-full bg-rose-600 border border-white shadow-2xs" />
              <span>Narrow Route Door (&lt;900 mm)</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-slate-500 border border-white shadow-2xs" />
              <span>Informational Door (Closet / Utility)</span>
            </div>
          </div>
        </div>
      </section>

      {/* Hero 2: Ramp Elevation Profile & Safety Checklist */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 items-stretch">
        <div className="lg:col-span-6">
          <SvgRampElevation ramp={rampModel} />
        </div>

        {/* Safety Sign-Off Checklist with Completion Ring */}
        <div className="lg:col-span-6 flex flex-col justify-between rounded-xl border border-line bg-bg-raised p-5 sm:p-6 shadow-2xs">
          <div>
            <div className="flex items-center justify-between border-b border-line pb-4">
              <div>
                <h4 className="font-display text-xl font-medium text-ink flex items-center gap-2">
                  <ShieldCheck size={20} className="text-emerald-700" aria-hidden />
                  Life Safety Sign-Off
                </h4>
                <p className="font-sans text-xs text-ink-dim mt-0.5">Statutory safety checks and engineer clearance items.</p>
              </div>

              {/* Completion Dial */}
              <div className="flex items-center gap-2 rounded-full border border-line bg-bg px-3 py-1 font-mono text-xs font-semibold text-ink">
                <span>{completionPct}% Complete</span>
              </div>
            </div>

            <div className="mt-4 space-y-2.5">
              {checks.map(check => {
                const isChecked = checkedSafetySet.has(check.id)
                return (
                  <label
                    key={check.id}
                    className={`flex items-start gap-3 rounded-xl border p-3 cursor-pointer transition-colors ${
                      isChecked
                        ? 'border-emerald-300 bg-emerald-50/60'
                        : 'border-line bg-bg hover:bg-bg-inset'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => toggleSafetyCheck(check.id)}
                      className="mt-0.5 h-4 w-4 rounded accent-accent cursor-pointer"
                    />
                    <div className="flex-1 text-xs sm:text-sm">
                      <p className={`font-semibold ${isChecked ? 'text-emerald-950 line-through' : 'text-ink'}`}>
                        {check.title}
                      </p>
                      <p className="mt-0.5 font-sans text-xs text-ink-dim">{check.detail}</p>
                      <span className="mt-1 inline-block font-mono text-xs text-ink-faint">
                        Status: {check.status}
                      </span>
                    </div>
                  </label>
                )
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Inputs & Assumptions Collapsible */}
      <div className="rounded-xl border border-line bg-bg-raised shadow-2xs">
        <button
          type="button"
          onClick={() => setAssumptionsOpen(!assumptionsOpen)}
          className="flex w-full items-center justify-between p-5 text-left font-sans font-semibold text-ink hover:bg-bg-inset transition-colors cursor-pointer"
          aria-expanded={assumptionsOpen}
        >
          <div className="flex items-center gap-2.5">
            {assumptionsOpen ? <ChevronDown className="h-4 w-4 text-ink-dim" /> : <ChevronRight className="h-4 w-4 text-ink-dim" />}
            <span className="text-sm sm:text-base">Inputs & Standards Used (Accessibility & Life Safety)</span>
          </div>
          <span className="font-mono text-xs text-ink-dim">Standards: DEPwD 2021 · NBC 2016 Part 3</span>
        </button>

        {assumptionsOpen && (
          <div className="border-t border-line p-5 font-sans text-sm text-ink-dim space-y-4">
            <div className="flex flex-wrap gap-2.5">
              <span className="rounded-md bg-bg-inset px-3 py-1.5 font-mono text-xs text-ink border border-line">
                Route Clearance: DEPwD 2021 Clause 4.1.2 (≥ 900 mm clear width)
              </span>
              <span className="rounded-md bg-bg-inset px-3 py-1.5 font-mono text-xs text-ink border border-line">
                Entrance Ramp: NBC 2016 Part 3 Clause 12.23 (≤ 1:12 maximum slope)
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
