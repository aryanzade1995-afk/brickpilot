import { useState, useRef, useCallback, useMemo, useEffect } from 'react'
import {
  ZoomIn,
  ZoomOut,
  Maximize2,
  Undo2,
  Redo2,
  Ruler,
  Eye,
  EyeOff,
  Plus,
  Trash2,
  DoorOpen,
  Square,
  Compass,
  Check,
} from 'lucide-react'
import {
  type RawSurvey,
  type RawSurveyRoom,
  type RawSurveyWall,
  type RawSurveyOpening,
  type ImagePointPx,
} from '@/lib/existing/digitizer.ts'
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

/** BrickPilot Architectural Zone Palette matching 2D Plan Studio */
const ZONE_COLORS: Record<string, { fill: string; stroke: string; text: string }> = {
  living: { fill: '#F6E3BE', stroke: '#D97706', text: '#78350F' },
  dining: { fill: '#F6E3BE', stroke: '#D97706', text: '#78350F' },
  bed: { fill: '#D3E3F2', stroke: '#2563EB', text: '#1E3A8A' },
  master_bed: { fill: '#D3E3F2', stroke: '#2563EB', text: '#1E3A8A' },
  kitchen: { fill: '#CFE8D0', stroke: '#16A34A', text: '#14532D' },
  utility: { fill: '#CFE8D0', stroke: '#16A34A', text: '#14532D' },
  store: { fill: '#ECECEA', stroke: '#64748B', text: '#334155' },
  bath: { fill: '#E0E7FF', stroke: '#4F46E5', text: '#312E81' },
  pooja: { fill: '#F6D4D0', stroke: '#DC2626', text: '#7F1D1D' },
  corridor: { fill: '#F1F5F9', stroke: '#94A3B8', text: '#475569' },
  stair: { fill: '#F1F5F9', stroke: '#94A3B8', text: '#475569' },
  balcony: { fill: '#E3EED5', stroke: '#65A30D', text: '#365314' },
}

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
  handle?: string
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
  // Default to FALSE: only show the website's clean CAD vector drawing, NOT the raw user photo
  const [showOriginalSketch, setShowOriginalSketch] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedType, setSelectedType] = useState<'room' | 'wall' | 'opening' | null>(null)
  const [showNeedsReviewDrawer, setShowNeedsReviewDrawer] = useState(false)

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
    for (const r of rawSurvey?.elements?.rooms || []) {
      if (r.confidence < 0.7) items.push({ id: r.id, type: 'room', label: r.name || 'Room', confidence: r.confidence })
    }
    for (const w of rawSurvey?.elements?.walls || []) {
      if (w.confidence < 0.7) items.push({ id: w.id, type: 'wall', label: `Wall (${w.kind})`, confidence: w.confidence })
    }
    for (const o of rawSurvey?.elements?.openings || []) {
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

  // Auto-fit & Center drawing inside the viewport container
  const fitToView = useCallback(() => {
    if (!containerRef.current) return
    const container = containerRef.current.getBoundingClientRect()
    const rooms = rawSurvey?.elements?.rooms || []
    const walls = rawSurvey?.elements?.walls || []

    let minX = 0, maxX = rawSurvey.imageWidth || 1000
    let minY = 0, maxY = rawSurvey.imageHeight || 800

    if (rooms.length > 0) {
      minX = Math.min(...rooms.map((r) => r.box.x))
      maxX = Math.max(...rooms.map((r) => r.box.x + r.box.w))
      minY = Math.min(...rooms.map((r) => r.box.y))
      maxY = Math.max(...rooms.map((r) => r.box.y + r.box.h))
    } else if (walls.length > 0) {
      minX = Math.min(...walls.flatMap((w) => [w.a.x, w.b.x]))
      maxX = Math.max(...walls.flatMap((w) => [w.a.x, w.b.x]))
      minY = Math.min(...walls.flatMap((w) => [w.a.y, w.b.y]))
      maxY = Math.max(...walls.flatMap((w) => [w.a.y, w.b.y]))
    }

    const planW = Math.max(80, maxX - minX)
    const planH = Math.max(80, maxY - minY)

    const padding = 70
    const availW = Math.max(200, container.width - padding * 2)
    const availH = Math.max(200, container.height - padding * 2)

    const scale = Math.min(availW / planW, availH / planH)
    const finalZoom = Math.max(0.15, Math.min(scale, 2.5))

    const centerX = minX + planW / 2
    const centerY = minY + planH / 2

    const newPanX = container.width / 2 - centerX * finalZoom
    const newPanY = container.height / 2 - centerY * finalZoom

    setZoom(+finalZoom.toFixed(2))
    setPan({ x: Math.round(newPanX), y: Math.round(newPanY) })
  }, [rawSurvey])

  // Auto-fit on initial mount or when survey loads
  const hasAutoFittedRef = useRef(false)
  useEffect(() => {
    if (!hasAutoFittedRef.current && containerRef.current) {
      // Small timeout to allow container layout dimensions to settle
      const timer = setTimeout(() => {
        fitToView()
        hasAutoFittedRef.current = true
      }, 50)
      return () => clearTimeout(timer)
    }
  }, [fitToView])

  // Cursor-centered Wheel Zoom
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    if (!containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    const mouseX = e.clientX - rect.left
    const mouseY = e.clientY - rect.top

    const zoomFactor = e.deltaY < 0 ? 1.15 : 0.87
    const nextZoom = Math.max(0.15, Math.min(8, +(zoom * zoomFactor).toFixed(3)))

    // Pivot pan around mouse position
    const nextPanX = mouseX - (mouseX - pan.x) * (nextZoom / zoom)
    const nextPanY = mouseY - (mouseY - pan.y) * (nextZoom / zoom)

    setZoom(nextZoom)
    setPan({ x: Math.round(nextPanX), y: Math.round(nextPanY) })
  }

  // Smooth Zoom Buttons
  const handleZoomIn = () => {
    if (!containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    const cx = rect.width / 2
    const cy = rect.height / 2
    const nextZoom = Math.min(8, +(zoom * 1.25).toFixed(2))
    const nextPanX = cx - (cx - pan.x) * (nextZoom / zoom)
    const nextPanY = cy - (cy - pan.y) * (nextZoom / zoom)
    setZoom(nextZoom)
    setPan({ x: Math.round(nextPanX), y: Math.round(nextPanY) })
  }

  const handleZoomOut = () => {
    if (!containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    const cx = rect.width / 2
    const cy = rect.height / 2
    const nextZoom = Math.max(0.15, +(zoom / 1.25).toFixed(2))
    const nextPanX = cx - (cx - pan.x) * (nextZoom / zoom)
    const nextPanY = cy - (cy - pan.y) * (nextZoom / zoom)
    setZoom(nextZoom)
    setPan({ x: Math.round(nextPanX), y: Math.round(nextPanY) })
  }

  const handleResetZoom100 = () => {
    if (!containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    const cx = rect.width / 2
    const cy = rect.height / 2
    const nextZoom = 1.0
    const nextPanX = cx - (cx - pan.x) * (nextZoom / zoom)
    const nextPanY = cy - (cy - pan.y) * (nextZoom / zoom)
    setZoom(nextZoom)
    setPan({ x: Math.round(nextPanX), y: Math.round(nextPanY) })
  }

  // Calibration tool point selection
  const handleCalibrationClick = (pt: ImagePointPx) => {
    if (!calibPointA) {
      setCalibPointA(pt)
    } else if (!calibPointB) {
      setCalibPointB(pt)
    } else {
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

  // Pointer Down (Pan or Start Tool / Drag)
  const handlePointerDown = (e: React.PointerEvent) => {
    // If clicking on toolbar or overlay controls, ignore
    if ((e.target as HTMLElement).closest('.canvas-control-bar')) return

    const imgPt = clientToImageCoords(e.clientX, e.clientY)

    // Calibration tool
    if (activeTool === 'calibrate' && imgPt) {
      handleCalibrationClick(imgPt)
      return
    }

    // Add element tools
    if (activeTool === 'add-room' && imgPt) {
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

    if (activeTool === 'add-wall' && imgPt) {
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

    if ((activeTool === 'add-door' || activeTool === 'add-window') && imgPt) {
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

    // Default left click or drag on background: start smooth panning
    setIsPanning(true)
    panStartRef.current = { x: e.clientX - pan.x, y: e.clientY - pan.y }
  }

  // Pointer Move (Panning or Dragging elements)
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
    const rooms = rawSurvey?.elements?.rooms || []
    if (!rooms.length) {
      const W = rawSurvey.imageWidth * scaleMPerPx
      const H = rawSurvey.imageHeight * scaleMPerPx
      return { w: +W.toFixed(2), h: +H.toFixed(2) }
    }
    const minX = Math.min(...rooms.map((r) => r.box.x))
    const maxX = Math.max(...rooms.map((r) => r.box.x + r.box.w))
    const minY = Math.min(...rooms.map((r) => r.box.y))
    const maxY = Math.max(...rooms.map((r) => r.box.y + r.box.h))
    return {
      w: +((maxX - minX) * scaleMPerPx).toFixed(2),
      h: +((maxY - minY) * scaleMPerPx).toFixed(2),
    }
  }, [rawSurvey, scaleMPerPx])

  const selectedRoom = useMemo(
    () => rawSurvey?.elements?.rooms?.find((r) => r.id === selectedId),
    [rawSurvey?.elements?.rooms, selectedId]
  )

  const selectedOpening = useMemo(
    () => rawSurvey?.elements?.openings?.find((o) => o.id === selectedId),
    [rawSurvey?.elements?.openings, selectedId]
  )

  const selectedWall = useMemo(
    () => rawSurvey?.elements?.walls?.find((w) => w.id === selectedId),
    [rawSurvey?.elements?.walls, selectedId]
  )

  return (
    <div
      ref={containerRef}
      className="relative flex flex-col h-[740px] w-full rounded-2xl border border-line bg-surface overflow-hidden select-none shadow-sm"
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
    >
      {/* 1. TOP TOOLBAR */}
      <div className="canvas-control-bar flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 border-b border-line bg-surface-elevated z-10 text-xs">
        {/* Left tools */}
        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            variant={activeTool === 'select' ? 'primary' : 'ghost'}
            onClick={() => setActiveTool('select')}
            title="Select & Move elements"
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
            title="Calibrate drawing scale with 2 reference points"
            className="flex items-center gap-1"
          >
            <Ruler size={13} />
            <span>Calibrate</span>
          </Button>

          <div className="h-4 w-px bg-line mx-1" />

          <Button
            size="sm"
            variant={activeTool === 'add-room' ? 'primary' : 'ghost'}
            onClick={() => setActiveTool('add-room')}
            className="flex items-center gap-1"
            title="Add a new room"
          >
            <Square size={13} />
            <span>+ Room</span>
          </Button>

          <Button
            size="sm"
            variant={activeTool === 'add-wall' ? 'primary' : 'ghost'}
            onClick={() => setActiveTool('add-wall')}
            className="flex items-center gap-1"
            title="Add a wall"
          >
            <Plus size={13} />
            <span>+ Wall</span>
          </Button>

          <Button
            size="sm"
            variant={activeTool === 'add-door' ? 'primary' : 'ghost'}
            onClick={() => setActiveTool('add-door')}
            className="flex items-center gap-1"
            title="Add a door"
          >
            <DoorOpen size={13} />
            <span>+ Door</span>
          </Button>

          <Button
            size="sm"
            variant={activeTool === 'add-window' ? 'primary' : 'ghost'}
            onClick={() => setActiveTool('add-window')}
            className="flex items-center gap-1"
            title="Add a window"
          >
            <Plus size={13} />
            <span>+ Window</span>
          </Button>
        </div>

        {/* Center: Live CAD Scale readout */}
        <div className="hidden lg:flex items-center gap-3 font-mono text-[0.72rem] text-ink-muted">
          <span>Scale: 1 px = {(scaleMPerPx * 1000).toFixed(1)} mm</span>
          <span>·</span>
          <span>
            House: {footprintM.w} × {footprintM.h} m
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
          {/* Optional Sketch Overlay Toggle */}
          <button
            type="button"
            onClick={() => setShowOriginalSketch(!showOriginalSketch)}
            className={cx(
              'px-2.5 py-1.5 rounded-lg border text-xs font-mono flex items-center gap-1.5 transition-colors',
              showOriginalSketch
                ? 'border-accent bg-accent/10 text-accent font-medium'
                : 'border-line bg-surface hover:bg-bg-inset text-ink-muted hover:text-ink-primary'
            )}
            title="Toggle original uploaded photo reference overlay"
          >
            {showOriginalSketch ? <Eye size={13} /> : <EyeOff size={13} />}
            <span className="hidden sm:inline">
              {showOriginalSketch ? 'Hide Sketch' : 'Compare Sketch'}
            </span>
          </button>

          {/* Undo / Redo */}
          <div className="flex items-center gap-1 border-l border-line pl-1.5">
            <button
              type="button"
              disabled={historyIndex <= 0}
              onClick={handleUndo}
              className="p-1.5 rounded hover:bg-bg-inset disabled:opacity-30 transition-colors text-ink-muted hover:text-ink-primary"
              title="Undo (Ctrl+Z)"
            >
              <Undo2 size={14} />
            </button>
            <button
              type="button"
              disabled={historyIndex >= history.length - 1}
              onClick={handleRedo}
              className="p-1.5 rounded hover:bg-bg-inset disabled:opacity-30 transition-colors text-ink-muted hover:text-ink-primary"
              title="Redo (Ctrl+Y)"
            >
              <Redo2 size={14} />
            </button>
          </div>

          {/* Zoom controls */}
          <div className="flex items-center gap-1 border-l border-line pl-2">
            <button
              type="button"
              onClick={handleZoomOut}
              className="p-1.5 rounded hover:bg-bg-inset text-ink-muted hover:text-ink-primary"
              title="Zoom Out"
            >
              <ZoomOut size={14} />
            </button>
            <button
              type="button"
              onClick={handleResetZoom100}
              className="font-mono text-[0.68rem] text-ink-muted px-1.5 py-0.5 rounded hover:bg-bg-inset hover:text-ink-primary"
              title="Reset to 100%"
            >
              {Math.round(zoom * 100)}%
            </button>
            <button
              type="button"
              onClick={handleZoomIn}
              className="p-1.5 rounded hover:bg-bg-inset text-ink-muted hover:text-ink-primary"
              title="Zoom In"
            >
              <ZoomIn size={14} />
            </button>
            <button
              type="button"
              onClick={fitToView}
              className="p-1.5 rounded hover:bg-bg-inset text-accent hover:bg-accent/10"
              title="Fit to Screen"
            >
              <Maximize2 size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* 2. CALIBRATION BANNER (active when calibrating) */}
      {activeTool === 'calibrate' && (
        <div className="canvas-control-bar absolute top-12 left-4 right-4 z-20 flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-xl border border-accent/40 bg-surface-elevated/95 backdrop-blur shadow-lg text-xs">
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
                placeholder="e.g. 15 ft, 4.5 m"
                value={calibInput}
                onChange={(e) => setCalibInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && applyCalibration()}
                className="px-3 py-1.5 rounded border border-line bg-bg-inset text-xs font-mono w-36 outline-none focus:border-accent"
                autoFocus
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
                  setCalibInput('')
                  setCalibError(null)
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

      {/* 3. MAIN CAD DRAFTING CANVAS */}
      <div
        className={cx(
          'relative flex-1 w-full h-full overflow-hidden transition-colors',
          isPanning
            ? 'cursor-grabbing'
            : activeTool === 'select'
            ? 'cursor-grab'
            : 'cursor-crosshair'
        )}
        style={{
          backgroundColor: '#FBFBFA',
          backgroundImage: 'radial-gradient(circle, #CBD5E1 1.2px, transparent 1.2px)',
          backgroundSize: '24px 24px',
        }}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
      >
        {/* COMPASS NORTH ARROW */}
        <div className="absolute top-4 right-4 z-10 pointer-events-none flex flex-col items-center bg-white/80 dark:bg-slate-900/80 backdrop-blur p-2 rounded-xl border border-line shadow-xs">
          <Compass size={20} className="text-accent" />
          <span className="font-mono text-[0.65rem] font-bold text-ink-primary mt-0.5">N</span>
        </div>

        {/* GRAPHIC SCALE BAR */}
        <div className="absolute bottom-4 right-4 z-10 pointer-events-none bg-white/85 dark:bg-slate-900/80 backdrop-blur px-3 py-1.5 rounded-lg border border-line shadow-xs font-mono text-[0.65rem] text-ink-muted flex items-center gap-2">
          <span>0</span>
          <div
            className="h-1 bg-ink-primary border border-ink-primary"
            style={{ width: `${Math.max(30, Math.round((2.0 / scaleMPerPx) * zoom))}px` }}
          />
          <span>2m</span>
        </div>

        <div
          className="absolute origin-top-left transition-transform duration-75"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          }}
        >
          {/* OPTIONAL SKETCH OVERLAY (Only if user explicitly clicked "Compare Sketch") */}
          {showOriginalSketch && imageUrl && (
            <img
              src={imageUrl}
              alt="Source drawing reference"
              className="block max-w-none pointer-events-none select-none opacity-30 mix-blend-multiply"
              style={{ width: rawSurvey.imageWidth, height: rawSurvey.imageHeight }}
            />
          )}

          {/* CLEAN ARCHITECTURAL VECTOR DRAWING (Created by BrickPilot) */}
          <svg
            ref={svgRef}
            width={rawSurvey.imageWidth || 1200}
            height={rawSurvey.imageHeight || 900}
            className="block pointer-events-auto"
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
            {(rawSurvey?.elements?.rooms || []).map((room) => {
              const isSelected = selectedId === room.id
              const isLowConf = room.confidence < 0.7
              const realW = (room.box.w * scaleMPerPx).toFixed(1)
              const realH = (room.box.h * scaleMPerPx).toFixed(1)
              const areaM2 = ((room.box.w * scaleMPerPx) * (room.box.h * scaleMPerPx)).toFixed(1)

              const zone = ZONE_COLORS[room.type] || { fill: '#F1F5F9', stroke: '#94A3B8', text: '#475569' }
              const tagWidth = Math.max(90, room.name.length * 7 + 22)

              return (
                <g key={room.id} className="cursor-pointer">
                  {/* Room bounding box with authentic architectural fill */}
                  <rect
                    x={room.box.x}
                    y={room.box.y}
                    width={room.box.w}
                    height={room.box.h}
                    fill={isSelected ? '#BFDBFE' : zone.fill}
                    fillOpacity={isSelected ? 0.65 : 0.45}
                    stroke={isSelected ? '#2563EB' : isLowConf ? '#D97706' : zone.stroke}
                    strokeWidth={isSelected ? 3 : 1.5}
                    onClick={(e) => {
                      e.stopPropagation()
                      setSelectedId(room.id)
                      setSelectedType('room')
                    }}
                  />

                  {/* Clean Architectural Room Label Stamp */}
                  <g
                    transform={`translate(${room.box.x + room.box.w / 2}, ${room.box.y + room.box.h / 2})`}
                    onClick={(e) => {
                      e.stopPropagation()
                      setSelectedId(room.id)
                      setSelectedType('room')
                    }}
                    className="select-none"
                  >
                    <rect
                      x={-tagWidth / 2}
                      y={-17}
                      width={tagWidth}
                      height={34}
                      rx={4}
                      fill="#FFFFFF"
                      fillOpacity={0.92}
                      stroke={isSelected ? '#2563EB' : '#CBD5E1'}
                      strokeWidth={isSelected ? 1.5 : 1}
                    />
                    <text
                      textAnchor="middle"
                      y={-2}
                      fill="#0F172A"
                      fontSize={11}
                      fontWeight="700"
                      fontFamily="system-ui, -apple-system, sans-serif"
                      letterSpacing="0.03em"
                    >
                      {room.name.toUpperCase()}
                    </text>
                    <text
                      textAnchor="middle"
                      y={10}
                      fill="#64748B"
                      fontSize={9}
                      fontFamily="ui-monospace, monospace"
                    >
                      {realW} × {realH} m ({areaM2} m²)
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
                            stroke="#2563EB"
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
            {(rawSurvey?.elements?.walls || []).map((wall) => {
              const isSelected = selectedId === wall.id
              const isExt = wall.kind === 'exterior'
              const strokeW = wall.thicknessPx ?? (isExt ? 6 : 3.5)

              return (
                <g key={wall.id}>
                  <line
                    x1={wall.a.x}
                    y1={wall.a.y}
                    x2={wall.b.x}
                    y2={wall.b.y}
                    stroke={isSelected ? '#2563eb' : isExt ? '#141414' : '#4b5563'}
                    strokeWidth={isSelected ? strokeW + 3 : strokeW}
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
            {(rawSurvey?.elements?.openings || []).map((opening) => {
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
                  {isDoor ? (
                    <>
                      {/* Door clear opening line */}
                      <line
                        x1={x1}
                        y1={y1}
                        x2={x2}
                        y2={y2}
                        stroke={isSelected ? '#2563EB' : '#E0873A'}
                        strokeWidth={isSelected ? 6 : 4}
                        strokeLinecap="round"
                      />
                      {/* Door swing arc */}
                      <circle
                        cx={opening.at.x}
                        cy={opening.at.y}
                        r={halfW}
                        fill="none"
                        stroke="#E0873A"
                        strokeWidth={1.5}
                        strokeDasharray="4 3"
                        opacity={0.8}
                      />
                    </>
                  ) : (
                    <>
                      {/* Window Double-Line Glazing Marker */}
                      <line
                        x1={x1}
                        y1={y1}
                        x2={x2}
                        y2={y2}
                        stroke={isSelected ? '#2563EB' : '#0284C7'}
                        strokeWidth={isSelected ? 6 : 4.5}
                        strokeLinecap="butt"
                      />
                      <line
                        x1={x1}
                        y1={y1}
                        x2={x2}
                        y2={y2}
                        stroke="#FFFFFF"
                        strokeWidth={1.5}
                        strokeLinecap="butt"
                      />
                    </>
                  )}
                </g>
              )
            })}
          </svg>
        </div>
      </div>

      {/* 4. SELECTED ELEMENT EDITING CARD (BOTTOM-LEFT) */}
      {selectedId && (
        <div className="canvas-control-bar absolute bottom-4 left-4 z-20 w-80 rounded-xl border border-line bg-surface-elevated/95 backdrop-blur p-4 shadow-xl text-xs space-y-3">
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
            <div className="space-y-2.5">
              <label className="block">
                <span className="text-ink-muted">Room Type</span>
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
                  className="mt-1 w-full px-2.5 py-1.5 rounded-lg border border-line bg-bg-inset text-xs outline-none focus:border-accent"
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
                  className="mt-1 w-full px-2.5 py-1.5 rounded-lg border border-line bg-bg-inset text-xs outline-none focus:border-accent"
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
            <div className="space-y-2.5">
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
                  className="mt-1 w-full px-2.5 py-1.5 rounded-lg border border-line bg-bg-inset text-xs outline-none"
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
                    className="mt-1 w-full px-2 py-1.5 rounded border border-line bg-bg-inset text-xs font-mono"
                  />
                </label>
              </div>
            </div>
          )}

          {/* Wall Editor */}
          {selectedType === 'wall' && selectedWall && (
            <div className="space-y-2">
              <label className="block">
                <span className="text-ink-muted">Wall Classification</span>
                <select
                  value={selectedWall.kind}
                  onChange={(e) => {
                    const updated = structuredClone(rawSurvey)
                    const w = updated.elements.walls.find((item) => item.id === selectedId)
                    if (w) {
                      w.kind = e.target.value as RawSurveyWall['kind']
                      pushState(updated)
                    }
                  }}
                  className="mt-1 w-full px-2.5 py-1.5 rounded-lg border border-line bg-bg-inset text-xs outline-none"
                >
                  <option value="exterior">Exterior Wall (230 mm)</option>
                  <option value="interior">Interior Partition (115 mm)</option>
                </select>
              </label>
            </div>
          )}
        </div>
      )}

      {/* 5. LOW CONFIDENCE "NEEDS REVIEW" SIDE DRAWER */}
      {lowConfidenceItems.length > 0 && showNeedsReviewDrawer && (
        <div className="canvas-control-bar absolute top-14 right-4 z-20 w-72 max-h-[460px] overflow-y-auto rounded-xl border border-line bg-surface-elevated/95 backdrop-blur p-4 shadow-xl text-xs space-y-2.5">
          <div className="flex items-center justify-between pb-1.5 border-b border-line">
            <span className="font-semibold text-ink-primary">
              Needs Review ({lowConfidenceItems.length})
            </span>
            <button
              type="button"
              onClick={() => setShowNeedsReviewDrawer(false)}
              className="text-ink-muted hover:text-ink-primary text-xs"
            >
              ✕
            </button>
          </div>
          <p className="text-[0.72rem] text-ink-muted">
            The AI flagged these elements with low detection confidence. Click to inspect or correct.
          </p>
          <div className="space-y-1.5 pt-1">
            {lowConfidenceItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setSelectedId(item.id)
                  setSelectedType(item.type)
                }}
                className={cx(
                  'w-full p-2 rounded-lg border text-left flex items-center justify-between transition-colors',
                  selectedId === item.id
                    ? 'border-accent bg-accent/10 text-accent font-medium'
                    : 'border-line bg-surface hover:bg-bg-inset text-ink-primary'
                )}
              >
                <span>{item.label}</span>
                <span className="font-mono text-[0.65rem] text-amber-600 dark:text-amber-400">
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
