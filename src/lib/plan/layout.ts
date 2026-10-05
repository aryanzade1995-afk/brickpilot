import { rectArea, sharedEdge, toSqm, type Rect } from '../geometry.ts'
import type { CanonicalModel, FloorProgram, SpaceReq, Zone } from '../model/canonical.ts'
import { themeOf } from '../model/themes.ts'
import type { Design, FloorPlan, Opening, PlacedRoom } from '../engine/types.ts'
import type { RoomKind } from '../engine/planner/types.ts'
import { fitOnLine, occupy, placeDoors, placeWindows, planShafts, wallGraph, type Occupancy } from '../engine/planner/elements.ts'
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
}

export type FloorLayout = { level: number; rooms: LayoutRoom[] }
export type LayoutDoc = { version: 1; signature: string; floors: FloorLayout[] }

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
    floors: plan.floors.map((floor) => ({
      level: floor.level,
      rooms: floor.rooms.filter((r) => !r.outdoor).map((r): LayoutRoom => {
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
          ...(owners.has(r.id) ? { parent: owners.get(r.id) } : {}), constraints }
      }),
    })),
  }
}

/* --------------------------------- applying -------------------------------- */

const placed = (r: LayoutRoom): PlacedRoom => ({
  id: r.id, semanticId: r.semanticId, name: r.name, zone: r.zone, rect: { ...r.rect },
  area: toSqm(rectArea(r.rect)), outdoor: false, wantsWindow: r.constraints.windows === 'required' && r.type !== 'vacant' && r.type !== 'open',
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
  const indoor = layout.rooms.map(placed)
  const outdoor = floor.rooms.filter((r) => r.outdoor)
  const rooms = [...indoor, ...outdoor]
  const kinds = new Map<string, RoomKind>()
  const parents = new Map<string, string>()
  for (const r of layout.rooms) { kinds.set(r.id, r.kind); if (r.parent) parents.set(r.id, r.parent) }
  for (const r of outdoor) kinds.set(r.id, r.id.startsWith('balcony') ? 'balcony' : r.id === 'courtyard' ? 'courtyard' : r.id === 'parking' ? 'parking' : 'verandah')
  const kindOf = (id: string) => kinds.get(id) ?? ''
  const parentOf = (id: string) => parents.get(id)
  const spineId = spineOf(layout.rooms)
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
  return {
    ...floor,
    rooms, walls, openings, shafts,
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
    const kept = f.spaces.filter((s) => s.outdoor || !indoorIds.has(s.id))
    const mine: SpaceReq[] = []
    for (const r of doc.rooms) {
      if (r.type === 'vacant' || r.type === 'open') continue
      const have = bySpace.get(`${f.level}:${r.id}`) ?? anyLevel(r.id)
      mine.push(have
        ? { ...have, name: r.name }
        : { id: r.id, name: r.name, zone: r.zone, target: r.constraints.targetSqm, min: r.constraints.minSqm, max: r.constraints.maxSqm,
          wantsWindow: r.constraints.windows === 'required', wet: r.constraints.plumbing, outdoor: false })
    }
    return { ...f, spaces: [...mine, ...kept] }
  })
  return { ...model, floors }
}

/** a plan whose rooms follow `layout`; the structure, stair, columns and outdoor spaces are the plan's own */
export function applyLayout(plan: Design, layout: LayoutDoc): Design {
  const model = patchProgramme(plan.model, layout)
  const draft: Design = { ...plan, model }
  const floors: FloorPlan[] = []
  for (const [i, floor] of plan.floors.entries()) {
    const doc = layout.floors.find((l) => l.level === floor.level)
    floors.push(doc ? rebuildFloor(draft, floor, doc, floors[i - 1] ?? null) : floor)
  }
  const doors = floors.reduce((n, f) => n + f.openings.filter((o) => o.kind === 'door' || o.kind === 'entry').length, 0)
  const windows = floors.reduce((n, f) => n + f.openings.filter((o) => o.kind === 'window').length, 0)
  const site = placeSiteFeatures(model, floors[0])
  // the emergency exit is placed on the plan as built; rebuild it for the new ground floor
  const ground = { ...floors[0], openings: floors[0].openings.filter((o) => !o.emergencyExit) }
  const next: Design = { ...draft, floors: [ground, ...floors.slice(1)], openingCounts: { doors, windows },
    siteFeatures: site.features, siteNotes: [...(plan.model.siteNotes ?? []), ...site.notes] }
  return exposeStructuralSizing(withEmergencyExit(next))
}

