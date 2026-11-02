import { useState, type FC } from 'react'
import { Sun, Wind, ChevronDown, ChevronRight, Zap } from 'lucide-react'
import type { ImpactDocument } from '@/lib/impact/schema.ts'
import type { ImpactSummary } from '@/lib/impact/summary.ts'
import { SvgThermalCutaway } from './charts/SvgThermalCutaway.tsx'
import { SvgAreaLine } from './charts/SvgAreaLine.tsx'
import { NATIONAL_STANDARDS } from '@/lib/impact/data/nationalStandards.ts'
import { AssumptionBadge } from './AssumptionBadge.tsx'

export interface ClimateSolarPillarProps {
  summary: ImpactSummary['climate']
  doc: ImpactDocument
  onSaveDoc: (next: ImpactDocument) => void
}

const fmt = (n: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n)

export const ClimateSolarPillar: FC<ClimateSolarPillarProps> = ({
  summary,
  doc,
  onSaveDoc,
}) => {
  const [assumptionsOpen, setAssumptionsOpen] = useState(false)

  const {
    roofAreaM2,
    standardRoofU,
    coolRoofU,
    tempDeltaK,
    heatIngressStandardW,
    heatIngressCoolW,
    heatCutWatts,
    percentHeatReduction,
    ventilationRoutesCount,
    airPaths,
    solar,
  } = summary

  const handleUpdateClimate = (patch: Partial<ImpactDocument['climate']>) => {
    onSaveDoc({
      ...doc,
      climate: {
        ...doc.climate,
        ...patch,
        source: patch.source ?? doc.climate.source ?? 'BEE ENS 2021 Table 3.1',
      },
    })
  }

  // Cumulative cash flow curve points over 10 years from Single Source of Truth
  const cashFlowData = solar.cashFlow.map(cf => ({
    label: `Yr ${cf.year}`,
    value: cf.netCash,
  }))

  return (
    <div className="space-y-6">
      {/* Header Card */}
      <div className="rounded-xl border border-line bg-bg-raised p-5 sm:p-6 shadow-2xs">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <span className="font-mono text-xs uppercase tracking-wider text-ink-dim">Pillar 03 · Climate & Clean Energy</span>
            <h2 className="font-display text-2xl font-medium text-ink mt-1">Passive Cooling & Solar Rooftop Financials</h2>
            <p className="mt-1.5 font-sans text-sm text-ink-dim max-w-2xl leading-relaxed">
              Thermal envelope modeling per BEE Eco-Niwas Samhita (ENS 2021) and solar generation under PM Surya Ghar: Muft Bijli Yojana.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 border border-amber-300 px-3.5 py-1.5 font-mono text-xs font-semibold text-amber-900">
              <Sun size={14} aria-hidden /> PM Surya Ghar Scheme Verified
            </span>
          </div>
        </div>
      </div>

      {/* Hero 1: Roof Thermal Cutaway Diagram (Watts heat ingress) */}
      <SvgThermalCutaway
        roofAreaM2={roofAreaM2}
        standardU={standardRoofU}
        coolRoofU={coolRoofU}
        deltaT={tempDeltaK}
        standardWatts={heatIngressStandardW}
        coolWatts={heatIngressCoolW}
        reductionWatts={heatCutWatts}
        reductionPercent={percentHeatReduction}
      />

      {/* Section 2: Natural Ventilation Pathways */}
      <section aria-label="Natural cross ventilation review">
        <div className="rounded-xl border border-line bg-bg-raised p-5 sm:p-6 shadow-2xs">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
            <div>
              <span className="font-mono text-xs uppercase tracking-wider text-ink-dim">BEE ENS 2021 Part 2</span>
              <h3 className="font-display text-xl font-medium text-ink mt-0.5 flex items-center gap-2">
                <Wind size={20} className="text-sky-700" aria-hidden />
                Natural Cross-Ventilation Pathways
              </h3>
            </div>
            <span className="rounded-full border border-line bg-bg-inset px-3 py-1 font-mono text-xs text-ink-dim">
              {ventilationRoutesCount} Connected Opening Routes
            </span>
          </div>

          <div className="grid gap-4 sm:grid-cols-4">
            {airPaths.map(a => (
              <div key={a.from} className="rounded-xl border border-line bg-bg p-4 text-center">
                <span className="font-mono text-xs uppercase tracking-wider text-ink-dim">Wind Direction</span>
                <p className="mt-1.5 font-display text-xl font-semibold text-ink">{a.from}</p>
                <p className="mt-1 font-mono text-xs text-sky-800 font-semibold">
                  {a.paths.length} {a.paths.length === 1 ? 'pathway' : 'pathways'}
                </p>
              </div>
            ))}
          </div>

          <p className="mt-4 font-sans text-xs text-ink-dim leading-relaxed">
            *Opening-to-opening pathways assume operable windows. Operability, screening, and local micro-climates require site verification.
          </p>
        </div>
      </section>

      {/* Section 3: Solar Rooftop Yield & PM Surya Ghar */}
      <section aria-label="Solar rooftop generation and subsidy analysis">
        <div className="rounded-xl border border-line bg-bg-raised p-5 sm:p-6 shadow-2xs">
          <div className="flex flex-wrap items-center justify-between gap-4 mb-5">
            <div>
              <span className="font-mono text-xs uppercase tracking-wider text-ink-dim">MNRE Central Scheme 2024</span>
              <h3 className="font-display text-xl font-medium text-ink mt-0.5 flex items-center gap-2">
                <Zap size={20} className="text-amber-600" aria-hidden />
                PM Surya Ghar: Muft Bijli Yojana Financials
              </h3>
              <p className="mt-1.5 font-sans text-sm text-ink-dim max-w-3xl leading-relaxed">
                Statutory Central Financial Assistance (CFA) schedule: ₹30,000/kW for first 2 kW, ₹18,000 for 3rd kW, capped at ₹78,000 for ≥3 kW.
              </p>
            </div>
          </div>

          {/* 4 Stat Cards */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-6">
            <div className="rounded-xl border border-line bg-bg p-4 sm:p-5 flex flex-col justify-between">
              <div>
                <span className="font-mono text-xs uppercase tracking-wider text-ink-dim block">Array Sizing</span>
                <p className="mt-2 font-display text-3xl font-semibold tracking-tight text-ink">
                  {solar.solarCapacityKw} kWp
                </p>
              </div>
              <p className="mt-2 font-sans text-xs text-ink-dim">
                Requires ~{solar.usableRoofM2.toFixed(0)} m² shadow-free slab (70% terrace)
              </p>
            </div>

            <div className="rounded-xl border border-line bg-bg p-4 sm:p-5 flex flex-col justify-between">
              <div>
                <span className="font-mono text-xs uppercase tracking-wider text-ink-dim block">Annual Generation</span>
                <p className="mt-2 font-display text-3xl font-semibold tracking-tight text-ink">
                  {solar.annualGenerationKwh.toLocaleString('en-IN')} kWh
                </p>
              </div>
              <p className="mt-2 font-mono text-xs text-ink-dim">
                ~{Math.round(solar.annualGenerationKwh / 12)} units / month
              </p>
            </div>

            <div className="rounded-xl border border-line bg-bg p-4 sm:p-5 flex flex-col justify-between">
              <div>
                <span className="font-mono text-xs uppercase tracking-wider text-ink-dim block">Direct MNRE Subsidy</span>
                <p className="mt-2 font-display text-3xl font-semibold tracking-tight text-emerald-800">
                  {fmt(solar.pmSuryaGharSubsidyInr)}
                </p>
              </div>
              <p className="mt-2 font-mono text-xs text-ink-dim">
                Net Capex: {fmt(solar.netInvestmentInr)} (Gross: {fmt(solar.grossInstallationCostInr)})
              </p>
            </div>

            <div className="rounded-xl border border-line bg-bg p-4 sm:p-5 flex flex-col justify-between">
              <div>
                <span className="font-mono text-xs uppercase tracking-wider text-ink-dim block">Payback Period</span>
                <p className="mt-2 font-display text-3xl font-semibold tracking-tight text-ink">
                  {solar.paybackYears ? `${solar.paybackYears} Years` : 'N/A'}
                </p>
              </div>
              <p className="mt-2 font-mono text-xs text-ink-dim">
                Annual bill offset: ~{fmt(solar.annualElectricitySavingsInr)}/yr
              </p>
            </div>
          </div>

          {/* Two Distinct SVG Charts: 12-Month Generation Curve & Cumulative Cash Flow */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <SvgAreaLine
              title="12-Month Expected Solar Yield (kWh)"
              subtitle="Reflecting seasonal monsoon dip in July and peak insolation in March-May."
              data={solar.monthlyGeneration}
              unit="kWh"
              color="#f59e0b"
            />

            <SvgAreaLine
              title="10-Year Cumulative Cash Flow (INR)"
              subtitle="Break-even crossover marking full capital recovery under PM Surya Ghar."
              data={cashFlowData}
              unit="₹"
              showPaybackCross
              color="#059669"
              primaryLabel="Net Cash Flow (With Subsidy)"
            />
          </div>
        </div>
      </section>

      {/* Inputs & Assumptions Collapsible with Editable Values */}
      <div className="rounded-xl border border-line bg-bg-raised shadow-2xs">
        <button
          type="button"
          onClick={() => setAssumptionsOpen(!assumptionsOpen)}
          className="flex w-full items-center justify-between p-5 text-left font-sans font-semibold text-ink hover:bg-bg-inset transition-colors cursor-pointer"
          aria-expanded={assumptionsOpen}
        >
          <div className="flex items-center gap-2.5">
            {assumptionsOpen ? <ChevronDown className="h-4 w-4 text-ink-dim" /> : <ChevronRight className="h-4 w-4 text-ink-dim" />}
            <span className="text-sm sm:text-base">Inputs & Standards Used (Climate & Solar)</span>
          </div>
          <span className="font-mono text-xs text-ink-dim">Standards: ENS 2021 · MNRE 2024 · NISE</span>
        </button>

        {assumptionsOpen && (
          <div className="border-t border-line p-5 font-sans text-sm text-ink-dim space-y-4">
            <div className="flex flex-wrap gap-2.5">
              <span className="rounded-md bg-bg-inset px-3 py-1.5 font-mono text-xs text-ink border border-line">
                Envelope: BEE ENS 2021 Table 3.1 (Baseline Slab U={standardRoofU.toFixed(1)} W/m²K)
              </span>
              <span className="rounded-md bg-bg-inset px-3 py-1.5 font-mono text-xs text-ink border border-line">
                Solar Yield: NISE Composite ({NATIONAL_STANDARDS.solarAnnualKwhPerKwp.value} kWh/kWp/yr)
              </span>
              <span className="rounded-md bg-bg-inset px-3 py-1.5 font-mono text-xs text-ink border border-line">
                CFA Subsidy: PM Surya Ghar Schedule (₹30k / ₹60k / ₹78k max)
              </span>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 pt-2">
              <div className="rounded-xl border border-line bg-bg p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-sans font-semibold text-ink text-sm">Proposed Cool Roof U-Value</span>
                  <AssumptionBadge
                    label="Cool Roof U-Value"
                    value={`${coolRoofU} W/m²K`}
                    notes="Empirical modeling assumption for 50mm insulation + high-SRI coating, not a statutory code requirement."
                  />
                </div>
                <input
                  type="number"
                  step="0.05"
                  min="0.1"
                  max="3.0"
                  value={coolRoofU}
                  onChange={e => handleUpdateClimate({ proposedRoofU: Number(e.target.value) })}
                  className="w-full rounded-lg border border-line bg-bg-raised px-3.5 py-2 font-mono text-sm text-ink focus-visible:outline-accent"
                />
                <span className="font-sans text-xs text-ink-dim mt-1.5 block">Default: 0.50 W/m²K (Insulated Cool Roof)</span>
              </div>

              <div className="rounded-xl border border-line bg-bg p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-sans font-semibold text-ink text-sm">Temperature Differential (ΔT)</span>
                  <AssumptionBadge
                    label="Peak Delta T"
                    value={`${tempDeltaK} K`}
                    notes="Representative afternoon solar surface-to-indoor ambient temperature differential."
                  />
                </div>
                <input
                  type="number"
                  step="1"
                  min="5"
                  max="35"
                  value={tempDeltaK}
                  onChange={e => handleUpdateClimate({ temperatureDifferenceK: Number(e.target.value) })}
                  className="w-full rounded-lg border border-line bg-bg-raised px-3.5 py-2 font-mono text-sm text-ink focus-visible:outline-accent"
                />
                <span className="font-sans text-xs text-ink-dim mt-1.5 block">Default: 15 K (Afternoon Peak Direct Solar)</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
