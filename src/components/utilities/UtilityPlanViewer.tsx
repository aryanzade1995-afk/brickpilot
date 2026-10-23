import { Component, memo, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { PerspectiveCamera, Vector3 } from 'three'
import type { Point, Rect } from '@/lib/geometry.ts'
import { rectCenter } from '@/lib/geometry.ts'
import { alongPath, UTILITY_LAYERS, displayedRuns, displayedSymbols, selectionForRun, connectedLoads, utilityLegend, type UtilityFloor, type UtilityLayer, type UtilityRun } from '@/lib/utilities/plan.ts'
import { translate as t, useLanguage } from '@/lib/i18n/index.ts'
import { saveBlob } from '@/lib/export/fileSaver.ts'
import { wiringPath } from '@/lib/utilities/overlays.ts'
import { UtilitySymbolGlyph } from './UtilitySymbolGlyph.tsx'
import { ExportDropdown } from '@/components/export/ExportDropdown.tsx'
import { ElectricalLayer3D } from './ElectricalLayer3D.tsx'
import { electricalScene } from '@/lib/utilities/electrical3D.ts'
import { WaterLayer3D } from './WaterLayer3D.tsx'
import { waterScene } from '@/lib/utilities/water3D.ts'
import { useUtilityDrawing } from './useUtilityDrawing.ts'
import { UtilityDrawingWorkbench, type SheetExportKind } from './UtilityDrawingWorkbench.tsx'
import { UtilityLayerPanel } from './UtilityLayerPanel.tsx'
import { DRAWING_LAYERS, visibleLayers, sourceSignature, parseUtilityDrawing, type DrawingDocument, type UtilityDrawingProject } from '@/lib/utilities/drawingProject.ts'
import { buildDrawingSheets, drawingOpsSvg, annotationOps, sheetSvg as serializeDrawingSheet } from '@/lib/utilities/drawingSheets.ts'
import { downloadVectorSheets, downloadSheetPng, downloadSheetSvg, downloadUtilityDxf } from '@/lib/utilities/drawingExports.ts'
import { withDrainageDesign, drainageBounds } from '@/lib/utilities/drainage.ts'
import { DRAINAGE_COLORS } from '@/lib/utilities/drainageRules.ts'
import { DrainageWorkbench } from './DrainageWorkbench.tsx'
import { ElectricalWorkbench } from './ElectricalWorkbench.tsx'
import { withElectricalDesign } from '@/lib/utilities/electricalDesign.ts'
import { drainageInputsSchema } from '@/lib/utilities/drainageInputs.ts'
import { clusterDrainageNodes, drainageLabels, drainageTrace, drainageFlowMarkers, DRAINAGE_DISPLAY, DRAINAGE_NODE_NAMES } from '@/lib/utilities/drainagePresentation.ts'
import { UtilityHoverCard, type UtilityHoverInfo } from './UtilityHoverCard.tsx'
import { DrainageMapDetails } from './DrainageMapDetails.tsx'

type Box = { x: number; y: number; w: number; h: number }
type Mode = '3d' | '2d'
const button = 'min-h-11 border border-line px-3 py-2 text-xs text-ink-dim hover:border-line-strong hover:text-ink focus-visible:outline-2 focus-visible:outline-accent'
const pathLength = (p: Point[]) => p.reduce((n, b, i) => n + (i ? Math.hypot(b.x - p[i - 1].x, b.y - p[i - 1].y) : 0), 0)
const rectPath = (r: Rect) => `M${r.x} ${r.y}h${r.w}v${r.h}h${-r.w}Z`

class CanvasBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? <p className="p-6 text-sm text-ink-dim">{t('3D is unavailable. The 2D utility plan and downloads are still available.')}</p> : this.props.children }
}

function FloorScene({ model, mode, focusRoom, transparentWalls, transparentFloor }: { model: UtilityFloor; mode: Mode; focusRoom: string; transparentWalls: boolean; transparentFloor: boolean }) {
  const { camera, invalidate, size } = useThree(), controls = useRef<OrbitControlsImpl>(null)
  const focused = mode === '3d' ? model.floor.rooms.find(r => r.id === focusRoom)?.rect : undefined
  const center = useMemo(() => rectCenter(focused ?? model.floor.outline), [model, focused])
  const target = useMemo(() => new Vector3(center.x / 1000, .4, center.y / 1000), [center])
  const animation = useRef<{ start: number; from: Vector3; to: Vector3 } | null>(null)
  const home = useRef<Vector3 | null>(null)
  const wallHeight = Math.max(0, ...model.wallSections.map(w => w.base + w.height))
  useEffect(() => {
    if (!(camera instanceof PerspectiveCamera) || mode !== '3d') return
    const r = focused ?? model.floor.outline, height = Math.max(3000, ...model.wallSections.map(w => w.height + w.base))
    const radius = Math.hypot(r.w, r.h, height) / 2000
    const angle = Math.atan(Math.tan(camera.fov * Math.PI / 360) * Math.min(1, size.width / size.height))
    camera.position.copy(target).add(new Vector3(1, 1.15, 1).normalize().multiplyScalar(radius / Math.sin(angle) * 1.08))
    camera.lookAt(target); home.current = camera.position.clone(); invalidate()
    // Fit on the initial floor and viewport changes, not each view toggle.
  }, [camera, target, model, focused, size.width, size.height, invalidate])
  useEffect(() => {
    if (!home.current) home.current = camera.position.clone()
    if (mode === '2d') home.current = camera.position.clone()
    const to = mode === '2d' ? target.clone().add(new Vector3(0, Math.max(model.floor.outline.w, model.floor.outline.h) / 650, .001)) : home.current.clone()
    animation.current = { start: performance.now(), from: camera.position.clone(), to }
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { camera.position.copy(to); camera.lookAt(target); animation.current = null }
    invalidate()
  }, [mode, camera, invalidate, model, target])
  useFrame(() => {
    const a = animation.current
    if (!a) return
    const n = Math.min(1, (performance.now() - a.start) / 600), eased = n * n * (3 - 2 * n)
    camera.position.lerpVectors(a.from, a.to, eased); camera.lookAt(target)
    if (n === 1) animation.current = null
    else invalidate()
  })
  return <>
    <color attach="background" args={['#eeeeec']} /><hemisphereLight args={['#ffffff', '#c5c5bd', 2]} /><directionalLight position={[10, 25, 5]} intensity={2.2} />
    {model.slabs.map((r, i) => <mesh key={i} position={[(r.x + r.w / 2) / 1000, -.08, (r.y + r.h / 2) / 1000]}><boxGeometry args={[r.w / 1000, .16, r.h / 1000]} /><meshStandardMaterial color="#fafaf8" roughness={.9} transparent={transparentFloor} opacity={transparentFloor ? .38 : 1} depthWrite={!transparentFloor} /></mesh>)}
    {model.wallSections.map(w => <mesh key={w.id} position={[(w.a.x + w.b.x) / 2000, (w.base + w.height / 2) / 1000, (w.a.y + w.b.y) / 2000]} rotation={[0, -Math.atan2(w.b.y - w.a.y, w.b.x - w.a.x), 0]}><boxGeometry args={[Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y) / 1000, w.height / 1000, w.thickness / 1000]} /><meshStandardMaterial color="#cfceca" roughness={.8} transparent={transparentWalls} opacity={transparentWalls ? .18 : 1} depthWrite={!transparentWalls} /></mesh>)}
    {wallHeight > 0 && (model.floor.columns ?? []).map(c => <mesh key={`column:${c.id}`} position={[c.at.x / 1000, wallHeight / 2000, c.at.y / 1000]}><boxGeometry args={[c.size / 1000, wallHeight / 1000, c.size / 1000]} /><meshStandardMaterial color="#b8b9b3" transparent={transparentWalls} opacity={transparentWalls ? .3 : 1} depthWrite={!transparentWalls} /></mesh>)}
    <OrbitControls ref={controls} target={target} enabled={mode === '3d'} makeDefault enableDamping={false} minDistance={2} maxDistance={150} maxPolarAngle={Math.PI / 2 - .01} />
  </>
}

const PreparedFloorScene = memo(FloorScene)

type HoverInfo = UtilityHoverInfo
type SheetProps = { model: UtilityFloor; box: Box; visible: Record<UtilityLayer, boolean>; room: string; circuit: string; zone: string; water: string; showCoverage: boolean; showEvacuation: boolean; selected: string | null; scale: number; drainageTechnical?: boolean; exporting?: boolean; project: string; drawingDocument?: DrawingDocument; onSelect?: (id: string) => void; onHover?: (info: HoverInfo | null, x?: number, y?: number) => void; svgRef?: React.Ref<SVGSVGElement> }
const wireLabel = (wire: string) => wire.replace('mm2', ' mm²')
function runInfo(model: UtilityFloor, run: UtilityRun): HoverInfo {
  const room = t(model.floor.rooms.find(r => r.id === run.roomId)?.name) ?? ''
  if (run.layer === 'drainage') {
    const p = run.drainagePipe, review = model.drainageDesign?.checks.filter(c => c.itemId === run.id && c.status !== 'Pass') ?? []
    return { title: p ? DRAINAGE_DISPLAY[p.service].label : 'Drainage pipe', category: room || 'Drainage', color: p ? DRAINAGE_COLORS[p.service] : UTILITY_LAYERS.drainage.color, status: p?.state === 'blocked' ? 'Needs review' : 'Proposed', reference: run.id,
      properties: [{ label: 'Diameter', value: p ? p.diameterMm === null ? 'Not specified' : `${p.diameterMm} mm` : `${run.diameter} mm` }, { label: 'Gradient', value: p?.gradientRatio ? `1:${p.gradientRatio}` : 'Not verified' }, { label: 'Route length', value: p?.vertical ? 'Vertical connection' : `${((p?.lengthMm ?? pathLength(run.path)) / 1000).toFixed(2)} m` }, { label: 'Loading', value: p?.dfu == null ? 'Not verified' : `${p.dfu} DFU` }],
      lines: [room, review[0]?.reason ?? p?.sizingBasis ?? 'Proposed drainage connection', 'Select to inspect the connected route and review details.'].filter(Boolean) }
  }
  if (run.layer === 'fire_alarm') { const z = model.zones.find(z => z.id === run.zoneId)!, to = model.symbols.find(s => s.id === run.toSymbolId); return { title: `${z.tag} · ${t(z.name)}`, lines: [room, to?.layer === 'fire_alarm' ? t(to.label) : t('Alarm loop'), run.cableType] } }
  if (run.layer === 'water_supply') { const n = model.waterNetworks.find(n => n.id === run.networkId)!; return { title: `${n.tag} · ${t(n.name)}`, lines: [room, `Ø${run.diameter} mm · ${t(run.material)}`, t('Proposed supply route')] } }
  const circuit = model.circuits.find(c => c.id === run.circuitId)!, load = model.symbols.find(s => s.id === run.toSymbolId)
  const design = model.electricalDesign?.circuits.find(c => c.id === circuit.id)
  return { title: `${circuit.tag} · ${t(circuit.name)}`, lines: [room, load && load.layer === 'electrical' ? t(load.label) : '', `${wireLabel(circuit.wireSize)} · ${circuit.breaker}`, ...(design ? [`DB ${design.panelId}`, `Connected ${design.connectedWatts ?? '?'} W · design current ${design.currentA?.toFixed(2) ?? '?'} A`, `Developed circuit route ${design.developedRouteM?.toFixed(2) ?? '?'} m · total drop ${design.totalDropPercent?.toFixed(2) ?? '?'}%`, 'Proposed circuit · engineering review required'] : [])] }
}
function RunLayer(props: SheetProps & { layerKey: UtilityLayer; filterId: string }) {
  const { layerKey, model, visible, room, circuit, zone, water, selected, scale, exporting, onSelect, onHover, filterId } = props
  const layer = UTILITY_LAYERS[layerKey]
  const locked = layerKey !== 'hvac' && !!props.drawingDocument?.layers[layerKey].locked
  if (layer.disabled || !visible[layerKey]) return null
  const displayed = displayedRuns(model, visible, room, circuit, zone, water), selectedCircuit = selected?.startsWith('circuit:') ? selected.slice(8) : null
  const trace = layerKey === 'drainage' ? drainageTrace(model.drainageDesign, selected) : null
  const drainNodes = layerKey === 'drainage' ? model.drainageDesign?.nodes.filter(n => model.drainageDesign!.input.visible[n.service] && (room === 'all' || n.roomId === room) && n.kind !== 'fixture') ?? [] : []
  const clusters = clusterDrainageNodes(drainNodes, scale)
  const protectedRects = [...clusters.map(c => ({ x: c.anchor.position.x - 18 / scale, y: c.anchor.position.y - 18 / scale, w: 36 / scale, h: 36 / scale })), ...model.floor.rooms.map(r => ({ x: r.rect.x + r.rect.w / 2 - Math.min(r.rect.w * .4, 60 / scale), y: r.rect.y + r.rect.h / 2 - 10 / scale, w: Math.min(r.rect.w * .8, 120 / scale), h: 27 / scale }))]
  const pipeLabels = layerKey === 'drainage' ? drainageLabels(displayed.flatMap(u => u.layer === 'drainage' && u.drainagePipe ? [u.drainagePipe] : []), scale, selected, !!props.drainageTechnical, protectedRects, props.box) : []
  // The same renderer owns paths, selection/glow, hit targets, circuit tags,
  // symbols and export for every layer. Only config/metadata select decoration.
  return <g data-layer={layerKey} opacity={layerKey === 'hvac' ? 1 : props.drawingDocument?.layers[layerKey].opacity ?? 1} pointerEvents={locked ? 'none' : undefined}>
    {displayed.filter(u => u.layer === layerKey).map(u => {
      const points = u.path.map(p => `${p.x},${p.y}`).join(' '), key = selectionForRun(u), active = selected === key || !!trace?.pipes.has(u.id)
      const circuitData = u.layer === 'electrical' ? model.circuits.find(c => c.id === u.circuitId) : u.layer === 'fire_alarm' ? model.zones.find(z => z.id === u.zoneId) : u.layer === 'water_supply' ? model.waterNetworks.find(n => n.id === u.networkId) : null
      const color = u.layer === 'drainage' && u.drainagePipe ? DRAINAGE_COLORS[u.drainagePipe.service] : circuitData?.color ?? layer.color, geometry = wiringPath(u, displayed, scale)
      const info = runInfo(model, u), label = [info.title, ...info.lines, ...(info.properties?.map(p => `${p.label}: ${p.value}`) ?? [])].join(' · '), length = pathLength(u.path)
      const markers = u.layer === 'drainage' && u.drainagePipe?.service !== 'vent' ? drainageFlowMarkers(u.path, scale) : []
      const drainStyle = u.layer === 'drainage' && u.drainagePipe ? DRAINAGE_DISPLAY[u.drainagePipe.service] : null, strokeWidth = drainStyle?.width ?? layer.width
      const tag = circuitData ? alongPath(u.path, Math.max(0, length - Math.min(length * .45, 32 / scale))) : null
      const ticks = u.layer === 'electrical' && UTILITY_LAYERS.electrical.showConductors ? alongPath(u.path, length * .4) : null
      return <g key={u.id} opacity={selected && !active ? .25 : 1}>
        {active && <path d={geometry.d} fill="none" stroke={color} strokeOpacity={.22} strokeWidth={layer.width + 8} vectorEffect="non-scaling-stroke" filter={`url(#${filterId})`} />}
        {geometry.jumps.map((j, i) => <path key={i} d={j.d} fill="none" stroke="white" strokeWidth={7} vectorEffect="non-scaling-stroke" />)}
        {u.layer === 'drainage' && <path d={geometry.d} fill="none" stroke="white" strokeWidth={strokeWidth + 3} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" pointerEvents="none" />}
        <path d={geometry.d} fill="none" stroke={color} strokeWidth={strokeWidth + (active ? 1 : 0)} strokeDasharray={drainStyle ? drainStyle.dash : layer.dash ?? undefined} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" pointerEvents="none" />
        {markers.map((p, i) => <path key={i} d={`M${-4 / scale} ${-4 / scale}L0 0L${-4 / scale} ${4 / scale}`} transform={`translate(${p.x} ${p.y}) rotate(${p.angle + (u.layer === 'drainage' && u.flowDirection === 'reverse' ? 180 : 0)})`} fill="none" stroke={color} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />)}
        {u.layer === 'drainage' && !u.drainagePipe?.vertical && <circle cx={u.path[0].x} cy={u.path[0].y} r={3 / scale} fill={color} stroke="white" strokeWidth={1.5} vectorEffect="non-scaling-stroke" pointerEvents="none" />}
        {tag && <g transform={`translate(${tag.x} ${tag.y}) scale(${1 / scale})`} pointerEvents="none"><rect x={-10} y={-18} width={21} height={13} rx={2} fill="white" stroke={color} strokeWidth={.5} /><text x={.5} y={-8} textAnchor="middle" fontSize={9} fill={color}>{circuitData!.tag}</text></g>}
        {ticks && u.layer === 'electrical' && <g transform={`translate(${ticks.x} ${ticks.y}) rotate(${ticks.angle}) scale(${1 / scale})`} stroke={color} strokeWidth={1.2}>{Array.from({ length: u.conductors }, (_, i) => <path key={i} d={`M${i * 4 - 4}-4l-3 8`} />)}</g>}
        {!exporting && !locked && <polyline points={points} fill="none" stroke="transparent" strokeWidth={matchMedia('(pointer: coarse)').matches ? 44 : 20} vectorEffect="non-scaling-stroke" role="button" aria-label={label} aria-pressed={active} tabIndex={0} data-run-id={key}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect?.(key) } }}
          onPointerMove={e => onHover?.(info, e.clientX, e.clientY)} onPointerLeave={() => onHover?.(null)} onFocus={e => { const r = e.currentTarget.getBoundingClientRect(); onHover?.(info, r.left + r.width / 2, r.top + r.height / 2) }} onBlur={() => onHover?.(null)} className="cursor-pointer focus:outline-none" />}
      </g>
    })}
    {pipeLabels.map(label => { const pipe = model.drainageDesign!.pipes.find(p => p.id === label.pipeId)!; return <g key={`label:${label.pipeId}`} pointerEvents="none" opacity={selected && !trace?.pipes.has(label.pipeId) ? .3 : 1}>
      <line x1={label.at.x} y1={label.at.y} x2={label.center.x} y2={label.center.y} stroke={DRAINAGE_COLORS[pipe.service]} strokeOpacity={.5} strokeWidth={.75} vectorEffect="non-scaling-stroke" />
      <rect x={label.rect.x} y={label.rect.y} width={label.rect.w} height={label.rect.h} rx={4 / scale} fill="white" stroke={DRAINAGE_COLORS[pipe.service]} strokeWidth={.7} vectorEffect="non-scaling-stroke" />
      <text x={label.center.x} y={label.center.y + 3.5 / scale} textAnchor="middle" fontSize={10 / scale} fill={DRAINAGE_COLORS[pipe.service]}>{label.text}</text>
    </g> })}
    {layerKey === 'drainage' && clusters.map(group => {
      const n = group.anchor, color = DRAINAGE_COLORS[n.service], count = group.nodes.length, active = group.nodes.some(n => trace?.nodes.has(n.id))
      const code = ({ stack: 'S', stack_base: 'SB', inspection_chamber: 'IC', outlet: 'OUT', trap: 'T', cleanout: 'CO', vent_terminal: 'V' } as Record<string, string>)[n.kind]
      const info: HoverInfo = { title: count > 1 ? `${t(DRAINAGE_NODE_NAMES[n.kind])} + ${count - 1}` : DRAINAGE_NODE_NAMES[n.kind], category: 'Drainage components', color, status: 'Proposed', reference: n.id,
        properties: [{ label: 'Components', value: String(count) }, { label: 'Elevation', value: n.elevationMm === null ? 'Not verified' : `${n.elevationMm} mm` }], lines: [...new Set(group.nodes.map(n => t(DRAINAGE_NODE_NAMES[n.kind])))].concat(count > 1 ? ['Select to inspect each component. Grouped for readability at this zoom.'] : []) }
      return <g key={group.id} data-drainage-cluster={count} transform={`translate(${n.position.x} ${n.position.y}) scale(${1 / scale})`} role={exporting || locked ? undefined : 'button'} tabIndex={exporting || locked ? undefined : 0} aria-label={[info.title, ...info.lines].join(' · ')} aria-pressed={active} data-run-id={n.id} pointerEvents={locked ? 'none' : undefined}
        onPointerMove={e => onHover?.(info, e.clientX, e.clientY)} onPointerLeave={() => onHover?.(null)} onFocus={e => { const r = e.currentTarget.getBoundingClientRect(); onHover?.(info, r.left + r.width / 2, r.top + r.height / 2) }} onBlur={() => onHover?.(null)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect?.(n.id) } }} opacity={selected && !active ? .4 : 1} className="cursor-pointer outline-none focus:[&_.drainage-node-face]:stroke-[3px]">
        <rect x={-22} y={-22} width={44} height={44} fill="transparent" />
        {active && <circle r={14} fill={color} fillOpacity={.12} />}
        {n.kind === 'inspection_chamber' || n.kind === 'outlet' ? <rect className="drainage-node-face" x={-10} y={-8} width={20} height={16} rx={2} fill="white" stroke={color} strokeWidth={1.5} /> : <circle className="drainage-node-face" r={9} fill="white" stroke={color} strokeWidth={1.5} />}
        <text y={3} textAnchor="middle" fontSize={code.length > 2 ? 6 : 8} fontWeight={600} fill={color} pointerEvents="none">{code}</text>
        {count > 1 && <g transform="translate(10 -10)" pointerEvents="none"><circle r={7} fill={color} stroke="white" strokeWidth={1.5} /><text y={2.8} textAnchor="middle" fontSize={8} fill="white">{count}</text></g>}
      </g>
    })}
    {displayedSymbols(model, visible, room, circuit, zone, water).filter(s => s.layer === layerKey && !(s.layer === 'drainage' && model.drainageDesign)).map(s => {
      const c = s.layer === 'electrical' ? model.circuits.find(c => c.id === (s.circuitIds.includes(circuit) ? circuit : selectedCircuit && s.circuitIds.includes(selectedCircuit) ? selectedCircuit : s.circuitIds[0])) : null
      const z = s.layer === 'fire_alarm' ? model.zones.find(z => z.id === s.zoneId) : null
      const n = s.layer === 'water_supply' ? model.waterNetworks.find(n => n.id === s.networkId) : null
      const selection = c ? `circuit:${c.id}` : z ? `zone:${z.id}` : n ? `water:${n.id}` : null, color = c?.color ?? z?.color ?? n?.color ?? layer.color
      const info: HoverInfo = { title: s.layer !== 'drainage' ? t(s.label) : t('Stack'), lines: [s.roomIds.map(id => t(model.floor.rooms.find(r => r.id === id)?.name)).join(', '), s.layer === 'electrical' ? s.circuitIds.map(id => t(model.circuits.find(c => c.id === id)?.name)).join(' / ') : s.layer === 'fire_alarm' ? `${z?.tag} · ${t(z?.name)} · ${s.connection === 'standalone' ? t('Standalone safety equipment') : t('Alarm loop')}` : n ? `${n.tag} · ${t(n.name)} · ${t('Source unverified')}` : t('Proposed stack location'), ...(s.layer === 'fire_alarm' ? [`${t('Concept coverage radius')}: ${s.coverageRadiusMm === null ? t('Not applicable') : `${s.coverageRadiusMm / 1000} m`}`] : [])] }
      return <g key={s.id} opacity={selected && selection !== selected && !(s.layer === 'drainage' && model.utilities.some(u => u.layer === 'drainage' && u.id === selected && u.stackId === s.id)) ? .2 : 1} transform={`translate(${s.position.x} ${s.position.y}) scale(${1 / scale})`}
        {...(!exporting && selection && !locked ? { role: 'button', tabIndex: 0, 'aria-label': [info.title, ...info.lines].join(' · '), 'aria-pressed': selected === selection, 'data-run-id': selection, onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect?.(selection) } } } : {})}
        onPointerMove={e => onHover?.(info, e.clientX, e.clientY)} onPointerLeave={() => onHover?.(null)} onFocus={() => onHover?.(info)} onBlur={() => onHover?.(null)}>
        {!exporting && selection && <rect x={-22} y={-22} width={44} height={44} fill="transparent" />}
        <UtilitySymbolGlyph type={s.type} color={color} />
        {s.type === 'vertical_stack' && <text x={13} y={-13} fontSize={10} fill={color} stroke="white" strokeWidth={3} paintOrder="stroke">{t('Stack')} *</text>}
      </g>
    })}
  </g>
}

/** Fire-only overlays supplement the shared RunLayer pipeline; paths, tags,
 * symbols, hit areas and exports above remain identical for every utility. */
function FireContext(props: SheetProps & { id: string }) {
  if (!props.visible.fire_alarm) return null
  const { model, room, zone, scale, selected, id, exporting } = props
  const devices = displayedSymbols(model, props.visible, room, props.circuit, zone).filter(s => s.layer === 'fire_alarm')
  const font = Math.max(140, 10 / scale)
  return <g data-fire-context="true" clipPath={`url(#${id}-slabs)`}>
    <defs><pattern id={`${id}-hatch`} width={10 / scale} height={10 / scale} patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1={0} y1={0} x2={0} y2={10 / scale} stroke="#c56363" strokeOpacity={.35} strokeWidth={1} vectorEffect="non-scaling-stroke" /></pattern>
      {model.floor.rooms.map((r, i) => <clipPath key={r.id} id={`${id}-room-${i}`}><rect x={r.rect.x} y={r.rect.y} width={r.rect.w} height={r.rect.h} /></clipPath>)}
    </defs>
    {model.coverage.filter(c => room === 'all' || c.roomId === room).map(c => {
      const index = model.floor.rooms.findIndex(r => r.id === c.roomId), r = model.floor.rooms[index].rect
      const match = selected === `exit:${c.roomId}` || selected === `coverage:${c.roomId}` || devices.some(s => s.roomId === c.roomId && selected === `zone:${s.zoneId}`)
      return <g key={c.roomId} clipPath={`url(#${id}-room-${index})`} pointerEvents="none" opacity={selected && !match ? .15 : 1}>
        {props.showCoverage && c.status !== 'covered' && c.status !== 'exempt' && <><rect x={r.x} y={r.y} width={r.w} height={r.h} fill="#ffebeb" fillOpacity={.4} /><rect x={r.x} y={r.y} width={r.w} height={r.h} fill={`url(#${id}-hatch)`} /></>}
        {props.showCoverage && devices.filter(s => s.roomId === c.roomId && s.coverageRadiusMm !== null).map(s => <circle key={s.id} cx={s.position.x} cy={s.position.y} r={s.coverageRadiusMm!} fill="#F57C00" fillOpacity={.075} stroke="#F57C00" strokeOpacity={.35} strokeWidth={1} strokeDasharray="5 5" vectorEffect="non-scaling-stroke" />)}
        {c.status === 'exempt' && <text x={r.x + r.w / 2} y={r.y + r.h * .85} textAnchor="middle" fontSize={Math.min(font, r.w / 17)} fill="#9c752c" stroke="white" strokeWidth={3 / scale} paintOrder="stroke">{t('Wet area - exempt')}</text>}
      </g>
    })}
    {props.showEvacuation && model.exitRoutes.filter(r => r.status === 'concept' && (room === 'all' || r.fromRoomId === room)).map(exit => {
      const key = `exit:${exit.fromRoomId}`, active = selected === key, points = exit.path.map(p => `${p.x},${p.y}`).join(' '), length = pathLength(exit.path), markers = []
      for (let d = 30 / scale; d < length - 8 / scale; d += 75 / scale) { const p = alongPath(exit.path, d); if (p) markers.push(p) }
      return <g key={exit.id} opacity={selected && !active ? .12 : active ? 1 : .65}>
        {active && <polyline points={points} fill="none" stroke="#258454" strokeOpacity={.15} strokeWidth={9} vectorEffect="non-scaling-stroke" />}
        <polyline points={points} className={exporting ? undefined : 'utility-evacuation-flow'} fill="none" stroke="#258454" strokeWidth={active ? 3 : 2} strokeDasharray="9 6" vectorEffect="non-scaling-stroke" pointerEvents="none" />
        {markers.map((p, i) => <path key={i} d={`M${-5 / scale} ${-4 / scale}L0 0L${-5 / scale} ${4 / scale}`} transform={`translate(${p.x} ${p.y}) rotate(${p.angle})`} fill="none" stroke="#258454" strokeWidth={1.5} vectorEffect="non-scaling-stroke" pointerEvents="none" />)}
      </g>
    })}
  </g>
}

function UtilitySheet(props: SheetProps) {
  const { model, box, room, selected, exporting, project, scale, svgRef } = props
  const drawing = props.drawingDocument
  const annotations = useMemo(() => drawing?.annotationsVisible ? drawingOpsSvg(drawing.annotations.filter(a => a.layer === 'annotations' || props.visible[a.layer]).flatMap(a => annotationOps(a, p => ({ x: p.x / drawing.settings.scale, y: p.y / drawing.settings.scale })))) : '', [drawing, props.visible])
  const glow = useId().replaceAll(':', ''), r = model.floor.outline, font = Math.max(140, 11 / scale)
  const sheetY = r.y + r.h + 1600, legend = utilityLegend(model, props.visible, props.circuit, false, props.zone, props.showEvacuation, props.showCoverage, props.water), rowHeight = Math.max(320, font * 1.6), footerHeight = 3700 + Math.ceil(legend.length / 2) * rowHeight
  return <svg ref={svgRef} xmlns="http://www.w3.org/2000/svg" viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`} className="h-full w-full" role="group" aria-label={t('Utility plan')} fontFamily="Arial, sans-serif" onPointerLeave={() => props.onHover?.(null)}>
    <desc>{project} · {t(model.floor.name)} · {t('Utilities')}</desc>
    <defs><filter id={glow} x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation={2 / scale} /></filter><clipPath id={`${glow}-slabs`}>{model.slabs.map((s, i) => <rect key={i} x={s.x} y={s.y} width={s.w} height={s.h} />)}</clipPath></defs>
    <rect x={box.x} y={box.y} width={box.w} height={box.h} fill="#ffffff" />
    <g opacity={selected ? .4 : 1}>
      <path d={model.slabs.map(rectPath).join(' ')} fill="#ffffff" stroke="#c8c8c3" strokeWidth={1} vectorEffect="non-scaling-stroke" />
      {model.floor.rooms.map(roomData => <g key={roomData.id} opacity={room === 'all' || room === roomData.id ? 1 : .2}
        {...(props.visible.fire_alarm && props.showEvacuation && !roomData.outdoor && !exporting ? { role: 'button', tabIndex: 0, 'aria-label': `${t('Evacuation route')} · ${t(roomData.name)}`, 'aria-pressed': selected === `exit:${roomData.id}`, 'data-run-id': `exit:${roomData.id}`, onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); props.onSelect?.(`exit:${roomData.id}`) } } } : {})}>
        <rect {...{ x: roomData.rect.x, y: roomData.rect.y, width: roomData.rect.w, height: roomData.rect.h }} fill={roomData.outdoor ? 'none' : '#fafaf8'} clipPath={`url(#${glow}-slabs)`} stroke="#e1e1dc" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        <text x={roomData.rect.x + roomData.rect.w / 2} y={roomData.rect.y + roomData.rect.h / 2 - font * .35} textAnchor="middle" fontSize={Math.min(font, roomData.rect.w / Math.max(4, t(roomData.name).length) * 1.4)} fill="#565651">{t(roomData.name)}</text>
        {(!props.visible.drainage || scale > .06) && <text x={roomData.rect.x + roomData.rect.w / 2} y={roomData.rect.y + roomData.rect.h / 2 + font * .9} textAnchor="middle" fontSize={font * .72} fill="#898982">{roomData.area.toFixed(1)} m²</text>}
      </g>)}
      {model.floor.walls.map((w, i) => <line key={i} x1={w.a.x} y1={w.a.y} x2={w.b.x} y2={w.b.y} stroke="#d6d6d0" strokeWidth={w.thickness} />)}
      {model.floor.openings.map((o, i) => <g key={i}>
        <line x1={o.at.x - (o.orient === 'h' ? o.width / 2 : 0)} y1={o.at.y - (o.orient === 'v' ? o.width / 2 : 0)} x2={o.at.x + (o.orient === 'h' ? o.width / 2 : 0)} y2={o.at.y + (o.orient === 'v' ? o.width / 2 : 0)} stroke={o.kind === 'window' ? '#adb7b5' : '#ffffff'} strokeWidth={Math.max(260, ...model.floor.walls.filter(w => w.rooms?.some(id => o.rooms?.includes(id))).map(w => w.thickness + 10))} />
        {o.kind === 'window' && <line x1={o.at.x - (o.orient === 'h' ? o.width / 2 : 0)} y1={o.at.y - (o.orient === 'v' ? o.width / 2 : 0)} x2={o.at.x + (o.orient === 'h' ? o.width / 2 : 0)} y2={o.at.y + (o.orient === 'v' ? o.width / 2 : 0)} stroke="white" strokeWidth={1} vectorEffect="non-scaling-stroke" />}
      </g>)}
      {model.fixtures.filter(f => f.type !== 'floor_drain' || props.visible.drainage).map(f => <g key={f.id} opacity={room === 'all' || room === f.roomId ? 1 : .2} transform={`translate(${f.position.x} ${f.position.y})`} fill="white" stroke="#888e87" strokeWidth={1 / scale}>
        {f.type === 'toilet' ? <><rect x={-f.width / 2} y={-f.depth / 2} width={f.width} height={f.depth * .24} rx={30} /><ellipse cy={f.depth * .1} rx={f.width * .48} ry={f.depth * .37} /><ellipse cy={f.depth * .1} rx={f.width * .28} ry={f.depth * .24} /></> : <><rect x={-f.width / 2} y={-f.depth / 2} width={f.width} height={f.depth} rx={f.type === 'shower' ? 20 : 65} /><path d={f.type === 'shower' ? `M${-f.width / 2} ${-f.depth / 2}l${f.width} ${f.depth}m${-f.width} 0l${f.width} ${-f.depth}` : `M${-f.width * .3} 0h${f.width * .6}`} fill="none" /></>}
      </g>)}
    </g>
    {drawing?.grid && <g pointerEvents="none" clipPath={`url(#${glow}-slabs)`}><defs><pattern id={`${glow}-grid`} width={1000} height={1000} patternUnits="userSpaceOnUse"><path d="M1000 0H0V1000" fill="none" stroke="#dde5df" strokeWidth={1 / scale} /></pattern></defs><rect x={r.x} y={r.y} width={r.w} height={r.h} fill={`url(#${glow}-grid)`} /></g>}
    <FireContext {...props} id={glow} />
    {Object.keys(UTILITY_LAYERS).map(key => <RunLayer key={key} {...props} layerKey={key as UtilityLayer} filterId={glow} />)}
    <g data-layer="structure" fill="#b8b9b3" stroke="#8f968e" strokeWidth={1 / scale}>{(model.floor.columns ?? []).map(c => <rect key={c.id} x={c.at.x - c.size / 2} y={c.at.y - c.size / 2} width={c.size} height={c.size} />)}</g>
    {drawing && <g data-layer="annotations" pointerEvents="none" transform={`scale(${drawing.settings.scale})`} dangerouslySetInnerHTML={{ __html: annotations }} />}
    <g fill="#66665f" fontSize={font * .8}>
      <path d={`M${r.x - 750} ${r.y + 700}v-1000m-180 250l180-250 180 250`} fill="none" stroke="#77776f" strokeWidth={1} vectorEffect="non-scaling-stroke" /><text x={r.x - 750} y={r.y - 500} textAnchor="middle">↑</text>
      <text x={r.x} y={r.y - 700}>{t('Plan up · geographic north unverified')}</text>
      <path d={`M${r.x} ${r.y + r.h + 600}h2000m-2000-100v200m1000-200v200m1000-200v200`} stroke="#77776f" strokeWidth={1} fill="none" vectorEffect="non-scaling-stroke" /><text x={r.x} y={r.y + r.h + 1100}>0</text><text x={r.x + 2000} y={r.y + r.h + 1100}>2 m</text>
    </g>
    {exporting && <g fontSize={font * .8} fill="#50504a"><rect x={r.x - 500} y={sheetY} width={r.w + 1000} height={footerHeight} fill="white" stroke="#d0d0ca" strokeWidth={1} vectorEffect="non-scaling-stroke" />
      <text x={r.x} y={sheetY + 450} fontSize={font * 1.15}>{project} · {t('Utilities')} · {t(model.floor.name)}</text>
      <text x={r.x} y={sheetY + 950}>{new Date().toLocaleDateString()} · {t('Scale: graphic bar; fit to page')}</text>
      {legend.map((entry, i) => { const x = r.x + (i % 2) * (r.w / 2), y = sheetY + 1500 + Math.floor(i / 2) * rowHeight; return <g key={i} transform={`translate(${x} ${y})`}>
        {entry.symbol ? <g transform={`translate(220 0) scale(${1 / scale})`}><UtilitySymbolGlyph type={entry.symbol} color={entry.color} /></g> : <path d="M0 0h500" stroke={entry.color} strokeDasharray={entry.dash ? '90 45' : undefined} strokeWidth={2} vectorEffect="non-scaling-stroke" />}
        <text x={650} y={font * .25} fill={entry.color}>{t(entry.label)}</text>
      </g> })}
      <text x={r.x} y={sheetY + footerHeight - 1250}>{t('Proposed services. Electrical sizing uses supplied evidence; missing ratings remain unknown.')}</text>
      {props.visible.water_supply && <text x={r.x} y={sheetY + footerHeight - 1650}>{t('Water routes are proposals. Upstream supply, heater location and hydraulic design require review.')}</text>}
      {props.visible.fire_alarm && <><text x={r.x} y={sheetY + footerHeight - 800}>{t('Fire coverage: smoke 7.5 m / heat 5 m. Concept radii only; walls limit coverage.')}</text><text x={r.x} y={sheetY + footerHeight - 500}>{t('Wet-area exemption and evacuation routes are concept assumptions; professional review required.')}</text></>}
      <text x={r.x} y={sheetY + footerHeight - 250}>{t('Concept checks only. This is not a compliance certificate.')}</text>
    </g>}

  </svg>
}

export function UtilityPlanViewer({ model: sourceModel, project, reviewScope, mode, onModeChange: setMode }: { model: UtilityFloor; project: string; reviewScope: string; mode: Mode; onModeChange: (mode: Mode) => void }) {
  useLanguage(s => s.language)
  const drawing = useUtilityDrawing(sourceModel, project, reviewScope), drawingDoc = drawing.document
  const model = useMemo(() => withElectricalDesign(withDrainageDesign(drawing.model, drawingDoc.drainage), drawingDoc.electrical), [drawing.model, drawingDoc.drainage, drawingDoc.electrical])
  const changeDrawing = (edit: (doc: DrawingDocument) => void) => { drawing.change(edit) }
  const [sheetOpen, setSheetOpen] = useState(false), [panelsOpen, setPanelsOpen] = useState(false), [helpOpen, setHelpOpen] = useState(false), [exportBusy, setExportBusy] = useState('')
  const [restoreCandidate, setRestoreCandidate] = useState<UtilityDrawingProject | null>(null), [sessionMessage, setSessionMessage] = useState(''), [printPage, setPrintPage] = useState(0)
  const helpDialog = useRef<HTMLDialogElement>(null)
  const [planVisible, setPlanVisible] = useState(false)
  const [circuit, setCircuit] = useState('all')
  const [zone, setZone] = useState('all'), [showCoverage, setShowCoverage] = useState(false), [showEvacuation, setShowEvacuation] = useState(false)
  const [showElectrical3D, setShowElectrical3D] = useState(true), [seeThroughWalls, setSeeThroughWalls] = useState(true), [showRoomNames3D, setShowRoomNames3D] = useState(true)
  const [water, setWater] = useState('all'), [showWater3D, setShowWater3D] = useState(true), [showHotWater, setShowHotWater] = useState(true), [seeThroughFloor, setSeeThroughFloor] = useState(true)
  const [room, setRoom] = useState('all'), [selected, setSelected] = useState<string | null>(null)
  const [drainageTechnical, setDrainageTechnical] = useState(false)
  const visible = useMemo(() => visibleLayers(drawingDoc), [drawingDoc])
  const [box, setBox] = useState<Box | null>(null), [width, setWidth] = useState(800), [error, setError] = useState('')
  const [tooltip, setTooltip] = useState<{ info: HoverInfo; x: number; y: number } | null>(null)
  const host = useRef<HTMLDivElement>(null)
  const pointers = useRef(new Map<number, Point>()), gesture = useRef<{ x: number; y: number; distance: number; travel: number; moved: boolean; run: string | null } | null>(null)
  const r = useMemo(() => visible.drainage ? drainageBounds(model) : model.floor.outline, [model, visible.drainage]), baseBox = { x: r.x - 1800, y: r.y - 1800, w: r.w + 3600, h: r.h + 3600 }
  const [height, setHeight] = useState(520)
  const fit = useMemo(() => {
    const aspect = width / height, center = rectCenter(r), w = Math.max(baseBox.w, baseBox.h * aspect), h = w / aspect
    return { x: center.x - w / 2, y: center.y - h / 2, w, h }
  }, [r, width, height, baseBox.w, baseBox.h])
  const current = box ?? fit, scale = width / current.w
  const run = model.utilities.find(u => u.id === selected)
  const selectedCircuit = model.circuits.find(c => selected === `circuit:${c.id}`)
  const selectedZone = model.zones.find(z => selected === `zone:${z.id}`), selectedExit = model.exitRoutes.find(r => selected === `exit:${r.fromRoomId}`)
  const selectedCoverage = model.coverage.find(c => selected === `coverage:${c.roomId}`)
  const selectedWater = model.waterNetworks.find(n => selected === `water:${n.id}`)
  const shown = useMemo(() => displayedRuns(model, visible, room, circuit, zone, water), [model, visible, room, circuit, zone, water])
  const legend = utilityLegend(model, visible, circuit, false, zone, showEvacuation, showCoverage, water)
  const selectedName = (u: UtilityRun) => { const info = runInfo(model, u); return u.layer === 'drainage' ? `${info.title} · ${info.category} · ${info.properties?.[0]?.value ?? ''}` : `${info.title} · ${info.lines[0]} · ${info.lines[1]}` }
  const connected = selectedCircuit ? connectedLoads(model, selectedCircuit) : []
  const electric3D = useMemo(() => electricalScene(model, room, circuit), [model, room, circuit])
  const electricVisible3D = mode === '3d' && visible.electrical && showElectrical3D
  const water3D = useMemo(() => waterScene(model, room, water, showHotWater), [model, room, water, showHotWater])
  const waterVisible3D = mode === '3d' && visible.water_supply && showWater3D


  useEffect(() => {
    const el = host.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => { if (entry.contentRect.width > 0 && entry.contentRect.height > 0) { setWidth(entry.contentRect.width); setHeight(entry.contentRect.height); setBox(null) } })
    observer.observe(el); return () => observer.disconnect()
  }, [])
  useEffect(() => {
    if (mode === '3d') { setPlanVisible(false); return }
    const timer = setTimeout(() => setPlanVisible(true), matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 600)
    return () => clearTimeout(timer)
  }, [mode])
  const select = (id: string | null) => {
    setSelected(id); setTooltip(null)
    if (id?.startsWith('circuit:') || id?.startsWith('zone:') || id?.startsWith('water:') || id?.startsWith('exit:') || id?.startsWith('coverage:')) {
      // A circuit selection must trace its entire topology, even if the click
      // originated in a single-room focus. Room filtering remains independent.
      if (id.startsWith('circuit:') || id.startsWith('zone:') || id.startsWith('water:')) setRoom('all')
      const coverageRoom = id.startsWith('coverage:') ? model.floor.rooms.find(r => r.id === id.slice(9))?.rect : null
      const points = coverageRoom ? [{ x: coverageRoom.x, y: coverageRoom.y }, { x: coverageRoom.x + coverageRoom.w, y: coverageRoom.y + coverageRoom.h }] : id.startsWith('exit:') ? model.exitRoutes.find(r => r.fromRoomId === id.slice(5))?.path ?? [] : model.utilities.flatMap(u => selectionForRun(u) === id ? u.path : [])
      if (points.length) {
        const minX = Math.min(...points.map(p => p.x)), minY = Math.min(...points.map(p => p.y)), maxX = Math.max(...points.map(p => p.x)), maxY = Math.max(...points.map(p => p.y))
        const w = Math.max(maxX - minX + 2200, (maxY - minY + 2200) * width / height), h = w * height / width
        setBox({ x: (minX + maxX - w) / 2, y: (minY + maxY - h) / 2, w, h })
      }
    }
  }
  const hover = (info: HoverInfo | null, x?: number, y?: number) => {
    if (!info || pointers.current.size) { setTooltip(null); return }
    const bounds = host.current?.getBoundingClientRect()
    if (!bounds) return
    setTooltip({ info, x: (x ?? bounds.left + width / 2) - bounds.left, y: (y ?? bounds.top + 40) - bounds.top })
  }
  const zoom = (factor: number, fx = .5, fy = .5) => {
    setTooltip(null)
    setBox(b => { const old = b ?? fit, w = Math.max(fit.w * .18, Math.min(fit.w * 3, old.w * factor)), f = w / old.w; return { x: old.x + old.w * fx * (1 - f), y: old.y + old.h * fy * (1 - f), w, h: old.h * f } })
  }
  useEffect(() => {
    const el = host.current
    if (!el) return
    const wheel = (e: WheelEvent) => { if (mode !== '2d') return; e.preventDefault(); const b = el.getBoundingClientRect(); zoom(Math.exp(Math.max(-100, Math.min(100, e.deltaY)) * .002), (e.clientX - b.left) / b.width, (e.clientY - b.top) / b.height) }
    el.addEventListener('wheel', wheel, { passive: false }); return () => el.removeEventListener('wheel', wheel)
  })
  function gestureNow() { const p = [...pointers.current.values()]; return p.length > 1 ? { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2, distance: Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) } : { x: p[0]?.x ?? 0, y: p[0]?.y ?? 0, distance: 0 } }
  const focusRoom = (id: string) => {
    setRoom(id); select(null); setMode('2d'); setSheetOpen(false)
    const focused = model.floor.rooms.find(r => r.id === id)
    if (!focused) { setBox(null); return }
    const r = focused.rect, w = Math.max(r.w + 1800, (r.h + 1800) * width / height), h = w * height / width
    setBox({ x: r.x + r.w / 2 - w / 2, y: r.y + r.h / 2 - h / 2, w, h })
  }
  const drainageRooms = model.floor.rooms.filter(r => model.drainageDesign?.fixtures.some(f => f.roomId === r.id))
  const sheet = { model, drawingDocument: drawingDoc, visible, room, circuit, zone, water, showCoverage, showEvacuation, selected, project, drainageTechnical }
  const span = Math.max(r.w, r.h) / 1000, camera = useMemo(() => ({ position: [(r.x + r.w / 2) / 1000 + span, span * 1.1, (r.y + r.h / 2) / 1000 + span] as [number, number, number], fov: 42, far: 500 }), [r, span])
  const sheetResult = useMemo(() => { try { return { pages: buildDrawingSheets(model, drawingDoc, drawingDoc.activeLayer, []), error: '' } } catch (e) { return { pages: [], error: (e as Error).message } } }, [model, drawingDoc])
  const modelSignature = useMemo(() => sourceSignature(drawing.model), [drawing.model])
  const snapshot: UtilityDrawingProject = { format: 'formstead-utility-project', version: 1, savedAt: new Date().toISOString(), sourceSignature: modelSignature, model: drawing.model, document: drawingDoc, reviews: {}, view: { room, circuit, zone, water, showClashes: false, showCoverage, showEvacuation, mode, sheetOpen, showClashes3D: false, showElectrical3D, showWater3D, showHotWater, seeThroughWalls, seeThroughFloor, showRoomNames3D, selected } }
  const session = useRef({ snapshot, pending: false })
  useEffect(() => { session.current = { snapshot, pending: !!restoreCandidate } }, [snapshot, restoreCandidate])
  useEffect(() => {
    try { const saved = localStorage.getItem(`formstead.utility-session.v1:${reviewScope}`); if (saved) setRestoreCandidate(parseUtilityDrawing(JSON.parse(saved))) } catch { setSessionMessage('The last utility session could not be read. Your live plan is unchanged.') }
    const timer = setInterval(() => { if (session.current.pending) return; try { localStorage.setItem(`formstead.utility-session.v1:${reviewScope}`, JSON.stringify(session.current.snapshot)); setSessionMessage('Session saved on this device.') } catch { setSessionMessage('Session storage is unavailable. Save project JSON to keep your drawing.') } }, 30000)
    return () => clearInterval(timer)
  }, [reviewScope])
  useEffect(() => { if (helpOpen) helpDialog.current?.showModal(); else helpDialog.current?.close() }, [helpOpen])
  const saveProject = () => { try { parseUtilityDrawing(session.current.snapshot); saveBlob(new Blob([JSON.stringify(session.current.snapshot, null, 2)], { type: 'application/json' }), `${drawingDoc.settings.projectCode}-utility-project.json`); setSessionMessage('Project JSON downloaded.') } catch { setError('This utility snapshot could not be saved. Your source project is unchanged.') } }
  const restoreProject = (saved: UtilityDrawingProject) => {
    drawing.load(saved); setRoom(saved.view.room); setCircuit(saved.view.circuit); setZone(saved.view.zone); setWater(saved.view.water)
    setShowCoverage(saved.view.showCoverage); setShowEvacuation(saved.view.showEvacuation)
    setShowElectrical3D(saved.view.showElectrical3D); setShowWater3D(saved.view.showWater3D); setShowHotWater(saved.view.showHotWater); setSeeThroughWalls(saved.view.seeThroughWalls); setSeeThroughFloor(saved.view.seeThroughFloor); setShowRoomNames3D(saved.view.showRoomNames3D)
    setSelected(saved.view.selected?.startsWith('clash:') ? null : saved.view.selected); setBox(null); setRestoreCandidate(null); setSheetOpen(saved.view.sheetOpen); setMode(saved.view.mode); setError('')
  }
  const loadProject = async (file: File) => { try { if (file.size > 15000000) throw new Error('File is too large.'); restoreProject(parseUtilityDrawing(JSON.parse(await file.text()))) } catch { setError('This is not a valid Formstead Utility project JSON. No data was changed.') } }
  const exportDrawing = async (kind: SheetExportKind, page = 0) => {
    if (exportBusy) return
    setExportBusy(kind); setError('')
    try {
      const pages = sheetResult.pages, currentSheet = pages[page] ?? pages[0]
      if (!currentSheet) throw new Error(sheetResult.error || 'There are no sheets to export.')
      if (kind === 'pdf') await downloadVectorSheets(pages, currentSheet.number)
      else if (kind === 'png') await downloadSheetPng(currentSheet, drawingDoc.settings.dpi)
      else if (kind === 'svg') downloadSheetSvg(currentSheet)
      else if (kind === 'dxf') downloadUtilityDxf(model, drawingDoc)
      else {
        const all = structuredClone(drawingDoc); for (const key of DRAWING_LAYERS) all.layers[key].visible = true
        const pages = [...DRAWING_LAYERS.flatMap(key => buildDrawingSheets(model, all, key)), ...buildDrawingSheets(model, all, 'coordination')]
        await downloadVectorSheets(pages, `${drawingDoc.settings.projectCode}-utility-sheet-set`)
      }
    } catch (e) { setError((e as Error).message || 'The drawing could not be exported. Please try a smaller sheet or SVG.') } finally { setExportBusy('') }
  }
  useEffect(() => {
    const shortcut = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.closest('input,textarea,select,[contenteditable=true]')
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); saveProject(); return }
      if (typing || document.querySelector('dialog[open]')) return
      if ((e.ctrlKey || e.metaKey) && ['z', 'y'].includes(e.key.toLowerCase())) { e.preventDefault(); if (e.key.toLowerCase() === 'y' || e.shiftKey) drawing.redo(); else drawing.undo(); return }
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (/^[1-4]$/.test(e.key)) { const key = DRAWING_LAYERS[Number(e.key) - 1]; changeDrawing(d => { d.layers[key].visible = !d.layers[key].visible }); select(null) }
      else if (e.key.toLowerCase() === 'g') changeDrawing(d => { d.grid = !d.grid })
      else if (e.key === '?') setHelpOpen(true)
      else if (e.key === 'Escape') { setPanelsOpen(false); select(null) }
    }
    window.addEventListener('keydown', shortcut); return () => window.removeEventListener('keydown', shortcut)
  })
  const printDrawing = (page: number) => { setPrintPage(page); requestAnimationFrame(() => requestAnimationFrame(() => window.print())) }
  const printed = sheetResult.pages[Math.min(printPage, Math.max(0, sheetResult.pages.length - 1))]
  return <div className="utility-workspace mt-5" data-theme={drawingDoc.theme}>
    {restoreCandidate && <section className="mb-4 flex flex-wrap items-center gap-3 border border-line bg-bg-inset p-4 text-xs" aria-label={t('Restore last session')}><p className="flex-1">{t('A previous utility drawing session is available. Restore its routes and drawing settings?')} <span className="font-mono">{new Date(restoreCandidate.savedAt).toLocaleString()}</span></p><button className={button} onClick={() => restoreProject(restoreCandidate)}>{t('Restore last session')}</button><button className={button} onClick={() => setRestoreCandidate(null)}>{t('Keep live plan')}</button></section>}
    {drawing.imported && <div className="mb-4 flex flex-wrap items-center gap-3 border border-line bg-bg-inset p-4 text-xs"><p className="flex-1">{t('Viewing a saved utility snapshot. Your Formstead building and BOQ have not been replaced.')}</p><button className={button} onClick={() => { drawing.returnToLive(); setRoom('all'); setCircuit('all'); setZone('all'); setWater('all'); select(null); setBox(null) }}>{t('Return to live plan')}</button></div>}
    {drawing.sourceChanged && drawingDoc.annotations.length > 0 && <p className="mb-4 border border-line p-3 text-xs">{t('The source plan changed. Review annotation positions before issuing this drawing.')}</p>}
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div className="flex flex-wrap gap-3"><div className="flex border border-line" role="group" aria-label={t('Utility views')}>{(['3d', '2d'] as const).map(v => <button key={v} type="button" aria-pressed={!sheetOpen && mode === v} className={`${button} border-0 ${!sheetOpen && mode === v ? 'bg-accent text-bg hover:text-bg' : ''}`} onClick={() => { setMode(v); setSheetOpen(false); setTooltip(null) }}>{t(v === '3d' ? '3D' : '2D plan')}</button>)}</div><button className={`${button} ${sheetOpen ? 'bg-accent text-bg' : ''}`} aria-pressed={sheetOpen} onClick={() => { setSheetOpen(true); setMode('2d'); setPanelsOpen(false) }}>{t('Drawing sheets')}</button></div>
      <ExportDropdown label="Download utility plan" title="Download utility plan" items={[{ id: 'pdf', label: 'Vector sheet PDF', ext: '.pdf', onExport: () => exportDrawing('pdf') }, { id: 'png', label: 'Export PNG', ext: '.png', onExport: () => exportDrawing('png') }, { id: 'svg', label: 'Export SVG', ext: '.svg', onExport: () => exportDrawing('svg') }, { id: 'dxf', label: 'Export DXF', ext: '.dxf', onExport: () => exportDrawing('dxf') }, { id: 'all', label: 'Export all sheets PDF', ext: '.pdf', onExport: () => exportDrawing('all') }]} />
    </div>
    {sheetOpen && <UtilityDrawingWorkbench model={model} document={drawingDoc} change={changeDrawing} sheets={sheetResult.pages} sheetError={sheetResult.error} busy={exportBusy} onExport={exportDrawing} onSave={saveProject} onLoad={loadProject} onHelp={() => setHelpOpen(true)} undo={drawing.undo} redo={drawing.redo} canUndo={drawing.canUndo} canRedo={drawing.canRedo} onPrint={printDrawing} />}
    {visible.drainage && model.drainageDesign && <DrainageWorkbench model={drawing.model} design={model.drainageDesign} change={edit => { const next = structuredClone(drawingDoc.drainage); edit(next); const parsed = drainageInputsSchema.safeParse(next); if (!parsed.success) { setError('This drainage input is outside the supported range. No data was changed.'); return } changeDrawing(doc => { doc.drainage = parsed.data }); setError('') }} focus={(p, id) => { setMode('2d'); setSheetOpen(false); setSelected(model.drainageDesign?.pipes.find(pipe => pipe.from === id)?.id ?? id); if (p) setBox({ x: p.x - 3000, y: p.y - 3000 * height / width, w: 6000, h: 6000 * height / width }) }} />}
    {visible.electrical && model.electricalDesign && <ElectricalWorkbench model={model} design={model.electricalDesign} apply={input => changeDrawing(doc => { doc.electrical = input })} focus={(p, selection) => { setMode('2d'); setSheetOpen(false); const run = model.utilities.find(r => r.id === selection); setSelected(run ? selectionForRun(run) : selection || null); if (p) setBox({ x: p.x - 3000, y: p.y - 3000 * height / width, w: 6000, h: 6000 * height / width }) }} />}
    {!sheetOpen && <button className={`${button} fixed bottom-4 left-1/2 z-30 -translate-x-1/2 bg-accent text-bg shadow-lg lg:hidden`} aria-expanded={panelsOpen} onClick={() => setPanelsOpen(v => !v)}>{t('Utility panels')} {panelsOpen ? '−' : '+'}</button>}
    {panelsOpen && !sheetOpen && <button aria-label={t('Close utility panels')} className="fixed inset-0 z-30 bg-black/30 lg:hidden" onClick={() => setPanelsOpen(false)} />}
    <div className={`${sheetOpen ? 'hidden' : 'grid'} gap-5 lg:grid-cols-[230px_minmax(0,1fr)]`}>
      <aside className={`${panelsOpen ? 'fixed inset-x-0 bottom-0 z-40 max-h-[80dvh] overflow-y-auto' : 'hidden'} order-2 border border-line bg-bg p-4 lg:static lg:order-none lg:block lg:max-h-none`} aria-label={t('Utility controls')}>
        <button className={`${button} mb-3 w-full lg:hidden`} onClick={() => setPanelsOpen(false)}>{t('Close utility panels')}</button>
        <UtilityLayerPanel document={drawingDoc} change={changeDrawing} onSelectClear={() => select(null)} />
        {!DRAWING_LAYERS.some(key => visible[key]) && <p role="status" className="mt-3 text-xs leading-relaxed text-ink-dim">{t('Choose a utility layer to view its connections.')}</p>}
        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-1"><label className="block text-xs text-ink-dim">{t('Room filter')}<select className="mt-2 min-h-11 w-full border border-line bg-bg px-2 text-ink" value={room} onChange={e => {
          const id = e.target.value, focused = model.floor.rooms.find(rm => rm.id === id)
          setRoom(id); select(null)
          if (!focused) { setBox(null); return }
          const r = focused.rect, w = Math.max(r.w + 1800, (r.h + 1800) * width / height), h = w * height / width
          setBox({ x: r.x + r.w / 2 - w / 2, y: r.y + r.h / 2 - h / 2, w, h })
        }}><option value="all">{t('All rooms')}</option>{model.floor.rooms.map(rm => <option key={rm.id} value={rm.id}>{t(rm.name)}</option>)}</select></label>
        <label className="block text-xs text-ink-dim">{t('Circuit filter')}<select aria-label={t('Circuit filter')} className="mt-2 min-h-11 w-full border border-line bg-bg px-2 text-ink" value={circuit} disabled={!visible.electrical} onChange={e => { setCircuit(e.target.value); select(null) }}><option value="all">{t('All circuits')}</option>{model.circuits.map(c => <option key={c.id} value={c.id}>{c.tag} · {t(c.name)}</option>)}</select></label>
        <label className="block text-xs text-ink-dim">{t('Zone filter')}<select aria-label={t('Zone filter')} className="mt-2 min-h-11 w-full border border-line bg-bg px-2 text-ink" value={zone} disabled={!visible.fire_alarm} onChange={e => { setZone(e.target.value); select(null); setMode('2d') }}><option value="all">{t('All zones')}</option>{model.zones.map(z => <option key={z.id} value={z.id}>{z.tag} · {t(z.name)}</option>)}</select></label></div>
        <div className="mt-4 border-y border-line py-2">{([[showCoverage, setShowCoverage, 'Show coverage'], [showEvacuation, setShowEvacuation, 'Show evacuation routes']] as const).map(([value, setter, label]) => <label key={label} className="flex min-h-11 items-center gap-2 text-xs"><input type="checkbox" className="accent-accent" checked={value} disabled={!visible.fire_alarm} onChange={e => { setter(e.target.checked); select(null); setTooltip(null); if (e.target.checked) setMode('2d') }} />{t(label)}</label>)}</div>
        <fieldset className="mt-4 border-b border-line pb-2"><legend className="font-display text-lg">{t('3D electrical')}</legend><label className="flex min-h-11 items-center gap-2 text-xs"><input type="checkbox" className="accent-accent" checked={visible.electrical && showElectrical3D} disabled={!visible.electrical} onChange={e => { setShowElectrical3D(e.target.checked); setMode('3d') }} />{t('Show wiring in 3D')}</label></fieldset>
        <fieldset className="mt-4 border-b border-line pb-2"><legend className="font-display text-lg">{t('3D water supply')}</legend><label className="block text-xs text-ink-dim">{t('Water supply filter')}<select aria-label={t('Water supply filter')} disabled={!visible.water_supply} className="mt-2 min-h-11 w-full border border-line bg-bg px-2 text-ink" value={water} onChange={e => { setWater(e.target.value); select(null) }}><option value="all">{t('All supplies')}</option>{model.waterNetworks.map(n => <option key={n.id} value={n.id}>{n.tag} · {t(n.name)}</option>)}</select></label>{([[showWater3D, setShowWater3D, 'Show water pipes in 3D'], [showHotWater, setShowHotWater, 'Show hot-water proposals']] as const).map(([value, setter, label]) => <label key={label} className="flex min-h-11 items-center gap-2 text-xs"><input type="checkbox" className="accent-accent" checked={visible.water_supply && value} disabled={!visible.water_supply} onChange={e => { setter(e.target.checked); setMode('3d'); select(null) }} />{t(label)}</label>)}</fieldset>
        <fieldset className="mt-4 border-b border-line pb-2"><legend className="font-display text-lg">{t('3D view options')}</legend>{([[seeThroughWalls, setSeeThroughWalls, 'See through walls'], [seeThroughFloor, setSeeThroughFloor, 'See through floor'], [showRoomNames3D, setShowRoomNames3D, 'Room labels']] as const).map(([value, setter, label]) => <label key={label} className="flex min-h-11 items-center gap-2 text-xs"><input type="checkbox" className="accent-accent" checked={value} onChange={e => { setter(e.target.checked); setMode('3d') }} />{t(label)}</label>)}</fieldset>
        <label className="mt-4 block text-xs text-ink-dim">{t('Select a connection')}<select className="mt-2 min-h-11 w-full border border-line bg-bg px-2 text-ink" value={run?.id ?? shown.find(u => selectionForRun(u) === selected)?.id ?? ''} onChange={e => { const selectedRun = shown.find(u => u.id === e.target.value); if (selectedRun && selectedRun.layer !== 'electrical' && selectedRun.layer !== 'water_supply') setMode('2d'); select(selectedRun ? selectionForRun(selectedRun) : null) }}><option value="">{t('No selection')}</option>{shown.map(u => <option key={u.id} value={u.id}>{selectedName(u)}</option>)}</select></label>
        {run && run.layer !== 'drainage' && <div aria-live="polite" className="mt-4 border-t border-line pt-4 text-xs"><p className="break-all font-mono text-[10px]">{run.id}</p><p className="mt-2">{selectedName(run)}</p>{runInfo(model, run).lines.slice(2).map((line, i) => <p key={i} className="mt-2 text-ink-dim">{line}</p>)}<button className={`${button} mt-3 w-full`} onClick={() => select(null)}>{t('Clear selection')}</button></div>}
        {selectedCircuit && <section aria-label={t('Circuit details')} aria-live="polite" className="mt-4 border-t border-line pt-4 text-xs">
          <h3 className="font-display text-lg" style={{ color: selectedCircuit.color }}>{selectedCircuit.tag} · {t(selectedCircuit.name)}</h3>
          <dl className="mt-3 grid grid-cols-2 gap-2"><dt className="text-ink-faint">{t('Breaker rating')}</dt><dd>{selectedCircuit.breaker}</dd><dt className="text-ink-faint">{t('Wire size')}</dt><dd>{wireLabel(selectedCircuit.wireSize)}</dd><dt className="text-ink-faint">{t('Connected loads')}</dt><dd>{connected.length} / {selectedCircuit.loads.length} {t('planned')}</dd></dl>
          <p className="mt-3 text-ink-dim">{t(selectedCircuit.status === 'needs-review' ? 'Some loads need a door/routing review.' : 'Concept circuit · not an electrical design approval.')}</p>
          <ul className="mt-3 space-y-2">{selectedCircuit.loads.map(id => { const symbol = model.symbols.find(s => s.id === id); return symbol?.layer === 'electrical' && <li key={id}>{t(symbol.label)} · {t(model.floor.rooms.find(rm => rm.id === symbol.roomId)?.name)}{!connected.includes(id) && ` · ${t('Routing pending')}`}</li> })}</ul>
          <button className={`${button} mt-3 w-full`} onClick={() => select(null)}>{t('Clear selection')}</button>
        </section>}
        {selectedZone && <section aria-label={t('Zone details')} aria-live="polite" className="mt-4 border-t border-line pt-4 text-xs">
          <h3 className="font-display text-lg" style={{ color: selectedZone.color }}>{selectedZone.tag} · {t(selectedZone.name)}</h3>
          <dl className="mt-3 grid grid-cols-2 gap-2"><dt className="text-ink-faint">{t('Device count')}</dt><dd>{selectedZone.devices.length}</dd><dt className="text-ink-faint">{t('Cable type')}</dt><dd>{selectedZone.cableType}</dd><dt className="text-ink-faint">{t('Loop status')}</dt><dd>{t(selectedZone.loopStatus === 'closed' ? 'Closed concept loop' : 'Incomplete · review doors')}</dd></dl>
          <ul className="mt-3 space-y-2">{selectedZone.devices.map(id => { const s = model.symbols.find(s => s.id === id); return s?.layer === 'fire_alarm' && <li key={id}>{t(s.label)} · {t(model.floor.rooms.find(r => r.id === s.roomId)?.name)}</li> })}</ul>
          <p className="mt-3 text-ink-dim">{t('Sprinklers, extinguishers and exit signs are standalone safety equipment, not alarm-loop devices.')}</p>
          <button className={`${button} mt-3 w-full`} onClick={() => select(null)}>{t('Clear selection')}</button>
        </section>}
        {selectedExit && <section aria-label={t('Evacuation route details')} aria-live="polite" className="mt-4 border-t border-line pt-4 text-xs"><h3 className="font-display text-lg">{t('Evacuation route')} · {t(model.floor.rooms.find(r => r.id === selectedExit.fromRoomId)?.name)}</h3><p className="mt-3">{t(selectedExit.status === 'concept' ? 'Door-connected concept route' : selectedExit.reason ?? 'Route needs review')}</p>{selectedExit.status === 'concept' && <p className="mt-2">{(pathLength(selectedExit.path) / 1000).toFixed(1)} m · {t('Along represented doors')}</p>}<button className={`${button} mt-3 w-full`} onClick={() => select(null)}>{t('Clear selection')}</button></section>}
        {selectedCoverage && <section aria-label={t('Coverage details')} aria-live="polite" className="mt-4 border-t border-line pt-4 text-xs"><h3 className="font-display text-lg">{t('Coverage details')} · {t(model.floor.rooms.find(r => r.id === selectedCoverage.roomId)?.name)}</h3><p className="mt-3">{t(selectedCoverage.status === 'partial' ? 'Partial concept coverage' : 'Not covered')}</p><p className="mt-2 text-ink-dim">{t('Concept coverage only; professional fire design required.')}</p><button className={`${button} mt-3 w-full`} onClick={() => select(null)}>{t('Clear selection')}</button></section>}
        {visible.fire_alarm && <details className="mt-4 border-t border-line pt-2 text-[11px] text-ink-dim"><summary className="min-h-11 cursor-pointer py-3">{t('Fire concept assumptions')}</summary><p>{t('Fire coverage: smoke 7.5 m / heat 5 m. Concept radii only; walls limit coverage.')}</p><p className="mt-2">{t('Wet-area exemption and evacuation routes are concept assumptions; professional review required.')}</p><p className="mt-2">{t('Sprinkler hydraulics, alarm engineering, exit widths and stair discharge are not validated.')}</p><a className="mt-3 inline-block min-h-11 underline" href="https://www.usfa.fema.gov/prevention/home-fires/prepare-for-fire/home-fire-escape-plans/index.html" target="_blank" rel="noopener noreferrer">{t('General fire escape guidance')} ↗</a></details>}
        {selectedWater && <section aria-label={t('Water supply details')} aria-live="polite" className="mt-4 border-t border-line pt-4 text-xs"><h3 className="font-display text-lg" style={{ color: selectedWater.color }}>{selectedWater.tag} · {t(selectedWater.name)}</h3><dl className="mt-3 grid grid-cols-2 gap-2"><dt>{t('Branch pipe')}</dt><dd>Ø{selectedWater.branchDiameterMm} mm</dd><dt>{t('Main / riser')}</dt><dd>Ø{selectedWater.riserDiameterMm} mm</dd><dt>{t('Material')}</dt><dd>{t(selectedWater.material)}</dd><dt>{t('Source status')}</dt><dd>{t('Source unverified')}</dd></dl>{selectedWater.heatSource && <p className="mt-3">{t('Heater specification')}: {t(selectedWater.heatSource)} · {t('Position unverified')}</p>}<p className="mt-3 text-ink-dim">{t('Water routes are proposals. Upstream supply, heater location and hydraulic design require review.')}</p>{selectedWater.unroutedFixtures.length > 0 && <p className="mt-2">{selectedWater.unroutedFixtures.length} · {t('Routing pending')}</p>}<button className={`${button} mt-3 w-full`} onClick={() => select(null)}>{t('Clear selection')}</button></section>}
        <p className="mt-5 text-[11px] leading-relaxed text-ink-faint">{t('3D shows electrical and water services. Drainage and fire remain in the 2D plan.')}</p>
        <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">{t('Concept surface wiring. Heights and routes are illustrative; electrical design is not validated. Wire paths are enlarged for clarity.')}</p>
        {visible.water_supply && <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">{t('Water routes are proposals. Upstream supply, heater location and hydraulic design require review.')}</p>}
      </aside>
      <div className="min-w-0 self-start border border-line">
        <div className="flex items-center justify-between gap-3 border-b border-line bg-bg px-4 py-3 font-mono text-[10px] text-ink-dim"><span>{t(model.floor.name)} · {t(mode === '3d' ? waterVisible3D ? electricVisible3D ? '3D services' : '3D water supply' : electricVisible3D ? '3D electrical' : 'Building only' : 'Utility plan')}</span><span>{mode === '2d' ? shown.length : (electricVisible3D ? electric3D.wires.length : 0) + (waterVisible3D ? water3D.pipes.length : 0)} {t('connections')}{mode === '2d' && visible.electrical && <span> · {model.circuits.length} {t('circuits')}</span>}{mode === '2d' && visible.fire_alarm && <span> · {model.zones.length} {t('zones')}</span>}</span></div>
        {electricVisible3D && <div className="flex flex-wrap items-center gap-2 border-b border-line bg-bg px-3 py-2"><span className="mr-auto text-[10px] text-ink-dim">{electric3D.boards.length} {t('boards & fixtures')} · {t('Select a circuit')}</span>{model.circuits.map(c => <button key={c.id} type="button" aria-pressed={selected === `circuit:${c.id}`} className={`${button} bg-bg-raised`} style={{ borderColor: c.color, color: selected === `circuit:${c.id}` ? '#fff' : c.color, backgroundColor: selected === `circuit:${c.id}` ? c.color : undefined }} onClick={() => select(selected === `circuit:${c.id}` ? null : `circuit:${c.id}`)}>{c.tag} · {t(c.name)}</button>)}</div>}
        {waterVisible3D && <div className="flex flex-wrap items-center gap-2 border-b border-line bg-bg px-3 py-2"><span className="mr-auto text-[10px] text-ink-dim">{t('Water supply')} · {t('Source unverified')}</span>{model.waterNetworks.filter(n => showHotWater || n.service === 'cold').map(n => <button key={n.id} type="button" aria-pressed={selected === `water:${n.id}`} className={`${button} bg-bg-raised`} style={{ borderColor: n.color, color: selected === `water:${n.id}` ? '#fff' : n.color, backgroundColor: selected === `water:${n.id}` ? n.color : undefined }} onClick={() => select(selected === `water:${n.id}` ? null : `water:${n.id}`)}>{n.tag} · {t(n.name)}</button>)}</div>}
        {mode === '2d' && visible.drainage && model.drainageDesign && <div className="border-b border-line bg-bg-raised p-3 sm:px-4">
          <div className="flex flex-wrap items-center gap-2"><span className="mr-1 font-mono text-[9px] uppercase tracking-widest text-ink-faint">{t('Focus drains')}</span><button className={`${button} ${room === 'all' ? 'border-line-strong bg-bg-inset' : ''}`} aria-pressed={room === 'all'} onClick={() => focusRoom('all')}>{t('Whole floor')}</button>{drainageRooms.map(r => <button key={r.id} className={`${button} ${room === r.id ? 'border-line-strong bg-bg-inset' : ''}`} aria-pressed={room === r.id} onClick={() => focusRoom(r.id)}>{t(r.name)}</button>)}<label className="ml-auto flex min-h-11 items-center gap-2 text-xs text-ink-dim"><input type="checkbox" className="accent-accent" checked={drainageTechnical} onChange={e => { setDrainageTechnical(e.target.checked); setTooltip(null) }} />{t('Technical labels')}</label></div>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-3 text-[10px] text-ink-dim">{Object.entries(DRAINAGE_DISPLAY).filter(([key]) => model.drainageDesign!.input.visible[key as keyof typeof DRAINAGE_DISPLAY] && model.drainageDesign!.pipes.some(p => p.service === key)).map(([key, style]) => <span key={key} className="flex items-center gap-2"><svg width="24" height="8" aria-hidden="true"><path d="M0 4H24" stroke={DRAINAGE_COLORS[key as keyof typeof DRAINAGE_COLORS]} strokeWidth={style.width} strokeDasharray={style.dash} /></svg>{t(style.label)}</span>)}</div>
        </div>}
        <div ref={host} className="relative h-[480px] overflow-hidden bg-bg-inset sm:h-[580px]" style={{ touchAction: mode === '2d' ? 'none' : undefined }}>
          <CanvasBoundary><Canvas frameloop="demand" camera={camera} dpr={[1, 1.5]} onPointerMissed={() => select(null)}><PreparedFloorScene model={model} mode={mode} focusRoom={room} transparentWalls={(electricVisible3D || waterVisible3D) && seeThroughWalls} transparentFloor={waterVisible3D && seeThroughFloor} />{electricVisible3D && <ElectricalLayer3D model={model} scene={electric3D} room={room} circuit={circuit} selected={selected} labels={showRoomNames3D} onSelect={select} />}{waterVisible3D && <WaterLayer3D model={model} scene={water3D} room={room} selected={selected} labels={showRoomNames3D} roomNames={!electricVisible3D} onSelect={select} />}</Canvas></CanvasBoundary>
          <div className={`absolute inset-0 bg-white transition-opacity duration-300 motion-reduce:transition-none ${planVisible ? 'opacity-100' : 'pointer-events-none invisible opacity-0'}`} aria-hidden={!planVisible} inert={!planVisible}>
            <div className="h-full w-full" tabIndex={0} role="region" aria-label={t('Interactive utility plan')} onKeyDown={e => { if (e.target !== e.currentTarget && e.key !== 'Escape') return; if (e.key === 'Escape') select(null); else if (e.key === '+' || e.key === '=') { e.preventDefault(); zoom(.8) } else if (e.key === '-') { e.preventDefault(); zoom(1.25) } else if (e.key.startsWith('Arrow')) { e.preventDefault(); setBox(b => { const old = b ?? fit; return { ...old, x: old.x + (e.key === 'ArrowRight' ? .05 : e.key === 'ArrowLeft' ? -.05 : 0) * old.w, y: old.y + (e.key === 'ArrowDown' ? .05 : e.key === 'ArrowUp' ? -.05 : 0) * old.h } }) } }}
              onPointerDown={e => { pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY }); gesture.current = { ...gestureNow(), travel: 0, moved: false, run: (e.target as Element).closest('[data-run-id]')?.getAttribute('data-run-id') ?? null }; e.currentTarget.setPointerCapture(e.pointerId); setTooltip(null) }}
              onPointerMove={e => { if (!pointers.current.has(e.pointerId) || !gesture.current) return; const before = gesture.current; pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY }); const now = gestureNow(), dx = now.x - before.x, dy = now.y - before.y; setBox(b => { const old = b ?? fit; return { ...old, x: old.x - dx * old.w / width, y: old.y - dy * old.h / height } }); if (now.distance && before.distance) zoom(before.distance / now.distance); gesture.current = { ...before, ...now, travel: before.travel + Math.hypot(dx, dy), moved: before.moved || before.travel + Math.hypot(dx, dy) > 5 || pointers.current.size > 1 } }}
              onPointerUp={e => { const g = gesture.current; pointers.current.delete(e.pointerId); if (g && !g.moved) select(g.run); gesture.current = pointers.current.size ? { ...gestureNow(), travel: 0, moved: true, run: null } : null }} onPointerCancel={e => { pointers.current.delete(e.pointerId); gesture.current = null }}>
              <UtilitySheet {...sheet} box={current} scale={scale} onSelect={select} onHover={hover} />
            </div>
            <div className="absolute right-3 top-3 flex gap-1">{[['−', 'Zoom out', 1.25], ['+', 'Zoom in', .8], ['↗', 'Fit drawing', 0]].map(([label, name, factor]) => <button key={String(name)} className={`${button} min-w-11 bg-bg-raised`} aria-label={t(String(name))} onClick={() => factor ? zoom(Number(factor)) : setBox(null)}>{label}</button>)}</div>
            <details className="absolute bottom-3 right-3 max-h-[300px] max-w-[250px] overflow-y-auto border border-line bg-bg-raised p-3 text-xs"><summary className="flex min-h-11 cursor-pointer items-center">{t('Legend')}</summary><div className="mt-3 space-y-2">{legend.map((entry, i) => <div key={i} className="flex items-center gap-2"><svg viewBox="-14 -14 28 28" width={24} height={24} aria-hidden="true">{entry.symbol ? <UtilitySymbolGlyph type={entry.symbol} color={entry.color} /> : <path d="M-12 0h24" stroke={entry.color} strokeWidth={2} strokeDasharray={entry.dash ?? undefined} />}</svg><span style={{ color: entry.color }}>{t(entry.label)}</span></div>)}<p className="text-ink-faint">{t('Drainage arrows show flow; wire bridges show crossings without junctions.')}</p></div></details>
            {tooltip && <UtilityHoverCard info={tooltip.info} x={tooltip.x} y={tooltip.y} width={width} height={height} />}

          </div>
        </div>
        {electricVisible3D && (electric3D.unmounted.length > 0 || electric3D.pending.length > 0 || electric3D.unrouted.length > 0) && <p role="status" className="border-t border-line p-3 text-xs text-ink-dim">{electric3D.unmounted.length + electric3D.pending.length + electric3D.unrouted.length} · {t('3D mounting or routing needs review. Unsupported connections are not drawn.')}</p>}
        {waterVisible3D && (water3D.pending.length > 0 || model.waterNetworks.some(n => n.unroutedFixtures.length)) && <p role="status" className="border-t border-line p-3 text-xs text-ink-dim">{t('Some water connections need a wall or door-routing review.')}</p>}
        {mode === '2d' && visible.drainage && <DrainageMapDetails model={model} selected={selected} scale={scale} select={select} />}
      </div>
    </div>
    {printed && <><style>{`@media print { .utility-export-sheet { width: ${printed.w}mm !important; height: ${printed.h}mm !important; } .utility-export-sheet svg { width: ${printed.w}mm !important; height: ${printed.h}mm !important; } @page utility-sheet { size: ${printed.w}mm ${printed.h}mm; margin: 0; } }`}</style><div className="utility-export-sheet hidden" dangerouslySetInnerHTML={{ __html: serializeDrawingSheet(printed) }} /></>}
    <dialog ref={helpDialog} onCancel={() => setHelpOpen(false)} className="m-auto max-h-[90dvh] w-[min(500px,94vw)] overflow-y-auto border border-line bg-bg p-6 text-ink backdrop:bg-black/40" aria-labelledby="utility-shortcut-title"><div className="flex items-center justify-between gap-3"><h2 id="utility-shortcut-title" className="font-display text-2xl">{t('Keyboard shortcuts')}</h2><button className={button} onClick={() => setHelpOpen(false)}>{t('Close')}</button></div><dl className="mt-5 grid grid-cols-[90px_1fr] gap-3 text-sm">{[['1–4', 'Toggle service layers'], ['G', 'Show grid'], ['Ctrl+Z/Y', 'Undo / redo drawing'], ['Ctrl+S', 'Save project JSON'], ['?', 'Shortcut help'], ['Esc', 'Close panels or clear selection']].map(([key, value]) => <div key={key} className="contents"><dt className="font-mono text-xs">{key}</dt><dd>{t(value)}</dd></div>)}</dl></dialog>
    {sessionMessage && <p role="status" className="mt-3 text-xs text-ink-faint">{t(sessionMessage)}</p>}
    {error && <p role="alert" className="mt-3 text-sm text-bad">{t(error)}</p>}
    {!model.utilities.length && <p role="status" className="mt-4 border border-line p-4 text-sm">{t('No routable wet-room fixtures on this floor. Choose another floor or edit the 2D plan.')}</p>}
  </div>
}
