import type { Rect } from '../../geometry.ts'
import { occupantCount } from '../../model/brief.ts'
import type { CanonicalModel, SpaceReq } from '../../model/canonical.ts'
import type { FloorRequirements, NormalizedBrief, RoomKind, RoomReq, SiteModel, Unit } from './types.ts'

/* ---------------------------- planning constants ---------------------------- */

export const MODULE = 100
export const EXT_WALL = 230
export const INT_WALL = 115
export const BAND_WALL = 230
export const COLUMN = 300
export const MIN_BAND = 3000
export const MAX_SPAN = 5000
export const MIN_SPAN = 1800
export const MAX_BEAM_SPAN = 6000
export const MAX_CANTILEVER = 1500
export const BALCONY_DEPTH = 1500
export const LIFT_SLOT = 1800
export const PARKING_DEPTH = 5000
export const VERANDAH_DEPTH = 2600
export const YARD_GAP = 300
export const RISER_MAX = 175
export const GOING = 250

export const snap = (v: number): number => Math.round(v / MODULE) * MODULE
export const snapUp = (v: number): number => Math.ceil(v / MODULE - 1e-9) * MODULE
export const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v))

export const FLOOR_PREFIX = ['GF', 'FF', 'SF', 'TF']
export const floorPrefix = (level: number): string => FLOOR_PREFIX[level] ?? `L${level}`

/* ------------------------------ NormalizedBrief ----------------------------- */

/** The only brief facts the planner may use. An LLM may help fill the Brief;
 *  it never reaches this layer, and nothing here carries coordinates. */
export function normalizeBrief(model: CanonicalModel): NormalizedBrief {
  const b = model.brief
  return {
    storeys: b.levels.storeys,
    floorToFloorMm: Math.round(b.levels.floorToFloor * 1000),
    flightWidthMm: snap(clamp(b.levels.stairWidth, 900, 1500)),
    lift: b.levels.liftProvision,
    large: b.project.buildingType === 'large-villa',
    mainDoorMm: snap(clamp(b.entry.mainDoorWidth, 900, 1500)),
    twoCar: occupantCount(b) >= 4,
    floors: model.floors,
    relationships: model.relationships,
  }
}

/* --------------------------------- StairCore -------------------------------- */

/** dog-leg stair: two flights across the band, landing against the outer wall */
export function stairGeometry(nb: NormalizedBrief) {
  const risers = Math.ceil(nb.floorToFloorMm / RISER_MAX)
  const perFlight = Math.ceil(risers / 2)
  const run = (perFlight - 1) * GOING
  const landing = nb.flightWidthMm
  return {
    risers,
    perFlight,
    run,
    landing,
    /** slot width along the spine: two flights, a 100 mm well, walls */
    slotWidth: snapUp(nb.flightWidthMm * 2 + 100 + 300),
    /** clear depth the band must offer */
    depth: snapUp(run + landing + 300),
  }
}

/* --------------------------------- SiteModel -------------------------------- */

/**
 * `front`: parking / verandah in a strip across the road side (the default).
 * `side`: on a shallow plot the house takes the full depth and the car porch
 * moves beside it, flush with the front setback line.
 */
export function siteModel(model: CanonicalModel, yard: 'front' | 'side' = 'front'): SiteModel {
  const plot: Rect = { x: 0, y: 0, w: model.plot.width, h: model.plot.depth }
  const envelope: Rect = {
    x: model.setbacksMm.W,
    y: model.setbacksMm.N,
    w: model.envelope.width,
    h: model.envelope.depth,
  }
  const ground = new Set(model.floors[0].spaces.map((s) => s.id))
  if (yard === 'side') {
    const carW = ground.has('parking') ? (occupantCount(model.brief) >= 4 ? 5200 : 3000) + YARD_GAP : 0
    return { plot, envelope, frontStripMm: 0, houseZone: { ...envelope, w: Math.max(0, envelope.w - carW) } }
  }
  let frontStripMm = 0
  if (ground.has('parking')) frontStripMm = PARKING_DEPTH + YARD_GAP
  else if (ground.has('verandah')) frontStripMm = VERANDAH_DEPTH + YARD_GAP
  // a front balcony oversails the front yard — keep it inside the setback line
  const balcony = model.floors.some((f) => f.spaces.some((s) => s.id.startsWith('balcony')))
  if (balcony) frontStripMm = Math.max(frontStripMm, BALCONY_DEPTH)
  const houseZone: Rect = { ...envelope, h: Math.max(0, envelope.h - frontStripMm) }
  return { plot, envelope, frontStripMm, houseZone }
}

/* ---------------------------- ProgramRequirements --------------------------- */

const KIND_MIN_WIDTH: Record<RoomKind, number> = {
  foyer: 2000, living: 3000, dining: 2700, livingDining: 3300, kitchen: 2400, utility: 1500,
  pooja: 1200, stair: 0, lift: 0, corridor: 0, lobby: 0, lounge: 3000, bed: 2700,
  ensuite: 1500, bath: 1500, study: 2400, parking: 0, verandah: 0, courtyard: 0, balcony: 2000,
}

function kindOf(space: SpaceReq, ensuites: Set<string>): RoomKind {
  const id = space.id
  if (id === 'foyer') return 'foyer'
  if (id === 'livingDining') return 'livingDining'
  if (id === 'living') return 'living'
  if (id === 'dining') return 'dining'
  if (id === 'kitchen') return 'kitchen'
  if (id === 'utility') return 'utility'
  if (id === 'pooja') return 'pooja'
  if (id === 'stair') return 'stair'
  if (id === 'lift') return 'lift'
  if (id.startsWith('lobby')) return 'lobby'
  if (id === 'familyLounge') return 'lounge'
  if (id.startsWith('study')) return 'study'
  if (id === 'parking') return 'parking'
  if (id === 'verandah') return 'verandah'
  if (id === 'courtyard') return 'courtyard'
  if (id.startsWith('balcony')) return 'balcony'
  if (ensuites.has(id)) return 'ensuite'
  if (space.wet) return 'bath'
  if (id.startsWith('bed')) return 'bed'
  return 'study'
}

const two = (n: number) => String(n).padStart(2, '0')

function semanticName(space: SpaceReq, kind: RoomKind, ownerOf: Map<string, string>): string {
  const id = space.id
  const num = (re: RegExp) => Number(id.match(re)?.[1] ?? 1)
  switch (kind) {
    case 'livingDining': return 'LIVING_DINING'
    case 'lounge': return 'FAMILY_LOUNGE'
    case 'lobby': return 'LOBBY'
    case 'bed': return id === 'bedStaff' ? 'STAFF_BED' : space.role === 'master' ? 'MASTER_BED' : `BED_${two(num(/bed(\d+)/))}`
    case 'ensuite': {
      const owner = ownerOf.get(id) ?? ''
      return owner === 'bedStaff' ? 'STAFF_BATH' : owner === 'bed1' ? 'MASTER_BATH' : `BED_${two(Number(owner.replace('bed', '')) || 0)}_BATH`
    }
    case 'bath':
      return id === 'accessibleBath' ? 'ACCESSIBLE_BATH' : `COMMON_BATH_${two(num(/(\d+)$/))}`
    case 'study': return `STUDY_${two(num(/(\d+)$/))}`
    default: return kind.toUpperCase()
  }
}

function req(space: SpaceReq, level: number, ensuites: Set<string>, ownerOf: Map<string, string>): RoomReq {
  const kind = kindOf(space, ensuites)
  return {
    id: space.id,
    semanticId: `${floorPrefix(level)}_${semanticName(space, kind, ownerOf)}`,
    name: space.name,
    zone: space.zone,
    kind,
    minSqm: space.min,
    targetSqm: space.target,
    maxSqm: space.max,
    minWidthMm: KIND_MIN_WIDTH[kind],
    wet: space.wet,
    habitable: space.zone === 'social' || space.zone === 'private' || space.zone === 'work',
    outdoor: space.outdoor,
    parent: ownerOf.get(space.id),
    space,
  }
}

function spineReq(level: number, lobby: SpaceReq | undefined, foyer?: RoomReq): RoomReq {
  // single-loaded ground floor: the entrance hall IS the foyer, run full length
  if (foyer) return { ...foyer, targetSqm: foyer.targetSqm, maxSqm: 999, minWidthMm: 0 }
  const space: SpaceReq = lobby ?? {
    id: 'corridor', name: 'Corridor', zone: 'circulation', target: 8, min: 3, max: 999,
    wantsWindow: false, wet: false, outdoor: false,
  }
  return {
    id: space.id,
    semanticId: `${floorPrefix(level)}_${lobby ? 'LOBBY' : 'CORRIDOR'}`,
    name: lobby ? space.name : 'Corridor',
    zone: 'circulation',
    kind: lobby ? 'lobby' : 'corridor',
    minSqm: 0, targetSqm: space.target, maxSqm: 999, minWidthMm: 0,
    wet: false, habitable: false, outdoor: false, space,
  }
}

/**
 * RoomGraph: turn each floor's programme into ordered, indivisible units —
 * the stair core, the kitchen suite (dining → kitchen → utility share walls),
 * each bedroom with its ensuite — each with a band preference.
 */
export function programRequirements(nb: NormalizedBrief, stairSlot: number, singleLoaded = false): FloorRequirements[] {
  const ownerOf = new Map<string, string>()
  for (const rel of nb.relationships) {
    if (rel.kind !== 'adjacent') continue
    const bed = nb.floors.flatMap((f) => f.spaces).find((s) => s.id === rel.a && s.zone === 'private')
    const bath = nb.floors.flatMap((f) => f.spaces).find((s) => s.id === rel.b && s.wet)
    if (bed && bath) ownerOf.set(bath.id, bed.id)
  }
  const ensuites = new Set(ownerOf.keys())

  return nb.floors.map((fp) => {
    const level = fp.level
    const all = fp.spaces.map((s) => req(s, level, ensuites, ownerOf))
    const byId = new Map(all.map((r) => [r.id, r]))
    const lobby = fp.spaces.find((s) => s.id.startsWith('lobby'))
    const foyer = singleLoaded && level === 0 ? all.find((r) => r.kind === 'foyer') : undefined
    const spine = spineReq(level, lobby, foyer)
    const rooms = all.filter((r) => !r.outdoor && r.kind !== 'lobby' && r !== foyer)
    const outdoor = all.filter((r) => r.outdoor)
    const units: Unit[] = []
    const used = new Set<string>()
    // a foyer serving as the entrance hall is the spine, not a room of its own
    if (foyer) used.add(foyer.id)
    const unit = (key: string, rs: (RoomReq | undefined)[], band: 'A' | 'B', movable: boolean, anchor = false) => {
      const list = rs.filter((r): r is RoomReq => !!r && !used.has(r.id))
      if (!list.length) return
      list.forEach((r) => used.add(r.id))
      units.push({ key, rooms: list, band, movable, anchor })
    }

    const stair = byId.get('stair')
    const lift = byId.get('lift')
    if (stair) stair.fixedWidthMm = stairSlot
    if (lift) lift.fixedWidthMm = LIFT_SLOT
    if (stair) unit('core', [stair, lift], 'A', false, true)
    else if (lift) unit('lift', [lift], 'A', true)

    unit('foyer', [byId.get('foyer')], 'B', false, true)
    // a home office clients visit sits directly beside the foyer, pinned there
    // (anchored, not movable) so balancing never carries it into the house
    const clientStudy = level === 0 &&
      nb.relationships.some((r) => r.kind === 'adjacent' && r.a === 'foyer' && r.b === 'study1')
    if (clientStudy) unit('study1', [byId.get('study1')], 'B', false, true)
    unit('living', [byId.get('livingDining') ?? byId.get('living')], 'B', false)
    unit('lounge', [byId.get('familyLounge')], 'B', false)
    // kitchen suite: dining meets the spine first, utility at the far end
    unit('kitchen', [byId.get('dining'), byId.get('kitchen'), byId.get('utility')], 'A', false)
    unit('pooja', [byId.get('pooja')], 'A', true)

    for (const r of rooms.filter((x) => x.kind === 'bed')) {
      const bath = rooms.find((x) => x.parent === r.id)
      unit(r.id, [r, bath], level === 0 ? 'B' : 'A', true)
    }
    for (const r of rooms.filter((x) => x.kind === 'bath')) unit(r.id, [r], 'A', true)
    for (const r of rooms.filter((x) => x.kind === 'study')) unit(r.id, [r], 'B', true)
    // anything not yet placed (future programme types) still gets a unit
    for (const r of rooms) unit(r.id, [r], 'B', true)

    // Keep staff accommodation together at the utility end of the service wing.
    const staff = units.find((u) => u.key === 'bedStaff')
    if (staff) {
      staff.band = 'A'; staff.movable = false
      units.splice(units.indexOf(staff), 1)
      units.splice(units.findIndex((u) => u.key === 'kitchen') + 1, 0, staff)
    }
    // Child/teen rooms share a bedroom wing with the master, not a remote floor.
    const family = units.filter((u) => u.rooms.some((r) => r.space.role === 'master' || r.space.role === 'child'))
    if (family.length === 2) {
      const first = Math.min(...family.map((u) => units.indexOf(u)))
      const cluster: Unit = { key: 'familyBedrooms', rooms: family.flatMap((u) => u.rooms), band: 'A', movable: true, anchor: false }
      family.forEach((u) => units.splice(units.indexOf(u), 1))
      units.splice(first, 0, cluster)
    }

    // one band of rooms: everything lines the hall, in programme order
    if (singleLoaded) for (const u of units) {
      u.band = 'A'
      u.movable = false
    }
    return { level, prefix: floorPrefix(level), rooms, spine, units, outdoor }
  })
}

/** width a room wants / needs in a band of depth `d` */
export function roomWidths(r: RoomReq, d: number): { min: number; target: number; max: number } {
  if (r.fixedWidthMm) return { min: r.fixedWidthMm, target: r.fixedWidthMm, max: r.fixedWidthMm }
  // keep habitable / sacred rooms under a 3.3 : 1 proportion
  const proportion = r.zone === 'service' || r.zone === 'circulation' ? 0 : d / 3.3
  const min = Math.max(r.minWidthMm, proportion, (r.minSqm * 1e6) / d)
  const target = Math.max(min, (r.targetSqm * 1e6) / d)
  const max = Math.max(target, Math.min((r.maxSqm * 1e6) / d, d * 3.3))
  return { min, target, max }
}

export const unitLength = (u: Unit, d: number, which: 'min' | 'target'): number =>
  u.rooms.reduce((a, r) => a + roomWidths(r, d)[which], 0)
