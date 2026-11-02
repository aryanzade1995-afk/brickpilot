import { useMemo } from 'react'

interface CarbonCategory {
  label: string
  kgCo2e: number
  color: string
  percentage: number
}

interface SvgCarbonDonutProps {
  items: CarbonCategory[]
  totalKg: number
}

export function SvgCarbonDonut({ items, totalKg }: SvgCarbonDonutProps) {
  const r = 50
  const circ = 2 * Math.PI * r

  const segments = useMemo(() => {
    let acc = 0
    return items.map(item => {
      const offset = acc
      acc += item.percentage
      return {
        ...item,
        dashArray: `${(item.percentage / 100) * circ} ${circ}`,
        dashOffset: -((offset / 100) * circ),
      }
    })
  }, [items, circ])

  return (
    <div className="flex flex-col rounded-xl border border-line bg-bg-raised p-5">
      <div className="mb-3">
        <h4 className="font-display text-lg font-medium text-ink">Embodied Carbon by Material Group</h4>
        <p className="font-sans text-xs text-ink-dim">
          Initial cradle-to-gate carbon footprint across architectural building components.
        </p>
      </div>

      <div className="flex flex-col items-center gap-6 sm:flex-row">
        {/* Donut SVG */}
        <div className="relative flex shrink-0 items-center justify-center">
          <svg
            width="150"
            height="150"
            viewBox="0 0 140 140"
            className="select-none"
            role="img"
            style={{ fontFamily: 'var(--font-sans), Inter, sans-serif' }}
            aria-label={`Embodied carbon donut chart totaling ${(totalKg / 1000).toFixed(1)} tonnes CO2e.`}
          >
            <title>Embodied Carbon Distribution</title>
            <desc>Donut chart visualizing percentage contribution of each material group to total carbon.</desc>

            {segments.map(item => (
              <circle
                key={item.label}
                cx="70"
                cy="70"
                r={r}
                fill="none"
                stroke={item.color}
                strokeWidth="18"
                strokeDasharray={item.dashArray}
                strokeDashoffset={item.dashOffset}
                transform="rotate(-90 70 70)"
              />
            ))}

            {/* Inner Center Label */}
            <text
              x="70"
              y="68"
              textAnchor="middle"
              className="fill-ink font-display text-xl font-bold tracking-tight"
            >
              {(totalKg / 1000).toFixed(1)}t
            </text>
            <text
              x="70"
              y="84"
              textAnchor="middle"
              className="fill-ink-dim font-mono text-[11px] font-semibold uppercase tracking-wider"
              style={{ fontFamily: 'var(--font-mono), monospace' }}
            >
              CO₂e Total
            </text>
          </svg>
        </div>

        {/* Legend List */}
        <div className="grid flex-1 grid-cols-1 gap-2.5 sm:grid-cols-2">
          {items.map(item => (
            <div key={item.label} className="flex items-center justify-between text-xs sm:text-sm">
              <div className="flex items-center gap-2 truncate">
                <span
                  className="h-3 w-3 shrink-0 rounded-sm"
                  style={{ backgroundColor: item.color }}
                />
                <span className="truncate font-sans text-ink font-medium">{item.label}</span>
              </div>
              <span className="font-mono text-xs font-semibold text-ink-dim pl-2 whitespace-nowrap">
                {item.percentage.toFixed(0)}% ({(item.kgCo2e / 1000).toFixed(1)}t)
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
