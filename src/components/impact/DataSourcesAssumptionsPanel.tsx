import { useState } from 'react'
import { ChevronDown, ChevronRight, ShieldCheck, AlertTriangle, ExternalLink, MapPin, Building, Sun } from 'lucide-react'
import { NATIONAL_STANDARDS, RWH_CITY_THRESHOLDS, EMBODIED_CARBON_DEFAULTS } from '@/lib/impact/data/nationalStandards.ts'

export function DataSourcesAssumptionsPanel({ defaultOpen = false }: { defaultOpen?: boolean } = {}) {
  const [open, setOpen] = useState(() => defaultOpen || (typeof window !== 'undefined' && window.location.search.includes('sources')))

  const standardsList = [
    NATIONAL_STANDARDS.domesticLpcd,
    NATIONAL_STANDARDS.runoffCoefficientRcc,
    NATIONAL_STANDARDS.collectionFilterEfficiency,
    NATIONAL_STANDARDS.tankerRateInrPer5kL,
    NATIONAL_STANDARDS.accessibleDoorClearWidthMm,
    NATIONAL_STANDARDS.rampMaxGradientRatio,
    NATIONAL_STANDARDS.standardRoofUValue,
    NATIONAL_STANDARDS.coolRoofUValue,
    NATIONAL_STANDARDS.coolRoofTempDeltaK,
    NATIONAL_STANDARDS.solarAnnualKwhPerKwp,
    NATIONAL_STANDARDS.solarTurnkeyCostPerKw,
    NATIONAL_STANDARDS.electricityTariffInrPerKwh,
  ]

  const rwhCities = Object.values(RWH_CITY_THRESHOLDS)
  const carbonEntries = Object.entries(EMBODIED_CARBON_DEFAULTS)
  const pmay = NATIONAL_STANDARDS.pmayU2
  const solar = NATIONAL_STANDARDS.pmSuryaGhar

  return (
    <div id="datasources-panel" className="mt-8 rounded-xl border border-line bg-bg-raised shadow-2xs">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between p-5 text-left font-sans font-semibold text-ink hover:bg-bg-inset transition-colors cursor-pointer"
        aria-expanded={open}
      >
        <div className="flex items-center gap-2.5">
          {open ? <ChevronDown className="h-4 w-4 text-ink-dim" /> : <ChevronRight className="h-4 w-4 text-ink-dim" />}
          <span className="text-sm sm:text-base">Data Sources, Statutory Benchmarks & Modeling Assumptions</span>
        </div>
        <span className="font-mono text-xs text-ink-dim">
          Single Source of Truth ({standardsList.length + rwhCities.length + carbonEntries.length + 2} items)
        </span>
      </button>

      {open && (
        <div className="border-t border-line p-5 sm:p-6 flex flex-col gap-8">
          {/* Section 1: National & Statutory Standards */}
          <div>
            <h4 className="font-mono text-xs font-bold uppercase tracking-wider text-ink-dim mb-3 flex items-center gap-2">
              <ShieldCheck size={16} className="text-emerald-700" />
              National & Statutory Standards (NBC 2016, DEPwD 2021, ENS 2021)
            </h4>
            <div className="overflow-x-auto">
              <table className="w-full text-left font-sans text-xs sm:text-sm">
                <thead>
                  <tr className="border-b border-line text-ink-dim font-mono text-xs uppercase">
                    <th className="pb-2.5 font-medium">Benchmark</th>
                    <th className="pb-2.5 font-medium">Value</th>
                    <th className="pb-2.5 font-medium">Citation & Clause</th>
                    <th className="pb-2.5 font-medium">Verified On</th>
                    <th className="pb-2.5 font-medium text-right">Verification Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/60">
                  {standardsList.map(item => (
                    <tr key={item.label} className="py-3">
                      <td className="py-3 pr-4 font-semibold text-ink">
                        <div>{item.label}</div>
                        {item.notes && <div className="font-sans text-xs text-ink-dim font-normal mt-0.5">{item.notes}</div>}
                      </td>
                      <td className="py-3 pr-4 font-mono font-bold text-ink whitespace-nowrap">
                        {item.value} {item.unit}
                      </td>
                      <td className="py-3 pr-4 text-ink-dim max-w-xs font-sans text-xs">
                        <div>{item.source}</div>
                        {item.sourceUrl ? (
                          <a
                            href={item.sourceUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 font-mono text-xs text-sky-800 hover:underline mt-0.5"
                          >
                            <span>Official Source</span>
                            <ExternalLink size={11} />
                          </a>
                        ) : (
                          <span className="font-sans text-xs text-ink-faint italic mt-0.5 block">No official URL</span>
                        )}
                      </td>
                      <td className="py-3 pr-4 font-mono text-xs text-ink-dim whitespace-nowrap">
                        {item.verifiedOn}
                      </td>
                      <td className="py-3 text-right whitespace-nowrap">
                        {item.verified ? (
                          <span className="inline-flex items-center gap-1 rounded bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 font-mono text-xs font-semibold text-emerald-800">
                            <ShieldCheck className="h-3.5 w-3.5" />
                            Statutory Verified
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded bg-amber-50 border border-amber-300 px-2.5 py-0.5 font-mono text-xs font-semibold text-amber-900">
                            <AlertTriangle className="h-3.5 w-3.5" />
                            Assumption
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Section 2: Municipal RWH By-Law Thresholds */}
          <div>
            <h4 className="font-mono text-xs font-bold uppercase tracking-wider text-ink-dim mb-3 flex items-center gap-2">
              <MapPin size={16} className="text-sky-700" />
              Municipal Rainwater Harvesting By-Law Mandates (RWH_CITY_THRESHOLDS)
            </h4>
            <div className="overflow-x-auto">
              <table className="w-full text-left font-sans text-xs sm:text-sm">
                <thead>
                  <tr className="border-b border-line text-ink-dim font-mono text-xs uppercase">
                    <th className="pb-2.5 font-medium">City Jurisdiction</th>
                    <th className="pb-2.5 font-medium">Mandatory Threshold</th>
                    <th className="pb-2.5 font-medium">Municipal Act & Rule</th>
                    <th className="pb-2.5 font-medium">Source Document</th>
                    <th className="pb-2.5 font-medium text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/60">
                  {rwhCities.map(city => (
                    <tr key={city.city} className="py-3">
                      <td className="py-3 pr-4 font-bold text-ink">{city.city}</td>
                      <td className="py-3 pr-4 font-mono font-bold text-sky-800 whitespace-nowrap">
                        {city.plotThresholdM2 === 0
                          ? 'All Sites (≥0 m²)'
                          : `Plots ≥ ${city.plotThresholdM2} m²`}
                      </td>
                      <td className="py-3 pr-4 text-ink">
                        <div>{city.source}</div>
                        <div className="font-sans text-xs text-ink-dim mt-0.5">{city.notes}</div>
                      </td>
                      <td className="py-3 pr-4 text-ink-dim whitespace-nowrap font-sans text-xs">
                        {city.sourceUrl ? (
                          <a
                            href={city.sourceUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 font-mono text-xs text-sky-800 hover:underline"
                          >
                            <span>Municipal Portal</span>
                            <ExternalLink size={11} />
                          </a>
                        ) : (
                          <span className="text-ink-faint italic">No official URL</span>
                        )}
                      </td>
                      <td className="py-3 text-right whitespace-nowrap">
                        {city.verified ? (
                          <span className="inline-flex items-center gap-1 rounded bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 font-mono text-xs font-semibold text-emerald-800">
                            <ShieldCheck className="h-3.5 w-3.5" />
                            Verified
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded bg-amber-50 border border-amber-300 px-2.5 py-0.5 font-mono text-xs font-semibold text-amber-900">
                            <AlertTriangle className="h-3.5 w-3.5" />
                            Unverified
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                  <tr className="py-3 bg-bg-inset/50">
                    <td className="py-3 pr-4 font-semibold text-ink-dim italic">Unlisted Cities</td>
                    <td className="py-3 pr-4 font-mono text-ink-dim whitespace-nowrap">—</td>
                    <td className="py-3 pr-4 text-ink-dim italic">rule not loaded for this city</td>
                    <td className="py-3 pr-4 text-ink-dim italic">—</td>
                    <td className="py-3 text-right whitespace-nowrap">
                      <span className="inline-flex items-center gap-1 rounded bg-amber-50 border border-amber-300 px-2.5 py-0.5 font-mono text-xs font-semibold text-amber-900">
                        <AlertTriangle className="h-3.5 w-3.5" />
                        Unverified
                      </span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Section 3: PMAY-U 2.0 & PM Surya Ghar Schedules */}
          <div className="grid gap-6 lg:grid-cols-2">
            {/* PMAY-U 2.0 Scheme */}
            <div className="rounded-xl border border-line bg-bg p-5">
              <h4 className="font-display text-base font-semibold text-ink mb-2 flex items-center gap-2">
                <Building size={16} className="text-emerald-700" />
                PMAY-Urban 2.0 Statutory Parameters
              </h4>
              <p className="font-sans text-xs text-ink-dim mb-4">{pmay.source}</p>
              <div className="space-y-2.5 font-sans text-xs sm:text-sm">
                <div className="flex justify-between border-b border-line pb-2">
                  <span className="text-ink-dim">BLC / AHP Ceiling</span>
                  <span className="font-mono font-bold text-ink">{pmay.verticalCeilingsM2.blcAhpCeilingM2} m² (min {pmay.verticalCeilingsM2.minCarpetAreaM2} m²)</span>
                </div>
                <div className="flex justify-between border-b border-line pb-2">
                  <span className="text-ink-dim">ARH (Rental Housing) Ceiling</span>
                  <span className="font-mono font-bold text-ink">{pmay.verticalCeilingsM2.arhCeilingM2} m²</span>
                </div>
                <div className="flex justify-between border-b border-line pb-2">
                  <span className="text-ink-dim">ISS (Interest Subsidy) Ceiling</span>
                  <span className="font-mono font-bold text-ink">{pmay.verticalCeilingsM2.issCeilingM2} m²</span>
                </div>
                <div className="flex justify-between border-b border-line pb-2">
                  <span className="text-ink-dim">Income Bands</span>
                  <span className="font-mono text-ink">EWS ≤ 3L · LIG 3–6L · MIG 6–9L/yr</span>
                </div>
                <p className="pt-2 font-mono text-xs text-ink-dim">{pmay.legacyClssNote}</p>
              </div>
            </div>

            {/* PM Surya Ghar Muft Bijli Yojana */}
            <div className="rounded-xl border border-line bg-bg p-5">
              <h4 className="font-display text-base font-semibold text-ink mb-2 flex items-center gap-2">
                <Sun size={16} className="text-amber-600" />
                PM Surya Ghar CFA Subsidy Slabs
              </h4>
              <p className="font-sans text-xs text-ink-dim mb-4">{solar.source}</p>
              <div className="space-y-2.5 font-sans text-xs sm:text-sm">
                <div className="flex justify-between border-b border-line pb-2">
                  <span className="text-ink-dim">First 2 kW Capacity</span>
                  <span className="font-mono font-bold text-emerald-800">₹{solar.ratePerKwFirst2Kw.toLocaleString('en-IN')}/kW (₹60,000 max)</span>
                </div>
                <div className="flex justify-between border-b border-line pb-2">
                  <span className="text-ink-dim">3rd kW Capacity</span>
                  <span className="font-mono font-bold text-emerald-800">+₹{solar.ratePerKwThirdKw.toLocaleString('en-IN')}</span>
                </div>
                <div className="flex justify-between border-b border-line pb-2">
                  <span className="text-ink-dim">Maximum Central CFA Cap</span>
                  <span className="font-mono font-bold text-emerald-800">₹{solar.maxSubsidyCapInr.toLocaleString('en-IN')} (for ≥ 3 kW)</span>
                </div>
                <p className="pt-2 font-sans text-xs text-ink-dim">{solar.notes}</p>
              </div>
            </div>
          </div>

          {/* Section 4: Embodied Carbon Defaults */}
          <div>
            <h4 className="font-mono text-xs font-bold uppercase tracking-wider text-ink-dim mb-3">
              Embodied Carbon Material Defaults (Cradle-to-Gate kgCO₂e Factors · Assumptions)
            </h4>
            <div className="overflow-x-auto">
              <table className="w-full text-left font-sans text-xs sm:text-sm">
                <thead>
                  <tr className="border-b border-line text-ink-dim font-mono text-xs uppercase">
                    <th className="pb-2.5 font-medium">Material Group</th>
                    <th className="pb-2.5 font-medium">Carbon Factor</th>
                    <th className="pb-2.5 font-medium">Citation Source</th>
                    <th className="pb-2.5 font-medium">Verified On</th>
                    <th className="pb-2.5 font-medium text-right">Verification Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/60">
                  {carbonEntries.map(([key, item]) => (
                    <tr key={key} className="py-2.5">
                      <td className="py-2.5 pr-4 font-semibold text-ink capitalize">
                        {key.replace(/-/g, ' ')}
                      </td>
                      <td className="py-2.5 pr-4 font-mono font-bold text-ink whitespace-nowrap">
                        {item.factor} kgCO₂e / {item.unit}
                      </td>
                      <td className="py-2.5 pr-4 text-ink-dim font-sans text-xs">{item.source}</td>
                      <td className="py-2.5 pr-4 font-mono text-xs text-ink-dim whitespace-nowrap">{item.verifiedOn}</td>
                      <td className="py-2.5 text-right whitespace-nowrap">
                        <span className="inline-flex items-center gap-1 rounded bg-amber-50 border border-amber-300 px-2.5 py-0.5 font-mono text-xs font-semibold text-amber-900">
                          <AlertTriangle className="h-3.5 w-3.5" />
                          Assumption
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
