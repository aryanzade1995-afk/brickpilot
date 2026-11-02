import type { FC } from 'react'

export interface SvgAreaLinePoint {
  label: string
  value: number
  secondaryValue?: number
}

export interface SvgAreaLineProps {
  title: string
  subtitle?: string
  data: SvgAreaLinePoint[]
  unit?: string
  color?: string
  secondaryColor?: string
  secondaryLabel?: string
  primaryLabel?: string
  showPaybackCross?: boolean
  className?: string
}

export const SvgAreaLine: FC<SvgAreaLineProps> = ({
  title,
  subtitle,
  data,
  unit = 'kWh',
  color = '#2563eb',
  secondaryColor = '#6b7280',
  primaryLabel = 'With PM Surya Ghar Subsidy',
  secondaryLabel = 'Without Subsidy',
  showPaybackCross = false,
  className = '',
}) => {
  if (!data.length) return null

  const width = 580
  const height = 220
  const padLeft = 60
  const padRight = 30
  const padTop = 32
  const padBottom = 44
  const chartW = width - padLeft - padRight
  const chartH = height - padTop - padBottom

  const allVals = data.flatMap(d => (d.secondaryValue !== undefined ? [d.value, d.secondaryValue] : [d.value]))
  const minVal = Math.min(...allVals, 0)
  const maxVal = Math.max(...allVals, 1) * 1.15
  const range = maxVal - minVal

  const scaleX = (i: number) => padLeft + (i / (data.length - 1)) * chartW
  const scaleY = (v: number) => padTop + chartH - ((v - minVal) / (range || 1)) * chartH

  // Generate primary path
  const points = data.map((d, i) => `${scaleX(i)},${scaleY(d.value)}`).join(' ')
  const areaPath = `M ${scaleX(0)},${scaleY(0)} L ${points.split(' ').join(' L ')} L ${scaleX(data.length - 1)},${scaleY(0)} Z`
  const linePath = `M ${points.split(' ').join(' L ')}`

  // Generate secondary path if present
  const hasSecondary = data.some(d => d.secondaryValue !== undefined)
  const secPoints = hasSecondary ? data.map((d, i) => `${scaleX(i)},${scaleY(d.secondaryValue ?? 0)}`).join(' ') : ''
  const secLinePath = hasSecondary ? `M ${secPoints.split(' ').join(' L ')}` : ''

  // Zero line
  const yZero = scaleY(0)

  // Find payback crossover (first point >= 0)
  const paybackIndex = data.findIndex(d => d.value >= 0)
  const paybackPoint = paybackIndex >= 0 ? data[paybackIndex] : null

  const ariaSummary = `${title}: Chart showing ${data.length} points from ${data[0].label} to ${data[data.length - 1].label}. Range ${minVal} to ${maxVal} ${unit}.`

  return (
    <div className={`rounded-xl border border-line bg-bg-raised p-5 ${className}`}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <span className="font-mono text-xs uppercase tracking-wider text-ink-dim">Solar Projection</span>
          <h4 className="font-display text-xl font-medium text-ink">{title}</h4>
          {subtitle && <p className="font-sans text-xs text-ink-dim">{subtitle}</p>}
        </div>
        {hasSecondary && (
          <div className="flex items-center gap-4 text-xs font-mono">
            <div className="flex items-center gap-1.5">
              <span className="h-0.5 w-4" style={{ backgroundColor: color }} />
              <span className="text-ink font-semibold">{primaryLabel}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="h-0.5 w-4 border-t border-dashed" style={{ borderColor: secondaryColor }} />
              <span className="text-ink-dim">{secondaryLabel}</span>
            </div>
          </div>
        )}
      </div>

      <div className="w-full overflow-x-auto">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={ariaSummary}
          className="h-auto w-full min-w-[480px]"
          style={{ fontFamily: 'var(--font-mono), IBM Plex Mono, monospace' }}
        >
          <desc>{ariaSummary}</desc>

          {/* Zero baseline */}
          <line
            x1={padLeft}
            y1={yZero}
            x2={width - padRight}
            y2={yZero}
            stroke="#9ca3af"
            strokeWidth={1}
            strokeDasharray="2 2"
          />

          {/* Area under primary curve (if positive) */}
          {minVal >= 0 && (
            <path d={areaPath} fill={color} fillOpacity={0.12} />
          )}

          {/* Secondary line (without subsidy) */}
          {hasSecondary && (
            <path
              d={secLinePath}
              fill="none"
              stroke={secondaryColor}
              strokeWidth={1.5}
              strokeDasharray="4 3"
            />
          )}

          {/* Primary line */}
          <path
            d={linePath}
            fill="none"
            stroke={color}
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Data points */}
          {data.map((d, i) => (
            <circle
              key={d.label}
              cx={scaleX(i)}
              cy={scaleY(d.value)}
              r={3.5}
              fill="#ffffff"
              stroke={color}
              strokeWidth={2}
            />
          ))}

          {/* Payback marker if requested */}
          {showPaybackCross && paybackPoint && (
            <g transform={`translate(${scaleX(paybackIndex)}, ${scaleY(paybackPoint.value)})`}>
              <circle r={6} fill="#059669" fillOpacity={0.25} />
              <circle r={3} fill="#059669" />
              <rect x={-52} y={-26} width={104} height={20} rx={4} fill="#059669" />
              <text x={0} y={-12} textAnchor="middle" className="fill-white font-mono text-[11px] font-bold">
                Payback: {paybackPoint.label}
              </text>
            </g>
          )}

          {/* X Axis labels */}
          {data.map((d, i) => (
            <text
              key={d.label}
              x={scaleX(i)}
              y={height - padBottom + 20}
              textAnchor="middle"
              className="fill-ink-dim font-mono text-[11px] font-medium"
            >
              {d.label}
            </text>
          ))}

          {/* Y Axis min and max ticks */}
          <text
            x={padLeft - 8}
            y={padTop + 4}
            textAnchor="end"
            className="fill-ink-dim font-mono text-xs"
          >
            {maxVal >= 1000 ? `${(maxVal / 1000).toFixed(0)}k` : maxVal.toFixed(0)}
          </text>
          <text
            x={padLeft - 8}
            y={height - padBottom + 4}
            textAnchor="end"
            className="fill-ink-dim font-mono text-xs"
          >
            {minVal < 0 ? `${(minVal / 1000).toFixed(0)}k` : '0'}
          </text>
        </svg>
      </div>
    </div>
  )
}
