interface SvgDumbbellCompareProps {
  baselineCost: number
  swappedCost: number
  baselineCarbonKg: number
  swappedCarbonKg: number
}

export function SvgDumbbellCompare({
  baselineCost,
  swappedCost,
  baselineCarbonKg,
  swappedCarbonKg,
}: SvgDumbbellCompareProps) {
  const costSaving = Math.max(0, baselineCost - swappedCost)
  const costSavingPct = baselineCost > 0 ? ((costSaving / baselineCost) * 100).toFixed(1) : '0'

  const carbonSaving = Math.max(0, baselineCarbonKg - swappedCarbonKg)
  const carbonSavingPct = baselineCarbonKg > 0 ? ((carbonSaving / baselineCarbonKg) * 100).toFixed(1) : '0'

  const money = (n: number) =>
    new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n)

  return (
    <div className="flex flex-col rounded-xl border border-line bg-bg-raised p-5">
      <div className="mb-4">
        <h4 className="font-display text-lg font-medium text-ink">Before & After Eco-Swaps Dumbbell</h4>
        <p className="font-sans text-xs text-ink-dim">
          Parallel reduction in total expenditure and embodied carbon impact.
        </p>
      </div>

      <div className="flex flex-col gap-6">
        {/* Cost Dumbbell Track */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between text-xs sm:text-sm">
            <span className="font-sans font-semibold text-ink">Total Construction Cost</span>
            <span className="font-mono font-bold text-emerald-800">
              -{costSavingPct}% ({money(costSaving)} saved)
            </span>
          </div>

          <svg
            viewBox="0 0 500 54"
            className="h-14 w-full select-none"
            role="img"
            style={{ fontFamily: 'var(--font-mono), IBM Plex Mono, monospace' }}
            aria-label={`Cost reduction from ${money(baselineCost)} to ${money(swappedCost)}.`}
          >
            {/* Connecting Track */}
            <line x1="80" y1="20" x2="420" y2="20" stroke="#e5e7eb" strokeWidth="6" strokeLinecap="round" />
            <line x1="140" y1="20" x2="420" y2="20" stroke="#059669" strokeWidth="6" strokeLinecap="round" />

            {/* Baseline Marker */}
            <circle cx="420" cy="20" r="9" fill="#1f2937" stroke="#ffffff" strokeWidth="2.5" />
            <text x="420" y="44" fontSize="12" fontWeight="600" textAnchor="middle" fill="#4b5563">
              {money(baselineCost)}
            </text>

            {/* Swapped Marker */}
            <circle cx="140" cy="20" r="9" fill="#059669" stroke="#ffffff" strokeWidth="2.5" />
            <text x="140" y="44" fontSize="12" fontWeight="700" textAnchor="middle" fill="#065f46">
              {money(swappedCost)}
            </text>
          </svg>
        </div>

        {/* Carbon Dumbbell Track */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between text-xs sm:text-sm">
            <span className="font-sans font-semibold text-ink">Embodied Carbon Footprint</span>
            <span className="font-mono font-bold text-emerald-800">
              -{carbonSavingPct}% ({(carbonSaving / 1000).toFixed(1)}t avoided)
            </span>
          </div>

          <svg
            viewBox="0 0 500 54"
            className="h-14 w-full select-none"
            role="img"
            style={{ fontFamily: 'var(--font-mono), IBM Plex Mono, monospace' }}
            aria-label={`Carbon reduction from ${(baselineCarbonKg / 1000).toFixed(1)}t to ${(swappedCarbonKg / 1000).toFixed(1)}t CO2e.`}
          >
            {/* Connecting Track */}
            <line x1="80" y1="20" x2="420" y2="20" stroke="#e5e7eb" strokeWidth="6" strokeLinecap="round" />
            <line x1="180" y1="20" x2="420" y2="20" stroke="#10b981" strokeWidth="6" strokeLinecap="round" />

            {/* Baseline Marker */}
            <circle cx="420" cy="20" r="9" fill="#4b5563" stroke="#ffffff" strokeWidth="2.5" />
            <text x="420" y="44" fontSize="12" fontWeight="600" textAnchor="middle" fill="#4b5563">
              {(baselineCarbonKg / 1000).toFixed(1)}t CO₂e
            </text>

            {/* Swapped Marker */}
            <circle cx="180" cy="20" r="9" fill="#10b981" stroke="#ffffff" strokeWidth="2.5" />
            <text x="180" y="44" fontSize="12" fontWeight="700" textAnchor="middle" fill="#065f46">
              {(swappedCarbonKg / 1000).toFixed(1)}t CO₂e
            </text>
          </svg>
        </div>
      </div>

      <p className="sr-only">
        Dumbbell comparison illustrates that 1-click eco-swaps reduce total expenditure by {money(costSaving)} ({costSavingPct}%)
        and avoid {(carbonSaving / 1000).toFixed(1)} tonnes of embodied carbon ({carbonSavingPct}%).
      </p>
    </div>
  )
}
