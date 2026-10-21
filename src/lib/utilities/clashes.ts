import type { Point, Rect } from '../geometry.ts'
import type { UtilityFloor, UtilityLayer } from './plan.ts'
import { electricalScene } from './electrical3D.ts'
import { waterScene } from './water3D.ts'
import { electricalPathAllowed } from './electrical.ts'
import { CLASH_RULES, CLASH_LAYER_ELEVATIONS_MM, CLASH_COLORS, type ClashRule } from './clashRules.ts'
import { insidePolygon, segmentDistance, segmentPolygon, segmentBox, type XYZ } from './clashGeometry.ts'

export type ClashStatus = 'open' | 'acknowledged' | 'resolved' | 'ignored'
export type Clash = {
  id: string; type: 'HARD' | 'CLEARANCE' | 'CODE'; severity: 'high' | 'medium' | 'low'
  layerA: UtilityLayer; layerB: UtilityLayer; itemA: string; itemB: string
  position: Point; elevationMm: number | null; distance: number | null; distanceBasis: '3d' | 'plan' | 'not-applicable'
  rule: string; ruleId: string; roomId: string; roomIds: string[]; status: ClashStatus
  certainty: 'concept-model' | 'needs-verification'; suggestion: string; fingerprint: string; note?: string; needsReview?: boolean
}
type Segment = { a: XYZ; b: XYZ; known: boolean }
type Body = { id: string; layer: UtilityLayer; type: string; roomIds: string[]; segments: Segment[]; radius: number; network: string | null; nodes: string[]; signature: string }
type CachedClashes = { signature: string; clashes: Clash[] }
export type ClashCache = { pairs: Map<string, CachedClashes>; structures: Map<string, CachedClashes>; stats: { candidates: number; checked: number; reused: number; segments: number } }
export const createClashCache = (): ClashCache => ({ pairs: new Map(), structures: new Map(), stats: { candidates: 0, checked: 0, reused: 0, segments: 0 } })
export const clashColor = (severity: Clash['severity']) => CLASH_COLORS[severity]
export const clashTypeLabel = (type: Clash['type']) => ({ HARD: 'Physical crossing', CLEARANCE: 'Clearance review', CODE: 'Rule review' })[type]
export const layerPair = (c: Pick<Clash, 'layerA' | 'layerB'>) => [c.layerA, c.layerB].sort().join('|')
export function hash(value: unknown) {
  const text = JSON.stringify(value); let a = 2166136261, b = 5381
  for (let i = 0; i < text.length; i++) { a = Math.imul(a ^ text.charCodeAt(i), 16777619); b = Math.imul(b, 33) ^ text.charCodeAt(i) }
  return (a >>> 0).toString(36) + (b >>> 0).toString(36)
}
const polygon = (r: Rect): Point[] => [{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }, { x: r.x + r.w, y: r.y + r.h }, { x: r.x, y: r.y + r.h }]
const wet = (name: string) => /bath|toilet|shower|powder|washroom/i.test(name)
const subtype = (b: Body) => b.type === 'hot' || b.type === 'cold' ? b.type : null
const tuples = (points: XYZ[], known: boolean): Segment[] => points.length === 1 ? [{ a: points[0], b: points[0], known }] : points.slice(1).map((b, i) => ({ a: points[i], b, known }))
const planPoint = (p: XYZ) => ({ x: p[0], y: p[1] })
const flatten = (p: XYZ): XYZ => [p[0], p[1], 0]

function bodiesOf(model: UtilityFloor, elevations: Partial<Record<UtilityLayer, number>>, itemElevations: Record<string, number>): Body[] {
  // Reuse exactly the heights/drops in the existing viewer; never route here.
  const electric = electricalScene(model), water = waterScene(model)
  const geometry = new Map([...electric.wires, ...water.pipes].map(p => [p.id, p.points.map(([x, height, y]): XYZ => [x * 1000, y * 1000, height * 1000])]))
  const bodies: Body[] = []
  const add = (body: Omit<Body, 'signature'>) => bodies.push({ ...body, signature: hash(body) })
  for (const run of model.utilities) {
    const elevation = itemElevations[run.id] ?? elevations[run.layer]
    const actual = geometry.get(run.id), known = Number.isFinite(elevation) || !!actual
    const points = Number.isFinite(elevation) || !actual ? run.path.map((p): XYZ => [p.x, p.y, elevation ?? 0]) : actual!
    if (!points.length || points.some(p => p.some(v => !Number.isFinite(v)))) continue
    const nodes = run.layer === 'drainage' ? [run.fixtureId, run.stackId] : [run.fromSymbolId, run.toSymbolId]
    add({ id: run.id, layer: run.layer, type: run.layer === 'water_supply' ? run.service : 'run', roomIds: [run.roomId], segments: tuples(points, known), radius: 'diameter' in run && Number.isFinite(run.diameter) ? run.diameter / 2 : 0,
      network: run.layer === 'electrical' ? run.circuitId : run.layer === 'fire_alarm' ? run.zoneId : run.layer === 'water_supply' ? run.networkId : null, nodes })
  }
  for (const symbol of model.symbols) {
    const elevation = itemElevations[symbol.id] ?? ('mount' in symbol ? symbol.mount?.elevationMm : undefined) ?? elevations[symbol.layer]
    add({ id: symbol.id, layer: symbol.layer, type: symbol.type, roomIds: symbol.roomIds,
      segments: tuples([[symbol.position.x, symbol.position.y, elevation ?? 0]], Number.isFinite(elevation)), radius: 0,
      network: symbol.layer === 'electrical' ? symbol.circuitIds[0] ?? null : symbol.layer === 'fire_alarm' ? symbol.zoneId : symbol.layer === 'water_supply' ? symbol.networkId : null, nodes: [symbol.id] })
  }
  return bodies.sort((a, b) => a.id.localeCompare(b.id))
}

function match(rule: ClashRule, a: Body, b: Body): [Body, Body] | null {
  for (const [first, second] of [[a, b], [b, a]]) {
    if (first.layer !== rule.a || second.layer !== rule.b || rule.aTypes && !rule.aTypes.includes(first.type) || rule.bTypes && !rule.bTypes.includes(second.type)) continue
    if (rule.runsOnly && (first.segments.length === 1 && first.segments[0].a === first.segments[0].b || second.segments.length === 1 && second.segments[0].a === second.segments[0].b)) continue
    if (rule.subtypes && !(rule.subtypes.includes(subtype(first) ?? '') && rule.subtypes.includes(subtype(second) ?? '') && subtype(first) !== subtype(second))) continue
    if (rule.allowSharedNetwork && first.network && first.network === second.network) continue
    return [first, second]
  }
  return null
}

function makeClash(model: UtilityFloor, rule: ClashRule, a: string, b: string, layerA: UtilityLayer, layerB: UtilityLayer, roomIds: string[], data: Partial<Clash>, fingerprint: unknown): Clash {
  const identity = [model.floor.level, rule.id, ...[a, b].sort()]
  return { id: `C-${hash(identity)}`, type: 'CODE', severity: rule.severity, layerA, layerB, itemA: a, itemB: b,
    roomId: roomIds[0] ?? '', roomIds, position: { x: 0, y: 0 }, elevationMm: null, distance: null, distanceBasis: 'not-applicable',
    rule: rule.message, ruleId: rule.id, status: 'open', certainty: 'needs-verification', suggestion: rule.suggestion,
    ...data, fingerprint: hash([rule, fingerprint, roomIds.map(id => model.floor.rooms.find(r => r.id === id))]) }
}

function compare(model: UtilityFloor, rule: ClashRule, a: Body, b: Body): Clash[] {
  if (a.nodes.includes(b.id) || b.nodes.includes(a.id)) return [] // actual run-to-device connections
  const candidates: Clash[] = []
  for (const first of a.segments) for (const second of b.segments) {
    const projected = segmentDistance(flatten(first.a), flatten(first.b), flatten(second.a), flatten(second.b))
    if (projected.distance > rule.minDistMm + a.radius + b.radius + .01) continue
    const known = first.known && second.known
    const nearest = known ? segmentDistance(first.a, first.b, second.a, second.b) : projected
    // Do not report intended junctions such as drains meeting at their shared stack.
    const shared = a.nodes.filter(id => b.nodes.includes(id)).map(id => model.symbols.find(s => s.id === id)?.position).filter((p): p is Point => !!p)
    if (shared.some(p => Math.hypot(p.x - projected.position.x, p.y - projected.position.y) <= Math.max(1, a.radius + b.radius))) continue
    const rooms = model.floor.rooms.filter(r => !r.outdoor && segmentPolygon(planPoint(first.a), planPoint(first.b), polygon(r.rect)) && segmentPolygon(planPoint(second.a), planPoint(second.b), polygon(r.rect)) && insidePolygon(projected.position, polygon(r.rect)))
    if (rule.wetAreaOnly && !rooms.some(r => wet(`${r.id} ${r.name} ${r.semanticId}`))) continue
    // Inversion checks apply to projected supply/drain crossings even if their
    // vertical separation is large. This is a concept policy, not a code claim.
    let inverted = false
    if (rule.check === 'supply-order' && known) {
      const zAt = (s: Segment, p: XYZ) => {
        const dx = s.b[0] - s.a[0], dy = s.b[1] - s.a[1], length2 = dx * dx + dy * dy
        const t = length2 ? Math.max(0, Math.min(1, ((p[0] - s.a[0]) * dx + (p[1] - s.a[1]) * dy) / length2)) : .5
        return s.a[2] + t * (s.b[2] - s.a[2])
      }
      inverted = zAt(first, projected.first) < zAt(second, projected.second)
    }
    const separation = Math.max(0, nearest.distance - a.radius - b.radius)
    if (known && !inverted && separation > rule.minDistMm + .01) continue
    // Wet-zone reviews are equipment/fixture checks. A clear difference in
    // height is respected using the same 3D separation as other rules.
    const type = inverted || rule.check === 'wet-zone' ? 'CODE' : known && nearest.distance <= a.radius + b.radius + .01 ? 'HARD' : 'CLEARANCE'
    const roomIds = rooms.length ? rooms.map(r => r.id) : [...new Set([...a.roomIds, ...b.roomIds])]
    candidates.push(makeClash(model, rule, a.id, b.id, a.layer, b.layer, roomIds, {
      type, position: nearest.position, elevationMm: known ? nearest.elevationMm : null, distance: separation,
      distanceBasis: known ? '3d' : 'plan', certainty: known ? 'concept-model' : 'needs-verification',
    }, [a.signature, b.signature]))
  }
  // One marker per pair/rule; rank physical intersections before clearances.
  candidates.sort((x, y) => (x.type === 'HARD' ? -1 : 0) - (y.type === 'HARD' ? -1 : 0) || (x.distance ?? 0) - (y.distance ?? 0) || x.position.x - y.position.x || x.position.y - y.position.y)
  return candidates.slice(0, 1)
}

/** Unified, read-only concept clash detection. Does not move or route items.
 * The grid broad phase finds nearby segments/symbols. Unchanged candidate pairs
 * reuse narrow-phase results; removed items/pairs are evicted each pass.
 * UI filters and zoom never enter detection. */
export function detectClashes(model: UtilityFloor, options: { rules?: ClashRule[]; cache?: ClashCache; layerElevationsMm?: Partial<Record<UtilityLayer, number>>; itemElevationsMm?: Record<string, number> } = {}): Clash[] {
  const rules = options.rules ?? CLASH_RULES, cache = options.cache ?? createClashCache()
  const bodies = bodiesOf(model, { ...CLASH_LAYER_ELEVATIONS_MM, ...options.layerElevationsMm }, options.itemElevationsMm ?? {})
  const paired = rules.filter(r => !['wall', 'exit', 'coverage'].includes(r.check ?? ''))
  const margin = Math.max(0, ...paired.map(r => r.minDistMm)) + Math.max(0, ...bodies.map(b => b.radius))
  const grid = new Map<string, Set<number>>(), pairs = new Set<string>(), cellSize = 1000
  for (let i = 0; i < bodies.length; i++) for (const s of bodies[i].segments) {
    const left = Math.floor((Math.min(s.a[0], s.b[0]) - margin) / cellSize), right = Math.floor((Math.max(s.a[0], s.b[0]) + margin) / cellSize)
    const top = Math.floor((Math.min(s.a[1], s.b[1]) - margin) / cellSize), bottom = Math.floor((Math.max(s.a[1], s.b[1]) + margin) / cellSize)
    for (let x = left; x <= right; x++) for (let y = top; y <= bottom; y++) {
      const key = `${x}:${y}`, bucket = grid.get(key) ?? new Set<number>()
      for (const j of bucket) if (i !== j) pairs.add(`${Math.min(i, j)}:${Math.max(i, j)}`)
      bucket.add(i); grid.set(key, bucket)
    }
  }
  cache.stats = { candidates: pairs.size, checked: 0, reused: 0, segments: bodies.reduce((s, b) => s + b.segments.length, 0) }
  const result: Clash[] = [], next = new Map<string, { signature: string; clashes: Clash[] }>()
  const context = hash([rules, model.floor.rooms, model.floor.level])
  for (const key of [...pairs].sort()) {
    const [i, j] = key.split(':').map(Number), a = bodies[i], b = bodies[j]
    const matched = paired.flatMap(rule => { const pair = match(rule, a, b); return pair ? [{ rule, pair }] : [] })
    if (!matched.length) continue
    const pairId = JSON.stringify([a.id, b.id]), signature = hash([a.signature, b.signature, context])
    let entry = cache.pairs.get(pairId)
    if (entry?.signature === signature) cache.stats.reused++
    else { entry = { signature, clashes: matched.flatMap(({ rule, pair }) => compare(model, rule, ...pair)) }; cache.stats.checked++ }
    next.set(pairId, entry); result.push(...entry.clashes)
  }
  cache.pairs = next
  const nextStructures = new Map<string, CachedClashes>()
  const cachedStructure = (key: string, signature: string) => {
    const old = cache.structures.get(key)
    if (old?.signature !== signature) return false
    result.push(...old.clashes); nextStructures.set(key, old); return true
  }
  const rememberStructure = (key: string, signature: string, start: number) => nextStructures.set(key, { signature, clashes: result.slice(start) })
  const wallSignature = hash(model.wallSections), exitContext = hash([model.floor.walls, model.floor.openings, model.floor.courtyard, model.floor.doubleHeightVoids])
  for (const rule of rules) {
    if (rule.check === 'wall') {
      // Actual wall boxes retain door openings and window sills/heads. Unknown
      // heights are a review state, never a fabricated physical intersection.
      for (const body of bodies.filter(b => model.utilities.some(u => u.id === b.id))) {
        const key = `${rule.id}:${body.id}`, signature = hash([body.signature, wallSignature, rule, model.floor.rooms.filter(r => body.roomIds.includes(r.id))])
        if (cachedStructure(key, signature)) continue
        const start = result.length
        for (const wall of model.wallSections) {
          const dx = wall.b.x - wall.a.x, dy = wall.b.y - wall.a.y, length = Math.hypot(dx, dy)
          if (!length) continue
          const local = (p: XYZ): XYZ => [((p[0] - wall.a.x) * dx + (p[1] - wall.a.y) * dy) / length, (-(p[0] - wall.a.x) * dy + (p[1] - wall.a.y) * dx) / length, p[2]]
          const hit = body.segments.map(s => ({ known: s.known, p: segmentBox(local(s.a), local(s.b), [1, -wall.thickness / 2 + 1, s.known ? wall.base : -1], [length - 1, wall.thickness / 2 - 1, s.known ? wall.base + wall.height : 1]) })).find(h => h.p)
          if (!hit?.p) continue
          const p = hit.p, position = { x: wall.a.x + (p[0] * dx - p[1] * dy) / length, y: wall.a.y + (p[0] * dy + p[1] * dx) / length }
          result.push(makeClash(model, rule, body.id, wall.id, body.layer, body.layer, body.roomIds, { position, elevationMm: hit.known ? p[2] : null, certainty: hit.known ? 'concept-model' : 'needs-verification' }, [body.signature, wall])); break
        }
        rememberStructure(key, signature, start)
      }
    }
    if (rule.check === 'exit') for (const exit of model.exitRoutes) {
      const key = `${rule.id}:${exit.id}`, signature = hash([exit, exitContext, rule, model.floor.rooms.find(r => r.id === exit.fromRoomId)])
      if (cachedStructure(key, signature)) continue
      const start = result.length
      const cuts = [...(model.floor.courtyard ? [model.floor.courtyard] : []), ...(model.floor.doubleHeightVoids ?? []).map(v => v.rect)]
      if (exit.status === 'concept' && exit.path.length >= 2 && electricalPathAllowed(exit.path, model.floor, cuts)) { rememberStructure(key, signature, start); continue }
      const room = model.floor.rooms.find(r => r.id === exit.fromRoomId)
      if (!room) continue
      const blocked = model.floor.walls.flatMap((w, index) => exit.path.slice(1).flatMap((p, i) => {
        const hit = segmentDistance([p.x, p.y, 0], [exit.path[i].x, exit.path[i].y, 0], [w.a.x, w.a.y, 0], [w.b.x, w.b.y, 0])
        if (hit.distance > .01 || model.floor.openings.some(o => o.kind !== 'window' && Math.abs(o.orient === 'h' ? hit.position.y - o.at.y : hit.position.x - o.at.x) < 25 && Math.abs(o.orient === 'h' ? hit.position.x - o.at.x : hit.position.y - o.at.y) < o.width / 2 - 20)) return []
        return [{ id: w.id ?? `wall:${index}`, position: hit.position }]
      }))[0]
      result.push(makeClash(model, rule, exit.id, blocked?.id ?? `exit-review:${room.id}`, 'fire_alarm', 'fire_alarm', [room.id], { rule: exit.status === 'no-exit' ? 'No represented exit route' : 'Exit route blocked by a wall without a door', position: blocked?.position ?? { x: room.rect.x + room.rect.w / 2, y: room.rect.y + room.rect.h / 2 } }, [exit, model.floor.walls, model.floor.openings, cuts]))
      rememberStructure(key, signature, start)
    }
    if (rule.check === 'coverage') for (const coverage of model.coverage.filter(c => c.status === 'partial' || c.status === 'not-covered')) {
      const room = model.floor.rooms.find(r => r.id === coverage.roomId)
      if (!room) continue
      const detectors = model.symbols.filter(s => s.layer === 'fire_alarm' && coverage.detectorIds.includes(s.id))
      const key = `${rule.id}:${room.id}`, signature = hash([coverage, detectors, room, rule, model.floor.courtyard, model.floor.doubleHeightVoids])
      if (cachedStructure(key, signature)) continue
      const start = result.length
      result.push(makeClash(model, rule, `coverage:${room.id}`, room.id, 'fire_alarm', 'fire_alarm', [room.id], { rule: coverage.status === 'partial' ? 'Partial concept coverage' : 'Not covered', position: { x: room.rect.x + room.rect.w * .5, y: room.rect.y + room.rect.h * .7 } }, [coverage, detectors, model.floor.courtyard, model.floor.doubleHeightVoids]))
      rememberStructure(key, signature, start)
    }
  }
  cache.structures = nextStructures
  // Specific hot/cold and sprinkler checks supersede generic pair duplicates.
  const specific = new Set(result.filter(c => ['hot-cold', 'sprinkler-power'].includes(c.ruleId)).map(c => [c.itemA, c.itemB].sort().join('|')))
  return result.filter(c => !(['water-crossing', 'fire-power'].includes(c.ruleId) && specific.has([c.itemA, c.itemB].sort().join('|')))).sort((a, b) => a.id.localeCompare(b.id))
}

export type ClashReview = { fingerprint: string; status: ClashStatus; note: string; at: string }
export type ClashReviews = Record<string, ClashReview>
export function parseClashReviews(value: unknown): ClashReviews {
  if (!value || typeof value !== 'object' || !('version' in value) || value.version !== 1 || !('records' in value) || !value.records || typeof value.records !== 'object') return {}
  return Object.fromEntries(Object.entries(value.records).filter(([id, r]) => id.startsWith('C-') && r && typeof r === 'object' && typeof r.fingerprint === 'string' && ['open', 'acknowledged', 'resolved', 'ignored'].includes(r.status) && typeof r.note === 'string' && typeof r.at === 'string' && (r.status !== 'ignored' || r.note.trim())))
}
export function reviewClash(clash: Clash, status: ClashStatus, note: string): ClashReview {
  if (status === 'ignored' && !note.trim()) throw new Error('Please add a reason before ignoring this problem.')
  return { fingerprint: clash.fingerprint, status, note: note.trim().slice(0, 2000), at: new Date().toISOString() }
}
export function applyClashReview(clash: Clash, records: ClashReviews): Clash {
  const review = records[clash.id]
  return review?.fingerprint === clash.fingerprint ? { ...clash, status: review.status, note: review.note } : { ...clash, needsReview: !!review }
}
