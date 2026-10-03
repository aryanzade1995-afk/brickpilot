import type { CostEstimate } from '@/lib/cost/index.ts'
import { formatINR, formatRange } from '@/lib/format.ts'

export function CostSummary({ cost }: { cost: CostEstimate }) {
  return <section aria-label="Concept cost estimate">
    <p className="text-xs text-ink-dim">{cost.label}</p>
    <div className="mt-3 border-y border-line py-5">
      <p className="label">Estimated total</p>
      <p className="mt-2 font-display text-3xl tnum">{formatINR(cost.expected)}</p>
      <p className="mt-2 text-sm text-ink-dim">Concept range {formatRange(cost.total.low, cost.total.high, formatINR)}</p>
      <p className="mt-3 max-w-2xl text-xs leading-relaxed text-ink-faint">{cost.qualification}</p>
    </div>
    <dl className="mt-4 divide-y divide-line">
      {cost.lines.map(line => <div key={line.label} className="flex items-baseline justify-between gap-4 py-3 text-sm">
        <div><dt>{line.label}</dt><dd className="mt-1 text-xs text-ink-faint">{line.note}</dd></div>
        <dd className="shrink-0 font-mono text-xs tnum">{formatINR(line.expected)}</dd>
      </div>)}
    </dl>
    <details className="mt-4 border-t border-line pt-4 text-sm">
      <summary className="cursor-pointer">What’s included & assumptions</summary>
      <p className="mt-3 text-xs text-ink-dim">{cost.basis}</p>
      <div className="mt-4 grid gap-5 text-xs leading-relaxed sm:grid-cols-2">
        <div><h3 className="label">Included</h3><ul className="mt-2 space-y-2">{cost.included.map(t => <li key={t}>{t}</li>)}</ul></div>
        <div><h3 className="label">Excluded</h3><ul className="mt-2 space-y-2">{cost.excluded.map(t => <li key={t}>{t}</li>)}</ul></div>
      </div>
      <ul className="mt-4 space-y-2 text-xs text-ink-dim">{cost.quantities.assumptions.map(t => <li key={t}>{t}</li>)}</ul>
      {cost.sanityNote && <p className="mt-3 text-xs text-ink-dim">{cost.sanityNote}</p>}
      <p className="mt-3 text-xs text-ink-faint">{cost.sources.join(' · ')}</p>
    </details>
  </section>
}

export function BoqTable({ cost }: { cost: CostEstimate }) {
  return <div className="mt-3 overflow-x-auto">
    <table className="w-full min-w-[640px] text-sm">
      <caption className="mb-3 text-left text-xs text-ink-dim">{cost.label}</caption>
      <thead><tr className="border-b border-line text-left label"><th className="py-3">Work / specification</th><th>Quantity</th><th>Rate</th><th className="text-right">Amount</th></tr></thead>
      <tbody>{cost.boq.map(l => <tr key={l.id} className="border-b border-line">
        <td className="py-3 pr-4">{l.label}<div className="mt-1 max-w-md text-xs text-ink-faint">{l.group} · {l.specification}</div></td>
        <td className="pr-4 font-mono text-xs tnum">{l.quantity.toFixed(2)} {l.unit}</td>
        <td className="pr-4 font-mono text-xs tnum">{formatINR(l.rate)} / {l.unit}</td>
        <td className="text-right font-mono text-xs tnum">{formatINR(l.amount)}</td>
      </tr>)}</tbody>
      <tfoot><tr><td colSpan={3} className="py-3">Works before overhead, fees, contingency and GST</td><td className="text-right font-mono text-xs">{formatINR(cost.lines[0].expected)}</td></tr></tfoot>
    </table>
  </div>
}
