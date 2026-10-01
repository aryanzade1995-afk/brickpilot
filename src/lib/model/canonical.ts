import { resolveOpenSpace } from './openSpace.ts'
import type { Brief, Direction } from './brief.ts'
import { costPerSqmAllIn } from '../cost/index.ts'

/* ------------------------------------------------------------------ *
 *  Canonical model — the compiled, engine-facing form of the brief.
 *  The wizard writes a Brief; compile() turns it into this.
 * ------------------------------------------------------------------ */

export type Zone =
  | 'social'
  | 'private'
  | 'service'
  | 'circulation'
  | 'work'
  | 'sacred'
  | 'outdoor'

export const ZONE_LABEL: Record<Zone, string> = {
  social: 'Social',
  private: 'Private',
  service: 'Wet service',
  circulation: 'Circulation',
  work: 'Work',
  sacred: 'Sacred',
  outdoor: 'Outdoor',
}

export type SpaceReq = {
  id: string
  name: string
  zone: Zone
  /** target / min / max floor area in m² */
  target: number
  /** Unconstrained preferred size, retained for honest early budget feedback. */
  preferredTarget?: number
  min: number
  max: number
  /** wants at least one exterior wall (for daylight) */
  wantsWindow: boolean
  /** plumbing — cluster these to share wet walls */
  wet: boolean
  /** must sit on the building outline, not landlocked (parking, verandah) */
  outdoor: boolean
  /** who a bedroom is for — find the master by role, never by id */
  role?: 'master' | 'parents' | 'child' | 'guest' | 'staff'
}

export type RelationKind = 'adjacent' | 'near' | 'connected' | 'separated'
export type Relationship = { a: string; b: string; kind: RelationKind }

export type FloorProgram = {
  level: number
  name: string
  spaces: SpaceReq[]
}

export type CanonicalModel = {
  seed: string
  brief: Brief
  /** buildable envelope in plan coordinates: the approach is drawn at the bottom */
  envelope: { width: number; depth: number }
  plot: { width: number; depth: number }
  legalSetbacksMm?: Record<Direction, number>
  siteNotes?: string[]
  setbacksMm: Record<Direction, number>
  grid: number
  entrySide: Direction
  floors: FloorProgram[]
  relationships: Relationship[]
  /** Outdoor programme, placed against the actual free plot by the planner. */
  siteRequirements: { garden: boolean; compoundWall: boolean; utilityYard: boolean; sitOut: boolean }
}

/**
 * The plan is always drawn with the road / entry at plan-south. For the real
 * entry side, planToCompass[entrySide][planSide] is that plan side's true
 * compass bearing (plan N on a north-facing plot is really south).
 */
export const planToCompass: Record<Direction, Record<Direction, Direction>> = {
  S: { N: 'N', E: 'E', S: 'S', W: 'W' },
  N: { N: 'S', E: 'W', S: 'N', W: 'E' },
  E: { N: 'W', E: 'N', S: 'E', W: 'S' },
  W: { N: 'E', E: 'S', S: 'W', W: 'N' },
}

/** Conditions that make even a minimum building footprint impossible. */
export function briefSiteIssues(brief: Brief): string[] {
  const { margins } = resolveOpenSpace(brief.site)
  const usableWidth = brief.site.plotWidth - margins.E - margins.W
  const usableDepth = brief.site.plotDepth - margins.N - margins.S
  const issues: string[] = []
  if (usableWidth < 6) issues.push(`The east–west buildable width is ${usableWidth.toFixed(1)} m; increase the plot width or reduce the east/west setbacks to leave at least 6 m.`)
  if (usableDepth < 6) issues.push(`The north–south buildable depth is ${usableDepth.toFixed(1)} m; increase the plot depth or reduce the north/south setbacks to leave at least 6 m.`)
  return issues
}

/**
 * Room area presets in m² — [min, target, max]. Indian residential.
 * `min` follows NBC 2016 habitable-room minimums; `target` / `max` are widened
 * to the p50 / p90 of the ResPlan reference norms (scripts/resplan_stats.json)
 * so a well-proportioned villa doesn't trip the "over maximum" advisory.
 * Regenerate that file against ResPlan.zip and re-tune here.
 */
const AREA: Record<string, [number, number, number]> = {
  foyer: [3, 5, 9],
  living: [14, 22, 34],
  dining: [9, 14, 22],
  livingDining: [22, 34, 50],
  kitchen: [7, 11, 18],
  utility: [3, 5.5, 10],
  wetKitchen: [5, 7, 11],
  pooja: [1.5, 3.5, 7],
  circulation: [4, 8, 16],
  stair: [5.5, 7, 9],
  lobby: [5, 8, 13],
  familyLounge: [14, 20, 32],
  masterBed: [11, 15, 22],
  bed: [9, 12.5, 19],
  study: [6, 10, 16],
  attachedBath: [2.8, 4, 6.5],
  sharedBath: [2.8, 4.5, 7],
  lift: [2.6, 4, 7],
  balcony: [3, 6, 11],
  coveredParking: [13.5, 18, 26],
  coveredVerandah: [8, 12, 20],
  courtyard: [8, 12, 24],
}

function mk(
  id: string,
  name: string,
  zone: Zone,
  preset: keyof typeof AREA,
  opts: Partial<Pick<SpaceReq, 'wantsWindow' | 'wet' | 'outdoor'>> = {},
): SpaceReq {
  const [min, target, max] = AREA[preset]
  return {
    id,
    name,
    zone,
    min,
    target,
    max,
    wantsWindow:
      opts.wantsWindow ??
      (zone === 'social' || zone === 'private' || zone === 'work' || zone === 'service'),
    wet: opts.wet ?? false,
    outdoor: opts.outdoor ?? false,
  }
}

/** FNV-1a hash → short hex string. Deterministic seed from the brief, ignoring
 *  the `variation` nonce so the massing grammar's brief-key stays stable across
 *  re-rolls (the seed integer is what varies). */
function hashSeed(brief: Brief): string {
  const s = JSON.stringify({ ...brief, variation: 0 })
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

const ordinalFloor = (level: number): string =>
  level === 0 ? 'Ground floor' : `Floor ${level}`

export function compile(brief: Brief): CanonicalModel {
  const seed = `${hashSeed(brief)}-${brief.variation}`
  const grid = 100

  const entrySide: Direction = brief.entry.primarySide === 'auto'
    ? (brief.site.roadEdges.includes(brief.site.facing) ? brief.site.facing : brief.site.roadEdges[0])
    : brief.entry.primarySide
  const oriented = planToCompass[entrySide]

  const { margins, notes: siteNotes } = resolveOpenSpace(brief.site)
  const legalSetbacksMm = Object.fromEntries(
    (['N', 'E', 'S', 'W'] as Direction[]).map((side) =>
      [side, Math.round(brief.site.setbacks[oriented[side]] * 1000)]),
  ) as Record<Direction, number>
  const setbacksMm = Object.fromEntries(
    (['N', 'E', 'S', 'W'] as Direction[]).map(side => [side, Math.round(margins[oriented[side]] * 1000)]),
  ) as Record<Direction, number>
  const eastWestApproach = entrySide === 'E' || entrySide === 'W'
  const plot = {
    width: Math.round((eastWestApproach ? brief.site.plotDepth : brief.site.plotWidth) * 1000),
    depth: Math.round((eastWestApproach ? brief.site.plotWidth : brief.site.plotDepth) * 1000),
  }
  const envelope = {
    width: plot.width - setbacksMm.E - setbacksMm.W,
    depth: plot.depth - setbacksMm.N - setbacksMm.S,
  }

  const storeys = brief.levels.storeys // additional floors above ground
  const hasUpper = storeys > 0
  const p = brief.rooms.priorities

  // --- "Large villa" typology: grander rooms, and a central courtyard when the
  // plot is deep enough to hold one without starving the habitable rooms. ---
  const large = brief.project.buildingType === 'large-villa'
  const wantsCourtyard = p.courtyard || (large && envelope.depth >= 14000 && envelope.width >= 11000)

  // --- distribute bedrooms across floors ---
  const members = brief.household.members
  const countRole = (role: string) => members.filter((m) => m.role === role).length
  const youngRooms = countRole('teen') + Math.ceil(countRole('child') / 2)
  const residentBeds = Math.max(1, countRole('adult') > 0 ? Math.max(1, countRole('adult') - 1) : 0) +
    Math.ceil(countRole('senior') / 2) + youngRooms
  const requestedBeds = brief.rooms.bedroomsWithBath + brief.rooms.bedroomsNoBath
  const frequentGuests = brief.household.guests === 'frequent'
  const totalBeds = requestedBeds + (frequentGuests && requestedBeds <= residentBeds ? 1 : 0)
  const studyCount = Math.max(brief.rooms.studies, Math.min(2, brief.lifestyle.wfhCount),
    brief.lifestyle.clientVisits || brief.household.guests === 'occasional' ? 1 : 0)
  // clients visit the home office: the first study sits on the ground floor
  // beside the foyer; with no clients, studies stay upstairs where it is quiet
  const clientStudy = brief.lifestyle.clientVisits && studyCount > 0
  // members who need the ground floor share rooms two at a time
  const groundSeniorRooms = Math.ceil(brief.household.members.filter((m) => m.needsGroundFloor).length / 2)
  const groundBeds = !hasUpper ? totalBeds
    : Math.min(totalBeds, Math.max(groundSeniorRooms, brief.spaces.stepFree && totalBeds > 0 ? 1 : 0))
  const upperBeds = totalBeds - groundBeds
  const upperFloors = Math.max(1, storeys)
  const bedsPerUpper = hasUpper ? Math.ceil(upperBeds / upperFloors) : 0
  const groundSharedBaths = !hasUpper ? brief.rooms.sharedBaths : Math.min(1, brief.rooms.sharedBaths)
  const upperSharedBaths = brief.rooms.sharedBaths - groundSharedBaths

  let bedNo = 0
  let bathNo = 0
  // ground-floor senior rooms are "Parents' bedroom"; the master is the first
  // bedroom on an upper floor (or, on a ground-only house, the first that is
  // not a parents' room). Both get the master-bedroom area preset.
  let parentsLeft = Math.min(groundSeniorRooms, groundBeds)
  let masterPlaced = false
  let youngLeft = youngRooms
  const nextBed = (onGround: boolean): SpaceReq => {
    bedNo += 1
    const id = `bed${bedNo}`
    if (onGround && parentsLeft > 0) {
      parentsLeft -= 1
      return { ...mk(id, "Parents' bedroom", 'private', 'masterBed'), role: 'parents' }
    }
    if (!masterPlaced && (!onGround || !hasUpper)) {
      masterPlaced = true
      return { ...mk(id, 'Master bedroom', 'private', 'masterBed'), role: 'master' }
    }
    if (frequentGuests && bedNo === totalBeds) return { ...mk(id, 'Guest bedroom', 'private', 'bed'), role: 'guest' }
    if (youngLeft > 0) {
      youngLeft -= 1
      return { ...mk(id, 'Child / teen bedroom', 'private', 'bed'), role: 'child' }
    }
    return mk(id, `Bedroom ${bedNo}`, 'private', 'bed')
  }
  const withBathBudget = { n: brief.rooms.bedroomsWithBath }
  const nextBath = (owner: SpaceReq): SpaceReq | null => {
    if (withBathBudget.n <= 0 && owner.role !== 'guest') return null
    if (withBathBudget.n > 0) withBathBudget.n -= 1
    bathNo += 1
    return mk(`bath${bathNo}`, `Attached bath ${bathNo}`, 'service', 'attachedBath', {
      wet: true,
      wantsWindow: false,
    })
  }

  const floors: FloorProgram[] = []
  const rel: Relationship[] = []
  const addRel = (a: string, b: string, kind: RelationKind) => rel.push({ a, b, kind })

  // ---------------- ground floor ----------------
  {
    const spaces: SpaceReq[] = []
    const foyer = mk('foyer', 'Entry foyer', 'circulation', 'foyer', { wantsWindow: false })
    spaces.push(foyer)

    if (brief.spaces.livingDining === 'combined') {
      spaces.push(mk('livingDining', 'Living / dining', 'social', 'livingDining'))
      addRel('foyer', 'livingDining', 'connected')
      addRel('livingDining', 'kitchen', 'near')
    } else {
      spaces.push(mk('living', 'Living room', 'social', 'living'))
      spaces.push(mk('dining', 'Dining', 'social', 'dining'))
      addRel('foyer', 'living', 'connected')
      addRel('living', 'dining', 'near')
      addRel('dining', 'kitchen', 'adjacent')
    }
    spaces.push(mk('kitchen', 'Kitchen', 'service', 'kitchen', { wet: true }))

    if (p.utility || brief.lifestyle.dryWetSplit || brief.household.staff !== 'none') {
      // a dry / wet split turns the utility into a real second kitchen
      spaces.push(brief.lifestyle.dryWetSplit
        ? mk('utility', 'Wet kitchen / utility', 'service', 'wetKitchen', { wet: true, wantsWindow: true })
        : mk('utility', 'Utility', 'service', 'utility', { wet: true, wantsWindow: false }))
      addRel('kitchen', 'utility', 'adjacent')
    }
    if (p.pooja) {
      const pooja = mk('pooja', 'Pooja room', 'sacred', 'pooja', { wantsWindow: false })
      if (brief.rooms.poojaPreference === 'compact') pooja.target = 2
      if (brief.rooms.poojaPreference === 'large') { pooja.min = 3; pooja.target = 6; pooja.max = 10 }
      spaces.push(pooja)
      addRel('foyer', 'pooja', 'near')
    }

    if (hasUpper) {
      spaces.push(mk('stair', 'Main stair', 'circulation', 'stair', { wantsWindow: false }))
      addRel('foyer', 'stair', 'connected')
    }

    if (brief.levels.liftProvision) {
      spaces.push(mk('lift', 'Future lift shaft', 'circulation', 'lift', { wantsWindow: false }))
      addRel('foyer', 'lift', 'connected')
    }

    for (let i = 0; i < groundBeds; i++) {
      const b = nextBed(true)
      spaces.push(b)
      addRel('foyer', b.id, 'connected')
      const bath = nextBath(b)
      if (bath) {
        spaces.push(bath)
        addRel(b.id, bath.id, 'adjacent')
      }
    }

    for (let i = 0; i < groundSharedBaths; i++) {
      const id = `sharedBath${i + 1}`
      spaces.push(mk(id, `Shared bath ${i + 1}`, 'service', 'sharedBath', { wet: true, wantsWindow: false }))
      addRel('foyer', id, 'near')
    }
    if (brief.spaces.stepFree && groundBeds > 0 && brief.rooms.bedroomsWithBath === 0 && groundSharedBaths === 0) {
      spaces.push(mk('accessibleBath', 'Ground-floor accessible bath', 'service', 'sharedBath',
        { wet: true, wantsWindow: false }))
      addRel('foyer', 'accessibleBath', 'near')
    }
    if (!hasUpper) {
      for (let i = 0; i < studyCount; i++) {
        const id = `study${i + 1}`
        spaces.push(mk(id, `Study / office ${i + 1}`, 'work', 'study'))
        addRel('foyer', id, 'connected')
      }
    } else if (clientStudy) {
      // clients reach the home office from the entrance, not through the house
      spaces.push(mk('study1', 'Study / office 1', 'work', 'study'))
    }
    if (clientStudy) addRel('foyer', 'study1', 'adjacent')

    if (brief.household.staff === 'liveIn') {
      spaces.push({ ...mk('bedStaff', 'Staff bedroom', 'private', 'bed'), role: 'staff' })
      spaces.push(mk('staffBath', 'Staff toilet / shower', 'service', 'attachedBath', { wet: true, wantsWindow: false }))
      addRel('bedStaff', 'staffBath', 'adjacent')
      addRel('utility', 'bedStaff', 'near')
    } else if (brief.household.staff === 'daily') {
      if (groundSharedBaths === 0) spaces.push(mk('staffBath', 'Staff toilet', 'service', 'sharedBath', { wet: true, wantsWindow: false }))
      addRel('utility', groundSharedBaths ? 'sharedBath1' : 'staffBath', 'near')
    }

    if (p.pooja) addRel('pooja', 'kitchen', 'separated')

    // outdoor
    if (p.coveredParking) {
      const car = mk('parking', 'Covered parking', 'outdoor', 'coveredParking', {
        outdoor: true,
        wantsWindow: false,
      })
      spaces.push(car)
    }
    if (p.coveredVerandah) {
      const ver = mk('verandah', 'Covered verandah', 'outdoor', 'coveredVerandah', {
        outdoor: true,
        wantsWindow: false,
      })
      spaces.push(ver)
      addRel('foyer', 'verandah', 'adjacent')
    }
    if (wantsCourtyard) {
      const court = mk('courtyard', 'Courtyard', 'outdoor', 'courtyard', {
        outdoor: true,
        wantsWindow: false,
      })
      if (large) {
        court.target = Math.round(court.target * 1.3)
        court.max = Math.round(court.max * 1.4)
      }
      spaces.push(court)
    }

    floors.push({ level: 0, name: ordinalFloor(0), spaces })
  }

  // ---------------- upper floors ----------------
  let bedsRemaining = upperBeds
  for (let level = 1; level <= storeys; level++) {
    const spaces: SpaceReq[] = []
    const lobby = mk(`lobby${level}`, 'Upper lobby', 'circulation', 'lobby', { wantsWindow: false })
    spaces.push(lobby)
    spaces.push(mk(`stair`, 'Main stair', 'circulation', 'stair', { wantsWindow: false }))
    addRel(`lobby${level}`, 'stair', 'connected')
    if (brief.levels.liftProvision) {
      spaces.push(mk('lift', 'Future lift shaft', 'circulation', 'lift', { wantsWindow: false }))
      addRel(`lobby${level}`, 'lift', 'connected')
    }

    if (level === 1) {
      const lounge = mk('familyLounge', 'Family lounge', 'social', 'familyLounge')
      spaces.push(lounge)
      addRel(`lobby1`, 'familyLounge', 'connected')
    }

    const take = Math.min(level === 1 ? Math.max(bedsPerUpper, 1 + youngRooms) : bedsPerUpper, bedsRemaining)
    for (let i = 0; i < take; i++) {
      const b = nextBed(false)
      spaces.push(b)
      addRel(`lobby${level}`, b.id, 'connected')
      const bath = nextBath(b)
      if (bath) {
        spaces.push(bath)
        addRel(b.id, bath.id, 'adjacent')
      }
    }
    bedsRemaining -= take

    for (let i = 0; i < upperSharedBaths; i++) {
      if (1 + (i % storeys) !== level) continue
      const n = groundSharedBaths + i + 1
      const id = `sharedBath${n}`
      spaces.push(mk(id, `Shared bath ${n}`, 'service', 'sharedBath', { wet: true, wantsWindow: false }))
      addRel(`lobby${level}`, id, 'near')
    }
    for (let i = 0; i < studyCount; i++) {
      if (i === 0 && clientStudy) continue // already on the ground floor
      if (1 + (i % storeys) !== level) continue
      const id = `study${i + 1}`
      spaces.push(mk(id, `Study / office ${i + 1}`, 'work', 'study'))
      addRel(`lobby${level}`, id, 'connected')
    }
    if (brief.rooms.balcony) {
      spaces.push(
        mk(`balcony${level}`, 'Balcony', 'outdoor', 'balcony', { outdoor: true, wantsWindow: false }),
      )
    }

    floors.push({ level, name: ordinalFloor(level), spaces })
  }

  // Household and lifestyle requirements affect geometry through room targets
  // and ordered relationships, independent of their contribution to the seed.
  const allSpaces = floors.flatMap((f) => f.spaces)
  const socialScale = 1 + Math.max(0, members.length - 4) * .04 +
    (brief.household.guests === 'frequent' ? .12 : brief.household.guests === 'occasional' ? .04 : 0)
  for (const s of allSpaces) {
    if (s.zone === 'social') { s.target = Math.min(s.max, Math.round(s.target * socialScale * 10) / 10) }
    if (s.role === 'master' && countRole('infant')) s.target = Math.min(s.max, s.target + countRole('infant') * 2)
    if (s.zone === 'work') {
      s.target = Math.min(s.max, s.target + Math.max(0, brief.lifestyle.wfhCount - studyCount) * 2)
      for (const bed of allSpaces.filter((r) => r.zone === 'private')) addRel(s.id, bed.id, 'separated')
    }
    if (s.role === 'child') {
      const master = allSpaces.find((r) => r.role === 'master')
      if (master) addRel(master.id, s.id, 'near')
    }
  }

  // --- "Large villa": inflate the habitable programme so the planner lays out
  // genuinely generous rooms. Wet / service rooms stay near normal (a bigger
  // bathroom is wasted); circulation grows modestly to keep proportions. ---
  if (large) {
    const bump: Partial<Record<Zone, number>> = {
      social: 1.3,
      private: 1.22,
      work: 1.2,
      sacred: 1.12,
      circulation: 1.12,
      service: 1.06,
    }
    const r1 = (n: number) => Math.round(n * 10) / 10
    for (const f of floors) {
      for (const s of f.spaces) {
        const k = s.outdoor ? undefined : bump[s.zone]
        if (!k) continue
        s.min = r1(s.min * k)
        s.target = r1(s.target * k)
        s.max = r1(s.max * k)
      }
    }
  }

  // Keep every requested room and minimum. A tight budget only reduces target
  // generosity; unaffordable minimum programmes remain visibly over budget.
  const enclosed = allSpaces.filter((s) => !s.outdoor)
  const minimum = enclosed.reduce((a, s) => a + s.min, 0)
  const preferred = enclosed.reduce((a, s) => a + s.target, 0)
  const affordable = brief.budget.amountLakh * 1e5 / costPerSqmAllIn(brief) / 1.32
  const generosity = Math.max(0, Math.min(1, (affordable - minimum) / Math.max(1, preferred - minimum)))
  for (const s of enclosed) {
    s.preferredTarget = s.target
    s.target = Math.round((s.min + (s.target - s.min) * generosity) * 10) / 10
  }
  return { seed, brief, envelope, plot, setbacksMm, legalSetbacksMm, siteNotes, grid, entrySide, floors, relationships: rel,
    siteRequirements: { garden: p.garden, compoundWall: p.compoundWall,
      utilityYard: p.utility || brief.lifestyle.dryWetSplit || brief.household.staff !== 'none', sitOut: p.coveredVerandah } }
}

/** Summary numbers for the review screen. */
export function canonicalSummary(model: CanonicalModel) {
  const spaceCount = model.floors.reduce((n, f) => n + f.spaces.length, 0)
  const minArea = model.floors.reduce(
    (sum, f) => sum + f.spaces.filter((s) => !s.outdoor).reduce((a, s) => a + s.min, 0),
    0,
  )
  const usablePerFloor = (model.envelope.width / 1000) * (model.envelope.depth / 1000) * 0.82
  return {
    spaceCount,
    relationshipCount: model.relationships.length,
    minArea: Math.round(minArea * 10) / 10,
    usablePerFloor: Math.round(usablePerFloor * 10) / 10,
    floors: model.floors.length,
  }
}
