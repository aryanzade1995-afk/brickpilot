import type { FC } from 'react'

export interface SvgRadialGaugeProps {
  value: number
  max?: number
  label: string
  unit?: string
  sublabel?: string
  color?: string
  className?: string
}

export const SvgRadialGauge: FC<SvgRadialGaugeProps> = ({
  value,
  max = 120,
  label,
  unit = 'Days',
  sublabel,
  color = '#405b52',
  className = '',
}) => {
  const radius = 68
  const strokeWidth = 12
  const center = 90
  const width = 180
  const height = 155

  // Semicircle gauge: 180 degrees (-180 to 0)
  const clampedVal = Math.min(max, Math.max(0, value))
  const pct = clampedVal / max
  const arcLength = Math.PI * radius
  const strokeDashoffset = arcLength * (1 - pct)

  const ariaSummary = `${label}: ${value} ${unit} (of ${max} max scale). ${sublabel ?? ''}`

  return (
    <div className={`rounded border border-line bg-bg-raised p-5 text-center ${className}`}>
      <span className="font-mono text-xs uppercase tracking-wider text-ink-dim">Autonomy Index</span>
      <h4 className="font-display text-xl font-medium text-ink">{label}</h4>

      <div className="relative mx-auto mt-2 flex justify-center">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={ariaSummary}
          className="h-38 w-auto"
          style={{ fontFamily: 'var(--font-sans), Inter, sans-serif' }}
        >
          <desc>{ariaSummary}</desc>

          {/* Background track arc */}
          <path
            d={`M ${center - radius} ${center + 20} A ${radius} ${radius} 0 0 1 ${center + radius} ${center + 20}`}
            fill="none"
            stroke="#e5e7eb"
            strokeWidth={strokeWidth}
            strokeLinecap="round"
          />

          {/* Active progress arc */}
          <path
            d={`M ${center - radius} ${center + 20} A ${radius} ${radius} 0 0 1 ${center + radius} ${center + 20}`}
            fill="none"
            stroke={color}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={arcLength}
            strokeDashoffset={strokeDashoffset}
            className="transition-all duration-500 ease-out"
          />

          {/* Big Value Number in Centre */}
          <text
            x={center}
            y={center + 12}
            textAnchor="middle"
            className="fill-ink font-display text-4xl font-bold"
          >
            {value}
          </text>
          <text
            x={center}
            y={center + 32}
            textAnchor="middle"
            className="fill-ink-dim font-mono text-xs uppercase tracking-wider font-semibold"
            style={{ fontFamily: 'var(--font-mono), monospace' }}
          >
            {unit}
          </text>
        </svg>
      </div>

      {sublabel && (
        <p className="mt-1 font-mono text-xs text-ink-dim font-semibold">
          {sublabel}
        </p>
      )}
    </div>
  )
}
