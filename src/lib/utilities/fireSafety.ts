import type { FloorPlan, PlacedRoom } from '../engine/types.ts'
import { rectCenter, type Point, type Rect } from '../geometry.ts'
import { subtractRegions } from '../solar/regions.ts'
import { electricalPathAllowed, isBathroom, routeThroughDoors } from './electrical.ts'
import type { ExitRoute, FireCoverage, FireRun, FireSymbol, FireSymbolType, UtilitySymbol, UtilityZone } from './plan.ts'

const inside = (r: Rect, p: Point) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h
const length = (p: Point[]) => p.slice(1).reduce((n, b, i) => n + Math.hypot(b.x - p[i].x, b.y - p[i].y), 0)
const kitchen = (r: PlacedRoom) => /kitchen/i.test(`${r.id} ${r.name}`)

/** These user-requested radii are concept illustrations in millimetres, not
 * code spacing, a product specification or a fire-safety approval. Coverage
 * never travels through walls: only detectors in the SAME room contribute.
 * Subdivision is conservative: an unproven patch stays partial, never passed. */
export function detectorCoverage(floor: FloorPlan, symbols: FireSymbol[], cuts: Rect[] = []): FireCoverage[] {
  return floor.rooms.filter(r => !r.outdoor).map(room => {
    const detectors = symbols.filter(s => s.roomId === room.id && s.coverageRadiusMm !== null)
    if (isBathroom(room)) return { roomId: room.id, status: 'exempt', detectorIds: [] }
    if (!detectors.length) return { roomId: room.id, status: 'not-covered', detectorIds: [] }
    function proved(r: Rect, depth = 0): boolean {
      const corners = [{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }, { x: r.x, y: r.y + r.h }, { x: r.x + r.w, y: r.y + r.h }]
      if (detectors.some(s => corners.every(p => Math.hypot(p.x - s.position.x, p.y - s.position.y) <= s.coverageRadiusMm!))) return true
      if (depth >= 6 || detectors.every(s => Math.hypot(Math.max(r.x, Math.min(r.x + r.w, s.position.x)) - s.position.x, Math.max(r.y, Math.min(r.y + r.h, s.position.y)) - s.position.y) > s.coverageRadiusMm!)) return false
      return [0, 1].every(x => [0, 1].every(y => proved({ x: r.x + x * r.w / 2, y: r.y + y * r.h / 2, w: r.w / 2, h: r.h / 2 }, depth + 1)))
    }
    const regions = subtractRegions([room.rect], cuts)
    return { roomId: room.id, status: regions.length && regions.every(r => proved(r)) ? 'covered' : 'partial', detectorIds: detectors.map(s => s.id) }
  })
}

/** Only represented, ground-level doors leading to outside/covered outdoor
 * space qualify here. An upper-floor balcony door is never a building exit.
 * Stair discharge and accessibility are deliberately left for review. */
export function floorExits(floor: FloorPlan) {
  if (floor.level !== 0) return []
  return floor.openings.flatMap((o, i) => {
    if (o.kind === 'window' || !o.rooms) return []
    const indoor = o.rooms.map(id => floor.rooms.find(r => r.id === id)).find(r => r && !r.outdoor)
    const outside = o.rooms.some(id => id === null || floor.rooms.find(r => r.id === id)?.outdoor)
    if (!indoor || !outside) return []
    const priority = /main|front/i.test(o.id ?? '') ? 3 : /foyer|entrance/i.test(`${indoor.id} ${indoor.name}`) ? 2 : o.kind === 'entry' ? 1 : 0
    return [{ id: o.id ?? `exit:${floor.level}:${i}`, at: o.at, roomId: indoor.id, priority }]
  }).sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id))
}

export function evacuationRoutes(floor: FloorPlan, cuts: Rect[] = []): ExitRoute[] {
  const exits = floorExits(floor)
  return floor.rooms.filter(r => !r.outdoor).map(room => {
    const origin = [rectCenter(room.rect), ...[.25, .75].flatMap(x => [.25, .75].map(y => ({ x: room.rect.x + room.rect.w * x, y: room.rect.y + room.rect.h * y })))].find(p => !cuts.some(c => inside(c, p)))
    const candidates = exits.flatMap(exit => {
      const path = origin ? routeThroughDoors(origin, [room.id], exit.at, exit.roomId, floor, cuts, true) : null
      return path && electricalPathAllowed(path, floor, cuts) ? [{ exit, path }] : []
    }).sort((a, b) => length(a.path) - length(b.path) || a.exit.id.localeCompare(b.exit.id))
    const found = candidates[0]
    return { id: `escape:${floor.level}:${room.id}`, fromRoomId: room.id, path: found?.path ?? [], exitId: found?.exit.id ?? null,
      status: found ? 'concept' : exits.length ? 'blocked' : 'no-exit',
      reason: found ? null : exits.length ? 'No door-connected route to a represented exit.' : 'No represented ground-level exit on this floor. Stair discharge needs review.' }
  })
}

/** Read-only Phase 3 augmentation of the existing utility data. Passive
 * sprinklers/extinguishers/exit signs belong to the safety schedule, but are
 * NOT falsely wired into the alarm cable loop. Sprinkler hydraulics and exit
 * sign power feeds are outside this concept model. */
export function fireSafetyPlan(floor: FloorPlan, cuts: Rect[], radii: { smoke_detector: number; heat_detector: number }, otherServices: UtilitySymbol[] = []) {
  const rooms = floor.rooms.filter(r => !r.outdoor), symbols: FireSymbol[] = [], utilities: FireRun[] = [], zones: UtilityZone[] = [], notes: string[] = []
  const exitRoutes = evacuationRoutes(floor, cuts), exits = floorExits(floor)
  if (!rooms.length) return { symbols, utilities, zones, notes, exitRoutes, coverage: [] }
  const entrance = exits[0] ?? floor.openings.flatMap(o => o.kind === 'entry' ? [{ at: o.at, roomId: o.rooms?.find(id => rooms.some(r => r.id === id)) }] : [])[0]
  const common = rooms.filter(r => !isBathroom(r) && !kitchen(r) && /corridor|hall|foyer|lobby|gallery|living|dining/i.test(`${r.id} ${r.name}`))
    .sort((a, b) => Number(/corridor|hall|lobby/i.test(`${b.id} ${b.name}`)) - Number(/corridor|hall|lobby/i.test(`${a.id} ${a.name}`)) || b.area - a.area)
  const host = rooms.find(r => r.id === entrance?.roomId) ?? common[0] ?? rooms[0]
  const zone: UtilityZone = { id: `F:${floor.level}:Z1`, name: 'Zone 1', tag: 'Z1', color: '#F57C00', panelId: `F:${floor.level}:panel`, devices: [], cableType: 'FRLS 2C', loopStatus: 'closed', missingLinks: [] }
  zones.push(zone)
  function place(room: PlacedRoom, type: FireSymbolType, nx: number, ny: number): FireSymbol | null {
    const r = room.rect, inset = Math.min(250, r.w / 4, r.h / 4)
    const options = [[nx, ny], ...[.18, .4, .65, .82].flatMap(x => [.18, .4, .65, .82].map(y => [x, y]))].map(([x, y]) => ({ x: Math.max(r.x + inset, Math.min(r.x + r.w - inset, r.x + r.w * x)), y: Math.max(r.y + inset, Math.min(r.y + r.h - inset, r.y + r.h * y)) }))
    const position = options.find(p => !cuts.some(c => inside(c, p)) && symbols.every(s => Math.hypot(s.position.x - p.x, s.position.y - p.y) > 320) && otherServices.every(s => Math.hypot(s.position.x - p.x, s.position.y - p.y) >= (s.layer === 'electrical' ? 600 : 200)))
    if (!position) { notes.push(`Fire safety position needs review: ${room.name}.`); return null }
    const passive = ['sprinkler', 'extinguisher', 'exit_sign'].includes(type)
    const label = ({ fire_panel: 'Fire panel', smoke_detector: 'Smoke detector', heat_detector: 'Heat detector', manual_call_point: 'Manual call point', sounder: 'Sounder', sprinkler: 'Sprinkler', extinguisher: 'Extinguisher', exit_sign: 'Exit sign' })[type]
    const s: FireSymbol = { id: type === 'fire_panel' ? zone.panelId : `F:${floor.level}:${room.id}:${type}:${symbols.length}`, type, label, position, layer: 'fire_alarm', roomId: room.id, roomIds: [room.id], zoneId: zone.id,
      coverageRadiusMm: type === 'smoke_detector' || type === 'heat_detector' ? radii[type] : null, connection: passive ? 'standalone' : 'alarm-loop', basis: 'proposed' }
    symbols.push(s); if (!passive && type !== 'fire_panel') zone.devices.push(s.id)
    return s
  }
  const r = host.rect, at = entrance?.at ?? { x: r.x + 250, y: r.y + 600 }
  const panel = place(host, 'fire_panel', (at.x - r.x + 400) / r.w, (at.y - r.y + 400) / r.h)
  if (!panel) zone.loopStatus = 'incomplete'
  // Each non-wet indoor space gets its own detector. Ceiling coverage cannot
  // travel through walls from the old two common-area detectors.
  for (const room of rooms.filter(r => !isBathroom(r))) {
    const type = kitchen(room) ? 'heat_detector' : 'smoke_detector', radius = radii[type]
    const cols = Math.max(1, Math.ceil(room.rect.w / (radius * 1.1))), rows = Math.max(1, Math.ceil(room.rect.h / (radius * 1.1)))
    for (let x = 0; x < cols; x++) for (let y = 0; y < rows; y++) place(room, type, (x + .5) / cols, (y + .5) / rows)
    if (kitchen(room)) { place(room, 'sprinkler', .68, .65); place(room, 'extinguisher', .18, .82) }
  }
  if (common.length) {
    const room = common.find(r => r.id === host.id) ?? common[0], door = floor.openings.find(o => o.kind !== 'window' && o.rooms?.includes(room.id))
    place(room, 'manual_call_point', door ? (door.at.x - room.rect.x + 350) / room.rect.w : .12, door ? (door.at.y - room.rect.y + 350) / room.rect.h : .18)
    place(room, 'sounder', .78, .2)
  } else notes.push('No corridor/common area is represented for smoke detector and call-point proposals.')
  for (const exit of exits) {
    const room = rooms.find(r => r.id === exit.roomId)!, sign = place(room, 'exit_sign', (exit.at.x - room.rect.x) / room.rect.w, (exit.at.y - room.rect.y) / room.rect.h)
    // The sign is attached to the actual exit opening, not an arbitrary wall.
    if (sign) sign.position = { ...exit.at }
  }
  const devices = symbols.filter(s => zone.devices.includes(s.id)), pending = [...devices]
  const ordered: FireSymbol[] = [], start = panel
  let previous = start
  // Deterministic nearest-next order. Every link is a door-validated route;
  // the final link returns to the panel instead of making a star network.
  while (pending.length) {
    pending.sort((a, b) => (previous ? Math.hypot(a.position.x - previous.position.x, a.position.y - previous.position.y) - Math.hypot(b.position.x - previous.position.x, b.position.y - previous.position.y) : 0) || a.id.localeCompare(b.id))
    const next = pending.shift()!; ordered.push(next); previous = next
  }
  if (!devices.length) zone.loopStatus = 'incomplete'
  previous = start
  for (const next of [...ordered, ...(start && ordered.length ? [start] : [])]) {
    const path = previous ? routeThroughDoors(previous.position, previous.roomIds, next.position, next.roomId, floor, cuts, true, true, next === start ? 500 : 340) : null
    if (path && path.length > 1) utilities.push({ id: `${zone.id}:link:${utilities.length}`, layer: 'fire_alarm', zoneId: zone.id, fromSymbolId: previous!.id, toSymbolId: next.id, path, cableType: 'FRLS 2C', roomId: next.roomId })
    else { zone.loopStatus = 'incomplete'; zone.missingLinks.push({ from: previous?.id ?? zone.panelId, to: next.id }) }
    previous = next
  }
  return { symbols, utilities, zones, notes, exitRoutes, coverage: detectorCoverage(floor, symbols, cuts) }
}
