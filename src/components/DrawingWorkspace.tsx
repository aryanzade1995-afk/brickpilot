import { emergencyPlan } from '@/lib/engine/safety.ts'
import { useRef, useState } from 'react'
import type { Design } from '@/lib/engine/types.ts'
import { FloorDrawing, TerraceDrawing, type Theme } from '@/lib/draw/FloorDrawing.tsx'
import { DRAWING_PRESETS, LAYER_LABELS, drawingLayerCounts, terraceLayerCounts, type DrawingPreset, type LayerId } from '@/lib/draw/layers.ts'
import { downloadSheetPdf, downloadSheetSvg } from '@/lib/draw/exportSheet.ts'

/** Display state is local to the sheet. No studio edit/run/reroll is called. */
export function DrawingWorkspace({ design, onFloorChange, initialFloorLevel, highlightCategory, onRoomClick }: { design: Design; onFloorChange?: (index: number) => void; initialFloorLevel?: number; highlightCategory?: string; onRoomClick?: (id: string) => void }) {
  const [floorIdx, setFloorIdx] = useState(Math.max(0, design.floors.findIndex(f => f.level === initialFloorLevel)))
  const [theme, setTheme] = useState<Theme>('paper')
  const [preset, setPreset] = useState<DrawingPreset | 'Custom'>('Presentation')
  const [layers, setLayers] = useState({ ...DRAWING_PRESETS.Presentation, supports: !!highlightCategory })
  const [finishStyle, setFinishStyle] = useState(true)
  const [zoom, setZoom] = useState(1)
  const [exportError, setExportError] = useState('')
  const svgRef = useRef<SVGSVGElement>(null)
  const floor = design.floors[Math.min(floorIdx, design.floors.length - 1)]
  const terrace = floorIdx >= design.floors.length
  const counts = terrace ? terraceLayerCounts(design) : drawingLayerCounts(floor, design.siteFeatures)
  const name = `plan_${design.dna.seed}_${terrace ? 'terrace' : floor.prefix ?? floor.level}`
  const button = 'border border-line-strong px-2 py-2 text-xs text-ink-dim hover:text-ink'
  return <div className="drawing-workspace grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
    <div className="min-w-0">
      <div role="tablist" aria-label="Floors" className="mb-3 flex flex-wrap gap-1">
        {design.floors.map((f, i) => <button key={f.level} role="tab" aria-selected={floorIdx === i} onClick={() => { setFloorIdx(i); onFloorChange?.(i); setZoom(1) }} className={`${button} ${floorIdx === i ? 'border-ink text-ink' : ''}`}>{f.level === 0 ? 'Ground' : `Floor ${f.level}`}</button>)}
        <button role="tab" aria-selected={terrace} onClick={() => { setFloorIdx(design.floors.length); onFloorChange?.(design.floors.length); setZoom(1) }} className={`${button} ${terrace ? 'border-ink text-ink' : ''}`}>Terrace</button>
      </div>
      <div className="drawing-viewport aspect-[4/3] overflow-auto border border-line" style={{ background: theme === 'cad' ? '#11161c' : '#fff' }}>
        <div className="drawing-sheet h-full" style={{ width: `${zoom * 100}%`, height: `${zoom * 100}%`, margin: '0 auto' }}>
          {terrace ? <TerraceDrawing design={design} theme={theme} layers={layers} svgRef={svgRef} /> :
            <FloorDrawing emergency={emergencyPlan(design)} floor={floor} model={design.model} siteFeatures={design.siteFeatures} theme={theme}
              layers={layers} presentation={finishStyle} svgRef={svgRef} highlightCategory={highlightCategory} onRoomClick={onRoomClick ? id => { const r = floor.rooms.find(r => r.id === id); if (r) onRoomClick(`${floor.level}:${r.semanticId || r.id}`) } : undefined} />}
        </div>
      </div>
      {highlightCategory && <p className="mt-2 text-xs text-ink-dim">Highlighted: {highlightCategory.replaceAll('.', ' · ')} · source geometry; service quantities indicate rooms, not point positions.</p>}
      {onRoomClick && !terrace && <p className="mt-2 text-xs text-ink-dim">Select a room to choose its finishes.</p>}
      <p className="mt-2 text-xs text-ink-faint">{design.candidate} · 1 unit = 1 mm · {floor.name}{terrace ? ' roof' : ''}</p>
    </div>
    <aside aria-label="Drawing layers" className="drawing-controls border border-line p-4 text-sm">
      <h2 className="mb-4 font-display text-xl">Drawing layers</h2>
      <div className="mb-4 grid grid-cols-2 gap-2">{(['cad', 'paper'] as const).map(t => <button key={t} className={`${button} ${theme === t ? 'border-ink text-ink' : ''}`} aria-pressed={theme === t} onClick={() => setTheme(t)}>{t === 'cad' ? 'CAD dark' : 'Paper light'}</button>)}</div>
      <label className="mb-4 block text-xs text-ink-dim">Preset
        <select aria-label="Drawing preset" value={preset} onChange={e => { const p = e.target.value as DrawingPreset; setPreset(p); setLayers({ ...DRAWING_PRESETS[p] }); setFinishStyle(p === 'Presentation') }} className="mt-2 w-full border border-line-strong bg-bg-inset px-2 py-2 text-ink">
          {Object.keys(DRAWING_PRESETS).map(p => <option key={p}>{p}</option>)}{preset === 'Custom' && <option>Custom</option>}
        </select>
      </label>
      <div className="divide-y divide-line">{(Object.keys(LAYER_LABELS) as LayerId[]).map(id => <label key={id} className="flex cursor-pointer items-center justify-between gap-2 py-2">
        <span className="flex flex-1 items-center justify-between gap-2"><span className="text-xs text-ink">{LAYER_LABELS[id]}</span><span className="whitespace-nowrap text-[9px] text-ink-faint">{counts[id]} on this floor</span></span>
        <input type="checkbox" aria-label={LAYER_LABELS[id]} checked={layers[id]} onChange={e => { setLayers({ ...layers, [id]: e.target.checked }); setPreset('Custom') }} className="accent-neutral-500" />
      </label>)}</div>
      <p className="my-3 text-[10px] text-ink-faint">Supports shows columns, beams and ground-floor footings and plinth. Approximate; structural design by a licensed engineer required. Layers change only the drawing.</p>
      <div className="grid grid-cols-3 gap-2">
        <button className={button} aria-label="Zoom out" onClick={() => setZoom(Math.max(0.5, zoom / 1.25))}>−</button>
        <button className={button} aria-label="Fit drawing" onClick={() => setZoom(1)}>Fit</button>
        <button className={button} aria-label="Zoom in" onClick={() => setZoom(Math.min(3, zoom * 1.25))}>+</button>
      </div>
      <p className="my-2 text-center font-mono text-[10px] text-ink-faint">{Math.round(zoom * 100)}%</p>
      <div className="grid grid-cols-2 gap-2">
        <button className={button} onClick={() => svgRef.current && downloadSheetSvg(svgRef.current, name)}>SVG download</button>
        <button className={button} onClick={() => window.print()}>Print</button>
        <button className={`${button} col-span-2`} onClick={() => { setExportError(''); if (svgRef.current) void downloadSheetPdf(svgRef.current, name).catch(e => setExportError(String(e.message))) }}>Download PDF</button>
      </div>
      {exportError && <p role="alert" className="mt-2 text-xs text-bad">{exportError}</p>}
    </aside>
  </div>
}
