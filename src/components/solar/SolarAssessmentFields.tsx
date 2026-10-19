import { translate as t, useLanguage } from '@/lib/i18n/index.ts'
import type { SolarConfiguration } from '@/lib/model/solar.ts'
import { solarPanelSpecificationKey } from '@/lib/model/solar.ts'
import type { SolarAssessmentInputs } from '@/lib/solar/assessmentInputs.ts'

const field = 'mt-2 block w-full min-w-0 rounded-md border border-line bg-bg px-3 py-2.5 text-sm text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'
type Electrical = SolarAssessmentInputs['electrical']
type Energy = SolarAssessmentInputs['energy']
const electricalNumbers: [keyof Electrical, string, number, number][] = [
  ['moduleVocV', 'Module Voc (V)', 1, 200], ['moduleVmpV', 'Module Vmp (V)', 1, 200], ['moduleIscA', 'Module Isc (A)', .01, 100], ['moduleImpA', 'Module Imp (A)', .01, 100],
  ['vocCoefficientPctPerC', 'Voc temperature coefficient (%/°C)', -2, 0], ['vmpCoefficientPctPerC', 'Vmp temperature coefficient (%/°C)', -2, 0],
  ['minimumCellC', 'Minimum design cell temperature (°C)', -60, 25], ['maximumCellC', 'Maximum design cell temperature (°C)', 25, 120],
  ['modulesPerString', 'Modules per string', 1, 100], ['parallelStrings', 'Parallel strings (one MPPT)', 1, 100],
  ['inverterAcKw', 'Inverter AC rating (kW)', .1, 1000], ['inverterMaxDcKwp', 'Inverter maximum DC capacity (kWp)', .1, 2000],
  ['inverterMaxVocV', 'Inverter maximum DC voltage (V)', 1, 2000], ['inverterMpptMinV', 'MPPT minimum voltage (V)', 1, 2000], ['inverterMpptMaxV', 'MPPT maximum voltage (V)', 1, 2000],
  ['inverterStartV', 'Inverter start voltage (V)', 1, 2000], ['inverterMaxInputA', 'MPPT maximum input current (A)', .01, 1000], ['inverterMaxShortCircuitA', 'MPPT maximum short-circuit current (A)', .01, 1000],
]
const energyNumbers: [keyof Energy, string, number, number][] = [
  ['latitudeDeg', 'Resource latitude (°)', -90, 90], ['longitudeDeg', 'Resource longitude (°)', -180, 180], ['trueAzimuthDeg', 'Resource true azimuth (° clockwise from north)', 0, 359.999], ['tiltDeg', 'Resource tilt (°)', 0, 90],
  ['annualPoaLowKwhM2', 'Annual POA irradiation low (kWh/m²/year)', 1, 4000], ['annualPoaHighKwhM2', 'Annual POA irradiation high (kWh/m²/year)', 1, 4000],
  ['nonShadingPrLow', 'Non-shading performance factor low (0–1)', .01, 1], ['nonShadingPrHigh', 'Non-shading performance factor high (0–1)', .01, 1],
  ['shadingLossLow', 'Shading loss low (0–1)', 0, 1], ['shadingLossHigh', 'Shading loss high (0–1)', 0, 1],
]
export function SolarAssessmentFields({ solar, hasLegacy, onEdit }: { solar: SolarConfiguration; hasLegacy: boolean; onEdit: (recipe: (solar: SolarConfiguration) => void) => void }) {
  useLanguage(s => s.language)
  const a = solar.assessmentInputs
  const numeric = (group: 'electrical' | 'energy', key: string, label: string, min: number, max: number) => <label key={key} className="block min-w-0 text-xs text-ink-dim">{t(label)}<input aria-label={t(label)} className={field} type="number" step="any" min={min} max={max} value={(a[group] as unknown as Record<string, number | null>)[key] ?? ''} onChange={e => onEdit(s => { (s.assessmentInputs[group] as unknown as Record<string, number | null>)[key] = e.target.value === '' ? null : Number(e.target.value) })}/></label>
  const text = (group: 'electrical' | 'energy', key: string, label: string, type = 'text') => <label key={key} className="block min-w-0 text-xs text-ink-dim">{t(label)}<input aria-label={t(label)} className={field} type={type} maxLength={type === 'url' ? 2000 : 1000} value={(a[group] as unknown as Record<string, string | null>)[key] ?? ''} onChange={e => onEdit(s => { (s.assessmentInputs[group] as unknown as Record<string, string | null>)[key] = e.target.value.trim() ? e.target.value : null })}/></label>
  return <div className="mt-5 space-y-5">
    <label className="block text-xs text-ink-dim">{t('What should solar help with?')}<select aria-label={t('What should solar help with?')} className={field} value={a.objective} onChange={e => onEdit(s => { s.assessmentInputs.objective = e.target.value as SolarAssessmentInputs['objective'] })}>{([['unknown', 'Goal not decided'], ['bill-savings', 'Lower electricity bills'], ['outage-backup', 'Outage backup'], ['both', 'Savings and outage backup']] as const).map(([value, label]) => <option value={value} key={value}>{t(label)}</option>)}</select></label>
    {['both', 'outage-backup'].includes(a.objective) && <p role="status" className="rounded-lg bg-bg-inset p-3 text-xs leading-relaxed text-ink-dim">{t('Ordinary grid-connected solar switches off during a grid outage. Hybrid, battery and critical-load design are not implemented or priced. This estimate does not provide outage backup.')}</p>}
    {hasLegacy && <label className="block text-xs text-ink-dim">{t('Historical solar allowance')}<select aria-label={t('Historical solar allowance')} value={a.legacyAllowance} className={field} onChange={e => onEdit(s => { s.assessmentInputs.legacyAllowance = e.target.value as SolarAssessmentInputs['legacyAllowance'] })}><option value="preserve">{t('Preserve while undecided')}</option><option value="exclude">{t('Exclude legacy allowance')}</option></select><p className="mt-2">{t('An applied system replaces the old allowance. Reservation and removal do not charge it.')}</p></label>}
    <details className="border-y border-line py-4"><summary className="cursor-pointer text-sm">{t('Installer data · inverter compatibility')}</summary><p className="mt-3 text-xs leading-relaxed text-ink-dim">{t('Optional datasheet inputs. Until all checks pass, the BOQ carries an inverter allowance, not a compatible product claim. Single inverter and single MPPT only; installer verification remains required.')}</p><div className="mt-4 grid gap-4 sm:grid-cols-2">
      {text('electrical', 'moduleSource', 'Module datasheet URL', 'url')}{text('electrical', 'inverterSource', 'Inverter datasheet URL', 'url')}{text('electrical', 'inverterName', 'Inverter model / revision')}
      <div className="text-xs text-ink-dim"><p>{t('Electrical data module reference')}: {a.electrical.panelSpecificationKey ?? t('Unknown')}</p><button className="mt-3 underline disabled:opacity-50" type="button" disabled={!solar.inputs.panel} onClick={() => onEdit(s => { if (s.inputs.panel) s.assessmentInputs.electrical.panelSpecificationKey = solarPanelSpecificationKey(s.inputs.panel) })}>{t('Link datasheet inputs to this module')}</button></div>
      {(['supplyPhase', 'inverterPhase'] as const).map(key => <label key={key} className="text-xs text-ink-dim">{t(key === 'supplyPhase' ? 'House supply phase' : 'Inverter phase')}<select aria-label={t(key === 'supplyPhase' ? 'House supply phase' : 'Inverter phase')} className={field} value={a.electrical[key]} onChange={e => onEdit(s => { s.assessmentInputs.electrical[key] = e.target.value as Electrical['supplyPhase'] })}><option value="unknown">{t('Unknown')}</option><option value="single">{t('Single phase')}</option><option value="three">{t('Three phase')}</option></select></label>)}
      {electricalNumbers.map(([key, label, min, max]) => numeric('electrical', key, label, min, max))}
    </div></details>
    <details className="border-b border-line pb-4"><summary className="cursor-pointer text-sm">{t('Energy resource and loss basis (optional)')}</summary><p className="mt-3 text-xs leading-relaxed text-ink-dim">{t('Use a sourced annual plane-of-array irradiation range for the actual location, azimuth and tilt. The performance factor must exclude shading, which is entered separately. Unknown data stays blank; the model will report insufficient information.')}</p><div className="mt-4 grid gap-4 sm:grid-cols-2">
      {text('energy', 'sourceUrl', 'Irradiation source URL', 'url')}{text('energy', 'referencePeriod', 'Resource reference period')}{text('energy', 'weatherBasis', 'Weather and uncertainty assumptions')}
      {energyNumbers.map(([key, label, min, max]) => numeric('energy', key, label, min, max))}
      {numericLocation(solar, onEdit)}
    </div></details>
  </div>
}
function numericLocation(solar: SolarConfiguration, onEdit: (recipe: (solar: SolarConfiguration) => void) => void) {
  return (['latitudeDeg', 'longitudeDeg'] as const).map(key => <label key={`project-${key}`} className="text-xs text-ink-dim">{t(key === 'latitudeDeg' ? 'Project latitude (°)' : 'Project longitude (°)')}<input type="number" aria-label={t(key === 'latitudeDeg' ? 'Project latitude (°)' : 'Project longitude (°)')} step="any" min={key === 'latitudeDeg' ? -90 : -180} max={key === 'latitudeDeg' ? 90 : 180} className={field} value={solar.inputs.location[key] ?? ''} onChange={e => onEdit(s => { s.inputs.location[key] = e.target.value === '' ? null : Number(e.target.value) })}/></label>)
}
