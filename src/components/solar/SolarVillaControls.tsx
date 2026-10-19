import { Link } from 'react-router-dom'
import { useId, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Button } from '@/components/ui/Button.tsx'
import { translate as t, useLanguage } from '@/lib/i18n/index.ts'
import { SOLAR_URL } from '@/lib/solar/editor.ts'
import { solarLayoutTotals, solarPanelGeometry } from '@/lib/solar/placement.ts'
import { transformSolarSelection } from '@/lib/solar/layoutEditing.ts'
import { rectUnionBBox } from '@/lib/geometry.ts'
import type { SolarReservedArea } from './types.ts'
import { solarArrayId, type SolarVillaEditor } from './useSolarVillaEditor.ts'

const field = 'mt-1 block w-full min-w-0 rounded-md border border-line bg-bg px-3 py-2 text-sm text-ink focus-visible:outline-2 focus-visible:outline-accent'
const fmt = (key: string, ...v: (string | number)[]) => t(key).replace(/\{(\d+)\}/g, (_, i) => String(v[Number(i)]))
export function SolarVillaControls({ editor: e }: { editor: SolarVillaEditor }) {
  useLanguage(s => s.language)
  const totals = e.displayLayout ? solarLayoutTotals(e.displayLayout) : { panelCount: 0, capacityKwp: 0 }
  const needsReview = !!e.solar.calculated && !e.layout
  return <section aria-label={t('Rooftop solar viewer')} className="mt-4 rounded-xl border border-line bg-bg p-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-display text-lg">{t('Rooftop solar')}</h3>
      <p className="mt-1 text-sm" role="status">{fmt('{0} panels · {1} kWp', totals.panelCount, totals.capacityKwp.toLocaleString('en-IN', { maximumFractionDigits: 3 }))}{e.preview?.configuration && <> · {t('Checked draft · Apply to save')}</>}</p></div>
      <div className="flex flex-wrap gap-2">{(['exterior', 'terrace', 'top'] as const).map(v => <Button key={v} type="button" size="sm" variant="ghost" aria-pressed={e.camera?.view === v} onClick={() => { e.view(v); document.getElementById('villa-interactive-view')?.scrollIntoView({ block: 'center', behavior: 'smooth' }) }}>{t(v === 'exterior' ? 'Exterior view' : v === 'terrace' ? 'Terrace view' : 'Top view')}</Button>)}</div>
    </div>
    {needsReview && <p className="mt-3 text-sm text-ink-dim">{t('Saved solar needs review and is hidden from this roof. Open Specifications to propose a revision.')}</p>}
    {!e.layout && !needsReview && <p className="mt-2 text-xs text-ink-dim">{t('No installed PV layout is saved. Keep-free boundaries can be planned without panels.')}</p>}
    <p className="mt-2 text-xs leading-relaxed text-ink-dim">{t('PV modules have dark cell faces and metal supports. Decorative solar-shade roofs are architectural shade structures and do not count as PV capacity.')}</p>
    <p className="mt-1 text-xs text-ink-faint">{t('Amber outlines mark keep-free roof areas. This is a concept layout, subject to installer review.')}</p>
    {!!e.sourceLayout?.panels.length && <div className="mt-4 grid gap-3 sm:grid-cols-2">
      <label className="text-xs">{t('Solar array')}<select aria-label={t('Solar array')} value={e.arrayId} onChange={v => e.selectArray(v.target.value)} className={field}><option value="all">{t('All arrays')}</option>{e.arrays.map((id, i) => <option key={id} value={id}>{fmt('Array {0}', i + 1)}</option>)}</select></label>
      <label className="text-xs">{t('Solar panel')}<select aria-label={t('Solar panel')} value={e.panelId} onChange={v => e.selectPanel(v.target.value)} className={field}><option value="all">{t('All panels in selection')}</option>{e.sourceLayout.panels.filter(p => e.arrayId === 'all' || solarArrayId(p) === e.arrayId).map(p => <option key={p.id} value={p.id}>{fmt('Panel {0}', e.sourceLayout!.panels.indexOf(p) + 1)}</option>)}</select></label>
    </div>}
    <div className="mt-3 flex flex-wrap gap-4 text-sm">{!e.draft && <button type="button" disabled={!e.available || needsReview} className="rounded-md border border-line px-3 py-2 disabled:opacity-40" onClick={e.start}>{t('Edit solar layout')}</button>}<Link to={SOLAR_URL} className="self-center underline">{t('Solar specifications')}</Link></div>
    {!e.available && <p className="mt-2 text-xs text-ink-dim">{t('The accepted villa must have a supported accessible flat roof to edit solar here.')}</p>}
    {e.draft && <TopDownEditor editor={e}/>}
    {e.notice && <p className="mt-3 text-sm" role="status">{t(e.notice)}</p>}
  </section>
}
function Numeric({ label, value, onChange, min }: { label: string; value: number; onChange: (v: number) => void; min?: number }) {
  return <label className="block min-w-0 text-xs">{t(label)}<input aria-label={t(label)} className={field} type="number" step="any" min={min} value={Number.isFinite(value) ? value : ''} onChange={e => onChange(e.target.value === '' ? NaN : Number(e.target.value))}/></label>
}
function TopDownEditor({ editor: e }: { editor: SolarVillaEditor }) {
  const draft = e.draft!, id = useId()
  const top = e.roof.surfaces.find(s => s.kind === 'flat-top-roof')!
  const [delta, setDelta] = useState({ x: 0, y: 0, angle: 0 }), [draw, setDraw] = useState(false)
  const [areaId, setAreaId] = useState('new')
  const first = top.usableRegionsMm[0] ?? top.regionsMm[0]
  const initial = { x: first?.x ?? 0, y: first?.y ?? 0, w: Math.min(first?.w ?? 1000, 1000), h: Math.min(first?.h ?? 1000, 1000) }
  const [areaRect, setAreaRect] = useState(initial)
  const [ghost, setGhost] = useState<{ panelId?: string; dx: number; dy: number; rect?: typeof initial } | null>(null)
  const drag = useRef<{ x: number; y: number; panelId?: string } | null>(null)
  const box = rectUnionBBox(top.grossRegionsMm), pad = Math.max(box.w, box.h) * .04
  const point = (event: ReactPointerEvent<SVGSVGElement>) => {
    const matrix = event.currentTarget.getScreenCTM()
    if (!matrix) return null
    const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse())
    return { x: p.x, y: p.y }
  }
  const start = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return
    const p = point(event), panelId = (event.target as Element).getAttribute('data-panel-id') ?? undefined
    if (!p || (!draw && !panelId)) return
    if (panelId && !draw) e.pickPanel(panelId)
    event.currentTarget.setPointerCapture(event.pointerId); drag.current = { ...p, panelId: draw ? undefined : panelId }; setGhost(null)
  }
  const move = (event: ReactPointerEvent<SVGSVGElement>) => {
    const from = drag.current, p = point(event)
    if (!from || !p) return
    const dx = p.x - from.x, dy = p.y - from.y
    setGhost({ panelId: from.panelId, dx, dy, rect: from.panelId ? undefined : { x: Math.min(from.x, p.x), y: Math.min(from.y, p.y), w: Math.abs(dx), h: Math.abs(dy) } })
  }
  const addArea = (rectMm: typeof initial) => {
    const id = `keep-free-${crypto.randomUUID()}`
    e.change({ ...draft, reservedAreas: [...draft.reservedAreas, { id, label: 'Keep-free area', roofSurfaceId: top.id, level: top.level, rectMm }] })
    setAreaId(id); setAreaRect(rectMm)
  }
  const end = (event: ReactPointerEvent<SVGSVGElement>) => {
    const from = drag.current, p = point(event)
    if (from && p) {
      const dx = p.x - from.x, dy = p.y - from.y
      if (from.panelId && Math.hypot(dx, dy) > 1) e.change({ ...draft, panels: transformSolarSelection(draft.panels, new Set([from.panelId]), dx, dy, 0) })
      else if (!from.panelId && Math.abs(dx) > 10 && Math.abs(dy) > 10) addArea({ x: Math.min(from.x, p.x), y: Math.min(from.y, p.y), w: Math.abs(dx), h: Math.abs(dy) })
    }
    drag.current = null; setGhost(null)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  const chooseArea = (area: SolarReservedArea) => { setAreaId(area.id); setAreaRect(area.rectMm) }
  const canTransform = [delta.x, delta.y, delta.angle].every(Number.isFinite) && e.selectedIds.size > 0
  const candidatePanels = ghost?.panelId ? transformSolarSelection(draft.panels, new Set([ghost.panelId]), ghost.dx, ghost.dy, 0) : draft.panels
  return <div className="mt-5 border-t border-line pt-4" aria-label={t('Top-down solar layout editor')}>
    <h4 className="font-display text-lg">{t('Top-down layout editor')}</h4><p className="mt-2 text-xs leading-relaxed text-ink-dim">{t('Drag a panel, or use the numeric controls. Arrow keys move a focused panel by 100 mm; Shift moves by 1,000 mm. Preview checks every panel before Apply.')}</p>
    <p className="mt-2 text-xs text-ink-dim">{t('Drawing axes: +X right, +Y down. Bearings are local plan angles, not geographic north.')}</p>
    <svg role="group" aria-labelledby={`${id}-title`} viewBox={`${box.x - pad} ${box.y - pad} ${box.w + pad * 2} ${box.h + pad * 2}`} className="mt-4 max-h-[440px] w-full touch-none rounded-lg border border-line bg-bg-inset" onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerCancel={() => { drag.current = null; setGhost(null) }}>
      <title id={`${id}-title`}>{t('Roof layout drawing')}</title>
      <defs><mask id={`${id}-roof`}><rect x={box.x - pad} y={box.y - pad} width={box.w + 2 * pad} height={box.h + 2 * pad} fill="black"/>{top.regionsMm.map((r, i) => <rect key={i} x={r.x} y={r.y} width={r.w} height={r.h} fill="white"/>)}</mask></defs>
      <g mask={`url(#${id}-roof)`}>{top.regionsMm.map((r, i) => <rect key={i} x={r.x} y={r.y} width={r.w} height={r.h} fill="var(--color-bg-raised)"/>)}
        {top.obstacles.flatMap(o => o.regionsMm).map((r, i) => <rect key={`o${i}`} x={r.x} y={r.y} width={r.w} height={r.h} fill="#888" opacity=".45"/>)}
        {top.access.protectedRegionsMm.map((r, i) => <rect key={`a${i}`} x={r.x} y={r.y} width={r.w} height={r.h} fill="none" stroke="#777" strokeWidth="35" strokeDasharray="100 80"/>)}
      </g>
      {top.edges.map((edge, i) => <line key={i} x1={edge.a.x} y1={edge.a.y} x2={edge.b.x} y2={edge.b.y} stroke="var(--color-ink)" strokeWidth="35"/>)}
      {candidatePanels.map((p, i) => {
        const original = e.sourceLayout?.panels.find(o => o.id === p.id)
        if (!original || !e.sourceLayout) return null
        const panel = { ...original, positionMm: { ...original.positionMm, ...p.positionMm }, azimuthDeg: p.azimuthDeg }
        const polygon = solarPanelGeometry(panel, e.sourceLayout.placementPolicy, e.sourceLayout.resolved).projectedFootprintMm
        return <polygon key={p.id} data-panel-id={p.id} role="button" tabIndex={0} aria-label={fmt('Panel {0}', i + 1)} aria-pressed={e.selectedIds.has(p.id!)} points={polygon.map(v => `${v.x},${v.y}`).join(' ')} fill="#172435" stroke={e.selectedIds.has(p.id!) ? '#b58131' : '#a5adb5'} strokeWidth="70" className={draw ? 'pointer-events-none' : 'cursor-move focus:outline-none focus:stroke-[140]'} onKeyDown={event => {
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); e.pickPanel(p.id!); return }
          if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
          event.preventDefault(); e.pickPanel(p.id!)
          const step = event.shiftKey ? 1000 : 100
          e.change({ ...draft, panels: transformSolarSelection(draft.panels, new Set([p.id!]), event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0, event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0, 0) })
        }}/>
      })}
      {draft.reservedAreas.filter(a => a.level === top.level).map((a, i) => <rect key={a.id} role="button" tabIndex={0} aria-label={fmt('Keep-free area {0}', i + 1)} aria-pressed={areaId === a.id} x={a.rectMm.x} y={a.rectMm.y} width={a.rectMm.w} height={a.rectMm.h} fill="#b58131" fillOpacity=".12" stroke="#b58131" strokeWidth={areaId === a.id ? 80 : 45} strokeDasharray="150 100" onClick={() => chooseArea(a)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); chooseArea(a) } }}/>) }
      {ghost?.rect && <rect x={ghost.rect.x} y={ghost.rect.y} width={ghost.rect.w} height={ghost.rect.h} fill="#b58131" fillOpacity=".2" stroke="#b58131" strokeWidth="40" pointerEvents="none"/>}
    </svg>
    <p className="mt-2 text-xs text-ink-faint">{t('Dark: PV modules · grey: roof obstacles · amber: keep-free areas · dashed grey: protected access')}</p>
    {!!draft.panels.length && <fieldset className="mt-4"><legend className="text-sm">{t('Move or rotate the selection')}</legend><div className="mt-3 grid gap-3 sm:grid-cols-3">
      <Numeric label="Move X (mm)" value={delta.x} onChange={x => setDelta(v => ({ ...v, x }))}/><Numeric label="Move Y (mm)" value={delta.y} onChange={y => setDelta(v => ({ ...v, y }))}/><Numeric label="Rotate by (°)" value={delta.angle} onChange={angle => setDelta(v => ({ ...v, angle }))}/>
    </div><Button type="button" size="sm" variant="ghost" className="mt-3" disabled={!canTransform} onClick={() => { e.change({ ...draft, panels: transformSolarSelection(draft.panels, e.selectedIds, delta.x, delta.y, delta.angle) }); setDelta({ x: 0, y: 0, angle: 0 }) }}>{t('Move / rotate selection')}</Button></fieldset>}
    <fieldset className="mt-5 border-t border-line pt-4"><legend className="text-sm">{t('Keep-free roof space')}</legend>
      <label className="mt-2 block text-xs">{t('Keep-free area')}<select aria-label={t('Keep-free area')} value={areaId} className={field} onChange={event => { const area = draft.reservedAreas.find(a => a.id === event.target.value); if (area) chooseArea(area); else { setAreaId('new'); setAreaRect(initial) } }}><option value="new">{t('New keep-free area')}</option>{draft.reservedAreas.map((a, i) => <option key={a.id} value={a.id}>{fmt('Keep-free area {0}', i + 1)}</option>)}</select></label>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">{([['Area X (mm)', 'x'], ['Area Y (mm)', 'y'], ['Area width (mm)', 'w'], ['Area depth (mm)', 'h']] as const).map(([label, key]) => <Numeric key={key} label={label} value={areaRect[key]} min={key === 'w' || key === 'h' ? 1 : undefined} onChange={v => setAreaRect(r => ({ ...r, [key]: v }))}/>)}</div>
      <div className="mt-3 flex flex-wrap gap-2"><Button type="button" size="sm" variant="ghost" disabled={!Object.values(areaRect).every(Number.isFinite) || areaRect.w <= 0 || areaRect.h <= 0} onClick={() => areaId === 'new' ? addArea(areaRect) : e.change({ ...draft, reservedAreas: draft.reservedAreas.map(a => a.id === areaId ? { ...a, rectMm: areaRect } : a) })}>{t(areaId === 'new' ? 'Add keep-free area' : 'Update keep-free area')}</Button>
        <Button type="button" size="sm" variant="quiet" aria-pressed={draw} onClick={() => setDraw(v => !v)}>{t(draw ? 'Finish drawing' : 'Draw keep-free area')}</Button>
        {areaId !== 'new' && <Button type="button" size="sm" variant="quiet" onClick={() => { e.change({ ...draft, reservedAreas: draft.reservedAreas.filter(a => a.id !== areaId) }); setAreaId('new') }}>{t('Remove keep-free area')}</Button>}</div>
    </fieldset>
    <p role="status" className="mt-4 text-xs text-ink-dim">{t(e.preview?.configuration ? 'Checked draft is shown on the villa. Apply to save it.' : 'Unvalidated draft. The villa continues to show the saved layout.')}</p>
    {(e.error || e.sourceChanged) && <p role="alert" className="mt-3 text-sm">{t(e.sourceChanged ? 'The project or roof changed. Cancel and reopen the layout editor.' : e.error)}</p>}
    <div className="mt-4 flex flex-wrap gap-2"><Button type="button" size="sm" variant="ghost" disabled={e.sourceChanged} onClick={e.check}>{t('Preview solar edit')}</Button><Button type="button" size="sm" disabled={!e.preview?.configuration || !!e.error || e.sourceChanged} onClick={e.apply}>{t('Apply solar edit')}</Button><Button type="button" size="sm" variant="quiet" onClick={e.cancel}>{t('Cancel solar edit')}</Button></div>
  </div>
}
