import { translate as t, useLanguage } from '@/lib/i18n/index.ts'
import { formatINR } from '@/lib/format.ts'
import type { SolarEstimate } from '@/lib/solar/estimate.ts'

const states = { applied: 'Applied solar BOQ', 'needs-review': 'Solar layout needs review', 'not-included': 'Solar not included', undecided: 'Solar undecided', 'reservation-only': 'Space reserved only', 'legacy-allowance': 'Legacy solar allowance' } as const
const objectives = { unknown: 'Goal not decided', 'bill-savings': 'Lower electricity bills', 'outage-backup': 'Outage backup', both: 'Savings and outage backup' } as const
export function SolarEstimateSummary({ solar }: { solar?: SolarEstimate }) {
  useLanguage(s => s.language)
  if (!solar) return null
  return <section aria-label={t('Solar cost and energy')} className="my-6 rounded-xl border border-line bg-bg p-4 sm:p-5">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-display text-xl">{t(states[solar.status])}</h3><p className="mt-2 text-xs text-ink-dim">{t(objectives[solar.objective])}</p></div><p className="text-sm">{solar.panelCount} {t('panels')} · {solar.capacityKwp} kWp</p></div>
    <dl className="mt-5 grid gap-4 sm:grid-cols-2"><div><dt className="text-xs text-ink-dim">{t('Gross solar installation')}</dt><dd className="mt-1 text-lg">{formatINR(solar.grossInstallationCost)}</dd><p className="mt-1 text-xs text-ink-faint">{t('Direct solar subtotal before shared project add-ons and unconfirmed tax.')}</p></div><div><dt className="text-xs text-ink-dim">{t('Potential government assistance')}</dt><dd className="mt-1 text-sm">{t('Unverified · ₹0 deducted')}</dd><a href={solar.assistance.url} target="_blank" rel="noreferrer" className="mt-2 inline-block text-xs underline">{t('Check PM Surya Ghar eligibility ↗')}</a></div></dl>
    {solar.status === 'legacy-allowance' && <p className="mt-4 text-sm">{t('Historical allowance, not installed panels')}: {formatINR(solar.legacyAllowanceCost)}</p>}
    {solar.status === 'applied' && <p className="mt-4 text-xs text-ink-dim">{t(solar.inverter.state === 'concept-compatible' ? 'Inverter: concept compatibility checks passed' : solar.inverter.state === 'incompatible' ? 'Inverter: incompatible data · selection pending' : 'Inverter: allowance only · compatibility pending')}</p>}
    {solar.status === 'applied' && <p className="mt-2 text-xs text-ink-faint">{t('Internal solar concept allowances · Pune · 19 Oct 2026. Confirm with an installer quotation.')}</p>}
    {solar.backup === 'pending' && <div className="mt-4 border-l-2 border-accent pl-3"><p className="text-sm">{t('Backup configuration pending')}</p><p className="mt-2 text-xs leading-relaxed text-ink-dim">{t('Ordinary grid-connected solar switches off during a grid outage. Hybrid, battery and critical-load design are not implemented or priced. This estimate does not provide outage backup.')}</p></div>}
    <div className="mt-5 border-t border-line pt-4"><p className="text-sm">{t('Preliminary annual solar energy')}</p><p className="mt-2 text-sm">{solar.energy.annualKwh ? `${solar.energy.annualKwh.low.toLocaleString('en-IN')}–${solar.energy.annualKwh.high.toLocaleString('en-IN')} kWh/year` : t(solar.energy.state === 'not-applicable' ? 'No installed energy claim' : 'Insufficient information')}</p>
      <p className="mt-2 text-xs text-ink-dim">{t('A monthly rupee bill is not electricity consumption in kWh. No bill savings or payback is calculated.')}</p>
      {solar.energy.annualConsumptionKwh !== null && <p className="mt-2 text-xs text-ink-dim">{t('User consumption basis (12 × monthly kWh)')}: {solar.energy.annualConsumptionKwh.toLocaleString('en-IN')} kWh/year</p>}
      <p className="mt-2 text-xs text-ink-faint">{t('The 3D shadow preview is decorative, not a validated shading or energy analysis.')}</p>
    </div>
    {solar.delivery && <p className="mt-3 text-xs text-ink-dim">{t('Solar layout status')}: {t(solar.delivery.layoutStatus)} · {t('Reserved areas')}: {solar.delivery.reservedAreaCount}</p>}
    <details className="mt-4 text-xs"><summary className="cursor-pointer">{t('Solar basis, inclusions and exclusions')}</summary><div className="mt-3 space-y-3 break-words leading-relaxed text-ink-dim">{[...solar.notes, ...solar.inverter.reasons, ...solar.energy.reasons, ...solar.energy.basis, ...solar.inclusions, ...solar.exclusions, ...(solar.delivery?.assumptions ?? []), ...solar.sources].map((line, i) => <p key={i}>{t(line)}</p>)}</div></details>
  </section>
}
