import { planningSchema, emptyPlanning } from './planning.ts'
import { z } from 'zod'
import { electricalInputsSchema, defaultElectricalInputs } from './electricalInputs.ts'
import type { Point } from '../geometry.ts'
import type { UtilityFloor, UtilityLayer } from './plan.ts'
import { hash, parseClashReviews, type ClashReviews } from './clashes.ts'
import { drainageInputsSchema, drainageFixtureKinds, defaultDrainageInputs } from './drainageInputs.ts'

export const SHEET_SIZES = { A4: [210, 297], A3: [297, 420], A2: [420, 594], A1: [594, 841] } as const
export const DRAWING_LAYERS = ['drainage', 'electrical', 'fire_alarm', 'water_supply'] as const
export type DrawingLayer = typeof DRAWING_LAYERS[number] | 'coordination'
export const DRAWING_NAMES: Record<DrawingLayer, string> = { drainage: 'Drainage Plan', electrical: 'Electrical Plan', fire_alarm: 'Fire Alarm & Safety Plan', water_supply: 'Water Supply Plan', coordination: 'Utility Coordination Plan' }
export const DRAWING_CODES: Record<DrawingLayer, string> = { drainage: 'DR', electrical: 'EL', fire_alarm: 'FA', water_supply: 'WS', coordination: 'CO' }
const finite = z.number().finite(), coord = finite.min(-1e6).max(1e6), positive = finite.positive().max(1e6), short = z.string().max(180), id = z.string().min(1).max(300)
const point = z.object({ x: coord, y: coord }), rect = z.object({ x: coord, y: coord, w: positive, h: positive })
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s => !Number.isNaN(Date.parse(s)))
const mount = z.object({ kind: z.enum(['wall', 'ceiling']), elevationMm: coord, serviceElevationMm: coord, normal: point, wallIndex: z.number().int().nonnegative().nullable() })
const path = z.array(point).min(2).max(1500).refine(p => p.every((v, i) => !i || v.x === p[i - 1].x || v.y === p[i - 1].y), 'Paths must remain orthogonal. No routing is performed on load.')
const common = { id, roomId: id, path }
const runs = z.discriminatedUnion('layer', [
  z.object({ ...common, layer: z.literal('drainage'), fixtureId: id, stackId: id, diameter: positive, material: short, flowDirection: z.enum(['forward', 'reverse']) }),
  z.object({ ...common, layer: z.literal('electrical'), circuitId: id, fromSymbolId: id, toSymbolId: id, wireSize: short, conductors: z.number().int().min(1).max(20), serviceBandIndex: z.number().int().min(0).max(200).optional() }),
  z.object({ ...common, layer: z.literal('fire_alarm'), zoneId: id, fromSymbolId: id, toSymbolId: id, cableType: z.literal('FRLS 2C') }),
  z.object({ ...common, layer: z.literal('water_supply'), networkId: id, fromSymbolId: id, toSymbolId: id, service: z.enum(['hot', 'cold']), fixtureId: id.nullable(), diameter: positive, material: short }),
])
const commonSymbol = { id, position: point, roomIds: z.array(id).max(500), basis: z.literal('proposed') }
const symbols = z.discriminatedUnion('layer', [
  z.object({ ...commonSymbol, layer: z.literal('drainage'), type: z.literal('vertical_stack') }),
  z.object({ ...commonSymbol, layer: z.literal('electrical'), type: z.enum(['db_panel', 'switch', 'socket', 'light', 'exhaust_fan']), roomId: id, circuitIds: z.array(id).max(50), label: short, mount: mount.optional() }),
  z.object({ ...commonSymbol, layer: z.literal('fire_alarm'), type: z.enum(['fire_panel', 'smoke_detector', 'heat_detector', 'manual_call_point', 'sounder', 'sprinkler', 'extinguisher', 'exit_sign']), roomId: id, zoneId: id, label: short, coverageRadiusMm: positive.nullable(), connection: z.enum(['alarm-loop', 'standalone']) }),
  z.object({ ...commonSymbol, layer: z.literal('water_supply'), type: z.enum(['supply_inlet', 'hot_supply_inlet', 'isolation_valve', 'water_outlet']), roomId: id, networkId: id, service: z.enum(['hot', 'cold']), label: short, fixtureId: id.nullable(), mount: mount.optional() }),
])
const floorSchema = z.object({
  sourceFloorLevels: z.array(z.number().int().min(0).max(100)).max(101).optional(),
  sourcePlanId: id,
  floor: z.object({ level: z.number().int().min(0).max(100), name: short, outline: rect, footprint: z.array(rect).min(1).max(200),
    rooms: z.array(z.object({ id, name: short, semanticId: z.string().max(300).optional(), rect, area: finite.nonnegative(), outdoor: z.boolean().optional() }).passthrough()).max(500),
    walls: z.array(z.object({ id: id.optional(), a: point, b: point, thickness: positive, rooms: z.array(id.nullable()).optional(), heightMm: positive.optional() }).passthrough()).max(2000),
    openings: z.array(z.object({ id: id.optional(), kind: z.enum(['door', 'entry', 'window']), orient: z.enum(['h', 'v']), at: point, width: positive, rooms: z.array(id.nullable()).optional(), head: positive.optional(), sill: finite.nonnegative().optional() }).passthrough()).max(2000),
    courtyard: rect.nullable().optional(), doubleHeightVoids: z.array(z.object({ rect }).passthrough()).max(100).optional(),
    columns: z.array(z.object({ id, at: point, size: positive }).passthrough()).max(5000).optional(),
    shafts: z.array(z.object({ id, rect }).passthrough()).max(500).optional(),
  }).passthrough(),
  slabs: z.array(rect).max(500), wallSections: z.array(z.object({ id, a: point, b: point, thickness: positive, height: positive, base: finite.nonnegative() })).max(5000),
  fixtures: z.array(z.object({ id, type: z.enum(['sink', 'toilet', 'shower', 'floor_drain', 'bathtub', 'washing_machine']), drainageKind: z.enum(drainageFixtureKinds).optional(), position: point, roomId: id, basis: z.enum(['furnishing', 'proposed']), width: positive, depth: positive })).max(1000),
  utilities: z.array(runs).max(2000), symbols: z.array(symbols).max(2500),
  circuits: z.array(z.object({ id, name: short, tag: short, color: z.string().regex(/^#[0-9a-f]{6}$/i), panelId: id, loads: z.array(id).max(1000), controls: z.array(id).max(1000), wireSize: short, breaker: short, status: z.enum(['concept', 'needs-review']), unroutedLoads: z.array(id).max(1000) })).max(200),
  zones: z.array(z.object({ id, name: short, tag: short, color: z.string().regex(/^#[0-9a-f]{6}$/i), panelId: id, devices: z.array(id).max(1000), cableType: z.literal('FRLS 2C'), loopStatus: z.enum(['closed', 'incomplete']), missingLinks: z.array(z.object({ from: id, to: id })).max(2000) })).max(200),
  waterNetworks: z.array(z.object({ id, name: short, tag: z.enum(['CW', 'HW']), color: z.string().regex(/^#[0-9a-f]{6}$/i), service: z.enum(['hot', 'cold']), sourceIds: z.array(id).max(1000), sourceBasis: z.literal('unverified'), branchDiameterMm: positive, riserDiameterMm: positive, material: short, heatSource: short.nullable(), unroutedFixtures: z.array(id).max(1000) })).max(200),
  exitRoutes: z.array(z.object({ id, path: z.array(point).max(1500), fromRoomId: id, exitId: id.nullable(), status: z.enum(['concept', 'blocked', 'no-exit']), reason: z.string().max(1000).nullable() })).max(500),
  coverage: z.array(z.object({ roomId: id, status: z.enum(['covered', 'partial', 'not-covered', 'exempt']), detectorIds: z.array(id).max(1000) })).max(500), notes: z.array(z.string().max(2000)).max(2000),
}).superRefine((m, ctx) => {
  if (m.utilities.reduce((n, r) => n + r.path.length, 0) > 20000) ctx.addIssue({ code: 'custom', message: 'This file has too many route segments.' })
  for (const list of [m.utilities, m.symbols, m.floor.rooms, m.circuits, m.zones, m.waterNetworks]) if (new Set(list.map(x => x.id)).size !== list.length) ctx.addIssue({ code: 'custom', message: 'Duplicate object IDs.' })
  const rooms = new Set(m.floor.rooms.map(r => r.id)), groups = { electrical: new Set(m.circuits.map(c => c.id)), fire_alarm: new Set(m.zones.map(z => z.id)), water_supply: new Set(m.waterNetworks.map(n => n.id)) }
  for (const run of m.utilities) if (!rooms.has(run.roomId) || run.layer === 'electrical' && !groups.electrical.has(run.circuitId) || run.layer === 'fire_alarm' && !groups.fire_alarm.has(run.zoneId) || run.layer === 'water_supply' && !groups.water_supply.has(run.networkId)) ctx.addIssue({ code: 'custom', message: 'A route refers to a missing room or service group.' })
})
export const TITLE_FIELDS = ['projectName', 'client', 'projectCode', 'drawnBy', 'checkedBy'] as const
export const settingsSchema = z.object({ projectName: short, client: short, projectCode: z.string().regex(/^[A-Za-z0-9_-]{1,20}$/), drawnBy: short, checkedBy: short, date: day, size: z.enum(['A4', 'A3', 'A2', 'A1']), orientation: z.enum(['landscape', 'portrait']), scale: z.union([z.literal(50), z.literal(100), z.literal(200)]), dpi: z.union([z.literal(150), z.literal(300)]) })
const pref = z.object({ visible: z.boolean(), locked: z.boolean(), opacity: finite.min(0).max(1) })
export const documentSchema = z.object({
  planning: planningSchema.default(emptyPlanning),
  electrical: electricalInputsSchema.default(defaultElectricalInputs),
  drainage: drainageInputsSchema.default(defaultDrainageInputs),
  version: z.literal(1), settings: settingsSchema,
  activeLayer: z.enum([...DRAWING_LAYERS, 'coordination']), layers: z.object({ drainage: pref, electrical: pref, fire_alarm: pref, water_supply: pref }),
  annotationsVisible: z.boolean(), annotationsLocked: z.boolean(), grid: z.boolean(), autoDimensions: z.boolean(), pipeTags: z.boolean(), theme: z.enum(['light', 'dark']),
  revisions: z.array(z.object({ id, letter: z.string().regex(/^[A-Z]{1,4}$/), date: day, description: z.string().min(1).max(400), by: short })).max(500),
  annotations: z.array(z.object({ id, type: z.enum(['dimension', 'note', 'leader', 'cloud']), a: point, b: point, text: z.string().max(2000), revisionId: id.nullable(), layer: z.enum([...DRAWING_LAYERS, 'annotations']), units: z.enum(['mm', 'm']) })).max(1000),
})
export type DrawingDocument = z.infer<typeof documentSchema>
export type DrawingAnnotation = DrawingDocument['annotations'][number]
export type DrawingSettings = DrawingDocument['settings']
export type LayerPreferences = DrawingDocument['layers']
const viewSchema = z.object({ room: short, circuit: short, zone: short, water: short, showClashes: z.boolean(), showCoverage: z.boolean(), showEvacuation: z.boolean(), mode: z.enum(['3d', '2d']).default('2d'), sheetOpen: z.boolean().default(true), showClashes3D: z.boolean().default(false), showElectrical3D: z.boolean().default(true), showWater3D: z.boolean().default(true), showHotWater: z.boolean().default(true), seeThroughWalls: z.boolean().default(true), seeThroughFloor: z.boolean().default(true), showRoomNames3D: z.boolean().default(true), selected: short.nullable().default(null), clashFilter: z.object({ severity: z.string(), pair: z.string(), room: z.string(), status: z.string(), type: z.string(), search: z.string().max(2000), sort: z.enum(['id', 'severity', 'layers', 'rooms', 'type', 'rule', 'distance', 'status']), direction: z.enum(['asc', 'desc']) }).optional() })
export type UtilityDrawingProject = { format: 'formstead-utility-project'; version: 1; savedAt: string; sourceSignature: string; model: UtilityFloor; document: DrawingDocument; reviews: ClashReviews; view: z.infer<typeof viewSchema> }
export const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
export const uid = () => globalThis.crypto?.randomUUID?.() ?? `a-${Date.now()}-${Math.random().toString(36).slice(2)}`
const ordered = (v: unknown): unknown => Array.isArray(v) ? v.map(ordered) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([, value]) => value !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, value]) => [k, ordered(value)])) : v
const legacySignature = (m: UtilityFloor) => hash(ordered([m.sourcePlanId, m.floor, m.utilities, m.symbols]))
export const sourceSignature = (m: UtilityFloor) => `m2-${hash(ordered(m))}`
export function defaultDrawing(projectName: string): DrawingDocument {
  return { planning: emptyPlanning(), electrical: defaultElectricalInputs(), drainage: defaultDrainageInputs(), version: 1, settings: { projectName, client: '', projectCode: 'PRJ', drawnBy: '', checkedBy: '', date: today(), size: 'A2', orientation: 'landscape', scale: 100, dpi: 150 }, activeLayer: 'coordination', layers: Object.fromEntries(DRAWING_LAYERS.map(k => [k, { visible: false, locked: false, opacity: 1 }])) as LayerPreferences, annotationsVisible: true, annotationsLocked: false, grid: false, autoDimensions: false, pipeTags: false, revisions: [], annotations: [], theme: 'light' }
}
export function nextRevision(revisions: DrawingDocument['revisions']) {
  let n = revisions.reduce((max, r) => Math.max(max, [...r.letter].reduce((s, c) => s * 26 + c.charCodeAt(0) - 64, 0)), 0) + 1
  let letter = ''; while (n) { n--; letter = String.fromCharCode(65 + n % 26) + letter; n = Math.floor(n / 26) } return letter
}
export const paperSize = (s: DrawingSettings) => { const [w, h] = SHEET_SIZES[s.size]; return s.orientation === 'landscape' ? { w: h, h: w } : { w, h } }
export const drawingNumber = (s: DrawingSettings, l: DrawingLayer, level: number) => `${s.projectCode}-${DRAWING_CODES[l]}-${String(level + 1).padStart(3, '0')}`
export const lengthMm = (points: Point[]) => points.slice(1).reduce((n, p, i) => n + Math.hypot(p.x - points[i].x, p.y - points[i].y), 0)
export const dimensionText = (a: Point, b: Point, units: 'mm' | 'm') => units === 'm' ? `${(Math.hypot(b.x - a.x, b.y - a.y) / 1000).toFixed(3)} m` : `${Math.round(Math.hypot(b.x - a.x, b.y - a.y))} mm`
export function parseUtilityDrawing(value: unknown): UtilityDrawingProject {
  const outer = z.object({ format: z.literal('formstead-utility-project'), version: z.literal(1), savedAt: z.string().max(50), sourceSignature: id, model: floorSchema, document: documentSchema, reviews: z.unknown(), view: viewSchema }).parse(value)
  const model = outer.model as unknown as UtilityFloor
  if (sourceSignature(model) !== outer.sourceSignature && legacySignature(model) !== outer.sourceSignature) throw new Error('This file has changed or is incomplete. Save a fresh Utility project JSON.')
  const revisionIds = new Set(outer.document.revisions.map(r => r.id))
  if (outer.document.annotations.some(a => a.revisionId && !revisionIds.has(a.revisionId))) throw new Error('An annotation refers to a missing revision.')
  return { ...outer, sourceSignature: sourceSignature(model), model, reviews: parseClashReviews({ version: 1, records: outer.reviews }) }
}
export const visibleLayers = (doc: DrawingDocument): Record<UtilityLayer, boolean> => ({ ...Object.fromEntries(DRAWING_LAYERS.map(k => [k, doc.layers[k].visible])), hvac: false }) as Record<UtilityLayer, boolean>
