import { useMemo } from 'react'
import { assessShape, canIncreaseBrief, CAPACITY_GUIDANCE, SHAPE_CHOICES } from '@/lib/engine/planner/fit.ts'
import { resolveOpenSpace, OPEN_SPACE_LABEL } from '@/lib/model/openSpace.ts'
import { PLANNING_LIMITS } from '@/lib/engine/planner/limits.ts'
import { Plus, X } from 'lucide-react'
import {
  BUILDING_TYPE_LABEL,
  CHARACTER_LABEL,
  DIRECTIONS,
  DIRECTION_LABEL,
  GUESTS_LABEL,
  KITCHEN_LABEL,
  MEMBER_ROLE_LABEL,
  SELECTABLE_CHARACTERS,
  STAFF_LABEL,
  VASTU_LABEL,
  occupantCount,
  type Brief,
  type Direction,
  type Guests,
  type MassingChoice,
  type MemberRole,
  type Character,
  type DesignPersonality,
  type Staff,
  type VastuPreference,
} from '@/lib/model/brief.ts'
import { canonicalSummary, compile } from '@/lib/model/canonical.ts'
import { programmeCapacity } from '@/lib/rules/index.ts'
import { useStudio } from '@/state/studio.ts'
import { FitNotice } from './FitNotice.tsx'
import { describeMembers, membersByRole } from '@/lib/model/household.ts'
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
        Formstead produces a residential concept and feasibility package — a villa or bungalow,
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
  const open = resolveOpenSpace(s)
  const maxBuildLimit = (s.plotWidth * s.plotDepth * PLANNING_LIMITS.maxCoverage) / Math.max(1, (s.plotWidth - s.setbacks.E - s.setbacks.W) * (s.plotDepth - s.setbacks.N - s.setbacks.S))


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
      <FitNotice />

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
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
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
      <div className="space-y-4">
        <Field label="Open space" hint="Clear margins from the property edge. Setbacks are the minimum.">
          <Segmented value={s.openSpace.mode} onChange={v => edit(b => void (b.site.openSpace.mode = v))}
            options={Object.entries(OPEN_SPACE_LABEL).map(([value, label]) => ({ value: value as typeof s.openSpace.mode, label }))} />
        </Field>
        {s.openSpace.mode === 'perSide' && <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {DIRECTIONS.map(d => <Field key={d} label={`${DIRECTION_LABEL[d]} open (m)`}>
            <NumberInput value={s.openSpace.metres[d]} min={0} max={30} step={0.1} suffix="m" onChange={v => edit(b => void (b.site.openSpace.metres[d] = v))} />
          </Field>)}
        </div>}
        {s.openSpace.mode === 'chosenSides' && <>
          <div className="grid grid-cols-2 gap-3">{DIRECTIONS.map(d => <Toggle key={d} label={`Keep ${DIRECTION_LABEL[d]} open`} checked={s.openSpace.sides.includes(d)} onChange={v => edit(b => {
            b.site.openSpace.sides = v ? [...b.site.openSpace.sides.filter(x => x !== d), d] : b.site.openSpace.sides.filter(x => x !== d)
          })} />)}</div>
          <Field label="Open margin on chosen sides (m)"><NumberInput value={s.openSpace.amount} min={0} max={30} step={0.1} suffix="m" onChange={v => edit(b => void (b.site.openSpace.amount = v))} /></Field>
        </>}
        <p className="text-xs text-ink-dim" role="status">{s.openSpace.mode === 'auto' ? 'The planner chooses an edge placement and sizes the house to the room programme.' : 'The planner fills the permitted area with connected rectilinear wings, while retaining room access and structure.'}</p>
        {open.notes.map(note => <p key={note} role="status" className="text-xs text-warn">{note}</p>)}
        {s.openSpace.mode === 'maxBuild' && maxBuildLimit < 0.85 && <p role="status" className="text-xs text-warn">The existing 60% plot coverage limit prevents 85% buildable-area use on this plot. Max build stops at the coverage limit; parking and room checks still apply.</p>}
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */

const QUICK_ADD: MemberRole[] = ['adult', 'senior', 'teen', 'child']
const MAX_MEMBERS = 20
const syncOccupants = (b: Brief) => void (b.spaces.occupants = Math.min(MAX_MEMBERS, Math.max(1, b.household.members.length)))

export function FamilyStep() {
  const [brief, edit] = useBrief()
  const h = brief.household
  const count = occupantCount(brief)
  const canAdd = (role: MemberRole) => count < MAX_MEMBERS && canIncreaseBrief(brief, b => { b.household.members.push({ role, needsGroundFloor: role === 'senior' }); syncOccupants(b) })
  const add = (role: MemberRole) =>
    edit((b) => {
      if (!canAdd(role)) return
      b.household.members.push({ role, needsGroundFloor: role === 'senior' })
      syncOccupants(b)
    })
  return (
    <div className="max-w-2xl space-y-10">
      <div className="space-y-4">
        <div className="flex items-baseline justify-between">
          <span className="label">Household members</span>
          <span className="font-mono text-xs text-ink-dim tnum">{count} {count === 1 ? 'person' : 'people'}</span>
        </div>
        <div className="space-y-2">
          {h.members.map((m, i) => (
            <div key={i} className="flex flex-wrap items-center gap-3 border border-line p-3">
              <span className="w-6 font-mono text-xs text-ink-faint tnum">{String(i + 1).padStart(2, '0')}</span>
              <Segmented
                value={m.role}
                onChange={(v) =>
                  edit((b) => {
                    b.household.members[i].role = v
                    b.household.members[i].needsGroundFloor = v === 'senior'
                  })}
                options={(Object.keys(MEMBER_ROLE_LABEL) as MemberRole[]).map((value) => ({ value, label: MEMBER_ROLE_LABEL[value] }))}
              />
              <div className="min-w-[12rem] flex-1">
                <Toggle
                  checked={m.needsGroundFloor}
                  onChange={(v) => edit((b) => void (b.household.members[i].needsGroundFloor = v))}
                  label="Needs ground floor"
                />
              </div>
              <button
                type="button"
                aria-label={`Remove member ${i + 1}`}
                disabled={h.members.length <= 1}
                onClick={() =>
                  edit((b) => {
                    b.household.members.splice(i, 1)
                    syncOccupants(b)
                  })}
                className="flex-none border border-line-strong p-2.5 text-ink-dim transition-colors hover:border-accent hover:text-ink disabled:opacity-30"
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
        {!canAdd('adult') && <p className="text-sm text-bad" role="status">{CAPACITY_GUIDANCE}</p>}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!canAdd('adult')}
            onClick={() => add('adult')}
            className="inline-flex items-center gap-1.5 border border-line-strong px-3 py-2 font-mono text-xs uppercase tracking-[0.1em] text-ink transition-colors hover:border-accent disabled:opacity-30"
          >
            <Plus size={12} />
            Add member
          </button>
          {QUICK_ADD.map((role) => (
            <button
              key={role}
              type="button"
              disabled={!canAdd(role)}
              onClick={() => add(role)}
              className="border border-line px-3 py-2 font-mono text-xs uppercase tracking-[0.1em] text-ink-dim transition-colors hover:border-line-strong hover:text-ink disabled:opacity-30"
            >
              + {MEMBER_ROLE_LABEL[role]}
            </button>
          ))}
        </div>
      </div>

      <Toggle
        checked={brief.spaces.stepFree}
        onChange={(v) => edit((b) => void (b.spaces.stepFree = v))}
        label="Step-free / mobility access needed"
        hint="Places one bedroom and bathroom on the ground floor"
      />

      <div className="grid gap-8 sm:grid-cols-2">
        <Field label="Overnight guests">
          <Segmented
            value={h.guests}
            onChange={(v) => edit((b) => void (b.household.guests = v))}
            options={(Object.keys(GUESTS_LABEL) as Guests[]).map((value) => ({ value, label: GUESTS_LABEL[value] }))}
          />
        </Field>
        <Field label="Household staff">
          <Segmented
            value={h.staff}
            onChange={(v) => edit((b) => void (b.household.staff = v))}
            options={(Object.keys(STAFF_LABEL) as Staff[]).map((value) => ({ value, label: STAFF_LABEL[value] }))}
          />
        </Field>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */

export function LifestyleStep() {
  const [brief, edit] = useBrief()
  const l = brief.lifestyle
  return (
    <div className="max-w-2xl space-y-10">
      <div className="space-y-4">
        <div>
          <span className="label">Kitchen</span>
          <p className="mt-1 text-sm text-ink-dim">How the kitchen meets the dining area.</p>
        </div>
        <CardChoice
          value={l.kitchen}
          onChange={(v) => edit((b) => void (b.lifestyle.kitchen = v))}
          options={[
            { value: 'open', title: KITCHEN_LABEL.open, body: 'No wall to the dining area.' },
            { value: 'semi', title: KITCHEN_LABEL.semi, body: 'A glass sliding partition that contains cooking smells.' },
            { value: 'closed', title: KITCHEN_LABEL.closed, body: 'A separate room with a door.' },
          ]}
        />
        <Toggle
          checked={l.dryWetSplit}
          onChange={(v) => edit((b) => void (b.lifestyle.dryWetSplit = v))}
          label="Separate dry and wet kitchen"
          hint="A wet kitchen for heavy cooking and washing, beside a clean dry kitchen"
        />
      </div>

      <Field label="Living &amp; dining">
        <Segmented
          value={brief.spaces.livingDining}
          onChange={(v) => edit((b) => void (b.spaces.livingDining = v))}
          options={[
            { value: 'separate', label: 'Separate' },
            { value: 'combined', label: 'Combined hall' },
          ]}
        />
      </Field>

      <div className="space-y-4">
        <Field label="People working from home">
          <Stepper
            increaseDisabled={!canIncreaseBrief(brief, b => { b.lifestyle.wfhCount += 1 })}
            increaseReason={CAPACITY_GUIDANCE}
            value={l.wfhCount}
            min={0}
            max={4}
            onChange={(v) =>
              edit((b) => {
                b.lifestyle.wfhCount = v
                if (v === 0) b.lifestyle.clientVisits = false
              })}
          />
        </Field>
        {l.wfhCount > 0 && (
          <Toggle
            checked={l.clientVisits}
            onChange={(v) => edit((b) => void (b.lifestyle.clientVisits = v))}
            label="Clients visit the home office"
            hint="Keeps the office close to the entrance, away from family rooms"
          />
        )}
      </div>

      <Field label="Vastu" hint="Strict may reduce the number of plans that can be offered">
        <Segmented
          value={l.vastu}
          onChange={(v) => edit((b) => void (b.lifestyle.vastu = v))}
          options={(Object.keys(VASTU_LABEL) as VastuPreference[]).map((value) => ({ value, label: VASTU_LABEL[value] }))}
        />
      </Field>
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
      <FitNotice />
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
          <Stepper increaseDisabled={!canIncreaseBrief(brief, b => { b.rooms.bedroomsWithBath += 1 })} increaseReason={CAPACITY_GUIDANCE} value={r.bedroomsWithBath} min={0} max={8} onChange={(v) => edit((b) => void (b.rooms.bedroomsWithBath = v))} />
        </Field>
        <Field label="Bedrooms without attached bath">
          <Stepper increaseDisabled={!canIncreaseBrief(brief, b => { b.rooms.bedroomsNoBath += 1 })} increaseReason={CAPACITY_GUIDANCE} value={r.bedroomsNoBath} min={0} max={8} onChange={(v) => edit((b) => void (b.rooms.bedroomsNoBath = v))} />
        </Field>
        <Field label="Shared / common bathrooms">
          <Stepper increaseDisabled={!canIncreaseBrief(brief, b => { b.rooms.sharedBaths += 1 })} increaseReason={CAPACITY_GUIDANCE} value={r.sharedBaths} min={0} max={6} onChange={(v) => edit((b) => void (b.rooms.sharedBaths = v))} />
        </Field>
        <Field label="Studies / offices">
          <Stepper increaseDisabled={!canIncreaseBrief(brief, b => { b.rooms.studies += 1 })} increaseReason={CAPACITY_GUIDANCE} value={r.studies} min={0} max={4} onChange={(v) => edit((b) => void (b.rooms.studies = v))} />
        </Field>
      </div>

      <Toggle checked={r.balcony} onChange={(v) => edit((b) => void (b.rooms.balcony = v))} label="Balcony on upper floors" />

      {p.pooja && <div className="grid gap-6 sm:grid-cols-2">
        <Field label="Pooja room size">
          <Segmented value={r.poojaPreference} onChange={(v) => edit((b) => void (b.rooms.poojaPreference = v))}
            options={[{ value: 'compact', label: 'Compact' }, { value: 'dedicated', label: 'Dedicated' }, { value: 'large', label: 'Large' }]} />
        </Field>
        <Field label="Preferred pooja side" hint="A placement preference; room access and minimum sizes remain mandatory.">
          <Segmented value={r.poojaSide} onChange={(v) => edit((b) => void (b.rooms.poojaSide = v))}
            options={['auto', ...DIRECTIONS].map((value) => ({ value: value as typeof r.poojaSide, label: value === 'auto' ? 'Auto' : value }))} />
        </Field>
      </div>}

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
          <Toggle checked={p.garden} onChange={(v) => edit((b) => void (b.rooms.priorities.garden = v))} label="Garden &amp; landscaping" hint="Lawn, hedges and driveway" />
          <Toggle checked={r.pool} onChange={v => edit(b => void (b.rooms.pool = v))} label="Swimming pool" hint="A 2.5 × 5 m pool where the open space permits" />
          <Toggle checked={p.compoundWall} onChange={(v) => edit((b) => void (b.rooms.priorities.compoundWall = v))} label="Compound wall" hint="Boundary wall with a gate" />
        </div>
      </div>
      {(['bedroomsWithBath', 'bedroomsNoBath', 'sharedBaths', 'studies'] as const).some(key => !canIncreaseBrief(brief, b => { b.rooms[key] += 1 })) && <p role="status" className="text-sm text-bad">Add a floor or reduce open space to add another bedroom, bathroom or study.</p>}
      <FitNotice />
    </div>
  )
}

/* -------------------------------------------------------------------------- */

export function StyleStep() {
  const [brief, edit] = useBrief()
  // each shape is built by the production planner for this exact brief: one
  // the plot cannot take is shown, but cannot be chosen
  const shapeKey = JSON.stringify({ ...brief, style: { ...brief.style, massing: 'auto' } })
  const shapeChecks = useMemo(() => Object.fromEntries(SHAPE_CHOICES.map((shape) => [shape, assessShape(brief, shape)])) as
    Record<ShapeChoiceValue, ReturnType<typeof assessShape>>,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [shapeKey])
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
        {brief.project.buildingType === 'large-villa' && <Toggle checked={brief.project.autoExtras}
          onChange={v => edit(b => void (b.project.autoExtras = v))}
          label="Add optional lounges, guest suites and leisure rooms when the plot has space" />}
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
          options={CHARACTER_CARDS}
        />
        {!SELECTABLE_CHARACTERS.some((value) => value === brief.style.character) && (
          <p className="text-sm text-ink-dim" role="status">
            This saved brief uses {CHARACTER_LABEL[brief.style.character]}. Choose one of the three current styles to update it.
          </p>
        )}
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
          options={MASSING_CHOICES.map((o) => o.value === 'auto' || !shapeChecks[o.value as ShapeChoiceValue]?.ok ? o.value === 'auto' ? o
            : { ...o, disabled: true, title: shapeChecks[o.value as ShapeChoiceValue]?.reason } : { ...o, title: shapeChecks[o.value as ShapeChoiceValue].reason })}
        />
        <ul className="space-y-1 text-xs" role="status" aria-label="Shape checks">
          {SHAPE_CHOICES.map((shape) => (
            <li key={shape} className={shapeChecks[shape].ok ? 'text-ok' : 'text-ink-faint'}>
              {shapeChecks[shape].ok ? '✓' : '✕'} {SHAPE_LABEL[shape]} — {shapeChecks[shape].reason}
            </li>
          ))}
        </ul>
        {!['auto', ...SHAPE_CHOICES].includes(brief.style.massing) && (
          <p className="text-sm text-ink-dim" role="status">
            This saved brief uses an older massing choice ({brief.style.massing.replaceAll('-', ' ')}). Choose Auto or one of the three shapes above.
          </p>
        )}
        <FitNotice />
      </div>

      <Field label="Design personality" hint="Sets the composition bias while preserving the same structural plan">
        <Segmented
          value={brief.style.personality}
          onChange={(v) => edit((b) => void (b.style.personality = v))}
          options={(['balanced', 'minimal', 'elegant', 'bold', 'dramatic', 'warm', 'luxurious', 'tropical'] as DesignPersonality[])
            .map((value) => ({ value, label: value[0].toUpperCase() + value.slice(1) }))}
        />
      </Field>

      <div className="grid gap-8 sm:grid-cols-2">
        <Field
          label="Design variation"
          hint="How far exterior features and style may vary while the plan stays fixed"
        >
          <Segmented
            value={brief.style.diversity}
            onChange={(v) => edit((b) => void (b.style.diversity = v))}
            options={[
              { value: 'low' as const, label: 'Subtle' },
              { value: 'medium' as const, label: 'Balanced' },
              { value: 'high' as const, label: 'Bold' },
              { value: 'extreme' as const, label: 'Bold +' },
            ]}
          />
        </Field>
        <p className="text-sm text-ink-dim">Every new 3D design gets an automatic variation. Your floor plan stays fixed.</p>
      </div>
    </div>
  )
}

const CHARACTER_DETAILS: Record<typeof SELECTABLE_CHARACTERS[number], { title: string; body: string }> = {
  'modern-box': { title: 'Modern Box', body: 'Crisp white boxes, the upper floor oversailing full-height glass, glass rails and a roof terrace.' },
  'contemporary-indian': { title: 'Contemporary', body: 'Plaster planes over a stone-clad ground floor, wide sliding glass, deep flat hoods and a double-height entry.' },
  'courtyard-indian': { title: 'Courtyard', body: 'Wings wrapping a courtyard behind a columned verandah and street-facing terracotta jaali screens.' },
}
const CHARACTER_CARDS: { value: Character; title: string; body: string }[] =
  SELECTABLE_CHARACTERS.map((value) => ({ value, ...CHARACTER_DETAILS[value] }))

/* Only shapes that build a genuinely different plan are offered (the others
 * mapped onto these same plates). Older briefs keep their value and still load. */
type ShapeChoiceValue = (typeof SHAPE_CHOICES)[number]
const SHAPE_LABEL: Record<ShapeChoiceValue, string> = { rectangular: 'Rectangular', 'l-shape': 'L-shaped', courtyard: 'Courtyard',
  'twin-wing':'Twin wings','u-wing':'U wings','courtyard-ring':'Courtyard ring',pavilion:'Pavilion' }
const MASSING_CHOICES: { value: MassingChoice; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  ...SHAPE_CHOICES.map((value) => ({ value, label: SHAPE_LABEL[value] })),
]

/* -------------------------------------------------------------------------- */

export function EntryStep() {
  const [brief, edit] = useBrief()
  const e = brief.entry
  return (
    <div className="max-w-xl space-y-8">
      <Field label="Primary entry side" hint="Auto uses the main facing when it is a road edge; otherwise the first road edge">
        <Segmented
          value={e.primarySide}
          onChange={(v) => edit((b) => void (b.entry.primarySide = v))}
          options={[
            { value: 'auto' as const, label: 'Auto' },
            ...DIRECTIONS.map((d) => ({ value: d as typeof e.primarySide, label: d })),
          ]}
        />
      </Field>
      <Field label="Entrance design" hint="A taller main door with a surround and shade; Auto follows the selected style.">
        <Segmented value={e.design} onChange={v => edit(b => { b.entry.design = v })} options={[
          {value:'auto',label:'Auto'}, {value:'indian-carved',label:'Indian carved double-door'},
          {value:'wide-pivot',label:'Wide pivot'}, {value:'framed-portico',label:'Framed portico'},
          {value:'stone-surround',label:'Stone surround'},
        ]} />
      </Field>
      <Field label="Main door clear width (mm)">
        <NumberInput value={e.mainDoorWidth} min={1200} max={1800} step={50} suffix="mm" onChange={(v) => edit((b) => void (b.entry.mainDoorWidth = v))} />
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

      <AnswersSummary brief={brief} />

      <div className="border border-line p-5">
        <div className="label text-accent">Programme capacity check</div>
        <p className="mt-2 text-sm text-ink-dim">
          Minimum room sizes, topology and geometry are checked live against the production planner.
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
          Formstead assigns a variation seed, generates a fixed candidate, normalises shared walls,
          places doors, windows and stairs, then tests reachability and geometry.
        </p>
      </div>
    </div>
  )
}

/** every Household / Lifestyle answer, so nothing on a sub-tab is hidden at review */
function AnswersSummary({ brief }: { brief: Brief }) {
  const { household: h, lifestyle: l } = brief
  const ground = h.members.filter((m) => m.needsGroundFloor).length
  const sections: { title: string; stats: [string, string][]; note?: string }[] = [
    {
      title: 'Household',
      stats: [
        ...membersByRole(brief).map(([role, n]) => [role === 'child' ? 'Children' : `${MEMBER_ROLE_LABEL[role]}s`, String(n)] as [string, string]),
        ['Ground floor', ground ? String(ground) : 'None'],
        ['Guests', GUESTS_LABEL[h.guests]],
        ['Staff', STAFF_LABEL[h.staff]],
      ],
      note: `${occupantCount(brief)} people — ${describeMembers(brief)}${brief.spaces.stepFree ? ' · step-free access' : ''}`,
    },
    {
      title: 'Lifestyle',
      stats: [
        ['Kitchen', KITCHEN_LABEL[l.kitchen]],
        ['Dry / wet', l.dryWetSplit ? 'Split' : 'One kitchen'],
        ['Work from home', String(l.wfhCount)],
        ['Clients visit', l.wfhCount > 0 && l.clientVisits ? 'Yes' : 'No'],
        ['Vastu', VASTU_LABEL[l.vastu]],
      ],
      note: `Living & dining: ${brief.spaces.livingDining === 'combined' ? 'combined hall' : 'separate'}`,
    },

  ]
  return (
    <div className="space-y-4">
      {sections.map((s) => (
        <div key={s.title} className="border border-line p-5">
          <div className="label text-accent">{s.title}</div>
          <div className="mt-3 grid grid-cols-2 gap-x-10 gap-y-5 sm:grid-cols-4">
            {s.stats.map(([k, v]) => <Stat key={k} k={k} v={v} />)}
          </div>
          {s.note && <p className="mt-4 text-sm text-ink-dim">{s.note}</p>}
        </div>
      ))}
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
