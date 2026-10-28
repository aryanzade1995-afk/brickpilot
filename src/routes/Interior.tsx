import { translate as translateUi, useLanguage } from '@/lib/i18n/index.ts'
import { useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useStudio } from '@/state/studio.ts'
import { WorkspaceTabs } from '@/components/WorkspaceTabs.tsx'
import { FastInteriorPreview } from '@/components/FastInteriorPreview.tsx'
import { WalkthroughFoundation } from '@/components/interior/WalkthroughFoundation.tsx'
import { InvalidPlanNotice } from '@/components/InvalidPlanNotice.tsx'
import { useFinishes } from '@/state/finishes.ts'
import { geometryCostKey } from '@/lib/cost/quantities.ts'
import { projectFinishBrief } from '@/lib/cost/briefSelections.ts'

/** Step 06 — comes after Finishes & Cost so every room is dressed in the finishes the user chose. */
export function Interior() {
  useLanguage(s => s.language);

  const result = useStudio((s) => s.result), brief = useStudio((s) => s.brief), run = useStudio((s) => s.run)
  const finishKey = useMemo(() => result ? geometryCostKey(result.design) : '', [result])
  const saved = useFinishes(s => s.entries[finishKey])
  const plan = useMemo(() => (result ? { ...result.design, model: { ...result.design.model, brief: projectFinishBrief(result.design, brief, saved) } } : null), [result, brief, saved])
  useEffect(() => { if (!result) run() }, [result, run])
  if (!result || !plan) return <div className="mx-auto max-w-[1400px] px-10 py-24 text-ink-dim">{translateUi("Preparing model…")}</div>
  if (!result.report.hardChecksPass) return <InvalidPlanNotice report={result.report} />
  return (
    <div className="mx-auto max-w-[1400px] px-6 py-8 md:px-10">
      <WorkspaceTabs />
      <div className="mt-8">
        <p className="label">{translateUi("Step 06 · AI Interior")}</p>
        <h1 className="mt-3 font-display text-3xl md:text-4xl">{translateUi("See each room in your finishes")}</h1>
        <p className="mt-2 text-xs text-ink-dim">{translateUi('Interior-only views · rooftop PV is shown in 3D Massing.')}</p>
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-ink-dim">
          {translateUi("Choose a room and explore a 360° preview using your selected finishes, lighting and furniture style.")}</p>
      </div>
      <div className="mt-6">
        <FastInteriorPreview design={plan} />
      </div>
      <WalkthroughFoundation design={plan} report={result.report} acceptedBuilding={result.buildingModel} />
      <div className="mt-10 flex justify-between border-t border-line pt-5 text-sm">
        <Link to="/workspace/finishes" className="underline underline-offset-4">{translateUi("Back to Finishes & Cost")}</Link>
        <Link to="/workspace/report" className="underline underline-offset-4">{translateUi("Continue to Report →")}</Link>
      </div>
    </div>
  )
}
