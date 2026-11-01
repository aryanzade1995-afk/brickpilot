import type { FC } from 'react'

export interface SvgWaterfallBarProps {
  budget: number | null
  currentCost: number
  swappedCost: number
  totalSavings: number
  className?: string
}

const fmt = (n: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n)

export const SvgWaterfallBar: FC<SvgWaterfallBarProps> = ({
  budget,
  currentCost,
  swappedCost,
  totalSavings,
  className = '',
}) => {
  const effectiveBudget = budget ?? currentCost
  const maxVal = Math.max(effectiveBudget, currentCost, swappedCost, 1) * 1.25

  // Sizing
  const width = 640
  const height = 248
  const padX = 40
  const padTop = 46
  const padBottom = 54
  const chartH = height - padTop - padBottom
  const barW = 96
  const colGap = (width - padX * 2 - barW * 3) / 2

  const x0 = padX
  const x1 = padX + barW + colGap
  const x2 = padX + (barW + colGap) * 2

  const scaleY = (v: number) => chartH * (v / maxVal)
  const yBase = height - padBottom

  const hBudget = scaleY(effectiveBudget)
  const hCurrent = scaleY(currentCost)
  const hSwapped = scaleY(swappedCost)

  const isWithinBudget = swappedCost <= effectiveBudget
  const diffFromBudget = currentCost - effectiveBudget

  const ariaText = `Waterfall cost comparison: ${budget ? `Target budget ${fmt(effectiveBudget)}, ` : ''}Current BOQ estimate ${fmt(currentCost)}, After eco-swaps ${fmt(swappedCost)} with savings of ${fmt(totalSavings)}. ${isWithinBudget ? 'Within target budget.' : 'Over budget.'}`

  return (
    <div className={`rounded-xl border border-line bg-bg-raised p-5 ${className}`}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <span className="font-mono text-xs uppercase tracking-wider text-ink-dim">Cost Analysis</span>
          <h3 className="font-display text-xl font-medium text-ink">Budget & BOQ Waterfall</h3>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {budget !== null ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-bg-inset px-3 py-1 font-mono text-xs text-ink-dim">
              <span className="inline-block w-3.5 border-b-2 border-dashed border-ink-dim" />
              Target Cap: <strong className="text-ink font-semibold">{fmt(effectiveBudget)}</strong>
            </span>
          ) : (
            <span className="rounded-full border border-line bg-bg-inset px-3 py-1 font-mono text-xs text-ink-dim">
              No budget set (using BOQ baseline)
            </span>
          )}
          <span
            className={`rounded-full px-3 py-1 font-mono text-xs font-semibold ${
              isWithinBudget
                ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                : 'bg-amber-50 text-amber-900 border border-amber-200'
            }`}
          >
            {isWithinBudget ? '● Within Budget After Swaps' : `▲ Over Budget by ${fmt(swappedCost - effectiveBudget)}`}
          </span>
        </div>
      </div>

      <div className="relative w-full overflow-x-auto">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={ariaText}
          className="h-auto w-full min-w-[520px]"
          style={{ fontFamily: 'var(--font-sans), Inter, sans-serif' }}
        >
          <desc>{ariaText}</desc>

          {/* Grid baseline */}
          <line x1={padX} y1={yBase} x2={width - padX} y2={yBase} stroke="currentColor" strokeOpacity={0.25} strokeWidth={1.5} />
          
          {/* Target budget reference dashed line across the chart behind bars */}
          {budget !== null && (
            <line
              x1={padX}
              y1={yBase - hBudget}
              x2={width - padX}
              y2={yBase - hBudget}
              stroke="#64748b"
              strokeDasharray="4 4"
              strokeWidth={1.5}
            />
          )}

          {/* Bar 1: Budget Target */}
          <g>
            <rect
              x={x0}
              y={yBase - hBudget}
              width={barW}
              height={hBudget}
              rx={6}
              fill="#e5e7eb"
              stroke="#9ca3af"
              strokeWidth={1.5}
            />
            <text
              x={x0 + barW / 2}
              y={yBase - hBudget - 12}
              textAnchor="middle"
              className="fill-ink font-mono text-xs font-bold"
              style={{ fontFamily: 'var(--font-mono), monospace' }}
            >
              {fmt(effectiveBudget)}
            </text>
            <text x={x0 + barW / 2} y={yBase + 20} textAnchor="middle" className="fill-ink font-sans text-xs font-semibold">
              Target Budget
            </text>
            <text
              x={x0 + barW / 2}
              y={yBase + 36}
              textAnchor="middle"
              className="fill-ink-faint font-mono text-xs"
              style={{ fontFamily: 'var(--font-mono), monospace' }}
            >
              {budget ? 'User specified' : 'Baseline'}
            </text>
          </g>

          {/* Delta connector: Budget -> Current BOQ */}
          {budget !== null && (
            <g>
              <path
                d={`M ${x0 + barW + 4} ${yBase - hBudget} Q ${x0 + barW + colGap / 2} ${yBase - hBudget} ${x0 + barW + colGap / 2} ${(yBase - hBudget + (yBase - hCurrent)) / 2} T ${x1 - 4} ${yBase - hCurrent}`}
                fill="none"
                stroke={diffFromBudget > 0 ? '#d97706' : '#059669'}
                strokeWidth={2}
                strokeDasharray="3 3"
              />
              <rect
                x={x0 + barW + colGap / 2 - 38}
                y={(yBase - hBudget + (yBase - hCurrent)) / 2 - 12}
                width={76}
                height={24}
                rx={12}
                fill="#ffffff"
                stroke={diffFromBudget > 0 ? '#f59e0b' : '#10b981'}
                strokeWidth={1.5}
              />
              <text
                x={x0 + barW + colGap / 2}
                y={(yBase - hBudget + (yBase - hCurrent)) / 2 + 4}
                textAnchor="middle"
                className={`font-mono text-xs font-bold ${diffFromBudget > 0 ? 'fill-amber-800' : 'fill-emerald-800'}`}
                style={{ fontFamily: 'var(--font-mono), monospace' }}
              >
                {diffFromBudget > 0 ? `+${fmt(diffFromBudget)}` : fmt(diffFromBudget)}
              </text>
            </g>
          )}

          {/* Bar 2: Current BOQ Concept */}
          <g>
            <rect
              x={x1}
              y={yBase - hCurrent}
              width={barW}
              height={hCurrent}
              rx={6}
              fill="#222222"
            />
            <text
              x={x1 + barW / 2}
              y={yBase - hCurrent - 12}
              textAnchor="middle"
              className="fill-ink font-mono text-xs font-bold"
              style={{ fontFamily: 'var(--font-mono), monospace' }}
            >
              {fmt(currentCost)}
            </text>
            <text x={x1 + barW / 2} y={yBase + 20} textAnchor="middle" className="fill-ink font-sans text-xs font-semibold">
              Current BOQ
            </text>
            <text
              x={x1 + barW / 2}
              y={yBase + 36}
              textAnchor="middle"
              className="fill-ink-faint font-mono text-xs"
              style={{ fontFamily: 'var(--font-mono), monospace' }}
            >
              Catalog Estimate
            </text>
          </g>

          {/* Delta connector: Current BOQ -> Swapped BOQ */}
          {totalSavings > 0 && (
            <g>
              <path
                d={`M ${x1 + barW + 4} ${yBase - hCurrent} Q ${x1 + barW + colGap / 2} ${yBase - hCurrent} ${x1 + barW + colGap / 2} ${(yBase - hCurrent + (yBase - hSwapped)) / 2} T ${x2 - 4} ${yBase - hSwapped}`}
                fill="none"
                stroke="#059669"
                strokeWidth={2}
                strokeDasharray="3 3"
              />
              <rect
                x={x1 + barW + colGap / 2 - 44}
                y={(yBase - hCurrent + (yBase - hSwapped)) / 2 - 12}
                width={88}
                height={24}
                rx={12}
                fill="#ecfdf5"
                stroke="#059669"
                strokeWidth={1.5}
              />
              <text
                x={x1 + barW + colGap / 2}
                y={(yBase - hCurrent + (yBase - hSwapped)) / 2 + 4}
                textAnchor="middle"
                className="fill-emerald-800 font-mono text-xs font-bold"
                style={{ fontFamily: 'var(--font-mono), monospace' }}
              >
                -{fmt(totalSavings)}
              </text>
            </g>
          )}

          {/* Bar 3: Swapped BOQ */}
          <g>
            <rect
              x={x2}
              y={yBase - hSwapped}
              width={barW}
              height={hSwapped}
              rx={6}
              fill="#059669"
            />
            <text
              x={x2 + barW / 2}
              y={yBase - hSwapped - 12}
              textAnchor="middle"
              className="fill-emerald-800 font-mono text-xs font-bold"
              style={{ fontFamily: 'var(--font-mono), monospace' }}
            >
              {fmt(swappedCost)}
            </text>
            <text x={x2 + barW / 2} y={yBase + 20} textAnchor="middle" className="fill-ink font-sans text-xs font-semibold">
              After Swaps
            </text>
            <text
              x={x2 + barW / 2}
              y={yBase + 36}
              textAnchor="middle"
              className="fill-emerald-800 font-mono text-xs font-medium"
              style={{ fontFamily: 'var(--font-mono), monospace' }}
            >
              Saved {fmt(totalSavings)}
            </text>
          </g>
        </svg>
      </div>
    </div>
  )
}
