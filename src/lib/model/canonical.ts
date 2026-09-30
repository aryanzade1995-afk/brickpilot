import type { Brief, Direction } from './brief.ts'

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
  min: number
  max: number
  /** wants at least one exterior wall (for daylight) */
  wantsWindow: boolean
  /** plumbing — cluster these to share wet walls */
  wet: boolean
  /** must sit on the building outline, not landlocked (parking, verandah) */
  outdoor: boolean
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
  setbacksMm: Record<Direction, number>
  grid: number
  entrySide: Direction
  floors: FloorProgram[]
  relationships: Relationship[]
}

/** Conditions that make even a minimum building footprint impossible. */
export function briefSiteIssues(brief: Brief): string[] {
  const usableWidth = brief.site.plotWidth - brief.site.setbacks.E - brief.site.setbacks.W
  const usableDepth = brief.site.plotDepth - brief.site.setbacks.N - brief.site.setbacks.S
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
  const planToCompass: Record<Direction, Record<Direction, Direction>> = {
    S: { N: 'N', E: 'E', S: 'S', W: 'W' },
    N: { N: 'S', E: 'W', S: 'N', W: 'E' },
    E: { N: 'W', E: 'N', S: 'E', W: 'S' },
    W: { N: 'E', E: 'S', S: 'W', W: 'N' },
  }
  const oriented = planToCompass[entrySide]
  const setbacksMm = Object.fromEntries(
    (['N', 'E', 'S', 'W'] as Direction[]).map((side) =>
      [side, Math.round(brief.site.setbacks[oriented[side]] * 1000)]),
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
  const totalBeds = brief.rooms.bedroomsWithBath + brief.rooms.bedroomsNoBath
  const groundBeds = !hasUpper ? totalBeds : brief.spaces.stepFree && totalBeds > 0 ? 1 : 0
  const upperBeds = totalBeds - groundBeds
  const upperFloors = Math.max(1, storeys)
  const bedsPerUpper = hasUpper ? Math.ceil(upperBeds / upperFloors) : 0
  const groundSharedBaths = !hasUpper ? brief.rooms.sharedBaths : Math.min(1, brief.rooms.sharedBaths)
  const upperSharedBaths = brief.rooms.sharedBaths - groundSharedBaths

  let bedNo = 0
  let bathNo = 0
  const nextBed = (): SpaceReq => {
    bedNo += 1
    const preset = bedNo === 1 ? 'masterBed' : 'bed'
    return mk(`bed${bedNo}`, bedNo === 1 ? 'Master bedroom' : `Bedroom ${bedNo}`, 'private', preset)
  }
  const withBathBudget = { n: brief.rooms.bedroomsWithBath }
  const nextBath = (): SpaceReq | null => {
    if (withBathBudget.n <= 0) return null
    withBathBudget.n -= 1
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

    if (p.utility) {
      spaces.push(mk('utility', 'Utility', 'service', 'utility', { wet: true, wantsWindow: false }))
      addRel('kitchen', 'utility', 'adjacent')
    }
    if (p.pooja) {
      spaces.push(mk('pooja', 'Pooja room', 'sacred', 'pooja', { wantsWindow: false }))
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
      const b = nextBed()
      spaces.push(b)
      addRel('foyer', b.id, 'connected')
      const bath = nextBath()
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
      for (let i = 0; i < brief.rooms.studies; i++) {
        const id = `study${i + 1}`
        spaces.push(mk(id, `Study / office ${i + 1}`, 'work', 'study'))
        addRel('foyer', id, 'connected')
      }
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

    const take = Math.min(bedsPerUpper, bedsRemaining)
    for (let i = 0; i < take; i++) {
      const b = nextBed()
      spaces.push(b)
      addRel(`lobby${level}`, b.id, 'connected')
      const bath = nextBath()
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
    for (let i = 0; i < brief.rooms.studies; i++) {
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

  return { seed, brief, envelope, plot, setbacksMm, grid, entrySide, floors, relationships: rel }
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
