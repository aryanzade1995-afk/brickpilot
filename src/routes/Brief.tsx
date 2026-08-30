import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, ArrowRight, RotateCcw, Sparkles } from 'lucide-react'
import { BRIEF_STEPS } from '@/lib/model/brief.ts'
import { useStudio } from '@/state/studio.ts'
import { Button } from '@/components/ui/Button.tsx'
import { cx } from '@/lib/cx.ts'
import {
  EntryStep,
  LevelsStep,
  ProjectStep,
  ReviewStep,
  RoomsStep,
  SiteStep,
  SpacesStep,
  StyleStep,
} from './brief/steps.tsx'

const STEP_BODIES = [
  ProjectStep,
  SiteStep,
  SpacesStep,
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

export function Brief() {
  const [step, setStep] = useState(0)
  const reset = useStudio((s) => s.reset)
  const explore = useStudio((s) => s.explore)
  const navigate = useNavigate()

  const last = step === BRIEF_STEPS.length - 1
  const Body = STEP_BODIES[step]

  const next = () => {
    if (last) {
      explore()
      navigate('/workspace/directions')
    } else {
      setStep((s) => s + 1)
    }
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
                  'flex flex-none items-center gap-2 border px-2.5 py-1.5 font-mono text-[0.7rem] uppercase tracking-[0.1em] transition-colors',
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
        <p className="label">Step {step + 1} of {BRIEF_STEPS.length}</p>
        <h1 className="mt-3 font-display text-[clamp(2rem,4vw,3rem)]">{STEP_TITLES[step]}</h1>

        <div className="mt-10">
          <Body />
        </div>

        <div className="mt-14 flex items-center justify-between border-t border-line pt-6">
          <button
            type="button"
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={step === 0}
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
