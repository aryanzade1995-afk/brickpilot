import { SolarAssessmentFields } from '@/components/solar/SolarAssessmentFields.tsx'
import { GovernmentSupportCard } from '@/components/solar/GovernmentSupportCard.tsx'
import { SolarEstimateSummary } from '@/components/solar/SolarEstimateSummary.tsx'
import { solarCostSchedule } from '@/lib/solar/estimate.ts'
import { solarConfigurationSignature } from '@/lib/model/solar.ts'
import { useId, useMemo, useState, type ReactNode } from 'react'
import type { Brief } from '@/lib/model/brief.ts'
import type { Design } from '@/lib/engine/types.ts'
import { useStudio } from '@/state/studio.ts'
import { Button } from '@/components/ui/Button.tsx'
import { translate as t, useLanguage } from '@/lib/i18n/index.ts'
import { defaultSolarConfiguration, solarConfigurationSchema, type SolarConfiguration } from '@/lib/model/solar.ts'
import { buildSolarRoofModel } from '@/lib/solar/roofModel.ts'
import { applySolarEditor, previewSolarEditor, solarIssueLabel, type SolarEditorPreview } from '@/lib/solar/editor.ts'
import { solarPanelGeometry, solarLayoutTotals } from '@/lib/solar/placement.ts'
import { rectUnionBBox } from '@/lib/geometry.ts'

const intentionLabels = { undecided: 'Not decided', 'not-included': 'Not included', 'reserve-space': 'Reserve space for later', 'install-now': 'Plan installation now' } as const
const examples = [
  { id: 'concept-450-v1', name: 'Illustrative 450 W module', ratedPowerW: 450, dimensionsMm: { width: 1134, height: 1762, thickness: 35 } },
  { id: 'concept-550-v1', name: 'Illustrative 550 W module', ratedPowerW: 550, dimensionsMm: { width: 1134, height: 2278, thickness: 35 } },
  { id: 'concept-600-v1', name: 'Illustrative 600 W module', ratedPowerW: 600, dimensionsMm: { width: 1134, height: 2382, thickness: 35 } },
]
const fieldClass = 'mt-2 block w-full min-w-0 rounded-md border border-line bg-bg px-3 py-2.5 text-sm text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'
const format = (key: string, ...values: (string | number)[]) => t(key).replace(/\{(\d+)\}/g, (_, index) => String(values[Number(index)]))

export default function SolarServices({ brief, design, onBrief }: { brief: Brief; design: Design; onBrief: (brief: Brief) => void }) {
  const language = useLanguage(s => s.language), live = useStudio(s => s.result)
  const architecture = useMemo(() => live?.design === design && live.buildingModel && live.massingModel && live.facadeModel && live.villaDesignDNA ? {
    buildingModel: live.buildingModel, massingModel: live.massingModel, facadeGrammar: live.facadeModel, villaDesignDNA: live.villaDesignDNA,
  } : undefined, [live, design])
  const [draft, setDraft] = useState(() => structuredClone(brief.solar)), [preview, setPreview] = useState<SolarEditorPreview | null>(null)
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [showErrors, setShowErrors] = useState(false)
  const formId = useId()
  const savedRoof = useMemo(() => buildSolarRoofModel(design, { architecture, inputs: brief.solar.inputs,
    policy: brief.solar.calculated?.layout.schemaVersion === 2 ? brief.solar.calculated.layout.allocationPolicy : undefined }), [design, architecture, brief.solar])
  const roof = preview?.roof ?? savedRoof
  const parsed = solarConfigurationSchema.safeParse({ ...draft, calculated: null })
  const dirty = JSON.stringify({ ...draft, calculated: null }) !== JSON.stringify({ ...brief.solar, calculated: null })
  const edit = (recipe: (next: SolarConfiguration) => void) => {
    setDraft(current => { const next = structuredClone(current); recipe(next); if (solarConfigurationSignature(next) !== solarConfigurationSignature(current)) next.calculated = null; return next })
    setPreview(null); setError(''); setNotice('')
  }
  const invalid = (path: string) => showErrors && !parsed.success && parsed.error.issues.some(issue => issue.path.join('.').startsWith(path))
  const numberField = (label: string, value: number | null, path: string, update: (next: SolarConfiguration, value: number | null) => void, min = 0, max?: number, step: number | 'any' = 'any') =>
    <label className="block min-w-0 text-xs text-ink-dim">{t(label)}<input aria-label={t(label)} type="number" inputMode="decimal" min={min} max={max} step={step} value={value === null || !Number.isFinite(value) ? '' : value}
      aria-invalid={invalid(path)} aria-describedby={invalid(path) ? `${formId}-error` : undefined} className={fieldClass}
      onChange={event => edit(next => update(next, event.target.value === '' ? null : Number(event.target.value)))}/></label>
  const previewNow = () => {
    setShowErrors(true); setNotice('')
    if (!parsed.success) { setError('Check solar inputs, source links and numeric ranges before previewing.'); return }
    try { setPreview(previewSolarEditor(design, { ...draft, calculated: brief.solar.calculated }, architecture)); setError('') }
    catch { setError('Check solar inputs, source links and numeric ranges before previewing.') }
  }
  const apply = () => {
    if (!preview) return
    try {
      const now = buildSolarRoofModel(design, { architecture, inputs: preview.configuration.inputs, policy: preview.roof.policy })
      onBrief(applySolarEditor(brief, preview, now))
    } catch { setError('The roof changed. Preview again before applying.'); setPreview(null) }
  }
  const cancel = () => { setDraft(structuredClone(brief.solar)); setPreview(null); setError(''); setShowErrors(false); setNotice('Draft discarded. Saved solar settings are unchanged.') }
  const reserve = () => {
    try {
      const current = buildSolarRoofModel(design, { architecture, inputs: draft.inputs })
      const candidate = current.surfaces.flatMap(surface => surface.usableRegionsMm.map(rect => ({ surface, rect }))).sort((a, b) => b.rect.w * b.rect.h - a.rect.w * a.rect.h)[0]
      if (!candidate) { setError('No suitable accessible roof area is available.'); return }
      edit(next => { next.inputs.reservedAreas = [...next.inputs.reservedAreas.filter(r => r.id !== 'solar-future-space'), {
        id: 'solar-future-space', label: 'Future solar space', roofSurfaceId: candidate.surface.id, level: candidate.surface.level, rectMm: candidate.rect,
      }] })
    } catch { setError('The roof or settings need review before placement.') }
  }
  const saved = brief.solar.calculated?.layout
  const count = saved?.schemaVersion === 2 ? solarLayoutTotals(saved) : null
  const num = (value: number, digits = 1) => value.toLocaleString(language === 'en' ? 'en-IN' : `${language}-IN`, { maximumFractionDigits: digits })
  const panelChoice = draft.inputs.panel ? examples.some(e => e.id === draft.inputs.panel!.id) ? draft.inputs.panel.id : 'custom' : ''
  const status = preview?.proposal.status
  const statusLabels = { proposed: 'Preview ready', limited: 'Fewer panels fit', 'needs-input': 'More information needed', 'reservation-only': 'Reservation only', 'not-included': 'No solar installation', undecided: 'Undecided preview' } as const
  return <div className="mt-3">
    <p className="max-w-2xl text-sm leading-relaxed text-ink-dim">{t('Add solar now or return later. Preview a terrace arrangement before saving your choices.')}</p>
    <div className="mt-5 rounded-xl border border-line bg-bg p-4 sm:p-5">
      <p className="label">{t('Saved solar settings')}</p><p role="status" className="mt-2 text-sm">{t(intentionLabels[brief.solar.intention])}{count && <> · {format('{0} panels · {1} kWp', num(count.panelCount, 0), num(count.capacityKwp, 3))}</>}</p>
      {saved?.schemaVersion === 2 && saved.validity.state !== 'concept-valid' && <p className="mt-2 text-xs text-ink-dim">{t('Saved layout needs review. Preview to propose a revision.')}</p>}
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Summary label="Available terrace" value={`${num(roof.usableAreaM2)} m²`}/><Summary label="Solar area allowance" value={`${num(roof.maxSolarFootprintAreaM2)} m²`}/><Summary label="Scope" value={t('Whole home')}/>
      </div><p className="mt-3 text-xs leading-relaxed text-ink-faint">{t('Available space excludes roof openings, tanks, furniture, reserved areas and protected access. Suitability still needs installer review.')}</p>
    </div>
    <SolarEstimateSummary solar={solarCostSchedule(design, brief, live ?? undefined).summary}/>
    <GovernmentSupportCard solar={draft} onEdit={edit}/>
    <form noValidate aria-label={t('Rooftop solar settings')} onSubmit={event => { event.preventDefault(); previewNow() }} className="mt-5 rounded-xl border border-line bg-bg p-4 sm:p-5">
      <div className="grid gap-5 sm:grid-cols-2"><label className="block min-w-0 text-xs text-ink-dim">{t('Solar intention')}<select aria-label={t('Solar intention')} value={draft.intention} className={fieldClass} onChange={e => edit(next => { next.intention = e.target.value as SolarConfiguration['intention'] })}>{Object.entries(intentionLabels).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}</select></label>
        {numberField('Monthly electricity use (kWh, optional)', draft.inputs.monthlyConsumptionKwh, 'inputs.monthlyConsumptionKwh', (next, value) => { next.inputs.monthlyConsumptionKwh = value }, 0, 1000000)}
      </div>
      <SolarAssessmentFields solar={draft} hasLegacy={brief.specs.overrides.solar === 'on'} onEdit={edit}/>
      <details className="mt-5 border-y border-line py-4"><summary className="cursor-pointer text-sm">{t('Help me choose')}</summary><p className="mt-3 text-xs leading-relaxed text-ink-dim">{t('Compare draft sizes against the terrace. Final system sizing depends on your electricity use, location and shading; these are exploration targets.')}</p><p className="mt-2 text-xs text-ink-dim">{t('Choosing a target updates only your draft. Select a module to preview fit.')}</p><div className="mt-3 flex flex-wrap gap-2">{[1, 2, 3, 5].map(capacity => <Button type="button" size="sm" variant="ghost" key={capacity} onClick={() => edit(next => { next.intention = 'install-now'; next.inputs.request = { kind: 'capacity', capacityKwp: capacity } })}>{format('Try {0} kWp', capacity)}</Button>)}</div></details>
      {draft.intention === 'reserve-space' && <div className="mt-5 rounded-lg bg-bg-inset p-4"><p className="text-sm">{t('Reserve space without adding installed panels or an installation cost.')}</p><p className="mt-2 text-xs text-ink-dim">{format('{0} reserved areas', draft.inputs.reservedAreas.length)}</p><Button type="button" size="sm" variant="ghost" className="mt-3" onClick={reserve}>{t('Reserve a clear roof rectangle')}</Button>{draft.inputs.reservedAreas.length > 0 && <Button type="button" size="sm" variant="quiet" onClick={() => edit(next => { next.inputs.reservedAreas = [] })}>{t('Clear reserved areas')}</Button>}</div>}
      <fieldset className="mt-5"><legend className="font-display text-lg">{t('Panel specification')}</legend><p className="mt-1 text-xs text-ink-dim">{t('Examples are illustrative. Confirm the dimensions and wattage against your chosen module datasheet.')}</p>
        <label className="mt-4 block text-xs text-ink-dim">{t('Panel choice')}<select aria-label={t('Panel choice')} className={fieldClass} value={panelChoice} onChange={e => edit(next => {
          const example = examples.find(p => p.id === e.target.value)
          next.inputs.panel = example ? { ...structuredClone(example), schemaVersion: 1, revision: 'concept-v1', source: 'illustrative' } : e.target.value === 'custom' ? { schemaVersion: 1, id: 'custom-panel', name: 'Custom panel', revision: 'user-v1', source: 'unknown', dimensionsMm: { width: NaN, height: NaN, thickness: NaN }, ratedPowerW: NaN } : null
        })}><option value="">{t('Choose later')}</option>{examples.map(p => <option key={p.id} value={p.id}>{t(p.name)}</option>)}<option value="custom">{t('Enter module data')}</option></select></label>
        {draft.inputs.panel && <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {numberField('Module width (mm)', draft.inputs.panel.dimensionsMm.width, 'inputs.panel.dimensionsMm.width', (next, v) => { if (next.inputs.panel) { next.inputs.panel.id = 'custom-panel'; next.inputs.panel.source = 'unknown'; next.inputs.panel.dimensionsMm.width = v ?? NaN } }, 1, 10000)}
          {numberField('Module length (mm)', draft.inputs.panel.dimensionsMm.height, 'inputs.panel.dimensionsMm.height', (next, v) => { if (next.inputs.panel) { next.inputs.panel.id = 'custom-panel'; next.inputs.panel.source = 'unknown'; next.inputs.panel.dimensionsMm.height = v ?? NaN } }, 1, 10000)}
          {numberField('Module thickness (mm)', draft.inputs.panel.dimensionsMm.thickness, 'inputs.panel.dimensionsMm.thickness', (next, v) => { if (next.inputs.panel) { next.inputs.panel.id = 'custom-panel'; next.inputs.panel.source = 'unknown'; next.inputs.panel.dimensionsMm.thickness = v ?? NaN } }, 1, 1000)}
          {numberField('Rated module power (W)', draft.inputs.panel.ratedPowerW, 'inputs.panel.ratedPowerW', (next, v) => { if (next.inputs.panel) { next.inputs.panel.id = 'custom-panel'; next.inputs.panel.source = 'unknown'; next.inputs.panel.ratedPowerW = v ?? NaN } }, 1, 10000)}
        </div>}
      </fieldset>
      <fieldset className="mt-6"><legend className="font-display text-lg">{t('Requested system')}</legend><div className="mt-3 grid gap-4 sm:grid-cols-2"><label className="text-xs text-ink-dim">{t('Choose by')}<select aria-label={t('Choose by')} className={fieldClass} value={draft.inputs.request.kind} onChange={e => edit(next => { next.inputs.request = e.target.value === 'panel-count' ? { kind: 'panel-count', panelCount: 1 } : e.target.value === 'capacity' ? { kind: 'capacity', capacityKwp: 1 } : { kind: 'unknown' } })}><option value="unknown">{t('Not decided')}</option><option value="panel-count">{t('Number of panels')}</option><option value="capacity">{t('Rated capacity (kWp)')}</option></select></label>
        {draft.inputs.request.kind === 'panel-count' && numberField('Requested panel count', draft.inputs.request.panelCount, 'inputs.request.panelCount', (next, v) => { next.inputs.request = { kind: 'panel-count', panelCount: v ?? NaN } }, 1, 10000, 1)}
        {draft.inputs.request.kind === 'capacity' && numberField('Requested capacity (kWp)', draft.inputs.request.capacityKwp, 'inputs.request.capacityKwp', (next, v) => { next.inputs.request = { kind: 'capacity', capacityKwp: v ?? NaN } }, .001, 10000)}
      </div></fieldset>
      <details className="mt-6 border-t border-line pt-4"><summary className="cursor-pointer text-sm">{t('Placement preferences')}</summary><div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Select label="Module arrangement" value={draft.inputs.placement.moduleOrientation} options={ [['auto', 'Compare portrait and landscape'], ['portrait', 'Portrait'], ['landscape', 'Landscape']] } onChange={v => edit(next => { next.inputs.placement.moduleOrientation = v as 'auto' | 'portrait' | 'landscape' })}/>
        <Select label="Placement mode" value={draft.inputs.placement.mode} options={ [['automatic', 'Automatic'], ['manual', 'Keep manual positions']] } onChange={v => edit(next => { next.inputs.placement.mode = v as 'automatic' | 'manual' })}/>
        <Select label="Mounting choice" value={draft.inputs.mounting} options={ [['unknown', 'Choose later'], ['low-tilt', 'Low frame'], ['raised-frame', 'Raised frame']] } onChange={v => edit(next => { next.inputs.mounting = v as SolarConfiguration['inputs']['mounting'] })}/>
        {numberField('Local array rotation (°, optional)', draft.inputs.placement.arrayRotationDeg, 'inputs.placement.arrayRotationDeg', (next, v) => { next.inputs.placement.arrayRotationDeg = v }, 0, 359.999)}
        {numberField('Panel tilt (°, optional)', draft.inputs.placement.tiltDeg, 'inputs.placement.tiltDeg', (next, v) => { next.inputs.placement.tiltDeg = v }, 0, 90)}
        {numberField('Lower-panel height (mm, optional)', draft.inputs.placement.mountingHeightMm, 'inputs.placement.mountingHeightMm', (next, v) => { next.inputs.placement.mountingHeightMm = v }, 0, 10000)}
        {numberField('Row gap (mm, optional)', draft.inputs.placement.rowGapMm, 'inputs.placement.rowGapMm', (next, v) => { next.inputs.placement.rowGapMm = v }, 0, 100000)}
        {numberField('Roof-edge clearance (mm, optional)', draft.inputs.placement.edgeClearanceMm, 'inputs.placement.edgeClearanceMm', (next, v) => { next.inputs.placement.edgeClearanceMm = v }, 0, 100000)}
        {numberField('Plan north bearing (°, optional)', draft.inputs.orientation.planNorthBearingDeg, 'inputs.orientation.planNorthBearingDeg', (next, v) => { next.inputs.orientation.planNorthBearingDeg = v }, 0, 359.999)}
      </div><p className="mt-3 text-xs text-ink-dim">{t('Blank values remain unknown. Preview labels any concept assumptions; road direction does not establish true north.')}</p></details>
      {error && <p id={`${formId}-error`} role="alert" className="mt-5 rounded-md border border-line-strong p-3 text-sm">{t(error)}</p>}
      {notice && <p role="status" className="mt-4 text-sm">{t(notice)}</p>}
      <p className="mt-5 text-xs text-ink-dim">{t(dirty ? 'Unsaved solar draft. Preview, then Apply to save.' : 'Your saved solar settings are shown. Preview before applying changes.')}</p>
      <div className="mt-3 flex flex-wrap gap-2"><Button type="submit" size="sm" variant="ghost">{t('Preview')}</Button><Button type="button" size="sm" disabled={!preview || !!error} onClick={apply}>{t('Apply')}</Button><Button type="button" size="sm" variant="quiet" onClick={cancel}>{t('Cancel')}</Button></div>
      <div className="mt-4 flex flex-wrap gap-3 border-t border-line pt-4"><button type="button" className="text-xs underline" onClick={() => edit(next => { next.intention = 'not-included' })}>{t('Remove solar')}</button><button type="button" className="text-xs underline" onClick={() => { setDraft(defaultSolarConfiguration()); setPreview(null); setError(''); setNotice('Solar reset is a draft until you Apply.'); setShowErrors(false) }}>{t('Reset solar')}</button></div>
    </form>
    {preview && <section aria-label={t('Solar preview')} className="mt-5 rounded-xl border border-line bg-bg-inset p-4 sm:p-5"><h3 className="font-display text-xl" role="status">{t(statusLabels[status!])}</h3>
      {preview.proposal.layout && <div className="mt-3 grid grid-cols-2 gap-3"><Summary label="Requested" value={`${preview.proposal.requestedPanelCount ?? 0} · ${num(preview.proposal.requestedCapacityKwp ?? 0, 3)} kWp`}/><Summary label="Fits in this preview" value={format('{0} panels · {1} kWp', preview.proposal.achievablePanelCount, num(preview.proposal.achievableCapacityKwp, 3))}/></div>}
      <RoofPreview preview={preview}/>
      {!!preview.proposal.layout?.resolved.assumptions.length && <details className="mt-4 border-t border-line pt-3"><summary className="cursor-pointer text-sm">{t('Concept assumptions')}</summary><ul className="mt-3 space-y-2 text-xs leading-relaxed text-ink-dim">{preview.proposal.layout.resolved.assumptions.map(assumption => <li key={assumption}>{t(assumption)}</li>)}</ul></details>}
      {preview.proposal.issues.length > 0 && <ul className="mt-4 space-y-2 text-xs leading-relaxed text-ink-dim">{[...new Set(preview.proposal.issues.map(i => solarIssueLabel(i.code)))].slice(0, 4).map(label => <li key={label}>{t(label)}</li>)}</ul>}
      <p className="mt-4 text-xs leading-relaxed text-ink-dim">{t('Concept placement only. Confirm module data, roof suitability and installation cost with an installer.')}</p>
      {preview.configuration.intention === 'install-now' && !preview.proposal.layout?.panels.length && <p className="mt-2 text-xs text-ink-dim">{t('You can save these preferences now; no new panel layout will be installed in the model.')}</p>}
    </section>}
    {brief.specs.overrides.solar === 'on' && <p className="mt-4 text-xs text-ink-dim">{t('Your existing provisional solar allowance is retained separately from this concept layout.')}</p>}
  </div>
}

function Summary({ label, value }: { label: string; value: ReactNode }) { return <div className="min-w-0"><p className="text-xs text-ink-faint">{t(label)}</p><p className="mt-1 break-words font-mono text-sm">{value}</p></div> }
function Select({ label, value, options, onChange }: { label: string; value: string; options: string[][]; onChange: (v: string) => void }) { return <label className="min-w-0 text-xs text-ink-dim">{t(label)}<select aria-label={t(label)} value={value} onChange={e => onChange(e.target.value)} className={fieldClass}>{options.map(([key, label]) => <option key={key} value={key}>{t(label)}</option>)}</select></label> }
function RoofPreview({ preview }: { preview: SolarEditorPreview }) {
  const id = useId(), top = preview.roof.surfaces.find(s => s.kind === 'flat-top-roof')
  if (!top?.grossRegionsMm.length) return null
  const box = rectUnionBBox(top.grossRegionsMm), padding = Math.max(box.w, box.h) * .05, layout = preview.proposal.layout
  return <figure className="mt-4"><svg role="img" aria-labelledby={`${id}-title ${id}-description`} viewBox={`${box.x - padding} ${box.y - padding} ${box.w + 2 * padding} ${box.h + 2 * padding}`} className="max-h-72 w-full rounded-lg border border-line bg-bg-raised">
    <title id={`${id}-title`}>{t('2D terrace concept')}</title><desc id={`${id}-description`}>{t('Panels, obstacles, access and reservations shown on the actual roof outline.')}</desc>
    <defs><mask id={`${id}-roof`}><rect x={box.x - padding} y={box.y - padding} width={box.w + 2 * padding} height={box.h + 2 * padding} fill="black"/>{top.regionsMm.map((r, i) => <rect key={i} x={r.x} y={r.y} width={r.w} height={r.h} fill="white"/>)}</mask></defs>
    <g mask={`url(#${id}-roof)`}>{top.regionsMm.map((r, i) => <rect key={i} x={r.x} y={r.y} width={r.w} height={r.h} fill="var(--color-bg-inset)"/>)}
      {top.obstacles.flatMap(o => o.regionsMm).map((r, i) => <rect key={`o${i}`} x={r.x} y={r.y} width={r.w} height={r.h} fill="var(--color-ink-faint)" opacity=".45"/>)}
      {top.access.protectedRegionsMm.map((r, i) => <rect key={`a${i}`} x={r.x} y={r.y} width={r.w} height={r.h} fill="none" stroke="var(--color-ink-faint)" strokeWidth="35" strokeDasharray="100 90"/>)}
      {preview.configuration.inputs.reservedAreas.filter(r => r.level === top.level).map(r => <rect key={r.id} x={r.rectMm.x} y={r.rectMm.y} width={r.rectMm.w} height={r.rectMm.h} fill="none" stroke="var(--color-ink)" strokeWidth="60" strokeDasharray="180 100"/>)}
      {layout?.panels.map(p => <polygon key={p.id} points={solarPanelGeometry(p, layout.placementPolicy, layout.resolved).projectedFootprintMm.map(p => `${p.x},${p.y}`).join(' ')} fill="var(--color-accent)" stroke="var(--color-bg)" strokeWidth="20"/>)}
    </g>{top.edges.map((e, i) => <line key={i} x1={e.a.x} y1={e.a.y} x2={e.b.x} y2={e.b.y} stroke="var(--color-ink)" strokeWidth="35"/>)}</svg><figcaption className="mt-2 text-xs text-ink-faint">{t('2D terrace concept')} · {t('Dark panels · grey obstacles · dashed access and reservations')}</figcaption></figure>
}
