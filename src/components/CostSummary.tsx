import { translate as translateUi, useLanguage } from '@/lib/i18n/index.ts'
import type { CostEstimate } from '@/lib/cost/index.ts'
import { formatINR, formatRange } from '@/lib/format.ts'

export function CostSummary({ cost }: { cost: CostEstimate }) {
  useLanguage(s => s.language);

  return <section aria-label={translateUi("Concept cost estimate")}>
    <p className="text-xs text-ink-dim">{translateUi(cost.label)}</p>
    <div className="mt-3 border-y border-line py-5">
      <p className="label">{translateUi("Estimated total")}</p>
      <p className="mt-2 font-display text-3xl tnum">{translateUi(formatINR(cost.expected))}</p>
      <p className="mt-2 text-sm text-ink-dim">{translateUi("Concept range ")}{translateUi(formatRange(cost.total.low, cost.total.high, formatINR))}</p>
      <p className="mt-2 text-xs text-ink-dim">{translateUi(formatINR(cost.ratePerSqft))} {translateUi(" / sq ft · includes project allowances")}</p>
      <p className="mt-3 max-w-2xl text-xs leading-relaxed text-ink-faint">{translateUi(cost.qualification)}</p>
    </div>
    <dl className="mt-4 divide-y divide-line">
      {cost.lines.map(line => <div key={line.label} className="flex items-baseline justify-between gap-4 py-3 text-sm">
        <div><dt>{translateUi(line.label)}</dt><dd className="mt-1 text-xs text-ink-faint">{translateUi(line.note)}</dd></div>
        <dd className="shrink-0 font-mono text-xs tnum">{translateUi(formatINR(line.expected))}</dd>
      </div>)}
    </dl>
    <details className="mt-4 border-t border-line pt-4 text-sm">
      <summary className="cursor-pointer">{translateUi("Cost by trade & material / labour split")}</summary>
      <dl className="mt-3 divide-y divide-line">{cost.tradeTotals.map(t => <div key={t.trade} className="flex justify-between gap-3 py-2 text-xs">
        <dt>{translateUi(t.trade)} <span className="text-ink-faint">{translateUi((t.share * 100).toFixed(1))}%</span></dt><dd className="shrink-0 tnum">{translateUi(formatINR(t.amount))}</dd>
      </div>)}</dl>
      <p className="mt-3 text-xs text-ink-dim">{translateUi("Shares are of works before add-ons.")}</p>
      <dl className="mt-3 space-y-2 text-xs">
        <div className="flex justify-between gap-3"><dt>{translateUi("Materials")}</dt><dd>{translateUi(formatINR(cost.procurement.material))}</dd></div>
        <div className="flex justify-between gap-3"><dt>{translateUi("Labour")}</dt><dd>{translateUi(formatINR(cost.procurement.labour))}</dd></div>
        <div className="flex justify-between gap-3"><dt>{translateUi("Turnkey works, including overhead")}</dt><dd>{translateUi(formatINR(cost.procurement.turnkey))}</dd></div>
      </dl><p className="mt-3 text-xs leading-relaxed text-ink-faint">{translateUi(cost.procurement.note)} {translateUi(" Supply and labour splits are approximate.")}</p>
    </details>
    <details className="mt-4 border-t border-line pt-4 text-sm">
      <summary className="cursor-pointer">{translateUi("Largest costs & changes from the finish preset")}</summary>
      <p className="mt-3 text-xs text-ink-dim">{translateUi("Same plan and finish level, before your finish overrides. Default total ")}{translateUi(formatINR(cost.defaultExpected))}.</p>
      <dl className="mt-3 space-y-3 text-xs">{cost.topCostDrivers.map(d => <div key={d.item}>
        <dt>{translateUi(d.label)}</dt><dd className="mt-1 text-ink-dim">{translateUi(formatINR(d.amount))} · {translateUi(d.difference ? `${d.difference > 0 ? '+' : '−'}${formatINR(Math.abs(d.difference))} from preset` : 'Matches preset')}</dd>
      </div>)}</dl>
    </details>
    <details className="mt-4 border-t border-line pt-4 text-sm">
      <summary className="cursor-pointer">{translateUi("What’s included & assumptions")}</summary>
      <p className="mt-3 text-xs text-ink-dim">{translateUi(cost.basis)}</p>
      <div className="mt-4 grid gap-5 text-xs leading-relaxed sm:grid-cols-2">
        <div><h3 className="label">{translateUi("Included")}</h3><ul className="mt-2 space-y-2">{cost.included.map(t => <li key={t}>{translateUi(t)}</li>)}</ul></div>
        <div><h3 className="label">{translateUi("Excluded")}</h3><ul className="mt-2 space-y-2">{cost.excluded.map(t => <li key={t}>{translateUi(t)}</li>)}</ul></div>
      </div>
      <ul className="mt-4 space-y-2 text-xs text-ink-dim">{cost.assumptions.map(t => <li key={t}>{translateUi(t)}</li>)}</ul>
      {cost.sanityNote && <p className="mt-3 text-xs text-ink-dim">{translateUi(cost.sanityNote)}</p>}
      <p className="mt-3 text-xs text-ink-faint">{translateUi(cost.sources.join(' · '))}</p>
    </details>
  </section>
}

export function BoqTable({ cost }: { cost: CostEstimate }) {
  useLanguage(s => s.language);

  return <div className="mt-3 overflow-x-auto">
    <table className="w-full min-w-[640px] text-sm">
      <caption className="mb-3 text-left text-xs text-ink-dim">{translateUi(cost.label)}</caption>
      <thead><tr className="border-b border-line text-left label"><th className="py-3">{translateUi("Work / specification")}</th><th>{translateUi("Quantity")}</th><th>{translateUi("Rate")}</th><th className="text-right">{translateUi("Amount")}</th></tr></thead>
      <tbody>{cost.boq.map(l => <tr key={l.id} className="border-b border-line">
        <td className="py-3 pr-4">{translateUi(l.label)}<div className="mt-1 max-w-md text-xs text-ink-faint">{translateUi(l.group)} · {translateUi(l.specification)}</div>{l.note && <div className="mt-1 max-w-md text-xs text-ink-faint">{translateUi(l.note)}</div>}</td>
        <td className="pr-4 font-mono text-xs tnum">{translateUi(l.quantity.toFixed(2))} {translateUi(l.unit)}</td>
        <td className="pr-4 font-mono text-xs tnum">{translateUi(formatINR(l.rate))} / {translateUi(l.unit)}</td>
        <td className="text-right font-mono text-xs tnum">{translateUi(formatINR(l.amount))}</td>
      </tr>)}</tbody>
      <tfoot><tr><td colSpan={3} className="py-3">{translateUi("Works before overhead, fees, contingency and GST")}</td><td className="text-right font-mono text-xs">{translateUi(formatINR(cost.lines[0].expected))}</td></tr></tfoot>
    </table>
  </div>
}
