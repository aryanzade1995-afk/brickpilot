import type { SpecificationRow } from '@/lib/cost/schedule.ts'
import { assetUrl } from '@/lib/cost/workspace.ts'

export function SpecificationSchedule({ rows }: { rows: SpecificationRow[] }) {
  const locations = [...new Set(rows.map(r => r.where))]
  return <section><h2 className="font-display text-xl">Specification schedule</h2><p className="mt-2 text-xs text-ink-faint">Real texture close-ups. Confirm actual products and samples with your supplier.</p>
    <div className="mt-4 space-y-5">{locations.map(where => <details key={where} open={where !== 'Whole home'} className="border-b border-line pb-4"><summary className="cursor-pointer font-display text-lg">{where}</summary><ul className="mt-3 divide-y divide-line">{rows.filter(r => r.where === where).map(r => <li key={r.id} className="flex items-start gap-3 py-3">{r.photo && <img loading="lazy" src={assetUrl(r.photo)} alt={`Real texture close-up: ${r.choice}`} className="h-12 w-16 shrink-0 object-cover" />}<div className="min-w-0 text-sm"><p>{r.label}</p><p className="mt-1 text-ink-dim">{r.choice}</p><p className="mt-1 text-xs text-ink-faint">{r.quantity}</p></div></li>)}</ul></details>)}</div>
  </section>
}
