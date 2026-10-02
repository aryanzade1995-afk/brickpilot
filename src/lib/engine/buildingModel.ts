import { terraceLayout, terraceFreeRatio, type TerraceLayout } from './terrace.ts'
import type { Direction } from '../model/brief.ts'
import type { Point, Rect } from '../geometry.ts'
import type { Design, Opening, PlacedRoom, SiteFeature, Wall } from './types.ts'
import type { Beam, Column, Shaft, SupportZone } from './planner/types.ts'
import { fnv } from './massing/rng.ts'

/** A serialized view of the verified 2D plan. All plan coordinates are millimetres. */
export type BuildingFloor = {
  id: string
  level: number
  name: string
  elevationMm: number
  heightMm: number
  outline: Rect
  footprint: Rect[]
  courtyard: Rect | null
}

export type BuildingRoom = PlacedRoom & { floorId: string }
export type BuildingWall = Wall & { floorId: string }
export type BuildingDoor = Opening & { floorId: string; kind: 'door' | 'entry' }
export type BuildingWindow = Opening & { floorId: string; kind: 'window' }
export type BuildingStair = {
  id: string
  floorId: string
  rect: Rect
  treads: Point[][]
  direction: 'up'
  startSide?: 'N' | 'S' | 'E' | 'W'
}
export type BuildingColumn = Column & { floorId: string }
export type BuildingBeam = Beam & { floorId: string }
export type BuildingShaft = Shaft & { floorId: string }
export type BuildingSupportZone = SupportZone & { floorId: string }
export type BuildingSlab = { id: string; floorId: string; rect: Rect; topMm: number; thicknessMm: number }

export type BuildingModel = {
  schemaVersion: 1
  /** Content identity of the plan geometry, independent of exterior-design seeds. */
  planId: string
  units: 'mm'
  /** Plan x grows east, plan y grows south; ground-floor finished level is z = 0. */
  coordinates: 'plan-x-east-y-south-z-up'
  plot: { widthMm: number; depthMm: number; buildable: Rect }
  siteFeatures?: SiteFeature[]
  siteRequirements?: { compoundWall: boolean }
  roofTerrace?: TerraceLayout & { freeRatio: number }
  floors: BuildingFloor[]
  rooms: BuildingRoom[]
  walls: BuildingWall[]
  doors: BuildingDoor[]
  windows: BuildingWindow[]
  stairs: BuildingStair[]
  columns: BuildingColumn[]
  beams: BuildingBeam[]
  slabs: BuildingSlab[]
  shafts: BuildingShaft[]
  supportZones: BuildingSupportZone[]
  orientation: {
    entryCompass: Direction
    roadPlanSide: 'S'
    plateAxis: 'x' | 'y' | null
    mirrored: boolean
    plateFamily: 'rectangular' | 'stepped' | 'l-shape' | 'courtyard' | 'twin-wing' | null
  }
  setbacks: Record<Direction, number>
}

const rect = (r: Rect): Rect => ({ x: r.x, y: r.y, w: r.w, h: r.h })
const point = (p: Point): Point => ({ x: p.x, y: p.y })
const fallbackId = (prefix: string, kind: string, index: number) => `${prefix}_${kind}_${String(index + 1).padStart(2, '0')}`

/** Pure adapter: never replans rooms or derives a second footprint. */
export function createBuildingModel(design: Design): BuildingModel {
  const { model, structure } = design
  const heightMm = Math.round(model.brief.levels.floorToFloor * 1000)
  const floors: BuildingFloor[] = []
  const rooms: BuildingRoom[] = []
  const walls: BuildingWall[] = []
  const doors: BuildingDoor[] = []
  const windows: BuildingWindow[] = []
  const stairs: BuildingStair[] = []
  const columns: BuildingColumn[] = []
  const beams: BuildingBeam[] = []
  const slabs: BuildingSlab[] = []
  const shafts: BuildingShaft[] = []
  const supportZones: BuildingSupportZone[] = []

  for (const floor of design.floors) {
    const floorId = floor.prefix ?? `L${floor.level}`
    const elevationMm = floor.level * heightMm
    floors.push({
      id: floorId, level: floor.level, name: floor.name, elevationMm, heightMm,
      outline: rect(floor.outline), footprint: floor.footprint.map(rect),
      courtyard: floor.courtyard ? rect(floor.courtyard) : null,
    })
    floor.rooms.forEach((room) => rooms.push({ ...room, floorId, rect: rect(room.rect) }))
    floor.walls.forEach((wall, index) => walls.push({
      ...wall, id: wall.id ?? fallbackId(floorId, 'WALL', index), floorId,
      a: point(wall.a), b: point(wall.b),
      ...(wall.rooms ? { rooms: [wall.rooms[0], wall.rooms[1]] as [string, string | null] } : {}),
    }))
    floor.openings.forEach((opening, index) => {
      const item = {
        ...opening, id: opening.id ?? fallbackId(floorId, 'OPENING', index), floorId,
        at: point(opening.at),
        ...(opening.rooms ? { rooms: [opening.rooms[0], opening.rooms[1]] as [string | null, string | null] } : {}),
      }
      if (opening.kind === 'window') windows.push({ ...item, kind: 'window' })
      else doors.push({ ...item, kind: opening.kind })
    })
    if (floor.stair) stairs.push({
      id: `${floorId}_STAIR_RUN`, floorId, rect: rect(floor.stair.rect),
      treads: floor.stair.treads.map((tread) => tread.map(point)),
      direction: floor.stair.direction,
      ...(floor.stair.startSide ? { startSide: floor.stair.startSide } : {}),
    })
    floor.columns?.forEach((column) => columns.push({ ...column, floorId, at: point(column.at) }))
    floor.beams?.forEach((beam) => beams.push({ ...beam, floorId, a: point(beam.a), b: point(beam.b) }))
    floor.shafts?.forEach((shaft) => shafts.push({ ...shaft, floorId, rect: rect(shaft.rect) }))
    floor.supportZones?.forEach((zone) => supportZones.push({ ...zone, floorId, rect: rect(zone.rect) }))
    floor.footprint.forEach((block, index) => slabs.push({
      id: fallbackId(floorId, 'SLAB', index), floorId, rect: rect(block),
      topMm: elevationMm, thicknessMm: 220,
    }))
  }

  const setbacks: Record<Direction, number> = { ...model.setbacksMm }
  const base = {
    schemaVersion: 1 as const,
    units: 'mm' as const,
    coordinates: 'plan-x-east-y-south-z-up' as const,
    plot: {
      widthMm: model.plot.width, depthMm: model.plot.depth,
      buildable: {
        x: setbacks.W, y: setbacks.N,
        w: model.envelope.width, h: model.envelope.depth,
      },
    },
    ...(model.brief.rooms.priorities.compoundWall ? { siteRequirements: { compoundWall: true } } : {}),
    ...(design.siteFeatures ? { siteFeatures: design.siteFeatures.map(f => ({ ...f, rect: rect(f.rect) })) } : {}),
    ...(terraceLayout(design) ? { roofTerrace: { ...terraceLayout(design)!, freeRatio: terraceFreeRatio(terraceLayout(design)!) } } : {}),
    floors, rooms, walls, doors, windows, stairs, columns, beams, slabs, shafts, supportZones,
    orientation: {
      entryCompass: model.entrySide, roadPlanSide: 'S' as const,
      plateAxis: structure?.orientation ?? null,
      mirrored: structure?.mirror ?? false,
      plateFamily: structure?.family ?? null,
    },
    setbacks,
  }
  const signature = JSON.stringify(base)
  const hash = (value: string) => fnv(value).toString(16).padStart(8, '0')
  return { ...base, planId: `plan-${hash(signature)}${hash(`building|${signature}`)}` }
}
