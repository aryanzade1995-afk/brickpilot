import type { BuildingModel, BuildingWall, BuildingFloor } from '../engine/buildingModel.ts'
import { rectUnionEdges, type Rect } from '../geometry.ts'
import { subtractRegions, intersectRegions, validRect, containsPoint } from '../solar/regions.ts'
import { planToThreeGlb } from './coordinates.ts'
import { realizeSourceStair } from './stairs.ts'
import { exposedSurfaces } from './surfaces.ts'
import { walkthroughRoomKey } from './source.ts'
import { sceneId, type WalkthroughScene, type SourceBox, type SceneRole } from './sceneTypes.ts'

const EPS = 1e-6
const overlaps = (a: SourceBox, b: SourceBox) => a.x < b.x + b.w - EPS && a.x + a.w > b.x + EPS &&
  a.y < b.y + b.d - EPS && a.y + a.d > b.y + EPS && a.z < b.z + b.h - EPS && a.z + a.h > b.z + EPS
const sameRect = (a: Rect, b: Rect) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h
const validBox = (b: SourceBox) => Object.values(b).every(Number.isFinite) && Math.min(b.w, b.d, b.h) > 0
const footprint = (b: SourceBox): Rect => ({ x: b.x, y: b.y, w: b.w, h: b.d })
const box = (r: Rect, z: number, h: number): SourceBox => ({ x: r.x, y: r.y, z, w: r.w, d: r.h, h })
const boundsKey = (b: SourceBox) => [b.x, b.y, b.z, b.w, b.d, b.h]

/** One continuous source-derived shell. No Design, planner, seed search, room
 * shell, furniture placer, viewport or global state is consulted. Errors return
 * no renderable surfaces; diagnostics/source records remain available.
 */
export function buildWalkthroughScene(input: BuildingModel, validation: { hardChecksPass: boolean }): WalkthroughScene {
  const building = structuredClone(input)
  const scene: WalkthroughScene = { version: 'walkthrough-shell-v1', planId: building.planId, status: 'ready',
    coordinates: 'metres-x-plan-east-y-up-z-plan-north', source: building, floors: [], rooms: [], solids: [], surfaces: [], openings: [], stairs: [], roofs: [], connections: [], issues: [] }
  const issue = (code: string, sourceId: string, message: string, severity: 'error' | 'warning' = 'error') => scene.issues.push({ code, sourceId, message, severity })
  const finish = () => { scene.status = scene.issues.some(i => i.severity === 'error') ? 'unsupported' : scene.issues.length ? 'needs-review' : 'ready';
    if (scene.status === 'unsupported') { scene.surfaces = []; scene.solids = [] } return scene }
  if (!validation.hardChecksPass) issue('INVALID_PLAN', building.planId, 'The source Result has not passed 2D validation.')
  if (building.schemaVersion !== 1 || building.units !== 'mm' || building.coordinates !== 'plan-x-east-y-south-z-up') issue('UNSUPPORTED_COORDINATES', building.planId, 'Unsupported BuildingModel schema or axes.')
  const floors = [...building.floors].sort((a, b) => a.level - b.level), byFloor = new Map(floors.map(f => [f.id, f]))
  if (!floors.length || byFloor.size !== floors.length || new Set(floors.map(f => f.level)).size !== floors.length) issue('INVALID_FLOORS', building.planId, 'Floors must have unique source IDs and levels.')
  for (const f of floors) if (![f.elevationMm, f.heightMm, f.slabThicknessMm].every(v => typeof v === 'number' && Number.isFinite(v)) ||
    !f.slabThicknessMm || f.heightMm <= f.slabThicknessMm || !f.footprint.length || !f.footprint.every(validRect)) issue('INVALID_FLOOR', f.id, 'A floor needs finite source elevation, height, slab thickness and footprint.')
  for (let i = 1; i < floors.length; i++) if (floors[i].level !== floors[i - 1].level + 1 || Math.abs(floors[i].elevationMm - floors[i - 1].elevationMm - floors[i - 1].heightMm) > EPS)
    issue('FLOOR_JOIN_MISMATCH', floors[i].id, 'Source elevations do not join adjacent storeys; no offset or bridge was invented.')
  for (const [kind, values] of Object.entries({ rooms: building.rooms, walls: building.walls, doors: building.doors, windows: building.windows,
    stairs: building.stairs, columns: building.columns, beams: building.beams, slabs: building.slabs, shafts: building.shafts })) {
    const keys = values.map(v => sceneId(v.floorId, v.id ?? ''))
    if (new Set(keys).size !== keys.length || values.some(v => !v.id || !byFloor.has(v.floorId))) issue('INVALID_SOURCE_REFERENCE', kind, 'Missing, repeated or unknown floor-scoped source ID.')
  }
  if (scene.issues.some(i => i.severity === 'error')) return finish()
  const add = (role: Exclude<SceneRole, 'glass'>, floorId: string, ids: string[], b: SourceBox) => {
    if (!validBox(b)) { issue('INVALID_SOLID', ids.join(','), 'Non-finite or non-positive source solid.'); return }
    scene.solids.push({ id: sceneId(role, floorId, ...[...ids].sort(), ...boundsKey(b)), floorId, sourceIds: [...ids].sort(), role, boundsMm: b })
  }
  const voidRooms = new Set(building.shafts.map(s => sceneId(s.floorId, s.roomId)))
  for (const piece of building.emergency?.exitAccess?.pieces ?? []) add('stair', floors[0].id, [piece.id], box(piece.rect, piece.bottomMm + floors[0].elevationMm, piece.topMm - piece.bottomMm))
  for (const piece of building.emergency?.entryAccess?.pieces ?? []) add('stair', floors[0].id, [piece.id], box(piece.rect, piece.bottomMm + floors[0].elevationMm, piece.topMm - piece.bottomMm))
  for (const f of floors) for (const v of f.doubleHeightVoids ?? []) voidRooms.add(sceneId(f.id, v.roomId))
  const outdoor = (f: BuildingFloor) => building.rooms.filter(r => r.floorId === f.id && r.outdoor && !voidRooms.has(sceneId(f.id, r.id)) && !(f.courtyard && sameRect(f.courtyard, r.rect)))
  for (const room of building.rooms) if (!validRect(room.rect)) issue('INVALID_ROOM', room.id, 'Invalid source room rectangle.')
  for (const shaft of building.shafts) if (!validRect(shaft.rect)) issue('INVALID_SHAFT', shaft.id, 'Invalid source shaft rectangle.')
  for (const f of floors) if ((f.courtyard && !validRect(f.courtyard)) || f.doubleHeightVoids?.some(v => !validRect(v.rect))) issue('INVALID_VOID', f.id, 'Invalid source void rectangle.')
  for (const f of floors) {
    const slabs = building.slabs.filter(s => s.floorId === f.id)
    if (!slabs.length || slabs.some(s => !validRect(s.rect) || s.topMm !== f.elevationMm || s.thicknessMm !== f.slabThicknessMm)) issue('SLAB_SOURCE_MISMATCH', f.id, 'Slabs must match the source floor elevation and thickness.')
    else if (subtractRegions(f.footprint, slabs.map(s => s.rect)).length) issue('SLAB_SOURCE_MISMATCH', f.id, 'Source slabs do not support the declared floor footprint.')
  }
  if (building.roofTerrace && (!building.roofTerrace.slab.length || !building.roofTerrace.slab.every(validRect) || !floors.some(f => f.level === building.roofTerrace!.level))) issue('INVALID_ROOF_SOURCE', building.planId, 'Invalid source terrace plates or floor reference.')
  if (scene.issues.some(i => i.severity === 'error')) return finish()

  // Realize source nosings once. The destination slab retains its entrance-edge
  // landing, matching Blender's stair_opening convention in all four rotations.
  for (const s of building.stairs) {
    const f = byFloor.get(s.floorId)!, next = floors.find(n => n.level === f.level + 1)
    const roof = !next && building.roofTerrace?.level === f.level
    if (!next && !roof) { issue('STAIR_DESTINATION_UNSPECIFIED', s.id, 'No source upper floor or flat terrace for this stair.'); continue }
    try {
      const rules = building.quantityRules?.stairs
      if (!rules) throw new Error('Source waist and landing thicknesses are missing')
      const stair = realizeSourceStair(s, f, next?.id ?? null, rules)
      scene.stairs.push(stair)
      for (const step of stair.steps) add('stair', f.id, [s.id], box(step.rectMm, step.bottomMm, step.topMm - step.bottomMm))
      add('stair', f.id, [s.id], box(stair.midLanding.rectMm, stair.midLanding.bottomMm, stair.midLanding.topMm - stair.midLanding.bottomMm))
    } catch (error) { issue('UNSUPPORTED_STAIR', s.id, error instanceof Error ? error.message : 'Unsupported source stair.') }
  }
  for (const f of floors.slice(0, -1)) if (!scene.stairs.some(s => s.floorId === f.id)) issue('MISSING_STAIR', f.id, 'No supported source stair connects this floor to the next.')
  if (scene.issues.some(i => i.severity === 'error')) return finish()

  for (const f of floors) {
    const above = floors.find(n => n.level === f.level + 1)
    const cuts = [
      ...(f.courtyard ? [{ id: sceneId(f.id, 'courtyard'), kind: 'courtyard', rectMm: f.courtyard }] : []),
      ...(f.doubleHeightVoids ?? []).map(v => ({ id: sceneId(f.id, v.roomId), kind: 'double-height', rectMm: v.rect })),
      ...building.shafts.filter(s => s.floorId === f.id).map(s => ({ id: s.id, kind: 'shaft', rectMm: s.rect })),
      ...scene.stairs.filter(s => s.destinationFloorId === f.id).map(s => ({ id: s.id, kind: 'stair', rectMm: s.openingMm })),
    ]
    const slabs = building.slabs.filter(s => s.floorId === f.id)
    if (!slabs.length || slabs.some(s => !validRect(s.rect) || s.topMm !== f.elevationMm || s.thicknessMm !== f.slabThicknessMm)) issue('SLAB_SOURCE_MISMATCH', f.id, 'Slabs must match the source floor elevation and thickness.')
    const bases = [...slabs.map(s => s.rect), ...outdoor(f).map(r => r.rect)]
    const regions = subtractRegions(bases, cuts.map(c => c.rectMm))
    scene.floors.push({ id: sceneId('floor', f.id), sourceId: f.id, level: f.level, elevationM: f.elevationMm / 1000,
      clearCeilingM: above && above.slabThicknessMm === f.slabThicknessMm || !above && building.roofTerrace ? (f.elevationMm + f.heightMm - f.slabThicknessMm!) / 1000 : null,
      supportedRegionsMm: regions, cutouts: structuredClone(cuts) })
    if (f.doubleHeightVoids?.length) issue('VOID_EDGE_GUARDS_UNSPECIFIED', f.id, 'Double-height openings are preserved. Their guard assemblies require explicit source detail before navigation.', 'warning')
    for (const r of regions) {
      const ids = [...slabs.filter(s => intersectRegions([s.rect], [r]).length).map(s => s.id), ...outdoor(f).filter(s => intersectRegions([s.rect], [r]).length).map(s => s.id)]
      add('slab', f.id, ids, box(r, f.elevationMm - f.slabThicknessMm!, f.slabThicknessMm!))
    }
  }
  // Roof/ceiling plates close only source-supported horizontal surfaces. Upper
  // slabs already provide the shared ceiling: do not add another coincident one.
  for (const f of floors) {
    const above = floors.find(n => n.level === f.level + 1), topRoof = building.roofTerrace?.level === f.level ? building.roofTerrace : null
    if (!above && !topRoof) { issue('TOP_ROOF_UNSPECIFIED', f.id, 'BuildingModel does not describe this roof shape; a flat cap was not invented.'); continue }
    const destinationCuts = above ? scene.floors.find(n => n.sourceId === above.id)!.cutouts.map(c => c.rectMm) : []
    const cuts = [...(f.courtyard ? [f.courtyard] : []), ...building.shafts.filter(s => s.floorId === f.id).map(s => s.rect),
      ...scene.stairs.filter(s => s.floorId === f.id).map(s => s.openingMm), ...destinationCuts]
    const roofRegions = subtractRegions(topRoof?.slab ?? f.footprint, [...cuts, ...(above ? [...above.footprint, ...outdoor(above).map(r => r.rect)] : [])])
    for (const r of roofRegions) add('slab', f.id, [f.id, 'source-roof'], box(r, f.elevationMm + f.heightMm - f.slabThicknessMm!, f.slabThicknessMm!))
    if (roofRegions.length) scene.roofs.push({ id: sceneId('roof', f.id), floorId: f.id, elevationM: (f.elevationMm + f.heightMm) / 1000,
      regionsMm: roofRegions, access: scene.stairs.some(s => s.floorId === f.id && !s.destinationFloorId) ? 'source-stair' : 'unconfirmed' })
    if (topRoof) {
      const policy = building.quantityRules?.roof
      if (policy && [policy.parapetHeightMm, policy.parapetThicknessMm].every(v => Number.isFinite(v) && v > 0)) {
        const t = policy.parapetThicknessMm
        // Roof parapets use the source roof sizing policy, never the stair-hole
        // boundary. A missing mumty enclosure is reported separately below.
        for (const edge of rectUnionEdges(subtractRegions(topRoof.slab, f.courtyard ? [f.courtyard] : []))) {
          const horizontal = edge.side === 'N' || edge.side === 'S'
          const r = horizontal ? { x: edge.a.x, y: edge.a.y - (edge.side === 'S' ? t : 0), w: edge.b.x - edge.a.x, h: t } :
            { x: edge.a.x - (edge.side === 'E' ? t : 0), y: edge.a.y, w: t, h: edge.b.y - edge.a.y }
          add('parapet', f.id, [f.id, 'source-roof-parapet-policy'], box(r, f.elevationMm + f.heightMm, policy.parapetHeightMm))
        }
      } else issue('ROOF_GUARDS_UNSPECIFIED', f.id, 'Source roof parapet dimensions are missing.', 'warning')
    }
    if (topRoof?.mumty) issue('ROOF_HEADROOM_UNSPECIFIED', f.id, 'The roof headroom footprint is recorded, but its wall height/exit are absent from BuildingModel; no enclosure or exit was invented.', 'warning')
  }

  // The same physical wall may be referenced by both rooms. Exact duplicate
  // records become aliases; inconsistent/partially overlapping collinear walls
  // are rejected rather than merged into a different architectural wall.
  const wallGroups = new Map<string, { wall: BuildingWall; ids: string[]; lo: number; hi: number; fixed: number; horizontal: boolean; height: number }>()
  for (const wall of building.walls) {
    const f = byFloor.get(wall.floorId)!, horizontal = Math.abs(wall.a.y - wall.b.y) < EPS
    if (![wall.a.x, wall.a.y, wall.b.x, wall.b.y, wall.thickness].every(Number.isFinite) || wall.thickness <= 0 ||
      (!horizontal && Math.abs(wall.a.x - wall.b.x) >= EPS)) { issue('UNSUPPORTED_WALL', wall.id!, 'Only finite source-aligned walls are supported.'); continue }
    const lo = Math.min(horizontal ? wall.a.x : wall.a.y, horizontal ? wall.b.x : wall.b.y), hi = Math.max(horizontal ? wall.a.x : wall.a.y, horizontal ? wall.b.x : wall.b.y)
    const fixed = horizontal ? wall.a.y : wall.a.x, height = wall.heightMm ?? (wall.kind === 'parapet' ? building.quantityRules?.roof.parapetHeightMm : f.heightMm)
    if (hi <= lo || !height || !Number.isFinite(height)) { issue('UNSUPPORTED_WALL', wall.id!, 'Source wall length/height is missing.'); continue }
    const key = sceneId(wall.floorId, horizontal ? 'h' : 'v', lo, hi, fixed, wall.thickness, height, wall.kind)
    const group = wallGroups.get(key)
    if (group) group.ids.push(wall.id!)
    else wallGroups.set(key, { wall, ids: [wall.id!], lo, hi, fixed, horizontal, height })
  }
  const walls = [...wallGroups.values()]
  for (let i = 0; i < walls.length; i++) for (let j = i + 1; j < walls.length; j++) {
    const a = walls[i], b = walls[j]
    if (a.wall.floorId === b.wall.floorId && a.horizontal === b.horizontal && Math.abs(a.fixed - b.fixed) < EPS && Math.min(a.hi, b.hi) - Math.max(a.lo, b.lo) > EPS)
      issue('AMBIGUOUS_WALL_OVERLAP', a.ids.join(','), 'Overlapping collinear source walls have incompatible extents or specifications.')
  }
  for (const opening of [...building.doors, ...building.windows]) {
    const f = byFloor.get(opening.floorId)!, horizontal = opening.orient === 'h', at = horizontal ? opening.at.x : opening.at.y, fixed = horizontal ? opening.at.y : opening.at.x
    const hosts = walls.filter(w => w.wall.floorId === f.id && w.wall.kind !== 'parapet' && w.horizontal === horizontal &&
      Math.abs(w.fixed - fixed) < EPS && at - opening.width / 2 >= w.lo - EPS && at + opening.width / 2 <= w.hi + EPS)
    if (!Number.isFinite(opening.width) || opening.width <= 0 || hosts.length !== 1) { issue('OPENING_HOST_UNRESOLVED', opening.id!, 'Opening must fit exactly one source wall.'); continue }
    const host = hosts[0], limits = f.openingLimits
    const sill = opening.kind === 'window' ? opening.sill ?? limits?.defaultSillMm : 0
    const policyHead = opening.kind === 'window' ? limits?.windowHeadMm : opening.kind === 'entry' ? limits?.entryHeadMm : limits?.doorHeadMm
    const head = opening.head ?? (policyHead !== undefined && limits ? Math.min(policyHead, f.heightMm - limits.lintelClearanceMm) : undefined)
    if (sill === undefined || head === undefined || !Number.isFinite(sill) || !Number.isFinite(head) || sill < 0 || head <= sill || head > host.height ||
      (limits && head - sill < (opening.kind === 'window' ? limits.minWindowHeightMm : limits.minDoorHeightMm))) { issue('OPENING_HEIGHT_UNRESOLVED', opening.id!, 'Opening heights are missing or incompatible with the source wall.'); continue }
    const aperture = horizontal ? { x: at - opening.width / 2, y: fixed - host.wall.thickness / 2, w: opening.width, d: host.wall.thickness } :
      { x: fixed - host.wall.thickness / 2, y: at - opening.width / 2, w: host.wall.thickness, d: opening.width }
    const refs = opening.rooms?.map(id => {
      if (id === null) return null
      const matches = building.rooms.filter(r => r.floorId === f.id && (r.id === id || r.semanticId === id))
      if (matches.length !== 1) return undefined
      const r = matches[0].rect, edges = horizontal ? [r.y, r.y + r.h] : [r.x, r.x + r.w]
      const lo = horizontal ? r.x : r.y, hi = lo + (horizontal ? r.w : r.h), tolerance = host.wall.thickness / 2 + EPS
      return edges.some(e => Math.abs(e - fixed) <= tolerance) && at - opening.width / 2 >= lo - tolerance && at + opening.width / 2 <= hi + tolerance ? matches[0] : undefined
    })
    const linked = refs?.length === 2 && refs.every(r => r !== undefined) && refs[0] !== refs[1] && (!refs.includes(null) || host.wall.kind === 'exterior')
    if (opening.kind !== 'window' && !linked) issue('DOOR_ROOM_REFERENCE', opening.id!, 'Explicit doorway room references are unresolved; no connection was guessed.', 'warning')
    const record = { id: sceneId('opening', f.id, opening.id!), sourceId: opening.id!, floorId: f.id, wallId: [...host.ids].sort()[0], kind: opening.kind,
      orient: opening.orient, apertureMm: { ...aperture, z: f.elevationMm + sill, h: head - sill }, sillMm: sill, headMm: head,
      headBasis: opening.head === undefined ? 'source-opening-policy' as const : 'explicit' as const,
      operation: opening.kind === 'window' ? 'window' as const : opening.treatment === 'open' || opening.leaf === false ? 'open' as const : opening.treatment === 'glazed-slide' ? 'sliding' as const : 'door-leaf-unmodelled' as const,
      ...(opening.hinge ? { hinge: opening.hinge } : {}), ...(opening.swing ? { swing: opening.swing } : {}),
      ...(opening.emergencyExit ? { emergencyExit: true } : {}),
      rooms: linked ? refs!.map(r => r ? walkthroughRoomKey(r.floorId, r.id) : null) as [string | null, string | null] : null }
    scene.openings.push(record)
    if (record.rooms && opening.kind !== 'window') scene.connections.push({ id: sceneId('door-link', record.id), kind: 'door', from: record.rooms.find(r => r !== null)!,
      to: record.rooms.includes(null) ? null : record.rooms[1], sourceId: opening.id! })
  }
  for (const group of walls) {
    const { wall, horizontal, lo, hi, fixed, height } = group, base = byFloor.get(wall.floorId)!.elevationMm
    const ops = scene.openings.filter(o => o.floorId === wall.floorId && group.ids.includes(o.wallId))
    for (let i = 0; i < ops.length; i++) for (let j = i + 1; j < ops.length; j++) if (overlaps(ops[i].apertureMm, ops[j].apertureMm)) issue('OVERLAPPING_OPENINGS', ops[i].sourceId, 'Source openings overlap in the same wall.')
    const wallRegions = subtractRegions([{ x: lo, y: base, w: hi - lo, h: height }], ops.map(o => ({ x: horizontal ? o.apertureMm.x : o.apertureMm.y, y: o.apertureMm.z,
      w: horizontal ? o.apertureMm.w : o.apertureMm.d, h: o.apertureMm.h })))
    for (const p of wallRegions) add(wall.kind === 'parapet' ? 'parapet' : 'wall', wall.floorId, group.ids,
      horizontal ? { x: p.x, y: fixed - wall.thickness / 2, z: p.y, w: p.w, d: wall.thickness, h: p.h } : { x: fixed - wall.thickness / 2, y: p.x, z: p.y, w: wall.thickness, d: p.w, h: p.h })
  }
  for (const c of building.columns) { const f = byFloor.get(c.floorId)!; add('column', f.id, [c.id], { x: c.at.x - c.size / 2, y: c.at.y - c.size / 2, z: f.elevationMm, w: c.size, d: c.size, h: f.heightMm - f.slabThicknessMm! }) }
  for (const b of building.beams) {
    const f = byFloor.get(b.floorId)!, horizontal = Math.abs(b.a.y - b.b.y) < EPS, length = Math.hypot(b.b.x - b.a.x, b.b.y - b.a.y)
    if ((!horizontal && Math.abs(b.a.x - b.b.x) >= EPS) || !b.widthMm || !b.depthMm || b.depthMm <= f.slabThicknessMm! || b.depthMm >= f.heightMm || length <= 0) { issue('UNSUPPORTED_BEAM', b.id, 'Beam axis or source dimensions are unsupported.'); continue }
    const end = (p: { x: number; y: number }) => building.columns.find(c => c.floorId === f.id && Math.hypot(c.at.x - p.x, c.at.y - p.y) <= 2)?.size ?? 0
    const start = end(b.a) / 2, finish = end(b.b) / 2, clear = length - start - finish
    const x = b.a.x + (b.b.x - b.a.x) * (start + clear / 2) / length, y = b.a.y + (b.b.y - b.a.y) * (start + clear / 2) / length
    add('beam', f.id, [b.id], { x: x - (horizontal ? clear : b.widthMm) / 2, y: y - (horizontal ? b.widthMm : clear) / 2,
      z: f.elevationMm + f.heightMm - b.depthMm, w: horizontal ? clear : b.widthMm, d: horizontal ? b.widthMm : clear, h: b.depthMm - f.slabThicknessMm! })
  }
  // Keep every room in the one building frame; holes are never room floors.
  for (const r of building.rooms) {
    const f = byFloor.get(r.floorId)!, support = scene.floors.find(n => n.sourceId === f.id)!
    const supported = intersectRegions([r.rect], support.supportedRegionsMm)
    scene.rooms.push({ id: walkthroughRoomKey(f.id, r.id), sourceId: r.id, semanticId: r.semanticId, floorId: f.id, name: r.name,
      rectMm: { ...r.rect }, elevationM: f.elevationMm / 1000, outdoor: r.outdoor, supportedRegionsMm: supported })
    if (!r.outdoor && !voidRooms.has(sceneId(f.id, r.id)) && !supported.length) issue('ROOM_HAS_NO_FLOOR', r.id, 'The source indoor room has no supported floor.')
    const stairSpace = building.stairs.some(s => s.floorId === f.id && sameRect(s.rect, r.rect))
    if (!r.outdoor && !stairSpace && !voidRooms.has(sceneId(f.id, r.id)) && subtractRegions([r.rect], support.supportedRegionsMm).length)
      issue('ROOM_FLOOR_GAP', r.semanticId, 'A source indoor room extends into an unsupported floor area or void. The floor was not filled in.')
    if (r.outdoor && f.level > floors[0].level && supported.length && !building.walls.some(w => w.floorId === f.id && w.kind === 'parapet' && w.rooms?.includes(r.id)))
      issue('OUTDOOR_GUARDS_UNSPECIFIED', r.semanticId, 'Source outdoor floor/door geometry is retained; balcony or terrace guard details are not described by source walls.', 'warning')
  }
  for (const stair of scene.stairs) {
    const centre = (r: Rect) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 })
    const roomAt = (floorId: string, r: Rect) => { const p = centre(r), matches = scene.rooms.filter(n => n.floorId === floorId && containsPoint(n.rectMm, p)); return matches.length === 1 ? matches[0].id : null }
    const from = roomAt(stair.floorId, stair.startLandingMm), to = stair.destinationFloorId ? roomAt(stair.destinationFloorId, stair.destinationLandingMm) : scene.roofs.find(r => r.floorId === stair.floorId)?.id
    if (from && to) scene.connections.push({ id: sceneId('stair-link', stair.id), kind: 'stair', from, to, sourceId: stair.id })
    else issue('STAIR_LANDING_CONNECTION', stair.id, 'Source landings do not connect unique spaces; no room or bridge was invented.')
    const samples = [...stair.steps.map(s => ({ rect: s.rectMm, top: s.topMm })), { rect: stair.midLanding.rectMm, top: stair.midLanding.topMm }]
    for (const sample of samples) {
      const p = centre(sample.rect), blockers = scene.solids.filter(s => containsPoint(footprint(s.boundsMm), p) && s.boundsMm.z + s.boundsMm.h > sample.top + EPS)
        .map(s => ({ id: s.id, clearance: Math.max(0, s.boundsMm.z - sample.top) })).sort((a, b) => a.clearance - b.clearance)
      stair.headroom.push({ atMm: p, elevationMm: sample.top, clearanceMm: blockers[0]?.clearance ?? null, obstructionId: blockers[0]?.id ?? null })
    }
    if (stair.headroom.some(s => s.clearanceMm === 0)) issue('STAIR_OBSTRUCTED', stair.id, 'A source solid obstructs a stair centreline; geometry was not repaired.')
    issue('STAIR_CLEARANCE_REVIEW', stair.id, 'Headroom samples use actual source solids. Full body clearance and guards require a navigation-stage check.', 'warning')
  }
  for (const opening of scene.openings) {
    // An element behind a window or a stair meeting a wall's centre plane is
    // visible through the opening, not a second wall filling it. A hard aperture
    // obstruction crosses the actual opening plane, not merely the wall reveal.
    const normalAxis = opening.orient === 'h' ? 'y' : 'x', depthAxis = opening.orient === 'h' ? 'd' : 'w'
    const plane = opening.apertureMm[normalAxis] + opening.apertureMm[depthAxis] / 2
    const obstruction = scene.solids.find(s => overlaps(s.boundsMm, opening.apertureMm) &&
      s.boundsMm[normalAxis] < plane - EPS && s.boundsMm[normalAxis] + s.boundsMm[depthAxis] > plane + EPS)
    if (obstruction) issue('OPENING_OBSTRUCTED', opening.sourceId, `Opening is obstructed by source element ${obstruction.sourceIds.join(', ')}.`)
  }
  // A source-declared exterior doorway may lead straight onto a lower roof at
  // this storey's FFL. Confirm actual support across its entire outside edge;
  // never bridge a setback or assign a nearest terrace.
  for (const o of scene.openings.filter(o => o.kind !== 'window' && o.rooms?.includes(null))) {
    const key = o.rooms!.find(r => r !== null)!, room = scene.rooms.find(r => r.id === key)!, a = o.apertureMm
    const horizontal = o.orient === 'h', plane = horizontal ? a.y + a.d / 2 : a.x + a.w / 2
    const centre = horizontal ? room.rectMm.y + room.rectMm.h / 2 : room.rectMm.x + room.rectMm.w / 2
    const outward = centre < plane ? 1 : -1, depth = horizontal ? a.d : a.w
    const edge = plane + outward * depth / 2
    const band = horizontal ? { x: a.x, y: outward > 0 ? edge : edge - 1, w: a.w, h: 1 } : { x: outward > 0 ? edge : edge - 1, y: a.y, w: 1, h: a.d }
    const roofs = scene.roofs.filter(r => Math.abs(r.elevationM * 1000 - a.z) < EPS && !subtractRegions([band], r.regionsMm).length)
    if (roofs.length === 1) {
      roofs[0].access = 'source-door'
      const link = scene.connections.find(c => c.kind === 'door' && c.sourceId === o.sourceId && c.from === key)
      if (link) link.to = roofs[0].id
    }
  }
  const reached = new Set<string>()
  for (const o of scene.openings.filter(o => o.floorId === floors[0].id && o.kind !== 'window' && o.rooms?.includes(null))) for (const key of o.rooms!) if (key) reached.add(key)
  let changed = true
  while (changed) { changed = false; for (const edge of scene.connections) if (reached.has(edge.from) || edge.to && reached.has(edge.to))
    for (const key of [edge.from, edge.to]) if (key && !reached.has(key)) { reached.add(key); changed = true } }
  for (const room of scene.rooms.filter(r => !r.outdoor && !voidRooms.has(sceneId(r.floorId, r.sourceId)))) if (!reached.has(room.id))
    issue('ROOM_CONNECTIVITY_UNCONFIRMED', room.semanticId, 'No source-door/stair connection to an exterior entrance was confirmed. No connecting passage was added.', 'warning')
  if (scene.issues.some(i => i.severity === 'error')) return finish()
  scene.surfaces = exposedSurfaces(scene.solids)
  for (const o of scene.openings.filter(o => o.kind === 'window')) {
    const r = o.apertureMm, horizontal = o.orient === 'h', plane = horizontal ? r.y + r.d / 2 : r.x + r.w / 2
    // Preserve the full aperture record, but omit glass render faces hidden by
    // an opaque face touching the pane (e.g. a stair attached to a window wall).
    // This prevents coplanar glass/stair flicker without moving either geometry.
    const cuts = scene.solids.filter(s => {
      const b = s.boundsMm, low = horizontal ? b.y : b.x, high = low + (horizontal ? b.d : b.w)
      return low <= plane + EPS && high >= plane - EPS
    }).map(s => ({ x: horizontal ? s.boundsMm.x : s.boundsMm.y, y: s.boundsMm.z, w: horizontal ? s.boundsMm.w : s.boundsMm.d, h: s.boundsMm.h }))
    for (const p of subtractRegions([{ x: horizontal ? r.x : r.y, y: r.z, w: horizontal ? r.w : r.d, h: r.h }], cuts)) {
      const corners = horizontal ? [[p.x, plane, p.y], [p.x + p.w, plane, p.y], [p.x + p.w, plane, p.y + p.h], [p.x, plane, p.y + p.h]] :
        [[plane, p.x, p.y], [plane, p.x + p.w, p.y], [plane, p.x + p.w, p.y + p.h], [plane, p.x, p.y + p.h]]
      scene.surfaces.push({ id: sceneId(o.id, 'glazing', p.x, p.y, p.w, p.h), solidId: o.id, sourceIds: [o.sourceId], floorId: o.floorId, role: 'glass',
        vertices: corners.map(([x, y, z]) => { const w = planToThreeGlb({ x, y, z }); return [w.x, w.y, w.z] }), normal: horizontal ? [0, 0, 1] : [1, 0, 0] })
    }
  }
  scene.solids.sort((a, b) => a.id.localeCompare(b.id)); scene.surfaces.sort((a, b) => a.id.localeCompare(b.id))
  scene.openings.sort((a, b) => a.id.localeCompare(b.id)); scene.rooms.sort((a, b) => a.id.localeCompare(b.id)); scene.connections.sort((a, b) => a.id.localeCompare(b.id))
  return finish()
}
