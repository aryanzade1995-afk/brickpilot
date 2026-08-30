import { ArrowLeft } from 'lucide-react'
import { Link } from 'react-router-dom'

const STEPS = ['Project', 'Site', 'Spaces', 'Levels', 'Rooms', 'Style', 'Entry', 'Review']

export function Workspace() {
  return (
    <div>
      {/* wizard rail */}
      <div className="border-b border-line">
        <div className="mx-auto flex max-w-[1400px] items-center gap-4 px-6 py-3 md:px-10">
          <span className="label text-accent">Guided Residential Brief</span>
          <div className="ml-4 hidden items-center gap-1 md:flex">
            {STEPS.map((label, i) => (
              <div
                key={label}
                className="flex items-center gap-2 border border-line px-2.5 py-1.5 font-mono text-[0.7rem] uppercase tracking-[0.1em] text-ink-faint first:border-accent first:text-accent"
              >
                <span>{String(i + 1).padStart(2, '0')}</span>
                {i === 0 && <span>{label}</span>}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-[1400px] px-6 py-16 md:px-10">
        <p className="label">Step 1 of 8</p>
        <h1 className="mt-3 font-display text-4xl">What are we planning?</h1>
        <p className="mt-4 max-w-xl text-ink-dim">
          The guided brief and the deterministic layout engine land next. This screen is
          the shell they mount into.
        </p>

        <Link
          to="/"
          className="mt-10 inline-flex items-center gap-2 font-mono text-xs uppercase tracking-[0.12em] text-ink-dim hover:text-ink"
        >
          <ArrowLeft size={13} />
          Back to landing
        </Link>
      </div>
    </div>
  )
}
