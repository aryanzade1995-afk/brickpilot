import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import type { Brief } from '@/lib/model/brief.ts'
import type { Design } from '@/lib/engine/types.ts'
import { estimateBoq, type CostEstimate } from '@/lib/cost/index.ts'
import { specificationRate } from '@/lib/cost/catalogue.ts'
import { applicableRooms, applySpecification, assetUrl, effectiveSpec, type SpecItem, type SpecOption } from '@/lib/cost/workspace.ts'
import { formatINR } from '@/lib/format.ts'
import { FinishSwatch } from './FinishSwatch.tsx'
import { FlooringFilters } from './FlooringFilters.tsx'
import { filterFlooringProducts, flooringProduct, type FlooringFilters as Filters } from '@/lib/flooring/catalogue.ts'
import { FinishFilters } from './FinishFilters.tsx'
import { filterFinishProducts, finishProduct, type FinishFilters as ProductFilters } from '@/lib/finishes/catalogue.ts'
const FinishObjectPreview = lazy(() => import('./FinishObjectPreview.tsx').then(m => ({ default: m.FinishObjectPreview })))
import { cx } from '@/lib/cx.ts'

export function SpecificationPanel({ item, brief, cost, design, room, onClose, onUse }: {
  item: SpecItem; brief: Brief; cost: CostEstimate; design: Design; room?: string; onClose: () => void; onUse: (brief: Brief) => void
}) {
  const rooms = applicableRooms(cost, item)
  const [selectedRooms, setRooms] = useState(room ? [room] : rooms.map(r => r.id))
  const [optionId, setOption] = useState(effectiveSpec(brief, item.id, room ?? rooms[0]?.id).id)
  const [filters, setFilters] = useState<Filters>({})
  const [productFilters, setProductFilters] = useState<ProductFilters>({})
  const matches = filterFlooringProducts(filters)
  const finishMatches = filterFinishProducts(item.id, productFilters)
  const hasFinishes = item.options.some(o => o.finishProductId)
  const filtered = item.options.filter(o => o.flooringProductId ? matches.some(p => p.id === o.flooringProductId) :
    o.finishProductId ? finishMatches.some(p => p.id === o.finishProductId) : !Object.values(filters).some(Boolean) && !Object.values(productFilters).some(Boolean))
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
      className="absolute inset-y-0 right-0 flex w-full max-w-[1180px] flex-col bg-bg shadow-xl outline-none">
      <header className="flex items-center justify-between gap-4 border-b border-line px-5 py-4"><div><p className="label">Specification</p><h2 className="mt-1 font-display text-xl">{item.label}</h2></div><button type="button" aria-label="Close options" onClick={onClose} className="p-2 text-sm">✕</button></header>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5"><div className="grid items-start gap-6 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]"><div className="lg:sticky lg:top-0"><Suspense fallback={<p className="p-5 text-sm text-ink-dim">Loading 3D preview…</p>}><FinishObjectPreview item={item} option={selected} /></Suspense><p className="mt-3 text-xs leading-relaxed text-ink-dim">Preview only. Your villa keeps its curated exterior colours; specification choices update the estimate.</p></div><div className="min-w-0">
        {item.scope === 'perRoom' && !!rooms.length && <fieldset className="mb-5"><legend className="label">Apply to</legend>
          <label className="mt-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={rooms.every(r => selectedRooms.includes(r.id))} onChange={e => setRooms(e.target.checked ? rooms.map(r => r.id) : [])} />All applicable rooms</label>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">{rooms.map(r => <label key={r.id} className="flex items-center gap-2 text-xs"><input type="checkbox" checked={selectedRooms.includes(r.id)} onChange={e => setRooms(e.target.checked ? [...selectedRooms, r.id] : selectedRooms.filter(id => id !== r.id))} />{r.floor} · {r.name}</label>)}</div></fieldset>}
        <p className="mb-3 text-xs text-ink-dim">Differences below are for the project total, including allowances, for the selected rooms.</p>

        {hasFinishes && <p className="mb-4 text-xs leading-relaxed text-ink-dim">{item.note} Changes here specify the existing plan; they do not move walls or openings.</p>}
        {item.group === 'flooring' && <FlooringFilters filters={filters} onChange={setFilters} count={matches.length} />}
        {hasFinishes && <FinishFilters itemId={item.id} filters={productFilters} onChange={setProductFilters} count={finishMatches.length} />}
        {!filtered.length && <p className="py-4 text-sm text-ink-dim">No matching choices. Try clearing a filter.</p>}
        <div className="grid grid-cols-2 gap-3">{filtered.map(o => <button type="button" key={o.id} onClick={() => { setOption(o.id); if (compare === o.id) setCompare('') }} aria-pressed={optionId === o.id}
          className={cx('min-w-0 rounded-xl border p-3 text-left transition-colors hover:bg-bg-inset', optionId === o.id ? 'border-ink bg-bg-inset' : 'border-line')}>
          <FinishSwatch item={item} option={o} className="mb-3 h-24 w-full object-contain" />
          {o.flooringProductId && <span className="mb-1 block text-[11px] text-ink-faint">{flooringProduct(o.flooringProductId)?.manufacturer}<br />{flooringProduct(o.flooringProductId)?.productName}</span>}
          {o.finishProductId && <span className="mb-1 block text-[11px] text-ink-faint">{finishProduct(o.finishProductId)?.brand}</span>}
          <span className="block text-sm">{o.name}</span><span className="mt-2 block text-xs text-ink-dim">{finishProduct(o.finishProductId)?.rate.basis === 'advisory' ? 'Preference / quote required · no added charge' : differences[o.id] === 0 ? 'Same estimate' : `${differences[o.id] > 0 ? '+' : '−'}${formatINR(Math.abs(differences[o.id]))}`}</span>
          {optionId === o.id && <span className="mt-2 block text-xs">Selected</span>}{current(o.id) && <span className="mt-2 block text-xs">✓ Current</span>}</button>)}</div>
        <label className="mt-6 block text-xs">Compare two options<select aria-label="Compare two options" className="mt-2 w-full border border-line bg-bg p-2 text-sm" value={compare} onChange={e => setCompare(e.target.value)}><option value="">Show selected option only</option>{item.options.filter(o => o.id !== optionId).map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
        <div className={cx('mt-5 grid gap-6', compare && 'sm:grid-cols-2')}><OptionDetails item={item} option={selected} />{compare && <OptionDetails item={item} option={item.options.find(o => o.id === compare)!} />}</div>
      </div></div></div>
      <footer className="flex justify-end gap-3 border-t border-line px-5 py-4"><button type="button" onClick={onClose} className="border border-line px-5 py-2 text-sm">Cancel</button><button type="button" disabled={item.scope === 'perRoom' && !!rooms.length && !selectedRooms.length} onClick={() => onUse(applySpecification(brief, cost, item, optionId, selectedRooms))} className="bg-accent px-5 py-2 text-sm text-white disabled:opacity-40">Use this</button></footer>
    </aside></div>
}
function OptionDetails({ item, option }: { item: SpecItem; option: SpecOption }) {
  const product = flooringProduct(option.flooringProductId)
  const finish = finishProduct(option.finishProductId)
  const rate = specificationRate(option.rateId)
  const photos = ['windows-glass-grills','doors','railings-gates'].includes(item.group) ? [] : option.photos.filter(p => p.kind === 'closeup' || p.kind === 'installed')
  return <section className="min-w-0"><h3 className="font-display text-lg">{option.name}</h3>
    {product && <div className="mt-3 space-y-3 text-xs leading-relaxed text-ink-dim">
      <FinishSwatch item={item} option={option} className="aspect-[4/3] w-full object-contain" />
      <p>{product.manufacturer} · {product.productName}</p>
      <p>Material: {product.materialType}<br />Look: {product.look}<br />Finish: {product.finish} · {product.color}</p>
      <p>Sizes: {product.availableSizes.join(', ')}<br />Recommended for: {product.suitableRooms.join(', ')}<br />{product.indoorOutdoor} · {product.slipResistance}</p>
      {product.sourceUrl && <a href={product.sourceUrl} target="_blank" rel="noopener noreferrer" className="block underline">Official product / collection source</a>}
      <p>{product.image.url ? 'Official-source product swatch / slab image. Manufacturer permission is required before production use or redistribution; photography method is not verified.' : 'Image unavailable: no verified product image. Confirm the product with your supplier.'}</p>
      <p>{product.previewNote}</p><p>{product.price.note}</p>
    </div>}
    {finish && <div className="mt-3 space-y-3 text-xs leading-relaxed text-ink-dim">
      <FinishSwatch item={item} option={option} className="aspect-[4/3] w-full object-contain" />
      <p>{finish.brand} · {finish.productName}</p>
      <p>Material: {finish.material}<br />Look / type: {finish.style}<br />Finish: {finish.finish}</p>
      <p>Application: {finish.application.join(', ')}<br />Recommended for: {finish.suitableRooms.join(', ')}</p>
      <p>{finish.specification}</p>
      <a href={finish.sourceUrl} target="_blank" rel="noopener noreferrer" className="block underline">Official {finish.sourceKind === 'guidance' ? 'specification guidance' : finish.sourceKind === 'generic-texture' ? 'natural-material texture source' : 'product / collection reference'}</a>
      <p>{finish.image.note}</p>
      {finish.image.path && <p>Credit: {finish.image.credit} · {finish.image.licensingStatus === 'permission-required' ? 'Manufacturer permission required before production use or redistribution' : 'CC0 natural-material texture'}</p>}
      <p>{finish.rate.note}</p>
    </div>}
    {photos.map(p => <figure key={p.file} className="mt-3"><img src={assetUrl(p.webFile ?? p.file)} alt={`${option.name} ${p.kind}`} className="aspect-[4/3] w-full object-cover" /><figcaption className="mt-1 text-[11px] leading-relaxed text-ink-faint">{p.kind === 'closeup' ? 'Real texture close-up' : 'Installed photograph'} · {p.credit} · {p.licence}</figcaption></figure>)}
    <ul className="mt-4 space-y-2 text-xs leading-relaxed text-ink-dim">{option.facts.slice(0, 4).map(f => <li key={f}>{f}</li>)}</ul>
    <p className="mt-4 text-sm">{finish?.rate.basis === 'advisory' ? 'No price added · preference / separate quote' : `${formatINR(rate.installed)} / ${rate.unit}`}</p><p className="mt-1 text-xs text-ink-faint">{rate.city} · {rate.date} · approximate installed allowance</p><p className="mt-2 text-[11px] text-ink-faint">{rate.source}</p>
  </section>
}
