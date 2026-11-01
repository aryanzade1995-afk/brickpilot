import { useState, type FC } from 'react'

export interface SvgThermalCutawayProps {
  roofAreaM2: number
  standardU?: number
  coolRoofU?: number
  deltaT?: number
  standardWatts?: number
  coolWatts?: number
  reductionWatts?: number
  reductionPercent?: number
  className?: string
}

export const SvgThermalCutaway: FC<SvgThermalCutawayProps> = ({
  roofAreaM2,
  standardU = 2.0,
  coolRoofU = 0.5,
  deltaT = 15,
  standardWatts: propStdWatts,
  coolWatts: propCoolWatts,
  reductionWatts: propReductionWatts,
  reductionPercent: propReductionPct,
  className = '',
}) => {
  const [mode, setMode] = useState<'standard' | 'cool'>('cool')

  const effectiveArea = Math.max(0, roofAreaM2)
  const standardWatts = propStdWatts ?? Math.round(effectiveArea * standardU * deltaT)
  const coolWatts = propCoolWatts ?? Math.round(effectiveArea * coolRoofU * deltaT)
  const reductionWatts = propReductionWatts ?? Math.max(0, standardWatts - coolWatts)
  const reductionPercent = propReductionPct ?? (standardWatts > 0 ? Math.round((reductionWatts / standardWatts) * 100) : 0)
  const activeWatts = mode === 'standard' ? standardWatts : coolWatts

  const isCool = mode === 'cool'
  const arrowColor = isCool ? '#059669' : '#d97706'

  const ariaSummary = `Roof thermal cutaway diagram: ${isCool ? 'Cool roof with high-SRI coating' : 'Standard uninsulated RCC slab'}. Conduction heat flow is ${activeWatts.toLocaleString('en-IN')} Watts at delta-T of ${deltaT}K across ${effectiveArea.toFixed(1)} m² roof. Cool roof reduces heat conduction by ${reductionWatts.toLocaleString('en-IN')} Watts (${reductionPercent}%).`

  return (
    <div className={`rounded-xl border border-line bg-bg-raised p-5 ${className}`}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <span className="font-mono text-xs uppercase tracking-wider text-ink-dim">BEE Eco-Niwas Samhita (ENS 2021) Table 3.1</span>
          <h3 className="font-display text-xl font-medium text-ink">Roof Thermal Cutaway (Watts Heat Ingress)</h3>
          <p className="font-sans text-xs text-ink-dim">Steady-state conduction: W = U × Area ({effectiveArea.toFixed(0)} m²) × ΔT ({deltaT} K)</p>
        </div>
        <div className="flex rounded-lg border border-line bg-bg-inset p-1 text-xs">
          <button
            type="button"
            onClick={() => setMode('standard')}
            className={`rounded-md px-3 py-1 font-mono font-medium transition-colors cursor-pointer ${
              !isCool ? 'bg-bg-raised text-ink shadow-xs' : 'text-ink-dim hover:text-ink'
            }`}
          >
            Standard RCC Slab (U={standardU.toFixed(1)})
          </button>
          <button
            type="button"
            onClick={() => setMode('cool')}
            className={`rounded-md px-3 py-1 font-mono font-medium transition-colors cursor-pointer ${
              isCool ? 'bg-emerald-700 text-white shadow-xs' : 'text-ink-dim hover:text-ink'
            }`}
          >
            Cool Roof (U={coolRoofU.toFixed(1)})
          </button>
        </div>
      </div>

      <div className="relative w-full overflow-hidden">
        <svg
          viewBox="0 0 540 270"
          role="img"
          aria-label={ariaSummary}
          className="h-auto w-full"
          style={{ fontFamily: 'var(--font-sans), Inter, sans-serif' }}
        >
          <desc>{ariaSummary}</desc>

          {/* Sky / Solar exposure background */}
          <rect x={0} y={0} width={540} height={70} fill={isCool ? '#eff6ff' : '#fffbeb'} />
          
          {/* Sun icon */}
          <circle cx={60} cy={35} r={18} fill="#f59e0b" />
          <path d="M60 10v6 M60 54v6 M35 35h6 M79 35h6 M42 17l4 4 M74 49l4 4 M42 53l4-4 M74 21l4-4" stroke="#f59e0b" strokeWidth={2} strokeLinecap="round" />
          <text x={95} y={40} className="fill-ink font-sans text-xs font-bold">
            Solar Thermal Ingress · ΔT = {deltaT} K Differential
          </text>

          {/* Roof Layers */}
          {/* Layer 1: Reflective coating (cool roof) or bare screed (standard) */}
          <rect
            x={20}
            y={70}
            width={500}
            height={20}
            fill={isCool ? '#059669' : '#9ca3af'}
          />
          <text
            x={30}
            y={84}
            className="fill-white font-mono text-[11px] font-bold"
            style={{ fontFamily: 'var(--font-mono), monospace' }}
          >
            {isCool ? `HIGH-SRI REFLECTIVE COATING (U = ${coolRoofU.toFixed(2)} W/m²K)` : `STANDARD CEMENT SCREED (U = ${standardU.toFixed(2)} W/m²K)`}
          </text>

          {/* Layer 2: Insulation (only on cool roof) */}
          {isCool && (
            <>
              <rect x={20} y={90} width={500} height={20} fill="#fde68a" stroke="#d97706" strokeWidth={0.5} strokeDasharray="3 3" />
              <text
                x={30}
                y={104}
                className="fill-amber-950 font-mono text-xs font-bold"
                style={{ fontFamily: 'var(--font-mono), monospace' }}
              >
                50mm XPS / MINERAL WOOL INSULATION
              </text>
            </>
          )}

          {/* Layer 3: RCC Structural Slab */}
          <rect
            x={20}
            y={isCool ? 110 : 90}
            width={500}
            height={isCool ? 40 : 58}
            fill="#4b5563"
          />
          <text
            x={30}
            y={isCool ? 134 : 124}
            className="fill-white font-mono text-[11px] font-bold tracking-wider"
            style={{ fontFamily: 'var(--font-mono), monospace' }}
          >
            150mm CAST-IN-PLACE RCC STRUCTURAL SLAB
          </text>

          {/* Interior Ceiling Space */}
          <rect x={20} y={150} width={500} height={100} fill={isCool ? '#f0fdf4' : '#fef2f2'} />

          {/* Heat Flow Transmission Arrows (Sized from W = U * A * DeltaT) */}
          <g transform="translate(180, 160)">
            <path
              d={isCool ? "M0,0 L0,35 M-5,28 L0,35 L5,28" : "M0,0 L0,45 M-10,35 L0,45 L10,35"}
              stroke={arrowColor}
              strokeWidth={isCool ? 2.5 : 5}
              fill="none"
              strokeLinecap="round"
            />
            <text
              x={isCool ? 14 : 20}
              y={24}
              className="font-mono text-xs font-bold"
              fill={arrowColor}
              style={{ fontFamily: 'var(--font-mono), monospace' }}
            >
              {activeWatts.toLocaleString('en-IN')} W Conduction
            </text>
          </g>

          <g transform="translate(360, 160)">
            <path
              d={isCool ? "M0,0 L0,35 M-5,28 L0,35 L5,28" : "M0,0 L0,45 M-10,35 L0,45 L10,35"}
              stroke={arrowColor}
              strokeWidth={isCool ? 2.5 : 5}
              fill="none"
              strokeLinecap="round"
            />
            <text
              x={isCool ? 14 : 20}
              y={24}
              className="font-mono text-xs font-bold"
              fill={arrowColor}
              style={{ fontFamily: 'var(--font-mono), monospace' }}
            >
              W = {isCool ? coolRoofU.toFixed(1) : standardU.toFixed(1)} × {effectiveArea.toFixed(0)}m² × {deltaT}K
            </text>
          </g>

          {/* Reduction Callout Badge */}
          <rect x={20} y={212} width={500} height={36} rx={6} fill={isCool ? '#dcfce7' : '#fee2e2'} stroke={isCool ? '#86efac' : '#fca5a5'} />
          <text x={35} y={235} className={`font-sans text-xs font-bold ${isCool ? 'fill-emerald-900' : 'fill-rose-900'}`}>
            {isCool
              ? `✓ Thermal Benefit: Reduces peak heat ingress by ${reductionWatts.toLocaleString('en-IN')} W (${reductionPercent}% cut vs uninsulated slab)`
              : `⚠ Baseline Ingress: ${standardWatts.toLocaleString('en-IN')} W transferred into habitable space through uninsulated slab`}
          </text>
        </svg>
      </div>
    </div>
  )
}
