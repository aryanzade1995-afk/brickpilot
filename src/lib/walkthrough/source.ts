import { createBuildingModel, type BuildingModel, type BuildingRoom, type BuildingDoor } from '../engine/buildingModel.ts'
import type { Design } from '../engine/types.ts'
import type { ValidationReport } from '../rules/index.ts'
import { finishSignature } from '../cost/finishAssignments.ts'
import { fnv } from '../engine/massing/rng.ts'
import type { InteriorConfiguration } from '../interior/preview.ts'
import type { Rect } from '../geometry.ts'
import {interiorModelSignature} from '../interior-assets/catalogue.ts'

export const WALKTHROUGH_SOURCE_VERSION = 'walkthrough-source-v1'
export type WalkthroughPreferences = Pick<InteriorConfiguration, 'style' | 'lighting' | 'furnitureDensity'>
export type WalkthroughIssueCode = 'INVALID_PLAN' | 'ACCEPTED_MODEL_MISMATCH' | 'DOOR_HOST_UNRESOLVED' |
  'DOOR_CONNECTION_UNRESOLVED' | 'ENTRY_CONNECTION_UNRESOLVED' | 'SPACE_CONNECTION_UNCONFIRMED' |
  'STAIR_SOURCE_UNSUPPORTED' | 'STAIR_SOURCE_MISSING'
export type WalkthroughIssue = { code: WalkthroughIssueCode; scope: string; blocking: boolean }
export type WalkthroughPortal = {
  id: string; openingId: string; floorId: string; hostWallId: string | null
  // null means source-declared outside; undefined source metadata is unresolved.
  rooms: [string | null, string | null] | null
  state: 'source-linked' | 'needs-review'
  /** A topology link is NOT a collision-tested, open, walkable doorway. */
  traversal: 'not-evaluated'
}
export type WalkthroughFloor = {
  id: string; level: number; roomKeys: string[]
  footprintMm: Rect[]
  exclusions: { sourceId: string; kind: 'courtyard' | 'double-height' | 'shaft'; rectMm: Rect }[]
  stairCutouts: 'pending-source-stair-adapter'
}
export type WalkthroughSource = {
  version: typeof WALKTHROUGH_SOURCE_VERSION
  phase: 'foundations'; viewerReady: false; state: 'source-recorded' | 'blocked'
  geometryKey: string; appearanceKey: string; preferences: WalkthroughPreferences
  building: BuildingModel
  floors: WalkthroughFloor[]
  rooms: { key: string; sourceRoomId: string; floorId: string; outdoor: boolean; finishRoomKey: string }[]
  portals: WalkthroughPortal[]
  stairs: { sourceStairId: string; floorId: string; candidateDestinationFloorId: string | null;
    sourceState: 'recorded' | 'unsupported'; traversal: 'pending' }[]
  issues: WalkthroughIssue[]
}

export const walkthroughRoomKey = (floorId: string, roomId: string) => JSON.stringify([floorId, roomId])
export const walkthroughAppearanceKey = (design: Design, preferences: WalkthroughPreferences) =>
  `walk-appearance-v1-${fnv(JSON.stringify([finishSignature(design.model.brief), interiorModelSignature(design.model.brief), preferences.style, preferences.lighting, preferences.furnitureDensity])).toString(16)}`

function openingOnRoom(door: BuildingDoor, room: BuildingRoom, toleranceMm: number) {
  const r = room.rect, horizontal = door.orient === 'h', fixed = horizontal ? door.at.y : door.at.x
  const start = horizontal ? r.x : r.y, end = start + (horizontal ? r.w : r.h), along = horizontal ? door.at.x : door.at.y
  return [horizontal ? r.y : r.x, horizontal ? r.y + r.h : r.x + r.w].some(edge => Math.abs(edge - fixed) <= toleranceMm) &&
    along - door.width / 2 >= start - toleranceMm && along + door.width / 2 <= end + toleranceMm
}

/** Read-only source contract, not a scene builder or navigation generator.
 * The report must belong to the current studio Result. No generation, repairs,
 * render jobs, persistent state or BOQ writes are performed here.
 */
export function createWalkthroughSource(design: Design, report: Pick<ValidationReport, 'hardChecksPass'>,
  preferences: WalkthroughPreferences, acceptedBuilding?: BuildingModel | null): WalkthroughSource {
  const building = structuredClone(createBuildingModel(design)), issues: WalkthroughIssue[] = []
  const issue = (code: WalkthroughIssueCode, scope: string, blocking = false) => issues.push({ code, scope, blocking })
  if (!report.hardChecksPass) issue('INVALID_PLAN', 'building', true)
  if (acceptedBuilding && acceptedBuilding.planId !== building.planId) issue('ACCEPTED_MODEL_MISMATCH', 'building', true)
  const rooms = building.rooms.map(r => ({ key: walkthroughRoomKey(r.floorId, r.id), sourceRoomId: r.id,
    floorId: r.floorId, outdoor: r.outdoor,
    finishRoomKey: `${building.floors.find(f => f.id === r.floorId)!.level}:${r.semanticId ?? r.id}` }))
  const floors = building.floors.map(f => ({ id: f.id, level: f.level,
    roomKeys: rooms.filter(r => r.floorId === f.id).map(r => r.key), footprintMm: structuredClone(f.footprint),
    exclusions: [
      ...(f.courtyard ? [{ sourceId: `${f.id}:courtyard`, kind: 'courtyard' as const, rectMm: { ...f.courtyard } }] : []),
      ...(f.doubleHeightVoids ?? []).map((v, i) => ({ sourceId: `${f.id}:double-height:${i}`, kind: 'double-height' as const, rectMm: { ...v.rect } })),
      ...building.shafts.filter(s => s.floorId === f.id).map(s => ({ sourceId: s.id, kind: 'shaft' as const, rectMm: { ...s.rect } })),
    ], stairCutouts: 'pending-source-stair-adapter' as const }))
  const portals: WalkthroughPortal[] = building.doors.map(door => {
    const id = `${door.floorId}:${door.id}`, horizontal = door.orient === 'h', at = horizontal ? door.at.x : door.at.y
    const hosts = building.walls.filter(w => w.floorId === door.floorId && w.kind !== 'parapet' &&
      (horizontal ? Math.abs(w.a.y - w.b.y) < 1 && Math.abs(w.a.y - door.at.y) < 1 : Math.abs(w.a.x - w.b.x) < 1 && Math.abs(w.a.x - door.at.x) < 1) &&
      at - door.width / 2 >= Math.min(horizontal ? w.a.x : w.a.y, horizontal ? w.b.x : w.b.y) - 1 &&
      at + door.width / 2 <= Math.max(horizontal ? w.a.x : w.a.y, horizontal ? w.b.x : w.b.y) + 1)
    const host = hosts.length === 1 ? hosts[0] : null
    if (!host) issue('DOOR_HOST_UNRESOLVED', id)
    const endpoints = door.rooms?.map(roomId => {
      if (roomId === null) return null
      const matches = building.rooms.filter(r => r.floorId === door.floorId && (r.id === roomId || r.semanticId === roomId))
      return matches.length === 1 && openingOnRoom(door, matches[0], (host?.thickness ?? 0) / 2 + 1) ? walkthroughRoomKey(door.floorId, matches[0].id) : undefined
    })
    const linked = !!host && !!endpoints && endpoints.length === 2 && endpoints.every(e => e !== undefined) &&
      endpoints[0] !== endpoints[1] && (!endpoints.includes(null) || host.kind === 'exterior')
    if (!linked) issue('DOOR_CONNECTION_UNRESOLVED', id)
    return { id, openingId: door.id!, floorId: door.floorId, hostWallId: host?.id ?? null,
      rooms: linked ? endpoints as [string | null, string | null] : null,
      state: linked ? 'source-linked' : 'needs-review', traversal: 'not-evaluated' }
  })
  // Diagnostic topology only, from explicit ground-floor entrances.
  // Upper-floor reachability waits for the shared stair/landing adapter.
  for (const floor of building.floors) {
    const reached = new Set<string>(), local = portals.filter(p => p.floorId === floor.id && p.state === 'source-linked')
    for (const p of local.filter(p => p.rooms!.includes(null))) for (const key of p.rooms!) if (key) reached.add(key)
    // No stair-room guess or nearest-room bridge is inserted for upper floors.
    if (floor.level === 0 && !reached.size) issue('ENTRY_CONNECTION_UNRESOLVED', floor.id)
    if (floor.level !== 0) continue
    let changed = true
    while (changed) { changed = false; for (const p of local) if (p.rooms!.some(key => key && reached.has(key)))
      for (const key of p.rooms!) if (key && !reached.has(key)) { reached.add(key); changed = true } }
    for (const room of rooms.filter(r => r.floorId === floor.id && !r.outdoor)) if (!reached.has(room.key)) issue('SPACE_CONNECTION_UNCONFIRMED', room.key)
  }
  const stairs = building.stairs.map(s => {
    const floor = building.floors.find(f => f.id === s.floorId)!
    const recorded = !!s.startSide && s.treads.length > 0 && s.treads.every(t => t.length >= 2 && t.every(p => Number.isFinite(p.x) && Number.isFinite(p.y)))
    if (!recorded) issue('STAIR_SOURCE_UNSUPPORTED', s.id)
    return { sourceStairId: s.id, floorId: s.floorId,
      candidateDestinationFloorId: building.floors.find(f => f.level === floor.level + 1)?.id ?? null,
      sourceState: recorded ? 'recorded' as const : 'unsupported' as const, traversal: 'pending' as const }
  })
  for (const floor of building.floors) if (building.floors.some(f => f.level === floor.level + 1) && !stairs.some(s => s.floorId === floor.id)) issue('STAIR_SOURCE_MISSING', floor.id)
  return { version: WALKTHROUGH_SOURCE_VERSION, phase: 'foundations', viewerReady: false,
    state: issues.some(i => i.blocking) ? 'blocked' : 'source-recorded', geometryKey: `${WALKTHROUGH_SOURCE_VERSION}:${building.planId}`,
    appearanceKey: walkthroughAppearanceKey(design, preferences), preferences: { ...preferences }, building, floors, rooms, portals, stairs, issues }
}

export type WalkthroughAssetReference = { planId: string; finishSignature?: string; files: { glb?: string } }
/** A matching exterior GLB is only a candidate: it is not proof of interior completeness. */
export function assessWalkthroughAsset(source: WalkthroughSource, design: Design, asset?: WalkthroughAssetReference) {
  if (!asset?.files.glb) return 'missing' as const
  if (source.building.planId !== asset.planId) return 'different-plan' as const
  if (asset.finishSignature !== finishSignature(design.model.brief)) return 'finishes-out-of-date' as const
  return 'candidate-needs-interior-audit' as const
}
