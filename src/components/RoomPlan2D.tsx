import { translate as translateUi, useLanguage } from '@/lib/i18n/index.ts'
import { useMemo, useState } from 'react'
import type { Design } from '@/lib/engine/types.ts'
import { roomFurnishing, type InteriorConfiguration } from '@/lib/interior/preview.ts'

export interface RoomPlan2DProps {
  design: Design
  roomId?: string
  roomName?: string
  floorLevel?: number
  density?: InteriorConfiguration['furnitureDensity']
  initialYaw?: number
  className?: string
}

/**
 * 2D architectural room floor-plan card.
 * Renders a lightweight, high-precision SVG top-view of the active room,
 * including wall boundaries, window slots, door swing arcs, all placed furniture,
 * and the 360° camera standing point with its view cone.
 */
export function RoomPlan2D({
  design,
  roomId,
  roomName,
  floorLevel = 0,
  density = 'medium',
  initialYaw,
  className = '',
}: RoomPlan2DProps) {
  useLanguage(s => s.language)
  const [expanded, setExpanded] = useState(false)

  const currentRoomName = roomName ?? design.floors.find(f => f.level === floorLevel)?.rooms.find(r => r.id === roomId)?.name ?? 'Room'

  const data = useMemo(() => {
    if (!roomId) return null
    try {
      return roomFurnishing(design, floorLevel, roomId, density)
    } catch (err) {
      console.warn('RoomPlan2D furnishing failed:', err)
      return null
    }
  }, [design, floorLevel, roomId, density])

  if (!data) return null

  const { dims, architecture, pieces, furniture, camera } = data
  const w = dims.w
  const d = dims.d
  const area = (w * d).toFixed(1)
  const pad = 0.52
  const viewBox = `${-pad} ${-pad} ${w + pad * 2} ${d + pad * 2}`

  // Camera marker calculations
  const camX = camera[0] + w / 2
  const camY = camera[2] + d / 2
  const defaultYaw = architecture.openings.find(o => o.kind === 'window')?.alongM !== undefined ? 0 : 180
  const yawDeg = initialYaw !== undefined ? initialYaw : defaultYaw
  const yawRad = (yawDeg * Math.PI) / 180
  const coneLen = Math.min(1.1, Math.max(0.6, Math.min(w, d) * 0.35))
  const a1 = yawRad - Math.PI / 5.5
  const a2 = yawRad + Math.PI / 5.5
  const c1x = camX + Math.sin(a1) * coneLen
  const c1y = camY - Math.cos(a1) * coneLen
  const c2x = camX + Math.sin(a2) * coneLen
  const c2y = camY - Math.cos(a2) * coneLen

  // Walls & openings segmentation
  const getOpeningsOnSide = (side: 'N' | 'S' | 'E' | 'W') =>
    architecture.openings
      .filter(o => o.side === side && o.alongM !== undefined)
      .map(o => {
        const alongM = o.alongM ?? 0
        const span = o.widthM
        const centre = (side === 'N' || side === 'S') ? alongM + w / 2 : alongM + d / 2
        return {
          ...o,
          start: Math.max(0, centre - span / 2),
          end: Math.min((side === 'N' || side === 'S') ? w : d, centre + span / 2),
          centre,
          span,
        }
      })
      .sort((a, b) => a.start - b.start)

  const openingsN = getOpeningsOnSide('N')
  const openingsS = getOpeningsOnSide('S')
  const openingsW = getOpeningsOnSide('W')
  const openingsE = getOpeningsOnSide('E')

  // Build wall lines skipping openings
  const buildWallSegments = (length: number, openings: ReturnType<typeof getOpeningsOnSide>) => {
    const segs: [number, number][] = []
    let cursor = 0
    for (const op of openings) {
      if (op.start > cursor + 0.02) {
        segs.push([cursor, op.start])
      }
      cursor = Math.max(cursor, op.end)
    }
    if (cursor < length - 0.02) {
      segs.push([cursor, length])
    }
    return segs
  }

  const wallsN = buildWallSegments(w, openingsN)
  const wallsS = buildWallSegments(w, openingsS)
  const wallsW = buildWallSegments(d, openingsW)
  const wallsE = buildWallSegments(d, openingsE)

  // Render SVG Plan Content
  const renderSvgPlan = () => (
    <svg
      role="img"
      aria-label={translateUi("2D architectural room floor plan")}
      className="h-full w-full select-none"
      viewBox={viewBox}
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        {/* Subtle grid pattern */}
        <pattern id="plan-grid" width="1" height="1" patternUnits="userSpaceOnUse">
          <path d="M 1 0 L 0 0 0 1" fill="none" stroke="rgba(23,23,23,0.04)" strokeWidth="0.02" />
        </pattern>
        {/* Direction cone gradient */}
        <radialGradient id="cam-cone-grad" cx="0%" cy="0%" r="100%">
          <stop offset="0%" stopColor="#e86b24" stopOpacity="0.32" />
          <stop offset="100%" stopColor="#e86b24" stopOpacity="0.02" />
        </radialGradient>
      </defs>

      {/* Room interior background & grid */}
      <rect x={0} y={0} width={w} height={d} fill="var(--color-bg-raised, #ffffff)" />
      <rect x={0} y={0} width={w} height={d} fill="url(#plan-grid)" />

      {/* Exterior wall thickness background */}
      <rect
        x={-0.08}
        y={-0.08}
        width={w + 0.16}
        height={d + 0.16}
        fill="none"
        stroke="rgba(23,23,23,0.06)"
        strokeWidth="0.16"
      />

      {/* Dimension Lines (Architectural ticks) */}
      {/* Top width dimension */}
      <g className="text-ink-faint">
        <line x1={0} y1={-0.28} x2={w} y2={-0.28} stroke="currentColor" strokeWidth="0.015" />
        <line x1={0} y1={-0.34} x2={0} y2={-0.22} stroke="currentColor" strokeWidth="0.015" />
        <line x1={w} y1={-0.34} x2={w} y2={-0.22} stroke="currentColor" strokeWidth="0.015" />
        <text
          x={w / 2}
          y={-0.32}
          textAnchor="middle"
          fontSize="0.16"
          fill="currentColor"
          fontFamily="var(--font-mono, monospace)"
          fontWeight="500"
        >
          {w.toFixed(2)} m
        </text>
      </g>

      {/* Left depth dimension */}
      <g className="text-ink-faint">
        <line x1={-0.28} y1={0} x2={-0.28} y2={d} stroke="currentColor" strokeWidth="0.015" />
        <line x1={-0.34} y1={0} x2={-0.22} y2={0} stroke="currentColor" strokeWidth="0.015" />
        <line x1={-0.34} y1={d} x2={-0.22} y2={d} stroke="currentColor" strokeWidth="0.015" />
        <text
          x={-0.33}
          y={d / 2}
          textAnchor="middle"
          fontSize="0.16"
          fill="currentColor"
          fontFamily="var(--font-mono, monospace)"
          fontWeight="500"
          transform={`rotate(-90, -0.33, ${d / 2})`}
        >
          {d.toFixed(2)} m
        </text>
      </g>

      {/* Solid Walls */}
      {/* North Wall Segments */}
      {wallsN.map(([x0, x1], i) => (
        <line key={`wn-${i}`} x1={x0} y1={0} x2={x1} y2={0} stroke="#171717" strokeWidth="0.08" strokeLinecap="square" />
      ))}
      {/* South Wall Segments */}
      {wallsS.map(([x0, x1], i) => (
        <line key={`ws-${i}`} x1={x0} y1={d} x2={x1} y2={d} stroke="#171717" strokeWidth="0.08" strokeLinecap="square" />
      ))}
      {/* West Wall Segments */}
      {wallsW.map(([y0, y1], i) => (
        <line key={`ww-${i}`} x1={0} y1={y0} x2={0} y2={y1} stroke="#171717" strokeWidth="0.08" strokeLinecap="square" />
      ))}
      {/* East Wall Segments */}
      {wallsE.map(([y0, y1], i) => (
        <line key={`we-${i}`} x1={w} y1={y0} x2={w} y2={y1} stroke="#171717" strokeWidth="0.08" strokeLinecap="square" />
      ))}

      {/* Openings (Windows & Doors) */}
      {/* North Openings */}
      {openingsN.map((op, i) =>
        op.kind === 'window' ? (
          <g key={`on-win-${i}`}>
            <line x1={op.start} y1={0} x2={op.end} y2={0} stroke="#8fa7b8" strokeWidth="0.08" />
            <line x1={op.start} y1={-0.02} x2={op.end} y2={-0.02} stroke="#3b627d" strokeWidth="0.015" />
            <line x1={op.start} y1={0.02} x2={op.end} y2={0.02} stroke="#3b627d" strokeWidth="0.015" />
          </g>
        ) : (
          <g key={`on-door-${i}`}>
            {/* Opening gap threshold */}
            <line x1={op.start} y1={0} x2={op.end} y2={0} stroke="rgba(23,23,23,0.15)" strokeWidth="0.015" strokeDasharray="0.04 0.04" />
            {/* Door swing arc into room (swings towards positive y) */}
            {op.span <= 1.2 && (
              <>
                <line x1={op.start} y1={0} x2={op.start} y2={op.span} stroke="#171717" strokeWidth="0.02" />
                <path
                  d={`M ${op.start} ${op.span} A ${op.span} ${op.span} 0 0 1 ${op.end} 0`}
                  fill="none"
                  stroke="#171717"
                  strokeWidth="0.015"
                  strokeDasharray="0.03 0.03"
                />
              </>
            )}
          </g>
        )
      )}

      {/* South Openings */}
      {openingsS.map((op, i) =>
        op.kind === 'window' ? (
          <g key={`os-win-${i}`}>
            <line x1={op.start} y1={d} x2={op.end} y2={d} stroke="#8fa7b8" strokeWidth="0.08" />
            <line x1={op.start} y1={d - 0.02} x2={op.end} y2={d - 0.02} stroke="#3b627d" strokeWidth="0.015" />
            <line x1={op.start} y1={d + 0.02} x2={op.end} y2={d + 0.02} stroke="#3b627d" strokeWidth="0.015" />
          </g>
        ) : (
          <g key={`os-door-${i}`}>
            <line x1={op.start} y1={d} x2={op.end} y2={d} stroke="rgba(23,23,23,0.15)" strokeWidth="0.015" strokeDasharray="0.04 0.04" />
            {op.span <= 1.2 && (
              <>
                <line x1={op.start} y1={d} x2={op.start} y2={d - op.span} stroke="#171717" strokeWidth="0.02" />
                <path
                  d={`M ${op.start} ${d - op.span} A ${op.span} ${op.span} 0 0 1 ${op.end} ${d}`}
                  fill="none"
                  stroke="#171717"
                  strokeWidth="0.015"
                  strokeDasharray="0.03 0.03"
                />
              </>
            )}
          </g>
        )
      )}

      {/* West Openings */}
      {openingsW.map((op, i) =>
        op.kind === 'window' ? (
          <g key={`ow-win-${i}`}>
            <line x1={0} y1={op.start} x2={0} y2={op.end} stroke="#8fa7b8" strokeWidth="0.08" />
            <line x1={-0.02} y1={op.start} x2={-0.02} y2={op.end} stroke="#3b627d" strokeWidth="0.015" />
            <line x1={0.02} y1={op.start} x2={0.02} y2={op.end} stroke="#3b627d" strokeWidth="0.015" />
          </g>
        ) : (
          <g key={`ow-door-${i}`}>
            <line x1={0} y1={op.start} x2={0} y2={op.end} stroke="rgba(23,23,23,0.15)" strokeWidth="0.015" strokeDasharray="0.04 0.04" />
            {op.span <= 1.2 && (
              <>
                <line x1={0} y1={op.start} x2={op.span} y2={op.start} stroke="#171717" strokeWidth="0.02" />
                <path
                  d={`M ${op.span} ${op.start} A ${op.span} ${op.span} 0 0 1 0 ${op.end}`}
                  fill="none"
                  stroke="#171717"
                  strokeWidth="0.015"
                  strokeDasharray="0.03 0.03"
                />
              </>
            )}
          </g>
        )
      )}

      {/* East Openings */}
      {openingsE.map((op, i) =>
        op.kind === 'window' ? (
          <g key={`oe-win-${i}`}>
            <line x1={w} y1={op.start} x2={w} y2={op.end} stroke="#8fa7b8" strokeWidth="0.08" />
            <line x1={w - 0.02} y1={op.start} x2={w - 0.02} y2={op.end} stroke="#3b627d" strokeWidth="0.015" />
            <line x1={w + 0.02} y1={op.start} x2={w + 0.02} y2={op.end} stroke="#3b627d" strokeWidth="0.015" />
          </g>
        ) : (
          <g key={`oe-door-${i}`}>
            <line x1={w} y1={op.start} x2={w} y2={op.end} stroke="rgba(23,23,23,0.15)" strokeWidth="0.015" strokeDasharray="0.04 0.04" />
            {op.span <= 1.2 && (
              <>
                <line x1={w} y1={op.start} x2={w - op.span} y2={op.start} stroke="#171717" strokeWidth="0.02" />
                <path
                  d={`M ${w - op.span} ${op.start} A ${op.span} ${op.span} 0 0 1 ${w} ${op.end}`}
                  fill="none"
                  stroke="#171717"
                  strokeWidth="0.015"
                  strokeDasharray="0.03 0.03"
                />
              </>
            )}
          </g>
        )
      )}

      {/* Furniture Pieces (Living, Dining, Bedroom, Study) */}
      {pieces.map((p, idx) => {
        const cx = p.x + w / 2
        const cy = p.z + d / 2
        const isAligned = p.face === 'N' || p.face === 'S'
        const pw = isAligned ? p.w : p.d
        const pd = isAligned ? p.d : p.w
        const px = cx - pw / 2
        const py = cy - pd / 2

        if (p.type === 'rug') {
          return (
            <rect
              key={`rug-${idx}`}
              x={px}
              y={py}
              width={pw}
              height={pd}
              rx="0.04"
              fill="#f5f0e8"
              fillOpacity="0.8"
              stroke="#cfc5b4"
              strokeWidth="0.015"
              strokeDasharray="0.05 0.03"
            />
          )
        }

        if (p.type === 'pendant') {
          return (
            <g key={`pendant-${idx}`}>
              <circle cx={cx} cy={cy} r="0.14" fill="none" stroke="#e86b24" strokeWidth="0.015" strokeDasharray="0.03 0.02" />
              <circle cx={cx} cy={cy} r="0.04" fill="#e86b24" />
            </g>
          )
        }

        if (p.type === 'plant') {
          return (
            <g key={`plant-${idx}`}>
              <circle cx={cx} cy={cy} r={Math.min(pw, pd) / 2} fill="#d2decb" stroke="#53734b" strokeWidth="0.02" />
              <circle cx={cx} cy={cy} r={Math.min(pw, pd) / 3.5} fill="#53734b" />
            </g>
          )
        }

        if (p.type === 'dining-table') {
          return (
            <g key={`table-${idx}`}>
              <rect x={px} y={py} width={pw} height={pd} rx="0.06" fill="#e6dbca" stroke="#171717" strokeWidth="0.025" />
              <line x1={px + 0.12} y1={cy} x2={px + pw - 0.12} y2={cy} stroke="#b09f87" strokeWidth="0.015" strokeDasharray="0.04 0.03" />
            </g>
          )
        }

        if (p.type === 'dining-chair') {
          return (
            <rect
              key={`chair-${idx}`}
              x={px}
              y={py}
              width={pw}
              height={pd}
              rx="0.04"
              fill="#d9ccb8"
              stroke="#171717"
              strokeWidth="0.018"
            />
          )
        }

        if (p.type === 'bed') {
          const pillowSize = Math.min(0.5, pw * 0.38)
          return (
            <g key={`bed-${idx}`}>
              <rect x={px} y={py} width={pw} height={pd} rx="0.05" fill="#f0ebe1" stroke="#171717" strokeWidth="0.03" />
              {/* Pillows */}
              <rect x={px + 0.08} y={py + 0.06} width={pillowSize} height={0.28} rx="0.03" fill="#ffffff" stroke="#999" strokeWidth="0.015" />
              {pw > 1.2 && (
                <rect x={px + pw - pillowSize - 0.08} y={py + 0.06} width={pillowSize} height={0.28} rx="0.03" fill="#ffffff" stroke="#999" strokeWidth="0.015" />
              )}
              {/* Duvet fold */}
              <line x1={px} y1={py + pd * 0.42} x2={px + pw} y2={py + pd * 0.42} stroke="#b0a799" strokeWidth="0.015" />
            </g>
          )
        }

        if (p.type === 'sofa') {
          return (
            <g key={`sofa-${idx}`}>
              <rect x={px} y={py} width={pw} height={pd} rx="0.06" fill="#e2ded4" stroke="#171717" strokeWidth="0.025" />
              {/* Backrest & armrests */}
              <rect x={px} y={py} width={pw} height={Math.min(0.2, pd * 0.25)} fill="#cec7ba" stroke="#171717" strokeWidth="0.015" />
              <rect x={px} y={py} width={Math.min(0.18, pw * 0.12)} height={pd} fill="#cec7ba" stroke="#171717" strokeWidth="0.015" />
              <rect x={px + pw - Math.min(0.18, pw * 0.12)} y={py} width={Math.min(0.18, pw * 0.12)} height={pd} fill="#cec7ba" stroke="#171717" strokeWidth="0.015" />
            </g>
          )
        }

        if (p.type === 'coffee-table') {
          return (
            <rect
              key={`ctable-${idx}`}
              x={px}
              y={py}
              width={pw}
              height={pd}
              rx="0.08"
              fill="#ede7dc"
              stroke="#171717"
              strokeWidth="0.02"
            />
          )
        }

        if (p.type === 'desk') {
          return (
            <g key={`desk-${idx}`}>
              <rect x={px} y={py} width={pw} height={pd} rx="0.04" fill="#e8dfd3" stroke="#171717" strokeWidth="0.025" />
              {/* Laptop / Monitor outline */}
              <line x1={cx - Math.min(0.25, pw * 0.25)} y1={cy} x2={cx + Math.min(0.25, pw * 0.25)} y2={cy} stroke="#736e65" strokeWidth="0.02" strokeLinecap="round" />
            </g>
          )
        }

        if (p.type === 'chair') {
          return (
            <rect key={`chair-${idx}`} x={px} y={py} width={pw} height={pd} rx="0.04" fill="#dfd4c4" stroke="#171717" strokeWidth="0.02" />
          )
        }

        if (p.type === 'armchair') {
          return (
            <g key={`armchair-${idx}`}>
              <rect x={px} y={py} width={pw} height={pd} rx="0.06" fill="#e2ddd2" stroke="#171717" strokeWidth="0.022" />
              <rect x={px} y={py} width={pw} height={Math.min(0.18, pd * 0.28)} fill="#cec8bc" stroke="#171717" strokeWidth="0.015" />
              <rect x={px} y={py} width={Math.min(0.12, pw * 0.18)} height={pd} fill="#cec8bc" stroke="#171717" strokeWidth="0.015" />
              <rect x={px + pw - Math.min(0.12, pw * 0.18)} y={py} width={Math.min(0.12, pw * 0.18)} height={pd} fill="#cec8bc" stroke="#171717" strokeWidth="0.015" />
            </g>
          )
        }

        if (p.type === 'bookshelf') {
          return (
            <g key={`shelf-${idx}`}>
              <rect x={px} y={py} width={pw} height={pd} fill="#ded6c8" stroke="#171717" strokeWidth="0.022" />
              <line x1={px + pw * 0.33} y1={py} x2={px + pw * 0.33} y2={py + pd} stroke="#a89f91" strokeWidth="0.012" />
              <line x1={px + pw * 0.67} y1={py} x2={px + pw * 0.67} y2={py + pd} stroke="#a89f91" strokeWidth="0.012" />
            </g>
          )
        }

        if (p.type === 'tv-unit') {
          return (
            <g key={`tvu-${idx}`}>
              <rect x={px} y={py} width={pw} height={pd} rx="0.02" fill="#ded7cb" stroke="#171717" strokeWidth="0.02" />
              <line x1={px + 0.15} y1={cy} x2={px + pw - 0.15} y2={cy} stroke="#171717" strokeWidth="0.02" strokeLinecap="round" />
            </g>
          )
        }

        if (p.type === 'nightstand') {
          return (
            <g key={`ns-${idx}`}>
              <rect x={px} y={py} width={pw} height={pd} rx="0.03" fill="#e8e2d8" stroke="#171717" strokeWidth="0.02" />
              <circle cx={cx} cy={cy} r={Math.min(pw, pd) * 0.22} fill="none" stroke="#e86b24" strokeWidth="0.015" opacity="0.6" />
            </g>
          )
        }

        if (p.type === 'wardrobe') {
          return (
            <g key={`wardrobe-${idx}`}>
              <rect x={px} y={py} width={pw} height={pd} fill="#ded7cb" stroke="#171717" strokeWidth="0.025" />
              <line x1={px} y1={py} x2={px + pw} y2={py + pd} stroke="#b8af9f" strokeWidth="0.01" />
              <line x1={px} y1={py + pd} x2={px + pw} y2={py} stroke="#b8af9f" strokeWidth="0.01" />
            </g>
          )
        }

        // Standard furniture fallback
        return (
          <rect
            key={`furn-${idx}`}
            x={px}
            y={py}
            width={pw}
            height={pd}
            rx="0.02"
            fill="#ded8cd"
            stroke="#171717"
            strokeWidth="0.02"
          />
        )
      })}

      {/* Fixtures & Kitchen/Bath Furniture (if pieces is empty) */}
      {pieces.length === 0 &&
        furniture
          .filter(f => f.pos[1] < 1.0)
          .map((f, idx) => {
            const cx = f.pos[0] + w / 2
            const cy = f.pos[2] + d / 2
            const pw = f.size[0]
            const pd = f.size[2]
            const px = cx - pw / 2
            const py = cy - pd / 2
            const isWc = f.id.includes('wc') || f.id.includes('toilet')
            const isSink = f.id.includes('sink') || f.id.includes('basin')
            const isCounter = f.id.includes('counter') || f.id.includes('vanity') || f.id.includes('top')

            if (isWc) {
              return (
                <g key={`wc-${idx}`}>
                  {/* Cistern Tank */}
                  <rect x={px} y={py} width={pw} height={Math.min(0.2, pd * 0.35)} rx="0.02" fill="#ffffff" stroke="#171717" strokeWidth="0.02" />
                  {/* Bowl Oval */}
                  <ellipse cx={cx} cy={py + pd * 0.65} rx={pw * 0.38} ry={pd * 0.32} fill="#ffffff" stroke="#171717" strokeWidth="0.02" />
                  <ellipse cx={cx} cy={py + pd * 0.65} rx={pw * 0.25} ry={pd * 0.22} fill="none" stroke="#a0a0a0" strokeWidth="0.015" />
                </g>
              )
            }

            return (
              <g key={`fixed-${idx}`}>
                <rect x={px} y={py} width={pw} height={pd} rx="0.03" fill={isCounter ? '#e8e2d5' : '#e5ded2'} stroke="#171717" strokeWidth="0.022" />
                {isSink && (
                  <ellipse cx={cx} cy={cy} rx={Math.min(pw, pd) * 0.32} ry={Math.min(pw, pd) * 0.24} fill="#ffffff" stroke="#777" strokeWidth="0.018" />
                )}
              </g>
            )
          })}

      {/* 360° Observer Standing Point & View Direction Cone */}
      <g id="camera-marker">
        {/* View Cone */}
        <path
          d={`M ${camX} ${camY} L ${c1x} ${c1y} A ${coneLen} ${coneLen} 0 0 1 ${c2x} ${c2y} Z`}
          fill="#e86b24"
          fillOpacity="0.22"
          stroke="#e86b24"
          strokeWidth="0.015"
          strokeDasharray="0.04 0.02"
        />
        {/* Sight pointer needle indicating direction of vision */}
        <line
          x1={camX}
          y1={camY}
          x2={camX + Math.sin(yawRad) * (coneLen * 0.95)}
          y2={camY - Math.cos(yawRad) * (coneLen * 0.95)}
          stroke="#e86b24"
          strokeWidth="0.02"
          strokeLinecap="round"
        />
        {/* Outer Ring */}
        <circle cx={camX} cy={camY} r="0.16" fill="none" stroke="#e86b24" strokeWidth="0.025" opacity="0.75" />
        {/* Center Point */}
        <circle cx={camX} cy={camY} r="0.08" fill="#e86b24" />
      </g>
    </svg>
  )

  return (
    <>
      <div
        className={`group relative overflow-hidden border border-line bg-bg-raised p-2 shadow-xs transition-colors hover:border-line-strong ${className}`}
        aria-label={translateUi("2D room model")}
      >
        {/* Header Bar */}
        <div className="flex items-center justify-between border-b border-line pb-1 text-xs">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="inline-block h-2 w-2 rounded-full bg-accent flex-none" />
            <span className="font-mono font-medium uppercase tracking-wider text-ink truncate text-[11px]">
              {translateUi("2D Plan")} · {currentRoomName}
            </span>
          </div>
          <div className="flex items-center gap-2 flex-none">
            <span className="font-mono text-ink-dim text-[10px]">{area} m²</span>
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="rounded border border-line px-1.5 py-0.5 text-[10px] text-ink-dim hover:bg-bg-inset hover:text-ink transition-colors"
              title={translateUi("Expand 2D Plan")}
            >
              {translateUi("Expand ↗")}
            </button>
          </div>
        </div>

        {/* 2D SVG Viewport */}
        <div className="h-[76px] w-full flex items-center justify-center my-0.5">
          {renderSvgPlan()}
        </div>

        {/* Compact Blueprint Legend */}
        <div className="flex flex-wrap items-center justify-between gap-1 border-t border-line/50 pt-0.5 font-mono text-[9px] text-ink-dim">
          <span className="flex items-center gap-1">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-[#e86b24]" />
            {translateUi("360° view")}
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-1 w-2.5 bg-[#8fa7b8]" />
            {translateUi("Window")}
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-1.5 w-2 rounded-xs bg-[#e6dbca] border border-[#171717]" />
            {translateUi("Furniture")}
          </span>
        </div>
      </div>

      {/* Expanded Modal for Detailed Viewing */}
      {expanded && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs"
          onClick={() => setExpanded(false)}
        >
          <div
            className="relative w-full max-w-2xl rounded-sm border border-line bg-bg-raised p-6 shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-line pb-3">
              <div>
                <h3 className="font-display text-xl text-ink">
                  {currentRoomName} · {translateUi("2D Floor Plan")}
                </h3>
                <p className="mt-0.5 font-mono text-xs text-ink-dim">
                  {w.toFixed(2)} × {d.toFixed(2)} m · {area} m² · Level {floorLevel}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setExpanded(false)}
                className="rounded border border-line px-3 py-1 text-xs hover:bg-bg-inset transition-colors"
              >
                {translateUi("Close ✕")}
              </button>
            </div>

            <div className="mt-4 h-[440px] w-full flex items-center justify-center p-2 bg-bg-inset/40 rounded border border-line/60">
              {renderSvgPlan()}
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between border-t border-line pt-3 text-xs text-ink-dim">
              <div className="flex items-center gap-3">
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#e86b24]" />
                  {translateUi("360° Camera Viewpoint & Direction")}
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-1.5 w-3.5 bg-[#8fa7b8]" />
                  {translateUi("Window with sill")}
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-2 w-3 rounded-xs bg-[#e6dbca] border border-[#171717]" />
                  {translateUi("Furniture layout")}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setExpanded(false)}
                className="text-xs underline underline-offset-2"
              >
                {translateUi("Done")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
