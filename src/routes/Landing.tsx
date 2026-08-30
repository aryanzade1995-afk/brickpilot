import { ArrowRight, Ruler, Layers, Compass } from 'lucide-react'
import { ButtonLink } from '@/components/ui/Button.tsx'
import { HeroPreview } from '@/components/HeroPreview.tsx'

const FEATURES = [
  {
    icon: Ruler,
    title: 'Feasibility first',
    body: 'Zoning, setbacks and coverage checked before you fall in love with a plan.',
  },
  {
    icon: Layers,
    title: 'Iterate with confidence',
    body: 'Compare validated directions. The canonical plan only changes when you confirm.',
  },
  {
    icon: Compass,
    title: 'Design with context',
    body: 'Site-aware reasoning behind every line on the plan — measured, not guessed.',
  },
]

export function Landing() {
  return (
    <div className="mx-auto max-w-[1400px] px-6 md:px-10">
      <section className="grid items-center gap-14 py-16 lg:grid-cols-[1fr_1.05fr] lg:py-24">
        <div>
          <div className="mb-8 flex items-center gap-3">
            <span className="h-px w-8 bg-accent" />
            <span className="label text-accent">AI House Feasibility Studio</span>
          </div>

          <h1 className="font-display text-[clamp(2.75rem,6.5vw,4.75rem)] font-medium leading-[1.03] tracking-[-0.02em]">
            Draw the house before the headache<span className="text-accent">.</span>
          </h1>

          <p className="mt-7 max-w-lg text-lg leading-relaxed text-ink-dim">
            Explore ideas. Test constraints. Validate feasibility — measured, costed and
            checked against your plot before you commit.
          </p>

          <div className="mt-9 flex flex-wrap items-center gap-5">
            <ButtonLink to="/workspace">
              Start a project
              <ArrowRight size={14} strokeWidth={2.5} />
            </ButtonLink>
            <ButtonLink to="/workspace" variant="quiet">
              See the evidence
            </ButtonLink>
          </div>
        </div>

        <div className="lg:pl-6">
          <HeroPreview />
        </div>
      </section>

      <section className="grid gap-px overflow-hidden rounded-[var(--radius-card)] border border-line bg-line md:grid-cols-3">
        {FEATURES.map(({ icon: Icon, title, body }) => (
          <div key={title} className="bg-bg px-6 py-7">
            <Icon size={18} className="text-accent" strokeWidth={1.75} />
            <h3 className="mt-4 font-display text-lg">{title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-ink-dim">{body}</p>
          </div>
        ))}
      </section>

      <section className="border-t border-line py-16 text-center">
        <p className="label mx-auto">Concept &amp; feasibility only — a licensed architect and engineers must verify before permits</p>
      </section>
    </div>
  )
}
