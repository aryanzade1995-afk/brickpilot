import type { Fixture } from '@/lib/utilities/plan.ts'
import type { PlacedRoom } from '@/lib/engine/types.ts'

export function PlanFixture({ fixture: f, room, scale }: { fixture: Fixture; room?: PlacedRoom; scale: number }) {
  let rot = 0
  if (room) {
    const r = room.rect
    const distLeft = Math.abs(f.position.x - r.x)
    const distRight = Math.abs(f.position.x - (r.x + r.w))
    const distTop = Math.abs(f.position.y - r.y)
    const distBottom = Math.abs(f.position.y - (r.y + r.h))
    const minDist = Math.min(distLeft, distRight, distTop, distBottom)
    if (minDist === distBottom) rot = 180
    else if (minDist === distRight) rot = 90
    else if (minDist === distLeft) rot = 270
    else rot = 0
  }

  const strokeColor = '#334155'
  const strokeW = 1.4 / scale
  const thinStrokeW = 1 / scale
  const thickStrokeW = 2 / scale

  if (f.type === 'toilet') {
    const w = Math.max(380, Math.min(f.width, 500))
    const d = Math.max(540, Math.max(f.depth, f.width))
    const tankH = d * 0.28, tankW = w * 0.95
    return (
      <g transform={`rotate(${rot})`} strokeLinecap="round" strokeLinejoin="round">
        {/* Cistern Tank */}
        <rect x={-tankW / 2} y={-d / 2} width={tankW} height={tankH} rx={18} fill="#f8fafc" stroke={strokeColor} strokeWidth={strokeW} />
        {/* Dual Flush Buttons */}
        <rect x={-w * 0.08} y={-d / 2 + tankH * 0.28} width={w * 0.16} height={tankH * 0.44} rx={6} fill="#e2e8f0" stroke="#64748b" strokeWidth={thinStrokeW} />
        <line x1={0} y1={-d / 2 + tankH * 0.28} x2={0} y2={-d / 2 + tankH * 0.72} stroke="#64748b" strokeWidth={thinStrokeW} />
        {/* Bowl Outer Contour */}
        <path d={`M ${-w * 0.44} ${-d / 2 + tankH} C ${-w * 0.44} ${d * 0.22}, ${-w * 0.36} ${d / 2}, 0 ${d / 2} C ${w * 0.36} ${d / 2}, ${w * 0.44} ${d * 0.22}, ${w * 0.44} ${-d / 2 + tankH} Z`} fill="#ffffff" stroke={strokeColor} strokeWidth={strokeW} strokeLinejoin="round" />
        {/* Inner Bowl Rim */}
        <ellipse cx={0} cy={d * 0.14} rx={w * 0.29} ry={d * 0.24} fill="#f1f5f9" stroke="#94a3b8" strokeWidth={thinStrokeW} />
        {/* Siphon Water Well */}
        <ellipse cx={0} cy={d * 0.22} rx={w * 0.14} ry={d * 0.11} fill="#e2e8f0" stroke="#94a3b8" strokeWidth={thinStrokeW} />
      </g>
    )
  }

  if (f.type === 'sink') {
    const w = f.width, d = f.depth
    const isKitchen = f.drainageKind === 'kitchen_sink'
    return (
      <g transform={`rotate(${rot})`} strokeLinecap="round" strokeLinejoin="round">
        {/* Outer Counter / Rim */}
        <rect x={-w / 2} y={-d / 2} width={w} height={d} rx={isKitchen ? 18 : 30} fill="#f8fafc" stroke={strokeColor} strokeWidth={strokeW} />
        {/* Inner Basin Bowl */}
        <rect x={-w * (isKitchen ? 0.42 : 0.38)} y={-d * (isKitchen ? 0.32 : 0.3)} width={w * (isKitchen ? 0.84 : 0.76)} height={d * (isKitchen ? 0.74 : 0.68)} rx={isKitchen ? 24 : d * 0.26} fill="#ffffff" stroke="#64748b" strokeWidth={strokeW} />
        {/* Drain Hole & Stainless Ring */}
        <circle cx={0} cy={d * 0.05} r={Math.min(w, d) * (isKitchen ? 0.09 : 0.08)} fill="#e2e8f0" stroke="#94a3b8" strokeWidth={thinStrokeW} />
        <circle cx={0} cy={d * 0.05} r={Math.min(w, d) * 0.025} fill="#64748b" stroke="none" />
        {/* Chrome Mixer Tap Base & Spout */}
        <rect x={-w * 0.07} y={-d / 2 + d * 0.04} width={w * 0.14} height={d * 0.1} rx={4} fill="#64748b" stroke="none" />
        <path d={`M 0 ${-d / 2 + d * 0.14} V ${-d / 2 + d * (isKitchen ? 0.28 : 0.26)}`} stroke={strokeColor} strokeWidth={thickStrokeW} strokeLinecap="round" />
        <circle cx={0} cy={-d / 2 + d * (isKitchen ? 0.28 : 0.26)} r={Math.min(w, d) * 0.03} fill="#0284c7" stroke="none" />
      </g>
    )
  }

  if (f.type === 'shower') {
    const w = f.width, d = f.depth
    return (
      <g transform={`rotate(${rot})`} strokeLinecap="round" strokeLinejoin="round">
        {/* Outer Shower Tray */}
        <rect x={-w / 2} y={-d / 2} width={w} height={d} rx={22} fill="#f8fafc" stroke={strokeColor} strokeWidth={strokeW} />
        {/* Inner Recessed Floor */}
        <rect x={-w * 0.44} y={-d * 0.44} width={w * 0.88} height={d * 0.88} rx={14} fill="#ffffff" stroke="#94a3b8" strokeWidth={thinStrokeW} />
        {/* Glass Screen / Threshold Line on Front */}
        <line x1={-w * 0.44} y1={d * 0.44} x2={w * 0.44} y2={d * 0.44} stroke="#0284c7" strokeWidth={3 / scale} strokeLinecap="square" />
        {/* Center Chrome Drain */}
        <circle cx={0} cy={0} r={Math.min(w, d) * 0.08} fill="#e2e8f0" stroke="#64748b" strokeWidth={thinStrokeW} />
        <circle cx={0} cy={0} r={Math.min(w, d) * 0.025} fill="#64748b" stroke="none" />
        {/* Overhead Rain Shower Rose & Supply Arm */}
        <circle cx={0} cy={-d * 0.18} r={Math.min(w, d) * 0.12} fill="none" stroke="#0284c7" strokeDasharray={`${4 / scale} ${4 / scale}`} strokeWidth={thinStrokeW} />
        <circle cx={0} cy={-d * 0.18} r={Math.min(w, d) * 0.03} fill="#0284c7" stroke="none" />
        <line x1={0} y1={-d * 0.44} x2={0} y2={-d * 0.18} stroke="#0284c7" strokeWidth={2 / scale} />
      </g>
    )
  }

  if (f.type === 'washing_machine') {
    const w = f.width, d = f.depth
    return (
      <g transform={`rotate(${rot})`} strokeLinecap="round" strokeLinejoin="round">
        {/* Machine Cabinet */}
        <rect x={-w / 2} y={-d / 2} width={w} height={d} rx={24} fill="#f8fafc" stroke={strokeColor} strokeWidth={strokeW} />
        {/* Control Console Bar */}
        <line x1={-w / 2} y1={-d / 2 + d * 0.16} x2={w / 2} y2={-d / 2 + d * 0.16} stroke="#94a3b8" strokeWidth={thinStrokeW} />
        {/* Rotary Dial & Detergent Drawer */}
        <circle cx={w * 0.12} cy={-d / 2 + d * 0.08} r={Math.min(w, d) * 0.045} fill="#e2e8f0" stroke="#64748b" strokeWidth={thinStrokeW} />
        <rect x={-w * 0.42} y={-d / 2 + d * 0.035} width={w * 0.22} height={d * 0.09} rx={4} fill="#ffffff" stroke="#94a3b8" strokeWidth={thinStrokeW} />
        {/* Front-Loading Glass Porthole Door */}
        <circle cx={0} cy={d * 0.08} r={Math.min(w, d) * 0.32} fill="#ffffff" stroke={strokeColor} strokeWidth={strokeW} />
        <circle cx={0} cy={d * 0.08} r={Math.min(w, d) * 0.24} fill="#f1f5f9" stroke="#94a3b8" strokeWidth={thinStrokeW} />
        <circle cx={0} cy={d * 0.08} r={Math.min(w, d) * 0.12} fill="#e2e8f0" stroke="#cbd5e1" strokeWidth={thinStrokeW} />
        <path d={`M ${w * 0.24} ${d * 0.04} A ${Math.min(w, d) * 0.28} ${Math.min(w, d) * 0.28} 0 0 1 ${w * 0.24} ${d * 0.12}`} fill="none" stroke={strokeColor} strokeWidth={2 / scale} strokeLinecap="round" />
      </g>
    )
  }

  if (f.type === 'floor_drain') {
    const s = Math.min(f.width, f.depth, 160)
    return (
      <g strokeLinecap="round" strokeLinejoin="round">
        {/* Square Flange */}
        <rect x={-s / 2} y={-s / 2} width={s} height={s} rx={14} fill="#f8fafc" stroke={strokeColor} strokeWidth={strokeW} />
        {/* Perforated Strainer */}
        <circle cx={0} cy={0} r={s * 0.38} fill="#ffffff" stroke="#64748b" strokeWidth={thinStrokeW} />
        <circle cx={0} cy={0} r={s * 0.24} fill="none" stroke="#94a3b8" strokeDasharray={`${3 / scale} ${3 / scale}`} strokeWidth={thinStrokeW} />
        <circle cx={0} cy={0} r={s * 0.08} fill="#64748b" stroke="none" />
      </g>
    )
  }

  if (f.type === 'bathtub') {
    const w = f.width, d = f.depth
    return (
      <g transform={`rotate(${rot})`} strokeLinecap="round" strokeLinejoin="round">
        {/* Outer Tub Rim */}
        <rect x={-w / 2} y={-d / 2} width={w} height={d} rx={28} fill="#f8fafc" stroke={strokeColor} strokeWidth={strokeW} />
        {/* Inner Contoured Basin */}
        <rect x={-w * 0.44} y={-d * 0.42} width={w * 0.88} height={d * 0.84} rx={w * 0.22} fill="#ffffff" stroke="#64748b" strokeWidth={thinStrokeW} />
        {/* Drain */}
        <circle cx={0} cy={d * 0.28} r={Math.min(w, d) * 0.05} fill="#e2e8f0" stroke="#64748b" strokeWidth={thinStrokeW} />
        {/* Faucet Spout */}
        <rect x={-w * 0.05} y={-d / 2 + d * 0.02} width={w * 0.1} height={d * 0.08} rx={3} fill="#64748b" stroke="none" />
        <path d={`M 0 ${-d / 2 + d * 0.1} V ${-d / 2 + d * 0.2}`} stroke={strokeColor} strokeWidth={thickStrokeW} strokeLinecap="round" />
      </g>
    )
  }

  // Fallback
  return (
    <rect x={-f.width / 2} y={-f.depth / 2} width={f.width} height={f.depth} rx={16} fill="#f8fafc" stroke={strokeColor} strokeWidth={strokeW} />
  )
}
