import { finishFacets, type FinishFilters as Filters } from '@/lib/finishes/catalogue.ts'

/** Facets come from the applicable specification data, not a component-specific product list. */
export function FinishFilters({ itemId, filters, onChange, count }: {
  itemId: string; filters: Filters; onChange: (filters: Filters) => void; count: number
}) {
  const facets = finishFacets(itemId)
  return <fieldset className="mb-5 border-b border-line pb-5"><legend className="sr-only">Find specifications</legend>
    <label className="block text-xs">Search specifications<input type="search" value={filters.search ?? ''} onChange={e => onChange({ ...filters, search: e.target.value })}
      placeholder="Material, finish, type or supplier…" className="mt-2 w-full border border-line bg-bg px-3 py-2 text-sm" /></label>
    <div className="mt-3 grid grid-cols-2 gap-3">{(['material', 'style', 'finish', 'brand', 'application', 'room'] as const).filter(key => facets[key].length > 1).map(key =>
      <label key={key} className="min-w-0 text-xs">{{ material: 'Material / system', style: 'Look / type', finish: 'Finish', brand: 'Brand / reference', application: 'Application', room: 'Room suitability' }[key]}
        <select value={filters[key] ?? ''} onChange={e => onChange({ ...filters, [key]: e.target.value })} aria-label={`Specification ${key} filter`} className="mt-1 w-full border border-line bg-bg p-2 text-sm">
          <option value="">All</option>{facets[key].map(value => <option key={value}>{value}</option>)}
        </select></label>)}</div>
    <div className="mt-3 flex items-center justify-between text-xs text-ink-dim"><span>{count} catalogue choices</span><button type="button" onClick={() => onChange({})} className="underline">Clear filters</button></div>
    <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">Recommendations and supplier references are indicative. Confirm the exact product, installation and availability.</p>
  </fieldset>
}
