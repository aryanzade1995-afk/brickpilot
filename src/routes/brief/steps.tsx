import { Dices } from 'lucide-react'
import {
  BUILDING_TYPE_LABEL,
  CHARACTER_LABEL,
  DIRECTIONS,
  DIRECTION_LABEL,
  type Direction,
  type MassingChoice,
} from '@/lib/model/brief.ts'
import { canonicalSummary, compile } from '@/lib/model/canonical.ts'
import { programmeCapacity } from '@/lib/rules/index.ts'
import { useStudio } from '@/state/studio.ts'
import {
  CardChoice,
  Field,
  Segmented,
  Stepper,
  TextInput,
  Toggle,
  NumberInput,
} from '@/components/ui/controls.tsx'

function useBrief() {
  return [useStudio((s) => s.brief), useStudio((s) => s.edit)] as const
}

/* -------------------------------------------------------------------------- */

export function ProjectStep() {
  const [brief, edit] = useBrief()
  return (
    <div className="max-w-xl space-y-8">
      <Field label="Project name">
        <TextInput value={brief.project.name} onChange={(v) => edit((b) => void (b.project.name = v))} />
      </Field>
      <p className="border-l-2 border-line-strong pl-4 text-sm text-ink-dim">
        BrickPilot produces a residential concept and feasibility package — a villa or bungalow,
        ground-only through G+3. Pick the typology and character on the Style step. A licensed
        architect and engineers must verify it before permits or construction.
      </p>
    </div>
  )
}

/* -------------------------------------------------------------------------- */

export function SiteStep() {
  const [brief, edit] = useBrief()
  const s = brief.site

  const toggleRoad = (d: Direction) =>
    edit((b) => {
      const set = new Set(b.site.roadEdges)
      if (set.has(d)) set.delete(d)
      else set.add(d)
      if (set.size === 0) set.add(d)
      b.site.roadEdges = [...set]
    })

  return (
    <div className="max-w-2xl space-y-8">
      <div className="grid grid-cols-2 gap-6">
        <Field label="Plot width (m)" hint="East–west frontage">
          <NumberInput value={s.plotWidth} min={6} max={80} step={0.5} suffix="m" onChange={(v) => edit((b) => void (b.site.plotWidth = v))} />
        </Field>
        <Field label="Plot depth (m)" hint="North–south">
          <NumberInput value={s.plotDepth} min={6} max={80} step={0.5} suffix="m" onChange={(v) => edit((b) => void (b.site.plotDepth = v))} />
        </Field>
      </div>

      <Field label="Road edges" hint="Which sides face a road — the first is the approach">
        <div className="flex gap-2">
          {DIRECTIONS.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => toggleRoad(d)}
              className={
                'border px-3 py-2 font-mono text-xs uppercase tracking-[0.1em] ' +
                (s.roadEdges.includes(d)
                  ? 'border-accent bg-accent/10 text-ink'
                  : 'border-line-strong text-ink-dim hover:text-ink')
              }
            >
              {DIRECTION_LABEL[d]}
            </button>
          ))}
        </div>
      </Field>

      <Field label="Main facing">
        <Segmented
          value={s.facing}
          onChange={(v) => edit((b) => void (b.site.facing = v))}
          options={DIRECTIONS.map((d) => ({ value: d, label: d }))}
        />
      </Field>

      <div>
        <span className="label">Setbacks (m)</span>
        <div className="mt-3 grid grid-cols-4 gap-3">
          {DIRECTIONS.map((d) => (
            <Field key={d} label={DIRECTION_LABEL[d]}>
              <NumberInput
                value={s.setbacks[d]}
                min={0}
                max={20}
                step={0.1}
                suffix="m"
                onChange={(v) => edit((b) => void (b.site.setbacks[d] = v))}
              />
            </Field>
          ))}
        </div>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */

export function SpacesStep() {
  const [brief, edit] = useBrief()
  const s = brief.spaces
  return (
    <div className="max-w-xl space-y-8">
      <Field label="Household occupants">
        <Stepper value={s.occupants} min={1} max={20} onChange={(v) => edit((b) => void (b.spaces.occupants = v))} />
      </Field>
      <Field label="Living &amp; dining">
        <Segmented
          value={s.livingDining}
          onChange={(v) => edit((b) => void (b.spaces.livingDining = v))}
          options={[
            { value: 'separate', label: 'Separate' },
            { value: 'combined', label: 'Combined hall' },
          ]}
        />
      </Field>
      <Toggle
        checked={s.stepFree}
        onChange={(v) => edit((b) => void (b.spaces.stepFree = v))}
        label="Step-free / mobility access needed"
        hint="Places one bedroom and bathroom on the ground floor"
      />
    </div>
  )
}

/* -------------------------------------------------------------------------- */

export function LevelsStep() {
  const [brief, edit] = useBrief()
  const l = brief.levels
  return (
    <div className="max-w-xl space-y-8">
      <Field label="Number of storeys">
        <Segmented
          value={l.storeys}
          onChange={(v) => edit((b) => void (b.levels.storeys = v))}
          options={[
            { value: 0, label: 'G' },
            { value: 1, label: 'G+1' },
            { value: 2, label: 'G+2' },
            { value: 3, label: 'G+3' },
          ]}
        />
      </Field>
      <div className="grid grid-cols-2 gap-6">
        <Field label="Floor-to-floor (m)">
          <NumberInput value={l.floorToFloor} min={2.7} max={4} step={0.05} suffix="m" onChange={(v) => edit((b) => void (b.levels.floorToFloor = v))} />
        </Field>
        <Field label="Clear stair width (mm)">
          <NumberInput value={l.stairWidth} min={750} max={1500} step={50} suffix="mm" onChange={(v) => edit((b) => void (b.levels.stairWidth = v))} />
        </Field>
      </div>
      <Toggle
        checked={l.liftProvision}
        onChange={(v) => edit((b) => void (b.levels.liftProvision = v))}
        label="Reserve space for a future lift"
        hint="Conceptual shaft only — lift design stays professional scope"
      />
    </div>
  )
}

/* -------------------------------------------------------------------------- */

export function RoomsStep() {
  const [brief, edit] = useBrief()
  const r = brief.rooms
  const p = r.priorities
  return (
    <div className="max-w-2xl space-y-8">
      <div className="grid grid-cols-2 gap-x-8 gap-y-6">
        <Field label="Bedrooms with attached bath">
          <Stepper value={r.bedroomsWithBath} min={0} max={8} onChange={(v) => edit((b) => void (b.rooms.bedroomsWithBath = v))} />
        </Field>
        <Field label="Bedrooms without attached bath">
          <Stepper value={r.bedroomsNoBath} min={0} max={8} onChange={(v) => edit((b) => void (b.rooms.bedroomsNoBath = v))} />
        </Field>
        <Field label="Shared / common bathrooms">
          <Stepper value={r.sharedBaths} min={0} max={6} onChange={(v) => edit((b) => void (b.rooms.sharedBaths = v))} />
        </Field>
        <Field label="Studies / offices">
          <Stepper value={r.studies} min={0} max={4} onChange={(v) => edit((b) => void (b.rooms.studies = v))} />
        </Field>
      </div>

      <Toggle checked={r.balcony} onChange={(v) => edit((b) => void (b.rooms.balcony = v))} label="Balcony on upper floors" />

      <div>
        <span className="label">Ground-floor priorities</span>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <Toggle checked={p.coveredParking} onChange={(v) => edit((b) => void (b.rooms.priorities.coveredParking = v))} label="Covered parking" />
          <Toggle checked={p.coveredVerandah} onChange={(v) => edit((b) => void (b.rooms.priorities.coveredVerandah = v))} label="Covered verandah" />
          <Toggle checked={p.utility} onChange={(v) => edit((b) => void (b.rooms.priorities.utility = v))} label="Utility / laundry" />
          <Toggle checked={p.pooja} onChange={(v) => edit((b) => void (b.rooms.priorities.pooja = v))} label="Pooja / sacred room" />
          <Toggle checked={p.courtyard} onChange={(v) => edit((b) => void (b.rooms.priorities.courtyard = v))} label="Central courtyard" />
        </div>
      </div>

      <div>
        <span className="label">Site</span>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <Toggle checked={p.garden} onChange={(v) => edit((b) => void (b.rooms.priorities.garden = v))} label="Garden &amp; landscaping" hint="Lawn, trees, hedges, driveway" />
          <Toggle checked={p.compoundWall} onChange={(v) => edit((b) => void (b.rooms.priorities.compoundWall = v))} label="Compound wall" hint="Boundary wall with a gate" />
        </div>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */

export function StyleStep() {
  const [brief, edit] = useBrief()
  return (
    <div className="max-w-2xl space-y-10">
      <div className="space-y-4">
        <div>
          <span className="label">Typology</span>
          <p className="mt-1 text-sm text-ink-dim">
            The scale and massing grammar of the house.
          </p>
        </div>
        <CardChoice
          value={brief.project.buildingType}
          onChange={(v) => edit((b) => void (b.project.buildingType = v))}
          options={[
            {
              value: 'villa',
              title: BUILDING_TYPE_LABEL.villa,
              body: 'A single-family home sized to the brief. Compact block or split wings, ground-only through G+3.',
            },
            {
              value: 'large-villa',
              title: BUILDING_TYPE_LABEL['large-villa'],
              body: 'A grander home — wider footprint, more generous rooms, a central courtyard or second wing when the plot allows, deep roof overhangs.',
            },
          ]}
        />
      </div>

      <div className="space-y-4">
        <div>
          <span className="label">Character</span>
          <p className="mt-1 text-sm text-ink-dim">
            A design constraint, not a label — it drives elevation vocabulary, shade and roof
            expression.
          </p>
        </div>
        <CardChoice
          value={brief.style.character}
          onChange={(v) => edit((b) => void (b.style.character = v))}
          options={[
            { value: 'modernist', title: CHARACTER_LABEL.modernist, body: 'Stacked white volumes, a slim deep oversailing roof, a timber-baffle feature tower and vertical shading screens.' },
            { value: 'warm-minimal', title: CHARACTER_LABEL['warm-minimal'], body: 'Quiet plaster planes, a thin oversailing roof, fewer larger timber-framed openings.' },
            { value: 'kerala-contemporary', title: CHARACTER_LABEL['kerala-contemporary'], body: 'Stepped white roof bands, teak cladding panels, a stone entry pier.' },
          ]}
        />
      </div>

      <div className="space-y-4">
        <div>
          <span className="label">Massing</span>
          <p className="mt-1 text-sm text-ink-dim">
            The architectural structure — footprint, floor offsets, courtyard, cantilevers.{' '}
            <span className="text-ink-faint">Auto</span> chooses one that fits the plot and brief.
          </p>
        </div>
        <Segmented
          value={brief.style.massing}
          onChange={(v) => edit((b) => void (b.style.massing = v))}
          options={MASSING_CHOICES}
        />
      </div>

      <div className="grid gap-8 sm:grid-cols-2">
        <Field
          label="Design variation"
          hint="How far the massing pushes offsets, cantilevers and asymmetry"
        >
          <Segmented
            value={brief.style.diversity}
            onChange={(v) => edit((b) => void (b.style.diversity = v))}
            options={[
              { value: 'low' as const, label: 'Low' },
              { value: 'medium' as const, label: 'Medium' },
              { value: 'high' as const, label: 'High' },
              { value: 'extreme' as const, label: 'Extreme' },
            ]}
          />
        </Field>
        <Field label="Seed" hint="Same seed + brief → the same house; change it for a new one">
          <div className="flex items-center gap-2">
            <NumberInput
              value={brief.variation}
              min={0}
              max={999999}
              step={1}
              onChange={(v) => edit((b) => void (b.variation = Math.max(0, Math.round(v))))}
            />
            <button
              type="button"
              aria-label="Random seed"
              onClick={() => edit((b) => void (b.variation = Math.floor(Math.random() * 100000)))}
              className="flex-none border border-line-strong p-2.5 text-ink-dim transition-colors hover:border-accent hover:text-ink"
            >
              <Dices size={16} />
            </button>
          </div>
        </Field>
      </div>
    </div>
  )
}

const MASSING_CHOICES: { value: MassingChoice; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'rectangular', label: 'Rectangular' },
  { value: 'l-shape', label: 'L-shaped' },
  { value: 'u-shape', label: 'U-shaped' },
  { value: 'courtyard', label: 'Courtyard' },
  { value: 'split-volume', label: 'Split volume' },
  { value: 'cantilever', label: 'Cantilever' },
  { value: 'stepped', label: 'Stepped' },
  { value: 'interlocking', label: 'Interlocking' },
  { value: 'side-wing', label: 'Side wing' },
  { value: 'front-projection', label: 'Front projection' },
  { value: 'asymmetric', label: 'Asymmetric' },
  { value: 'random', label: 'Random' },
]

/* -------------------------------------------------------------------------- */

export function EntryStep() {
  const [brief, edit] = useBrief()
  const e = brief.entry
  return (
    <div className="max-w-xl space-y-8">
      <Field label="Primary entry side" hint="Auto uses the first road edge">
        <Segmented
          value={e.primarySide}
          onChange={(v) => edit((b) => void (b.entry.primarySide = v))}
          options={[
            { value: 'auto' as const, label: 'Auto' },
            ...DIRECTIONS.map((d) => ({ value: d as typeof e.primarySide, label: d })),
          ]}
        />
      </Field>
      <Field label="Main door clear width (mm)">
        <NumberInput value={e.mainDoorWidth} min={900} max={1500} step={50} suffix="mm" onChange={(v) => edit((b) => void (b.entry.mainDoorWidth = v))} />
      </Field>
    </div>
  )
}

/* -------------------------------------------------------------------------- */

export function ReviewStep() {
  const brief = useStudio((s) => s.brief)
  const model = compile(brief)
  const summary = canonicalSummary(model)
  const capacity = programmeCapacity(model)

  return (
    <div className="max-w-3xl space-y-8">
      <div className="grid grid-cols-2 gap-x-10 gap-y-5 sm:grid-cols-4">
        <Stat k="Canonical spaces" v={String(summary.spaceCount)} />
        <Stat k="Relationship rules" v={String(summary.relationshipCount)} />
        <Stat k="Floors" v={String(summary.floors)} />
        <Stat k="Min. programme" v={`${summary.minArea} m²`} />
      </div>

      <div className="border border-line p-5">
        <div className="label text-accent">Programme capacity check</div>
        <p className="mt-2 text-sm text-ink-dim">
          Minimum requested room area against usable floor area. Topology and geometry are verified
          after generation.
        </p>
        <div className="mt-4 space-y-3">
          {capacity.map((c) => (
            <div key={c.level}>
              <div className="flex items-baseline justify-between text-sm">
                <span>{c.name}</span>
                <span className={c.pct > 100 ? 'text-warn tnum' : 'text-ok tnum'}>{c.pct}%</span>
              </div>
              <div className="mt-1 h-px w-full bg-line-strong">
                <div
                  className={c.pct > 100 ? 'h-px bg-warn' : 'h-px bg-ok'}
                  style={{ width: `${Math.min(100, c.pct)}%` }}
                />
              </div>
              <div className="mt-1 font-mono text-[0.7rem] text-ink-faint tnum">
                {c.demand.toFixed(0)} m² of {c.usable.toFixed(0)} m² usable
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-start gap-3 text-sm text-ink-dim">
        <span className="label flex-none pt-1">Next</span>
        <p>
          BrickPilot assigns a variation seed, generates a fixed candidate, normalises shared walls,
          places doors, windows and stairs, then tests reachability and geometry.
        </p>
      </div>
    </div>
  )
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <div className="label">{k}</div>
      <div className="mt-1 font-display text-2xl tnum">{v}</div>
    </div>
  )
}
