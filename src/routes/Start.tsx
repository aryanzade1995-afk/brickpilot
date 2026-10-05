import { Link } from 'react-router-dom'
import { ArrowRight, Check, Home, HardHat } from 'lucide-react'
import { useStudio } from '@/state/studio.ts'
import { useProjects } from '@/state/projects.ts'

/* The first page of the product: before the brief, choose how to begin. */

function NewVillaArt() {
  return (
    <svg viewBox="0 0 220 130" preserveAspectRatio="xMidYMid meet" className="h-full w-full" role="img" aria-label="A plot, its buildable area and a new house">
      <rect x="20" y="10" width="180" height="110" fill="#F4F4F1" stroke="#9AA0A6" />
      <rect x="38" y="24" width="144" height="78" fill="#FDF1DD" stroke="#E0873A" strokeDasharray="5 4" />
      <rect x="56" y="38" width="92" height="52" fill="#BCD6EC" stroke="#1D4E89" strokeWidth="2" />
      <line x1="102" y1="38" x2="102" y2="90" stroke="#1D4E89" />
      <line x1="56" y1="64" x2="148" y2="64" stroke="#1D4E89" />
      <rect x="152" y="66" width="26" height="24" fill="#D3D8DD" stroke="#9AA0A6" />
    </svg>
  )
}

function ExistingArt() {
  const cols = [[60, 40], [110, 40], [160, 40], [60, 90], [110, 90], [160, 90]]
  return (
    <svg viewBox="0 0 220 130" preserveAspectRatio="xMidYMid meet" className="h-full w-full" role="img" aria-label="Locked columns with proposed walls planned around them">
      <rect x="20" y="10" width="180" height="110" fill="#F4F4F1" stroke="#9AA0A6" />
      <rect x="60" y="40" width="100" height="50" fill="#EAF1FA" stroke="#1D4E89" strokeWidth="1.5" strokeDasharray="5 4" />
      <line x1="110" y1="40" x2="110" y2="90" stroke="#1D4E89" strokeWidth="2.4" />
      <line x1="60" y1="65" x2="160" y2="65" stroke="#1D4E89" strokeWidth="2.4" />
      {cols.map(([x, y]) => <rect key={`${x}${y}`} x={x - 5} y={y - 5} width="10" height="10" fill="#141414" />)}
      <line x1="60" y1="40" x2="160" y2="40" stroke="#141414" strokeWidth="3" />
      <line x1="60" y1="90" x2="160" y2="90" stroke="#141414" strokeWidth="3" />
    </svg>
  )
}

const OPTIONS = [
  {
    id: 'new',
    to: '/workspace',
    icon: Home,
    eyebrow: 'Start fresh',
    title: 'Create my villa',
    body: 'Tell us about your plot and your family. We plan the rooms, draw the 2D plan, build the 3D villa and cost it.',
    points: ['Guided brief in a few minutes', 'Checked against your plot and setbacks', 'Several design directions to compare'],
    cta: 'Create my villa',
    caption: 'Plot · setbacks · new house',
    art: <NewVillaArt />,
  },
  {
    id: 'existing',
    to: '/workspace/existing',
    icon: HardHat,
    eyebrow: 'Already started building',
    title: 'Work on an existing project',
    body: 'Upload a photo of the site. What is already built stays exactly where it is, and every room is planned around it.',
    points: ['Finds columns and beams in your photo', 'Locks what is built, never moves it', 'Plans around it, then goes to 3D'],
    cta: 'Work on an existing project',
    caption: 'Built = locked · new = planned around it',
    art: <ExistingArt />,
  },
] as const

/** "Create my villa" begins a new project: an open project is kept as saved and is not overwritten by the new brief */
function startNewVilla() {
  const projects = useProjects.getState()
  if (projects.currentId) { projects.startNew(); useStudio.getState().reset() }
  else useStudio.getState().clearExisting()
}

export function Start() {
  return (
    <div className="mx-auto max-w-[1100px] px-6 py-14 md:px-10 md:py-20">
      <div className="mb-3 flex items-center gap-3">
        <span className="h-px w-8 bg-accent" />
        <span className="label text-accent">Where would you like to begin?</span>
      </div>
      <h1 className="font-display text-[clamp(2.2rem,5vw,3.6rem)] font-medium leading-[1.05] tracking-[-0.02em]">
        Two ways in<span className="text-accent">.</span>
      </h1>
      <p className="mt-5 max-w-xl text-lg leading-relaxed text-ink-dim">
        Design a new house from scratch, or carry on from a structure that is already partly built. You can always come back here.
      </p>

      <div className="mt-12 grid gap-6 md:grid-cols-2">
        {OPTIONS.map((o) => (
          <Link key={o.id} to={o.to} onClick={() => { if (o.id === 'new') startNewVilla() }}
            className="group flex flex-col border border-line bg-bg-raised transition-colors hover:border-accent focus-visible:border-accent focus-visible:outline-none">
            <div className="border-b border-line bg-bg-inset p-5"><div className="aspect-[11/6.5]">{o.art}</div><p className="mt-3 text-center font-mono text-[0.62rem] uppercase tracking-[0.1em] text-ink-faint">{o.caption}</p></div>
            <div className="flex flex-1 flex-col p-6">
              <p className="label flex items-center gap-2 text-ink-faint"><o.icon size={14} className="text-accent" /> {o.eyebrow}</p>
              <h2 className="mt-3 font-display text-2xl md:text-[1.7rem]">{o.title}</h2>
              <p className="mt-3 text-sm leading-relaxed text-ink-dim">{o.body}</p>
              <ul className="mt-4 space-y-2 text-sm text-ink-dim">
                {o.points.map((pt) => <li key={pt} className="flex items-start gap-2"><Check size={14} className="mt-0.5 flex-none text-accent" />{pt}</li>)}
              </ul>
              <span className="mt-7 inline-flex items-center gap-2 font-mono text-xs font-medium uppercase tracking-[0.12em] text-accent">
                {o.cta}
                <ArrowRight size={14} strokeWidth={2.5} className="transition-transform group-hover:translate-x-1" />
              </span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
