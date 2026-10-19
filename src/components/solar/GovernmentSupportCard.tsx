import { translate as t, useLanguage } from '@/lib/i18n/index.ts'
import type { SolarConfiguration } from '@/lib/model/solar.ts'
import { assessGovernmentSupport, governmentSchemeRules as rules, INDIAN_STATES, supportInputsForSolar, type SupportReason } from '@/lib/solar/governmentSupport.ts'
import type { GovernmentSupportInputs } from '@/lib/solar/governmentSupportInputs.ts'
import { formatINR } from '@/lib/format.ts'

const field = 'mt-2 block w-full min-w-0 rounded-md border border-line bg-bg px-3 py-2.5 text-sm text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'
const link = 'inline-flex min-h-10 items-center rounded-md border border-line px-3 py-2 text-xs underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'
const statusLabels = { unknown: 'Eligibility unknown · unverified', 'potentially-eligible': 'Potentially eligible · unverified', inapplicable: 'Appears inapplicable for these answers', 'outdated-information': 'Rules need rechecking' } as const
const reasons: Record<SupportReason, string> = {
  outdated: 'This rules snapshot needs a fresh official check. Assistance figures are hidden; use the official portal for current terms.',
  location: 'This central scheme is for eligible installations in India.',
  'state-conflict': 'The scheme state and saved project state disagree. Confirm the location before relying on financial guidance.',
  'non-residential': 'This residential CFA component excludes commercial, industrial and government consumers.',
  'no-grid': 'This component requires an eligible residential grid connection. An off-grid plan needs a different assessment.',
  'no-permission': 'Confirm the right or permission to use the roof before proceeding.',
  'non-dcr': 'Known non-DCR equipment does not qualify for this CFA. Ask a registered vendor about a compliant alternative.',
  relocated: 'Relocating an already installed system does not create a new CFA entitlement.',
  'prior-support': 'Earlier assistance and expansion need an incremental-capacity review. A fresh maximum cannot be assumed.',
  'model-scope': 'Third-party or utility-owned systems need separate RESCO / utility-led scheme guidance.',
  'missing-basic-inputs': 'Basic applicability details are still unknown. Open the optional self-check or continue on the official portal.',
  'association-review': 'Housing-association common facilities have separate capacity limits. Confirm the connection and existing individual systems on the official portal.',
  'preliminary-only': 'Your answers suggest the consumer may fit the basic scope. Equipment, documents, approvals and the claim still need official checks.',
}
const journey = [
  ['Assessment', 'Ask an installer to assess roof access, shading, structure, electrical supply and a suitable system size.'],
  ['Official application', 'Apply on the National Portal and follow the applicable DISCOM approval or auto-approval process before installation.'],
  ['Registered vendor', 'Choose a vendor registered on the National Portal and agree on equipment, scope, price and maintenance.'],
  ['Installation', 'The vendor installs eligible equipment with the required electrical and structural protections.'],
  ['Metering and commissioning', 'Complete the applicable meter, inspection, grid-connection and commissioning steps with your DISCOM.'],
  ['Subsidy claim', 'Complete the official claim after the required checks. Approval, payment amount and timing are not guaranteed.'],
] as const
const components = [
  ['Panels', 'Turn sunlight into DC electricity; their rated DC power sets the scheme capacity basis.'],
  ['Mounting', 'Holds panels above the roof and must suit its structure, wind exposure and maintenance access.'],
  ['Inverter', 'Converts DC electricity into AC for the home and must meet applicable equipment and grid requirements.'],
  ['Wiring and protection', 'Cables, isolators, protective devices and earthing connect equipment and help protect people and circuits.'],
  ['Grid connection', 'Approved metering and connection link the system to the electricity network; ordinary on-grid PV does not provide outage backup.'],
] as const

export function GovernmentSupportCard({ solar, onEdit }: { solar: SolarConfiguration; onEdit: (recipe: (solar: SolarConfiguration) => void) => void }) {
  useLanguage(s => s.language)
  const inputs = supportInputsForSolar(solar), assessment = assessGovernmentSupport(inputs, undefined, rules, solar.inputs.location.stateCode)
  const set = <K extends keyof GovernmentSupportInputs>(key: K, value: GovernmentSupportInputs[K]) => onEdit(next => { next.assessmentInputs.governmentSupport[key] = value })
  const select = (label: string, key: keyof GovernmentSupportInputs, choices: readonly (readonly [string, string])[]) => <label key={key} className="block min-w-0 text-xs text-ink-dim">{t(label)}<select aria-label={t(label)} className={field} value={String(inputs[key] ?? '')} onChange={e => set(key, e.target.value as GovernmentSupportInputs[typeof key])}>{choices.map(([value, name]) => <option key={value} value={value}>{t(name)}</option>)}</select></label>
  const yesNo = [['unknown', 'Unknown'], ['yes', 'Yes'], ['no', 'No']] as const
  const bands = assessment.rateCategory ? [assessment.rateCategory] as const : ['general', 'special'] as const
  return <section aria-label={t('Government support')} className="my-5 rounded-xl border border-line bg-bg p-4 sm:p-5">
    <div className="flex flex-wrap items-start justify-between gap-2"><div><p className="label">{t('Government support')}</p><h3 className="mt-2 font-display text-xl">PM Surya Ghar</h3></div><p role="status" className="rounded-full border border-line px-3 py-1.5 text-xs">{t(statusLabels[assessment.state])}</p></div>
    <p className="mt-3 text-xs leading-relaxed text-ink-dim">{t(reasons[assessment.reasons[0]])}</p>
    <p className="mt-2 text-xs text-ink-faint">{t('Preliminary self-check only. Eligibility remains unverified; this is not official approval.')}</p>
    <div className="mt-4 flex flex-wrap gap-2"><a className={link} href={rules.applyUrl} target="_blank" rel="noopener noreferrer">{t('Apply / check eligibility ↗')}</a>
      {assessment.showMsedcl && <a className={link} href={rules.msedclGuidance.url} target="_blank" rel="noopener noreferrer">{t(assessment.msedclConditional ? 'MSEDCL guidance · if this is your supplier ↗' : 'Maharashtra · MSEDCL guidance ↗')}</a>}
    </div>
    <p className="mt-3 text-xs text-ink-faint">{t('Central assistance stays separate from project cost. State support is not assessed or added.')}</p>
    <details className="mt-4 border-t border-line pt-3"><summary className="cursor-pointer text-sm">{t('Scheme details and installation guide')}</summary>
    <details className="mt-4 border-t border-line pt-3"><summary className="cursor-pointer text-sm">{t('Published central assistance and conditions')}</summary>
      {assessment.showFinancialGuidance ? <div className="mt-3 space-y-3 text-xs leading-relaxed text-ink-dim">
        <p>{t('Reference rates only, not a personal award or a deduction from your estimate.')}</p>
        <p>{t('These rates cover consumer-owned CAPEX systems, including systems financed with a loan. Third-party and utility-owned models need separate guidance.')}</p>
        {inputs.consumer === 'housing-association' ? <p>{t('Common facilities (GHS/RWA)')}: {formatINR(assessment.rateCategory === 'special' ? rules.association.specialInrPerKwp : rules.association.generalInrPerKwp)}/kWp{!assessment.rateCategory && <> {t('(general states; special-state rate)')} {formatINR(rules.association.specialInrPerKwp)}/kWp</>}. {t('Supported common-facility capacity is limited to 500 kWp and 3 kWp per dwelling, including individual systems within that limit. Confirm the eligible balance.')}</p> : <>
          <p className="font-medium text-ink">{t('Individual residential systems')}</p><div className="overflow-x-auto"><table className="w-full min-w-[410px] border-collapse text-left"><caption className="sr-only">{t('Published central assistance rates')}</caption><thead><tr className="border-b border-line"><th scope="col" className="py-2 pr-3 font-medium">{t('State category')}</th><th scope="col" className="py-2 pr-3 font-medium">{t('First 2 kWp / kWp')}</th><th scope="col" className="py-2 pr-3 font-medium">{t('Next 1 kWp / kWp')}</th><th scope="col" className="py-2 font-medium">{t('Maximum')}</th></tr></thead><tbody>{bands.map(tier => <tr key={tier} className="border-b border-line"><th scope="row" className="py-2 pr-3 font-normal">{t(tier === 'general' ? 'General states' : 'Special-category states / UTs')}</th><td className="py-2 pr-3">{formatINR(rules.individual[tier].firstBandInrPerKwp)}</td><td className="py-2 pr-3">{formatINR(rules.individual[tier].additionalBandInrPerKwp)}</td><td className="py-2">{formatINR(rules.individual[tier].maximumInr)}</td></tr>)}</tbody></table></div>
          <p>{t('Fractional kWp is pro-rata. Capacity above 3 kWp gets no further central assistance. Use eligible installed module DC capacity, not inverter size or a requested design target.')}</p>
        </>}
        <p>{t('Special-category states / UTs')}: {rules.specialCategoryStateCodes.map(code => t(INDIAN_STATES.find(([id]) => id === code)![1])).join(', ')}.</p>
      </div> : <p className="mt-3 text-xs text-ink-dim">{t('Assistance figures are withheld for this assessment. Check the official portal for the applicable rules.')}</p>}
      <p className="mt-3 text-xs leading-relaxed text-ink-dim">{t('CFA requires domestically manufactured modules made with domestically manufactured cells. Ask the vendor to verify DCR, applicable ALMM lists, inverter standards and current technical rules. An illustrative panel is not proof of eligibility.')}</p>
      <p className="mt-3 text-xs leading-relaxed text-ink-dim">{t('Previous subsidy, expansion, relocation and association systems need their own review. No zero bill, subsidy amount or payment date is promised.')}</p>
    </details>
    <details className="mt-4 border-t border-line pt-3"><summary className="cursor-pointer text-sm">{t('Optional applicability self-check')}</summary><p className="mt-3 text-xs text-ink-faint">{t('These are draft choices. Use solar Preview and Apply to save them, or Cancel to discard.')}</p><div className="mt-4 grid gap-4 sm:grid-cols-2">
      {select('Scheme country', 'country', [['unknown', 'Unknown'], ['IN', 'India'], ['other', 'Outside India']])}
      {inputs.country === 'IN' && <label className="block min-w-0 text-xs text-ink-dim">{t('Scheme state / UT')}<select aria-label={t('Scheme state / UT')} className={field} value={inputs.stateCode ?? ''} onChange={e => set('stateCode', e.target.value || null)}><option value="">{t('Unknown')}</option>{INDIAN_STATES.map(([code, name]) => <option key={code} value={code}>{t(name)}</option>)}</select></label>}
      {inputs.country === 'IN' && inputs.stateCode === 'MH' && select('Electricity distributor', 'discom', [['unknown', 'Unknown'], ['MSEDCL', 'MSEDCL / Mahavitaran'], ['other', 'Another distributor']])}
      {select('Consumer category', 'consumer', [['unknown', 'Unknown'], ['individual-residential', 'Individual residential'], ['housing-association', 'Housing association common facilities'], ['non-residential', 'Commercial / industrial / government']])}
      {select('Who will own the system?', 'ownership', [['unknown', 'Unknown'], ['consumer-owned', 'You own it (own funds or loan)'], ['third-party', 'Third party / utility owns it']])}
      {select('Residential grid-connected electricity connection?', 'gridConnection', yesNo)}{select('Right or permission to use the roof?', 'roofPermission', yesNo)}{select('Previous rooftop solar assistance?', 'previousCfa', yesNo)}
      {select('Installation situation', 'installation', [['unknown', 'Unknown'], ['new', 'New installation'], ['expansion', 'Expanding an existing system'], ['relocated', 'Relocating an installed system']])}
      {select('Equipment eligibility evidence', 'equipment', [['unknown', 'Unknown'], ['vendor-review', 'Registered vendor review pending'], ['non-dcr', 'Known non-DCR equipment']])}
    </div></details>
    <details className="mt-4 border-t border-line pt-3"><summary className="cursor-pointer text-sm">{t('How installation and the claim work')}</summary><ol className="mt-4 list-decimal space-y-3 pl-5 text-xs leading-relaxed text-ink-dim">{journey.map(([title, description]) => <li key={title}><strong className="font-medium text-ink">{t(title)}.</strong> {t(description)}</li>)}</ol></details>
    <details className="mt-4 border-t border-line pt-3"><summary className="cursor-pointer text-sm">{t('What the equipment does')}</summary><dl className="mt-4 grid gap-3 text-xs leading-relaxed text-ink-dim sm:grid-cols-2">{components.map(([title, description]) => <div key={title}><dt className="font-medium text-ink">{t(title)}</dt><dd className="mt-1">{t(description)}</dd></div>)}</dl></details>
    <details className="mt-4 border-t border-line pt-3"><summary className="cursor-pointer text-xs">{t('Official sources')}</summary><ul className="mt-3 space-y-2 text-xs">{rules.sources.filter(s => s.id !== 'msedcl' || assessment.showMsedcl).map(source => <li key={source.id}><a className="break-words underline underline-offset-4" href={source.url} target="_blank" rel="noopener noreferrer">{source.label} ↗</a></li>)}</ul><p className="mt-3 text-xs text-ink-faint">{t('This snapshot is marked outdated after 90 days or the published scheme period, whichever comes first. Official changes can happen sooner.')}</p></details>
    <p className="mt-4 text-xs leading-relaxed text-ink-faint">{t('Formstead is an independent planning app, not a government service. This card does not collect Aadhaar, bank details or portal credentials. Provide those only on official sites.')}</p>
    </details>
    <p className="mt-3 text-xs text-ink-faint">{t('Official sources checked')}: {rules.verifiedOn}. {t('Independent planning guidance · not a government service.')}</p>
  </section>
}
