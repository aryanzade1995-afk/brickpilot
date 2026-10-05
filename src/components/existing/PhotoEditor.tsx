import { useRef, useState } from 'react'
import { CONFIDENCE_FLOOR, type Calibration, type Detections, type Pt } from '@/lib/existing/types.ts'
import type { Tool } from '@/state/existing.ts'

const CORNER_LABELS = ['1 back-left', '2 back-right', '3 front-right', '4 front-left']

type Props = {
  imageUrl: string
  size: { w: number; h: number }
  detections: Detections
  mode: 'edit' | 'calibrate'
  tool: Tool
  beamFrom: string | null
  corners: Pt[]
  calibration: Calibration
  highlight?: string[]
  onAddColumn: (p: Pt) => void
  onAddFooting: (p: Pt) => void
  onMove: (id: string, p: Pt) => void
  onRemove: (id: string) => void
  onPickBeam: (id: string) => void
  onAddCorner: (p: Pt) => void
  onMoveCorner: (i: number, p: Pt) => void
  /** AI segmentation: a click on a column or footing is measured by the model */
  onSegment?: (kind: 'column' | 'footing', p: Pt) => void
  /** the outline of the last measured object */
  mask?: Pt[] | null
}

const tone = (conf: number, confirmed: boolean) =>
  confirmed || conf >= 0.8 ? '#2E7D32' : conf >= CONFIDENCE_FLOOR ? '#C77700' : '#B3261E'

/** The photo with its detections drawn on top. Everything is clickable and draggable so every detection can be corrected. */
export function PhotoEditor(p: Props) {
  const svg = useRef<SVGSVGElement>(null)
  const [drag, setDrag] = useState<{ kind: 'el' | 'corner'; id: string | number } | null>(null)
  const r = Math.max(7, Math.round(p.size.w / 90))

  const toImage = (e: { clientX: number; clientY: number }): Pt => {
    const box = svg.current!.getBoundingClientRect()
    return { x: Math.round(((e.clientX - box.left) / box.width) * p.size.w), y: Math.round(((e.clientY - box.top) / box.height) * p.size.h) }
  }
  const byId = new Map(p.detections.columns.map((c) => [c.id, c]))

  const background = (e: React.PointerEvent) => {
    if (drag) return
    const at = toImage(e)
    if (p.mode === 'calibrate') { p.onAddCorner(at); return }
    if (p.tool === 'column') p.onAddColumn(at)
    else if (p.tool === 'footing') p.onAddFooting(at)
    else if (p.tool === 'seg-column') p.onSegment?.('column', at)
    else if (p.tool === 'seg-footing') p.onSegment?.('footing', at)
  }
  const move = (e: React.PointerEvent) => {
    if (!drag) return
    const at = toImage(e)
    if (drag.kind === 'corner') p.onMoveCorner(drag.id as number, at)
    else p.onMove(drag.id as string, at)
  }
  const grab = (e: React.PointerEvent, id: string) => {
    e.stopPropagation()
    if (p.mode === 'calibrate') return
    if (p.tool === 'remove') { p.onRemove(id); return }
    if (p.tool === 'beam') { p.onPickBeam(id); return }
    if (p.tool === 'move') { (e.target as Element).setPointerCapture(e.pointerId); setDrag({ kind: 'el', id }) }
  }
  const poly = p.corners.length === 4 ? p.corners.map((c) => `${c.x},${c.y}`).join(' ') : ''

  return (
    <div className="relative select-none overflow-hidden border border-line-strong bg-bg-inset">
      <img src={p.imageUrl} alt="Site photo" className="block h-auto w-full" draggable={false} />
      <svg ref={svg} viewBox={`0 0 ${p.size.w} ${p.size.h}`} className="absolute inset-0 h-full w-full touch-none"
        style={{ cursor: p.mode === 'calibrate' ? (p.corners.length < 4 ? 'crosshair' : 'default') : p.tool === 'column' || p.tool === 'footing' || p.tool === 'seg-column' || p.tool === 'seg-footing' ? 'crosshair' : p.tool === 'remove' ? 'not-allowed' : 'default' }}
        onPointerDown={background} onPointerMove={move} onPointerUp={() => setDrag(null)} onPointerLeave={() => setDrag(null)}>
        {p.mask && p.mask.length > 2 && <polygon points={p.mask.map((q) => `${q.x},${q.y}`).join(' ')} fill="rgba(29,78,137,0.28)" stroke="#1D4E89" strokeWidth={Math.max(2, p.size.w / 400)} pointerEvents="none" />}
        {/* beams */}
        {p.detections.beams.map((b) => {
          const a = byId.get(b.a), c = byId.get(b.b)
          if (!a || !c) return null
          const ay = a.top?.y ?? a.img.y, cy = c.top?.y ?? c.img.y
          const lowest = Math.abs(a.img.y - c.img.y) < 1
          const y1 = lowest ? ay : ay, y2 = lowest ? cy : cy
          return (
            <g key={b.id} onPointerDown={(e) => { e.stopPropagation(); if (p.tool === 'remove' && p.mode === 'edit') p.onRemove(b.id) }}>
              <line x1={a.img.x} y1={y1} x2={c.img.x} y2={y2} stroke="#0B0B0B" strokeOpacity={0.12} strokeWidth={r * 2.4} />
              <line x1={a.img.x} y1={y1} x2={c.img.x} y2={y2} stroke={tone(b.confidence, b.confirmed)} strokeWidth={3}
                strokeDasharray={!b.confirmed && b.confidence < CONFIDENCE_FLOOR ? '8 6' : undefined} />
            </g>
          )
        })}
        {/* columns */}
        {p.detections.columns.map((c) => {
          const col = tone(c.confidence, c.confirmed), picked = p.beamFrom === c.id, glow = p.highlight?.includes(c.id)
          return (
            <g key={c.id} onPointerDown={(e) => grab(e, c.id)} style={{ cursor: p.tool === 'move' ? 'grab' : 'pointer' }}>
              {c.top && <line x1={c.img.x} y1={c.top.y} x2={c.img.x} y2={c.img.y} stroke={col} strokeOpacity={0.45} strokeWidth={Math.max(3, c.widthPx * 0.55)} />}
              <circle cx={c.img.x} cy={c.img.y} r={r + (picked || glow ? 4 : 0)} fill="#fff" fillOpacity={0.9} stroke={col} strokeWidth={3}
                strokeDasharray={!c.confirmed && c.confidence < CONFIDENCE_FLOOR ? '5 4' : undefined} />
              <text x={c.img.x} y={c.img.y + r * 0.4} textAnchor="middle" fontSize={r * 1.15} fontWeight={700} fill="#111">{c.id.replace('col-', '')}</text>
            </g>
          )
        })}
        {/* footings */}
        {p.detections.footings.map((f) => (
          <g key={f.id} onPointerDown={(e) => grab(e, f.id)} style={{ cursor: 'pointer' }}>
            <rect x={f.img.x - r} y={f.img.y - r} width={r * 2} height={r * 2} fill="#fff" fillOpacity={0.9} stroke={tone(f.confidence, f.confirmed)} strokeWidth={3} />
            <text x={f.img.x} y={f.img.y + r * 0.4} textAnchor="middle" fontSize={r} fontWeight={700} fill="#111">F</text>
          </g>
        ))}
        {/* calibration corners */}
        {p.mode === 'calibrate' && <>
          {poly && <polygon points={poly} fill="#1D4E89" fillOpacity={0.12} stroke="#1D4E89" strokeWidth={3} strokeDasharray="10 6" />}
          {p.corners.map((c, i) => (
            <g key={i} onPointerDown={(e) => { e.stopPropagation(); (e.target as Element).setPointerCapture(e.pointerId); setDrag({ kind: 'corner', id: i }) }} style={{ cursor: 'grab' }}>
              <circle cx={c.x} cy={c.y} r={r + 2} fill="#1D4E89" fillOpacity={0.85} stroke="#fff" strokeWidth={2} />
              <text x={c.x + r + 6} y={c.y - r} fontSize={r * 1.3} fontWeight={700} fill="#1D4E89" stroke="#fff" strokeWidth={4} paintOrder="stroke">{CORNER_LABELS[i]}</text>
            </g>
          ))}
        </>}
      </svg>
    </div>
  )
}
