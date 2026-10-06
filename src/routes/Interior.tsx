import { useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useStudio } from '@/state/studio.ts'
import { WorkspaceTabs } from '@/components/WorkspaceTabs.tsx'
import { FastInteriorPreview } from '@/components/FastInteriorPreview.tsx'
import { InvalidPlanNotice } from '@/components/InvalidPlanNotice.tsx'

/** Step 06 — comes after Finishes & Cost so every room is dressed in the finishes the user chose. */
export function Interior() {
  const result = useStudio((s) => s.result), brief = useStudio((s) => s.brief), run = useStudio((s) => s.run)
  const plan = useMemo(() => (result ? { ...result.design, model: { ...result.design.model, brief } } : null), [result, brief])
  useEffect(() => { if (!result) run() }, [result, run])
  if (!result || !plan) return <div className="mx-auto max-w-[1400px] px-10 py-24 text-ink-dim">Preparing model…</div>
  if (!result.report.hardChecksPass) return <InvalidPlanNotice report={result.report} />
  return (
    <div className="mx-auto max-w-[1700px] px-6 py-8 md:px-10">
      <WorkspaceTabs />
      <div className="mt-8">
        <p className="label">Step 06 · AI Interior</p>
        <h1 className="mt-3 font-display text-3xl md:text-4xl">See each room in your finishes</h1>
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-ink-dim">
          Choose a room and explore a 360° preview using your selected finishes, lighting and furniture style.
        </p>
      </div>
      <div className="mt-6">
        <FastInteriorPreview design={plan} />
      </div>
      <div className="mt-10 flex justify-between border-t border-line pt-5 text-sm">
        <Link to="/workspace/finishes" className="underline underline-offset-4">Back to Finishes &amp; Cost</Link>
        <Link to="/workspace/report" className="underline underline-offset-4">Continue to Report →</Link>
      </div>
    </div>
  )
}
