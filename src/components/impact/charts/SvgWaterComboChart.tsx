import type { MonthlyWaterData } from '@/lib/impact/analysis.ts'

interface SvgWaterComboChartProps {
  monthly: MonthlyWaterData[]
  tankCapacityL: number
  annualHarvestL: number
  tankerTripsSaved: number
  tankerSavingsInr: number
}

export function SvgWaterComboChart({
  monthly,
  tankCapacityL,
  annualHarvestL,
  tankerTripsSaved: _trips,
  tankerSavingsInr: _savings,
}: SvgWaterComboChartProps) {
  const maxL = Math.max(
    ...monthly.map(m => Math.max(m.harvestL, m.demandL, m.tankLevelL)),
    tankCapacityL,
    1000
  )

  // Chart dimensions
  const W = 680
  const H = 230
  const padL = 55
  const padR = 25
  const padT = 25
  const padB = 40
  const innerW = W - padL - padR
  const innerH = H - padT - padB

  const colW = (innerW / 12) * 0.55
  const stepX = innerW / 12

  const getY = (val: number) => padT + innerH - (val / maxL) * innerH

  // Build line path for tank level
  const tankPoints = monthly.map((m, i) => {
    const x = padL + i * stepX + stepX / 2
    const y = getY(m.tankLevelL)
    return `${x},${y}`
  })
  const tankLinePath = `M ${tankPoints.join(' L ')}`

  // Build line path for demand
  const demandPoints = monthly.map((m, i) => {
    const x = padL + i * stepX + stepX / 2
    const y = getY(m.demandL)
    return `${x},${y}`
  })
  const demandLinePath = `M ${demandPoints.join(' L ')}`

  const formatL = (n: number) =>
    n >= 1000 ? `${(n / 1000).toFixed(0)}k L` : `${n} L`

  return (
    <div className="flex flex-col rounded border border-line bg-bg-raised p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h4 className="font-display text-xl font-medium text-ink">Seasonal water balance</h4>
          <p className="font-sans text-xs text-ink-dim">
            Monthly rainwater harvested vs household domestic demand and cistern storage level.
          </p>
        </div>
        <div className="flex items-center gap-4 text-xs font-mono">
          <div className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-xs bg-[#7c8e9d]" />
            <span className="text-ink-dim">Rain Harvest</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-1 w-3.5 bg-[#a28d76] rounded-xs" />
            <span className="text-ink-dim">Demand</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-1 w-3.5 bg-[#677e74] rounded-xs" />
            <span className="text-ink font-medium">Tank Storage</span>
          </div>
        </div>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full select-none"
        role="img"
        style={{ fontFamily: 'var(--font-mono), IBM Plex Mono, monospace' }}
        aria-label={`12-month water balance combo chart showing annual harvest of ${new Intl.NumberFormat('en-IN').format(annualHarvestL)} L with monsoon peak in July and August.`}
      >
        <title>12-Month Rainwater Harvesting and Demand Balance</title>
        <desc>
          Monthly column and line comparison showing monsoon harvest exceeding demand in June through September, and dry-season reserve buffer.
        </desc>

        <defs>
          <linearGradient id="harvestBarGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#536a76" />
            <stop offset="100%" stopColor="#869faa" />
          </linearGradient>
        </defs>

        {/* Horizontal Gridlines */}
        {[0, 0.25, 0.5, 0.75, 1].map(frac => {
          const y = padT + innerH * (1 - frac)
          const val = maxL * frac
          return (
            <g key={frac}>
              <line
                x1={padL}
                y1={y}
                x2={W - padR}
                y2={y}
                stroke="#e5e7eb"
                strokeWidth="1"
                strokeDasharray="2,3"
              />
              <text
                x={padL - 8}
                y={y + 4}
                fill="#505050"
                fontSize="11"
                fontWeight="500"
                textAnchor="end"
              >
                {formatL(val)}
              </text>
            </g>
          )
        })}

        {/* Monthly Columns (Harvest) */}
        {monthly.map((m, i) => {
          const x = padL + i * stepX + (stepX - colW) / 2
          const y = getY(m.harvestL)
          const h = padT + innerH - y
          return (
            <rect
              key={m.month}
              x={x}
              y={y}
              width={colW}
              height={Math.max(1, h)}
              fill="url(#harvestBarGrad)"
              rx="3"
            />
          )
        })}

        {/* Tank Storage Line */}
        <path
          d={tankLinePath}
          fill="none"
          stroke="#405b52"
          strokeWidth="3"
          strokeLinecap="round"
        />

        {/* Monthly Demand Dashed Line */}
        <path
          d={demandLinePath}
          fill="none"
          stroke="#82715d"
          strokeWidth="2.5"
          strokeDasharray="5,4"
        />

        {/* Month Labels */}
        {monthly.map((m, i) => {
          const x = padL + i * stepX + stepX / 2
          const isMonsoon = ['Jun', 'Jul', 'Aug', 'Sep'].includes(m.month)
          return (
            <text
              key={m.month}
              x={x}
              y={H - 12}
              textAnchor="middle"
              fontSize="12"
              fill={isMonsoon ? '#445660' : '#171717'}
              fontWeight={isMonsoon ? 'bold' : 'normal'}
            >
              {m.month}
            </text>
          )
        })}
      </svg>
    </div>
  )
}
