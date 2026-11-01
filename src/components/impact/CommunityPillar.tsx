import { useState, useMemo, useEffect, useDeferredValue, type FC } from 'react'
import { Users, Building2, Download, Plus, Trash2, ShieldCheck, FileSpreadsheet, ChevronDown, ChevronRight, CheckCircle2, XCircle } from 'lucide-react'
import type { ImpactDocument } from '@/lib/impact/schema.ts'
import type { ImpactSummary } from '@/lib/impact/summary.ts'
import { SvgBarCompare, type SvgBarCompareGroup } from './charts/SvgBarCompare.tsx'

export interface CommunityPillarProps {
  summary: ImpactSummary['community']
  doc: ImpactDocument
  onSaveDoc: (next: ImpactDocument) => void
}

const fmt = (n: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n)

export const CommunityPillar: FC<CommunityPillarProps> = ({
  summary,
  doc,
  onSaveDoc,
}) => {
  const {
    households,
    sharedAllowanceInr,
    carpetAreaM2,
    pmayCheck,
    clusterScale,
  } = summary

  // Pilot form state
  const [householdCode, setCode] = useState('')
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [stage, setStage] = useState<'planned' | 'supported'>('supported')
  const [baselineCost, setBaseline] = useState('')
  const [actualCost, setActual] = useState('')
  const [measuredWater, setWater] = useState('')
  const [evidence, setEvidence] = useState('')
  const [resilience, setResilience] = useState('')
  const [sameScope, setSameScope] = useState(true)
  const [formError, setError] = useState('')
  const [assumptionsOpen, setAssumptionsOpen] = useState(false)

  // Local state for smooth slider dragging
  const [localHouseholds, setLocalHouseholds] = useState(households)
  useEffect(() => {
    setLocalHouseholds(households)
  }, [households])

  const deferredHouseholds = useDeferredValue(localHouseholds)

  const handleHouseholdChange = (count: number) => {
    onSaveDoc({
      ...doc,
      community: {
        ...doc.community,
        households: Math.min(10000, Math.max(1, count)),
      },
    })
  }

  useEffect(() => {
    if (deferredHouseholds !== households) {
      handleHouseholdChange(deferredHouseholds)
    }
  }, [deferredHouseholds])

  // Baseline vs Actual chart groups for recorded pilots
  const pilotCompareGroups: SvgBarCompareGroup[] = useMemo(() => {
    const comparable = doc.pilots.filter(
      p => p.baselineCostInr !== null && p.actualCostInr !== null && p.sameScope
    )
    if (!comparable.length) {
      return [
        { label: 'Pilot Cohort A (Sample)', currentVal: 2850000, swappedVal: 2480000, unit: '₹', isAssumption: true },
        { label: 'Pilot Cohort B (Sample)', currentVal: 3100000, swappedVal: 2750000, unit: '₹', isAssumption: true },
      ]
    }
    return comparable.slice(-5).map(p => ({
      label: p.householdCode,
      currentVal: p.baselineCostInr!,
      swappedVal: p.actualCostInr!,
      unit: '₹',
      isAssumption: false,
    }))
  }, [doc.pilots])

  const handleSharedAllowanceChange = (amount: number | null) => {
    onSaveDoc({
      ...doc,
      community: {
        ...doc.community,
        sharedAllowanceInr: amount,
      },
    })
  }

  const handleAddPilot = (e: React.FormEvent) => {
    e.preventDefault()
    if (!householdCode.trim()) {
      setError('Enter an anonymous household code.')
      return
    }

    const newRecord = {
      id: `pilot-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      householdCode: householdCode.trim().slice(0, 80),
      date,
      stage,
      baselineCostInr: baselineCost ? Number(baselineCost) : null,
      actualCostInr: actualCost ? Number(actualCost) : null,
      measuredWaterL: measuredWater ? Number(measuredWater) : null,
      evidence: evidence.trim().slice(0, 1000),
      resilienceNote: resilience.trim().slice(0, 1000),
      sameScope,
    }

    onSaveDoc({
      ...doc,
      pilots: [...doc.pilots, newRecord],
    })

    setCode('')
    setBaseline('')
    setActual('')
    setWater('')
    setEvidence('')
    setResilience('')
    setError('')
  }

  const handleRemovePilot = (id: string) => {
    onSaveDoc({
      ...doc,
      pilots: doc.pilots.filter(p => p.id !== id),
    })
  }

  // Export handlers
  const handleExportJson = () => {
    const payload = {
      format: 'brickpilot-social-impact',
      version: 2,
      exportedAt: new Date().toISOString(),
      community: doc.community,
      pilots: doc.pilots,
      scaling: clusterScale,
      pmay: pmayCheck,
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'brickpilot-social-impact.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleExportCsv = () => {
    const headers = ['ID', 'HouseholdCode', 'Date', 'Stage', 'BaselineCostINR', 'ActualCostINR', 'SameScope', 'MeasuredWaterL', 'Evidence', 'ResilienceNote']
    const rows = doc.pilots.map(p => [
      p.id,
      `"${p.householdCode}"`,
      p.date,
      p.stage,
      p.baselineCostInr ?? '',
      p.actualCostInr ?? '',
      p.sameScope ? 'YES' : 'NO',
      p.measuredWaterL ?? '',
      `"${p.evidence.replaceAll('"', '""')}"`,
      `"${p.resilienceNote.replaceAll('"', '""')}"`,
    ])
    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n')
    const blob = new Blob([csvContent], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'brickpilot-pilot-outcomes.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-6">
      {/* Header Card */}
      <div className="rounded-xl border border-line bg-bg-raised p-5 sm:p-6 shadow-2xs">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <span className="font-mono text-xs uppercase tracking-wider text-ink-dim">
              Pillar 05 · Community & Field Evidence
            </span>
            <h2 className="font-display text-2xl font-medium text-ink mt-1">Multi-Home Scalability & PMAY-U 2.0 Subsidies</h2>
            <p className="mt-1.5 font-sans text-sm text-ink-dim max-w-2xl leading-relaxed">
              Scale single-prototype designs to community clusters (1–10,000 homes), audit against PMAY-U 2.0 vertical carpet-area ceilings, and record verifiable pilot outcomes.
            </p>
          </div>

          {/* PMAY-U 2.0 Carpet Area Badge */}
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center gap-2 rounded-full px-4 py-1.5 font-mono text-xs font-semibold border ${
                pmayCheck.eligible ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-bg-inset text-ink-dim border-line'
              }`}
            >
              <ShieldCheck size={16} className={pmayCheck.eligible ? 'text-emerald-700' : 'text-ink-dim'} aria-hidden />
              {pmayCheck.badge} ({carpetAreaM2.toFixed(1)} m² Carpet Area)
            </span>
          </div>
        </div>

        {/* PMAY-U 2.0 Verticals Breakdown Grid */}
        <div className="mt-5 grid gap-4 sm:grid-cols-3 border-t border-line pt-5">
          <div className={`rounded-xl border p-4 ${
            pmayCheck.eligibleVerticals.includes('BLC')
              ? 'border-emerald-300 bg-emerald-50/50'
              : 'border-line bg-bg-inset opacity-80'
          }`}>
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs uppercase font-bold text-ink">BLC / AHP Vertical</span>
              {pmayCheck.eligibleVerticals.includes('BLC') ? (
                <CheckCircle2 size={16} className="text-emerald-700" />
              ) : (
                <XCircle size={16} className="text-rose-700" />
              )}
            </div>
            <p className="mt-1.5 font-mono text-xs text-ink font-semibold">Ceiling: 45 m² (min 30 m²)</p>
            <p className="mt-1 font-sans text-xs text-ink-dim">Beneficiary-Led Construction / Affordable Housing · EWS (≤ ₹3L)</p>
          </div>

          <div className={`rounded-xl border p-4 ${
            pmayCheck.eligibleVerticals.includes('ARH')
              ? 'border-emerald-300 bg-emerald-50/50'
              : 'border-line bg-bg-inset opacity-80'
          }`}>
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs uppercase font-bold text-ink">ARH Vertical</span>
              {pmayCheck.eligibleVerticals.includes('ARH') ? (
                <CheckCircle2 size={16} className="text-emerald-700" />
              ) : (
                <XCircle size={16} className="text-rose-700" />
              )}
            </div>
            <p className="mt-1.5 font-mono text-xs text-ink font-semibold">Ceiling: 60 m²</p>
            <p className="mt-1 font-sans text-xs text-ink-dim">Affordable Rental Housing · EWS / LIG (≤ ₹6L)</p>
          </div>

          <div className={`rounded-xl border p-4 ${
            pmayCheck.eligibleVerticals.includes('ISS')
              ? 'border-emerald-300 bg-emerald-50/50'
              : 'border-line bg-bg-inset opacity-80'
          }`}>
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs uppercase font-bold text-ink">ISS Vertical</span>
              {pmayCheck.eligibleVerticals.includes('ISS') ? (
                <CheckCircle2 size={16} className="text-emerald-700" />
              ) : (
                <XCircle size={16} className="text-rose-700" />
              )}
            </div>
            <p className="mt-1.5 font-mono text-xs text-ink font-semibold">Ceiling: 120 m²</p>
            <p className="mt-1 font-sans text-xs text-ink-dim">Interest Subsidy Scheme · EWS / LIG / MIG (≤ ₹9L)</p>
          </div>
        </div>

        {/* Legacy PMAY Note */}
        <p className="mt-4 font-mono text-xs text-ink-dim border-t border-line/60 pt-3">
          <span className="font-bold text-ink">PMAY-U 2.0 Note:</span> {pmayCheck.legacyNote}
        </p>
      </div>

      {/* Hero 1: Live Interactive Cluster Slider */}
      <section aria-label="Community homes scaling simulator">
        <div className="rounded-xl border border-line bg-bg-raised p-5 sm:p-6 shadow-2xs">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
            <div>
              <span className="font-mono text-xs uppercase tracking-wider text-ink-dim">Prototype Replication</span>
              <h3 className="font-display text-xl font-medium text-ink mt-0.5 flex items-center gap-2">
                <Building2 size={20} className="text-ink" aria-hidden />
                Community Cluster Simulator
              </h3>
            </div>

            {/* Slider & Number Input with immediate local state & deferred update */}
            <div className="flex flex-wrap items-center gap-3 min-w-0">
              <span className="font-sans text-xs text-ink-dim font-medium">Cluster Size:</span>
              <input
                type="range"
                min={1}
                max={500}
                value={Math.min(500, localHouseholds)}
                onChange={e => setLocalHouseholds(Number(e.target.value))}
                className="w-32 accent-accent cursor-pointer min-h-[38px]"
              />
              <input
                type="number"
                min={1}
                max={10000}
                value={localHouseholds}
                onChange={e => setLocalHouseholds(Math.max(1, Number(e.target.value)))}
                className="w-20 rounded-lg border border-line bg-bg px-2.5 py-1.5 font-mono text-xs text-ink font-bold focus-visible:outline-accent"
              />
              <span className="font-mono text-xs text-ink-dim">Homes</span>
            </div>
          </div>

          {/* Shared Infrastructure Input */}
          <div className="mb-6 flex flex-col sm:flex-row sm:items-center gap-3 rounded-xl border border-line bg-bg p-4 font-sans text-xs sm:text-sm min-w-0">
            <span className="text-ink-dim min-w-0 break-words flex-1">Shared Infrastructure Allowance (Solar microgrid, bulk water filtration):</span>
            <div className="flex items-center gap-2.5 shrink-0">
              <input
                type="number"
                min={0}
                step={50000}
                placeholder="e.g. 1500000"
                value={sharedAllowanceInr || ''}
                onChange={e => handleSharedAllowanceChange(e.target.value === '' ? null : Number(e.target.value))}
                className="min-h-10 rounded-lg border border-line bg-bg-raised px-3.5 font-mono text-sm text-ink w-36 focus-visible:outline-accent"
              />
              <span className="font-mono text-ink-dim text-xs">
                {sharedAllowanceInr > 0 ? `+${fmt(sharedAllowanceInr)}` : 'None'}
              </span>
            </div>
          </div>

          {/* 4 Live Aggregated KPI Tiles from Single Source of Truth */}
          <div className="grid gap-4 sm:grid-cols-4">
            <div className="rounded-xl border border-line bg-bg p-4 flex flex-col justify-between">
              <span className="font-mono text-xs uppercase tracking-wider text-ink-dim">Total Cluster Cost</span>
              <p className="mt-2 font-display text-2xl font-semibold tracking-tight text-ink">{fmt(clusterScale.totalCostInr)}</p>
              <p className="mt-1 font-mono text-xs text-ink-dim">{fmt(clusterScale.perHomeCostInr)} / home net</p>
            </div>

            <div className="rounded-xl border border-line bg-bg p-4 flex flex-col justify-between">
              <span className="font-mono text-xs uppercase tracking-wider text-ink-dim">Rainwater Harvested</span>
              <p className="mt-2 font-display text-2xl font-semibold tracking-tight text-ink">
                {clusterScale.totalRainwaterHarvestL.toLocaleString('en-IN')} L
              </p>
              <p className="mt-1 font-mono text-xs text-sky-800 font-medium">Monsoon community yield</p>
            </div>

            <div className="rounded-xl border border-line bg-bg p-4 flex flex-col justify-between">
              <span className="font-mono text-xs uppercase tracking-wider text-ink-dim">CO₂e Avoided</span>
              <p className="mt-2 font-display text-2xl font-semibold tracking-tight text-emerald-800">
                {clusterScale.totalCarbonAvoidedTonnes} Tonnes
              </p>
              <p className="mt-1 font-mono text-xs text-emerald-800">With verified eco-materials</p>
            </div>

            <div className="rounded-xl border border-line bg-bg p-4 flex flex-col justify-between">
              <span className="font-mono text-xs uppercase tracking-wider text-ink-dim">Collective Savings</span>
              <p className="mt-2 font-display text-2xl font-semibold tracking-tight text-ink">{fmt(clusterScale.totalRupeesSaved)}</p>
              <p className="mt-1 font-mono text-xs text-ink-dim">Via 1-click material swaps</p>
            </div>
          </div>
        </div>
      </section>

      {/* Section 2: Post-Occupancy Pilot Evidence */}
      <section aria-label="Field pilot outcomes and evidence ledger">
        <div className="rounded-xl border border-line bg-bg-raised p-5 sm:p-6 shadow-2xs">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
            <div>
              <span className="font-mono text-xs uppercase tracking-wider text-ink-dim">CSR & Grant Audits</span>
              <h3 className="font-display text-xl font-medium text-ink mt-0.5 flex items-center gap-2">
                <Users size={20} className="text-ink" aria-hidden />
                Post-Occupancy Pilot Outcomes
              </h3>
              <p className="mt-1 font-sans text-xs sm:text-sm text-ink-dim">
                Log empirical baseline vs actual construction costs and water measurements for institutional grant reviews.
              </p>
            </div>

            {/* Export Buttons */}
            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={handleExportCsv}
                className="inline-flex items-center gap-2 rounded-lg border border-line bg-bg px-3.5 py-2 font-mono text-xs font-semibold text-ink hover:bg-bg-inset cursor-pointer min-h-[38px]"
              >
                <FileSpreadsheet size={15} aria-hidden /> Export CSV
              </button>
              <button
                type="button"
                onClick={handleExportJson}
                className="inline-flex items-center gap-2 rounded-lg border border-line bg-bg px-3.5 py-2 font-mono text-xs font-semibold text-ink hover:bg-bg-inset cursor-pointer min-h-[38px]"
              >
                <Download size={15} aria-hidden /> Export JSON
              </button>
            </div>
          </div>

          {/* Form & Compare Chart Layout */}
          <div className="grid gap-6 lg:grid-cols-2 min-w-0">
            {/* Entry Form */}
            <form onSubmit={handleAddPilot} className="rounded-xl border border-line bg-bg p-5 space-y-4 min-w-0">
              <p className="font-display text-base font-semibold text-ink">Record Household Outcome</p>

              <div className="grid gap-4 sm:grid-cols-2 min-w-0">
                <label className="font-sans text-xs text-ink-dim block font-medium">
                  Anonymous Code *
                  <input
                    required
                    maxLength={80}
                    placeholder="e.g. PUNE-PILOT-04"
                    value={householdCode}
                    onChange={e => setCode(e.target.value)}
                    className="mt-1.5 w-full rounded-lg border border-line bg-bg-raised px-3 py-2 font-mono text-sm text-ink focus-visible:outline-accent"
                  />
                </label>

                <label className="font-sans text-xs text-ink-dim block font-medium">
                  Date *
                  <input
                    type="date"
                    required
                    value={date}
                    onChange={e => setDate(e.target.value)}
                    className="mt-1.5 w-full rounded-lg border border-line bg-bg-raised px-3 py-2 font-mono text-sm text-ink focus-visible:outline-accent"
                  />
                </label>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="font-sans text-xs text-ink-dim block font-medium">
                  Baseline Cost (₹)
                  <input
                    type="number"
                    min={0}
                    placeholder="e.g. 2800000"
                    value={baselineCost}
                    onChange={e => setBaseline(e.target.value)}
                    className="mt-1.5 w-full rounded-lg border border-line bg-bg-raised px-3 py-2 font-mono text-sm text-ink focus-visible:outline-accent"
                  />
                </label>

                <label className="font-sans text-xs text-ink-dim block font-medium">
                  Actual Built Cost (₹)
                  <input
                    type="number"
                    min={0}
                    placeholder="e.g. 2450000"
                    value={actualCost}
                    onChange={e => setActual(e.target.value)}
                    className="mt-1.5 w-full rounded-lg border border-line bg-bg-raised px-3 py-2 font-mono text-sm text-ink focus-visible:outline-accent"
                  />
                </label>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="font-sans text-xs text-ink-dim block font-medium">
                  Harvested Water (L)
                  <input
                    type="number"
                    min={0}
                    placeholder="e.g. 14000"
                    value={measuredWater}
                    onChange={e => setWater(e.target.value)}
                    className="mt-1.5 w-full rounded-lg border border-line bg-bg-raised px-3 py-2 font-mono text-sm text-ink focus-visible:outline-accent"
                  />
                </label>

                <label className="font-sans text-xs text-ink-dim block font-medium">
                  Status
                  <select
                    value={stage}
                    onChange={e => setStage(e.target.value as 'planned' | 'supported')}
                    className="mt-1.5 w-full rounded-lg border border-line bg-bg-raised px-3 py-2 font-mono text-sm text-ink focus-visible:outline-accent"
                  >
                    <option value="supported">Supported (Occupied)</option>
                    <option value="planned">Planned (Under Construction)</option>
                  </select>
                </label>
              </div>

              <label className="font-sans text-xs text-ink-dim block font-medium">
                Evidence / Source Note *
                <input
                  required={stage === 'supported'}
                  maxLength={1000}
                  placeholder="e.g. Contractor final invoice & PMC occupancy certificate"
                  value={evidence}
                  onChange={e => setEvidence(e.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-line bg-bg-raised px-3 py-2 font-sans text-sm text-ink focus-visible:outline-accent"
                />
              </label>

              <label className="flex items-center gap-2.5 font-sans text-xs text-ink-dim cursor-pointer">
                <input
                  type="checkbox"
                  checked={sameScope}
                  onChange={e => setSameScope(e.target.checked)}
                  className="h-4 w-4 rounded accent-accent"
                />
                Baseline and actual costs share identical scope and price basis.
              </label>

              {formError && <p className="font-sans text-xs text-rose-700 font-semibold">{formError}</p>}

              <button
                type="submit"
                className="inline-flex min-h-[42px] items-center gap-2 rounded-lg bg-accent px-4 py-2 font-mono text-xs font-semibold uppercase tracking-wider text-white hover:bg-accent-hot cursor-pointer"
              >
                <Plus size={15} aria-hidden /> Add Record
              </button>
            </form>

            {/* Baseline vs Actual SvgBarCompare */}
            <div className="min-w-0">
              <SvgBarCompare
                title="Baseline vs Actual Construction Outlays"
                subtitle="Comparing initial quotes against completed pilot delivery outlays"
                groups={pilotCompareGroups}
                currentLabel="Baseline Quote"
                swappedLabel="Actual Outlay"
              />
            </div>
          </div>

          {/* Records Table */}
          <div className="mt-6 overflow-x-auto border-t border-line pt-5">
            <h4 className="font-display text-base font-semibold text-ink mb-3">
              Recorded Pilot Cohorts ({doc.pilots.length})
            </h4>

            {doc.pilots.length === 0 ? (
              <p className="py-6 text-center font-sans text-sm text-ink-dim">
                No pilot cohorts recorded yet. Add an anonymous household code above to begin logging field outcomes.
              </p>
            ) : (
              <table className="w-full text-left font-mono text-xs">
                <thead className="border-b border-line text-ink-dim uppercase">
                  <tr>
                    <th className="py-2.5 pr-4">Cohort</th>
                    <th className="py-2.5 pr-4">Date</th>
                    <th className="py-2.5 pr-4">Stage</th>
                    <th className="py-2.5 pr-4">Baseline</th>
                    <th className="py-2.5 pr-4">Actual</th>
                    <th className="py-2.5 pr-4">Water</th>
                    <th className="py-2.5 pr-4">Evidence</th>
                    <th className="py-2.5 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/60">
                  {doc.pilots.map(p => (
                    <tr key={p.id}>
                      <td className="py-3 pr-4 font-bold text-ink">{p.householdCode}</td>
                      <td className="py-3 pr-4 text-ink-dim">{p.date}</td>
                      <td className="py-3 pr-4 capitalize text-ink-dim">{p.stage}</td>
                      <td className="py-3 pr-4 text-ink-dim">{p.baselineCostInr ? fmt(p.baselineCostInr) : '—'}</td>
                      <td className="py-3 pr-4 text-emerald-800 font-bold">{p.actualCostInr ? fmt(p.actualCostInr) : '—'}</td>
                      <td className="py-3 pr-4 text-sky-800 font-medium">{p.measuredWaterL ? `${p.measuredWaterL.toLocaleString('en-IN')} L` : '—'}</td>
                      <td className="py-3 pr-4 text-ink-dim max-w-xs truncate">{p.evidence || '—'}</td>
                      <td className="py-3 text-right">
                        <button
                          type="button"
                          onClick={() => handleRemovePilot(p.id)}
                          className="text-rose-700 hover:text-rose-900 cursor-pointer p-1"
                          title="Remove record"
                        >
                          <Trash2 size={15} aria-hidden />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
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
            <span className="text-sm sm:text-base">Inputs & Standards Used (Community Scaling & PMAY-U 2.0)</span>
          </div>
          <span className="font-mono text-xs text-ink-dim">Standards: PMAY-U 2.0 Guidelines (MoHUA 2024)</span>
        </button>

        {assumptionsOpen && (
          <div className="border-t border-line p-5 font-sans text-sm text-ink-dim space-y-4">
            <div className="flex flex-wrap gap-2.5">
              <span className="rounded-md bg-bg-inset px-3 py-1.5 font-mono text-xs text-ink border border-line">
                BLC/AHP Limit: {pmayCheck.verticalCeilings.blcAhpCeilingM2} m² (min {pmayCheck.verticalCeilings.minCarpetAreaM2} m²)
              </span>
              <span className="rounded-md bg-bg-inset px-3 py-1.5 font-mono text-xs text-ink border border-line">
                ARH Limit: {pmayCheck.verticalCeilings.arhCeilingM2} m²
              </span>
              <span className="rounded-md bg-bg-inset px-3 py-1.5 font-mono text-xs text-ink border border-line">
                ISS Limit: {pmayCheck.verticalCeilings.issCeilingM2} m²
              </span>
              <span className="rounded-md bg-bg-inset px-3 py-1.5 font-mono text-xs text-ink border border-line">
                Income Bands: EWS ≤3L · LIG 3-6L · MIG 6-9L
              </span>
            </div>
            <p className="leading-relaxed">
              Carpet area ceilings are matched against Ministry of Housing and Urban Affairs (MoHUA) thresholds for
              interest subvention and direct beneficiary grants. Multi-unit clustering models linear unit economies plus shared civil infrastructure.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
