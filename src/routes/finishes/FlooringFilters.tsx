import { flooringFacets, flooringProducts, type FlooringFilters as Filters } from '@/lib/flooring/catalogue.ts'

export function FlooringFilters({ availableIds, filters, onChange, count }: { availableIds?: string[]; filters: Filters; onChange: (filters: Filters) => void; count: number }) {
  const products = flooringProducts.filter(p => !availableIds || availableIds.includes(p.id))
  const facets = availableIds ? {material:[...new Set(products.map(p=>p.materialType))].sort(),look:[...new Set(products.map(p=>p.look))].sort(),finish:[...new Set(products.map(p=>p.finish))].sort(),manufacturer:[...new Set(products.map(p=>p.manufacturer))].sort(),room:[...new Set(products.flatMap(p=>p.suitableRooms))].sort()} : flooringFacets
  return <fieldset className="mb-5 border-b border-line pb-5"><legend className="sr-only">Find flooring</legend>
    <label className="block text-xs">Search flooring<input type="search" value={filters.search ?? ''} onChange={e => onChange({ ...filters, search: e.target.value })}
      placeholder="Marble, wood, Kota, product name…" className="mt-2 w-full border border-line bg-bg px-3 py-2 text-sm" /></label>
    <div className="mt-3 grid grid-cols-2 gap-3">{(['material', 'look', 'finish', 'manufacturer', 'room'] as const).map(key =>
      <label key={key} className="min-w-0 text-xs">{{ material: 'Material', look: 'Look / style', finish: 'Finish', manufacturer: 'Manufacturer', room: 'Room suitability' }[key]}
        <select value={filters[key] ?? ''} onChange={e => onChange({ ...filters, [key]: e.target.value })} aria-label={`Flooring ${key} filter`} className="mt-1 w-full border border-line bg-bg p-2 text-sm">
          <option value="">All</option>{facets[key].map(value => <option key={value}>{value}</option>)}
        </select></label>)}</div>
    <div className="mt-3 flex items-center justify-between text-xs text-ink-dim"><span>{count} catalogue options</span><button type="button" onClick={() => onChange({})} className="underline">Clear filters</button></div>
    <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">Room recommendations are indicative. Confirm wet-slip ratings and supplier availability before buying.</p>
  </fieldset>
}
