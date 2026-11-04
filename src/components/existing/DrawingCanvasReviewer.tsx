import { useState, useRef, useCallback, useMemo } from 'react'
import {
  ZoomIn,
  ZoomOut,
  Maximize2,
  Undo2,
  Redo2,
  Ruler,
  AlertCircle,
  Eye,
  Plus,
  Trash2,
  DoorOpen,
  Square,
} from 'lucide-react'
import { type RawSurvey, type RawSurveyRoom, type RawSurveyWall, type RawSurveyOpening, type ImagePointPx } from '@/lib/existing/digitizer.ts'
import { parseDimension, sqmToGuntha } from '@/lib/existing/units.ts'
import { Button } from '@/components/ui/Button.tsx'
import { cx } from '@/lib/cx.ts'

export const INDIAN_ROOM_TYPES = [
  { value: 'living', label: 'Living Room' },
  { value: 'bed', label: 'Bedroom' },
  { value: 'master_bed', label: 'Master Bedroom' },
  { value: 'kitchen', label: 'Kitchen' },
  { value: 'dining', label: 'Dining' },
  { value: 'pooja', label: 'Pooja' },
  { value: 'bath', label: 'Toilet / Bath' },
  { value: 'store', label: 'Store' },
  { value: 'corridor', label: 'Lobby / Corridor' },
  { value: 'stair', label: 'Staircase' },
  { value: 'balcony', label: 'Balcony' },
  { value: 'utility', label: 'Utility' },
] as const

interface DrawingCanvasReviewerProps {
  imageUrl: string
  rawSurvey: RawSurvey
  scaleMPerPx: number
  onChangeSurvey: (survey: RawSurvey) => void
  onChangeScale: (newScaleMPerPx: number) => void
  plotWidthM?: number | null
  plotDepthM?: number | null
}

type Tool = 'select' | 'calibrate' | 'add-room' | 'add-wall' | 'add-door' | 'add-window'

interface DragState {
  type: 'room-corner' | 'room-move' | 'wall-endpoint' | 'opening-move'
  elementId: string
  handle?: string // e.g., 'tl', 'tr', 'bl', 'br', 'a', 'b'
  startX: number
  startY: number
  initialPos: Record<string, number>
}

export function DrawingCanvasReviewer({
  imageUrl,
  rawSurvey,
  scaleMPerPx,
  onChangeSurvey,
  onChangeScale,
  plotWidthM,
  plotDepthM,
}: DrawingCanvasReviewerProps) {
  // 1. History Stack for 50-step Undo/Redo
  const [history, setHistory] = useState<RawSurvey[]>([rawSurvey])
  const [historyIndex, setHistoryIndex] = useState(0)

  // 2. Viewport Transform (Pan & Zoom)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [isPanning, setIsPanning] = useState(false)
  const panStartRef = useRef({ x: 0, y: 0 })

  // 3. UI Controls
  const [activeTool, setActiveTool] = useState<Tool>('select')
  const [overlayOpacity, setOverlayOpacity] = useState(0.55)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedType, setSelectedType] = useState<'room' | 'wall' | 'opening' | null>(null)
  const [showNeedsReviewDrawer, setShowNeedsReviewDrawer] = useState(true)

  // 4. Two-Point Calibration Tool State
  const [calibPointA, setCalibPointA] = useState<ImagePointPx | null>(null)
  const [calibPointB, setCalibPointB] = useState<ImagePointPx | null>(null)
  const [calibInput, setCalibInput] = useState('')
  const [calibError, setCalibError] = useState<string | null>(null)

  // 5. Dragging State
  const [dragState, setDragState] = useState<DragState | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)

  // Push new state to history stack (max 50)
  const pushState = useCallback((newSurvey: RawSurvey) => {
    setHistory((prev) => {
      const next = prev.slice(0, historyIndex + 1)
      next.push(structuredClone(newSurvey))
      if (next.length > 50) next.shift()
      return next
    })
    setHistoryIndex((prev) => Math.min(prev + 1, 49))
    onChangeSurvey(newSurvey)
  }, [historyIndex, onChangeSurvey])

  const handleUndo = useCallback(() => {
    if (historyIndex > 0) {
      const prevIdx = historyIndex - 1
      setHistoryIndex(prevIdx)
      onChangeSurvey(history[prevIdx])
    }
  }, [historyIndex, history, onChangeSurvey])

  const handleRedo = useCallback(() => {
    if (historyIndex < history.length - 1) {
      const nextIdx = historyIndex + 1
      setHistoryIndex(nextIdx)
      onChangeSurvey(history[nextIdx])
    }
  }, [historyIndex, history, onChangeSurvey])

  // Low confidence items (< 0.7) for "Needs review" side panel
  const lowConfidenceItems = useMemo(() => {
    const items: { id: string; type: 'room' | 'wall' | 'opening'; label: string; confidence: number }[] = []
    for (const r of rawSurvey.elements.rooms) {
      if (r.confidence < 0.7) items.push({ id: r.id, type: 'room', label: r.name || 'Room', confidence: r.confidence })
    }
    for (const w of rawSurvey.elements.walls) {
      if (w.confidence < 0.7) items.push({ id: w.id, type: 'wall', label: `Wall (${w.kind})`, confidence: w.confidence })
    }
    for (const o of rawSurvey.elements.openings) {
      if (o.confidence < 0.7) items.push({ id: o.id, type: 'opening', label: `${o.kind} opening`, confidence: o.confidence })
    }
    return items
  }, [rawSurvey])

  // Coordinate conversion helper: client mouse to SVG image-space px
  const clientToImageCoords = useCallback((clientX: number, clientY: number): ImagePointPx | null => {
    if (!svgRef.current) return null
    const pt = svgRef.current.createSVGPoint()
    pt.x = clientX
    pt.y = clientY
    const ctm = svgRef.current.getScreenCTM()
    if (!ctm) return null
    const svgPt = pt.matrixTransform(ctm.inverse())
    return { x: Math.round(svgPt.x), y: Math.round(svgPt.y) }
  }, [])

  // Canvas zoom via wheel
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    const zoomFactor = e.deltaY < 0 ? 1.15 : 0.87
    setZoom((z) => Math.max(0.2, Math.min(6, +(z * zoomFactor).toFixed(2))))
  }

  // Calibration tool point selection
  const handleCalibrationClick = (pt: ImagePointPx) => {
    if (!calibPointA) {
      setCalibPointA(pt)
    } else if (!calibPointB) {
      setCalibPointB(pt)
    } else {
      // Reset and pick first point again
      setCalibPointA(pt)
      setCalibPointB(null)
      setCalibInput('')
      setCalibError(null)
    }
  }

  const applyCalibration = () => {
    if (!calibPointA || !calibPointB) return
    const parsed = parseDimension(calibInput)
    if (!parsed || parsed.meters <= 0) {
      setCalibError('Enter a valid length (e.g. "30 ft", "9.1 m", "9\'6"").')
      return
    }
    const pixelDist = Math.hypot(calibPointB.x - calibPointA.x, calibPointB.y - calibPointA.y)
    if (pixelDist < 10) {
      setCalibError('Points are too close together. Pick two distant points for accurate scale.')
      return
    }
    const newScale = +(parsed.meters / pixelDist).toFixed(6)
    onChangeScale(newScale)
    setCalibPointA(null)
    setCalibPointB(null)
    setCalibInput('')
    setCalibError(null)
    setActiveTool('select')
  }

  // Pointer Down (Pan or Start Drag)
  const handlePointerDown = (e: React.PointerEvent) => {
    // Middle click or space+click starts panning
    if (e.button === 1 || e.shiftKey) {
      setIsPanning(true)
      panStartRef.current = { x: e.clientX - pan.x, y: e.clientY - pan.y }
      return
    }

    const imgPt = clientToImageCoords(e.clientX, e.clientY)
    if (!imgPt) return

    if (activeTool === 'calibrate') {
      handleCalibrationClick(imgPt)
      return
    }

    if (activeTool === 'add-room') {
      const newRoom: RawSurveyRoom = {
        id: `r-${Date.now()}`,
        name: 'New Room',
        type: 'living',
        box: { x: imgPt.x, y: imgPt.y, w: Math.round(3.5 / scaleMPerPx), h: Math.round(3.5 / scaleMPerPx) },
        confidence: 1.0,
      }
      const updated = structuredClone(rawSurvey)
      updated.elements.rooms.push(newRoom)
      pushState(updated)
      setSelectedId(newRoom.id)
      setSelectedType('room')
      setActiveTool('select')
      return
    }

    if (activeTool === 'add-wall') {
      const newWall: RawSurveyWall = {
        id: `w-${Date.now()}`,
        a: { x: imgPt.x, y: imgPt.y },
        b: { x: imgPt.x + Math.round(4 / scaleMPerPx), y: imgPt.y },
        kind: 'interior',
        confidence: 1.0,
      }
      const updated = structuredClone(rawSurvey)
      updated.elements.walls.push(newWall)
      pushState(updated)
      setSelectedId(newWall.id)
      setSelectedType('wall')
      setActiveTool('select')
      return
    }

    if (activeTool === 'add-door' || activeTool === 'add-window') {
      const kind = activeTool === 'add-door' ? 'door' : 'window'
      const newOpening: RawSurveyOpening = {
        id: `o-${Date.now()}`,
        kind,
        orient: 'h',
        at: { x: imgPt.x, y: imgPt.y },
        widthPx: Math.round((kind === 'door' ? 0.9 : 1.2) / scaleMPerPx),
        swing: 1,
        confidence: 1.0,
      }
      const updated = structuredClone(rawSurvey)
      updated.elements.openings.push(newOpening)
      pushState(updated)
      setSelectedId(newOpening.id)
      setSelectedType('opening')
      setActiveTool('select')
      return
    }
  }

  // Pointer Move (Panning or Dragging)
  const handlePointerMove = (e: React.PointerEvent) => {
    if (isPanning) {
      setPan({
        x: e.clientX - panStartRef.current.x,
        y: e.clientY - panStartRef.current.y,
      })
      return
    }

    if (dragState) {
      const pt = clientToImageCoords(e.clientX, e.clientY)
      if (!pt) return

      const updated = structuredClone(rawSurvey)
      const dx = pt.x - dragState.startX
      const dy = pt.y - dragState.startY

      if (dragState.type === 'room-corner' && dragState.handle) {
        const room = updated.elements.rooms.find((r) => r.id === dragState.elementId)
        if (room) {
          const init = dragState.initialPos
          if (dragState.handle === 'br') {
            room.box.w = Math.max(20, init.w + dx)
            room.box.h = Math.max(20, init.h + dy)
          } else if (dragState.handle === 'tr') {
            room.box.y = init.y + dy
            room.box.w = Math.max(20, init.w + dx)
            room.box.h = Math.max(20, init.h - dy)
          } else if (dragState.handle === 'bl') {
            room.box.x = init.x + dx
            room.box.w = Math.max(20, init.w - dx)
            room.box.h = Math.max(20, init.h + dy)
          } else if (dragState.handle === 'tl') {
            room.box.x = init.x + dx
            room.box.y = init.y + dy
            room.box.w = Math.max(20, init.w - dx)
            room.box.h = Math.max(20, init.h - dy)
          }
          onChangeSurvey(updated)
        }
      } else if (dragState.type === 'room-move') {
        const room = updated.elements.rooms.find((r) => r.id === dragState.elementId)
        if (room) {
          room.box.x = dragState.initialPos.x + dx
          room.box.y = dragState.initialPos.y + dy
          onChangeSurvey(updated)
        }
      } else if (dragState.type === 'wall-endpoint' && dragState.handle) {
        const wall = updated.elements.walls.find((w) => w.id === dragState.elementId)
        if (wall) {
          if (dragState.handle === 'a') {
            wall.a.x = dragState.initialPos.ax + dx
            wall.a.y = dragState.initialPos.ay + dy
          } else if (dragState.handle === 'b') {
            wall.b.x = dragState.initialPos.bx + dx
            wall.b.y = dragState.initialPos.by + dy
          }
          onChangeSurvey(updated)
        }
      } else if (dragState.type === 'opening-move') {
        const opening = updated.elements.openings.find((o) => o.id === dragState.elementId)
        if (opening) {
          opening.at.x = dragState.initialPos.x + dx
          opening.at.y = dragState.initialPos.y + dy
          onChangeSurvey(updated)
        }
      }
    }
  }

  // Pointer Up: commit drag to history stack
  const handlePointerUp = () => {
    if (isPanning) setIsPanning(false)
    if (dragState) {
      setDragState(null)
      pushState(rawSurvey)
    }
  }

  // Start dragging a room corner
  const startRoomCornerDrag = (
    e: React.PointerEvent,
    roomId: string,
    handle: string,
    box: RawSurveyRoom['box']
  ) => {
    e.stopPropagation()
    const pt = clientToImageCoords(e.clientX, e.clientY)
    if (!pt) return
    setDragState({
      type: 'room-corner',
      elementId: roomId,
      handle,
      startX: pt.x,
      startY: pt.y,
      initialPos: { ...box },
    })
  }

  // Delete selected item
  const handleDeleteSelected = () => {
    if (!selectedId) return
    const updated = structuredClone(rawSurvey)
    if (selectedType === 'room') {
      updated.elements.rooms = updated.elements.rooms.filter((r) => r.id !== selectedId)
    } else if (selectedType === 'wall') {
      updated.elements.walls = updated.elements.walls.filter((w) => w.id !== selectedId)
    } else if (selectedType === 'opening') {
      updated.elements.openings = updated.elements.openings.filter((o) => o.id !== selectedId)
    }
    setSelectedId(null)
    setSelectedType(null)
    pushState(updated)
  }

  // Live estimated building footprint size in metres
  const footprintM = useMemo(() => {
    const W = rawSurvey.imageWidth * scaleMPerPx
    const H = rawSurvey.imageHeight * scaleMPerPx
    return { w: +W.toFixed(2), h: +H.toFixed(2) }
  }, [rawSurvey.imageWidth, rawSurvey.imageHeight, scaleMPerPx])

  const selectedRoom = useMemo(
    () => rawSurvey.elements.rooms.find((r) => r.id === selectedId),
    [rawSurvey.elements.rooms, selectedId]
  )

  const selectedOpening = useMemo(
    () => rawSurvey.elements.openings.find((o) => o.id === selectedId),
    [rawSurvey.elements.openings, selectedId]
  )

  const selectedWall = useMemo(
    () => rawSurvey.elements.walls.find((w) => w.id === selectedId),
    [rawSurvey.elements.walls, selectedId]
  )

  return (
    <div
      ref={containerRef}
      className="relative flex flex-col h-[750px] w-full rounded-2xl border border-line bg-surface overflow-hidden select-none"
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
    >
      {/* 1. TOP TOOLBAR */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 border-b border-line bg-surface-elevated z-10 text-xs">
        {/* Left tools */}
        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            variant={activeTool === 'select' ? 'primary' : 'ghost'}
            onClick={() => setActiveTool('select')}
            title="Select and drag elements"
          >
            Select
          </Button>

          <Button
            size="sm"
            variant={activeTool === 'calibrate' ? 'primary' : 'ghost'}
            onClick={() => {
              setActiveTool('calibrate')
              setCalibPointA(null)
              setCalibPointB(null)
              setCalibError(null)
            }}
            title="Calibrate drawing scale with 2 points"
            className="flex items-center gap-1"
          >
            <Ruler size={13} />
            <span>Calibrate Scale</span>
          </Button>

          <div className="h-4 w-px bg-line mx-1" />

          <Button
            size="sm"
            variant={activeTool === 'add-room' ? 'primary' : 'ghost'}
            onClick={() => setActiveTool('add-room')}
            className="flex items-center gap-1"
            title="Click to place a new room"
          >
            <Square size={13} />
            <span>+ Room</span>
          </Button>

          <Button
            size="sm"
            variant={activeTool === 'add-wall' ? 'primary' : 'ghost'}
            onClick={() => setActiveTool('add-wall')}
            className="flex items-center gap-1"
            title="Click to place a wall segment"
          >
            <Plus size={13} />
            <span>+ Wall</span>
          </Button>

          <Button
            size="sm"
            variant={activeTool === 'add-door' ? 'primary' : 'ghost'}
            onClick={() => setActiveTool('add-door')}
            className="flex items-center gap-1"
            title="Click to place a door"
          >
            <DoorOpen size={13} />
            <span>+ Door</span>
          </Button>

          <Button
            size="sm"
            variant={activeTool === 'add-window' ? 'primary' : 'ghost'}
            onClick={() => setActiveTool('add-window')}
            className="flex items-center gap-1"
            title="Click to place a window"
          >
            <Plus size={13} />
            <span>+ Window</span>
          </Button>
        </div>

        {/* Center: Live Scale info */}
        <div className="hidden lg:flex items-center gap-3 font-mono text-[0.72rem] text-ink-muted">
          <span>Scale: 1 px = {(scaleMPerPx * 1000).toFixed(1)} mm</span>
          <span>·</span>
          <span>
            Drawing: {footprintM.w} × {footprintM.h} m
          </span>
          {plotWidthM && plotDepthM && (
            <>
              <span>·</span>
              <span>
                Plot: {plotWidthM} × {plotDepthM} m ({sqmToGuntha(plotWidthM * plotDepthM)} Guntha)
              </span>
            </>
          )}
        </div>

        {/* Right actions */}
        <div className="flex items-center gap-2">
          {/* Opacity slider */}
          <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-bg-inset border border-line">
            <Eye size={12} className="text-ink-muted" />
            <input
              type="range"
              min="0.1"
              max="1.0"
              step="0.05"
              value={overlayOpacity}
              onChange={(e) => setOverlayOpacity(parseFloat(e.target.value))}
              className="w-16 accent-accent h-1"
              title="Overlay opacity"
            />
            <span className="font-mono text-[0.65rem] text-ink-muted w-6 text-right">
              {Math.round(overlayOpacity * 100)}%
            </span>
          </div>

          {/* Undo / Redo */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={historyIndex <= 0}
              onClick={handleUndo}
              className="p-1.5 rounded hover:bg-bg-inset disabled:opacity-30 transition-colors"
              title="Undo (Ctrl+Z)"
            >
              <Undo2 size={14} />
            </button>
            <button
              type="button"
              disabled={historyIndex >= history.length - 1}
              onClick={handleRedo}
              className="p-1.5 rounded hover:bg-bg-inset disabled:opacity-30 transition-colors"
              title="Redo (Ctrl+Y)"
            >
              <Redo2 size={14} />
            </button>
          </div>

          {/* Zoom controls */}
          <div className="flex items-center gap-1 border-l border-line pl-2">
            <button
              type="button"
              onClick={() => setZoom((z) => Math.min(6, +(z * 1.2).toFixed(2)))}
              className="p-1.5 rounded hover:bg-bg-inset"
              title="Zoom In"
            >
              <ZoomIn size={14} />
            </button>
            <span className="font-mono text-[0.68rem] text-ink-muted w-9 text-center">
              {Math.round(zoom * 100)}%
            </span>
            <button
              type="button"
              onClick={() => setZoom((z) => Math.max(0.2, +(z / 1.2).toFixed(2)))}
              className="p-1.5 rounded hover:bg-bg-inset"
              title="Zoom Out"
            >
              <ZoomOut size={14} />
            </button>
            <button
              type="button"
              onClick={() => {
                setZoom(1)
                setPan({ x: 0, y: 0 })
              }}
              className="p-1.5 rounded hover:bg-bg-inset"
              title="Reset Zoom"
            >
              <Maximize2 size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* 2. CALIBRATION BANNER (active when calibrating) */}
      {activeTool === 'calibrate' && (
        <div className="absolute top-12 left-4 right-4 z-20 flex flex-wrap items-center justify-between gap-3 p-3 rounded-xl border border-accent/40 bg-surface-elevated/95 backdrop-blur shadow-lg text-xs">
          <div className="flex items-center gap-2">
            <Ruler size={16} className="text-accent flex-none" />
            <div>
              <p className="font-medium text-ink-primary">Two-Point Scale Calibration</p>
              <p className="text-ink-muted text-[0.72rem]">
                {!calibPointA
                  ? 'Click Point 1 on any wall or known dimension line.'
                  : !calibPointB
                    ? 'Click Point 2 to complete the reference span.'
                    : 'Enter the real-world distance between the two points.'}
              </p>
            </div>
          </div>

          {calibPointA && calibPointB && (
            <div className="flex items-center gap-2">
              <input
                type="text"
                placeholder="e.g. 30 ft, 9.1 m, 9'6&quot;"
                value={calibInput}
                onChange={(e) => {
                  setCalibInput(e.target.value)
                  setCalibError(null)
                }}
                onKeyDown={(e) => e.key === 'Enter' && applyCalibration()}
                className="px-2.5 py-1.5 rounded border border-line bg-bg-inset text-xs font-mono outline-none focus:border-accent w-48"
              />
              <Button size="sm" onClick={applyCalibration}>
                Apply Scale
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setCalibPointA(null)
                  setCalibPointB(null)
                  setActiveTool('select')
                }}
              >
                Cancel
              </Button>
            </div>
          )}

          {calibError && <p className="w-full text-xs text-rose-500 font-medium">{calibError}</p>}
        </div>
      )}

      {/* 3. MAIN CANVAS AREA */}
      <div
        className="relative flex-1 w-full h-full overflow-hidden bg-neutral-900 cursor-crosshair"
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
      >
        <div
          className="absolute origin-top-left transition-transform duration-75"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          }}
        >
          {/* Background uploaded plan image */}
          <img
            src={imageUrl}
            alt="Source drawing"
            className="block max-w-none pointer-events-none select-none"
            style={{ width: rawSurvey.imageWidth, height: rawSurvey.imageHeight }}
          />

          {/* SVG Overlay layer */}
          <svg
            ref={svgRef}
            width={rawSurvey.imageWidth}
            height={rawSurvey.imageHeight}
            className="absolute inset-0 pointer-events-auto"
            style={{ opacity: overlayOpacity }}
          >
            {/* Calibration Reference Line */}
            {calibPointA && (
              <circle
                cx={calibPointA.x}
                cy={calibPointA.y}
                r={6}
                fill="#f59e0b"
                stroke="#fff"
                strokeWidth={2}
              />
            )}
            {calibPointA && calibPointB && (
              <>
                <line
                  x1={calibPointA.x}
                  y1={calibPointA.y}
                  x2={calibPointB.x}
                  y2={calibPointB.y}
                  stroke="#f59e0b"
                  strokeWidth={3}
                  strokeDasharray="6 4"
                />
                <circle
                  cx={calibPointB.x}
                  cy={calibPointB.y}
                  r={6}
                  fill="#f59e0b"
                  stroke="#fff"
                  strokeWidth={2}
                />
              </>
            )}

            {/* ROOMS */}
            {rawSurvey.elements.rooms.map((room) => {
              const isSelected = selectedId === room.id
              const isLowConf = room.confidence < 0.7
              const realW = (room.box.w * scaleMPerPx).toFixed(1)
              const realH = (room.box.h * scaleMPerPx).toFixed(1)

              return (
                <g key={room.id} className="cursor-pointer">
                  {/* Room bounding box */}
                  <rect
                    x={room.box.x}
                    y={room.box.y}
                    width={room.box.w}
                    height={room.box.h}
                    fill={isSelected ? '#3b82f6' : isLowConf ? '#f59e0b' : '#6366f1'}
                    fillOpacity={isSelected ? 0.35 : 0.22}
                    stroke={isSelected ? '#2563eb' : isLowConf ? '#d97706' : '#4f46e5'}
                    strokeWidth={isSelected ? 3 : 1.5}
                    onClick={(e) => {
                      e.stopPropagation()
                      setSelectedId(room.id)
                      setSelectedType('room')
                    }}
                  />

                  {/* Room Label Badge */}
                  <g
                    transform={`translate(${room.box.x + room.box.w / 2}, ${room.box.y + room.box.h / 2})`}
                    onClick={(e) => {
                      e.stopPropagation()
                      setSelectedId(room.id)
                      setSelectedType('room')
                    }}
                  >
                    <rect
                      x={-55}
                      y={-14}
                      width={110}
                      height={28}
                      rx={6}
                      fill="#111827"
                      fillOpacity={0.85}
                    />
                    <text
                      textAnchor="middle"
                      y={-1}
                      fill="#ffffff"
                      fontSize={11}
                      fontWeight="bold"
                      fontFamily="system-ui"
                    >
                      {room.name}
                    </text>
                    <text
                      textAnchor="middle"
                      y={10}
                      fill="#9ca3af"
                      fontSize={9}
                      fontFamily="monospace"
                    >
                      {realW} × {realH} m
                    </text>
                  </g>

                  {/* Corner Resize Handles if Selected */}
                  {isSelected && (
                    <>
                      {(['tl', 'tr', 'bl', 'br'] as const).map((handle) => {
                        const hx = handle.includes('r') ? room.box.x + room.box.w : room.box.x
                        const hy = handle.includes('b') ? room.box.y + room.box.h : room.box.y
                        return (
                          <circle
                            key={handle}
                            cx={hx}
                            cy={hy}
                            r={6}
                            fill="#ffffff"
                            stroke="#2563eb"
                            strokeWidth={2}
                            className="cursor-nwse-resize"
                            onPointerDown={(e) => startRoomCornerDrag(e, room.id, handle, room.box)}
                          />
                        )
                      })}
                    </>
                  )}
                </g>
              )
            })}

            {/* WALLS */}
            {rawSurvey.elements.walls.map((wall) => {
              const isSelected = selectedId === wall.id
              const isExt = wall.kind === 'exterior'
              const strokeW = wall.thicknessPx ?? (isExt ? 6 : 3)

              return (
                <g key={wall.id}>
                  <line
                    x1={wall.a.x}
                    y1={wall.a.y}
                    x2={wall.b.x}
                    y2={wall.b.y}
                    stroke={isSelected ? '#3b82f6' : isExt ? '#1f2937' : '#4b5563'}
                    strokeWidth={isSelected ? strokeW + 4 : strokeW}
                    strokeLinecap="round"
                    onClick={(e) => {
                      e.stopPropagation()
                      setSelectedId(wall.id)
                      setSelectedType('wall')
                    }}
                  />
                  {isSelected && (
                    <>
                      <circle
                        cx={wall.a.x}
                        cy={wall.a.y}
                        r={5}
                        fill="#2563eb"
                        stroke="#fff"
                        strokeWidth={1.5}
                        className="cursor-move"
                        onPointerDown={(e) => {
                          e.stopPropagation()
                          const pt = clientToImageCoords(e.clientX, e.clientY)
                          if (!pt) return
                          setDragState({
                            type: 'wall-endpoint',
                            elementId: wall.id,
                            handle: 'a',
                            startX: pt.x,
                            startY: pt.y,
                            initialPos: { ax: wall.a.x, ay: wall.a.y, bx: wall.b.x, by: wall.b.y },
                          })
                        }}
                      />
                      <circle
                        cx={wall.b.x}
                        cy={wall.b.y}
                        r={5}
                        fill="#2563eb"
                        stroke="#fff"
                        strokeWidth={1.5}
                        className="cursor-move"
                        onPointerDown={(e) => {
                          e.stopPropagation()
                          const pt = clientToImageCoords(e.clientX, e.clientY)
                          if (!pt) return
                          setDragState({
                            type: 'wall-endpoint',
                            elementId: wall.id,
                            handle: 'b',
                            startX: pt.x,
                            startY: pt.y,
                            initialPos: { ax: wall.a.x, ay: wall.a.y, bx: wall.b.x, by: wall.b.y },
                          })
                        }}
                      />
                    </>
                  )}
                </g>
              )
            })}

            {/* OPENINGS (Doors & Windows) */}
            {rawSurvey.elements.openings.map((opening) => {
              const isSelected = selectedId === opening.id
              const isDoor = opening.kind === 'door' || opening.kind === 'entry'
              const halfW = opening.widthPx / 2
              const x1 = opening.orient === 'h' ? opening.at.x - halfW : opening.at.x
              const y1 = opening.orient === 'v' ? opening.at.y - halfW : opening.at.y
              const x2 = opening.orient === 'h' ? opening.at.x + halfW : opening.at.x
              const y2 = opening.orient === 'v' ? opening.at.y + halfW : opening.at.y

              return (
                <g
                  key={opening.id}
                  className="cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation()
                    setSelectedId(opening.id)
                    setSelectedType('opening')
                  }}
                >
                  <line
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    stroke={isSelected ? '#3b82f6' : isDoor ? '#f97316' : '#06b6d4'}
                    strokeWidth={isSelected ? 6 : 4}
                  />

                  {/* Door Swing Arc */}
                  {isDoor && (
                    <circle
                      cx={opening.at.x}
                      cy={opening.at.y}
                      r={halfW}
                      fill="none"
                      stroke="#f97316"
                      strokeWidth={1.5}
                      strokeDasharray="4 3"
                      opacity={0.7}
                    />
                  )}
                </g>
              )
            })}
          </svg>
        </div>
      </div>

      {/* 4. SELECTED ELEMENT EDITING POPOVER (BOTTOM-LEFT) */}
      {selectedId && (
        <div className="absolute bottom-4 left-4 z-20 w-80 rounded-xl border border-line bg-surface-elevated/95 backdrop-blur p-3.5 shadow-xl text-xs space-y-2.5">
          <div className="flex items-center justify-between pb-2 border-b border-line">
            <span className="font-mono text-[0.7rem] uppercase tracking-wider text-ink-muted">
              Edit {selectedType}
            </span>
            <button
              type="button"
              onClick={handleDeleteSelected}
              className="text-rose-500 hover:text-rose-600 flex items-center gap-1 text-[0.7rem]"
            >
              <Trash2 size={12} />
              <span>Delete</span>
            </button>
          </div>

          {/* Room Editor */}
          {selectedType === 'room' && selectedRoom && (
            <div className="space-y-2">
              <label className="block">
                <span className="text-ink-muted">Standard Room Type</span>
                <select
                  value={selectedRoom.type}
                  onChange={(e) => {
                    const opt = INDIAN_ROOM_TYPES.find((t) => t.value === e.target.value)
                    const updated = structuredClone(rawSurvey)
                    const r = updated.elements.rooms.find((item) => item.id === selectedId)
                    if (r) {
                      r.type = e.target.value
                      if (opt) r.name = opt.label
                      pushState(updated)
                    }
                  }}
                  className="mt-1 w-full px-2 py-1.5 rounded border border-line bg-bg-inset text-xs outline-none focus:border-accent"
                >
                  {INDIAN_ROOM_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="text-ink-muted">Custom Label</span>
                <input
                  type="text"
                  value={selectedRoom.name}
                  onChange={(e) => {
                    const updated = structuredClone(rawSurvey)
                    const r = updated.elements.rooms.find((item) => item.id === selectedId)
                    if (r) {
                      r.name = e.target.value
                      pushState(updated)
                    }
                  }}
                  className="mt-1 w-full px-2 py-1.5 rounded border border-line bg-bg-inset text-xs outline-none focus:border-accent"
                />
              </label>

              <div className="grid grid-cols-2 gap-2 text-ink-muted font-mono text-[0.7rem] pt-1">
                <span>Width: {(selectedRoom.box.w * scaleMPerPx).toFixed(2)} m</span>
                <span>Depth: {(selectedRoom.box.h * scaleMPerPx).toFixed(2)} m</span>
              </div>
            </div>
          )}

          {/* Opening Editor */}
          {selectedType === 'opening' && selectedOpening && (
            <div className="space-y-2">
              <label className="block">
                <span className="text-ink-muted">Opening Kind</span>
                <select
                  value={selectedOpening.kind}
                  onChange={(e) => {
                    const updated = structuredClone(rawSurvey)
                    const o = updated.elements.openings.find((item) => item.id === selectedId)
                    if (o) {
                      o.kind = e.target.value as RawSurveyOpening['kind']
                      pushState(updated)
                    }
                  }}
                  className="mt-1 w-full px-2 py-1.5 rounded border border-line bg-bg-inset text-xs outline-none"
                >
                  <option value="door">Door</option>
                  <option value="entry">Main Entry Door</option>
                  <option value="window">Window</option>
                </select>
              </label>

              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="text-ink-muted">Width (m)</span>
                  <input
                    type="number"
                    step="0.05"
                    min="0.6"
                    max="3.0"
                    value={+(selectedOpening.widthPx * scaleMPerPx).toFixed(2)}
                    onChange={(e) => {
                      const valM = parseFloat(e.target.value)
                      if (valM > 0) {
                        const updated = structuredClone(rawSurvey)
                        const o = updated.elements.openings.find((item) => item.id === selectedId)
                        if (o) {
                          o.widthPx = Math.round(valM / scaleMPerPx)
                          pushState(updated)
                        }
                      }
                    }}
                    className="mt-1 w-full px-2 py-1 rounded border border-line bg-bg-inset text-xs font-mono"
                  />
                </label>

                {selectedOpening.kind !== 'window' && (
                  <label className="block">
                    <span className="text-ink-muted">Swing</span>
                    <button
                      type="button"
                      onClick={() => {
                        const updated = structuredClone(rawSurvey)
                        const o = updated.elements.openings.find((item) => item.id === selectedId)
                        if (o) {
                          o.swing = (o.swing ?? 1) * -1
                          pushState(updated)
                        }
                      }}
                      className="mt-1 w-full px-2 py-1 rounded border border-line bg-bg-inset text-xs font-mono hover:bg-black/5"
                    >
                      Flip Swing ({selectedOpening.swing ?? 1})
                    </button>
                  </label>
                )}
              </div>
            </div>
          )}

          {/* Wall Editor */}
          {selectedType === 'wall' && selectedWall && (
            <div className="space-y-2">
              <label className="block">
                <span className="text-ink-muted">Wall Category</span>
                <select
                  value={selectedWall.kind}
                  onChange={(e) => {
                    const updated = structuredClone(rawSurvey)
                    const w = updated.elements.walls.find((item) => item.id === selectedId)
                    if (w) {
                      w.kind = e.target.value as 'exterior' | 'interior'
                      pushState(updated)
                    }
                  }}
                  className="mt-1 w-full px-2 py-1.5 rounded border border-line bg-bg-inset text-xs outline-none"
                >
                  <option value="exterior">Exterior (230 mm)</option>
                  <option value="interior">Interior Partition (115 mm)</option>
                </select>
              </label>
            </div>
          )}
        </div>
      )}

      {/* 5. "NEEDS REVIEW" SIDE DRAWER (Low confidence items < 0.7) */}
      {lowConfidenceItems.length > 0 && showNeedsReviewDrawer && (
        <div className="absolute top-12 right-4 z-20 w-72 rounded-xl border border-line bg-surface-elevated/95 backdrop-blur p-3.5 shadow-xl text-xs">
          <div className="flex items-center justify-between pb-2 border-b border-line">
            <div className="flex items-center gap-1.5 font-medium text-amber-500">
              <AlertCircle size={14} />
              <span>Needs Review ({lowConfidenceItems.length})</span>
            </div>
            <button
              type="button"
              onClick={() => setShowNeedsReviewDrawer(false)}
              className="text-ink-muted hover:text-ink-primary text-xs"
            >
              ✕
            </button>
          </div>
          <p className="mt-1.5 text-[0.72rem] text-ink-muted">
            The extractor was uncertain about these items. Click one to inspect and confirm:
          </p>
          <div className="mt-2.5 max-h-48 overflow-y-auto space-y-1">
            {lowConfidenceItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setSelectedId(item.id)
                  setSelectedType(item.type)
                }}
                className={cx(
                  'w-full text-left p-1.5 rounded flex items-center justify-between text-xs transition-colors',
                  selectedId === item.id ? 'bg-accent/10 border border-accent/40' : 'hover:bg-bg-inset'
                )}
              >
                <span className="truncate">{item.label}</span>
                <span className="font-mono text-[0.65rem] text-amber-500">
                  {Math.round(item.confidence * 100)}%
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}