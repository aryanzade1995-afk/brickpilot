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
  /** buildable envelope (plot minus setbacks) in millimetres */
  envelope: { width: number; depth: number }
  plot: { width: number; depth: number }
  setbacksMm: Record<Direction, number>
  grid: number
  entrySide: Direction
  floors: FloorProgram[]
  relationships: Relationship[]
}

/** Room area presets in m² — [min, target, max]. Rough Indian residential. */
const AREA: Record<string, [number, number, number]> = {
  foyer: [3, 5, 8],
  living: [16, 22, 30],
  dining: [9, 13, 18],
  livingDining: [24, 32, 42],
  kitchen: [8, 12, 16],
  utility: [3.5, 6, 9],
  pooja: [2, 4, 6],
  circulation: [4, 8, 14],
  stair: [5.5, 7, 9],
  lobby: [5, 8, 12],
  familyLounge: [14, 20, 28],
  masterBed: [12, 15, 20],
  bed: [10, 13, 17],
  study: [7, 10, 14],
  attachedBath: [3, 4, 5.5],
  sharedBath: [3, 4.5, 6],
  balcony: [4, 6, 10],
  coveredParking: [13.5, 18, 24],
  coveredVerandah: [8, 12, 18],
  courtyard: [8, 12, 20],
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

/** FNV-1a hash → short hex string. Deterministic seed from the brief. */
function hashSeed(brief: Brief): string {
  const s = JSON.stringify(brief)
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

  const setbacksMm: Record<Direction, number> = {
    N: Math.round(brief.site.setbacks.N * 1000),
    E: Math.round(brief.site.setbacks.E * 1000),
    S: Math.round(brief.site.setbacks.S * 1000),
    W: Math.round(brief.site.setbacks.W * 1000),
  }
  const plot = {
    width: Math.round(brief.site.plotWidth * 1000),
    depth: Math.round(brief.site.plotDepth * 1000),
  }
  const envelope = {
    width: plot.width - setbacksMm.E - setbacksMm.W,
    depth: plot.depth - setbacksMm.N - setbacksMm.S,
  }

  const entrySide: Direction =
    brief.entry.primarySide === 'auto' ? brief.site.roadEdges[0] : brief.entry.primarySide

  const storeys = brief.levels.storeys // additional floors above ground
  const hasUpper = storeys > 0
  const p = brief.rooms.priorities

  // --- "Large villa" typology: grander rooms, and a central courtyard when the
  // plot is deep enough to hold one without starving the habitable rooms. ---
  const large = brief.project.buildingType === 'large-villa'
  const wantsCourtyard = p.courtyard || (large && envelope.depth >= 14000 && envelope.width >= 11000)

  // --- distribute bedrooms across floors ---
  const totalBeds = brief.rooms.bedroomsWithBath + brief.rooms.bedroomsNoBath
  const groundBeds = brief.spaces.stepFree && totalBeds > 0 ? 1 : 0
  const upperBeds = totalBeds - groundBeds
  const upperFloors = Math.max(1, storeys)
  const bedsPerUpper = hasUpper ? Math.ceil(upperBeds / upperFloors) : 0

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

    if (groundBeds > 0) {
      const b = nextBed()
      spaces.push(b)
      addRel('foyer', b.id, 'connected')
      const bath = nextBath()
      if (bath) {
        spaces.push(bath)
        addRel(b.id, bath.id, 'adjacent')
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

    if (level === 1 && brief.rooms.sharedBaths > 0) {
      spaces.push(
        mk('sharedBath1', 'Shared bath', 'service', 'sharedBath', { wet: true, wantsWindow: false }),
      )
    }
    if (brief.rooms.studies > 0 && level === storeys) {
      spaces.push(mk('study', 'Study / office', 'work', 'study'))
      addRel(`lobby${level}`, 'study', 'connected')
    }
    if (brief.rooms.balcony) {
      spaces.push(
        mk(`balcony${level}`, 'Balcony', 'outdoor', 'balcony', { outdoor: true, wantsWindow: false }),
      )
    }

    floors.push({ level, name: ordinalFloor(level), spaces })
  }

  // --- "Large villa": inflate the habitable programme so the treemap lays out
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
