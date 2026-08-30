import { Fragment } from 'react'
import { rectBottom, rectCenter, rectRight, type Rect } from '../geometry.ts'
import type { FloorPlan, Opening } from '../engine/types.ts'
import type { CanonicalModel, Zone } from '../model/canonical.ts'

type Theme = 'dark' | 'paper'

const INK = { dark: '#ece5d7', paper: '#1b1a17' }
const FAINT = { dark: 'rgba(236,229,215,0.32)', paper: 'rgba(27,26,23,0.4)' }
const BG = { dark: '#0b0b0c', paper: '#f4f1e8' }
const ACCENT = '#e0521e'

const clampN = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

const ZONE_TINT: Record<Zone, string> = {
  social: 'rgba(224,82,30,0.06)',
  private: 'rgba(236,229,215,0.05)',
  service: 'rgba(111,174,127,0.07)',
  circulation: 'rgba(236,229,215,0.03)',
  work: 'rgba(217,164,65,0.06)',
  sacred: 'rgba(224,82,30,0.04)',
  outdoor: 'rgba(236,229,215,0.02)',
}

export function FloorDrawing({
  floor,
  model,
  theme = 'dark',
  showLabels = true,
  showDimensions = true,
}: {
  floor: FloorPlan
  model: CanonicalModel
  theme?: Theme
  showLabels?: boolean
  showDimensions?: boolean
}) {
  const ink = INK[theme]
  const faint = FAINT[theme]
  const bg = BG[theme]

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
    <svg viewBox={vb} className="h-full w-full" style={{ background: theme === 'paper' ? bg : 'transparent' }}>
      {/* ---- site + setbacks ---- */}
      <g>
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

      {/* ---- zone fills ---- */}
      <g>
        {floor.rooms.map((r) => (
          <rect
            key={`fill-${r.id}`}
            x={r.rect.x}
            y={r.rect.y}
            width={r.rect.w}
            height={r.rect.h}
            fill={r.outdoor ? 'none' : ZONE_TINT[r.zone]}
            stroke={r.outdoor ? faint : 'none'}
            strokeWidth={r.outdoor ? 22 : 0}
            strokeDasharray={r.outdoor ? '80 60' : undefined}
          />
        ))}
      </g>

      {/* ---- walls ---- */}
      <g strokeLinecap="square">
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
        {/* erase + draw openings on top */}
        {floor.openings.map((o, i) => (
          <OpeningMark key={`op-${i}`} o={o} ink={ink} bg={bg} theme={theme} />
        ))}
      </g>

      {/* ---- stair ---- */}
      {floor.stair && (
        <g stroke={ink} strokeWidth={30} fill="none">
          {floor.stair.treads.map((t, i) => (
            <line key={`tread-${i}`} x1={t[0].x} y1={t[0].y} x2={t[1].x} y2={t[1].y} />
          ))}
          <line
            x1={floor.stair.rect.x + floor.stair.rect.w / 2}
            y1={floor.stair.rect.y}
            x2={floor.stair.rect.x + floor.stair.rect.w / 2}
            y2={rectBottom(floor.stair.rect)}
            stroke={faint}
          />
        </g>
      )}

      {/* ---- labels ---- */}
      {showLabels && (
        <g textAnchor="middle">
          {floor.rooms.map((r) => {
            const c = rectCenter(r.rect)
            const short = Math.min(r.rect.w, r.rect.h)
            if (short < 1400) return null
            const nameSize = clampN(Math.min(520, (r.rect.w * 1.7) / r.name.length, short / 3.4), 260, 520)
            const showArea = short > 2000 && r.rect.h > 2600
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
      {showDimensions && (
        <g stroke={faint} strokeWidth={22} fill={faint} fontFamily="'IBM Plex Mono', monospace">
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
  if (o.orient === 'h') {
    const x1 = o.at.x - half
    const x2 = o.at.x + half
    return (
      <g>
        <line x1={x1} y1={o.at.y} x2={x2} y2={o.at.y} stroke={eraseColor} strokeWidth={eraseW} />
        {o.kind === 'window' ? (
          <>
            <line x1={x1} y1={o.at.y - 45} x2={x2} y2={o.at.y - 45} stroke={ink} strokeWidth={30} />
            <line x1={x1} y1={o.at.y + 45} x2={x2} y2={o.at.y + 45} stroke={ink} strokeWidth={30} />
          </>
        ) : (
          <>
            <line x1={x1} y1={o.at.y} x2={x1} y2={o.at.y + (o.swing ?? 1) * o.width} stroke={ink} strokeWidth={40} />
            <path
              d={`M ${x1} ${o.at.y + (o.swing ?? 1) * o.width} A ${o.width} ${o.width} 0 0 ${o.swing === -1 ? 1 : 0} ${x2} ${o.at.y}`}
              fill="none"
              stroke={o.kind === 'entry' ? ACCENT : ink}
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
          <line x1={o.at.x - 45} y1={y1} x2={o.at.x - 45} y2={y2} stroke={ink} strokeWidth={30} />
          <line x1={o.at.x + 45} y1={y1} x2={o.at.x + 45} y2={y2} stroke={ink} strokeWidth={30} />
        </>
      ) : (
        <>
          <line x1={o.at.x} y1={y1} x2={o.at.x + (o.swing ?? 1) * o.width} y2={y1} stroke={ink} strokeWidth={40} />
          <path
            d={`M ${o.at.x + (o.swing ?? 1) * o.width} ${y1} A ${o.width} ${o.width} 0 0 ${o.swing === -1 ? 0 : 1} ${o.at.x} ${y2}`}
            fill="none"
            stroke={o.kind === 'entry' ? ACCENT : ink}
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
