import { useState, type FC } from 'react'
import { Leaf, RotateCcw, Check, ChevronDown, ChevronRight } from 'lucide-react'
import type { CostEstimate } from '@/lib/cost/boq.ts'
import type { Brief } from '@/lib/model/brief.ts'
import type { Design } from '@/lib/engine/types.ts'
import type { ImpactDocument } from '@/lib/impact/schema.ts'
import type { EcoSwapItem } from '@/lib/impact/analysis.ts'
import type { ImpactSummary } from '@/lib/impact/summary.ts'
import { specsCatalogue } from '@/lib/cost/catalogue.ts'
import { applySpecification } from '@/lib/cost/workspace.ts'
import { geometryCostKey } from '@/lib/cost/quantities.ts'
import { useStudio } from '@/state/studio.ts'
import { useFinishes } from '@/state/finishes.ts'
import { noteChange } from '@/state/projects.ts'
import { SvgWaterfallBar } from './charts/SvgWaterfallBar.tsx'
import { SvgDumbbellCompare } from './charts/SvgDumbbellCompare.tsx'
import { SvgCarbonDonut } from './charts/SvgCarbonDonut.tsx'
import { FinishSwatch } from '@/routes/finishes/FinishSwatch.tsx'
import { AssumptionBadge } from './AssumptionBadge.tsx'

export interface AffordabilityPillarProps {
  summary: ImpactSummary['affordability']
  cost: CostEstimate
  brief: Brief
  design: Design
  doc: ImpactDocument
  onSaveDoc: (next: ImpactDocument) => void
}

const fmt = (n: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n)

export const AffordabilityPillar: FC<AffordabilityPillarProps> = ({
  summary,
  cost,
  brief: _brief,
  design,
  doc,
  onSaveDoc,
}) => {
  const [toast, setToast] = useState<{
    message: string
    revertBrief: Brief
    revertSaved: unknown
  } | null>(null)
  const [applyingId, setApplyingId] = useState<string | null>(null)
  const [applyError, setApplyError] = useState<string | null>(null)
  const [assumptionsOpen, setAssumptionsOpen] = useState(false)

  const {
    currentCost,
    totalEcoSavings,
    totalCarbonSavings,
    swappedCost,
    budget,
    withinBudget,
    carbonDonut,
    carbonCompare,
    ecoSwaps,
  } = {
    currentCost: summary.costExpected,
    totalEcoSavings: summary.rupeeSavings,
    totalCarbonSavings: summary.carbonSavingsKg,
    swappedCost: summary.costAfterSwaps,
    budget: summary.budget,
    withinBudget: summary.withinBudget,
    carbonDonut: summary.carbonDonut,
    carbonCompare: summary.carbonCompare,
    ecoSwaps: summary.ecoSwaps,
  }

  // Real store write: Apply swap to BOQ
  const handleApplySwap = (swap: EcoSwapItem) => {
    if (applyingId) return // ignore double clicks
    setApplyingId(swap.lineId)
    setApplyError(null)

    try {
      const item = specsCatalogue.items.find(i => i.id === swap.itemId)
      if (!item) {
        throw new Error(`Catalogue item "${swap.itemId}" could not be located.`)
      }

      const key = geometryCostKey(design)
      const saved = useFinishes.getState().entries[key]
      const originalBrief = structuredClone(useStudio.getState().brief)

      const nextBrief = applySpecification(
        originalBrief,
        cost,
        item,
        swap.alternativeOptionId,
        swap.roomId ? [swap.roomId] : []
      )

      useStudio.getState().edit(b => {
        b.specs.overrides = nextBrief.specs.overrides
      })
      noteChange(`Applied Eco-Swap: ${swap.label} -> ${swap.alternative}`)

      const newTotal = Math.max(0, cost.expected - swap.rupeeSaving)
      setToast({
        message: `Applied ${swap.alternative}. New BOQ Total: ${fmt(newTotal)} (Saved ${fmt(swap.rupeeSaving)} & ${swap.kgCo2eSaving} kgCO₂e).`,
        revertBrief: originalBrief,
        revertSaved: saved,
      })
    } catch (err) {
      setApplyError(`Failed to apply eco-swap: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setApplyingId(null)
    }
  }

  const handleUndo = () => {
    if (!toast) return
    useStudio.getState().edit(b => {
      b.specs.overrides = toast.revertBrief.specs.overrides
    })
    noteChange('Reverted eco-swap selection')
    setToast(null)
  }

  return (
    <div className="space-y-6">
      {/* Error Banner */}
      {applyError && (
        <div
          role="alert"
          className="rounded-xl border border-rose-300 bg-rose-50 px-5 py-4 font-sans text-sm text-rose-900"
        >
          {applyError}
        </div>
      )}

      {/* Toast Notification */}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-xl border border-emerald-300 bg-emerald-50 px-5 py-4 shadow-lg font-sans text-sm text-emerald-950"
        >
          <Check size={18} className="text-emerald-700 shrink-0" />
          <span>{toast.message}</span>
          <button
            type="button"
            onClick={handleUndo}
            className="ml-3 inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3 py-1.5 font-mono text-xs font-semibold text-white hover:bg-emerald-800 cursor-pointer min-h-[36px]"
          >
            <RotateCcw size={13} /> Undo
          </button>
        </div>
      )}

      {/* Header Card */}
      <div className="rounded-xl border border-line bg-bg-raised p-5 sm:p-6 shadow-2xs">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <span className="font-mono text-xs uppercase tracking-wider text-ink-dim">Pillar 01 · Affordability</span>
            <h2 className="font-display text-2xl font-medium text-ink mt-1">Cost Optimization & 1-Click Eco-Swaps</h2>
            <p className="mt-1.5 font-sans text-sm text-ink-dim max-w-2xl leading-relaxed">
              Compare finishes against verified lower-rate alternatives in the BrickPilot catalogue to trim budget while curtailing embodied carbon.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 font-mono text-xs font-semibold border ${
                budget !== null
                  ? withinBudget
                    ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                    : 'bg-rose-50 text-rose-800 border-rose-200'
                  : 'bg-bg-inset text-ink-dim border-line'
              }`}
            >
              {budget !== null ? (withinBudget ? '● Within Budget' : '▲ Over Target Budget') : 'Budget Unset'}
            </span>
          </div>
        </div>
      </div>

      {/* Hero 1: SvgWaterfallBar with Budget Fit */}
      <SvgWaterfallBar
        budget={budget}
        currentCost={currentCost}
        swappedCost={swappedCost}
        totalSavings={totalEcoSavings}
      />

      {/* Section 2: Embodied Carbon Distribution & Comparison */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 items-stretch">
        <div className="lg:col-span-6">
          <SvgCarbonDonut items={carbonDonut.items} totalKg={carbonDonut.totalKg} />
        </div>
        <div className="lg:col-span-6">
          <SvgDumbbellCompare
            baselineCost={currentCost}
            swappedCost={swappedCost}
            baselineCarbonKg={carbonCompare.baselineKg}
            swappedCarbonKg={carbonCompare.afterSwapsKg}
          />
        </div>
      </div>

      {/* Section 3: Material Eco-Swap Cards */}
      <section aria-label="1-Click Eco-Swap Opportunities">
        <div className="rounded-xl border border-line bg-bg-raised p-5 sm:p-6 shadow-2xs">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div>
              <span className="font-mono text-xs uppercase tracking-wider text-ink-dim">BOQ Optimization</span>
              <h3 className="font-display text-xl font-medium text-ink mt-0.5">
                1-Click Eco-Swap Catalogue ({ecoSwaps.length} Found)
              </h3>
            </div>
            <span className="font-mono text-xs font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 px-3 py-1 rounded-full">
              Total Potential Savings: {fmt(totalEcoSavings)} · -{totalCarbonSavings.toFixed(1)} kgCO₂e
            </span>
          </div>

          {ecoSwaps.length === 0 ? (
            <p className="py-10 text-center font-sans text-sm text-ink-dim">
              No lower-rate alternatives currently found for the selected finishes in this plan.
            </p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {ecoSwaps.map(swap => (
                <div
                  key={swap.lineId}
                  className="flex flex-col justify-between rounded-xl border border-line bg-bg p-4 transition-all hover:border-accent hover:shadow-2xs"
                >
                  <div>
                    {/* Header: Label & Carbon badge */}
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-sans text-sm font-semibold text-ink" title={swap.label}>
                        {swap.label}
                      </span>
                      {swap.isLowerCarbon && (
                        <span className="inline-flex items-center gap-1 rounded bg-emerald-50 border border-emerald-200 px-2 py-0.5 font-mono text-xs font-bold text-emerald-800 shrink-0">
                          <Leaf size={11} aria-hidden /> Lower Carbon
                        </span>
                      )}
                    </div>

                    {/* Swatch & Spec Comparison */}
                    <div className="mt-3 flex items-center gap-3">
                      <div className="shrink-0">
                        {(() => {
                          const item = specsCatalogue.items.find(i => i.id === swap.itemId)
                          const option = item?.options.find(o => o.id === swap.alternativeOptionId)
                          if (item && option) {
                            return (
                              <FinishSwatch
                                item={item}
                                option={option}
                                className="h-14 w-14 rounded-lg border border-line object-cover shadow-2xs"
                              />
                            )
                          }
                          return (
                            <div className="h-14 w-14 rounded-lg border border-line bg-bg-inset flex items-center justify-center font-mono text-xs text-ink-dim">
                              Swatch
                            </div>
                          )
                        })()}
                      </div>
                      <div className="min-w-0 flex-1 text-xs sm:text-sm">
                        <p className="truncate text-ink-faint line-through" title={swap.current}>
                          {swap.current}
                        </p>
                        <p className="font-semibold text-ink truncate mt-0.5" title={swap.alternative}>
                          {swap.alternative}
                        </p>
                        <p className="font-mono text-xs text-ink-dim mt-0.5">
                          Qty: {swap.quantity} {swap.unit}
                        </p>
                      </div>
                    </div>

                    {/* Savings Pills */}
                    <div className="mt-3.5 flex flex-wrap items-center gap-2">
                      <span className="rounded bg-emerald-50 border border-emerald-200 px-2.5 py-1 font-mono text-xs font-bold text-emerald-800">
                        Save {fmt(swap.rupeeSaving)}
                      </span>
                      {swap.kgCo2eSaving > 0 && (
                        <span className="rounded bg-sky-50 border border-sky-200 px-2.5 py-1 font-mono text-xs font-semibold text-sky-800">
                          -{swap.kgCo2eSaving} kgCO₂e
                        </span>
                      )}
                      {swap.isAssumption && (
                        <AssumptionBadge
                          label="Embodied Carbon Factor"
                          value="Default Factor"
                          notes="Default material group boundary estimate (verified: false)"
                        />
                      )}
                    </div>
                  </div>

                  {/* Apply to BOQ Button */}
                  <div className="mt-5 pt-3 border-t border-line">
                    <button
                      type="button"
                      onClick={() => handleApplySwap(swap)}
                      disabled={applyingId !== null}
                      className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg bg-accent px-4 py-2.5 font-mono text-xs font-semibold uppercase tracking-wider text-white shadow-2xs hover:bg-accent-hot transition-colors cursor-pointer disabled:opacity-50 min-h-[44px]"
                    >
                      {applyingId === swap.lineId ? 'Applying to BOQ…' : 'Apply to BOQ'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

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
            <span className="text-sm sm:text-base">Inputs & Standards Used (Affordability & Carbon)</span>
          </div>
          <span className="font-mono text-xs text-ink-dim">Standards: EPD India · CPWD DSR 2023</span>
        </button>

        {assumptionsOpen && (
          <div className="border-t border-line p-5 font-sans text-sm text-ink-dim space-y-4">
            <div className="flex flex-wrap gap-2.5">
              <span className="rounded-md bg-bg-inset px-3 py-1.5 font-mono text-xs text-ink border border-line">
                Baseline Rates: CPWD Delhi Schedule of Rates (DSR 2023)
              </span>
              <span className="rounded-md bg-bg-inset px-3 py-1.5 font-mono text-xs text-ink border border-line">
                Embodied Carbon: Cradle-to-gate factors (verified where marked)
              </span>
            </div>
            <div className="pt-2">
              <label className="block font-sans font-medium text-ink mb-1.5 text-sm">
                Target Project Budget (₹):
              </label>
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  step={50000}
                  value={doc.budgetInr ?? ''}
                  placeholder={budget ? `${budget}` : 'Set target budget'}
                  onChange={e => onSaveDoc({ ...doc, budgetInr: e.target.value ? Number(e.target.value) : null })}
                  className="rounded-lg border border-line bg-bg px-3.5 py-2 font-mono text-sm w-56 text-ink focus-visible:outline-accent"
                />
                {doc.budgetInr !== null && (
                  <button
                    type="button"
                    onClick={() => onSaveDoc({ ...doc, budgetInr: null })}
                    className="rounded-lg border border-line bg-bg px-3 py-2 font-mono text-xs text-ink-dim hover:text-ink hover:bg-bg-inset cursor-pointer min-h-[38px]"
                  >
                    Clear Budget
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
