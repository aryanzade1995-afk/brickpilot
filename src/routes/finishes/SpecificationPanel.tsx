import type { SolarCostContext } from '@/lib/solar/estimate.ts'
import { translate as translateUi, useLanguage } from '@/lib/i18n/index.ts'
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
import { experienceOption } from '@/lib/finishes/experiences.ts'
import { applyPaintColour, paintColour, colourValue } from '@/lib/finishes/paint.ts'
import { PaintColours } from './PaintColours.tsx'
import { KitchenCounter } from './KitchenCounter.tsx'
import { cx } from '@/lib/cx.ts'
import { optionPhotos, photographedOptions } from '@/lib/finishes/optionImage.ts'
import { BrandLinksDetail } from './BrandLinksView.tsx'

export function SpecificationPanel({ item, brief, cost, design, room, onClose, onUse, solarContext }: {
  solarContext?: SolarCostContext; item: SpecItem; brief: Brief; cost: CostEstimate; design: Design; room?: string; onClose: () => void; onUse: (brief: Brief) => void
}) {
  useLanguage(s => s.language);

  const rooms = applicableRooms(cost, item)
  const options = photographedOptions(item)
  const [selectedRooms, setRooms] = useState(room ? [room] : rooms.map(r => r.id))
  const [optionId, setOption] = useState(() => {
    const current = effectiveSpec(brief, item.id, room ?? rooms[0]?.id).id
    return options.find(o => o.id === current)?.id ?? options[0]?.id ?? ''
  })
  const [colour, setColour] = useState(paintColour(brief, room ?? rooms[0]?.id).value)
  const hostRooms = design.floors.flatMap(f => f.rooms.map(r => ({ ...r, key: `${f.level}:${r.semanticId || r.id}` }))).filter(r => selectedRooms.includes(r.key))
  const previewRoom = hostRooms.find(r => /living|bedroom|dining/i.test(r.name)) ?? hostRooms[0]
  const roomSize: [number, number] | undefined = previewRoom ? [previewRoom.rect.w / 1000, previewRoom.rect.h / 1000] : undefined
  const [filters, setFilters] = useState<Filters>({})
  const [productFilters, setProductFilters] = useState<ProductFilters>({})
  const matches = filterFlooringProducts(filters).filter(p => options.some(o => o.flooringProductId === p.id))
  const finishMatches = filterFinishProducts(item.id, productFilters).filter(p => options.some(o => o.finishProductId === p.id))
  const hasFinishes = options.some(o => o.finishProductId)
  const filtered = options.filter(o => o.flooringProductId ? matches.some(p => p.id === o.flooringProductId) :
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
    return [o.id, estimateBoq(design, next, cost.selection, solarContext).expected - cost.expected]
  })), [item, brief, cost, design, selectedRooms])
  const selected = options.find(o => o.id === optionId)!
  const current = (id: string) => item.scope === 'perRoom' && selectedRooms.length
    ? selectedRooms.every(r => effectiveSpec(brief, item.id, r).id === id) : effectiveSpec(brief, item.id).id === id
  return <div className="fixed inset-0 z-50 bg-black/20" onClick={onClose}>
    <aside ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-label={translateUi(`Change ${item.label}`)} onClick={e => e.stopPropagation()}
      className="absolute inset-y-0 right-0 flex w-full max-w-[1180px] flex-col bg-bg shadow-xl outline-none">
      <header className="flex items-center justify-between gap-4 border-b border-line px-5 py-4"><div><p className="label">{translateUi("Specification")}</p><h2 className="mt-1 font-display text-xl">{translateUi(item.label)}</h2></div><button type="button" aria-label={translateUi("Close options")} onClick={onClose} className="p-2 text-sm">✕</button></header>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5"><div className="grid items-start gap-6 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]"><div className="lg:sticky lg:top-0"><Suspense fallback={<p className="p-5 text-sm text-ink-dim">{translateUi("Loading 3D preview…")}</p>}><FinishObjectPreview item={item} option={selected} colour={item.id === 'interior-paint' ? colourValue(colour).hex : undefined} roomSize={item.id === 'false-ceiling' ? roomSize : undefined} /></Suspense>{item.id === 'false-ceiling' && previewRoom && <p className="mt-3 text-xs text-ink-dim">{translateUi("Fitted to ")}{translateUi(previewRoom.name)} · {translateUi(roomSize?.[0].toFixed(2))} × {translateUi(roomSize?.[1].toFixed(2))} {translateUi(" m. Coordinate final ceiling height and services.")}</p>}<p className="mt-3 text-xs leading-relaxed text-ink-dim">{translateUi("Select a card to update the preview. Use this saves the finish and updates your estimate.")}</p></div><div className="min-w-0">
        {item.id === 'interior-paint' && <PaintColours value={colour} onChange={setColour} brand={finishProduct(selected?.finishProductId)?.brand} />}
        {item.scope === 'perRoom' && !!rooms.length && <fieldset className="mb-5"><legend className="label">{translateUi("Apply to")}</legend>
          <label className="mt-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={rooms.every(r => selectedRooms.includes(r.id))} onChange={e => setRooms(e.target.checked ? rooms.map(r => r.id) : [])} />{translateUi("All applicable rooms")}</label>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">{rooms.map(r => <label key={r.id} className="flex items-center gap-2 text-xs"><input type="checkbox" checked={selectedRooms.includes(r.id)} onChange={e => setRooms(e.target.checked ? [...selectedRooms, r.id] : selectedRooms.filter(id => id !== r.id))} />{translateUi(r.floor)} · {translateUi(r.name)}</label>)}</div></fieldset>}
        {item.id === 'kitchen-counter' ? <KitchenCounter item={item} cost={cost} value={optionId} onChange={setOption} /> : <>
        <p className="mb-3 text-xs text-ink-dim">{translateUi("Differences below are for the project total, including allowances, for the selected rooms.")}</p>

        {item.id === 'pool' && !cost.boq.some(line => line.item === 'pool' && line.qty > 0) && <p className="mb-4 rounded-lg bg-bg-inset p-3 text-xs text-ink-dim">{translateUi("Your plan has no pool area. You can explore these finishes, but the estimate adds no pool cost. Add a pool in the Brief if you want it included in the plan.")}</p>}
        {hasFinishes && <p className="mb-4 text-xs leading-relaxed text-ink-dim">{translateUi(item.note)} {translateUi(" Changes here specify the existing plan; they do not move walls or openings.")}</p>}
        {item.group === 'flooring' && <FlooringFilters availableIds={options.map(o => o.flooringProductId).filter((id): id is string => !!id)} filters={filters} onChange={setFilters} count={matches.length} />}
        {hasFinishes && <FinishFilters itemId={item.id} availableIds={options.map(o => o.finishProductId).filter((id): id is string => !!id)} filters={productFilters} onChange={setProductFilters} count={finishMatches.length} />}
        {!filtered.length && <p className="py-4 text-sm text-ink-dim">{translateUi("No matching choices. Try clearing a filter.")}</p>}
        <div className="grid grid-cols-2 gap-3">{filtered.map(o => <button type="button" key={o.id} data-finish-option={o.id} onClick={() => { setOption(o.id); if (compare === o.id) setCompare('') }} aria-pressed={optionId === o.id}
          className={cx('min-w-0 rounded-xl border p-3 text-left transition-colors hover:bg-bg-inset', optionId === o.id ? 'border-ink bg-bg-inset' : 'border-line')}>
          <FinishSwatch item={item} option={o} className="mb-3 h-24 w-full object-contain" />
          {o.flooringProductId && <span className="mb-1 block text-[11px] text-ink-faint">{translateUi(flooringProduct(o.flooringProductId)?.manufacturer)}<br />{translateUi(flooringProduct(o.flooringProductId)?.productName)}</span>}
          {o.finishProductId && <span className="mb-1 block text-[11px] text-ink-faint">{translateUi(finishProduct(o.finishProductId)?.brand)}</span>}
          <span className="block text-sm">{translateUi(o.name)}</span><span className="mt-2 block text-xs text-ink-dim">{translateUi(finishProduct(o.finishProductId)?.rate.basis === 'advisory' ? 'Preference / quote required · no added charge' : differences[o.id] === 0 ? 'Same estimate' : `${differences[o.id] > 0 ? '+' : '−'}${formatINR(Math.abs(differences[o.id]))}`)}</span>
          {optionId === o.id && <span className="mt-2 block text-xs">{translateUi("Selected")}</span>}{current(o.id) && <span className="mt-2 block text-xs">{translateUi("✓ Current")}</span>}</button>)}</div>
        <label className="mt-6 block text-xs">{translateUi("Compare two options")}<select aria-label={translateUi("Compare two options")} className="mt-2 w-full border border-line bg-bg p-2 text-sm" value={compare} onChange={e => setCompare(e.target.value)}><option value="">{translateUi("Show selected option only")}</option>{options.filter(o => o.id !== optionId).map(o => <option key={o.id} value={o.id}>{translateUi(o.name)}</option>)}</select></label>
        <div className={cx('mt-5 grid gap-6', compare && 'sm:grid-cols-2')}><OptionDetails item={item} option={selected} />{compare && <OptionDetails item={item} option={item.options.find(o => o.id === compare)!} />}</div>
        </>}
      </div></div></div>
      <footer className="flex justify-end gap-3 border-t border-line px-5 py-4"><button type="button" onClick={onClose} className="border border-line px-5 py-2 text-sm">{translateUi("Cancel")}</button><button type="button" disabled={item.scope === 'perRoom' && !!rooms.length && !selectedRooms.length} onClick={() => onUse(item.id === 'interior-paint' ? applyPaintColour(applySpecification(brief, cost, item, optionId, selectedRooms), colour, rooms.map(r=>r.id), selectedRooms) : applySpecification(brief, cost, item, optionId, selectedRooms))} className="bg-accent px-5 py-2 text-sm text-white disabled:opacity-40">{translateUi("Use this")}</button></footer>
    </aside></div>
}
function OptionDetails({ item, option }: { item: SpecItem; option: SpecOption }) {
  useLanguage(s => s.language);

  const product = flooringProduct(option.flooringProductId)
  const finish = finishProduct(option.finishProductId), experience = experienceOption(option.experienceOptionId)
  const rate = specificationRate(option.rateId)
  const photos = ['windows-glass-grills','doors','railings-gates','plumbing-sanitary','false-ceiling','roof-exterior','external-works','painting'].includes(item.group) ? [] : optionPhotos(option).filter(p => p.kind === 'closeup' || p.kind === 'installed')
  return <section className="min-w-0"><h3 className="font-display text-lg">{translateUi(option.name)}</h3>
    {experience && <div className="mt-3 space-y-2 text-xs leading-relaxed text-ink-dim"><p>{translateUi(experience.note)}</p><a href={experience.sourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-md border border-line bg-bg-inset/70 px-3 py-1.5 text-xs font-sans font-medium text-ink shadow-xs transition-colors hover:border-ink hover:bg-bg"><span>{translateUi("Official design / system reference")}</span><span className="font-sans text-accent">↗</span></a><p>{translateUi("Product photograph unavailable: no verified matching installation photo. Interactive geometry above is a Visualisation, not a photograph or an AI-generated image.")}</p></div>}
    {product && <div className="mt-3 space-y-3 text-xs leading-relaxed text-ink-dim">
      <FinishSwatch item={item} option={option} className="aspect-[4/3] w-full object-contain" />
      <p>{translateUi(product.manufacturer)} · {translateUi(product.productName)}</p>
      <p>{translateUi("Material: ")}{translateUi(product.materialType)}<br />{translateUi("Look: ")}{translateUi(product.look)}<br />{translateUi("Finish: ")}{translateUi(product.finish)} · {translateUi(product.color)}</p>
      <p>{translateUi("Sizes: ")}{translateUi(product.availableSizes.join(', '))}<br />{translateUi("Recommended for: ")}{translateUi(product.suitableRooms.join(', '))}<br />{translateUi(product.indoorOutdoor)} · {translateUi(product.slipResistance)}</p>
      {product.sourceUrl && <a href={product.sourceUrl} target="_blank" rel="noopener noreferrer" title={translateUi("Opens the manufacturer's website. Prices and availability there may differ from this concept estimate.")} aria-label={translateUi(`Official product source on ${product.manufacturer}`)} className="inline-flex items-center gap-1.5 rounded-md border border-line bg-bg-inset/70 px-3 py-1.5 text-xs font-sans font-medium text-ink shadow-xs transition-colors hover:border-ink hover:bg-bg"><span>{translateUi(`Official ${product.manufacturer} product source`)}</span><span className="font-sans text-accent">↗</span></a>}
      <p>{translateUi(product.image.url ? 'Official-source product swatch / slab image. Manufacturer permission is required before production use or redistribution; photography method is not verified.' : 'Image unavailable: no verified product image. Confirm the product with your supplier.')}</p>
      <p>{translateUi("The 3D finish preview uses this same product swatch in catalogue colour mode.")}</p><p>{translateUi(product.price.note)}</p>
    </div>}
    {finish && <div className="mt-3 space-y-3 text-xs leading-relaxed text-ink-dim">
      <FinishSwatch item={item} option={option} className="aspect-[4/3] w-full object-contain" />
      <p>{translateUi(finish.brand)} · {translateUi(finish.productName)}</p>
      <p>{translateUi("Material: ")}{translateUi(finish.material)}<br />{translateUi("Look / type: ")}{translateUi(finish.style)}<br />{translateUi("Finish: ")}{translateUi(finish.finish)}</p>
      <p>{translateUi("Application: ")}{translateUi(finish.application.join(', '))}<br />{translateUi("Recommended for: ")}{translateUi(finish.suitableRooms.join(', '))}</p>
      <p>{translateUi(finish.specification)}</p>
      <a href={finish.sourceUrl} target="_blank" rel="noopener noreferrer" title={translateUi("Opens the manufacturer's website. Prices and availability there may differ from this concept estimate.")} aria-label={translateUi(`Official ${finish.brand} ${finish.sourceKind === 'product' ? 'product source' : 'reference'}`)} className="inline-flex items-center gap-1.5 rounded-md border border-line bg-bg-inset/70 px-3 py-1.5 text-xs font-sans font-medium text-ink shadow-xs transition-colors hover:border-ink hover:bg-bg"><span>{translateUi(`Official ${finish.brand} `)}{translateUi(finish.sourceKind === 'guidance' ? 'specification guidance' : finish.sourceKind === 'generic-texture' ? 'natural-material texture source' : finish.sourceKind === 'product' ? 'product source' : 'collection reference')}</span><span className="font-sans text-accent">↗</span></a>
      <p>{translateUi(finish.image.note)}</p>
      {finish.image.path && <p>{translateUi("Credit: ")}{translateUi(finish.image.credit)} · {translateUi(finish.image.licensingStatus === 'permission-required' ? 'Manufacturer permission required before production use or redistribution' : 'CC0 natural-material texture')}</p>}
      <p>{translateUi(finish.rate.note)}</p>
    </div>}
    {photos.map(p => <figure key={p.file} className="mt-3"><img src={assetUrl(p.webFile ?? p.file)} alt={translateUi(`${option.name} ${p.kind}`)} className="aspect-[4/3] w-full object-cover" /><figcaption className="mt-1 text-[11px] leading-relaxed text-ink-faint">{translateUi(p.kind === 'closeup' ? 'Real texture close-up' : 'Installed photograph')} · {translateUi(p.credit)} · {translateUi(p.licence)}</figcaption></figure>)}
    <ul className="mt-4 space-y-2 text-xs leading-relaxed text-ink-dim">{option.facts.slice(0, 4).map(f => <li key={f}>{translateUi(f)}</li>)}</ul>
    <p className="mt-4 text-sm">{translateUi(finish?.rate.basis === 'advisory' ? 'No price added · preference / separate quote' : `${formatINR(rate.installed)} / ${rate.unit}`)}</p><p className="mt-1 text-xs text-ink-faint">{translateUi(rate.city)} · {translateUi(rate.date)} {translateUi(" · approximate installed allowance")}</p><p className="mt-2 text-[11px] text-ink-faint">{translateUi(rate.source)}</p>
    <BrandLinksDetail item={item} option={option} />
  </section>
}
