import { useState, useEffect, useDeferredValue, useCallback, useRef, type FC } from 'react'
import { Check, ChevronDown, ChevronRight, RefreshCw } from 'lucide-react'
import type { ImpactDocument } from '@/lib/impact/schema.ts'
import type { ImpactSummary } from '@/lib/impact/summary.ts'
import { AutoFillChip } from './AutoFillChip.tsx'
import { SvgCisternGauge } from './charts/SvgCisternGauge.tsx'
import { SvgRadialGauge } from './charts/SvgRadialGauge.tsx'
import { SvgWaterComboChart } from './charts/SvgWaterComboChart.tsx'
import { AssumptionBadge } from './AssumptionBadge.tsx'
import { noteChange } from '@/state/projects.ts'

export interface WaterSecurityPillarProps {
  summary: ImpactSummary['water']
  doc: ImpactDocument
  onSaveDoc: (next: ImpactDocument) => void
}

export const WaterSecurityPillar: FC<WaterSecurityPillarProps> = ({
  summary,
  doc,
  onSaveDoc,
}) => {
  const [assumptionsOpen, setAssumptionsOpen] = useState(false)
  const [syncToast, setSyncToast] = useState<string | null>(null)
  const [localTankL, setLocalTankL] = useState<number>(summary.tankCapacityL ?? 10000)
  const isUserInteractingRef = useRef(false)

  const handleUpdate = useCallback(
    (patch: Partial<ImpactDocument['water']>) => {
      onSaveDoc({
        ...doc,
        water: {
          ...doc.water,
          ...patch,
          source: patch.source ?? doc.water.source ?? 'Single Source of Truth',
        },
      })
    },
    [doc, onSaveDoc]
  )

  const prevTankLRef = useRef(summary.tankCapacityL)
  useEffect(() => {
    if (summary.tankCapacityL !== null && summary.tankCapacityL !== prevTankLRef.current) {
      prevTankLRef.current = summary.tankCapacityL
      setLocalTankL(summary.tankCapacityL)
    }
  }, [summary.tankCapacityL])

  const deferredTankL = useDeferredValue(localTankL)

  useEffect(() => {
    if (isUserInteractingRef.current && deferredTankL !== summary.tankCapacityL) {
      isUserInteractingRef.current = false
      handleUpdate({ capacityL: deferredTankL })
    }
  }, [deferredTankL, summary.tankCapacityL, handleUpdate])

  const {
    city,
    annualRainfallMm,
    roofAreaM2,
    dailyDemandL,
    annualHarvestL,
    annualHarvestCoverageDays,
    tankCapacityL,
    tankAutonomyDays,
    tankAutonomyDisplay,
    isUtilitiesTankSet,
    tankerSavingsInr,
    monthlyBalance,
    rwhCityMandate,
    isPlotMandatory,
  } = summary

  const handleSyncToUtilities = () => {
    if (tankCapacityL !== null) {
      handleUpdate({ capacityL: tankCapacityL })
      noteChange('Synced underground tank from utilities')
      setSyncToast(`Synced ${tankCapacityL.toLocaleString('en-IN')} L cistern to social impact model.`)
      setTimeout(() => setSyncToast(null), 3000)
    }
  }

  return (
    <div className="space-y-6">
      {/* Toast Notification */}
      {syncToast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-xl border border-sky-300 bg-sky-50 px-5 py-4 shadow-lg font-sans text-sm text-sky-950"
        >
          <Check size={18} className="text-sky-700 shrink-0" />
          <span>{syncToast}</span>
        </div>
      )}

      {/* Header Card */}
      <div className="rounded-xl border border-line bg-bg-raised p-5 sm:p-6 shadow-2xs">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <span className="font-mono text-xs uppercase tracking-wider text-ink-dim">Pillar 02 · Water Security</span>
            <h2 className="font-display text-2xl font-medium text-ink mt-1">Jal Shakti Monsoon Catchment & Autonomy</h2>
            <p className="mt-1.5 font-sans text-sm text-ink-dim max-w-2xl leading-relaxed">
              12-Month catchment modeling for {city} rainfall ({annualRainfallMm} mm/yr). Sizing and statutory by-law compliance for residential plots.
            </p>
          </div>

          {/* Statutory Mandate Chip */}
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 font-mono text-xs font-semibold border ${
                isPlotMandatory
                  ? 'bg-amber-50 text-amber-900 border-amber-300'
                  : 'bg-emerald-50 text-emerald-800 border-emerald-200'
              }`}
            >
              {isPlotMandatory ? '● Statutory RWH Mandate Applies' : '✓ Voluntary Best Practice'}
            </span>
          </div>
        </div>

        {/* 2 Explicit Water Metric Cards + Usable Simulation */}
        <div className="mt-5 grid gap-4 sm:grid-cols-2 border-t border-line pt-5">
          <div className="rounded-xl border border-line bg-bg p-4 sm:p-5 flex flex-col justify-between">
            <div>
              <span className="font-mono text-xs uppercase tracking-wider text-ink-dim block">
                Rain Available Per Year (Before Storage)
              </span>
              <p className="mt-2 font-display text-3xl font-semibold tracking-tight text-ink">
                {annualHarvestL.toLocaleString('en-IN')} L
              </p>
              <p className="mt-1.5 font-sans text-sm text-ink font-medium">
                Annual harvest potential covers {annualHarvestCoverageDays} days of household demand.
              </p>
              <div className="mt-3 rounded-lg bg-sky-50 border border-sky-200 p-3 font-sans text-xs sm:text-sm text-sky-950">
                <span className="font-semibold block">
                  Usable with your tank: {summary.usableHarvestLitres.toLocaleString('en-IN')} L, covers {summary.demandCoveredPercent}% of demand
                </span>
                <span className="text-sky-800 block mt-1 font-mono text-xs">
                  Overflow lost: {summary.overflowLitres.toLocaleString('en-IN')} L · Longest dry spell: {summary.longestDryGapDays} days
                </span>
              </div>
            </div>
            <p className="mt-3 font-mono text-xs text-ink-dim">
              Formula: {roofAreaM2} m² × {annualRainfallMm} mm × runoff × efficiency
            </p>
          </div>

          <div className="rounded-xl border border-line bg-bg p-4 sm:p-5 flex flex-col justify-between">
            <div>
              <span className="font-mono text-xs uppercase tracking-wider text-ink-dim block">
                Drought Autonomy Buffer
              </span>
              <p className="mt-2 font-display text-3xl font-semibold tracking-tight text-ink">
                {tankAutonomyDisplay}
              </p>
              <p className="mt-1.5 font-sans text-sm text-ink font-medium">
                A full tank lasts {tankAutonomyDisplay} with zero rainfall.
              </p>
              <div className="mt-3 rounded-lg bg-emerald-50 border border-emerald-200 p-3 font-sans text-xs sm:text-sm text-emerald-950">
                <span className="font-semibold block">
                  Recommended: {summary.suggestedTankCapacity80Pct.toLocaleString('en-IN')} L tank
                </span>
                <span className="text-emerald-800 block mt-1">
                  Captures ≥ 80% of total annual monsoon harvest before overflow loss.
                </span>
              </div>
            </div>
            <p className="mt-3 font-mono text-xs text-ink-dim">
              {isUtilitiesTankSet && tankCapacityL !== null
                ? `Formula: ${tankCapacityL.toLocaleString('en-IN')} L tank ÷ ${dailyDemandL} L/day`
                : 'Underground tank not configured in Utilities'}
            </p>
          </div>
        </div>

        {/* City By-law Citation Pill */}
        <div className="mt-4 flex flex-wrap items-center justify-between text-xs text-ink-dim font-mono border-t border-line pt-3">
          <span>By-law rule: {rwhCityMandate.source}</span>
          <span className="font-semibold">{rwhCityMandate.verified ? 'Statutory Verified' : 'Rule not loaded for this city'}</span>
        </div>
      </div>

      {/* Hero 2: 12-Month Water Balance Combo Chart */}
      <SvgWaterComboChart
        monthly={monthlyBalance}
        tankCapacityL={tankCapacityL ?? 10000}
        annualHarvestL={annualHarvestL}
        tankerTripsSaved={summary.tankerTripsAvoided}
        tankerSavingsInr={tankerSavingsInr}
      />

      {/* Section 3: Cistern Storage & Radial Autonomy Gauges */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 items-stretch">
        <div className="lg:col-span-6">
          <SvgCisternGauge
            collectedLitres={annualHarvestL}
            capacityLitres={tankCapacityL ?? 10000}
            dailyDemandLitres={dailyDemandL}
          />
        </div>
        <div className="lg:col-span-6">
          <SvgRadialGauge
            value={tankAutonomyDays ?? 0}
            max={120}
            label="Full Tank Autonomy"
            unit="Days"
            sublabel={tankAutonomyDays ? `${tankAutonomyDays} days with no rain` : 'Set a tank size'}
          />
        </div>
      </div>

      {/* Section 4: Interactive Cistern Tank Slider & Utilities Sync */}
      <div className="rounded-xl border border-line bg-bg-raised p-5 sm:p-6 shadow-2xs">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <span className="font-mono text-xs uppercase tracking-wider text-ink-dim">Storage Sizing</span>
            <h3 className="font-display text-xl font-medium text-ink mt-0.5">Underground Rainwater Cistern Configuration</h3>
          </div>
          <button
            type="button"
            onClick={handleSyncToUtilities}
            className="inline-flex items-center gap-2 rounded-lg border border-line bg-bg px-3.5 py-2 font-mono text-xs font-semibold text-ink hover:bg-bg-inset transition-colors cursor-pointer min-h-[38px]"
          >
            <RefreshCw size={14} aria-hidden /> Sync from Utilities Tab ({tankCapacityL ? `${tankCapacityL} L` : 'Unset'})
          </button>
        </div>

        {/* Cistern Volume Slider with immediate local state & deferred update */}
        <div className="flex flex-col gap-2.5">
          <div className="flex items-center justify-between text-sm">
            <span className="font-sans text-ink-dim">Simulate Tank Sizing:</span>
            <span className="font-mono font-bold text-ink text-base">
              {localTankL > 0 ? `${localTankL.toLocaleString('en-IN')} Litres` : 'Unset'}
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={30000}
            step={1000}
            value={localTankL}
            onChange={e => {
              isUserInteractingRef.current = true
              setLocalTankL(Number(e.target.value))
            }}
            className="w-full accent-accent cursor-pointer min-h-[38px]"
          />
          <div className="flex justify-between text-xs font-mono text-ink-dim">
            <span>0 L (Direct Runoff)</span>
            <span className="font-semibold text-ink">10,000 L (Recommended)</span>
            <span>30,000 L (Extended Drought Reserve)</span>
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
            <span className="text-sm sm:text-base">Inputs & Standards Used (Water Security)</span>
          </div>
          <span className="font-mono text-xs text-ink-dim">Standards: IS 1172 · NBC 2016 Part 9</span>
        </button>

        {assumptionsOpen && (
          <div className="border-t border-line p-5 font-sans text-sm text-ink-dim space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="water-rainfall-input" className="block font-sans font-medium text-ink mb-1.5 text-sm">
                  Annual Rainfall (mm):
                </label>
                <div className="flex items-center gap-2.5">
                  <input
                    id="water-rainfall-input"
                    type="number"
                    value={doc.water.rainfallMm ?? ''}
                    placeholder={`${annualRainfallMm} mm`}
                    onChange={e => handleUpdate({ rainfallMm: e.target.value ? Number(e.target.value) : null })}
                    className="rounded-lg border border-line bg-bg px-3.5 py-2 font-mono text-sm w-36 text-ink focus-visible:outline-accent"
                  />
                  <AutoFillChip
                    label="Annual Avg"
                    value={`${annualRainfallMm} mm`}
                    isOverridden={doc.water.rainfallMm !== null}
                    onClick={() => handleUpdate({ rainfallMm: null })}
                  />
                </div>
              </div>

              <div>
                <label htmlFor="water-area-input" className="block font-sans font-medium text-ink mb-1.5 text-sm">
                  Roof Catchment Area:
                </label>
                <div className="flex items-center gap-2.5">
                  <input
                    id="water-area-input"
                    type="number"
                    value={doc.water.areaM2 ?? ''}
                    placeholder={`${roofAreaM2.toFixed(1)} m²`}
                    onChange={e => handleUpdate({ areaM2: e.target.value ? Number(e.target.value) : null })}
                    className="rounded-lg border border-line bg-bg px-3.5 py-2 font-mono text-sm w-36 text-ink focus-visible:outline-accent"
                  />
                  <AutoFillChip
                    label="Roof Slab"
                    value={`${roofAreaM2.toFixed(1)} m²`}
                    isOverridden={doc.water.areaM2 !== null}
                    onClick={() => handleUpdate({ areaM2: null })}
                  />
                </div>
              </div>

              <div>
                <label htmlFor="water-demand-input" className="block font-sans font-medium text-ink mb-1.5 text-sm">
                  Daily Household Demand:
                </label>
                <div className="flex items-center gap-2.5">
                  <input
                    id="water-demand-input"
                    type="number"
                    value={doc.water.dailyDemandL ?? ''}
                    placeholder={`${dailyDemandL} L/day`}
                    onChange={e => handleUpdate({ dailyDemandL: e.target.value ? Number(e.target.value) : null })}
                    className="rounded-lg border border-line bg-bg px-3.5 py-2 font-mono text-sm w-36 text-ink focus-visible:outline-accent"
                  />
                  <AutoFillChip
                    label="Domestic Demand"
                    value={`${dailyDemandL} L/day`}
                    isOverridden={doc.water.dailyDemandL !== null}
                    onClick={() => handleUpdate({ dailyDemandL: null })}
                  />
                </div>
              </div>

              <div>
                <label htmlFor="water-tank-capacity-input" className="block font-sans font-medium text-ink mb-1.5 text-sm">
                  Cistern Capacity (L):
                </label>
                <div className="flex items-center gap-2.5">
                  <input
                    id="water-tank-capacity-input"
                    type="number"
                    value={doc.water.capacityL ?? ''}
                    placeholder={tankCapacityL !== null ? `${tankCapacityL} L` : 'Unset'}
                    onChange={e => handleUpdate({ capacityL: e.target.value ? Number(e.target.value) : null })}
                    className="rounded-lg border border-line bg-bg px-3.5 py-2 font-mono text-sm w-36 text-ink focus-visible:outline-accent"
                  />
                  {doc.water.capacityL !== null && (
                    <button
                      type="button"
                      onClick={() => handleUpdate({ capacityL: null })}
                      className="rounded-lg border border-line bg-bg px-3 py-2 font-mono text-xs text-ink-dim hover:text-ink hover:bg-bg-inset cursor-pointer min-h-[38px]"
                    >
                      Reset to Utilities
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="pt-3 border-t border-line flex flex-wrap gap-2.5">
              <AssumptionBadge
                label="Runoff Coeff"
                value="0.85"
                notes="NBC 2016 Part 9 Section 2 Table 24 (RCC Flat Terrace)"
              />
              <AssumptionBadge
                label="Filter Efficiency"
                value="0.80"
                notes="CPHEEO Manual on Water Supply and Treatment (verified: false)"
              />
              <AssumptionBadge
                label="Tanker Rate"
                value="₹1,200/5kL"
                notes="Regional commercial water delivery estimate (verified: false)"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
