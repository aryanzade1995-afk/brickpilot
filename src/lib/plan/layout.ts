import { rectArea, rectUnionArea, rectUnionBBox, sharedEdge, toSqm, type Point, type Rect } from '../geometry.ts'
import type { CanonicalModel, FloorProgram, SpaceReq, Zone } from '../model/canonical.ts'
import { themeOf } from '../model/themes.ts'
import type { Design, FloorPlan, Opening, PlacedRoom, SiteFeature } from '../engine/types.ts'
import type { RoomKind } from '../engine/planner/types.ts'
import { beamsFor, fitOnLine, occupy, placeDoors, placeWindows, planShafts, stairRun, supportZonesFor, wallGraph, type Occupancy } from '../engine/planner/elements.ts'
import { GOING, normalizeBrief, stairGeometry } from '../engine/planner/program.ts'
import { reachability } from '../engine/planner/index.ts'
import { placeSiteFeatures } from '../engine/planner/siteFeatures.ts'
import { withEmergencyExit } from '../engine/safety.ts'
import { exposeStructuralSizing } from '../engine/structuralSizing.ts'
import { FIXED_KINDS, constraintsOf, typeOfKind, type RoomConstraints, type RoomType } from './roomTypes.ts'

/* ------------------------------------------------------------------ *
 *  A plan layout: every enclosed room of every floor as an editable
 *  object. `applyLayout` turns a layout back into a full Design (walls,
 *  doors, windows, shafts, reachability) with the planner's own placers,
 *  so an edited plan is held to exactly the rules of a generated one.
 * ------------------------------------------------------------------ */

export type LayoutRoom = {
  id: string
  semanticId: string
  name: string
  type: RoomType | 'fixed'
  kind: RoomKind
  zone: Zone
  rect: Rect
  /** a locked room is never moved, resized, swapped, deleted or expanded */
  locked: boolean
  /** circulation (stair, lift, hall, corridor, lobby): part of the structure of the plan */
  fixed: boolean
  /** an ensuite's bedroom */
  parent?: string
  constraints: RoomConstraints
  /** a vacant region the person has decided to leave empty */
  accepted?: boolean
  /** an open-air space (parking, verandah, balcony, courtyard): it stands on the plot, not inside the floor plate */
  outdoor?: boolean
}

export type FloorLayout = { level: number; rooms: LayoutRoom[] }
/** how far each outer wall of the villa has been moved from where it was generated, mm; positive is outward */
export type Outline = { N: number; S: number; E: number; W: number }
export const noOutline = (): Outline => ({ N: 0, S: 0, E: 0, W: 0 })
export const hasOutline = (o?: Outline) => !!o && (o.N !== 0 || o.S !== 0 || o.E !== 0 || o.W !== 0)
export type LayoutDoc = { version: 1; signature: string; floors: FloorLayout[]; outline?: Outline
  /** site features the person placed by hand (driveway, yards, pool, sit-out); the rest follow the house automatically */
  features?: Partial<Record<SiteFeature['kind'], Rect>> }

/* ---- moving the outer walls: every floor's edges that lie on a side of the generated ground floor move with it ---- */
const near = (a: number, b: number) => Math.abs(a - b) < 2
/** the ground-floor box the outline is measured from */
export const baseBox = (plan: Design): Rect => plan.floors[0].outline
export const boxNow = (plan: Design, o?: Outline): Rect => { const b = baseBox(plan), d = o ?? noOutline(); return { x: b.x - d.W, y: b.y - d.N, w: b.w + d.W + d.E, h: b.h + d.N + d.S } }
export function shiftRect(r: Rect, B: Rect, O: Outline): Rect {
  let { x, y, w, h } = r
  if (near(r.x, B.x)) { x -= O.W; w += O.W }
  if (near(r.x + r.w, B.x + B.w)) w += O.E
  if (near(r.y, B.y)) { y -= O.N; h += O.N }
  if (near(r.y + r.h, B.y + B.h)) h += O.S
  return { x, y, w, h }
}
const shiftPoint = (p: Point, B: Rect, O: Outline): Point => ({
  x: near(p.x, B.x) ? p.x - O.W : near(p.x, B.x + B.w) ? p.x + O.E : p.x,
  y: near(p.y, B.y) ? p.y - O.N : near(p.y, B.y + B.h) ? p.y + O.S : p.y,
})
function shiftFloor(floor: FloorPlan, B: Rect, O: Outline): FloorPlan {
  const footprint = floor.footprint.map((r) => shiftRect(r, B, O))
  const columns = floor.columns?.map((c) => ({ ...c, at: shiftPoint(c.at, B, O) }))
  const inPlate = (p: Point) => footprint.some((r) => p.x >= r.x - 1 && p.x <= r.x + r.w + 1 && p.y >= r.y - 1 && p.y <= r.y + r.h + 1)
  return {
    ...floor, footprint, outline: rectUnionBBox(footprint),
    courtyard: floor.courtyard ? shiftRect(floor.courtyard, B, O) : floor.courtyard,
    columns,
    beams: columns ? beamsFor(columns, inPlate, floor.prefix ?? 'GF') : floor.beams,
    supportZones: floor.supportZones?.map((z) => ({ ...z, rect: shiftRect(z.rect, B, O) })),
  }
}

/* ------------------------------ identification ----------------------------- */

/** the planner kind of an existing room, mirroring the programme rules */
export function kindOfRoom(room: PlacedRoom, model: CanonicalModel): RoomKind {
  const id = room.id
  if (id === 'foyer') return 'foyer'
  if (id === 'livingDining') return 'livingDining'
  if (id === 'living') return 'living'
  if (id === 'dining') return 'dining'
  if (id === 'kitchen') return 'kitchen'
  if (id === 'utility') return 'utility'
  if (id === 'pooja') return 'pooja'
  if (id === 'stair') return 'stair'
  if (id === 'lift') return 'lift'
  if (id === 'corridor') return 'corridor'
  if (id.startsWith('lobby')) return 'lobby'
  if (id === 'parking') return 'parking'
  if (id.startsWith('verandah')) return 'verandah'
  if (id.startsWith('balcony')) return 'balcony'
  if (id === 'courtyard') return 'courtyard'
  if (id.startsWith('openArea') || id.startsWith('vacant')) return 'lounge'
  if (id.startsWith('familyLounge') || id === 'poolHouse') return 'lounge'
  if (id.startsWith('study')) return 'study'
  if (id.startsWith('store')) return 'utility'
  if (room.zone === 'circulation') return 'corridor'
  const spaces = model.floors.flatMap((f) => f.spaces)
  const space = spaces.find((s) => s.id === id)
  const ownerOf = ownerMap(model)
  if (ownerOf.has(id)) return 'ensuite'
  if (space?.wet || id.startsWith('bath') || id.startsWith('shared') || id.startsWith('accessible') || id.startsWith('staffBath')) return 'bath'
  if (id.startsWith('bed')) return 'bed'
  return room.zone === 'private' ? 'bed' : room.zone === 'work' ? 'study' : room.zone === 'social' ? 'living' : room.zone === 'sacred' ? 'pooja' : 'utility'
}

function ownerMap(model: CanonicalModel): Map<string, string> {
  const spaces = model.floors.flatMap((f) => f.spaces)
  const out = new Map<string, string>()
  for (const rel of model.relationships) {
    if (rel.kind !== 'adjacent') continue
    const bed = spaces.find((s) => s.id === rel.a && s.zone === 'private')
    const bath = spaces.find((s) => s.id === rel.b && s.wet)
    if (bed && bath) out.set(bath.id, bed.id)
  }
  return out
}

export const layoutSignature = (plan: Design) => plan.id

/** every enclosed room of the plan as an editable object */
export function extractLayout(plan: Design): LayoutDoc {
  const owners = ownerMap(plan.model)
  return {
    version: 1,
    signature: layoutSignature(plan),
    outline: noOutline(),
    floors: plan.floors.map((floor) => ({
      level: floor.level,
      rooms: floor.rooms.map((r): LayoutRoom => {
        const kind = kindOfRoom(r, plan.model)
        const fixed = FIXED_KINDS.includes(kind) || r.zone === 'circulation'
        const type = fixed ? 'fixed' : typeOfKind(kind, r.id)
        const space = plan.model.floors.find((f) => f.level === floor.level)?.spaces.find((s) => s.id === r.id)
        const base = type === 'fixed' ? constraintsOf('vacant') : constraintsOf(type)
        const constraints: RoomConstraints = space && type !== 'fixed'
          ? { ...base, minSqm: space.min, targetSqm: space.target, maxSqm: space.max, plumbing: space.wet,
            windows: space.wantsWindow ? 'required' : base.windows === 'required' ? 'optional' : base.windows }
          : base
        return { id: r.id, semanticId: r.semanticId, name: r.name, type, kind, zone: r.zone, rect: { ...r.rect }, locked: false, fixed,
          ...(owners.has(r.id) ? { parent: owners.get(r.id) } : {}), ...(r.outdoor ? { outdoor: true } : {}), constraints }
      }),
    })),
  }
}

/* --------------------------------- applying -------------------------------- */

const placed = (r: LayoutRoom): PlacedRoom => ({
  id: r.id, semanticId: r.semanticId, name: r.name, zone: r.zone, rect: { ...r.rect },
  area: toSqm(rectArea(r.rect)), outdoor: !!r.outdoor, wantsWindow: !r.outdoor && r.constraints.windows === 'required' && r.type !== 'vacant' && r.type !== 'open',
})

/** the circulation room everything opens to */
function spineOf(rooms: LayoutRoom[]): string {
  return rooms.find((r) => r.id === 'corridor')?.id ?? rooms.find((r) => r.id.startsWith('lobby'))?.id ??
    [...rooms].filter((r) => r.zone === 'circulation' && r.kind !== 'stair' && r.kind !== 'foyer' && r.kind !== 'lift')
      .sort((a, b) => rectArea(b.rect) - rectArea(a.rect))[0]?.id ?? rooms.find((r) => r.id === 'foyer')?.id ?? rooms[0].id
}

/** doors for rooms the standard rules could not connect: any neighbour that keeps the plan's rules (privacy, wall type) */
function connectLeft(failed: string[], rooms: PlacedRoom[], kinds: Map<string, RoomKind>, spineId: string, columns: FloorPlan['columns'], occ: Occupancy, openings: Opening[]): string[] {
  const still: string[] = []
  const byId = new Map(rooms.map((r) => [r.id, r]))
  const canBridge = (k: RoomKind | undefined) => k !== 'bed' && k !== 'bath' && k !== 'ensuite'
  for (const id of failed) {
    const r = byId.get(id)
    if (!r || r.outdoor) continue
    const mine = kinds.get(id)
    // bedrooms and baths open to circulation only, an ensuite only to its bedroom: no bridge through another room
    if (r.zone === 'private' || mine === 'bath' || mine === 'ensuite') { still.push(id); continue }
    const options = rooms.filter((o) => o !== r && !o.outdoor && sharedEdge(r.rect, o.rect) && (sharedEdge(r.rect, o.rect)?.length ?? 0) >= 900)
      .sort((a, b) => {
        const rank = (o: PlacedRoom) => (o.id === spineId ? 0 : o.zone === 'circulation' ? 1 : canBridge(kinds.get(o.id)) ? 2 : 9)
        return rank(a) - rank(b) || (sharedEdge(r.rect, b.rect)?.length ?? 0) - (sharedEdge(r.rect, a.rect)?.length ?? 0)
      })
    let done = false
    for (const o of options) {
      if (done || (o.zone !== 'circulation' && !canBridge(kinds.get(o.id)))) continue
      const e = sharedEdge(r.rect, o.rect)!
      const h = e.side === 'N' || e.side === 'S'
      // two ordinary rooms may only share a door on a horizontal wall; a circulation room takes either
      if (!h && r.zone !== 'circulation' && o.zone !== 'circulation') continue
      const line = { orient: (h ? 'h' : 'v') as 'h' | 'v', fixed: h ? e.seg.a.y : e.seg.a.x, lo: h ? e.seg.a.x : e.seg.a.y, hi: h ? e.seg.b.x : e.seg.b.y }
      const mid = (line.lo + line.hi) / 2
      for (const width of [1000, 900, 800]) {
        const at = fitOnLine(line, width, mid, 250, columns ?? [], occ)
        if (at === null) continue
        occupy(occ, line.orient, line.fixed, at, width)
        const centre = h ? r.rect.y + r.rect.h / 2 : r.rect.x + r.rect.w / 2
        openings.push({
          id: `${r.semanticId}_LINK_OPENING`, kind: 'door', width, leaf: false, swing: centre > line.fixed ? 1 : -1, hinge: 'a', orient: line.orient,
          at: h ? { x: at, y: line.fixed } : { x: line.fixed, y: at }, rooms: [r.id, o.id],
        })
        done = true
        break
      }
    }
    if (!done) still.push(id)
  }
  return still
}

function rebuildFloor(plan: Design, floor: FloorPlan, layout: FloorLayout, lower: FloorPlan | null): FloorPlan {
  const model = plan.model
  const rooms = [...layout.rooms.filter((r) => !r.outdoor), ...layout.rooms.filter((r) => r.outdoor)].map(placed)
  const kinds = new Map<string, RoomKind>()
  const parents = new Map<string, string>()
  for (const r of layout.rooms) { kinds.set(r.id, r.kind); if (r.parent) parents.set(r.id, r.parent) }
  const kindOf = (id: string) => kinds.get(id) ?? ''
  const parentOf = (id: string) => parents.get(id)
  const spineId = spineOf(layout.rooms.filter((r) => !r.outdoor))
  const prefix = floor.prefix ?? (floor.level === 0 ? 'GF' : `F${floor.level}`)
  const lines = (plan.structure?.axes ?? []).map((a) => ({ orient: a.orient, fixed: a.at, lo: -Infinity, hi: Infinity }))
  const columns = floor.columns ?? []

  const parapets = floor.walls.filter((w) => w.kind === 'parapet')
  const walls = [...wallGraph(rooms, prefix, lines), ...parapets]
  const occ: Occupancy = new Map()
  const stair = layout.rooms.find((r) => r.id === 'stair')
  const spine = layout.rooms.find((r) => r.id === spineId)!
  const coreTarget = stair ? { x: stair.rect.x + stair.rect.w / 2, y: stair.rect.y + stair.rect.h / 2 } : { x: spine.rect.x, y: spine.rect.y }
  const mainEntry = floor.openings.find((o) => o.kind === 'entry' && !o.emergencyExit)
  const { openings: doors, failed } = placeDoors(rooms, spineId, prefix, columns, occ, kindOf, parentOf,
    floor.level === 0 && mainEntry ? { width: mainEntry.width } : null, coreTarget, model.brief.lifestyle.kitchen)
  const lonely = connectLeft(failed, rooms, kinds, spineId, columns, occ, doors)
  const windows = placeWindows(rooms, walls, columns, occ, kindOf, themeOf(model.brief).windows.widthMm, plan.dna, lower?.openings ?? [])
  const openings = [...doors, ...windows]
  for (const o of openings) if (o.kind === 'entry' && mainEntry) { o.entranceDesign = mainEntry.entranceDesign; o.head = mainEntry.head }
  const shafts = planShafts(rooms, walls, openings, kindOf, lower?.rooms ?? [])
  const reach = reachability(rooms, openings, floor.level)
  // a stair that grew or shrank with a moved wall is drawn again for its new room
  let stairOut = floor.stair
  const stairRoom = layout.rooms.find((r) => r.id === 'stair')
  if (floor.stair && stairRoom && (stairRoom.rect.x !== floor.stair.rect.x || stairRoom.rect.y !== floor.stair.rect.y || stairRoom.rect.w !== floor.stair.rect.w || stairRoom.rect.h !== floor.stair.rect.h)) {
    const g = stairGeometry(normalizeBrief(model))
    stairOut = stairRun(stairRoom.rect, floor.stair.startSide ?? 'S', g.perFlight, GOING)
  }
  // balconies hang from the plate below: their support zones follow where the person put them
  const hung = rooms.filter((r) => r.outdoor && r.id.startsWith('balcony') && !(lower?.footprint ?? []).some((q) => r.rect.x >= q.x - 1 && r.rect.y >= q.y - 1 && r.rect.x + r.rect.w <= q.x + q.w + 1 && r.rect.y + r.rect.h <= q.y + q.h + 1)).map((r) => r.rect)
  const supportZones = floor.supportZones ? [...floor.supportZones.filter((z) => z.support === 'columns'), ...supportZonesFor([], prefix, hung)] : floor.supportZones
  const court = rooms.find((r) => r.id === 'courtyard' && r.outdoor)
  return {
    ...floor,
    supportZones, courtyard: floor.courtyard ? (court?.rect ?? null) : floor.courtyard,
    rooms, walls, openings, shafts, stair: stairOut,
    reachable: reach.length === 0 && lonely.length === 0,
    unreachableRooms: [...new Set([...reach, ...lonely.filter((id) => !rooms.find((r) => r.id === id)?.outdoor)])],
  }
}

/** the programme (what the validator checks every floor against) follows the layout: moved, added and deleted rooms */
function patchProgramme(model: CanonicalModel, layout: LayoutDoc): CanonicalModel {
  const bySpace = new Map<string, SpaceReq>()
  for (const f of model.floors) for (const s of f.spaces) if (!bySpace.has(`${f.level}:${s.id}`)) bySpace.set(`${f.level}:${s.id}`, s)
  const anyLevel = (id: string) => model.floors.flatMap((f) => f.spaces).find((s) => s.id === id)
  const floors: FloorProgram[] = model.floors.map((f) => {
    const doc = layout.floors.find((l) => l.level === f.level)
    if (!doc) return f
    const indoorIds = new Set(model.floors.flatMap((x) => x.spaces).filter((s) => !s.outdoor).map((s) => s.id))
    const kept = f.spaces.filter((s) => !s.outdoor && !indoorIds.has(s.id))
    const mine: SpaceReq[] = []
    for (const r of doc.rooms) {
      if (r.type === 'vacant' || r.type === 'open') continue
      const have = bySpace.get(`${f.level}:${r.id}`) ?? anyLevel(r.id)
      mine.push(have
        ? { ...have, name: r.name }
        : { id: r.id, name: r.name, zone: r.zone, target: r.constraints.targetSqm, min: r.constraints.minSqm, max: r.constraints.maxSqm,
          wantsWindow: !r.outdoor && r.constraints.windows === 'required', wet: r.constraints.plumbing, outdoor: !!r.outdoor })
    }
    return { ...f, spaces: [...mine, ...kept] }
  })
  return { ...model, floors }
}

/** a plan whose rooms follow `layout`; the structure, stair, columns and outdoor spaces are the plan's own */
export function applyLayout(plan: Design, layout: LayoutDoc): Design {
  const model = patchProgramme(plan.model, layout)
  const O = layout.outline ?? noOutline()
  const moved = hasOutline(O)
  const B = baseBox(plan)
  const baseFloors = moved ? plan.floors.map((f) => shiftFloor(f, B, O)) : plan.floors
  const draft: Design = { ...plan, model, userEdited: true,
    ...(moved && plan.structure ? { structure: { ...plan.structure, axes: plan.structure.axes.map((a) => ({ ...a, at: a.orient === 'v' ? (near(a.at, B.x) ? a.at - O.W : near(a.at, B.x + B.w) ? a.at + O.E : a.at) : (near(a.at, B.y) ? a.at - O.N : near(a.at, B.y + B.h) ? a.at + O.S : a.at) })) } } : {}) }
  const floors: FloorPlan[] = []
  for (const [i, floor] of baseFloors.entries()) {
    const doc = layout.floors.find((l) => l.level === floor.level)
    floors.push(doc ? rebuildFloor(draft, floor, doc, floors[i - 1] ?? null) : floor)
  }
  const doors = floors.reduce((n, f) => n + f.openings.filter((o) => o.kind === 'door' || o.kind === 'entry').length, 0)
  const windows = floors.reduce((n, f) => n + f.openings.filter((o) => o.kind === 'window').length, 0)
  const site = placeSiteFeatures(model, floors[0], layout.features ?? {})
  // the emergency exit is placed on the plan as built; rebuild it for the new ground floor
  const ground = { ...floors[0], openings: floors[0].openings.filter((o) => !o.emergencyExit) }
  const all = [ground, ...floors.slice(1)]
  const groundMm2 = rectUnionArea(all[0].footprint)
  const outdoorMm2 = all[0].rooms.filter((r) => r.outdoor && r.id !== 'courtyard').reduce((a, r) => a + rectArea(r.rect), 0)
  const areas = moved ? {
    builtAreaSqm: toSqm(all.reduce((a, f) => a + rectUnionArea(f.footprint), 0)), footprintSqm: toSqm(groundMm2), coveredFootprintSqm: toSqm(groundMm2 + outdoorMm2),
    coverage: (groundMm2 + outdoorMm2 * 0.5) / (model.plot.width * model.plot.depth),
  } : {}
  const next: Design = { ...draft, ...areas, floors: all, openingCounts: { doors, windows },
    siteFeatures: site.features, siteNotes: [...(plan.model.siteNotes ?? []), ...site.notes] }
  return exposeStructuralSizing(withEmergencyExit(next))
}

