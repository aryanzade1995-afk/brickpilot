import { z } from 'zod'
import type { UtilityFloor, UtilitySymbol, UtilityRun } from './plan.ts'
import { selectionForRun } from './plan.ts'

const point = z.object({ x: z.number().finite().min(-1e6).max(1e6), y: z.number().finite().min(-1e6).max(1e6) })
export const POINT_TYPES = {
  electrical: ['switch', 'socket', 'light', 'exhaust_fan'],
  water_supply: ['water_outlet', 'isolation_valve'],
  fire_alarm: ['smoke_detector', 'heat_detector', 'manual_call_point', 'sounder', 'extinguisher'],
} as const
const id = z.string().min(1).max(300)
export const planningSchema = z.object({
  version: z.literal(1), sourcePlanId: z.string().max(300), geometryKey: z.string().max(200).default(''),
  points: z.array(z.object({ id, layer: z.enum(['electrical', 'water_supply', 'fire_alarm']), type: z.string().max(40), roomId: id, groupId: id, label: z.string().min(1).max(180), position: point, heightMm: z.number().finite().min(0).max(10000).nullable() }).refine(p => (POINT_TYPES[p.layer] as readonly string[]).includes(p.type), 'Unsupported point type')).max(500),
  removedRunIds: z.array(id).max(2000),
  runs: z.array(z.object({ id, layer: z.enum(['electrical', 'water_supply', 'fire_alarm']), groupId: id, from: id, to: id, path: z.array(point).min(2).max(200).refine(ps => ps.every((p, i) => !i || p.x === ps[i - 1].x || p.y === ps[i - 1].y), 'Use horizontal and vertical segments only.') })).max(1000),
}).refine(v => new Set(v.points.map(p => p.id)).size === v.points.length && new Set(v.runs.map(r => r.id)).size === v.runs.length, 'Duplicate manual item IDs.')
export type UtilityPlanning = z.infer<typeof planningSchema>
export type PlannedPoint = UtilityPlanning['points'][number]
export const emptyPlanning = (): UtilityPlanning => ({ version: 1, sourcePlanId: '', geometryKey: '', points: [], removedRunIds: [], runs: [] })
export function planningGeometryKey(source: UtilityFloor) {
  const text = JSON.stringify([source.sourcePlanId, source.floor.level, source.floor.rooms.map(r => [r.id, r.rect]), source.floor.walls, source.floor.openings]); let n = 2166136261
  for (let i = 0; i < text.length; i++) n = Math.imul(n ^ text.charCodeAt(i), 16777619)
  return (n >>> 0).toString(16)
}
const same = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y) < .01
export function applyUtilityPlanning(source: UtilityFloor, input: UtilityPlanning): { model: UtilityFloor; reviews: { id: string; reason: string }[] } {
  const model = structuredClone(source), reviews: { id: string; reason: string }[] = []
  if (input.sourcePlanId && input.sourcePlanId !== source.sourcePlanId || input.geometryKey && input.geometryKey !== planningGeometryKey(source)) return { model, reviews: [{ id: 'plan', reason: 'The plan changed. Saved point edits need review before reuse.' }] }
  for (const p of input.points) {
    const room = model.floor.rooms.find(r => r.id === p.roomId), old = model.symbols.find(s => s.id === p.id)
    const r = room?.rect
    const group = p.layer === 'electrical' ? model.circuits.find(c => c.id === p.groupId) : p.layer === 'water_supply' ? model.waterNetworks.find(n => n.id === p.groupId) : model.zones.find(z => z.id === p.groupId)
    if (!r || !group || p.position.x < r.x || p.position.y < r.y || p.position.x > r.x + r.w || p.position.y > r.y + r.h || old && (old.layer !== p.layer || !(POINT_TYPES[p.layer] as readonly string[]).includes(old.type))) { reviews.push({ id: p.id, reason: 'Point room, position or service group no longer matches the source plan.' }); continue }
    // Moving a point never redraws a wire or pipe. Obsolete runs are removed
    // until an explicit manual connection is supplied and validated below.
    const previousGroup = old?.layer === 'electrical' ? old.circuitIds[0] : old?.layer === 'water_supply' ? old.networkId : old?.layer === 'fire_alarm' ? old.zoneId : ''
    const moved = !old || !same(old.position, p.position) || old.type !== p.type || previousGroup !== p.groupId
    if (moved) model.utilities = model.utilities.filter(u => u.layer === 'drainage' || u.fromSymbolId !== p.id && u.toSymbolId !== p.id)
    let symbol: UtilitySymbol
    const common = { id: p.id, position: p.position, roomId: p.roomId, roomIds: [p.roomId], label: p.label, basis: 'proposed' as const }
    if (p.layer === 'electrical') {
      const circuit = model.circuits.find(c => c.id === p.groupId)!
      for (const c of model.circuits) { c.loads = c.loads.filter(id => id !== p.id); c.controls = c.controls.filter(id => id !== p.id) }
      if (p.type === 'switch') circuit.controls.push(p.id); else circuit.loads.push(p.id)
      symbol = { ...common, layer: 'electrical', type: p.type as 'socket', circuitIds: [p.groupId], ...(!moved && old?.layer === 'electrical' && old.mount ? { mount: { ...old.mount, elevationMm: p.heightMm ?? old.mount.elevationMm } } : {}) }
    } else if (p.layer === 'water_supply') {
      const network = model.waterNetworks.find(n => n.id === p.groupId)!
      symbol = { ...common, layer: 'water_supply', type: p.type as 'water_outlet', networkId: p.groupId, service: network.service, fixtureId: old?.layer === 'water_supply' ? old.fixtureId : null, ...(!moved && old?.layer === 'water_supply' && old.mount ? { mount: { ...old.mount, elevationMm: p.heightMm ?? old.mount.elevationMm } } : {}) }
    } else {
      const zone = model.zones.find(z => z.id === p.groupId)!
      for (const z of model.zones) z.devices = z.devices.filter(id => id !== p.id)
      if (p.type !== 'extinguisher') zone.devices.push(p.id)
      symbol = { ...common, layer: 'fire_alarm', type: p.type as 'heat_detector', zoneId: p.groupId, coverageRadiusMm: null, connection: p.type === 'extinguisher' ? 'standalone' : 'alarm-loop' }
    }
    // Heights are stored as user inputs. No guessed wall normal/mount or
    // service elevation is created from this annotation.
    model.symbols = [...model.symbols.filter(s => s.id !== p.id), symbol]
  }
  const removed = new Set(input.removedRunIds)
  model.utilities = model.utilities.filter(u => !removed.has(u.id))
  for (const r of input.runs) {
    const a = model.symbols.find(s => s.id === r.from), b = model.symbols.find(s => s.id === r.to)
    const member = (s: UtilitySymbol | undefined) => s?.layer === r.layer && (s.layer === 'electrical' ? s.circuitIds.includes(r.groupId) || model.circuits.find(c => c.id === r.groupId)?.panelId === s.id : s.layer === 'water_supply' ? s.networkId === r.groupId : s.layer === 'fire_alarm' ? s.zoneId === r.groupId && s.connection === 'alarm-loop' : false)
    if (!a || !b || !member(a) || !member(b) || a.id === b.id || !same(a.position, r.path[0]) || !same(b.position, r.path.at(-1)!)) { reviews.push({ id: r.id, reason: 'Manual connection endpoints or group do not match. Connection was not drawn.' }); continue }
    const common = { id: r.id, fromSymbolId: a.id, toSymbolId: b.id, path: r.path, roomId: 'roomId' in b ? b.roomId : b.roomIds[0] }
    let run: UtilityRun
    if (r.layer === 'electrical') run = { ...common, layer: 'electrical', circuitId: r.groupId, wireSize: 'Unspecified', conductors: 2 }
    else if (r.layer === 'fire_alarm') run = { ...common, layer: 'fire_alarm', zoneId: r.groupId, cableType: 'FRLS 2C' }
    else { const n = model.waterNetworks.find(n => n.id === r.groupId)!; run = { ...common, layer: 'water_supply', networkId: n.id, service: n.service, fixtureId: b.layer === 'water_supply' ? b.fixtureId : null, diameter: n.branchDiameterMm, material: n.material } }
    model.utilities = [...model.utilities.filter(u => u.id !== r.id), run]
  }
  for (const p of input.points) {
    if (!model.utilities.some(u => u.layer !== 'drainage' && (u.fromSymbolId === p.id || u.toSymbolId === p.id)) && p.type !== 'extinguisher') reviews.push({ id: p.id, reason: 'Point has no connection. Add a manual connection and obtain professional review.' })
  }
  const editedFireRooms = new Set(input.points.filter(p => p.layer === 'fire_alarm').map(p => p.roomId))
  for (const p of input.points) { const old = source.symbols.find(s => s.id === p.id); if (old?.layer === 'fire_alarm') editedFireRooms.add(old.roomId) }
  model.coverage = model.coverage.map(c => editedFireRooms.has(c.roomId) && c.status !== 'exempt' ? { ...c, status: 'partial', detectorIds: c.detectorIds.filter(id => !input.points.some(p => p.id === id)) } : c)
  for (const zone of model.zones) {
    const runs = model.utilities.filter(u => u.layer === 'fire_alarm' && u.zoneId === zone.id)
    const ids = [zone.panelId, ...zone.devices]
    const reachable = new Set([zone.panelId]); let changed = true
    while (changed) { changed = false; for (const u of runs) if (u.layer === 'fire_alarm' && reachable.has(u.fromSymbolId) && !reachable.has(u.toSymbolId)) { reachable.add(u.toSymbolId); changed = true } }
    const valid = ids.every(id => reachable.has(id) && runs.some(u => u.layer === 'fire_alarm' && u.fromSymbolId === id) && runs.some(u => u.layer === 'fire_alarm' && u.toSymbolId === id))
    zone.loopStatus = valid ? 'closed' : 'incomplete'
  }
  if (input.points.length || input.runs.length) model.notes.push('Manual utility point/route proposals: no automatic routing. Mounting heights are user annotations; structural penetrations, service levels, ratings, water sizing and fire coverage require professional review. New points do not update the project construction BOQ.', ...reviews.map(r => `${r.id}: ${r.reason}`))
  return { model, reviews }
}
export function traceSelection(model: UtilityFloor, selected: string | null): string | null {
  if (!selected?.startsWith('point:')) return selected
  const s = model.symbols.find(s => s.id === selected.slice(6))
  return s?.layer === 'electrical' && s.circuitIds[0] ? `circuit:${s.circuitIds[0]}` : s?.layer === 'fire_alarm' ? `zone:${s.zoneId}` : s?.layer === 'water_supply' ? `water:${s.networkId}` : selected
}
export function connectionDescription(model: UtilityFloor, selection: string | null) {
  const id = traceSelection(model, selection)
  const runs = model.utilities.filter(u => selectionForRun(u) === id)
  return { runs, lengthM: runs.reduce((n, r) => n + r.path.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - r.path[i].x, p.y - r.path[i].y), 0), 0) / 1000 }
}
