import { Link } from 'react-router-dom'
import type { ValidationReport } from '@/lib/rules/index.ts'
import { WorkspaceTabs } from './WorkspaceTabs.tsx'

export function InvalidPlanNotice({ report }: { report: ValidationReport }) {
  const errors = report.findings.filter((finding) => finding.severity === 'error')
  return <div className="mx-auto max-w-3xl px-6 py-10 md:px-10">
    <WorkspaceTabs />
    <h1 className="mt-8 font-display text-3xl">This brief has no valid plan yet</h1>
    <p className="mt-3 text-sm text-ink-dim">
      Formstead could not fit all requested rooms and circulation safely inside the available building area.
      Revise the plot, setbacks, room count or floor arrangement, then generate again.
    </p>
    <ul className="mt-6 space-y-2 border-y border-line py-4 text-sm text-bad">
      {errors.slice(0, 10).map((finding, index) => <li key={`${finding.code}-${index}`}>• {finding.message}</li>)}
    </ul>
    {errors.length > 10 && <p className="mt-2 text-xs text-ink-dim">{errors.length - 10} more checks failed.</p>}
    <Link to="/workspace" className="mt-6 inline-block border border-line-strong px-5 py-3 font-mono text-xs uppercase text-ink hover:border-accent">
      Edit brief
    </Link>
  </div>
}
