import type { FC } from 'react'

export interface SvgBarCompareGroup {
  label: string
  currentVal: number
  swappedVal: number
  unit: string
  isAssumption?: boolean
}

export interface SvgBarCompareProps {
  title: string
  subtitle?: string
  groups: SvgBarCompareGroup[]
  currentLabel?: string
  swappedLabel?: string
  className?: string
}

export const SvgBarCompare: FC<SvgBarCompareProps> = ({
  title,
  subtitle,
  groups,
  currentLabel = 'Current Spec',
  swappedLabel = 'Eco-Swapped',
  className = '',
}) => {
  const maxVal = Math.max(...groups.flatMap(g => [g.currentVal, g.swappedVal]), 1) * 1.15

  const width = 580
  const barH = 16
  const groupGap = 22
  const padLeft = 150
  const padRight = 60
  const padTop = 32
  const chartW = width - padLeft - padRight
  const height = padTop + groups.length * (barH * 2 + groupGap + 14) + 20

  const scaleX = (v: number) => chartW * (v / maxVal)

  const ariaSummary = `${title}: Comparing ${currentLabel} vs ${swappedLabel} across ${groups.map(g => `${g.label} (${g.currentVal} vs ${g.swappedVal} ${g.unit})`).join(', ')}.`

  return (
    <div className={`rounded-xl border border-line bg-bg-raised p-5 ${className}`}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <span className="font-mono text-xs uppercase tracking-wider text-ink-dim">Embodied Footprint</span>
          <h4 className="font-display text-xl font-medium text-ink">{title}</h4>
          {subtitle && <p className="mt-0.5 font-sans text-xs text-ink-dim">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-4 text-xs font-mono">
          <div className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-xs bg-[#222222]" />
            <span className="text-ink-dim">{currentLabel}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-xs bg-[#059669]" />
            <span className="text-emerald-800 font-semibold">{swappedLabel}</span>
          </div>
        </div>
      </div>

      <div className="w-full overflow-x-auto max-w-full">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={ariaSummary}
          className="h-auto w-full"
          style={{ fontFamily: 'var(--font-sans), Inter, sans-serif' }}
        >
          <desc>{ariaSummary}</desc>

          {groups.map((group, index) => {
            const y0 = padTop + index * (barH * 2 + groupGap + 14)
            const wCurrent = scaleX(group.currentVal)
            const wSwapped = scaleX(group.swappedVal)
            const diff = group.currentVal - group.swappedVal
            const pct = group.currentVal > 0 ? Math.round((diff / group.currentVal) * 100) : 0

            return (
              <g key={group.label} className="group">
                {/* Group label */}
                <text
                  x={padLeft - 12}
                  y={y0 + barH}
                  textAnchor="end"
                  className="fill-ink font-sans text-xs font-semibold"
                >
                  {group.label}
                </text>
                {group.isAssumption && (
                  <text
                    x={padLeft - 12}
                    y={y0 + barH * 2 + 8}
                    textAnchor="end"
                    className="fill-amber-800 font-mono text-xs font-semibold"
                    style={{ fontFamily: 'var(--font-mono), monospace' }}
                  >
                    *assumption
                  </text>
                )}

                {/* Baseline bar */}
                <rect
                  x={padLeft}
                  y={y0}
                  width={Math.max(2, wCurrent)}
                  height={barH}
                  rx={3}
                  fill="#222222"
                />
                <text
                  x={padLeft + Math.max(2, wCurrent) + 8}
                  y={y0 + barH - 3}
                  className="fill-ink font-mono text-[11px] font-medium"
                  style={{ fontFamily: 'var(--font-mono), monospace' }}
                >
                  {group.currentVal.toLocaleString('en-IN')} {group.unit}
                </text>

                {/* Swapped bar */}
                <rect
                  x={padLeft}
                  y={y0 + barH + 4}
                  width={Math.max(2, wSwapped)}
                  height={barH}
                  rx={3}
                  fill="#059669"
                />
                <text
                  x={padLeft + Math.max(2, wSwapped) + 8}
                  y={y0 + barH * 2 + 1}
                  className="fill-emerald-800 font-mono text-[11px] font-bold"
                  style={{ fontFamily: 'var(--font-mono), monospace' }}
                >
                  {group.swappedVal.toLocaleString('en-IN')} {group.unit}
                  {pct > 0 && ` (-${pct}%)`}
                </text>
              </g>
            )
          })}
        </svg>
      </div>
    </div>
  )
}
