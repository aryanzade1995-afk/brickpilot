import type { FC } from 'react'
import type { EntryRamp } from '@/lib/engine/entryRamp.ts'

export interface SvgRampElevationProps {
  ramp: EntryRamp | null
  className?: string
}

export const SvgRampElevation: FC<SvgRampElevationProps> = ({ ramp, className = '' }) => {
  if (!ramp) {
    return (
      <div className={`rounded-xl border border-dashed border-line bg-bg-inset p-6 text-center ${className}`}>
        <p className="font-display text-lg text-ink font-medium">No Entrance Ramp Configured</p>
        <p className="mt-1 font-sans text-xs text-ink-dim max-w-md mx-auto">
          The brief does not currently include a step-free entrance ramp. Wheelchair users and elderly residents may face stepped barriers at the main entry.
        </p>
        <span className="mt-3 inline-block rounded-full bg-amber-50 border border-amber-300 px-3 py-1 font-mono text-xs font-semibold text-amber-900">
          ● Review Site & Plinth Accessibility
        </span>
      </div>
    )
  }

  const { riseMm, gradientRatio, clearWidthMm } = ramp
  const passes1to12 = gradientRatio >= 12
  const runMm = riseMm * gradientRatio

  const width = 500
  const height = 190
  const padLeft = 60
  const padRight = 50
  const padTop = 32
  const padBottom = 42
  const drawW = width - padLeft - padRight
  const drawH = height - padTop - padBottom

  const x0 = padLeft
  const y0 = height - padBottom // Ground level at bottom of ramp
  const x1 = padLeft + drawW
  const y1 = height - padBottom - drawH // Plinth / landing level

  const ariaSummary = `Entry ramp elevation: Rise ${riseMm}mm, Slope 1:${gradientRatio}, Clear width ${clearWidthMm}mm. ${passes1to12 ? 'Passes' : 'Fails'} DEPwD 1:12 maximum gradient.`

  return (
    <div className={`rounded-xl border border-line bg-bg-raised p-5 ${className}`}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <span className="font-mono text-xs uppercase tracking-wider text-ink-dim">DEPwD 2021 & NBC 2016</span>
          <h4 className="font-display text-xl font-medium text-ink">Entrance Ramp Gradient Profile</h4>
        </div>
        <span
          className={`rounded-full px-3 py-1 font-mono text-xs font-semibold ${
            passes1to12
              ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
              : 'bg-rose-50 text-rose-800 border border-rose-200'
          }`}
        >
          {passes1to12 ? `● Pass (1:${gradientRatio} <= 1:12)` : `▲ Fail (1:${gradientRatio} > 1:12)`}
        </span>
      </div>

      <div className="w-full overflow-x-auto">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={ariaSummary}
          className="h-auto w-full min-w-[440px]"
          style={{ fontFamily: 'var(--font-mono), IBM Plex Mono, monospace' }}
        >
          <desc>{ariaSummary}</desc>

          {/* Ground surface */}
          <line x1={20} y1={y0} x2={width - 20} y2={y0} stroke="#9ca3af" strokeWidth={1.5} />
          <text x={25} y={y0 + 18} className="fill-ink-dim font-mono text-[11px]">
            Ground Grade (-{riseMm}mm)
          </text>

          {/* Plinth platform level */}
          <line x1={x1} y1={y1} x2={width - 20} y2={y1} stroke="#9ca3af" strokeWidth={1.5} strokeDasharray="3 3" />
          <rect x={x1} y={y1} width={width - 20 - x1} height={y0 - y1} fill="#e5e7eb" opacity={0.6} />
          <text x={width - 25} y={y1 - 8} textAnchor="end" className="fill-ink font-mono text-xs font-bold">
            Finished Plinth (+{riseMm}mm)
          </text>

          {/* Ramp triangle wedge */}
          <polygon
            points={`${x0},${y0} ${x1},${y1} ${x1},${y0}`}
            fill={passes1to12 ? '#d1fae5' : '#fee2e2'}
            stroke={passes1to12 ? '#059669' : '#e11d48'}
            strokeWidth={2}
          />

          {/* Handrail guideline */}
          <line
            x1={x0}
            y1={y0 - 24}
            x2={x1}
            y2={y1 - 24}
            stroke={passes1to12 ? '#059669' : '#e11d48'}
            strokeWidth={1.5}
            strokeDasharray="4 4"
          />
          <text x={(x0 + x1) / 2} y={(y0 + y1) / 2 - 30} textAnchor="middle" className="fill-ink-dim font-mono text-[11px] font-semibold">
            Dual Handrail (900mm)
          </text>

          {/* Dimension: Rise */}
          <line x1={x1 + 12} y1={y1} x2={x1 + 12} y2={y0} stroke="#4b5563" strokeWidth={1.5} />
          <text x={x1 + 18} y={(y0 + y1) / 2 + 4} className="fill-ink font-mono text-xs font-bold">
            {riseMm} mm Rise
          </text>

          {/* Dimension: Run length */}
          <line x1={x0} y1={y0 + 26} x2={x1} y2={y0 + 26} stroke="#4b5563" strokeWidth={1.5} />
          <text x={(x0 + x1) / 2} y={y0 + 40} textAnchor="middle" className="fill-ink font-mono text-xs font-medium">
            Run: {runMm.toLocaleString('en-IN')} mm · Clear Width: {clearWidthMm} mm
          </text>

          {/* Slope Badge Callout */}
          <g transform={`translate(${(x0 + x1) / 2 - 46}, ${(y0 + y1) / 2 - 10})`}>
            <rect width={92} height={24} rx={5} fill={passes1to12 ? '#059669' : '#e11d48'} />
            <text x={46} y={16} textAnchor="middle" className="fill-white font-mono text-xs font-bold">
              Slope 1:{gradientRatio}
            </text>
          </g>
        </svg>
      </div>
    </div>
  )
}
