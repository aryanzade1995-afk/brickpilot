import { useCallback, useEffect, useState } from 'react'
import type { Point } from '@/lib/geometry.ts'
import type { UtilityFloor } from '@/lib/utilities/plan.ts'
import { POINT_TYPES, planningSchema, planningGeometryKey, applyUtilityPlanning, type PlannedPoint } from '@/lib/utilities/planning.ts'
import { uid, type DrawingDocument } from '@/lib/utilities/drawingProject.ts'
import { translate as t } from '@/lib/i18n/index.ts'
const control = 'mt-1 min-h-11 w-full border border-line bg-bg px-3 text-xs text-ink'
const button = 'min-h-11 border border-line px-3 py-2 text-xs hover:border-line-strong focus-visible:outline-2 focus-visible:outline-accent'
type Layer = keyof typeof POINT_TYPES
export function UtilityPointEditor({ base, model, document: doc, room, selected, change, select, requestPick }: { base: UtilityFloor; model: UtilityFloor; document: DrawingDocument; room: string; selected: string | null; change: (edit: (d: DrawingDocument) => void) => void; select: (id: string | null) => void; requestPick: (callback: (p: Point) => void) => void }) {
  const [open, setOpen] = useState(false), [draft, setDraft] = useState<PlannedPoint | null>(null), [message, setMessage] = useState('')
  const [from, setFrom] = useState(''), [to, setTo] = useState(''), [vertices, setVertices] = useState('')
  const [layer, setLayer] = useState<Layer>('electrical')
  const groups = layer === 'electrical' ? base.circuits : layer === 'water_supply' ? base.waterNetworks : base.zones
  const points = model.symbols.filter(s => s.layer === layer && 'roomId' in s && (room === 'all' || s.roomId === room))
  const editPoint = useCallback((id: string) => {
    const saved = doc.planning.points.find(p => p.id === id), s = base.symbols.find(s => s.id === id) ?? model.symbols.find(s => s.id === id)
    if (saved) { setDraft(structuredClone(saved)); setLayer(saved.layer); setOpen(true); return }
    if (!s || s.layer === 'drainage' || !(POINT_TYPES[s.layer] as readonly string[]).includes(s.type)) return
    setLayer(s.layer); setDraft({ id: s.id, layer: s.layer, type: s.type, roomId: s.roomId, groupId: s.layer === 'electrical' ? s.circuitIds[0] : s.layer === 'water_supply' ? s.networkId : s.zoneId, label: s.label, position: { ...s.position }, heightMm: s.layer !== 'fire_alarm' ? s.mount?.elevationMm ?? null : null }); setOpen(true); setMessage('')
  }, [doc.planning.points, base, model])
  // Plan selection opens this same editor; no second selection store.
  // Synchronize an external plan selection, undo or imported point change into the draft.
  // eslint-disable-next-line react/set-state-in-effect
  useEffect(() => { if (selected?.startsWith('point:')) editPoint(selected.slice(6)) }, [selected, editPoint])
  const newPoint = () => {
    const r = base.floor.rooms.find(r => r.id === room) ?? base.floor.rooms.find(r => !r.outdoor)
    if (!r || !groups.length) { setMessage(t('No room or service group is available on this floor.')); return }
    setDraft({ id: `point-${uid()}`, layer, type: POINT_TYPES[layer][0], roomId: r.id, groupId: groups[0].id, label: t('New service point'), position: { x: r.rect.x + r.rect.w / 2, y: r.rect.y + r.rect.h / 2 }, heightMm: null }); setMessage('')
  }
  const save = () => {
    if (!draft || doc.layers[draft.layer].locked) return
    const next = structuredClone(doc.planning); next.sourcePlanId = base.sourcePlanId; next.geometryKey = planningGeometryKey(base); next.points = [...next.points.filter(p => p.id !== draft.id), draft]
    const parsed = planningSchema.safeParse(next)
    if (!parsed.success) { setMessage(t('Check the point fields and coordinates.')); return }
    const review = applyUtilityPlanning(base, parsed.data).reviews.find(r => r.id === draft.id && !r.reason.startsWith('Point has no'))
    if (review) { setMessage(t(review.reason)); return }
    change(d => { d.planning = parsed.data; d.layers[draft.layer].visible = true }); select(`point:${draft.id}`); setMessage(t('Point saved. Connections need review after a move.'))
  }
  const route = () => {
    const a = model.symbols.find(s => s.id === from), b = model.symbols.find(s => s.id === to)
    if (!a || !b || a.layer !== layer || b.layer !== layer || a.id === b.id) { setMessage(t('Choose two different points in the same service group.')); return }
    const baseA = base.symbols.find(s => s.id === a.id), saved = doc.planning.points.find(p => p.id === a.id)
    const groupId = saved?.groupId ?? (baseA?.layer === 'electrical' ? baseA.circuitIds[0] : baseA?.layer === 'water_supply' ? baseA.networkId : baseA?.layer === 'fire_alarm' ? baseA.zoneId : '')
    let path: Point[]
    try { path = vertices.split(';').filter(s => s.trim()).map(s => { const pair = s.trim().split(','); if (pair.length !== 2 || pair.some(n => !n.trim())) throw Error(); return { x: Number(pair[0]), y: Number(pair[1]) } }) } catch { setMessage(t('Enter each route point as X,Y; separate points with semicolons.')); return }
    const next = structuredClone(doc.planning), id = `connection-${uid()}`
    next.sourcePlanId = base.sourcePlanId; next.geometryKey = planningGeometryKey(base); next.runs.push({ id, layer, groupId, from, to, path })
    const parsed = planningSchema.safeParse(next)
    if (!parsed.success) { setMessage(t('Use horizontal and vertical segments with both endpoints included.')); return }
    const review = applyUtilityPlanning(base, parsed.data).reviews.find(r => r.id === id)
    if (review) { setMessage(t(review.reason)); return }
    change(d => { d.planning = parsed.data }); setMessage(t('Manual connection saved for professional review. No automatic routing was used.')); setVertices('')
  }
  const addBend = () => {
    const a = model.symbols.find(s => s.id === from)
    if (!a) { setMessage(t('Choose a starting point first.')); return }
    const text = vertices || `${a.position.x},${a.position.y}`
    const previous = text.split(';').at(-1)!.split(',').map(Number)
    if (previous.length !== 2 || !previous.every(Number.isFinite)) { setMessage(t('Check the route coordinates first.')); return }
    requestPick(p => { const dx = p.x - previous[0], dy = p.y - previous[1]; const next = Math.abs(dx) > Math.abs(dy) ? { x: p.x, y: previous[1] } : { x: previous[0], y: p.y }; setVertices(`${text}; ${next.x},${next.y}`) })
  }
  const finishRoute = () => {
    const b = model.symbols.find(s => s.id === to)
    if (!b || !vertices) { setMessage(t('Choose endpoints and add a route point first.')); return }
    const previous = vertices.split(';').at(-1)!.split(',').map(Number)
    if (previous[0] !== b.position.x && previous[1] !== b.position.y) { setMessage(t('Add one more horizontal or vertical bend before the endpoint.')); return }
    setVertices(`${vertices}; ${b.position.x},${b.position.y}`)
  }
  const allPoints = model.symbols.filter(s => s.layer === layer)
  return <details open={open} onToggle={e => setOpen(e.currentTarget.open)} className="mt-4 border border-line bg-bg" id="utility-point-editor">
    <summary className="min-h-11 cursor-pointer px-4 py-3 font-display text-lg">{t('Add or move service points')}</summary>
    <div className="space-y-4 border-t border-line p-4">
      <p className="text-xs leading-relaxed text-ink-dim">{t('Place points on the plan or enter coordinates. New or moved points stay unconnected until you draw a manual connection. Drainage fixtures are edited in Technical settings & review.')}</p>
      <div className="grid gap-3 sm:grid-cols-3"><label className="text-xs">{t('Service')}<select className={control} value={layer} onChange={e => { setLayer(e.target.value as Layer); setDraft(null); setFrom(''); setTo('') }}>{Object.keys(POINT_TYPES).map(l => <option key={l} value={l}>{t(l === 'electrical' ? 'Electrical Wiring' : l === 'water_supply' ? 'Water supply' : 'Fire Alarm & Safety')}</option>)}</select></label><label className="text-xs">{t('Edit a point')}<select className={control} value={draft?.id ?? ''} onChange={e => { editPoint(e.target.value); select(`point:${e.target.value}`) }}><option value="">{t('Choose a point')}</option>{points.filter(s => (POINT_TYPES[layer] as readonly string[]).includes(s.type)).map(s => <option key={s.id} value={s.id}>{'label' in s ? t(s.label) : s.id} · {t(model.floor.rooms.find(r => r.id === s.roomIds[0])?.name)}</option>)}</select></label><button className={`${button} self-end`} onClick={newPoint} disabled={doc.layers[layer].locked}>{t('Add point')}</button></div>
      {draft && <div className="space-y-3 border-t border-line pt-4"><div className="grid gap-3 sm:grid-cols-3">
        <label className="text-xs">{t('Point type')}<select className={control} value={draft.type} onChange={e => setDraft({ ...draft, type: e.target.value })}>{POINT_TYPES[layer].map(type => <option key={type} value={type}>{t(type.replaceAll('_', ' '))}</option>)}</select></label>
        <label className="text-xs">{t('Room')}<select className={control} value={draft.roomId} onChange={e => setDraft({ ...draft, roomId: e.target.value })}>{base.floor.rooms.map(r => <option key={r.id} value={r.id}>{t(r.name)}</option>)}</select></label>
        <label className="text-xs">{t('Connection group')}<select className={control} value={draft.groupId} onChange={e => setDraft({ ...draft, groupId: e.target.value })}>{groups.map(g => <option key={g.id} value={g.id}>{g.tag} · {t(g.name)}</option>)}</select></label>
        <label className="text-xs">{t('Label')}<input className={control} value={draft.label} maxLength={180} onChange={e => setDraft({ ...draft, label: e.target.value })} /></label>
        {(['x', 'y'] as const).map(axis => <label key={axis} className="text-xs">{axis.toUpperCase()} (mm)<input className={control} type="number" value={Number.isFinite(draft.position[axis]) ? draft.position[axis] : ''} onChange={e => setDraft({ ...draft, position: { ...draft.position, [axis]: e.target.valueAsNumber } })} /></label>)}
        <label className="text-xs">{t('Mounting height (mm)')}<input className={control} type="number" min={0} max={10000} placeholder={t('Unknown')} value={draft.heightMm ?? ''} onChange={e => setDraft({ ...draft, heightMm: e.target.value === '' ? null : e.target.valueAsNumber })} /></label>
      </div><div className="flex flex-wrap gap-2"><button className={button} onClick={() => requestPick(p => setDraft(d => d ? { ...d, position: p } : d))}>{t('Choose position on plan')}</button><button className={`${button} bg-accent text-bg`} disabled={doc.layers[layer].locked} onClick={save}>{t('Apply point')}</button><button className={button} onClick={() => { setDraft(null); select(null) }}>{t('Cancel')}</button>{doc.planning.points.some(p => p.id === draft.id) && <button className={button} disabled={doc.layers[layer].locked} onClick={() => { change(d => { d.planning.points = d.planning.points.filter(p => p.id !== draft.id); d.planning.runs = d.planning.runs.filter(r => r.from !== draft.id && r.to !== draft.id) }); setDraft(null); select(null) }}>{t(base.symbols.some(s => s.id === draft.id) ? 'Restore source point' : 'Remove point')}</button>}</div></div>}
      <details className="border-t border-line"><summary className="min-h-11 cursor-pointer py-3 text-xs">{t('Draw a manual connection')}</summary><p className="mb-3 text-xs text-ink-dim">{t('Use the same circuit, zone or water network. Include exact endpoint coordinates. This records a proposed route; structural permission and installation design still need review.')}</p><div className="grid gap-3 sm:grid-cols-2">{([['From', from, setFrom], ['To', to, setTo]] as const).map(([name, value, setter]) => <label className="text-xs" key={name}>{t(name)}<select className={control} value={value} onChange={e => { setter(e.target.value); setVertices('') }}><option value="">{t('Choose a point')}</option>{allPoints.map(s => <option key={s.id} value={s.id}>{'label' in s ? t(s.label) : s.id} · ({s.position.x}, {s.position.y})</option>)}</select></label>)}</div><div className="mt-3 flex flex-wrap gap-2"><button className={button} onClick={addBend}>{t('Add route point on plan')}</button><button className={button} onClick={finishRoute}>{t('Finish at endpoint')}</button><button className={button} onClick={() => setVertices('')}>{t('Clear route draft')}</button></div><p className="mt-2 text-xs text-ink-dim">{t('Each click adds one horizontal or vertical segment. You choose every bend; no route is generated automatically.')}</p><label className="mt-3 block text-xs">{t('Route points (mm)')}<textarea className={`${control} min-h-24 py-3 font-mono`} placeholder="1000,2000; 3000,2000; 3000,4000" value={vertices} onChange={e => setVertices(e.target.value)} /></label><button className={`${button} mt-3`} disabled={doc.layers[layer].locked} onClick={route}>{t('Save manual connection')}</button><ul className="mt-3 space-y-2 text-xs">{doc.planning.runs.filter(r => r.layer === layer).map(r => <li key={r.id} className="flex items-center justify-between gap-3"><span>{model.symbols.find(s => s.id === r.from)?.type} → {model.symbols.find(s => s.id === r.to)?.type}</span><button className={button} disabled={doc.layers[layer].locked} onClick={() => change(d => { d.planning.runs = d.planning.runs.filter(u => u.id !== r.id) })}>{t('Remove connection')}</button></li>)}</ul></details>
      {message && <p role="status" className="border border-line bg-bg-inset p-3 text-xs leading-relaxed">{message}</p>}
    </div>
  </details>
}
