import { SolarEstimateSummary } from '@/components/solar/SolarEstimateSummary.tsx'
import { translate as translateUi, useLanguage } from '@/lib/i18n/index.ts'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { CostEstimate } from '@/lib/cost/index.ts'
import { boqCsv } from '@/lib/cost/index.ts'
import { formatINR, formatRange } from '@/lib/format.ts'
import { Field } from '@/components/ui/controls.tsx'
import { policy, type CostSelection } from '@/lib/cost/specifications.ts'
import { cx } from '@/lib/cx.ts'
import { useCostResearch } from '@/state/costResearch.ts'
import { useStudio } from '@/state/studio.ts'
import type { ScopeMode, ProposedRate } from '@/lib/cost/research/types.ts'
import { detectUserCity } from '@/lib/location/detectLocation.ts'

const quantityGroups = [
  ['Earthwork & foundation', ['earthwork.', 'concrete.footings', 'concrete.plinthBeams']],
  ['Structure', ['concrete.columns', 'concrete.beams', 'concrete.slabs', 'concrete.stairs', 'concrete.lintels', 'concrete.chajjas']],
  ['Masonry & plaster', ['masonry.', 'plaster.']],
  ['Finishes', ['flooring', 'skirting', 'wallTiles.', 'waterproofing.', 'paint.', 'parapet', 'external.']],
  ['Openings', ['doors.', 'windows.', 'glazing', 'grills', 'railings.']],
  ['Services', ['plumbing.', 'electrical.']],
] as const

export function QuantitiesView({ cost }: { cost: CostEstimate }) {
  useLanguage(s => s.language)

  const [floor, setFloor] = useState('all')
  const q = cost.quantities
  const current = floor === 'all' ? q.total : q.perFloor.find(f => String(f.level) === floor) ?? q.total

  return (
    <section>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="font-display text-2xl">{translateUi("Measured quantities")}</h2>
          <p className="mt-2 text-xs text-ink-dim">
            {translateUi("Read-only measurements from your plan. Net areas exclude openings and voids where applicable.")}
          </p>
        </div>
        <label className="text-xs">
          {translateUi("Floor")}
          <select
            aria-label={translateUi("Quantity floor filter")}
            className="mt-2 block border border-line bg-bg px-3 py-2 text-xs"
            value={floor}
            onChange={e => setFloor(e.target.value)}
          >
            <option value="all">{translateUi("All floors")}</option>
            {q.perFloor.map(f => <option key={f.level} value={f.level}>{translateUi(f.name)}</option>)}
          </select>
        </label>
      </div>

      <div className="mt-6 grid gap-x-8 lg:grid-cols-2">
        {quantityGroups.map(([label, prefixes]) => (
          <section key={label} className="mb-7 min-w-0">
            <h3 className="border-b border-line pb-3 font-display text-xl">{translateUi(label)}</h3>
            <dl className="divide-y divide-line">
              {Object.entries(current.items)
                .filter(([id]) => prefixes.some(p => id.startsWith(p)))
                .map(([id, values]) => (
                  <div key={id} className="py-3">
                    <dt className="text-sm capitalize">
                      {translateUi(id.replaceAll('.', ' · ').replace(/([a-z])([A-Z])/g, '$1 $2'))}
                    </dt>
                    <dd className="mt-2 flex flex-wrap items-baseline justify-between gap-2 text-xs text-ink-dim">
                      <span>
                        {translateUi(
                          Object.entries(values)
                            .filter(([, v]) => v > 0)
                            .map(([k, v]) => `${k} ${v.toFixed(2)}${k === 'NetVolume' ? ' m³' : k === 'Length' ? ' m' : k === 'Count' ? '' : ' m²'}`)
                            .join(' · ')
                        )}
                      </span>
                      <Link
                        to={`/workspace/plan?floor=${floor === 'all' ? q.perFloor[0]?.level ?? 0 : current.level}&highlight=${encodeURIComponent(id)}`}
                        className="shrink-0 underline"
                      >
                        {translateUi("Show on plan")}
                      </Link>
                    </dd>
                  </div>
                ))}
            </dl>
          </section>
        ))}
      </div>

      <section>
        <h3 className="border-b border-line pb-3 font-display text-xl">{translateUi("Materials")}</h3>
        <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt>{translateUi("Steel")}</dt>
            <dd className="text-ink-dim">{translateUi(Object.values(current.steelKg).reduce((n, v) => n + v, 0).toFixed(1))} {translateUi(" kg")}</dd>
          </div>
          <div>
            <dt>{translateUi("Formwork")}</dt>
            <dd className="text-ink-dim">{translateUi(Object.values(current.formworkM2).reduce((n, v) => n + v, 0).toFixed(1))} {translateUi(" m²")}</dd>
          </div>
        </dl>
        {floor === 'all' && (
          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt>{translateUi(q.masonryMaterials.type)}</dt>
              <dd className="text-ink-dim">{translateUi(Math.ceil(q.masonryMaterials.Count))} {translateUi(" units")}</dd>
            </div>
            <div>
              <dt>{translateUi("Water storage · whole home")}</dt>
              <dd className="text-ink-dim">
                {translateUi(q.tanks.overheadLitres)} {translateUi(" L overhead · ")}{translateUi(q.tanks.undergroundLitres)} {translateUi(" L underground")}
              </dd>
            </div>
            {q.concreteMaterials.cementBags !== null ? (
              <>
                <div>
                  <dt>{translateUi("Cement · nominal M20 mix")}</dt>
                  <dd className="text-ink-dim">{translateUi(q.concreteMaterials.cementBags.toFixed(1))} {translateUi(" bags")}</dd>
                </div>
                <div>
                  <dt>{translateUi("Sand / aggregate · nominal M20 mix")}</dt>
                  <dd className="text-ink-dim">{translateUi(q.concreteMaterials.sandM3?.toFixed(2))} / {translateUi(q.concreteMaterials.aggregateM3?.toFixed(2))} {translateUi(" m³")}</dd>
                </div>
              </>
            ) : (
              <p className="text-xs text-ink-faint">{translateUi("Concrete constituent quantities require the specified design mix.")}</p>
            )}
          </dl>
        )}
        <p className="mt-5 text-xs leading-relaxed text-ink-faint">
          {translateUi("Member sizes and material ratios are approximate; structural design by a licensed engineer required. Aggregated rows and room breakdowns describe the same work and are not additional charges.")}
        </p>
      </section>
    </section>
  )
}

export function EstimateView({ cost, onAllowances }: { cost: CostEstimate; onAllowances?: (change: Partial<CostSelection>) => void }) {
  useLanguage(s => s.language)

  const [split, setSplit] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState('')
  const [showProposals, setShowProposals] = useState(false)
  const [selectedProposalRates, setSelectedProposalRates] = useState<Record<string, boolean>>({})
  const [isDetectingLocation, setIsDetectingLocation] = useState(false)
  const [locationNotice, setLocationNotice] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  // Studio and research state
  const design = useStudio(s => s.result?.design)
  const brief = useStudio(s => s.brief)
  const location = useCostResearch(s => s.location)
  const setLocation = useCostResearch(s => s.setLocation)
  const scopeMode = useCostResearch(s => s.scopeMode)
  const setScopeMode = useCostResearch(s => s.setScopeMode)
  const isResearching = useCostResearch(s => s.isResearching)
  const activeJob = useCostResearch(s => s.activeJob)
  const jobError = useCostResearch(s => s.jobError)
  const acceptedSnapshot = useCostResearch(s => s.acceptedSnapshot)
  const manualOverrides = useCostResearch(s => s.manualOverrides)
  const setManualOverride = useCostResearch(s => s.setManualOverride)
  const removeManualOverride = useCostResearch(s => s.removeManualOverride)
  const applyProposedRates = useCostResearch(s => s.applyProposedRates)
  const clearAcceptedSnapshot = useCostResearch(s => s.clearAcceptedSnapshot)
  const startResearch = useCostResearch(s => s.startResearch)
  const cancelResearch = useCostResearch(s => s.cancelResearch)

  const handleDetectLocation = async () => {
    setIsDetectingLocation(true)
    setLocationNotice(null)
    try {
      const res = await detectUserCity()
      if (res.success && res.city) {
        setLocation({
          city: res.city,
          ...(res.pincode ? { pincode: res.pincode } : {}),
        })
        setLocationNotice({ type: 'ok', text: `${translateUi("Detected: ")}${res.city}${res.pincode ? ` (${res.pincode})` : ''}` })
        setTimeout(() => setLocationNotice(null), 6000)
      } else {
        setLocationNotice({ type: 'err', text: res.error || translateUi("Could not detect location") })
      }
    } catch (e) {
      setLocationNotice({ type: 'err', text: e instanceof Error ? e.message : translateUi("Location detection failed") })
    } finally {
      setIsDetectingLocation(false)
    }
  }

  const handleStartResearch = async () => {
    if (!design || !brief) return
    setError('')
    await startResearch({
      design,
      brief,
      commercial: cost.selection,
    })
  }

  const handleOpenProposals = () => {
    if (activeJob?.proposals) {
      const initial: Record<string, boolean> = {}
      for (const p of activeJob.proposals) {
        initial[p.rateId] = p.status === 'accepted' || p.status === 'conflict'
      }
      setSelectedProposalRates(initial)
    }
    setShowProposals(true)
  }

  const handleApplySelected = () => {
    const rateIds = Object.entries(selectedProposalRates)
      .filter(([, selected]) => selected)
      .map(([rateId]) => rateId)
    applyProposedRates(rateIds)
    setShowProposals(false)
  }

  const excel = async () => {
    setExporting(true)
    setError('')
    try {
      const blob = await (await import('@/lib/cost/exportExcel.ts')).buildBoqExcel(cost)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `formstead-boq-${location.city.toLowerCase() || 'pune'}.xlsx`
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 4000)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The Excel export could not be prepared.')
    } finally {
      setExporting(false)
    }
  }

  const download = () => {
    const url = URL.createObjectURL(new Blob(['\uFEFF', boqCsv(cost)], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `formstead-boq-${location.city.toLowerCase() || 'pune'}.csv`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 4000)
  }

  const hasLiveSnapshot = Boolean(acceptedSnapshot && Object.keys(acceptedSnapshot.rates).length > 0)
  const hasManualOverrides = Object.keys(manualOverrides).length > 0

  return (
    <section>
      <SolarEstimateSummary solar={cost.solar} />

      {/* --- Section 1: Live Rate Research Command Bar --- */}
      <div className="mb-8 border border-line bg-bg-elevated p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="inline-block h-2 w-2 rounded-full bg-accent" />
              <h3 className="font-display text-lg font-medium tracking-tight">
                {translateUi("Live Web & Supplier Rate Research")}
              </h3>
            </div>
            <p className="mt-1 text-xs text-ink-dim">
              {translateUi("Extracts verifiable regional supplier quotes using Ollama Qwen3.5:2b while retaining deterministic plan geometry and BOQ logic.")}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {hasLiveSnapshot && (
              <span className="inline-flex items-center gap-1.5 border border-line bg-bg px-2.5 py-1 font-mono text-[0.7rem] text-accent">
                <span>✓</span> {translateUi("Active snapshot:")} {acceptedSnapshot?.location.city} ({Object.keys(acceptedSnapshot?.rates || {}).length} {translateUi("rates")})
              </span>
            )}
            {hasManualOverrides && (
              <span className="inline-flex items-center gap-1 border border-line bg-bg px-2.5 py-1 font-mono text-[0.7rem] text-ink-dim">
                {Object.keys(manualOverrides).length} {translateUi("manual overrides")}
              </span>
            )}
          </div>
        </div>

        {/* Location & Scope Controls */}
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4 items-end">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-ink-dim">{translateUi("Project City / Region")}</span>
              <button
                type="button"
                onClick={handleDetectLocation}
                disabled={isDetectingLocation || isResearching}
                aria-label={translateUi("Detect current city via location")}
                className="inline-flex items-center gap-1 font-mono text-[0.68rem] text-accent hover:underline disabled:opacity-50"
              >
                <span>📍</span>
                <span>{isDetectingLocation ? translateUi("Detecting…") : translateUi("Detect")}</span>
              </button>
            </div>
            <div className="relative mt-1.5">
              <input
                type="text"
                value={location.city}
                onChange={e => setLocation({ city: e.target.value })}
                placeholder="e.g. Pune, Mumbai, Bengaluru"
                className="block w-full border border-line bg-bg px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                disabled={isResearching}
              />
            </div>
            {locationNotice && (
              <p
                role="status"
                className={cx(
                  'mt-1 text-[0.65rem] truncate',
                  locationNotice.type === 'ok' ? 'text-good' : 'text-bad'
                )}
                title={locationNotice.text}
              >
                {locationNotice.text}
              </p>
            )}
          </div>

          <label className="text-xs">
            <span className="text-ink-dim">{translateUi("Pincode (optional)")}</span>
            <input
              type="text"
              value={location.pincode || ''}
              onChange={e => setLocation({ pincode: e.target.value })}
              placeholder="e.g. 411001"
              maxLength={6}
              className="mt-1.5 block w-full border border-line bg-bg px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
              disabled={isResearching}
            />
          </label>

          <div className="text-xs">
            <span className="text-ink-dim">{translateUi("Scope View")}</span>
            <div className="mt-1.5 flex gap-1">
              {(['combined', 'construction', 'interiors'] as ScopeMode[]).map(mode => (
                <button
                  type="button"
                  key={mode}
                  onClick={() => setScopeMode(mode)}
                  className={cx(
                    'border px-2.5 py-2 text-xs capitalize transition-colors',
                    scopeMode === mode ? 'border-accent bg-bg text-accent font-medium' : 'border-line bg-bg text-ink-dim hover:text-ink'
                  )}
                >
                  {mode}
                </button>
              ))}
            </div>
          </div>

          <div className="flex gap-2">
            {!isResearching ? (
              <button
                type="button"
                onClick={handleStartResearch}
                className="w-full border border-ink bg-ink px-4 py-2 text-xs font-medium text-bg hover:bg-ink-dim focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                {translateUi("Research Current Prices")}
              </button>
            ) : (
              <button
                type="button"
                onClick={cancelResearch}
                className="w-full border border-bad bg-bg px-4 py-2 text-xs font-medium text-bad hover:bg-bg-inset focus-visible:outline-none"
              >
                {translateUi("Cancel Research")}
              </button>
            )}

            {activeJob && activeJob.proposals.length > 0 && (
              <button
                type="button"
                onClick={handleOpenProposals}
                className="shrink-0 border border-line bg-bg px-3 py-2 text-xs text-ink hover:border-ink"
              >
                {translateUi("Proposals")} ({activeJob.proposals.length})
              </button>
            )}
          </div>
        </div>

        {/* Live Research Progress Indicator */}
        {isResearching && activeJob && (
          <div className="mt-4 border-t border-line pt-4">
            <div className="flex items-center justify-between text-xs text-ink-dim">
              <span className="font-mono">{activeJob.progress.step}</span>
              <span className="font-mono">{activeJob.progress.completed} / {activeJob.progress.total}</span>
            </div>
            <div className="mt-2 h-1.5 w-full overflow-hidden bg-bg-inset">
              <div
                className="h-full bg-accent transition-all duration-300"
                style={{
                  width: `${activeJob.progress.total > 0 ? (activeJob.progress.completed / activeJob.progress.total) * 100 : 10}%`,
                }}
              />
            </div>
            <p className="mt-2 text-xs text-ink-dim animate-pulse">
              {activeJob.progress.message}
            </p>
          </div>
        )}

        {/* Error notification */}
        {jobError && (
          <div className="mt-4 border border-bad/30 bg-bad/5 p-3 text-xs text-bad">
            {jobError}
          </div>
        )}

        {/* Revert button if snapshot is active */}
        {hasLiveSnapshot && (
          <div className="mt-4 flex items-center justify-between border-t border-line pt-3 text-xs">
            <span className="text-ink-dim">
              {translateUi("Applied pricing context: ")}
              <strong className="text-ink font-medium">{acceptedSnapshot?.location.city}</strong> · {new Date(acceptedSnapshot?.createdAt || '').toLocaleDateString()}
            </span>
            <button
              type="button"
              onClick={clearAcceptedSnapshot}
              className="text-xs text-ink-dim underline hover:text-bad"
            >
              {translateUi("Revert to baseline concept rate book")}
            </button>
          </div>
        )}
      </div>

      {/* --- Section 2: Main Cost Grid --- */}
      <div className="grid items-start gap-8 lg:grid-cols-[1fr_320px]">
        <div>
          <div className="flex flex-wrap items-baseline justify-between gap-4">
            <div>
              <p className="label">{translateUi("Expected total")}</p>
              <h2 className="mt-2 font-display text-4xl">{translateUi(formatINR(cost.expected))}</h2>
            </div>
            {cost.scopeTotals && scopeMode !== 'combined' && (
              <div className="text-right">
                <p className="text-xs text-ink-dim capitalize">{scopeMode} {translateUi("Scope Total")}</p>
                <p className="font-mono text-lg font-medium text-accent">
                  {formatINR(scopeMode === 'construction' ? cost.scopeTotals.construction : cost.scopeTotals.interiors)}
                </p>
              </div>
            )}
          </div>

          <p className="mt-3 text-sm text-ink-dim">
            {translateUi("Range ")}{translateUi(formatRange(cost.total.low, cost.total.high, formatINR))}
          </p>
          <p className="mt-2 text-sm">{translateUi(formatINR(cost.ratePerSqft))} {translateUi(" / sq ft")}</p>
          <p className="mt-3 text-xs leading-relaxed text-ink-faint">{translateUi(cost.qualification)}</p>

          {/* Scope Summary Breakdown */}
          {cost.scopeTotals && (
            <div className="mt-4 grid grid-cols-2 gap-3 border border-line bg-bg p-3 text-xs sm:w-80">
              <div>
                <span className="text-ink-dim">{translateUi("Civil & Structure:")}</span>
                <p className="font-mono font-medium">{formatINR(cost.scopeTotals.construction)}</p>
              </div>
              <div>
                <span className="text-ink-dim">{translateUi("Finishes & Interiors:")}</span>
                <p className="font-mono font-medium">{formatINR(cost.scopeTotals.interiors)}</p>
              </div>
            </div>
          )}

          {/* Site Labour & Duration Estimate */}
          {cost.labour && (
            <div className="mt-6 border border-line bg-bg p-4 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
                <div>
                  <h4 className="font-display text-sm font-medium">{translateUi("Site Labour & Duration Estimate")}</h4>
                  <p className="mt-0.5 text-ink-dim">
                    {translateUi("Estimated duration: ")}
                    <strong className="text-ink">{cost.labour.workingDays} {translateUi("working days")}</strong>
                    {` (${translateUi("about ")}${cost.labour.workingMonths.toFixed(1)} ${translateUi("months")})`}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {/* Wage Source Toggle */}
                  <div className="flex items-center gap-1" role="group" aria-label={translateUi("Labour wage calculation source")}>
                    <span className="mr-0.5 font-mono text-[0.65rem] uppercase tracking-wider text-ink-faint">{translateUi("Wage:")}</span>
                    {(['auto', 'manual'] as const).map(wMode => (
                      <button
                        type="button"
                        key={wMode}
                        aria-pressed={(cost.selection.wageMode ?? 'auto') === wMode}
                        onClick={() => onAllowances?.({
                          wageMode: wMode,
                          ...(wMode === 'manual' && !cost.selection.customDailyWage ? { customDailyWage: cost.labour?.blendedDailyRate ?? 767 } : {})
                        })}
                        className={cx(
                          'border px-2 py-1 font-mono text-[0.68rem] uppercase tracking-wider transition-colors',
                          (cost.selection.wageMode ?? 'auto') === wMode ? 'border-ink bg-bg-inset font-medium text-ink' : 'border-line text-ink-dim hover:text-ink'
                        )}
                      >
                        {translateUi(wMode === 'auto' ? "Auto (City)" : "Manual")}
                      </button>
                    ))}
                  </div>

                  {/* Labour Mode Toggle */}
                  <div className="flex items-center gap-1" role="group" aria-label={translateUi("Labour costing mode")}>
                    {(['additional', 'replace'] as const).map(mode => (
                      <button
                        type="button"
                        key={mode}
                        aria-pressed={cost.labour?.mode === mode}
                        onClick={() => onAllowances?.({ labourMode: mode })}
                        className={cx(
                          'border px-2.5 py-1 font-mono text-[0.68rem] uppercase tracking-wider transition-colors',
                          cost.labour?.mode === mode ? 'border-ink bg-bg-inset font-medium text-ink' : 'border-line text-ink-dim hover:text-ink'
                        )}
                      >
                        {translateUi(mode === 'additional' ? "Additional" : "Replaces embedded")}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-ink-dim">{translateUi("Average daily wage")}</span>
                    <span className="rounded bg-bg-inset px-1.5 py-0.5 font-mono text-[0.6rem] text-ink-dim">
                      {cost.labour.wageMode === 'auto' ? translateUi("City benchmark") : translateUi("Manual rate")}
                    </span>
                  </div>

                  {cost.labour.wageMode === 'manual' ? (
                    <div className="mt-1 flex items-center gap-1.5">
                      <span className="font-mono text-xs text-ink-dim">₹</span>
                      <input
                        type="number"
                        min={100}
                        max={25000}
                        step={25}
                        aria-label={translateUi("Custom daily wage per worker")}
                        value={cost.selection.customDailyWage ?? cost.labour.blendedDailyRate}
                        onChange={e => {
                          const val = Number(e.target.value)
                          if (!isNaN(val) && val > 0) onAllowances?.({ customDailyWage: val, wageMode: 'manual' })
                        }}
                        className="w-24 border border-line bg-bg-inset px-2 py-0.5 font-mono text-sm font-medium text-ink focus:border-ink focus:outline-none"
                      />
                      <span className="text-[0.68rem] text-ink-dim">{translateUi("/ worker / day")}</span>
                    </div>
                  ) : (
                    <p className="mt-1 font-mono font-medium text-ink">
                      {formatINR(cost.labour.blendedDailyRate)} {translateUi("/ worker / day")}
                    </p>
                  )}

                  <p className="mt-0.5 truncate text-[0.65rem] text-ink-faint" title={cost.labour.wageSourceLabel}>
                    {cost.labour.wageMode === 'auto'
                      ? `${cost.labour.wageSourceLabel} · 1 skilled (${formatINR(cost.labour.skilledDailyRate)}) : 2 helpers (${formatINR(cost.labour.unskilledDailyRate)})`
                      : translateUi("Negotiated contractor daily wage")}
                  </p>
                </div>

                <div>
                  <span className="text-ink-dim">{translateUi("Average crew on site")}</span>
                  <p className="mt-1 font-mono font-medium text-ink">
                    {cost.labour.crewSize} {translateUi("workers")}
                  </p>
                  <p className="mt-0.5 text-[0.65rem] text-ink-faint">
                    {`Daily crew payroll ${formatINR(cost.labour.dailyCrewCost)}`}
                  </p>
                </div>

                <div>
                  <span className="text-ink-dim">{translateUi("Site labour total")}</span>
                  <p className="mt-1 font-mono font-medium text-ink">
                    {formatINR(cost.labour.siteLabourTotal)}
                  </p>
                  <p className="mt-0.5 text-[0.65rem] text-ink-faint">
                    {cost.labour.mode === 'additional' ? translateUi("Added to project total") : translateUi("Substituted into works")}
                  </p>
                </div>

                <div>
                  <span className="text-ink-dim">{translateUi("Embedded BOQ labour")}</span>
                  <p className="mt-1 font-mono font-medium text-ink">
                    {formatINR(cost.labour.embeddedLabour)}
                  </p>
                  <p className="mt-0.5 text-[0.65rem] text-ink-faint">
                    {translateUi("Already inside item rates")}
                  </p>
                </div>
              </div>

              <div className="mt-3 border-t border-line/60 pt-2 text-[0.7rem] text-ink-dim">
                <p>
                  {cost.labour.mode === 'additional' ? (
                    <span>
                      <strong className="text-ink">{translateUi("Note: ")}</strong>
                      {translateUi(`Existing rates already include ${formatINR(cost.labour.embeddedLabour)} of installed labour. This line is an additional on-site labour allowance (daily crew, supervision, idle time, rework, site clean-up).`)}
                    </span>
                  ) : (
                    <span>
                      <strong className="text-ink">{translateUi("Note: ")}</strong>
                      {translateUi(`Deducts ${formatINR(cost.labour.embeddedLabour)} of embedded labour from works lines and replaces it with the ${formatINR(cost.labour.siteLabourTotal)} crew-days payroll allowance.`)}
                    </span>
                  )}
                </p>
                <p className="mt-1 text-ink-faint">
                  {translateUi("Duration and labour are planning estimates, not a contractor quote.")}
                </p>
              </div>
            </div>
          )}

          {/* Turnkey vs Material/Labour Split */}
          <div aria-label={translateUi("Contract view")} className="mt-6 flex gap-2">
            {['Turnkey', 'Material + labour'].map((v, i) => (
              <button
                type="button"
                key={v}
                aria-pressed={split === !!i}
                onClick={() => setSplit(!!i)}
                className={cx('border px-3 py-2 text-xs', split === !!i ? 'border-ink bg-bg-inset' : 'border-line')}
              >
                {translateUi(v)}
              </button>
            ))}
          </div>

          <p className="mt-3 text-xs text-ink-dim">
            {translateUi(split ? `Materials ${formatINR(cost.procurement.material)} · Labour ${formatINR(cost.procurement.labour)} · Overhead ${formatINR(cost.procurement.overhead)}` : `Turnkey works ${formatINR(cost.procurement.turnkey)}, including overhead.`)}
          </p>
          <p className="mt-2 text-xs text-ink-faint">
            {translateUi(cost.procurement.note)} {translateUi(" This view does not change the estimated project total.")}
          </p>

          {/* Trades and Lines */}
          <div className="mt-7 space-y-4">
            {cost.tradeTotals.map(t => (
              <details key={t.trade} className="border-b border-line pb-4">
                <summary className="cursor-pointer text-sm">
                  <span className="inline-flex w-[calc(100%-20px)] flex-wrap justify-between gap-2">
                    <span>{translateUi(t.trade)}</span>
                    <span className="font-mono text-xs">{translateUi(formatINR(t.amount))} · {translateUi((t.share * 100).toFixed(1))}%</span>
                  </span>
                  <span className="mt-3 block h-1.5 bg-bg-inset">
                    <span className="block h-full bg-ink-dim" style={{ width: `${t.share * 100}%` }} />
                  </span>
                </summary>
                <ul className="mt-4 divide-y divide-line">
                  {cost.boq.filter(l => l.group === t.trade).map(l => (
                    <li key={l.id} className="py-3 text-xs">
                      <div className="flex justify-between gap-4">
                        <div>
                          <p className="font-medium text-ink">{translateUi(l.label)}</p>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5">
                            {l.rateSource === 'researched' ? (
                              <span className="border border-accent/40 bg-accent/5 px-1.5 py-0.5 font-mono text-[0.65rem] text-accent">
                                {translateUi("Live researched")}{l.provenance ? ` · ${l.provenance}` : ''}
                              </span>
                            ) : l.rateSource === 'manual' ? (
                              <span className="border border-ink-dim/40 bg-bg-inset px-1.5 py-0.5 font-mono text-[0.65rem] text-ink">
                                {translateUi("Manual override")}
                              </span>
                            ) : (
                              <span className="border border-line bg-bg px-1.5 py-0.5 font-mono text-[0.65rem] text-ink-faint">
                                {translateUi("Baseline concept allowance")}
                              </span>
                            )}
                            <span className="font-mono text-[0.65rem] text-ink-dim uppercase">
                              [{l.scopeCategory || 'construction'}]
                            </span>
                          </div>
                        </div>
                        <p className="shrink-0 font-mono text-sm">{translateUi(formatINR(l.amount))}</p>
                      </div>
                      <p className="mt-1 text-ink-faint">
                        {translateUi(l.specification)} · {translateUi(l.qty.toFixed(2))} {translateUi(l.unit)} × {translateUi(formatINR(l.rate))}
                      </p>
                      {split && (
                        <p className="mt-1 text-ink-faint">
                          {translateUi("Material ")}{translateUi(formatINR(l.materialAmount))} {translateUi(" · Labour ")}{translateUi(formatINR(l.labourAmount))}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              </details>
            ))}
          </div>

          <p className="mt-3 text-xs text-ink-faint">{translateUi("Trade shares are of works, before project add-ons.")}</p>

          <div className="mt-6 flex flex-wrap gap-2">
            <button type="button" onClick={download} className="border border-line px-4 py-2 text-xs hover:border-ink">
              {translateUi("Download BOQ CSV")}
            </button>
            <button
              type="button"
              disabled={exporting}
              onClick={() => void excel()}
              className="border border-line px-4 py-2 text-xs disabled:opacity-50 hover:border-ink"
            >
              {translateUi(exporting ? 'Preparing Excel…' : 'Download BOQ Excel')}
            </button>
          </div>
          {error && <p role="alert" className="mt-3 text-xs text-bad">{translateUi(error)}</p>}
        </div>

        {/* Sidebar: Add-ons & Cost Drivers */}
        <aside>
          <h3 className="font-display text-xl">{translateUi("Project add-ons")}</h3>
          <dl className="mt-3 divide-y divide-line">
            {cost.lines.slice(1).map(l => (
              <div key={l.label} className="py-3 text-xs">
                <div className="flex justify-between gap-3">
                  <dt>{translateUi(l.label)}</dt>
                  <dd className="shrink-0 font-mono">{translateUi(formatINR(l.expected))}</dd>
                </div>
                <p className="mt-1 text-ink-faint">{translateUi(l.note)}</p>
              </div>
            ))}
          </dl>

          <h3 className="mt-7 font-display text-xl">{translateUi("Top cost drivers")}</h3>
          <p className="mt-2 text-xs text-ink-faint">
            {translateUi("Compared with the ")}
            {translateUi({ simple: 'Basic', standard: 'Mid', refined: 'Premium' }[cost.selection.preset] ?? cost.selection.preset)}
            {translateUi(" defaults on this same plan.")}
          </p>
          <ul className="mt-3 space-y-4">
            {cost.topCostDrivers.map(d => (
              <li key={d.item} className="text-xs">
                <p>{translateUi(d.label)} · <span className="font-mono">{translateUi(formatINR(d.amount))}</span></p>
                <p className="mt-1 text-ink-faint">
                  {translateUi(d.difference ? `${d.difference > 0 ? '+' : '−'}${formatINR(Math.abs(d.difference))} vs default` : 'Matches default')}
                </p>
              </li>
            ))}
          </ul>
        </aside>
      </div>

      {/* Allowances details */}
      {onAllowances && (
        <details className="mt-8 border-t border-line pt-4">
          <summary className="cursor-pointer text-sm">{translateUi("Allowances & tax provision")}</summary>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {([['overheadPercent', 'Overhead (%)'], ['contingencyPercent', 'Contingency (%)'], ['feePercent', 'Fees (%)'], ['gstPercent', 'GST (%)']] as const).map(([field, label]) => (
              <Field key={field} label={label}>
                <input
                  aria-label={translateUi(label)}
                  type="number"
                  min={0}
                  max={policy.percentageLimit}
                  value={cost.selection[field]}
                  onChange={e => { if (e.target.value !== '') onAllowances({ [field]: Number(e.target.value) }) }}
                  className="w-full border border-line bg-bg p-2 text-sm"
                />
              </Field>
            ))}
          </div>
          <label className="mt-4 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={cost.selection.includeGst}
              onChange={e => onAllowances({ includeGst: e.target.checked })}
            />
            {translateUi("Include GST provision")}
          </label>

          <div className="mt-6 border-t border-line/60 pt-4">
            <p className="font-medium text-xs text-ink">{translateUi("Site Labour & Timeline Parameters")}</p>
            <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label={translateUi("Labour mode")}>
                <select
                  aria-label={translateUi("Labour mode")}
                  value={cost.selection.labourMode ?? 'additional'}
                  onChange={e => onAllowances({ labourMode: e.target.value as 'additional' | 'replace' })}
                  className="w-full border border-line bg-bg p-2 text-sm"
                >
                  <option value="additional">{translateUi("Additional allowance")}</option>
                  <option value="replace">{translateUi("Replace embedded labour")}</option>
                </select>
              </Field>

              <Field label={translateUi("Wage source")}>
                <select
                  aria-label={translateUi("Wage source")}
                  value={cost.selection.wageMode ?? 'auto'}
                  onChange={e => onAllowances({ wageMode: e.target.value as 'auto' | 'manual' })}
                  className="w-full border border-line bg-bg p-2 text-sm"
                >
                  <option value="auto">{translateUi("Auto (City benchmark)")}</option>
                  <option value="manual">{translateUi("Manual (Custom wage)")}</option>
                </select>
              </Field>

              <Field label={translateUi("Custom wage (INR/day)")}>
                <input
                  aria-label={translateUi("Custom wage")}
                  type="number"
                  min={0}
                  max={25000}
                  placeholder={cost.labour ? `Benchmark (${cost.labour.blendedDailyRate})` : 'Benchmark'}
                  value={cost.selection.customDailyWage ?? ''}
                  onChange={e => onAllowances({ customDailyWage: e.target.value ? Math.max(1, Number(e.target.value)) : undefined, wageMode: 'manual' })}
                  className="w-full border border-line bg-bg p-2 text-sm"
                />
              </Field>

              <Field label={translateUi("Crew size (workers)")}>
                <input
                  aria-label={translateUi("Crew size")}
                  type="number"
                  min={1}
                  max={100}
                  value={cost.selection.crewSize ?? 6}
                  onChange={e => { if (e.target.value !== '') onAllowances({ crewSize: Math.max(1, Number(e.target.value)) }) }}
                  className="w-full border border-line bg-bg p-2 text-sm"
                />
              </Field>

              <Field label={translateUi("Skilled wage (INR/day)")}>
                <input
                  aria-label={translateUi("Skilled wage")}
                  type="number"
                  min={0}
                  max={20000}
                  value={cost.selection.skilledDailyRate ?? 1100}
                  onChange={e => { if (e.target.value !== '') onAllowances({ skilledDailyRate: Math.max(0, Number(e.target.value)) }) }}
                  className="w-full border border-line bg-bg p-2 text-sm"
                />
              </Field>

              <Field label={translateUi("Unskilled wage (INR/day)")}>
                <input
                  aria-label={translateUi("Unskilled wage")}
                  type="number"
                  min={0}
                  max={20000}
                  value={cost.selection.unskilledDailyRate ?? 600}
                  onChange={e => { if (e.target.value !== '') onAllowances({ unskilledDailyRate: Math.max(0, Number(e.target.value)) }) }}
                  className="w-full border border-line bg-bg p-2 text-sm"
                />
              </Field>

              <Field label={translateUi("Duration override (days)")}>
                <input
                  aria-label={translateUi("Duration override")}
                  type="number"
                  min={0}
                  max={2000}
                  placeholder={translateUi(`Auto (${cost.labour?.workingDays ?? ''}d)`)}
                  value={cost.selection.daysOverride ?? ''}
                  onChange={e => onAllowances({ daysOverride: e.target.value ? Math.max(1, Number(e.target.value)) : undefined })}
                  className="w-full border border-line bg-bg p-2 text-sm"
                />
              </Field>
            </div>
          </div>
        </details>
      )}

      {/* --- Proposed Rates Inspection Modal --- */}
      {showProposals && activeJob && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="relative max-h-[90vh] w-full max-w-4xl overflow-y-auto border border-line bg-bg p-6 shadow-2xl">
            <div className="flex items-start justify-between border-b border-line pb-4">
              <div>
                <h3 className="font-display text-xl">{translateUi("Live Researched Rate Proposals")}</h3>
                <p className="mt-1 text-xs text-ink-dim">
                  {translateUi("Extracted via Qwen3.5:2b for")} {activeJob.location.city}. {translateUi("Review evidence and apply rates to the estimate.")}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowProposals(false)}
                className="border border-line px-2.5 py-1 text-xs text-ink hover:bg-bg-inset"
              >
                ✕ {translateUi("Close")}
              </button>
            </div>

            <div className="mt-6 space-y-6">
              {activeJob.proposals.map((prop: ProposedRate) => (
                <div key={prop.rateId} className="border border-line bg-bg-elevated p-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={selectedProposalRates[prop.rateId] ?? false}
                        onChange={e =>
                          setSelectedProposalRates(prev => ({
                            ...prev,
                            [prop.rateId]: e.target.checked,
                          }))
                        }
                        id={`check-${prop.rateId}`}
                        className="h-4 w-4"
                      />
                      <label htmlFor={`check-${prop.rateId}`} className="font-medium text-sm text-ink cursor-pointer">
                        {prop.itemLabel}
                      </label>
                      <span className="font-mono text-xs text-ink-dim">({prop.rateId})</span>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className={cx(
                        'border px-2 py-0.5 font-mono text-[0.7rem] uppercase',
                        prop.status === 'accepted' ? 'border-accent text-accent' :
                        prop.status === 'conflict' ? 'border-amber-600 text-amber-600' : 'border-line text-ink-faint'
                      )}>
                        {prop.status}
                      </span>
                      <span className="font-mono text-xs">
                        {prop.differencePercent > 0 ? `+${prop.differencePercent}%` : `${prop.differencePercent}%`}
                      </span>
                    </div>
                  </div>

                  {/* Rate comparison */}
                  <div className="mt-3 grid grid-cols-2 gap-4 border-t border-b border-line py-2 text-xs sm:grid-cols-4">
                    <div>
                      <span className="text-ink-dim">{translateUi("Baseline installed:")}</span>
                      <p className="font-mono font-medium">Rs {prop.baselineInstalled} / {prop.unit}</p>
                    </div>
                    <div>
                      <span className="text-ink-dim">{translateUi("Proposed installed:")}</span>
                      <p className="font-mono font-medium text-accent">Rs {prop.proposedInstalled} / {prop.unit}</p>
                    </div>
                    <div>
                      <span className="text-ink-dim">{translateUi("Proposed material:")}</span>
                      <p className="font-mono">Rs {prop.proposedMaterial}</p>
                    </div>
                    <div>
                      <span className="text-ink-dim">{translateUi("Proposed labour:")}</span>
                      <p className="font-mono">Rs {prop.proposedLabour}</p>
                    </div>
                  </div>

                  <p className="mt-2 text-xs text-ink-dim">{prop.selectionReason}</p>

                  {/* Evidence sources */}
                  {prop.evidence.length > 0 && (
                    <div className="mt-3 space-y-2">
                      <p className="text-[0.7rem] font-medium uppercase tracking-wider text-ink-faint">
                        {translateUi("Supporting Evidence Sources")} ({prop.evidence.length})
                      </p>
                      {prop.evidence.map((ev, idx) => (
                        <div key={idx} className="border border-line bg-bg p-2.5 text-xs">
                          <div className="flex flex-wrap items-baseline justify-between gap-2">
                            <a
                              href={ev.url}
                              target="_blank"
                              rel="noreferrer"
                              className="font-medium text-accent underline"
                            >
                              {ev.publisher} ↗
                            </a>
                            <span className="font-mono text-[0.65rem] text-ink-dim">
                              {ev.publishedDate || 'Oct 2026'} · Quoted Rs {ev.quotedPrice} / {ev.quotedUnit}
                            </span>
                          </div>
                          <blockquote className="mt-1.5 border-l-2 border-accent pl-2 text-[0.75rem] italic text-ink-dim">
                            "{ev.excerpt}"
                          </blockquote>
                          {ev.conversionAssumptions.length > 0 && (
                            <ul className="mt-1 list-inside list-disc text-[0.65rem] text-ink-faint">
                              {ev.conversionAssumptions.map((ass, i) => (
                                <li key={i}>{ass}</li>
                              ))}
                            </ul>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Manual Override inline control */}
                  <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
                    <span className="text-ink-dim">{translateUi("Manual rate override:")}</span>
                    <input
                      type="number"
                      placeholder={`Rs ${prop.proposedInstalled}`}
                      value={manualOverrides[prop.rateId]?.installed ?? ''}
                      onChange={e => {
                        const val = e.target.value
                        if (val !== '') {
                          setManualOverride(prop.rateId, {
                            installed: Number(val),
                            unit: prop.unit,
                          })
                        } else {
                          removeManualOverride(prop.rateId)
                        }
                      }}
                      className="w-28 border border-line bg-bg px-2 py-1 font-mono text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                    />
                    {manualOverrides[prop.rateId] && (
                      <button
                        type="button"
                        onClick={() => removeManualOverride(prop.rateId)}
                        className="text-[0.7rem] text-bad underline"
                      >
                        {translateUi("Clear override")}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-8 flex justify-end gap-3 border-t border-line pt-4">
              <button
                type="button"
                onClick={() => setShowProposals(false)}
                className="border border-line px-4 py-2 text-xs text-ink hover:bg-bg-inset"
              >
                {translateUi("Cancel")}
              </button>
              <button
                type="button"
                onClick={handleApplySelected}
                className="border border-ink bg-ink px-5 py-2 text-xs font-medium text-bg hover:bg-ink-dim"
              >
                {translateUi("Apply Selected Rates to Estimate")}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

export function AssumptionsView({ cost }: { cost: CostEstimate }) {
  useLanguage(s => s.language)

  const acceptedSnapshot = useCostResearch(s => s.acceptedSnapshot)
  const location = useCostResearch(s => s.location)
  const manualOverrides = useCostResearch(s => s.manualOverrides)

  const hasLiveSnapshot = Boolean(acceptedSnapshot && Object.keys(acceptedSnapshot.rates).length > 0)

  return (
    <section>
      <h2 className="font-display text-2xl">{translateUi("What this estimate covers")}</h2>
      <p className="mt-3 max-w-3xl text-sm leading-relaxed text-ink-dim">{translateUi(cost.qualification)}</p>

      {/* Live Rate Provenance Card */}
      <div className="mt-6 border border-line bg-bg-elevated p-5">
        <h3 className="font-display text-lg font-medium">
          {translateUi("Rate Provenance & Freshness Status")}
        </h3>
        <dl className="mt-3 grid gap-4 text-xs sm:grid-cols-3">
          <div>
            <dt className="text-ink-dim">{translateUi("Target Location")}</dt>
            <dd className="mt-1 font-medium text-sm text-ink">{location.city}, {location.country}</dd>
          </div>
          <div>
            <dt className="text-ink-dim">{translateUi("Pricing Basis")}</dt>
            <dd className="mt-1 font-medium text-sm text-ink">
              {hasLiveSnapshot ? translateUi("Live Web Researched Snapshot") : translateUi("Provisional Baseline Rate Book")}
            </dd>
          </div>
          <div>
            <dt className="text-ink-dim">{translateUi("Rate Reference Date")}</dt>
            <dd className="mt-1 font-medium text-sm text-ink">
              {hasLiveSnapshot
                ? new Date(acceptedSnapshot?.createdAt || '').toLocaleDateString()
                : '2026-10-03 (Pune baseline)'}
            </dd>
          </div>
        </dl>

        {hasLiveSnapshot && (
          <div className="mt-4 border-t border-line pt-3">
            <p className="text-xs text-ink-dim">
              {translateUi("Live researched rates applied:")} <strong>{Object.keys(acceptedSnapshot?.rates || {}).length}</strong> items.
              {Object.keys(manualOverrides).length > 0 && ` (${Object.keys(manualOverrides).length} manual user overrides active).`}
            </p>
            {acceptedSnapshot?.unresolvedGaps && acceptedSnapshot.unresolvedGaps.length > 0 && (
              <div className="mt-3">
                <p className="text-xs font-medium text-ink-dim">{translateUi("Provisional Fallback Items:")}</p>
                <ul className="mt-1 list-inside list-disc text-xs text-ink-faint">
                  {acceptedSnapshot.unresolvedGaps.map(g => (
                    <li key={g.rateId}>
                      <strong>{g.itemLabel}</strong>: {g.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        <p className="mt-4 text-xs leading-relaxed text-ink-faint">
          {translateUi("Notice: Concept-level estimate only. Live rate research provides regional market indications but does not replace licensed structural engineering drawings, local municipal sanction approvals, or formal contractor tenders.")}
        </p>
      </div>

      <div className="mt-7 grid gap-8 md:grid-cols-2">
        {([
          ['Included', cost.included],
          ['Excluded', cost.excluded],
          ['Assumptions', cost.assumptions],
          ['Rates source & date', cost.sources],
        ] as const).map(([title, list]) => (
          <section key={title} className="min-w-0 [overflow-wrap:anywhere]">
            <h3 className="border-b border-line pb-3 font-display text-xl">{translateUi(title)}</h3>
            <ul className="mt-4 space-y-3 text-sm leading-relaxed text-ink-dim">
              {list.map(v => <li key={v}>{translateUi(v)}</li>)}
            </ul>
          </section>
        ))}
      </div>

      <p className="mt-6 text-xs text-ink-faint">{translateUi(cost.basis)}</p>
      {cost.sanityNote && <p className="mt-3 text-xs text-ink-faint">{translateUi(cost.sanityNote)}</p>}
    </section>
  )
}
