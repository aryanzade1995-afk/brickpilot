import { sharedEdge, type Point, type Rect } from '../geometry.ts'
import type { FloorPlan, PlacedRoom } from '../engine/types.ts'
import type { ElectricalRun, ElectricalSymbol, ElectricalSymbolType, Fixture, UtilityCircuit } from './plan.ts'
import { route, simplifyPath, perimeterRoutes } from './routing.ts'
import { mountSymbol } from './electricalMounts.ts'

const EPS = .01
const inRect = (r: Rect, p: Point, tolerance = 1) => p.x >= r.x - tolerance && p.y >= r.y - tolerance && p.x <= r.x + r.w + tolerance && p.y <= r.y + r.h + tolerance
const same = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y) < EPS
export const isBathroom = (r: PlacedRoom) => /bath|toilet|washroom|powder/i.test(`${r.id} ${r.name} ${r.semanticId}`)

/** Exact line intersection. Endpoint intersections are returned too, so a
 * wire cannot hide a forbidden wall crossing by inserting a vertex there. */
export function segmentIntersection(a: Point, b: Point, c: Point, d: Point): Point | null {
  const rx = b.x - a.x, ry = b.y - a.y, sx = d.x - c.x, sy = d.y - c.y, cross = rx * sy - ry * sx
  if (Math.abs(cross) < EPS) return null
  const t = ((c.x - a.x) * sy - (c.y - a.y) * sx) / cross, u = ((c.x - a.x) * ry - (c.y - a.y) * rx) / cross
  return t >= -1e-9 && t <= 1 + 1e-9 && u >= -1e-9 && u <= 1 + 1e-9 ? { x: a.x + t * rx, y: a.y + t * ry } : null
}
function crossesCut(a: Point, b: Point, r: Rect) {
  return Math.max(a.x, b.x) > r.x + EPS && Math.min(a.x, b.x) < r.x + r.w - EPS && Math.max(a.y, b.y) > r.y + EPS && Math.min(a.y, b.y) < r.y + r.h - EPS
}
export function electricalPathAllowed(path: Point[], floor: FloorPlan, cuts: Rect[] = []): boolean {
  return path.slice(1).every((b, i) => {
    const a = path[i]
    if (a.x !== b.x && a.y !== b.y || cuts.some(c => crossesCut(a, b, c))) return false
    return floor.walls.every(w => {
      const p = segmentIntersection(a, b, w.a, w.b)
      if (!p) return true
      // A board can attach to a wall; leaving/arriving at that endpoint does
      // not cross a wall. Interior vertices must still be actual door portals.
      if (i === 0 && same(p, path[0]) || i === path.length - 2 && same(p, path.at(-1)!)) return true
      return floor.openings.some(o => o.kind !== 'window' && Math.abs(o.orient === 'h' ? p.y - o.at.y : p.x - o.at.x) < 25 && Math.abs(o.orient === 'h' ? p.x - o.at.x : p.y - o.at.y) <= o.width / 2 - 20)
    })
  })
}
function roomRoute(from: Point, to: Point, room: PlacedRoom, floor: FloorPlan, cuts: Rect[], preferEdges = false, surfaceRouting = false): Point[] | null {
  const r = room.rect
  if (!inRect(r, from, 25) || !inRect(r, to, 25)) return null
  const inset = Math.min(220, r.w / 5, r.h / 5)
  const faceInset = (axis: number, horizontal: boolean) => Math.max(35, ...floor.walls.filter(w => Math.abs(horizontal ? w.a.y - w.b.y : w.a.x - w.b.x) < 1 && Math.abs((horizontal ? w.a.y : w.a.x) - axis) < 25 && Math.max(horizontal ? w.a.x : w.a.y, horizontal ? w.b.x : w.b.y) >= (horizontal ? r.x : r.y) && Math.min(horizontal ? w.a.x : w.a.y, horizontal ? w.b.x : w.b.y) <= (horizontal ? r.x + r.w : r.y + r.h)).map(w => w.thickness / 2 + 35))
  const left = surfaceRouting ? Math.min(r.w / 4, faceInset(r.x, false)) : inset, right = surfaceRouting ? Math.min(r.w / 4, faceInset(r.x + r.w, false)) : inset
  const top = surfaceRouting ? Math.min(r.h / 4, faceInset(r.y, true)) : inset, bottom = surfaceRouting ? Math.min(r.h / 4, faceInset(r.y + r.h, true)) : inset
  const inner = { x: r.x + left, y: r.y + top, w: r.w - left - right, h: r.h - top - bottom }
  const inward = (p: Point) => ({ x: Math.max(inner.x, Math.min(inner.x + inner.w, p.x)), y: Math.max(inner.y, Math.min(inner.y + inner.h, p.y)) })
  const a = inward(from), b = inward(to)
  const valid = (path: Point[]) => path.every(p => inRect(r, p, 25)) && electricalPathAllowed(path, floor, cuts)
  const joined = (middle: Point[]) => simplifyPath([...route(from, a), ...middle, ...route(b, to)])
  if (preferEdges) {
    const candidates = perimeterRoutes(a, b, inner).map(joined).filter(valid)
    const length = (p: Point[]) => p.slice(1).reduce((n, b, i) => n + Math.hypot(b.x - p[i].x, b.y - p[i].y), 0)
    if (candidates.length) return candidates.sort((x, y) => length(x) - length(y))[0]
  }
  for (const vertical of [false, true]) { const p = joined(route(a, b, vertical)); if (valid(p)) return p }
  // Small rectilinear visibility graph for represented voids. No raster
  // approximation and no global search over the architectural design.
  const relevant = cuts.filter(c => c.x < r.x + r.w && c.x + c.w > r.x && c.y < r.y + r.h && c.y + c.h > r.y)
  const xs = [...new Set([a.x, b.x, r.x + inset, r.x + r.w - inset, ...relevant.flatMap(c => [c.x - inset, c.x + c.w + inset])])].filter(x => x >= r.x && x <= r.x + r.w).sort((x, y) => x - y)
  const ys = [...new Set([a.y, b.y, r.y + inset, r.y + r.h - inset, ...relevant.flatMap(c => [c.y - inset, c.y + c.h + inset])])].filter(y => y >= r.y && y <= r.y + r.h).sort((x, y) => x - y)
  const nodes = xs.flatMap(x => ys.map(y => ({ x, y }))), start = nodes.findIndex(p => same(p, a)), end = nodes.findIndex(p => same(p, b))
  const distance = nodes.map(() => Infinity), previous = nodes.map(() => -1), pending = new Set(nodes.map((_, i) => i))
  distance[start] = 0
  while (pending.size) {
    let current = -1
    for (const i of pending) if (current < 0 || distance[i] < distance[current]) current = i
    if (current < 0 || !Number.isFinite(distance[current])) break
    if (current === end) {
      const path: Point[] = []; for (let i = end; i >= 0; i = previous[i]) path.unshift(nodes[i])
      const result = joined(path); return valid(result) ? result : null
    }
    pending.delete(current)
    for (const j of pending) {
      if (nodes[current].x !== nodes[j].x && nodes[current].y !== nodes[j].y || !valid([nodes[current], nodes[j]])) continue
      const candidate = distance[current] + Math.hypot(nodes[j].x - nodes[current].x, nodes[j].y - nodes[current].y)
      if (candidate < distance[j]) { distance[j] = candidate; previous[j] = current }
    }
  }
  return null
}

/** Traverse only named rooms connected by actual door/open-entry openings.
 * Windows, missing doors and unsupported gaps never become wire portals. */
export function routeThroughDoors(from: Point, fromRooms: string[], to: Point, toRoom: string, floor: FloorPlan, cuts: Rect[] = [], preferEdges = false, surfaceRouting = false): Point[] | null {
  const rooms = floor.rooms.filter(r => !r.outdoor)
  const queue = fromRooms.filter(id => rooms.some(r => r.id === id)).map(id => ({ id, at: from, path: [from], seen: new Set([id]) }))
  const visited = new Map<string, number>()
  const length = (p: Point[]) => p.slice(1).reduce((n, b, i) => n + Math.hypot(b.x - p[i].x, b.y - p[i].y), 0)
  let best: Point[] | null = null
  while (queue.length) {
    if (preferEdges) queue.sort((a, b) => length(a.path) - length(b.path))
    const node = queue.shift()!, room = rooms.find(r => r.id === node.id)!
    if (preferEdges && best && length(node.path) >= length(best)) continue
    if (node.id === toRoom) {
      const local = roomRoute(node.at, to, room, floor, cuts, preferEdges, surfaceRouting)
      if (local) { const result = simplifyPath([...node.path, ...local]); if (electricalPathAllowed(result, floor, cuts)) { if (!preferEdges) return result; if (!best || length(result) < length(best)) best = result } }
    }
    for (const o of floor.openings) {
      if (o.kind === 'window' || !o.rooms?.includes(node.id)) continue
      const next = o.rooms.find(id => id && id !== node.id)
      if (!next || node.seen.has(next) || !rooms.some(r => r.id === next)) continue
      const entry = `${next}:${o.at.x}:${o.at.y}`
      if (!preferEdges && visited.has(entry)) continue
      const local = roomRoute(node.at, o.at, room, floor, cuts, preferEdges, surfaceRouting)
      if (local) {
        const path = [...node.path, ...local], cost = length(path)
        if (preferEdges && (visited.get(entry) ?? Infinity) <= cost) continue
        visited.set(entry, cost); queue.push({ id: next, at: o.at, path, seen: new Set([...node.seen, next]) })
      }
    }
  }
  return best
}

/** Phase-2 electrical proposals augment the existing drainage data object.
 * The requested wire/breaker sizes are illustrative labels, not a load study,
 * an installed specification, a priced quantity or an electrical approval. */
export function electricalPlan(floor: FloorPlan, cuts: Rect[], fixtures: Fixture[], heightMm = 3000) {
  const rooms = floor.rooms.filter(r => !r.outdoor)
  const symbols: ElectricalSymbol[] = [], circuits: UtilityCircuit[] = [], utilities: ElectricalRun[] = [], notes: string[] = []
  if (!rooms.length) return { symbols, circuits, utilities, notes }
  let panelRooms = [rooms.find(r => /kitchen/i.test(`${r.id} ${r.name}`)) ?? rooms[0]], panelAt: Point | null = null
  for (const kitchen of rooms.filter(r => /kitchen/i.test(`${r.id} ${r.name}`))) {
    for (const bathroom of rooms.filter(isBathroom)) {
      const edge = sharedEdge(kitchen.rect, bathroom.rect)
      if (!edge || edge.length < 600) continue
      const p = { x: (edge.seg.a.x + edge.seg.b.x) / 2, y: (edge.seg.a.y + edge.seg.b.y) / 2 }
      if (cuts.some(c => inRect(c, p)) || floor.openings.some(o => Math.abs(o.orient === 'h' ? p.y - o.at.y : p.x - o.at.x) < 150 && Math.abs(o.orient === 'h' ? p.x - o.at.x : p.y - o.at.y) < o.width / 2 + 180)) continue
      panelRooms = [kitchen, bathroom]; panelAt = p; break
    }
    if (panelAt) break
  }
  if (!panelAt) {
    const host = floor.rooms.find(r => !r.outdoor && /foyer|corridor|lobby|gallery/i.test(`${r.id} ${r.name}`)) ?? panelRooms[0]
    panelRooms = [host]; panelAt = { x: host.rect.x + 220, y: host.rect.y + Math.min(host.rect.h * .3, 800) }
    if (cuts.some(c => inRect(c, panelAt!))) { notes.push('No clear distribution-board proposal on this floor.'); return { symbols, circuits, utilities, notes } }
  }
  const panelId = `E:${floor.level}:DB`, lightingId = `E:${floor.level}:L1`, powerId = `E:${floor.level}:P1`
  circuits.push({ id: lightingId, name: 'Lighting 1', tag: 'L1', color: '#D32F2F', panelId, loads: [], controls: [], wireSize: '1.5mm2', breaker: '10A', status: 'concept', unroutedLoads: [] },
    { id: powerId, name: 'Power 1', tag: 'P1', color: '#C45917', panelId, loads: [], controls: [], wireSize: '2.5mm2', breaker: '16A', status: 'concept', unroutedLoads: [] })
  const panelMount = mountSymbol(floor, panelRooms[0], 'db_panel', 'DB panel', panelAt, heightMm)
  symbols.push({ id: panelId, type: 'db_panel', label: 'DB panel', layer: 'electrical', ...panelMount, roomId: panelRooms[0].id, roomIds: panelRooms.map(r => r.id), circuitIds: [lightingId, powerId], basis: 'proposed' })
  if (!panelMount.mount) notes.push('Distribution board wall mounting needs review.')
  const panel = symbols[0]
  for (const room of rooms) {
    const r = room.rect, bath = isBathroom(room), positions: Point[] = []
    const place = (type: ElectricalSymbolType, label: string, nx: number, ny: number, circuit: UtilityCircuit) => {
      const desired = { x: r.x + Math.max(180, Math.min(r.w - 180, r.w * nx)), y: r.y + Math.max(180, Math.min(r.h - 180, r.h * ny)) }
      const options = [desired, ...[.15, .35, .6, .85].flatMap(x => [.15, .4, .7, .85].map(y => ({ x: r.x + r.w * x, y: r.y + r.h * y })))]
      const placed = options.map(p => mountSymbol(floor, room, type, label, p, heightMm)).find(s => !cuts.some(c => inRect(c, s.position)) && positions.every(q => Math.hypot(s.position.x - q.x, s.position.y - q.y) > 260))
      if (!placed) { circuit.status = 'needs-review'; notes.push(`No clear electrical symbol position for ${room.name}: ${label}.`); return null }
      positions.push(placed.position)
      const symbol: ElectricalSymbol = { id: `E:${floor.level}:${room.id}:${type}:${symbols.length}`, layer: 'electrical', type, label, ...placed, roomId: room.id, roomIds: [room.id], circuitIds: [circuit.id], basis: 'proposed' }
      symbols.push(symbol); (type === 'switch' ? circuit.controls : circuit.loads).push(symbol.id); return symbol
    }
    const door = floor.openings.find(o => o.kind !== 'window' && o.rooms?.includes(room.id))
    const switchPoint = door ? { x: Math.max(r.x + 220, Math.min(r.x + r.w - 220, door.at.x + (door.orient === 'h' ? door.width / 2 + 220 : 220))), y: Math.max(r.y + 220, Math.min(r.y + r.h - 220, door.at.y + (door.orient === 'v' ? door.width / 2 + 220 : 220))) } : { x: r.x + 250, y: r.y + r.h - 250 }
    const lightCircuit = circuits[0], powerCircuit = circuits[1]
    const sw = door ? place('switch', 'Switch at door', (switchPoint.x - r.x) / r.w, (switchPoint.y - r.y) / r.h, lightCircuit) : null
    if (!door) { lightCircuit.status = 'needs-review'; notes.push(`Switch position requires a door review: ${room.name}.`) }
    const isKitchen = /kitchen/i.test(`${room.id} ${room.name}`), passage = /stair|corridor|hall|foyer|lobby|gallery/i.test(`${room.id} ${room.name}`)
    const lights = bath ? [place('light', 'Ceiling light', .5, .48, lightCircuit), place('exhaust_fan', 'Exhaust fan', .82, .12, lightCircuit)] : isKitchen ? [place('light', 'Ceiling light 1', .35, .48, lightCircuit), place('light', 'Ceiling light 2', .7, .48, lightCircuit)] : [place('light', 'Ceiling light', .5, .5, lightCircuit)]
    const sockets = bath ? [place('socket', 'Geyser socket · 16A', .85, .65, powerCircuit)] : isKitchen ? [place('socket', 'Fridge socket', .12, .15, powerCircuit), place('socket', 'Chimney socket', .7, .15, powerCircuit), place('socket', 'General socket', .85, .8, powerCircuit)] : passage ? [] : [place('socket', 'General socket', .15, .7, powerCircuit), ...(/bed|living|study|office|lounge/i.test(`${room.id} ${room.name}`) ? [place('socket', 'General socket 2', .85, .7, powerCircuit)] : [])]
    for (const [circuit, chain] of [[lightCircuit, [sw, ...lights]], [powerCircuit, sockets]] as const) {
      let previous: ElectricalSymbol | null = circuit.tag === 'L1' && !sw ? null : panel
      for (const load of chain) {
        if (!load) continue
        const path: Point[] | null = previous ? routeThroughDoors(previous.position, previous.roomIds, load.position, room.id, floor, cuts, true, true) : null
        if (!path) {
          if (load.type === 'switch') circuit.unroutedLoads.push(...lights.filter((s): s is ElectricalSymbol => !!s).map(s => s.id))
          else circuit.unroutedLoads.push(load.id)
          circuit.status = 'needs-review'; previous = null; continue
        }
        utilities.push({ id: `${circuit.id}:${load.id}`, layer: 'electrical', circuitId: circuit.id, fromSymbolId: previous!.id, toSymbolId: load.id, path, wireSize: circuit.wireSize, roomId: room.id, conductors: 3 })
        previous = load
      }
    }
  }
  for (const circuit of circuits) { circuit.unroutedLoads = [...new Set(circuit.unroutedLoads)]; if (circuit.unroutedLoads.length) notes.push(`${circuit.name}: ${circuit.unroutedLoads.length} loads need a door/routing review.`) }
  // Fixture positions are shared with drainage, but electrical proposals never
  // alter them. Kept as an input for later appliance-specific placement rules.
  void fixtures
  return { symbols, circuits, utilities, notes }
}
