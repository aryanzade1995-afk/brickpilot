interface SvgHouseCrossSectionProps {
  roofAreaM2: number
  solarKw: number
  annualHarvestL: number
  annualHarvestCoverageDays: number
  tankAutonomyDisplay: string
  heatCutWatts: number
  hasCoolRoof: boolean
  hasRamp: boolean
  rampRatio?: number
  ventilationPathsCount: number
}

export function SvgHouseCrossSection({
  roofAreaM2,
  solarKw,
  annualHarvestL,
  annualHarvestCoverageDays,
  tankAutonomyDisplay,
  heatCutWatts,
  hasCoolRoof,
  hasRamp,
  rampRatio = 12,
  ventilationPathsCount,
}: SvgHouseCrossSectionProps) {
  const formattedHarvest = new Intl.NumberFormat('en-IN').format(annualHarvestL)
  const formattedArea = roofAreaM2 > 0 ? roofAreaM2.toFixed(0) : '0'

  return (
    <div className="relative w-full overflow-hidden rounded-xl border border-line bg-bg-raised p-5 shadow-2xs">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-emerald-600 animate-pulse" />
          <span className="font-mono text-xs font-semibold uppercase tracking-wider text-ink-dim">
            Live Passive Architectural Section
          </span>
        </div>
        <span className="rounded-full border border-emerald-300 bg-emerald-50 px-2.5 py-0.5 font-mono text-xs font-medium text-emerald-800">
          Integrated Systems
        </span>
      </div>

      <svg
        viewBox="0 0 800 360"
        className="h-auto w-full select-none"
        role="img"
        style={{ fontFamily: 'var(--font-sans), Inter, sans-serif' }}
        aria-label={`Illustrated architectural house cross section showing ${formattedArea} m² roof catchment, ${solarKw} kW solar array, rainwater downpipe leading to underground cistern covering ${annualHarvestCoverageDays} days demand, and entrance ramp.`}
      >
        <title>Architectural Cross-Section: Solar, Rainwater & Accessibility</title>
        <desc>
          A structural cross-section displaying solar radiation, rainwater catchment flow, cross ventilation, and step-free entrance.
        </desc>

        <defs>
          <linearGradient id="skyGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0284c7" stopOpacity="0.08" />
            <stop offset="100%" stopColor="#0284c7" stopOpacity="0.0" />
          </linearGradient>
          <linearGradient id="groundGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#78716c" stopOpacity="0.15" />
            <stop offset="100%" stopColor="#78716c" stopOpacity="0.4" />
          </linearGradient>
          <linearGradient id="solarRayGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.3" />
            <stop offset="100%" stopColor="#f59e0b" stopOpacity="0.0" />
          </linearGradient>
          <filter id="softGlow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>

        {/* --- SKY & HORIZON --- */}
        <rect x="0" y="0" width="800" height="260" fill="url(#skyGrad)" />
        <rect x="0" y="260" width="800" height="100" fill="url(#groundGrad)" />
        <line x1="0" y1="260" x2="800" y2="260" stroke="#78716c" strokeWidth="2" strokeDasharray="6,4" opacity="0.6" />

        {/* --- SUN & SOLAR RAYS --- */}
        <g transform="translate(130, 45)">
          <circle cx="0" cy="0" r="18" fill="#f59e0b" opacity="0.9" />
          <circle cx="0" cy="0" r="24" fill="none" stroke="#f59e0b" strokeWidth="1.5" strokeDasharray="3,3" opacity="0.5" />
          {/* Rays pointing to roof panels */}
          <polygon points="12,12 180,95 100,105" fill="url(#solarRayGrad)" />
          <polygon points="18,6 270,75 220,80" fill="url(#solarRayGrad)" />
        </g>

        {/* --- ARCHITECTURAL BUILDING MASS --- */}
        {/* Foundation & Plinth */}
        <rect x="180" y="240" width="460" height="20" fill="#a8a29e" opacity="0.7" rx="1" />
        <line x1="175" y1="260" x2="645" y2="260" stroke="#44403c" strokeWidth="3" />

        {/* Outer Shell Walls */}
        <rect x="200" y="90" width="420" height="150" fill="#fafaf9" stroke="#57534e" strokeWidth="2.5" />

        {/* Room Dividers / Cross Section Interior */}
        {/* Ground Floor Slab */}
        <rect x="200" y="234" width="420" height="8" fill="#d6d3d1" stroke="#78716c" strokeWidth="1" />
        {/* Interior Partition Wall */}
        <line x1="420" y1="90" x2="420" y2="234" stroke="#78716c" strokeWidth="2" strokeDasharray="4,2" />

        {/* Windows / Openings for cross ventilation */}
        <rect x="200" y="140" width="8" height="50" fill="#bae6fd" stroke="#0284c7" strokeWidth="1.5" />
        <rect x="612" y="130" width="8" height="50" fill="#bae6fd" stroke="#0284c7" strokeWidth="1.5" />

        {/* --- ROOF ASSEMBLY --- */}
        {/* Reinforced Concrete Roof Slab */}
        <rect
          x="190"
          y="80"
          width="440"
          height="12"
          fill={hasCoolRoof ? '#e0f2fe' : '#78716c'}
          stroke={hasCoolRoof ? '#0284c7' : '#44403c'}
          strokeWidth="2"
        />

        {/* Parapet Walls */}
        <rect x="190" y="65" width="10" height="17" fill="#78716c" stroke="#44403c" strokeWidth="1.5" />
        <rect x="620" y="65" width="10" height="17" fill="#78716c" stroke="#44403c" strokeWidth="1.5" />

        {/* Reflective Cool Roof Coating Layer */}
        {hasCoolRoof && (
          <line x1="200" y1="79" x2="620" y2="79" stroke="#0284c7" strokeWidth="3" />
        )}

        {/* Rooftop Solar Panels */}
        {solarKw > 0 && (
          <g transform="translate(230, 48)">
            {/* Struts */}
            <line x1="10" y1="32" x2="25" y2="12" stroke="#475569" strokeWidth="2" />
            <line x1="50" y1="32" x2="65" y2="12" stroke="#475569" strokeWidth="2" />
            <line x1="90" y1="32" x2="105" y2="12" stroke="#475569" strokeWidth="2" />
            {/* Panel modules angled at 15 deg */}
            <polygon points="5,20 120,5 118,2 3,17" fill="#1e293b" stroke="#0284c7" strokeWidth="1.5" />
            <line x1="32" y1="16" x2="30" y2="19" stroke="#38bdf8" strokeWidth="1" />
            <line x1="62" y1="12" x2="60" y2="15" stroke="#38bdf8" strokeWidth="1" />
            <line x1="92" y1="8" x2="90" y2="11" stroke="#38bdf8" strokeWidth="1" />
          </g>
        )}

        {/* --- RAINWATER DRAINAGE & UNDERGROUND CISTERN --- */}
        {/* Roof Downpipe (Gutters to Tank) */}
        <path d="M625,82 L640,82 L640,285 L690,285" fill="none" stroke="#0284c7" strokeWidth="4" strokeLinecap="round" />
        {/* Animated Rain Drops flowing in downpipe */}
        <circle cx="640" cy="120" r="3" fill="#38bdf8">
          <animate attributeName="cy" values="90;270" dur="2s" repeatCount="indefinite" />
        </circle>
        <circle cx="640" cy="180" r="3" fill="#38bdf8">
          <animate attributeName="cy" values="90;270" dur="2s" begin="0.8s" repeatCount="indefinite" />
        </circle>

        {/* Underground Cistern Tank */}
        <g transform="translate(680, 265)">
          <rect x="0" y="0" width="95" height="75" rx="6" fill="#f0f9ff" stroke="#0284c7" strokeWidth="2" />
          {/* Water level representation */}
          <rect x="4" y="24" width="87" height="47" rx="3" fill="#38bdf8" opacity="0.65" />
          <line x1="4" y1="24" x2="91" y2="24" stroke="#0284c7" strokeWidth="1.5" />
          {/* Cistern Label */}
          <text x="47" y="44" fill="#0369a1" fontSize="12" fontWeight="700" textAnchor="middle" style={{ fontFamily: 'var(--font-mono), monospace' }}>
            RWH TANK
          </text>
          <text x="47" y="58" fill="#0c4a6e" fontSize="11" fontWeight="600" textAnchor="middle" style={{ fontFamily: 'var(--font-mono), monospace' }}>
            {tankAutonomyDisplay}
          </text>
        </g>

        {/* --- ACCESSIBILITY ENTRY RAMP --- */}
        {hasRamp ? (
          <g transform="translate(110, 240)">
            {/* 1:12 Barrier-Free Ramp */}
            <polygon points="0,20 90,0 90,20" fill="#d1fae5" stroke="#059669" strokeWidth="2" />
            <line x1="0" y1="8" x2="90" y2="-12" stroke="#059669" strokeWidth="1.5" strokeDasharray="3,3" />
            <text x="30" y="16" fill="#065f46" fontSize="11" fontWeight="700" style={{ fontFamily: 'var(--font-mono), monospace' }}>
              1:{rampRatio} RAMP
            </text>
          </g>
        ) : (
          <g transform="translate(150, 240)">
            {/* Standard steps */}
            <rect x="0" y="10" width="20" height="10" fill="#d6d3d1" stroke="#78716c" />
            <rect x="20" y="0" width="20" height="20" fill="#d6d3d1" stroke="#78716c" />
          </g>
        )}

        {/* --- NATURAL CROSS-VENTILATION BREEZE LINES --- */}
        {ventilationPathsCount > 0 && (
          <g opacity="0.8">
            <path d="M160,180 C260,165 340,195 480,180 S580,170 650,185" fill="none" stroke="#38bdf8" strokeWidth="2" strokeDasharray="6,4">
              <animate attributeName="stroke-dashoffset" values="40;0" dur="3s" repeatCount="indefinite" />
            </path>
            <path d="M150,195 C250,180 330,210 470,195 S570,185 640,200" fill="none" stroke="#38bdf8" strokeWidth="1.5" strokeDasharray="4,4">
              <animate attributeName="stroke-dashoffset" values="32;0" dur="3s" repeatCount="indefinite" />
            </path>
          </g>
        )}

        {/* --- CALLOUT BADGES & LIVE DATA METRICS --- */}
        {/* Roof Catchment Badge */}
        <g transform="translate(450, 36)">
          <rect x="-75" y="-14" width="150" height="28" rx="6" fill="#ffffff" stroke="#0284c7" strokeWidth="1.5" filter="url(#softGlow)" />
          <text x="0" y="4" fill="#0369a1" fontSize="12" fontWeight="700" textAnchor="middle" style={{ fontFamily: 'var(--font-mono), monospace' }}>
            Catchment: {formattedArea} m²
          </text>
          <line x1="0" y1="14" x2="0" y2="44" stroke="#0284c7" strokeWidth="1.5" strokeDasharray="2,2" />
        </g>

        {/* Solar Generation Badge */}
        {solarKw > 0 && (
          <g transform="translate(230, 22)">
            <rect x="-60" y="-12" width="120" height="24" rx="5" fill="#ffffff" stroke="#f59e0b" strokeWidth="1.5" />
            <text x="0" y="4" fill="#9a3412" fontSize="11" fontWeight="700" textAnchor="middle" style={{ fontFamily: 'var(--font-mono), monospace' }}>
              Solar: {solarKw} kWp
            </text>
          </g>
        )}

        {/* Cistern Yield Badge */}
        <g transform="translate(710, 230)">
          <rect x="-80" y="-14" width="160" height="28" rx="6" fill="#ffffff" stroke="#0284c7" strokeWidth="1.5" filter="url(#softGlow)" />
          <text x="0" y="4" fill="#0369a1" fontSize="12" fontWeight="700" textAnchor="middle" style={{ fontFamily: 'var(--font-mono), monospace' }}>
            Harvest: {formattedHarvest} L/yr
          </text>
          <line x1="0" y1="14" x2="0" y2="35" stroke="#0284c7" strokeWidth="1.5" strokeDasharray="2,2" />
        </g>

        {/* Cool Roof Badge */}
        <g transform="translate(560, 68)">
          <rect
            x="-65"
            y="-12"
            width="130"
            height="24"
            rx="5"
            fill={hasCoolRoof ? '#e0f2fe' : '#f5f5f4'}
            stroke={hasCoolRoof ? '#0284c7' : '#a8a29e'}
            strokeWidth="1.5"
          />
          <text x="0" y="4" fill={hasCoolRoof ? '#0369a1' : '#44403c'} fontSize="11" fontWeight="700" textAnchor="middle" style={{ fontFamily: 'var(--font-mono), monospace' }}>
            {hasCoolRoof ? `Cool Roof (-${heatCutWatts}W)` : 'Standard Slab'}
          </text>
        </g>
      </svg>

      <p className="sr-only">
        Cross-section shows building systems: {formattedArea} square metre terrace catchment draining through downpipe to an underground rainwater cistern harvesting {formattedHarvest} litres annually (covers {annualHarvestCoverageDays} days demand; full tank: {tankAutonomyDisplay}). Roof has a {solarKw} kilowatt solar array and {hasCoolRoof ? `reflective cool roof coating cutting ${heatCutWatts} Watts heat ingress` : 'standard slab'}. Entrance has {hasRamp ? `an accessible 1:${rampRatio} ramp` : 'steps without ramp'}.
      </p>
    </div>
  )
}
