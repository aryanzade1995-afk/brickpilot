import type { Design } from '@/lib/engine/types.ts'
import type { MapElement } from '@/lib/existing/types.ts'
import type { ExistingFinding } from '@/lib/existing/validate.ts'

/* Existing structure = dark and locked. Proposed = blue. Optional = dashed. Conflict = red. */
const LOCKED = '#141414'
const PROPOSED = '#1D4E89'
const CONFLICT = '#C62828'
const ZONE: Record<string, string> = { social: '#F6E3BE', private: '#D3E3F2', service: '#CFE8D0', circulation: '#ECECEA', work: '#E8DAF2', sacred: '#F6D4D0', outdoor: '#E3EED5' }

type Props = {
  design?: Design
  level?: number
  /** the as-built map, drawn alone before a plan exists */
  elements?: MapElement[]
  findings?: ExistingFinding[]
  className?: string
}

export function PlanLegend() {
  const item = (label: string, el: React.ReactNode) => <span className="flex items-center gap-2">{el}<span>{label}</span></span>
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-2 font-mono text-[0.68rem] uppercase tracking-[0.08em] text-ink-dim">
      {item('Existing, locked', <span className="inline-block h-3 w-3" style={{ background: LOCKED }} />)}
      {item('Proposed', <span className="inline-block h-3 w-3" style={{ background: PROPOSED }} />)}
      {item('Optional', <span className="inline-block h-3 w-3 border border-dashed" style={{ borderColor: PROPOSED }} />)}
      {item('Conflict', <span className="inline-block h-3 w-3 rounded-full" style={{ background: CONFLICT }} />)}
    </div>
  )
}

export function PlanView({ design, level = 0, elements, findings = [], className }: Props) {
  const floor = design?.floors.find((f) => f.level === level)
  // world bounds
  let x0 = 0, y0 = 0, w = 1, h = 1
  if (design) {
    x0 = 0; y0 = 0; w = design.model.plot.width; h = design.model.plot.depth
  } else if (elements?.length) {
    const pts = elements.flatMap((e) => (e.kind === 'beam' || e.kind === 'wall' ? [e.a, e.b] : [e.at]))
    const minX = Math.min(...pts.map((p) => p.x)), maxX = Math.max(...pts.map((p) => p.x))
    const minY = Math.min(...pts.map((p) => p.y)), maxY = Math.max(...pts.map((p) => p.y))
    const pad = Math.max(maxX - minX, maxY - minY) * 0.12 + 400
    x0 = minX - pad; y0 = minY - pad; w = maxX - minX + 2 * pad; h = maxY - minY + 2 * pad
  }
  const unit = Math.max(w, h) / 1000   // 1 drawing unit ~ 0.1% of the larger side
  const labelSize = unit * 11

  return (
    <svg viewBox={`${x0} ${y0} ${w} ${h}`} className={className ?? 'h-auto w-full border border-line bg-bg'} role="img" aria-label="Plan with existing structure marked">
      {design && <>
        <rect x={0} y={0} width={w} height={h} fill="#F9F9F7" stroke="#8A8F96" strokeWidth={unit * 1.5} />
        <rect x={design.model.setbacksMm.W} y={design.model.setbacksMm.N} width={design.model.envelope.width} height={design.model.envelope.depth}
          fill="none" stroke="#E0873A" strokeWidth={unit * 1.4} strokeDasharray={`${unit * 8} ${unit * 5}`} />
        {level === 0 && design.siteFeatures?.map((f) => (
          <rect key={f.id} x={f.rect.x} y={f.rect.y} width={f.rect.w} height={f.rect.h} fill={f.kind === 'lawn' ? '#DCEBC9' : f.kind === 'pool' ? '#BFE0F0' : '#E4E4E1'} stroke="#C9CDD2" strokeWidth={unit * 0.6} />
        ))}
      </>}
      {floor?.rooms.map((r) => (
        <g key={r.id}>
          <rect x={r.rect.x} y={r.rect.y} width={r.rect.w} height={r.rect.h} fill={ZONE[r.outdoor ? 'outdoor' : r.zone] ?? '#EEE'}
            stroke={r.outdoor ? '#8A9A78' : '#5B6168'} strokeWidth={unit * (r.outdoor ? 0.8 : 1.1)} strokeDasharray={r.outdoor ? `${unit * 4} ${unit * 3}` : undefined} />
          {r.rect.w > 1500 && r.rect.h > 1100 && (
            <text x={r.rect.x + r.rect.w / 2} y={r.rect.y + r.rect.h / 2} textAnchor="middle" fontSize={labelSize} fill="#2A2D31">{r.name.split(' · ')[0]}</text>
          )}
        </g>
      ))}
      {floor?.openings.map((o, i) => {
        const half = o.width / 2, door = o.kind !== 'window'
        const col = door ? '#8B5A2B' : '#2F80ED'
        return o.orient === 'h'
          ? <line key={i} x1={o.at.x - half} y1={o.at.y} x2={o.at.x + half} y2={o.at.y} stroke={col} strokeWidth={unit * 3} />
          : <line key={i} x1={o.at.x} y1={o.at.y - half} x2={o.at.x} y2={o.at.y + half} stroke={col} strokeWidth={unit * 3} />
      })}
      {/* beams then columns, in their state colours */}
      {floor?.beams?.map((b) => (
        <line key={b.id} x1={b.a.x} y1={b.a.y} x2={b.b.x} y2={b.b.y} stroke={b.state === 'LOCKED' ? LOCKED : PROPOSED}
          strokeWidth={unit * (b.state === 'LOCKED' ? 3.2 : 2.2)} strokeDasharray={b.optional ? `${unit * 7} ${unit * 5}` : undefined} strokeOpacity={b.optional ? 0.8 : 1} />
      ))}
      {floor?.columns?.map((c) => (
        <rect key={c.id} x={c.at.x - c.size / 2} y={c.at.y - c.size / 2} width={c.size} height={c.size}
          fill={c.optional ? '#fff' : c.state === 'LOCKED' ? LOCKED : PROPOSED} stroke={c.state === 'LOCKED' ? LOCKED : PROPOSED}
          strokeWidth={unit * 1.6} strokeDasharray={c.optional ? `${unit * 3} ${unit * 2}` : undefined} />
      ))}
      {/* the as-built map on its own */}
      {!design && elements?.map((e) => {
        if (e.kind === 'beam') return <line key={e.id} x1={e.a.x} y1={e.a.y} x2={e.b.x} y2={e.b.y} stroke={LOCKED} strokeWidth={unit * 3.2} />
        if (e.kind === 'wall') return <line key={e.id} x1={e.a.x} y1={e.a.y} x2={e.b.x} y2={e.b.y} stroke={LOCKED} strokeWidth={unit * 5} strokeOpacity={0.7} />
        if (e.kind === 'footing') return <circle key={e.id} cx={e.at.x} cy={e.at.y} r={unit * 9} fill="#fff" stroke={LOCKED} strokeWidth={unit * 2} />
        const warn = !e.confirmed && e.confidence < 0.8
        return (
          <g key={e.id}>
            <rect x={e.at.x - e.size / 2} y={e.at.y - e.size / 2} width={e.size} height={e.size} fill={LOCKED} />
            {warn && <circle cx={e.at.x} cy={e.at.y} r={unit * 14} fill="none" stroke="#C77700" strokeWidth={unit * 1.5} strokeDasharray={`${unit * 3} ${unit * 2}`} />}
            <text x={e.at.x + unit * 14} y={e.at.y - unit * 12} fontSize={labelSize * 0.9} fill="#555">{e.id.replace('col-', 'C')}</text>
          </g>
        )
      })}
      {/* conflicts in red */}
      {findings.filter((f) => f.at && f.level === level && f.severity === 'error').map((f, i) => (
        <g key={i}>
          <circle cx={f.at!.x} cy={f.at!.y} r={unit * 15} fill={CONFLICT} fillOpacity={0.18} stroke={CONFLICT} strokeWidth={unit * 2.4} />
          <title>{f.message}</title>
        </g>
      ))}
    </svg>
  )
}
