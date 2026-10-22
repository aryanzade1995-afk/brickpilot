import type { BuildingModel } from '../engine/buildingModel.ts'
import type { Rect, Point } from '../geometry.ts'

export type SceneIssue = { code: string; severity: 'error' | 'warning'; sourceId: string; message: string }
/** Source-coordinate solid bounds, in mm. z is elevation, never a tray offset. */
export type SourceBox = { x: number; y: number; z: number; w: number; d: number; h: number }
export type SceneRole = 'wall' | 'slab' | 'stair' | 'column' | 'beam' | 'parapet' | 'glass'
export type SceneSolid = { id: string; floorId: string; sourceIds: string[]; role: Exclude<SceneRole, 'glass'>; boundsMm: SourceBox }
export type SceneSurface = {
  id: string; solidId: string; sourceIds: string[]; floorId: string; role: SceneRole
  /** Four corners and outward normal in the final glTF-compatible Y-up metre frame. */
  vertices: [number, number, number][]; normal: [number, number, number]
}
export type SceneOpening = {
  id: string; sourceId: string; floorId: string; wallId: string; kind: 'door' | 'entry' | 'window'
  orient: 'h' | 'v'; apertureMm: SourceBox; sillMm: number; headMm: number; headBasis: 'explicit' | 'source-opening-policy'
  operation: 'window' | 'open' | 'sliding' | 'door-leaf-unmodelled'
  hinge?: 'a' | 'b'; swing?: 1 | -1
  emergencyExit?: boolean
  rooms: [string | null, string | null] | null
}
export type SceneFloor = {
  id: string; sourceId: string; level: number; elevationM: number; clearCeilingM: number | null
  supportedRegionsMm: Rect[]; cutouts: { id: string; kind: string; rectMm: Rect }[]
}
export type StairGeometry = {
  id: string; floorId: string; destinationFloorId: string | null; destinationElevationMm: number
  openingMm: Rect; startLandingMm: Rect; destinationLandingMm: Rect
  riseMm: number; goingMm: number; stepCount: number
  steps: { id: string; rectMm: Rect; topMm: number; bottomMm: number }[]
  midLanding: { rectMm: Rect; topMm: number; bottomMm: number }
  /** Samples preserve real obstacles; null means no overhead source solid. Not a compliance certificate. */
  headroom: { atMm: Point; elevationMm: number; clearanceMm: number | null; obstructionId: string | null }[]
}
export type WalkthroughScene = {
  version: 'walkthrough-shell-v1'; planId: string; status: 'ready' | 'needs-review' | 'unsupported'
  coordinates: 'metres-x-plan-east-y-up-z-plan-north'; source: BuildingModel
  floors: SceneFloor[]
  rooms: { id: string; sourceId: string; semanticId: string; floorId: string; name: string; rectMm: Rect;
    elevationM: number; outdoor: boolean; supportedRegionsMm: Rect[] }[]
  solids: SceneSolid[]; surfaces: SceneSurface[]; openings: SceneOpening[]; stairs: StairGeometry[]
  roofs: { id: string; floorId: string; elevationM: number; regionsMm: Rect[]; access: 'source-stair' | 'source-door' | 'unconfirmed' }[]
  connections: { id: string; kind: 'door' | 'stair'; from: string; to: string | null; sourceId: string }[]
  issues: SceneIssue[]
}
/** IDs depend on source identity and geometry, never generation order. */
export const sceneId = (...parts: (string | number)[]) => JSON.stringify(parts)
