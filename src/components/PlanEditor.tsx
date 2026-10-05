import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeftRight, Lock, LockOpen, Maximize2, Move, Plus, Redo2, RotateCcw, Trash2, Undo2, Wand2 } from 'lucide-react'
import type { Design } from '@/lib/engine/types.ts'
import { FloorDrawing } from '@/lib/draw/FloorDrawing.tsx'
import { DRAWING_PRESETS } from '@/lib/draw/layers.ts'
import { rectBottom, rectRight, type Rect } from '@/lib/geometry.ts'
import { boxNow, extractLayout, type LayoutDoc, type LayoutRoom, type Outline } from '@/lib/plan/layout.ts'
import * as Ops from '@/lib/plan/ops.ts'
import { ADDABLE_OUTDOOR, ADDABLE_TYPES, TYPE_SPEC, type RoomType } from '@/lib/plan/roomTypes.ts'
import { m, snapMm, sqm } from '@/lib/plan/rects.ts'
import { useStudio } from '@/state/studio.ts'
import { usePlanEdit } from '@/state/planEdit.ts'
import { cx } from '@/lib/cx.ts'
import { SITE_STYLE, siteName } from '@/lib/draw/siteStyle.ts'

/* The 2D plan, with every room as an object you can pick up. The drawing underneath is the normal
 * floor drawing; an overlay of the same size carries the rooms, handles and the vacant-space hatching. */

const PAD = { l: 3400, r: 1800, t: 1800, b: 3400 }
type Side = 'N' | 'S' | 'E' | 'W'
type Pt = { x: number; y: number }
type Drag = { kind: 'move'; id: string; from: Pt; rect: Rect } | { kind: 'resize'; id: string; side: Side; from: Pt; rect: Rect } | { kind: 'outline'; side: Side; from: Pt; rect: Rect }
  | { kind: 'fmove'; feature: string; from: Pt; rect: Rect } | { kind: 'fresize'; feature: string; side: Side; from: Pt; rect: Rect }

function sideRect(r: Rect, side: Side, dx: number, dy: number): Rect {
  const next = { ...r }
  if (side === 'E') next.w = r.w + dx
  if (side === 'W') { next.x = r.x + dx; next.w = r.w - dx }
  if (side === 'S') next.h = r.h + dy
  if (side === 'N') { next.y = r.y + dy; next.h = r.h - dy }
  return next
}

export function PlanEditor({ design }: { design: Design }) {
  const layoutNow = useStudio((s) => s.layout)
  const pinned = useStudio((s) => s.pinned)
  const existing = useStudio((s) => s.existing)
  const basePlan = useStudio((s) => s.basePlan)
  const { past, future, autoReplan, feedback } = usePlanEdit()
  const act = usePlanEdit.getState()
  /** resize with the plan checked: when the whole change breaks a rule, it goes as far as the plan stays valid */
  const fitRect = (from: Rect, to: Rect, apply: (r: Rect) => (l: LayoutDoc, p: Design) => Ops.OpResult) => {
    const e0 = [from.x, from.y, from.x + from.w, from.y + from.h], e1 = [to.x, to.y, to.x + to.w, to.y + to.h]
    const n = Math.max(1, Math.round(Math.max(...e0.map((v, i) => Math.abs(e1[i] - v))) / 100))
    act.fit((k) => {
      const [l, t, r, b] = e0.map((v, i) => snapMm(v + ((e1[i] - v) * k) / n))
      return apply({ x: l, y: t, w: r - l, h: b - t })
    }, n)
  }
  const resizeTo = (id: string, from: Rect, to: Rect) => fitRect(from, to, (g) => (l, p) => Ops.resizeRoom(l, p, floor.level, id, g))
  const moveWall = (side: Side, delta: number) => act.fit((k) => (l, p) => Ops.resizeOutline(l, p, side, Math.sign(delta) * k * 100), Math.abs(delta) / 100)

  const layout = useMemo(() => layoutNow ?? extractLayout(basePlan() ?? design), [layoutNow, basePlan, design])
  const [level, setLevel] = useState(design.floors[0].level)
  const [selected, setSelected] = useState<string | null>(null)
  // the room waiting to be swapped, which may be on another floor: pick it, switch floor, pick the other
  const [swapFrom, setSwapFrom] = useState<{ level: number; id: string; name: string } | null>(null)
  const swapping = !!swapFrom
  const setSwapping = (on: boolean | ((v: boolean) => boolean)) => { const want = typeof on === 'function' ? on(!!swapFrom) : on; setSwapFrom(want && room ? { level: floor.level, id: room.id, name: room.name } : null) }
  const [pad, setPad] = useState<'move' | 'resize' | null>(null)
  const [step, setStep] = useState(300)
  const [wallStep, setWallStep] = useState(600)
  // a site feature (driveway, yard, pool, sit-out) picked on the plan
  const [feat, setFeat] = useState<string | null>(null)
  const siteParts = (design.siteFeatures ?? []).filter((f) => Ops.EDITABLE_FEATURES.includes(f.kind) && !f.roomId)
  const [drag, setDrag] = useState<Drag | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  const base = useMemo(() => basePlan() ?? design, [basePlan, design])
  const box = boxNow(base, layout.outline)
  const limits = useMemo(() => Ops.outlineLimits(layout, base), [layout, base])
  const floor = design.floors.find((f) => f.level === level) ?? design.floors[0]
  const rooms = Ops.floorOf(layout, floor.level)?.rooms ?? []
  const room = rooms.find((r) => r.id === selected) ?? null
  const vacants = rooms.filter(Ops.isVacant)
  const unaccepted = vacants.filter((v) => !v.accepted)

  // undo history belongs to one design: choosing another direction or structure starts it afresh
  const seen = useRef(false)
  useEffect(() => { if (!seen.current) { seen.current = true; return } usePlanEdit.getState().forget() }, [pinned, existing])

  const W = design.model.plot.width + PAD.l + PAD.r, H = design.model.plot.depth + PAD.t + PAD.b
  const hs = W / 70

  const toPlan = (e: { clientX: number; clientY: number }) => {
    const svg = svgRef.current!
    const pt = svg.createSVGPoint()
    pt.x = e.clientX; pt.y = e.clientY
    const p = pt.matrixTransform(svg.getScreenCTM()!.inverse())
    return { x: p.x, y: p.y }
  }

  const fixedReason = (r: LayoutRoom) => (r.locked ? 'Locked.' : r.fixed ? 'The hall, stair and lift can be changed too. The plan is checked after every change, and a change that breaks access or the stair is refused.' : '')
  const canEdit = (r: LayoutRoom | null) => !!r && !r.locked && !Ops.isVacant(r)

  const down = (e: React.PointerEvent, r: LayoutRoom) => {
    e.stopPropagation()
    setFeat(null)
    if (swapFrom && !(swapFrom.level === floor.level && swapFrom.id === r.id)) {
      const from = swapFrom
      act.run((l, p) => Ops.swapAcrossFloors(l, p, from.level, from.id, floor.level, r.id))
      setSwapFrom(null)
      return
    }
    setSelected(r.id)
    if (!canEdit(r)) return
    ;svgRef.current?.setPointerCapture?.(e.pointerId)
    setDrag({ kind: 'move', id: r.id, from: toPlan(e), rect: r.rect })
  }
  const downHandle = (e: React.PointerEvent, r: LayoutRoom, side: Side) => {
    e.stopPropagation()
    ;svgRef.current?.setPointerCapture?.(e.pointerId)
    setDrag({ kind: 'resize', id: r.id, side, from: toPlan(e), rect: r.rect })
  }
  const downOutline = (e: React.PointerEvent, side: Side) => {
    e.stopPropagation()
    svgRef.current?.setPointerCapture?.(e.pointerId)
    setDrag({ kind: 'outline', side, from: toPlan(e), rect: box })
  }
  const startFeature = (e: React.PointerEvent, kind: string, rect: Rect, side?: Side) => {
    e.stopPropagation()
    setSelected(null); setFeat(kind)
    svgRef.current?.setPointerCapture?.(e.pointerId)
    setDrag(side ? { kind: 'fresize', feature: kind, side, from: toPlan(e), rect } : { kind: 'fmove', feature: kind, from: toPlan(e), rect })
  }
  const [ghost, setGhost] = useState<Rect | null>(null)
  // the room under the pointer while a room is dragged: dropping on it swaps the two
  const [dropOn, setDropOn] = useState<LayoutRoom | null>(null)
  const move = (e: React.PointerEvent) => {
    if (!drag) return
    const p = toPlan(e), dx = p.x - drag.from.x, dy = p.y - drag.from.y
    const moving = drag.kind === 'move' || drag.kind === 'fmove'
    setGhost(moving ? { ...drag.rect, x: snapMm(drag.rect.x + dx), y: snapMm(drag.rect.y + dy) } : sideRect(drag.rect, drag.side, snapMm(dx), snapMm(dy)))
    if (drag.kind === 'move') {
      const self = rooms.find((r) => r.id === drag.id)
      const under = rooms.find((r) => r !== self && !!self && !!r.outdoor === !!self.outdoor && p.x >= r.rect.x && p.x <= rectRight(r.rect) && p.y >= r.rect.y && p.y <= rectBottom(r.rect))
      setDropOn(under ?? null)
    }
  }
  const up = () => {
    const d = drag, g = ghost, target = dropOn
    setDrag(null); setGhost(null); setDropOn(null)
    if (!d || !g || (g.x === d.rect.x && g.y === d.rect.y && g.w === d.rect.w && g.h === d.rect.h)) return
    if (d.kind === 'fresize') fitRect(d.rect, g, (q) => (l, p) => Ops.setFeature(l, p, d.feature as never, q))
    else if (d.kind === 'fmove') act.run((l, p) => Ops.setFeature(l, p, d.feature as never, g))
    else if (d.kind === 'move' && target) act.run((l, p) => Ops.swapRooms(l, p, floor.level, d.id, target.id))
    else if (d.kind === 'move') act.run((l, p) => Ops.moveRoom(l, p, floor.level, d.id, { x: g.x, y: g.y }))
    else if (d.kind === 'outline') {
      const delta = d.side === 'E' ? g.w - d.rect.w : d.side === 'S' ? g.h - d.rect.h : d.side === 'W' ? d.rect.x - g.x : d.rect.y - g.y
      moveWall(d.side, delta)
    } else resizeTo(d.id, d.rect, g)
  }

  const nudge = (dx: number, dy: number) => { if (room && canEdit(room)) act.run((l, p) => Ops.moveRoom(l, p, floor.level, room.id, { x: room.rect.x + dx, y: room.rect.y + dy })) }
  const onKey = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 600 : 100
    if (e.key === 'ArrowLeft') { e.preventDefault(); nudge(-step, 0) }
    else if (e.key === 'ArrowRight') { e.preventDefault(); nudge(step, 0) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); nudge(0, -step) }
    else if (e.key === 'ArrowDown') { e.preventDefault(); nudge(0, step) }
    else if (e.key === 'Delete' || e.key === 'Backspace') { if (room && canEdit(room)) { e.preventDefault(); act.run((l, p) => Ops.deleteRoom(l, p, floor.level, room.id)) } }
    else if (e.key === 'Escape') { setSelected(null); setSwapFrom(null) }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); act.undo() }
  }

  const btn = 'flex items-center justify-center gap-1.5 border border-line-strong px-2.5 py-2 font-mono text-[0.65rem] uppercase tracking-[0.08em] text-ink-dim hover:border-ink-dim hover:text-ink disabled:cursor-not-allowed disabled:opacity-40'
  const others = design.floors.filter((f) => f.level !== floor.level)

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]" data-testid="plan-editor">
      <div className="min-w-0">
        <div role="tablist" aria-label="Floors" className="mb-3 flex flex-wrap items-center gap-1">
          {design.floors.map((f) => (
            <button key={f.level} role="tab" aria-selected={f.level === floor.level} onClick={() => { setLevel(f.level); setSelected(null) }}
              className={cx('border border-line-strong px-2 py-2 text-xs text-ink-dim hover:text-ink', f.level === floor.level && 'border-ink text-ink')}>
              {f.level === 0 ? 'Ground' : `Floor ${f.level}`}
              {Ops.vacantRooms(layout, f.level).some((v) => !v.accepted) && <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-warn align-middle" title="Has vacant space" />}
            </button>
          ))}
          <span className="ml-auto flex items-center gap-1">
            <button className={btn} disabled={!past.length} onClick={() => act.undo()} aria-label="Undo"><Undo2 size={12} /> Undo</button>
            <button className={btn} disabled={!future.length} onClick={() => act.redo()} aria-label="Redo"><Redo2 size={12} /> Redo</button>
          </span>
        </div>

        <div className="relative w-full overflow-hidden border border-line bg-white" style={{ aspectRatio: `${W} / ${H}` }} tabIndex={0} onKeyDown={onKey} aria-label="Plan editor. Select a room, drag it to move, drag an edge to resize, use arrow keys to nudge.">
          <div className="absolute inset-0">
            <FloorDrawing floor={floor} model={design.model} siteFeatures={design.siteFeatures} theme="paper" presentation
              layers={{ ...DRAWING_PRESETS.Presentation, safety: false, dimensions: false }} />
          </div>
          <svg ref={svgRef} viewBox={`${-PAD.l} ${-PAD.t} ${W} ${H}`} className="absolute inset-0 h-full w-full touch-none select-none"
            onPointerMove={move} onPointerUp={up} onPointerCancel={up} onPointerDown={() => { setSelected(null); setSwapFrom(null); setFeat(null) }}>
            <defs>
              <pattern id="vacantHatch" width="500" height="500" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <rect width="500" height="500" fill="rgba(217,119,6,0.07)" />
                <line x1="0" y1="0" x2="0" y2="500" stroke="rgba(217,119,6,0.55)" strokeWidth="70" />
              </pattern>
            </defs>
            {rooms.map((r) => {
              const isSel = r.id === selected, vac = Ops.isVacant(r), editable = canEdit(r)
              return (
                <g key={r.id}>
                  <rect x={r.rect.x} y={r.rect.y} width={r.rect.w} height={r.rect.h}
                    fill={vac ? 'url(#vacantHatch)' : isSel ? 'rgba(29,78,137,0.14)' : swapFrom && !(swapFrom.level === floor.level && swapFrom.id === r.id) && !r.locked ? 'rgba(29,78,137,0.12)' : 'transparent'}
                    stroke={isSel ? '#1D4E89' : vac ? '#D97706' : r.locked ? '#B45309' : 'transparent'} strokeWidth={isSel ? 90 : 50} strokeDasharray={vac || r.locked ? '180 120' : undefined}
                    className={cx(editable ? 'cursor-move' : 'cursor-pointer', 'hover:fill-[rgba(29,78,137,0.08)]')}
                    role="button" tabIndex={-1} aria-label={`${r.name}, ${sqm(r.rect)} square metres${r.locked ? ', locked' : ''}`}
                    data-room={r.id} onPointerDown={(e) => down(e, r)} />
                  {r.locked && (
                    <g transform={`translate(${rectRight(r.rect) - 900} ${r.rect.y + 150})`} pointerEvents="none">
                      <rect width="750" height="750" rx="120" fill="#B45309" />
                      <path d="M250 330 v-100 a125 125 0 0 1 250 0 v100 M200 330 h350 v300 h-350 z" fill="none" stroke="#fff" strokeWidth="60" />
                    </g>
                  )}
                </g>
              )
            })}
            {/* site features: nothing drawn over them until pointed at; the picked one gets an outline, its name and resize edges */}
            {floor.level === 0 && siteParts.map((f) => (
              <rect key={f.id} x={f.rect.x} y={f.rect.y} width={f.rect.w} height={f.rect.h} data-feature={f.kind}
                fill={feat === f.kind ? 'rgba(15,118,110,0.10)' : 'transparent'} stroke={feat === f.kind ? '#0F766E' : 'transparent'} strokeWidth={feat === f.kind ? 90 : 60}
                className="cursor-move hover:stroke-[#0F766E]/60" onPointerDown={(e) => startFeature(e, f.kind, f.rect)}><title>{`${siteName(f.kind)}: drag to move`}</title></rect>
            ))}
            {floor.level === 0 && feat && !drag && (() => {
              const f = siteParts.find((x) => x.kind === feat)
              if (!f) return null
              const tag = `${siteName(f.kind)} · ${m(f.rect.w)} × ${m(f.rect.h)} m`, fs = W / 60
              return <g>
                <EdgeStrips rect={f.rect} t={hs} color="#0F766E" name="feature" onDown={(e, side) => startFeature(e, f.kind, f.rect, side)} />
                <g pointerEvents="none" transform={`translate(${f.rect.x + f.rect.w / 2} ${Math.max(f.rect.y - fs * 1.3, -PAD.t + fs)})`}>
                  <rect x={-tag.length * fs * 0.32} y={-fs * 0.8} width={tag.length * fs * 0.64} height={fs * 1.5} rx={fs * 0.3} fill="#0F766E" />
                  <text textAnchor="middle" dominantBaseline="middle" y={-fs * 0.05} fill="#fff" fontSize={fs} fontFamily="'IBM Plex Mono', monospace">{tag}</text>
                </g>
              </g>
            })()}
            <rect x={box.x} y={box.y} width={box.w} height={box.h} fill="none" stroke="#C2410C" strokeWidth="60" strokeDasharray="300 200" pointerEvents="none" />
            {!drag && !room && <EdgeStrips rect={box} t={hs * 1.2} color="#C2410C" name="wall" onDown={(e, side) => downOutline(e, side)} />}
            {!drag && !room && (['N', 'S', 'E', 'W'] as Side[]).map((side) => {
              const cx0 = side === 'N' || side === 'S' ? box.x + box.w / 2 : side === 'W' ? box.x : box.x + box.w
              const cy0 = side === 'W' || side === 'E' ? box.y + box.h / 2 : side === 'N' ? box.y : box.y + box.h
              const horizontal = side === 'N' || side === 'S'
              return <rect key={`o${side}`} x={cx0 - (horizontal ? hs * 1.6 : hs / 2)} y={cy0 - (horizontal ? hs / 2 : hs * 1.6)} width={horizontal ? hs * 3.2 : hs} height={horizontal ? hs : hs * 3.2} rx={hs / 4}
                fill="#C2410C" stroke="#fff" strokeWidth="35" className={horizontal ? 'cursor-ns-resize' : 'cursor-ew-resize'} data-outline={side} onPointerDown={(e) => downOutline(e, side)}><title>Drag to resize the whole villa</title></rect>
            })}
            {/* the selected room's edges sit above the villa's wall handles, so a room on the outer wall is still resized as a room */}
            {room && canEdit(room) && !drag && <EdgeStrips rect={room.rect} t={hs} color="#1D4E89" name="room" onDown={(e, side) => downHandle(e, room, side)} />}
            {room && canEdit(room) && !drag && (['N', 'S', 'E', 'W'] as Side[]).map((side) => {
              const r = room.rect
              const cx0 = side === 'N' || side === 'S' ? r.x + r.w / 2 : side === 'W' ? r.x : rectRight(r)
              const cy0 = side === 'W' || side === 'E' ? r.y + r.h / 2 : side === 'N' ? r.y : rectBottom(r)
              return <rect key={side} x={cx0 - hs / 2} y={cy0 - hs / 2} width={hs} height={hs} fill="#fff" stroke="#1D4E89" strokeWidth="45"
                className={side === 'N' || side === 'S' ? 'cursor-ns-resize' : 'cursor-ew-resize'} data-handle={side} onPointerDown={(e) => downHandle(e, room, side)} />
            })}
            {dropOn && drag?.kind === 'move' && <rect x={dropOn.rect.x} y={dropOn.rect.y} width={dropOn.rect.w} height={dropOn.rect.h} fill="rgba(46,125,50,0.22)" stroke="#2E7D32" strokeWidth="110" pointerEvents="none" />}
            {ghost && <rect x={ghost.x} y={ghost.y} width={ghost.w} height={ghost.h} fill="rgba(29,78,137,0.12)" stroke="#1D4E89" strokeWidth="70" strokeDasharray="200 140" pointerEvents="none" />}
            {ghost && drag && (
              <text x={ghost.x + ghost.w / 2} y={ghost.y + ghost.h / 2} textAnchor="middle" dominantBaseline="middle" fontSize={W / 48} fontFamily="'IBM Plex Mono', monospace"
                fill="#0B2545" stroke="#fff" strokeWidth={W / 400} paintOrder="stroke" pointerEvents="none">
                {drag.kind === 'move' && dropOn ? (Ops.isVacant(dropOn) ? 'Move into vacant space' : `Swap with ${dropOn.name}`) : `${m(ghost.w)} × ${m(ghost.h)} m`}
              </text>
            )}
          </svg>
        </div>
        <p className="mt-2 text-xs text-ink-faint">Drag a room onto another room to swap them, or onto hatched vacant space to move it there. Select a room and drag any of its edges to resize; connected rooms are pushed along. Drag the orange outline to resize the whole villa. {design.candidate} · {floor.name}</p>
      </div>

      <aside aria-label="Edit rooms" className="space-y-4 border border-line p-4 text-sm">
        <div>
          <h2 className="font-display text-xl">Edit rooms</h2>
          <label className="mt-2 flex cursor-pointer items-start gap-2 text-xs text-ink-dim">
            <input type="checkbox" className="mt-0.5 accent-neutral-500" checked={autoReplan} onChange={(e) => act.setAutoReplan(e.target.checked)} />
            <span><span className="text-ink">Replan nearby automatically.</span> When an edit frees space, only the rooms beside it are adjusted. Everything else stays as it is.</span>
          </label>
        </div>

        {swapFrom && (
          <p role="status" className="border border-accent/50 bg-accent/5 px-3 py-2 text-xs text-accent">
            Swapping <b>{swapFrom.name}</b>. Click the room to swap it with, on this floor or any other floor. <button type="button" className="underline" onClick={() => setSwapFrom(null)}>Cancel</button>
          </p>
        )}

        {feedback && (
          <div role="status" className={cx('border px-3 py-2 text-xs', feedback.kind === 'error' ? 'border-bad/50 text-bad' : 'border-ok/50 text-ink-dim')}>
            <p className={feedback.kind === 'ok' ? 'text-ok' : ''}>{feedback.kind === 'error' ? 'Not applied. ' : ''}{feedback.text}</p>
            {feedback.notes.slice(0, 4).map((n, i) => <p key={i} className={cx('mt-1', n.severity === 'warning' ? 'text-warn' : 'text-ink-faint')}>{n.message}</p>)}
          </div>
        )}

        {/* ------------------------------ selected room ------------------------------ */}
        <section aria-label="Selected room">
          <h3 className="label mb-2">Selected</h3>
          {!room ? <p className="text-xs text-ink-faint">Nothing selected. Click a room in the plan.</p> : (
            <div className="space-y-3">
              <div>
                <p className="font-display text-lg leading-tight">{room.name}</p>
                <p className="mt-0.5 font-mono text-[0.7rem] text-ink-dim">{m(room.rect.w)} × {m(room.rect.h)} m · {sqm(room.rect)} m²{room.locked ? ' · locked' : ''}</p>
                {fixedReason(room) && <p className="mt-1 text-xs text-ink-faint">{fixedReason(room)}</p>}
              </div>
              {room.type !== 'fixed' && !room.outdoor && !Ops.isVacant(room) && (
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 border-y border-line py-2 text-xs" aria-label="Room constraints">
                  <dt className="text-ink-faint">Recommended</dt><dd>at least {room.constraints.minSqm} m² · {m(room.constraints.minWidthMm)} m wide (advice)</dd>
                  <dt className="text-ink-faint">Ventilation</dt><dd>{room.constraints.ventilation === 'none' ? 'not required' : room.constraints.ventilation === 'ventilator' ? 'ventilator on an outside wall' : 'window on an outside wall'}</dd>
                  <dt className="text-ink-faint">Door / windows</dt><dd>{room.constraints.doors} door · windows {room.constraints.windows}</dd>
                  <dt className="text-ink-faint">Plumbing</dt><dd>{room.constraints.plumbing ? 'needs a wet wall' : 'none'}</dd>
                  <dt className="text-ink-faint">Floor</dt><dd>{room.constraints.floor === 'any' ? 'any floor' : room.constraints.floor === 'ground' ? 'best on the ground floor' : 'upper floors'}</dd>
                </dl>
              )}
              {!Ops.isVacant(room) && (
                <div className="grid grid-cols-2 gap-2">
                  <button className={cx(btn, pad === 'move' && 'border-accent text-accent')} disabled={!canEdit(room)} aria-pressed={pad === 'move'} onClick={() => setPad(pad === 'move' ? null : 'move')}><Move size={12} /> Move</button>
                  <button className={cx(btn, pad === 'resize' && 'border-accent text-accent')} disabled={!canEdit(room)} aria-pressed={pad === 'resize'} onClick={() => setPad(pad === 'resize' ? null : 'resize')}><Maximize2 size={12} /> Resize</button>
                  <button className={cx(btn, swapping && 'border-accent text-accent')} disabled={!canEdit(room)} aria-pressed={swapping} onClick={() => setSwapping((v) => !v)}><ArrowLeftRight size={12} /> {swapping ? 'Pick a room' : 'Swap'}</button>
                  <button className={btn} disabled={!canEdit(room)} onClick={() => act.run((l, p) => Ops.deleteRoom(l, p, floor.level, room.id))}><Trash2 size={12} /> Delete</button>
                  <button className={cx(btn, 'col-span-2')} onClick={() => act.run((l) => Ops.toggleLock(l, floor.level, room.id))}>
                    {room.locked ? <><LockOpen size={12} /> Unlock</> : <><Lock size={12} /> Lock in place</>}
                  </button>
                  {!room.fixed && !room.outdoor && !room.locked && others.length > 0 && (
                    <label className="col-span-2 text-xs text-ink-dim">Move to floor
                      <select aria-label="Move to floor" className="mt-1 w-full border border-line-strong bg-bg-inset px-2 py-2 text-ink" value=""
                        onChange={(e) => { const to = Number(e.target.value); if (!Number.isNaN(to) && act.run((l, p) => Ops.moveToFloor(l, p, floor.level, room.id, to))) setLevel(to) }}>
                        <option value="">Choose a floor…</option>
                        {others.map((f) => <option key={f.level} value={f.level}>{f.name}</option>)}
                      </select>
                    </label>
                  )}
                </div>
              )}
              {pad && canEdit(room) && (
                <div className="border border-line p-2" aria-label={pad === 'move' ? 'Move controls' : 'Resize controls'}>
                  <label className="flex items-center justify-between text-xs text-ink-dim">Step
                    <select aria-label="Step" className="border border-line-strong bg-bg-inset px-2 py-1 text-ink" value={step} onChange={(e) => setStep(Number(e.target.value))}>
                      {[100, 300, 600, 900].map((v) => <option key={v} value={v}>{v / 1000} m</option>)}
                    </select>
                  </label>
                  {pad === 'move' ? (
                    <div className="mx-auto mt-2 grid w-32 grid-cols-3 gap-1">
                      <span /><button className={btn} aria-label="Move up" onClick={() => nudge(0, -step)}>↑</button><span />
                      <button className={btn} aria-label="Move left" onClick={() => nudge(-step, 0)}>←</button><span />
                      <button className={btn} aria-label="Move right" onClick={() => nudge(step, 0)}>→</button>
                      <span /><button className={btn} aria-label="Move down" onClick={() => nudge(0, step)}>↓</button><span />
                    </div>
                  ) : (
                    <div className="mt-2 grid gap-1">
                      {([['N', 'Top edge'], ['S', 'Bottom edge'], ['W', 'Left edge'], ['E', 'Right edge']] as [Side, string][]).map(([side, label]) => (
                        <div key={side} className="flex items-center justify-between text-xs text-ink-dim">{label}
                          <span className="flex gap-1">
                            <button className={btn} aria-label={`${label} in`} onClick={() => resizeTo(room.id, room.rect, sideRect(room.rect, side, side === 'S' || side === 'E' ? -step : step, side === 'S' || side === 'E' ? -step : step))}>−</button>
                            <button className={btn} aria-label={`${label} out`} onClick={() => resizeTo(room.id, room.rect, sideRect(room.rect, side, side === 'S' || side === 'E' ? step : -step, side === 'S' || side === 'E' ? step : -step))}>+</button>
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </section>

        {feat && (() => {
          const f = (design.siteFeatures ?? []).find((x) => x.kind === feat && !x.roomId)
          if (!f) return null
          const name = siteName(feat)
          const set = (r: Rect) => act.run((l, p) => Ops.setFeature(l, p, feat as never, r))
          const hand = !!layout.features?.[feat as never]
          return (
            <section aria-label="Site feature" className="border border-line p-3">
              <h3 className="label mb-1">Site · {name}</h3>
              <p className="font-mono text-[0.75rem] text-ink-dim">{m(f.rect.w)} × {m(f.rect.h)} m · {sqm(f.rect)} m²{hand ? ' · placed by you' : ' · automatic'}</p>
              <p className="mt-1 text-xs text-ink-faint">Drag it on the plan to move it; drag any of its edges to resize. Or use the buttons.</p>
              <div className="mx-auto mt-2 grid w-32 grid-cols-3 gap-1" aria-label="Move site feature">
                <span /><button className={btn} aria-label="Feature up" onClick={() => set({ ...f.rect, y: f.rect.y - step })}>↑</button><span />
                <button className={btn} aria-label="Feature left" onClick={() => set({ ...f.rect, x: f.rect.x - step })}>←</button><span />
                <button className={btn} aria-label="Feature right" onClick={() => set({ ...f.rect, x: f.rect.x + step })}>→</button>
                <span /><button className={btn} aria-label="Feature down" onClick={() => set({ ...f.rect, y: f.rect.y + step })}>↓</button><span />
              </div>
              <div className="mt-2 grid grid-cols-2 gap-1.5">
                <button className={btn} aria-label="Feature wider" onClick={() => set({ ...f.rect, w: f.rect.w + step })}>Wider +</button>
                <button className={btn} aria-label="Feature narrower" onClick={() => set({ ...f.rect, w: f.rect.w - step })}>Narrower −</button>
                <button className={btn} aria-label="Feature longer" onClick={() => set({ ...f.rect, h: f.rect.h + step })}>Longer +</button>
                <button className={btn} aria-label="Feature shorter" onClick={() => set({ ...f.rect, h: f.rect.h - step })}>Shorter −</button>
              </div>
              {hand && <button className={cx(btn, 'mt-2 w-full')} onClick={() => act.run((l) => Ops.resetFeature(l, feat as never))}>Back to automatic</button>}
            </section>
          )
        })()}

        {/* --------------------------------- the site ---------------------------------- */}
        {floor.level === 0 && siteParts.length > 0 && (
          <section aria-label="Site">
            <h3 className="label mb-2">Site</h3>
            <div className="grid grid-cols-2 gap-1.5">
              {siteParts.map((f) => (
                <button key={f.id} type="button" aria-pressed={feat === f.kind} onClick={() => { setSelected(null); setFeat(feat === f.kind ? null : f.kind) }}
                  className={cx('flex items-center gap-2 border px-2 py-1.5 text-left text-xs', feat === f.kind ? 'border-[#0F766E] text-ink' : 'border-line text-ink-dim hover:text-ink')}>
                  <span className="h-3.5 w-3.5 flex-none rounded-sm border" style={{ background: SITE_STYLE[f.kind].fill, borderColor: SITE_STYLE[f.kind].edge }} />
                  <span className="truncate">{siteName(f.kind)}</span>
                  <span className="ml-auto font-mono text-[0.65rem] text-ink-faint">{sqm(f.rect)} m²</span>
                </button>
              ))}
              <span className="flex items-center gap-2 px-2 py-1.5 text-xs text-ink-faint">
                <span className="h-3.5 w-3.5 flex-none rounded-sm" style={{ background: SITE_STYLE.lawn.fill }} />Garden fills the rest
              </span>
            </div>
            <p className="mt-2 text-xs text-ink-faint">Pick one here or click it on the plan, then drag it to move or drag its edges to resize.</p>
          </section>
        )}

        {/* ------------------------------- villa outer walls ------------------------------ */}
        <section aria-label="Villa size">
          <h3 className="label mb-2">Villa size</h3>
          <p className="font-mono text-[0.75rem] text-ink-dim">{m(box.w)} × {m(box.h)} m · {(Math.round((box.w * box.h) / 1e5) / 10)} m² footprint</p>
          <p className="mt-1 text-xs text-ink-faint">Drag the orange handles on the plan, or use the buttons. Every floor, its rooms, columns and beams follow the wall.</p>
          <label className="mt-2 flex items-center justify-between text-xs text-ink-dim">Step
            <select aria-label="Wall step" className="border border-line-strong bg-bg-inset px-2 py-1 text-ink" value={wallStep} onChange={(e) => setWallStep(Number(e.target.value))}>
              {[100, 300, 600, 900, 1500].map((v) => <option key={v} value={v}>{v / 1000} m</option>)}
            </select>
          </label>
          <div className="mt-2 grid gap-1.5">
            {([['N', 'North wall'], ['S', 'South (road) wall'], ['W', 'West wall'], ['E', 'East wall']] as [keyof Outline, string][]).map(([side, label]) => (
              <div key={side} className="flex items-center justify-between text-xs text-ink-dim">
                <span>{label}<span className="ml-1.5 text-ink-faint">{(limits[side].min / 1000).toFixed(1)} to +{(limits[side].max / 1000).toFixed(1)} m</span></span>
                <span className="flex gap-1">
                  <button className={btn} aria-label={`${label} in`} disabled={limits[side].min >= 0} onClick={() => moveWall(side, -Math.min(wallStep, -limits[side].min))}>−</button>
                  <button className={btn} aria-label={`${label} out`} disabled={limits[side].max <= 0} onClick={() => moveWall(side, Math.min(wallStep, limits[side].max))}>+</button>
                </span>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-ink-faint">The walls can go out as far as the plot's setback line. Every change is checked; if the whole step does not fit, the wall goes as far as the plan stays valid.</p>
        </section>

        {/* -------------------------------- add a room -------------------------------- */}
        <section aria-label="Add a room">
          <h3 className="label mb-2">Add a room</h3>
          <div className="grid grid-cols-2 gap-2">
            {[...ADDABLE_TYPES, ...(floor.level === 0 ? ADDABLE_OUTDOOR : [])].map((t) => <button key={t} className={btn} onClick={() => act.run((l, p) => Ops.addRoom(l, p, floor.level, t))} title={TYPE_SPEC[t].note}><Plus size={11} /> {TYPE_SPEC[t].label}</button>)}
          </div>
          <p className="mt-2 text-xs text-ink-faint">A new room goes into vacant space on this floor. Parking and verandah go on the plot beside the house.</p>
        </section>

        {/* -------------------------------- vacant space ------------------------------- */}
        <section aria-label="Vacant space optimizer">
          <h3 className="label mb-2">Vacant space{vacants.length ? ` · ${vacants.length}` : ''}</h3>
          {!vacants.length ? <p className="text-xs text-ink-faint">None on this floor. Every square metre has a use.</p> : vacants.map((v) => (
            <VacantCard key={v.id} v={v} level={floor.level} plan={design} layout={layout} selected={v.id === selected} onSelect={() => setSelected(v.id)} btn={btn} />
          ))}
          {unaccepted.length > 1 && <button className={cx(btn, 'mt-2 w-full')} onClick={() => unaccepted.forEach((v) => act.run((l, p) => Ops.autoOptimize(l, p, floor.level, Ops.vacantRooms(l, floor.level).find((x) => !x.accepted)?.id ?? v.id)))}><Wand2 size={12} /> Auto-optimize all</button>}
        </section>

        <button className={cx(btn, 'w-full')} disabled={!layoutNow} onClick={() => act.resetToGenerated()}><RotateCcw size={12} /> Reset to the generated plan</button>
      </aside>
    </div>
  )
}

/** invisible grab strips along all four edges of a rectangle: the whole edge can be dragged, not only a small handle */
function EdgeStrips({ rect: r, t, color, name, onDown }: { rect: Rect; t: number; color: string; name: string; onDown: (e: React.PointerEvent, side: Side) => void }) {
  const strips: [Side, Rect][] = [
    ['N', { x: r.x + t / 2, y: r.y - t / 2, w: Math.max(0, r.w - t), h: t }], ['S', { x: r.x + t / 2, y: r.y + r.h - t / 2, w: Math.max(0, r.w - t), h: t }],
    ['W', { x: r.x - t / 2, y: r.y + t / 2, w: t, h: Math.max(0, r.h - t) }], ['E', { x: r.x + r.w - t / 2, y: r.y + t / 2, w: t, h: Math.max(0, r.h - t) }],
  ]
  return <g>{strips.map(([side, q]) => (
    <rect key={side} x={q.x} y={q.y} width={q.w} height={q.h} fill={color} fillOpacity={0} className={cx('transition-[fill-opacity] hover:[fill-opacity:0.35]', side === 'N' || side === 'S' ? 'cursor-ns-resize' : 'cursor-ew-resize')}
      data-edge={`${name}-${side}`} onPointerDown={(e) => onDown(e, side)}><title>Drag to resize</title></rect>
  ))}</g>
}

function VacantCard({ v, level, plan, layout, selected, onSelect, btn }: { v: LayoutRoom; level: number; plan: Design; layout: ReturnType<typeof extractLayout>; selected: boolean; onSelect: () => void; btn: string }) {
  const act = usePlanEdit.getState()
  const options = useMemo(() => Ops.vacantOptions(layout, plan, level, v.id), [layout, plan, level, v.id])
  const expand = options.filter((o): o is Extract<typeof o, { kind: 'expand' }> => o.kind === 'expand')
  const add = options.filter((o): o is Extract<typeof o, { kind: 'add' }> => o.kind === 'add')
  const canOpen = options.some((o) => o.kind === 'open')
  return (
    <div className={cx('mb-3 border p-3', selected ? 'border-accent' : 'border-line')} onClick={onSelect}>
      <p className="font-mono text-[0.7rem] text-ink-dim">{sqm(v.rect)} m² · {m(v.rect.w)} × {m(v.rect.h)} m{v.accepted ? ' · kept vacant' : ''}</p>
      <div className="mt-2 grid gap-1.5">
        <button className={btn} onClick={() => act.run((l, p) => Ops.autoOptimize(l, p, level, v.id))}><Wand2 size={12} /> Auto-optimize</button>
        {expand.length > 0 && (
          <div>
            <p className="label mb-1">Expand a nearby room</p>
            <div className="grid gap-1">
              {expand.map((o) => <button key={o.roomId} className={cx(btn, 'justify-between normal-case tracking-normal')} onClick={() => act.run((l, p) => Ops.expandNeighbour(l, p, level, v.id, o.roomId))}>
                <span>{o.roomName}</span><span className={cx('font-mono text-[0.65rem]', o.withinMax ? 'text-ink-faint' : 'text-warn')}>+{o.gainSqm} → {o.resultSqm} m²</span></button>)}
            </div>
          </div>
        )}
        {add.length > 0 && (
          <div>
            <p className="label mb-1">Add a new room</p>
            <div className="flex flex-wrap gap-1">
              {add.map((o) => <button key={o.type} title={o.reason} className={cx(btn, 'px-2')} onClick={() => act.run((l, p) => Ops.addRoom(l, p, level, o.type as RoomType, v.id))}>{o.label} · {o.areaSqm} m²</button>)}
            </div>
          </div>
        )}
        <div className="grid grid-cols-2 gap-1.5">
          <button className={btn} disabled={!canOpen} onClick={() => act.run((l, p) => Ops.openSpace(l, p, level, v.id))}>Open space</button>
          <button className={btn} disabled={v.accepted} onClick={() => act.run((l) => Ops.keepVacant(l, level, v.id))}>Keep vacant</button>
        </div>
      </div>
    </div>
  )
}
