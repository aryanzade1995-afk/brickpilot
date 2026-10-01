import { DRAWING_PRESETS, type DrawingLayers } from './layers.ts'
import { Fragment } from 'react'
import { rectBottom, rectCenter, rectRight, rectUnionEdges, type Rect } from '../geometry.ts'
import type { Design, FloorPlan, Opening, SiteFeature } from '../engine/types.ts'
import { terraceLayout } from '../engine/terrace.ts'
import type { CanonicalModel, Zone } from '../model/canonical.ts'
import { furnishFloor, type FurnitureShape, type Role } from './furniture.ts'

export type Theme = 'dark' | 'paper' | 'presentation' | 'cad'

const INK = { cad: '#e5eaf0', dark: '#171717', paper: '#1b1b1b', presentation: '#141414' }
const FAINT = { cad: '#8b98a8', dark: 'rgba(23,23,23,0.48)', paper: 'rgba(27,27,27,0.4)', presentation: 'rgba(20,20,20,0.45)' }
const BG = { cad: '#11161c', dark: '#eeeeec', paper: '#ffffff', presentation: '#ffffff' }
const ACCENT = '#222222'

const clampN = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

const ZONE_COLOR: Record<Zone, string> = {
  social: '#789daf', private: '#bb997b', service: '#82968d', circulation: '#b7bfc7',
  work: '#9b8cb3', sacred: '#bcac79', outdoor: '#829c7d',
}

export function FloorDrawing({
  floor,
  model,
  theme = 'dark',
  showLabels = true,
  showDimensions = true,
  markRoomId,
  svgRef,
  siteFeatures,
  layers,
  presentation,
}: {
  layers?: Partial<DrawingLayers>
  presentation?: boolean
  siteFeatures?: SiteFeature[]
  floor: FloorPlan
  model: CanonicalModel
  theme?: Theme
  showLabels?: boolean
  showDimensions?: boolean
  /** highlight one room — used as the interior reference for the render step */
  markRoomId?: string
  svgRef?: React.Ref<SVGSVGElement>
}) {
  const ink = INK[theme]
  const faint = FAINT[theme]
  const bg = BG[theme]
  const marked = markRoomId ? floor.rooms.find((r) => r.id === markRoomId) : undefined
  const pres = (presentation ?? theme === 'presentation') && theme !== 'cad'
  const active: DrawingLayers = { site: true, zoning: true, circulation: false, walls: true, openings: true, supports: false, dimensions: showDimensions, labels: showLabels, furniture: pres, ...layers }
  const furniture = active.furniture ? furnishFloor(floor) : []
  const finishOf = new Map(furniture.map((f) => [f.roomId, f.finish]))

  const padL = 3400
  const padB = 3400
  const padT = 1800
  const padR = 1800
  const vb = `${-padL} ${-padT} ${model.plot.width + padL + padR} ${model.plot.depth + padT + padB}`

  const setback: Rect = {
    x: model.setbacksMm.W,
    y: model.setbacksMm.N,
    w: model.plot.width - model.setbacksMm.W - model.setbacksMm.E,
    h: model.plot.depth - model.setbacksMm.N - model.setbacksMm.S,
  }

  return (
    <svg
      ref={svgRef}
      viewBox={vb}
      className="h-full w-full"
      xmlns="http://www.w3.org/2000/svg"
      style={{ background: bg }}
    >
      {pres && <PresentationDefs />}
      {active.site && floor.level === 0 && (siteFeatures ? <SiteFeatureDrawing features={siteFeatures} ink={ink} faint={faint} showLabels={active.labels} showFurniture={active.furniture} dark={theme === 'cad'} /> : pres && <Landscape floor={floor} model={model} />)}
      {/* ---- site + setbacks ---- */}
      {active.site && <g data-layer="site">
        <rect
          x={0}
          y={0}
          width={model.plot.width}
          height={model.plot.depth}
          fill="none"
          stroke={faint}
          strokeWidth={40}
        />
        <rect
          x={setback.x}
          y={setback.y}
          width={setback.w}
          height={setback.h}
          fill="none"
          stroke={faint}
          strokeWidth={25}
          strokeDasharray="120 90"
        />
        <text x={0} y={-700} fill={faint} fontSize={520} fontFamily="'IBM Plex Mono', monospace">
          SITE BOUNDARY
        </text>
        <NorthArrow x={model.plot.width + 500} y={900} entrySide={model.entrySide} ink={faint} />
      </g>

      }
      {/* ---- zone fills ---- */}
      {(active.zoning || pres) && <g data-layer="zoning">
        {floor.rooms.map((r) => (
          <rect
            key={`fill-${r.id}`}
            x={r.rect.x}
            y={r.rect.y}
            width={r.rect.w}
            height={r.rect.h}
            fill={active.zoning ? r.outdoor ? 'none' : ZONE_COLOR[r.zone] : pres ? `url(#fin-${finishOf.get(r.id) ?? 'tile'})` : 'none'} fillOpacity={active.zoning ? theme === 'cad' ? 0.25 : 0.16 : 1}
            stroke={r.outdoor ? faint : 'none'}
            strokeWidth={r.outdoor ? 22 : 0}
            strokeDasharray={r.outdoor ? '80 60' : undefined}
          />
        ))}
      </g>

      }
      {/* ---- presentation furniture (drawing only; never changes the plan) ---- */}
      {active.furniture && (
        <g data-layer="furniture">
          {furniture.flatMap((f) => f.items.filter((s) => s.role !== 'plant')
            .map((s, i) => <Piece key={`${f.roomId}-${i}`} s={s} />))}
        </g>
      )}

      {/* ---- marked room (render step interior reference) ---- */}
      {marked && (
        <g>
          <rect
            x={marked.rect.x}
            y={marked.rect.y}
            width={marked.rect.w}
            height={marked.rect.h}
            fill="rgba(0,0,0,0.14)"
            stroke={ACCENT}
            strokeWidth={70}
          />
          <circle cx={rectCenter(marked.rect).x} cy={marked.rect.y + 520} r={360} fill={ACCENT} />
          <text
            x={rectCenter(marked.rect).x}
            y={marked.rect.y + 520 + 150}
            textAnchor="middle"
            fontSize={420}
            fill="#fff"
            fontFamily="'IBM Plex Mono', monospace"
          >
            1
          </text>
        </g>
      )}

      {/* ---- walls ---- */}
      {active.walls && <g data-layer="walls" strokeLinecap="square">
        {floor.walls.map((w, i) => (
          <line
            key={`wall-${i}`}
            x1={w.a.x}
            y1={w.a.y}
            x2={w.b.x}
            y2={w.b.y}
            stroke={ink}
            strokeWidth={w.thickness}
          />
        ))}
        {/* Preserve real wall gaps when opening symbols are hidden. */}
        {floor.openings.map((o, i) => <line key={`gap-${i}`}
          x1={o.at.x - (o.orient === 'h' ? o.width / 2 : 0)} y1={o.at.y - (o.orient === 'v' ? o.width / 2 : 0)}
          x2={o.at.x + (o.orient === 'h' ? o.width / 2 : 0)} y2={o.at.y + (o.orient === 'v' ? o.width / 2 : 0)} stroke={bg} strokeWidth={340} />)}
      </g>}
      {active.openings && <g data-layer="openings">{floor.openings.map((o, i) => <OpeningMark key={o.id ?? `op-${i}`} o={o} ink={ink} bg={bg} theme={theme} />)}</g>}
      {active.supports && <g data-layer="supports" stroke={faint} strokeWidth={80} strokeDasharray="180 90">{floor.beams?.map(b => <line key={b.id} x1={b.a.x} y1={b.a.y} x2={b.b.x} y2={b.b.y} />)}</g>}
      {active.circulation && <g data-layer="circulation" fill="none" stroke={theme === 'cad' ? '#c5e2f0' : '#546c7b'} strokeWidth={50} strokeDasharray="140 90">
        {floor.rooms.filter(r => r.zone === 'circulation').map(r => <rect key={r.id} x={r.rect.x + 100} y={r.rect.y + 100} width={Math.max(0, r.rect.w - 200)} height={Math.max(0, r.rect.h - 200)} />)}
        {floor.openings.filter(o => o.kind !== 'window').map((o, i) => <g key={i}><circle cx={o.at.x} cy={o.at.y} r={140} />{o.rooms?.filter(Boolean).map(id => {
          const r = floor.rooms.find(r => r.id === id); if (!r) return null; const c = rectCenter(r.rect)
          return <line key={id} x1={c.x} y1={c.y} x2={o.at.x} y2={o.at.y} />
        })}</g>)}
      </g>}

      {/* ---- structural columns (same grid on every floor) ---- */}
      {(active.walls || active.supports) && floor.columns && (
        <g data-layer="columns" fill={ink}>
          {floor.columns.map((c) => (
            <rect key={c.id} x={c.at.x - c.size / 2} y={c.at.y - c.size / 2} width={c.size} height={c.size} />
          ))}
        </g>
      )}

      {/* ---- stair ---- */}
      {(active.walls || active.circulation) && floor.stair && (
        <g stroke={ink} strokeWidth={30} fill="none">
          {floor.stair.treads.map((t, i) => (
            <line key={`tread-${i}`} x1={t[0].x} y1={t[0].y} x2={t[1].x} y2={t[1].y} />
          ))}
          {/* the well between the two flights, along the run */}
          {floor.stair.startSide === 'E' || floor.stair.startSide === 'W' ? (
            <line
              x1={floor.stair.rect.x}
              y1={floor.stair.rect.y + floor.stair.rect.h / 2}
              x2={rectRight(floor.stair.rect)}
              y2={floor.stair.rect.y + floor.stair.rect.h / 2}
              stroke={faint}
            />
          ) : (
            <line
              x1={floor.stair.rect.x + floor.stair.rect.w / 2}
              y1={floor.stair.rect.y}
              x2={floor.stair.rect.x + floor.stair.rect.w / 2}
              y2={rectBottom(floor.stair.rect)}
              stroke={faint}
            />
          )}
        </g>
      )}

      {/* ---- labels ---- */}
      {active.labels && (
        <g data-layer="labels" textAnchor="middle">
          {floor.rooms.map((r) => {
            const c = rectCenter(r.rect)
            const short = Math.min(r.rect.w, r.rect.h)
            if (short < 1400) return null
            const nameSize = clampN(Math.min(520, (r.rect.w * 1.7) / r.name.length, short / 3.4), 260, 520)
            const showArea = short > 2000 && r.rect.h > 2600
            if (pres) return <RoomTag key={`lbl-${r.id}`} name={r.name} rect={r.rect} size={clampN(nameSize * 0.85, 230, 420)} />
            return (
              <Fragment key={`lbl-${r.id}`}>
                <text
                  x={c.x}
                  y={showArea ? c.y - 60 : c.y + nameSize / 3}
                  fill={ink}
                  fontSize={nameSize}
                  fontFamily="'Inter', sans-serif"
                  stroke={bg}
                  strokeWidth={nameSize / 5}
                  paintOrder="stroke"
                >
                  {r.name}
                </text>
                {showArea && (
                  <text
                    x={c.x}
                    y={c.y + nameSize + 120}
                    fill={faint}
                    fontSize={nameSize * 0.78}
                    fontFamily="'IBM Plex Mono', monospace"
                    stroke={bg}
                    strokeWidth={nameSize / 6}
                    paintOrder="stroke"
                  >
                    {r.area.toFixed(1)} m²
                  </text>
                )}
              </Fragment>
            )
          })}
        </g>
      )}

      {/* ---- dimensions ---- */}
      {active.dimensions && (
        <g data-layer="dimensions" stroke={faint} strokeWidth={22} fill={faint} fontFamily="'IBM Plex Mono', monospace">
          <DimH y={model.plot.depth + 1500} x1={0} x2={model.plot.width} label={`${(model.plot.width / 1000).toFixed(2)} m`} />
          <DimV x={-1500} y1={0} y2={model.plot.depth} label={`${(model.plot.depth / 1000).toFixed(2)} m`} />
          <DimH
            y={floor.outline.y - 900}
            x1={floor.outline.x}
            x2={rectRight(floor.outline)}
            label={`${(floor.outline.w / 1000).toFixed(2)} m`}
          />
        </g>
      )}
    </svg>
  )
}

function OpeningMark({ o, ink, bg, theme }: { o: Opening; ink: string; bg: string; theme: Theme }) {
  const half = o.width / 2
  const eraseW = o.kind === 'window' ? 260 : 340
  const eraseColor = theme === 'paper' ? bg : bg
  // a cased opening (no leaf): the wall is simply cut, with jamb ticks
  if (o.leaf === false) {
    const [x1, y1, x2, y2] = o.orient === 'h'
      ? [o.at.x - half, o.at.y, o.at.x + half, o.at.y]
      : [o.at.x, o.at.y - half, o.at.x, o.at.y + half]
    const t = 150
    // point `along` the opening and `perp` off the wall line, in plan mm
    const P = (along: number, perp: number) => o.orient === 'h'
      ? { x: o.at.x + along, y: o.at.y + perp }
      : { x: o.at.x + perp, y: o.at.y + along }
    const L = (a: { x: number; y: number }, b: { x: number; y: number }, props: Record<string, string | number>) =>
      <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} {...props} />
    return (
      <g>
        <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={eraseColor} strokeWidth={340} />
        {/* glazed sliding screen: two thin overlapping panels + a slide arrow */}
        {o.treatment === 'glazed-slide' && (
          <g stroke={ink} strokeWidth={18} fill="none">
            {L(P(-half, -45), P(half * 0.1, -45), {})}
            {L(P(-half * 0.1, 45), P(half, 45), {})}
            {L(P(-half * 0.45, -130), P(half * 0.05, -130), {})}
            <path d={(() => {
              const tip = P(half * 0.05, -130)
              const a = P(half * 0.05 - 110, -190)
              const b = P(half * 0.05 - 110, -70)
              return `M ${a.x} ${a.y} L ${tip.x} ${tip.y} L ${b.x} ${b.y}`
            })()} />
          </g>
        )}
        {/* fully open to the next room: a dashed line where the wall would be */}
        {o.treatment === 'open' && L(P(-half, 0), P(half, 0), { stroke: ink, strokeWidth: 22, strokeDasharray: '90 70' })}
        {o.orient === 'h' ? (
          <>
            <line x1={x1} y1={y1 - t} x2={x1} y2={y1 + t} stroke={ink} strokeWidth={30} />
            <line x1={x2} y1={y2 - t} x2={x2} y2={y2 + t} stroke={ink} strokeWidth={30} />
          </>
        ) : (
          <>
            <line x1={x1 - t} y1={y1} x2={x1 + t} y2={y1} stroke={ink} strokeWidth={30} />
            <line x1={x2 - t} y1={y2} x2={x2 + t} y2={y2} stroke={ink} strokeWidth={30} />
          </>
        )}
      </g>
    )
  }
  if (o.orient === 'h') {
    const x1 = o.at.x - half
    const x2 = o.at.x + half
    return (
      <g>
        <line x1={x1} y1={o.at.y} x2={x2} y2={o.at.y} stroke={eraseColor} strokeWidth={eraseW} />
        {o.kind === 'window' ? (
          <>
            <line x1={x1} y1={o.at.y - 45} x2={x2} y2={o.at.y - 45} stroke={theme === 'presentation' ? GLASS : ink} strokeWidth={theme === 'presentation' ? 40 : 30} />
            <line x1={x1} y1={o.at.y + 45} x2={x2} y2={o.at.y + 45} stroke={theme === 'presentation' ? GLASS : ink} strokeWidth={theme === 'presentation' ? 40 : 30} />
          </>
        ) : (
          <>
            <line x1={x1} y1={o.at.y} x2={x1} y2={o.at.y + (o.swing ?? 1) * o.width} stroke={ink} strokeWidth={40} />
            <path
              d={`M ${x1} ${o.at.y + (o.swing ?? 1) * o.width} A ${o.width} ${o.width} 0 0 ${o.swing === -1 ? 1 : 0} ${x2} ${o.at.y}`}
              fill="none"
              stroke={ink}
              strokeWidth={o.kind === 'entry' ? 45 : 28}
            />
          </>
        )}
      </g>
    )
  }
  const y1 = o.at.y - half
  const y2 = o.at.y + half
  return (
    <g>
      <line x1={o.at.x} y1={y1} x2={o.at.x} y2={y2} stroke={eraseColor} strokeWidth={eraseW} />
      {o.kind === 'window' ? (
        <>
          <line x1={o.at.x - 45} y1={y1} x2={o.at.x - 45} y2={y2} stroke={theme === 'presentation' ? GLASS : ink} strokeWidth={theme === 'presentation' ? 40 : 30} />
          <line x1={o.at.x + 45} y1={y1} x2={o.at.x + 45} y2={y2} stroke={theme === 'presentation' ? GLASS : ink} strokeWidth={theme === 'presentation' ? 40 : 30} />
        </>
      ) : (
        <>
          <line x1={o.at.x} y1={y1} x2={o.at.x + (o.swing ?? 1) * o.width} y2={y1} stroke={ink} strokeWidth={40} />
          <path
            d={`M ${o.at.x + (o.swing ?? 1) * o.width} ${y1} A ${o.width} ${o.width} 0 0 ${o.swing === -1 ? 0 : 1} ${o.at.x} ${y2}`}
            fill="none"
            stroke={ink}
            strokeWidth={o.kind === 'entry' ? 45 : 28}
          />
        </>
      )}
    </g>
  )
}

function DimH({ y, x1, x2, label }: { y: number; x1: number; x2: number; label: string }) {
  return (
    <g>
      <line x1={x1} y1={y} x2={x2} y2={y} />
      <line x1={x1} y1={y - 160} x2={x1} y2={y + 160} />
      <line x1={x2} y1={y - 160} x2={x2} y2={y + 160} />
      <text x={(x1 + x2) / 2} y={y - 220} textAnchor="middle" fontSize={460} stroke="none">
        {label}
      </text>
    </g>
  )
}

function DimV({ x, y1, y2, label }: { x: number; y1: number; y2: number; label: string }) {
  return (
    <g>
      <line x1={x} y1={y1} x2={x} y2={y2} />
      <line x1={x - 160} y1={y1} x2={x + 160} y2={y1} />
      <line x1={x - 160} y1={y2} x2={x + 160} y2={y2} />
      <text
        x={x - 240}
        y={(y1 + y2) / 2}
        textAnchor="middle"
        fontSize={460}
        stroke="none"
        transform={`rotate(-90 ${x - 240} ${(y1 + y2) / 2})`}
      >
        {label}
      </text>
    </g>
  )
}

function NorthArrow({ x, y, entrySide, ink }: { x: number; y: number; entrySide: string; ink: string }) {
  // entry is drawn at the south; rotate the N marker so it reflects the real facing
  const rot = { S: 0, W: 90, N: 180, E: 270 }[entrySide] ?? 0
  return (
    <g transform={`translate(${x} ${y}) rotate(${rot})`} stroke={ink} fill={ink}>
      <circle r={520} fill="none" strokeWidth={25} />
      <path d="M0 -520 L 150 120 L 0 0 L -150 120 Z" strokeWidth={20} />
      <text y={-720} textAnchor="middle" fontSize={440} stroke="none" fontFamily="'IBM Plex Mono', monospace">
        N
      </text>
    </g>
  )
}

/* ------------------------------------------------------------------ *
 *  Presentation style — furnished, finished, landscaped. Drawing only:
 *  every shape comes from the same FloorPlan (and terraceLayout) that
 *  the 3D model reads.
 * ------------------------------------------------------------------ */

const GLASS = '#6fb3d6'

/** floor finishes as tiling patterns, in plan millimetres */
function PresentationDefs() {
  return (
    <defs>
      <pattern id="fin-wood" width={1200} height={200} patternUnits="userSpaceOnUse">
        <rect width={1200} height={200} fill="#d8b287" />
        <line x1={0} y1={200} x2={1200} y2={200} stroke="#b88c5e" strokeWidth={14} />
        <line x1={420} y1={0} x2={420} y2={200} stroke="#c49a6c" strokeWidth={10} />
      </pattern>
      <pattern id="fin-tile" width={600} height={600} patternUnits="userSpaceOnUse">
        <rect width={600} height={600} fill="#f1ece3" />
        <path d="M 600 0 L 0 0 0 600" fill="none" stroke="#dcd2c3" strokeWidth={10} />
      </pattern>
      <pattern id="fin-wet" width={300} height={300} patternUnits="userSpaceOnUse">
        <rect width={300} height={300} fill="#e2e7ea" />
        <path d="M 300 0 L 0 0 0 300" fill="none" stroke="#c7d0d5" strokeWidth={8} />
      </pattern>
      <pattern id="fin-paving" width={500} height={500} patternUnits="userSpaceOnUse">
        <rect width={500} height={500} fill="#e9e5de" />
        <path d="M 500 0 L 0 0 0 500" fill="none" stroke="#d2cbbf" strokeWidth={10} />
      </pattern>
      <pattern id="fin-none" width={600} height={600} patternUnits="userSpaceOnUse">
        <rect width={600} height={600} fill="#f4f2ee" />
      </pattern>
    </defs>
  )
}

const PIECE: Record<Role, { fill: string; stroke: string }> = {
  bed: { fill: '#ffffff', stroke: '#8a8a8a' },
  pillow: { fill: '#f3f3f3', stroke: '#a0a0a0' },
  linen: { fill: '#8f969d', stroke: '#6f757b' },
  table: { fill: '#a87c52', stroke: '#7d5a38' },
  seat: { fill: '#dcd6cc', stroke: '#9b9387' },
  soft: { fill: '#d6d1c9', stroke: '#9b948a' },
  rug: { fill: '#e8dfd1', stroke: '#cbbda8' },
  counter: { fill: '#5d5349', stroke: '#3f3830' },
  appliance: { fill: '#2a2a2a', stroke: '#111111' },
  sanitary: { fill: '#ffffff', stroke: '#7d7d7d' },
  storage: { fill: '#b38d64', stroke: '#86673f' },
  car: { fill: 'none', stroke: '#6b6b6b' },
  plant: { fill: '#79a857', stroke: '#4d7a33' },
  water: { fill: '#8fd0e8', stroke: '#58a8c8' },
}

function Piece({ s }: { s: FurnitureShape }) {
  const st = PIECE[s.role]
  return s.kind === 'rect' ? (
    <rect x={s.x} y={s.y} width={s.w} height={s.h} rx={s.rx ?? 0} fill={st.fill} stroke={st.stroke} strokeWidth={s.role === 'car' ? 35 : 18} />
  ) : (
    <circle cx={s.cx} cy={s.cy} r={s.r} fill={st.fill} stroke={st.stroke} strokeWidth={18} />
  )
}

/** "BEDROOM 2" over "3.6 X 4.0 m", the way a presentation plan names a room */
function RoomTag({ name, rect, size, ink = '#1a1a1a', bg = '#ffffff' }: { name: string; rect: Rect; size: number; ink?: string; bg?: string }) {
  const c = rectCenter(rect)
  const dims = `${(rect.w / 1000).toFixed(1)} X ${(rect.h / 1000).toFixed(1)} m`
  const halo = { stroke: bg, strokeWidth: size / 4, paintOrder: 'stroke' as const }
  return (
    <g fontFamily="'Inter', sans-serif" textAnchor="middle">
      <text x={c.x} y={c.y - size * 0.15} fontSize={size} fontWeight={600} fill={ink} {...halo}>{name.toUpperCase()}</text>
      <text x={c.x} y={c.y + size * 1.05} fontSize={size * 0.82} fill={ink} {...halo}>{dims}</text>
    </g>
  )
}

/** Plain site ground and a clear approach path, without tree symbols. */
function Landscape({ floor, model }: { floor: FloorPlan; model: CanonicalModel }) {
  const garden = model.brief.rooms.priorities.garden
  const W = model.plot.width
  const H = model.plot.depth
  // the road is plan-south: keep a clear strip from parking / verandah to the gate
  // from the FRONT edge of the car porch / verandah / foyer straight to the road
  const approach = floor.rooms.filter((r) => r.id === 'parking' || r.id === 'verandah' || r.id === 'foyer')
    .map((r) => ({ x: r.rect.x - 200, y: rectBottom(r.rect), w: r.rect.w + 400, h: Math.max(0, H - rectBottom(r.rect)) }))
    .filter((a) => a.h > 0)
  return (
    <g>
      <rect x={0} y={0} width={W} height={H} fill={garden ? '#dfe9d2' : '#ece9e3'} />
      {approach.map((a, i) => <rect key={`path-${i}`} x={a.x} y={a.y} width={a.w} height={a.h} fill="url(#fin-paving)" />)}
    </g>
  )
}

/**
 * The roof terrace over the top floor, from terraceLayout() — the same
 * stair headroom room, water tank and pergola the 3D model builds.
 */
export function TerraceDrawing({ design, svgRef, theme = 'presentation', layers }: { design: Design; svgRef?: React.Ref<SVGSVGElement>; theme?: Theme; layers?: Partial<DrawingLayers> }) {
  const model = design.model
  const layout = terraceLayout(design)
  const top = design.floors[design.floors.length - 1]
  const padL = 3400
  const padT = 1800
  const vb = `${-padL} ${-padT} ${model.plot.width + padL + 1800} ${model.plot.depth + padT + 3400}`
  const ink = INK[theme]
  const faint = FAINT[theme]
  const active = { ...DRAWING_PRESETS.Presentation, ...layers }
  const o = layout?.outline ?? top.outline
  // same slat count as the 3D pergola
  const slats = layout?.pergola ? Math.max(5, Math.round(layout.pergola.w / 430)) : 0
  return (
    <svg ref={svgRef} viewBox={vb} className="h-full w-full" xmlns="http://www.w3.org/2000/svg" style={{ background: BG[theme] }}>
      <PresentationDefs />
      {active.site && <g data-layer="site"><rect x={0} y={0} width={model.plot.width} height={model.plot.depth} fill="none" stroke={faint} strokeWidth={40} /><rect x={model.setbacksMm.W} y={model.setbacksMm.N} width={model.envelope.width} height={model.envelope.depth} fill="none" stroke={faint} strokeWidth={25} strokeDasharray="120 90" /></g>}
      {active.supports && <g data-layer="supports" stroke={faint} strokeWidth={80} strokeDasharray="180 90">{top.beams?.map(b => <line key={b.id} x1={b.a.x} y1={b.a.y} x2={b.b.x} y2={b.b.y} />)}{top.columns?.map(c => <rect key={c.id} x={c.at.x - c.size / 2} y={c.at.y - c.size / 2} width={c.size} height={c.size} fill={ink} />)}</g>}
      {active.circulation && top.stair && <rect data-layer="circulation" x={top.stair.rect.x} y={top.stair.rect.y} width={top.stair.rect.w} height={top.stair.rect.h} fill="none" stroke={faint} strokeWidth={60} strokeDasharray="120 90" />}
      {active.dimensions && <g data-layer="dimensions" fill={faint} stroke={faint} strokeWidth={22} fontFamily="monospace">
        <DimH y={model.plot.depth + 1500} x1={0} x2={model.plot.width} label={`${(model.plot.width / 1000).toFixed(2)} m`} />
        <DimV x={-1500} y1={0} y2={model.plot.depth} label={`${(model.plot.depth / 1000).toFixed(2)} m`} />
        <DimH y={o.y - 900} x1={o.x} x2={rectRight(o)} label={`${(o.w / 1000).toFixed(2)} m`} />
        <DimV x={o.x - 900} y1={o.y} y2={rectBottom(o)} label={`${(o.h / 1000).toFixed(2)} m`} />
      </g>}
      {active.site && <NorthArrow x={model.plot.width + 500} y={900} entrySide={model.entrySide} ink={faint} />}
      {!layout ? (
        <g>
          {(active.zoning || active.walls) && top.footprint.map((r, i) => <rect key={i} x={r.x} y={r.y} width={r.w} height={r.h} fill={active.zoning ? '#e6e1d8' : BG[theme]} stroke={active.walls ? ink : 'none'} strokeWidth={60} />)}
          {active.labels && <RoomTag ink={ink} bg={BG[theme]} name="Pitched roof" rect={o} size={420} />}
        </g>
      ) : (
        <g>
          {active.zoning && layout.slab.map((r, i) => <rect key={`slab-${i}`} x={r.x} y={r.y} width={r.w} height={r.h} fill={theme === 'cad' ? '#25313c' : 'url(#fin-paving)'} fillOpacity={0.35} />)}
          {active.furniture && layout.pergola && (
            <g>
              <rect x={layout.pergola.x} y={layout.pergola.y} width={layout.pergola.w} height={layout.pergola.h} fill="url(#fin-wood)" stroke="#86673f" strokeWidth={30} />
              {Array.from({ length: slats + 1 }, (_, i) => {
                const x = layout.pergola!.x + (layout.pergola!.w * i) / slats
                return <line key={`slat-${i}`} x1={x} y1={layout.pergola!.y} x2={x} y2={rectBottom(layout.pergola!)} stroke="#6f5434" strokeWidth={40} opacity={0.55} />
              })}
            </g>
          )}
          {/* parapet with a glass guard rail, on the terrace edge */}
          {active.walls && rectUnionEdges(layout.slab).map((e, i) => (
            <g key={`rail-${i}`}>
              <line x1={e.a.x} y1={e.a.y} x2={e.b.x} y2={e.b.y} stroke={ink} strokeWidth={200} />
              <line x1={e.a.x} y1={e.a.y} x2={e.b.x} y2={e.b.y} stroke={GLASS} strokeWidth={70} />
            </g>
          ))}
          {active.walls && layout.mumty && (
            <g>
              <rect x={layout.mumty.x} y={layout.mumty.y} width={layout.mumty.w} height={layout.mumty.h} fill="url(#fin-wood)" stroke={ink} strokeWidth={230} />
              {top.stair?.treads.map((t, i) => <line key={`tr-${i}`} x1={t[0].x} y1={t[0].y} x2={t[1].x} y2={t[1].y} stroke={ink} strokeWidth={28} />)}
              {active.labels && <RoomTag ink={ink} bg={BG[theme]} name="Stair (DN)" rect={layout.mumty} size={300} />}
            </g>
          )}
          {active.furniture && layout.tank && (
            <g>
              <rect x={layout.tank.x} y={layout.tank.y} width={layout.tank.w} height={layout.tank.h} fill="#ffffff" stroke={ink} strokeWidth={40} />
              <circle cx={layout.tank.x + layout.tank.w / 2} cy={layout.tank.y + layout.tank.h / 2} r={layout.tank.w * 0.38} fill="#d9d9d9" stroke={ink} strokeWidth={25} />
            </g>
          )}
          {active.labels && <RoomTag ink={ink} bg={BG[theme]} name="Open terrace" rect={o} size={440} />}
          {active.labels && active.furniture && layout.pergola && <RoomTag ink={ink} bg={BG[theme]} name="Pergola deck" rect={layout.pergola} size={300} />}
        </g>
      )}
    </svg>
  )
}

export function SiteFeatureDrawing({ features, ink, faint, showLabels = true, showFurniture = true, dark = false }: { features: SiteFeature[]; ink: string; faint: string; showLabels?: boolean; showFurniture?: boolean; dark?: boolean }) {
  return <g data-layer="outdoor">{features.map(f => <g key={f.id}>
    <rect x={f.rect.x} y={f.rect.y} width={f.rect.w} height={f.rect.h} fill={dark ? f.kind === 'pool' ? '#254452' : f.kind === 'lawn' ? '#29382e' : '#3a424a' : f.kind === 'pool' ? '#b5d5df' : f.kind === 'lawn' ? '#d9dfd4' : '#dddcd8'} fillOpacity={0.65} stroke={faint} strokeWidth={25} />
    {showLabels && !f.covered && f.rect.w >= 1400 && f.rect.h >= 1000 && <text x={f.rect.x + f.rect.w / 2} y={f.rect.y + f.rect.h / 2} textAnchor="middle" fill={ink} fontSize={260} fontFamily="monospace">{f.kind === 'lawn' ? 'LAWN' : f.kind === 'utilityYard' ? 'UTILITY YARD' : f.kind === 'sitOut' ? 'SIT-OUT' : f.kind.toUpperCase()}</text>}
    {showFurniture && !f.covered && f.kind === 'parking' && <rect x={f.rect.x + 500} y={f.rect.y + 400} width={1900} height={4200} rx={240} fill="none" stroke={ink} strokeWidth={35} />}
  </g>)}</g>
}
