/**
 * Decorative "study sheet" shown in the landing hero — mirrors the real
 * output: a site-summary panel, a schematic ground-floor plan, a feasibility
 * score and the drawing-set index. Static placeholder data for now.
 */

const DRAWING_SET = [
  ['Site plan', 'A-01'],
  ['Ground floor', 'A-02'],
  ['First floor', 'A-03'],
  ['Elevations', 'A-04'],
  ['Shadow diagrams', 'A-05'],
]

function Meter({ label, value, limit }: { label: string; value: number; limit: string }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between">
        <span className="label">{label}</span>
        <span className="font-mono text-xs text-ink-dim tnum">
          <span className="text-ink">{value}%</span> · {limit}
        </span>
      </div>
      <div className="h-px w-full bg-line-strong">
        <div className="h-px bg-accent" style={{ width: `${value}%` }} />
      </div>
    </div>
  )
}

export function HeroPreview() {
  return (
    <div className="relative">
      {/* stacked-paper shadow */}
      <div className="absolute -right-3 -top-3 h-full w-full rounded-[var(--radius-card)] border border-line" />
      <div className="absolute -right-1.5 -top-1.5 h-full w-full rounded-[var(--radius-card)] border border-line" />

      <div className="relative grid grid-cols-[1fr_1.15fr] gap-6 rounded-[var(--radius-card)] border border-line-strong bg-bg-raised/80 p-6 backdrop-blur-sm">
        {/* left: site summary */}
        <div className="space-y-5">
          <div className="label text-accent">Site summary</div>
          <div className="space-y-3">
            <Row k="Site area" v="650.0 m²" />
            <Row k="Zoning" v="GRZ1" />
          </div>
          <Meter label="Coverage" value={38} limit="max 40%" />
          <Meter label="Permeable" value={42} limit="min 30%" />
          <div className="space-y-2 pt-1">
            <Check label="Setbacks" />
            <Check label="Height limit" />
          </div>

          <div className="flex items-center gap-3 pt-2">
            <svg viewBox="0 0 40 40" className="h-11 w-11 -rotate-90">
              <circle cx="20" cy="20" r="17" fill="none" stroke="var(--color-line-strong)" strokeWidth="2" />
              <circle
                cx="20"
                cy="20"
                r="17"
                fill="none"
                stroke="var(--color-accent)"
                strokeWidth="2"
                strokeDasharray={`${2 * Math.PI * 17 * 0.86} ${2 * Math.PI * 17}`}
                strokeLinecap="round"
              />
            </svg>
            <div>
              <div className="font-display text-2xl leading-none">
                86<span className="text-ink-faint text-base">/100</span>
              </div>
              <div className="label mt-1">Feasibility</div>
            </div>
          </div>

          <div className="space-y-1.5 border-t border-line pt-4">
            <div className="label">Drawing set</div>
            {DRAWING_SET.map(([name, code], i) => (
              <div key={code} className="flex items-center justify-between">
                <span className={i === 1 ? 'text-sm text-ink' : 'text-sm text-ink-dim'}>{name}</span>
                <span className={i === 1 ? 'sheet-tag text-accent' : 'sheet-tag'}>{code}</span>
              </div>
            ))}
          </div>
        </div>

        {/* right: schematic plan */}
        <div className="flex flex-col">
          <div className="flex items-baseline justify-between">
            <span className="label">Ground floor plan</span>
            <span className="sheet-tag">Sheet A·02 — 1:100</span>
          </div>

          <div className="my-4 flex-1">
            <PlanSketch />
          </div>

          <div className="grid grid-cols-4 gap-3 border-t border-line pt-4">
            <Stat k="Built-up" v="247.5 m²" />
            <Stat k="Concept cost" v="₹44–51 L" />
            <Stat k="Drawn" v="A·02" />
            <Stat k="Scale" v="1:100" />
          </div>
        </div>
      </div>
    </div>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="label">{k}</span>
      <span className="font-mono text-xs text-ink tnum">{v}</span>
    </div>
  )
}

function Check({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="label">{label}</span>
      <span className="font-mono text-[0.7rem] uppercase tracking-[0.12em] text-ok">✓ OK</span>
    </div>
  )
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <div className="label mb-1 !text-[0.6rem]">{k}</div>
      <div className="font-mono text-[0.8rem] text-ink tnum">{v}</div>
    </div>
  )
}

function PlanSketch() {
  return (
    <svg viewBox="0 0 320 300" className="h-full w-full" role="img" aria-label="Schematic floor plan">
      <defs>
        <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
          <path d="M20 0H0V20" fill="none" stroke="var(--color-line)" strokeWidth="0.5" />
        </pattern>
      </defs>
      <rect x="0" y="0" width="320" height="300" fill="url(#grid)" />
      {/* plot boundary */}
      <rect x="24" y="20" width="272" height="260" fill="none" stroke="var(--color-accent-muted)" strokeWidth="1" strokeDasharray="3 3" />
      {/* building footprint */}
      <g stroke="var(--color-ink)" strokeWidth="1.5" fill="none">
        <path d="M60 70 H210 V120 H250 V210 H150 V250 H60 Z" />
        <path d="M60 120 H150" />
        <path d="M150 120 V210" />
        <path d="M150 160 H250" />
        <path d="M105 70 V120" />
      </g>
      {/* door swings */}
      <path d="M60 240 A14 14 0 0 1 74 254" fill="none" stroke="var(--color-ink-dim)" strokeWidth="1" />
      {/* room dots */}
      <g fill="var(--color-accent)">
        <circle cx="85" cy="95" r="1.5" />
        <circle cx="130" cy="165" r="1.5" />
        <circle cx="200" cy="185" r="1.5" />
      </g>
      {/* dimension line */}
      <g stroke="var(--color-ink-faint)" strokeWidth="0.75">
        <path d="M60 292 H210" />
        <path d="M60 288 V296 M210 288 V296" />
      </g>
      <text x="135" y="286" textAnchor="middle" className="fill-[var(--color-ink-faint)] font-mono" fontSize="7">
        18.20 M
      </text>
    </svg>
  )
}
