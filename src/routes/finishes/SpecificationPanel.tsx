import { useEffect, useMemo, useRef, useState } from 'react'
import type { Brief } from '@/lib/model/brief.ts'
import type { Design } from '@/lib/engine/types.ts'
import { estimateBoq, type CostEstimate } from '@/lib/cost/index.ts'
import { specificationRate } from '@/lib/cost/catalogue.ts'
import { applicableRooms, applySpecification, assetUrl, effectiveSpec, samples, type SpecItem, type SpecOption } from '@/lib/cost/workspace.ts'
import { formatINR } from '@/lib/format.ts'
import { cx } from '@/lib/cx.ts'

export function SpecificationPanel({ item, brief, cost, design, room, onClose, onUse }: {
  item: SpecItem; brief: Brief; cost: CostEstimate; design: Design; room?: string; onClose: () => void; onUse: (brief: Brief) => void
}) {
  const rooms = applicableRooms(cost, item)
  const [selectedRooms, setRooms] = useState(room ? [room] : rooms.map(r => r.id))
  const [optionId, setOption] = useState(effectiveSpec(brief, item.id, room ?? rooms[0]?.id).id)
  const [compare, setCompare] = useState('')
  const panel = useRef<HTMLElement>(null)
  const close = useRef(onClose)
  useEffect(() => { close.current = onClose }, [onClose])
  useEffect(() => {
    const focused = document.activeElement as HTMLElement | null, overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'; panel.current?.focus()
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close.current()
      if (event.key !== 'Tab') return
      const controls = [...(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),select,input:not(:disabled),a[href]') ?? [])]
      const first = controls[0], last = controls.at(-1)
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel.current)) { event.preventDefault(); first?.focus() }
    }
    document.addEventListener('keydown', key)
    return () => { document.body.style.overflow = overflow; document.removeEventListener('keydown', key); focused?.focus() }
  }, [])
  const differences = useMemo(() => Object.fromEntries(item.options.map(o => {
    const next = applySpecification(brief, cost, item, o.id, selectedRooms)
    return [o.id, estimateBoq(design, next, cost.selection).expected - cost.expected]
  })), [item, brief, cost, design, selectedRooms])
  const selected = item.options.find(o => o.id === optionId)!
  const current = (id: string) => item.scope === 'perRoom' && selectedRooms.length
    ? selectedRooms.every(r => effectiveSpec(brief, item.id, r).id === id) : effectiveSpec(brief, item.id).id === id
  return <div className="fixed inset-0 z-50 bg-black/20" onClick={onClose}>
    <aside ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-label={`Change ${item.label}`} onClick={e => e.stopPropagation()}
      className="absolute inset-y-0 right-0 flex w-full max-w-[620px] flex-col bg-bg shadow-xl outline-none">
      <header className="flex items-center justify-between gap-4 border-b border-line px-5 py-4"><div><p className="label">Specification</p><h2 className="mt-1 font-display text-xl">{item.label}</h2></div><button type="button" aria-label="Close options" onClick={onClose} className="p-2 text-sm">✕</button></header>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
        {item.scope === 'perRoom' && !!rooms.length && <fieldset className="mb-5"><legend className="label">Apply to</legend>
          <label className="mt-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={rooms.every(r => selectedRooms.includes(r.id))} onChange={e => setRooms(e.target.checked ? rooms.map(r => r.id) : [])} />All applicable rooms</label>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">{rooms.map(r => <label key={r.id} className="flex items-center gap-2 text-xs"><input type="checkbox" checked={selectedRooms.includes(r.id)} onChange={e => setRooms(e.target.checked ? [...selectedRooms, r.id] : selectedRooms.filter(id => id !== r.id))} />{r.floor} · {r.name}</label>)}</div></fieldset>}
        <p className="mb-3 text-xs text-ink-dim">Differences below are for the project total, including allowances, for the selected rooms.</p>
        <div className="grid grid-cols-2 gap-3">{item.options.map(o => <button type="button" key={o.id} onClick={() => { setOption(o.id); if (compare === o.id) setCompare('') }} aria-pressed={optionId === o.id}
          className={cx('min-w-0 border p-3 text-left', optionId === o.id ? 'border-ink bg-bg-inset' : 'border-line')}>
          {o.photos.find(p => p.kind === 'closeup') && <img src={assetUrl(o.photos.find(p => p.kind === 'closeup')!.webFile ?? o.photos[0].file)} alt={`${o.name} texture close-up`} className="mb-3 h-20 w-full object-cover" />}
          <span className="block text-sm">{o.name}</span><span className="mt-2 block text-xs text-ink-dim">{differences[o.id] === 0 ? 'Same estimate' : `${differences[o.id] > 0 ? '+' : '−'}${formatINR(Math.abs(differences[o.id]))}`}</span>
          {current(o.id) && <span className="mt-2 block text-xs">✓ Current</span>}</button>)}</div>
        <label className="mt-6 block text-xs">Compare two options<select aria-label="Compare two options" className="mt-2 w-full border border-line bg-bg p-2 text-sm" value={compare} onChange={e => setCompare(e.target.value)}><option value="">Show selected option only</option>{item.options.filter(o => o.id !== optionId).map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
        <div className={cx('mt-5 grid gap-6', compare && 'sm:grid-cols-2')}><OptionDetails option={selected} />{compare && <OptionDetails option={item.options.find(o => o.id === compare)!} />}</div>
      </div>
      <footer className="flex justify-end gap-3 border-t border-line px-5 py-4"><button type="button" onClick={onClose} className="border border-line px-5 py-2 text-sm">Cancel</button><button type="button" disabled={item.scope === 'perRoom' && !!rooms.length && !selectedRooms.length} onClick={() => onUse(applySpecification(brief, cost, item, optionId, selectedRooms))} className="bg-accent px-5 py-2 text-sm text-white disabled:opacity-40">Use this</button></footer>
    </aside></div>
}
function OptionDetails({ option }: { option: SpecOption }) {
  const rate = specificationRate(option.rateId), sample = samples.find(s => s.materialId === option.blenderMaterial)
  const photos = option.photos.filter(p => p.kind === 'closeup' || p.kind === 'installed')
  return <section className="min-w-0"><h3 className="font-display text-lg">{option.name}</h3>
    {photos.map(p => <figure key={p.file} className="mt-3"><img src={assetUrl(p.webFile ?? p.file)} alt={`${option.name} ${p.kind}`} className="aspect-[4/3] w-full object-cover" /><figcaption className="mt-1 text-[11px] leading-relaxed text-ink-faint">{p.kind === 'closeup' ? 'Real texture close-up' : 'Installed photograph'} · {p.credit} · {p.licence}</figcaption></figure>)}
    {sample && <figure className="mt-4"><img src={assetUrl(sample.photo.webFile ?? sample.photo.file)} alt={`${option.name} sample room visualisation`} className="w-full" /><figcaption className="mt-1 text-[11px] text-ink-faint">{sample.photo.caption}</figcaption></figure>}
    <ul className="mt-4 space-y-2 text-xs leading-relaxed text-ink-dim">{option.facts.slice(0, 4).map(f => <li key={f}>{f}</li>)}</ul>
    <p className="mt-4 text-sm">{formatINR(rate.installed)} / {rate.unit}</p><p className="mt-1 text-xs text-ink-faint">{rate.city} · {rate.date} · approximate installed allowance</p><p className="mt-2 text-[11px] text-ink-faint">{rate.source}</p>
  </section>
}
