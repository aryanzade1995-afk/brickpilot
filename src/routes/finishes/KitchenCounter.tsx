import { useState } from 'react'
import type { CostEstimate } from '@/lib/cost/index.ts'
import { specificationRate } from '@/lib/cost/catalogue.ts'
import { assetUrl, itemLines, type SpecItem, type SpecOption } from '@/lib/cost/workspace.ts'
import { finishProduct } from '@/lib/finishes/catalogue.ts'
import { formatINR } from '@/lib/format.ts'
import { cx } from '@/lib/cx.ts'

const FIRST = 6

/** the material's own surface texture (the same one the 3D model and renders use) */
const imageOf = (o: SpecOption) => {
  const photo = o.photos.find((p) => p.kind === 'closeup') ?? o.photos[0]
  return photo ? assetUrl(photo.webFile ?? photo.file) : `/specs/textures/${o.blenderMaterial}-800.jpg`
}
/** plain notes about the material: no brand, supplier or source attribution */
const notesOf = (o: SpecOption) => {
  const p = finishProduct(o.finishProductId)
  return [...(p ? [p.specification] : []), ...o.facts].filter((n, i, all) => all.indexOf(n) === i).slice(0, 5)
}

/** Kitchen counter: six material cards (more on request), one selected, and its specification sheet with the plan-linked cost. */
export function KitchenCounter({ item, cost, value, onChange }: { item: SpecItem; cost: CostEstimate; value: string; onChange: (id: string) => void }) {
  const options = item.options.filter((o, i, all) => all.findIndex((x) => x.id === o.id) === i)
  const [more, setMore] = useState(() => options.findIndex((o) => o.id === value) >= FIRST)
  const shown = more ? options : options.slice(0, FIRST)
  const selected = options.find((o) => o.id === value) ?? options[0]
  const rate = specificationRate(selected.rateId)
  const qty = Math.round(itemLines(cost, item).reduce((n, l) => n + l.qty, 0) * 10) / 10
  return <div>
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3" role="radiogroup" aria-label="Countertop material">
      {shown.map((o) => {
        const on = o.id === selected.id
        return <button key={o.id} type="button" role="radio" aria-checked={on} onClick={() => onChange(o.id)}
          className={cx('min-w-0 overflow-hidden rounded-xl border text-left transition-colors', on ? 'border-ink ring-2 ring-ink' : 'border-line hover:border-ink-dim')}>
          <img src={imageOf(o)} alt={o.name} loading="lazy" className="aspect-[4/3] w-full object-cover" />
          <span className="block px-3 pt-2.5 text-sm leading-snug">{o.name}</span>
          <span className="block px-3 pb-3 pt-1 text-xs text-ink-dim">{formatINR(specificationRate(o.rateId).installed)} / m²</span>
        </button>
      })}
    </div>
    {options.length > FIRST && <div className="mt-4 flex justify-center">
      <button type="button" aria-expanded={more} onClick={() => setMore(!more)} className="rounded-lg border border-line px-5 py-2 text-sm hover:bg-bg-inset">{more ? 'Fewer options' : `More Options (${options.length - FIRST})`}</button>
    </div>}

    <section aria-label="Selected countertop" className="mt-6 overflow-hidden rounded-xl border border-line">
      <img src={imageOf(selected)} alt={`${selected.name} texture`} className="aspect-[16/9] w-full object-cover" />
      <div className="space-y-4 p-5">
        <div><p className="label">Specification</p><h3 className="mt-1 font-display text-xl">{selected.name}</h3></div>
        <ul className="space-y-1.5 text-xs leading-relaxed text-ink-dim">{notesOf(selected).map((n) => <li key={n}>{n}</li>)}</ul>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 border-t border-line pt-4 text-sm">
          <dt className="text-ink-dim">Price</dt><dd className="text-right">{formatINR(rate.installed)} / m²</dd>
          <dt className="text-ink-dim">Quantity</dt><dd className="text-right">{qty.toFixed(1)} m²<span className="block text-[11px] text-ink-faint">from your plan's kitchen</span></dd>
          <dt className="font-medium">Estimated cost</dt><dd className="text-right font-medium">{formatINR(Math.round(rate.installed * qty))}</dd>
        </dl>
        <p className="text-[11px] leading-relaxed text-ink-faint">{rate.city} installed allowance, rates as of {rate.date}. Approximate concept allowance including fixing; confirm with a local quote before ordering.</p>
      </div>
    </section>
  </div>
}
