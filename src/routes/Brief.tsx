import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, ArrowRight, RotateCcw, Sparkles } from 'lucide-react'
import { BRIEF_STEPS } from '@/lib/model/brief.ts'
import { useStudio } from '@/state/studio.ts'
import { Button } from '@/components/ui/Button.tsx'
import { cx } from '@/lib/cx.ts'
import { briefSiteIssues } from '@/lib/model/canonical.ts'
import {
  BudgetStep,
  EntryStep,
  FamilyStep,
  LevelsStep,
  LifestyleStep,
  ProjectStep,
  ReviewStep,
  RoomsStep,
  SiteStep,
  StyleStep,
} from './brief/steps.tsx'

const STEP_BODIES = [
  ProjectStep,
  SiteStep,
  FamilyStep,
  LevelsStep,
  RoomsStep,
  StyleStep,
  EntryStep,
  ReviewStep,
]

const STEP_TITLES = [
  'What are we planning?',
  'What controls the plot?',
  'Who lives here?',
  'How should the house stack?',
  'Which rooms, and what matters most?',
  'What character should shape it?',
  'How do you arrive?',
  'Review the brief',
]

type SubStep = { label: string; title: string; Body: () => React.JSX.Element; isNew?: boolean }

/** sub-tabs inside a top-level step — walked in order by Confirm / Back */
const SUBSTEPS: Partial<Record<number, SubStep[]>> = {
  0: [
    { label: 'Project', title: 'What are we planning?', Body: ProjectStep },
    { label: 'Budget', title: 'What can you spend?', Body: BudgetStep, isNew: true },
  ],
  2: [
    { label: 'Family', title: 'Who lives here?', Body: FamilyStep },
    { label: 'Lifestyle', title: 'How do you live day to day?', Body: LifestyleStep, isNew: true },
  ],
}

export function Brief() {
  const [step, setStepState] = useState(0)
  const [sub, setSub] = useState(0)
  /** changing the top-level step always starts at its first sub-step */
  const setStep = (s: number, subStep = 0) => {
    setStepState(s)
    setSub(subStep)
  }
  const reset = useStudio((s) => s.reset)
  const explore = useStudio((s) => s.explore)
  const brief = useStudio((s) => s.brief)
  const [formError, setFormError] = useState<string | null>(null)
  const navigate = useNavigate()

  const last = step === BRIEF_STEPS.length - 1
  const subs = SUBSTEPS[step]
  const active = subs?.[sub]
  const Body = active?.Body ?? STEP_BODIES[step]
  const title = active?.title ?? STEP_TITLES[step]
  const atStart = step === 0 && sub === 0

  const next = () => {
    if (subs && sub < subs.length - 1) {
      setSub(sub + 1)
    } else if (last) {
      const issues = briefSiteIssues(brief)
      if (issues.length) { setFormError(issues.join(' ')); return }
      setFormError(null)
      explore()
      navigate('/workspace/directions')
    } else {
      setStep(step + 1)
    }
  }

  const back = () => {
    if (sub > 0) setSub(sub - 1)
    else if (step > 0) setStep(step - 1, Math.max(0, (SUBSTEPS[step - 1]?.length ?? 1) - 1))
  }

  return (
    <div>
      {/* wizard rail */}
      <div className="sticky top-0 z-10 border-b border-line bg-bg/90 backdrop-blur">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-3 px-6 py-3 md:px-10">
          <span className="label text-accent">Guided Residential Brief</span>

          <div className="order-3 flex w-full items-center gap-1 overflow-x-auto md:order-2 md:w-auto md:flex-1 md:justify-center">
            {BRIEF_STEPS.map((s, i) => (
              <button
                key={s.key}
                type="button"
                onClick={() => setStep(i)}
                className={cx(
                  'flex flex-none items-center gap-1.5 border px-2 py-1.5 font-mono text-[0.7rem] uppercase tracking-[0.1em] transition-colors',
                  i === step
                    ? 'border-accent text-accent'
                    : i < step
                      ? 'border-line-strong text-ink-dim'
                      : 'border-line text-ink-faint',
                )}
              >
                <span>{String(i + 1).padStart(2, '0')}</span>
                <span className={cx(i === step ? 'inline' : 'hidden md:inline')}>{s.label}</span>
              </button>
            ))}
          </div>

          <div className="order-2 ml-auto flex items-center gap-3 md:order-3">
            <button
              type="button"
              onClick={() => {
                reset()
                setStep(0)
              }}
              className="inline-flex items-center gap-1.5 font-mono text-[0.7rem] uppercase tracking-[0.1em] text-ink-dim hover:text-ink"
            >
              <RotateCcw size={12} />
              Reset
            </button>
            <Button size="sm" onClick={next}>
              {last ? (
                <>
                  Generate concept
                  <Sparkles size={13} />
                </>
              ) : (
                <>
                  Confirm &amp; continue
                  <ArrowRight size={13} />
                </>
              )}
            </Button>
          </div>
        </div>
      </div>

      {/* step body */}
      <div className="mx-auto max-w-[1400px] px-6 py-12 md:px-10 md:py-16">
        {formError && <p role="alert" className="mb-6 border-l-2 border-bad bg-bad/5 px-4 py-3 text-sm text-bad">{formError}</p>}
        <p className="label">Step {step + 1} of {BRIEF_STEPS.length}</p>
        <h1 className="mt-3 font-display text-[clamp(2rem,4vw,3rem)]">{title}</h1>

        {subs && (
          <div className="mt-6 flex gap-1 overflow-x-auto border-b border-line pb-px">
            {subs.map((s, i) => (
              <button
                key={s.label}
                type="button"
                onClick={() => setSub(i)}
                className={cx(
                  'flex flex-none items-center gap-2 border-b-2 px-3 py-2.5 font-mono text-[0.7rem] uppercase tracking-[0.1em] transition-colors',
                  i === sub ? 'border-accent text-accent' : 'border-transparent text-ink-faint hover:text-ink-dim',
                )}
              >
                <span>{String(step + 1).padStart(2, '0')}.{i + 1}</span>
                {s.label}
                {s.isNew && (
                  <span className="border border-accent px-1 py-px text-[0.55rem] leading-none text-accent">New</span>
                )}
              </button>
            ))}
          </div>
        )}

        <div className="mt-10">
          <Body />
        </div>

        <div className="mt-14 flex items-center justify-between border-t border-line pt-6">
          <button
            type="button"
            onClick={back}
            disabled={atStart}
            className="inline-flex items-center gap-2 font-mono text-xs uppercase tracking-[0.12em] text-ink-dim hover:text-ink disabled:opacity-30"
          >
            <ArrowLeft size={13} />
            Back
          </button>
          <Button onClick={next}>
            {last ? (
              <>
                Generate verified concept
                <Sparkles size={14} />
              </>
            ) : (
              <>
                Confirm &amp; continue
                <ArrowRight size={14} />
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}
