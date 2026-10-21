import type { BuildingFloor, BuildingRoom } from '../engine/buildingModel.ts'
import { planToThreeGlb, threeGlbToPlan } from '../solar/coordinates.ts'

// Reuse the accepted Blender/glTF frame. Study-model centring, plinth offsets
// and exploded-floor spacing must never enter a connected interior.
export { planToBlender, blenderToPlan, planToThreeGlb, threeGlbToPlan } from '../solar/coordinates.ts'
export type WalkthroughPoint = [number, number, number]

/** Existing room furnishings: local metres, x east, z south, y above source FFL. */
export function roomLocalToWalkthrough(point: WalkthroughPoint, room: BuildingRoom, floor: BuildingFloor): WalkthroughPoint {
  const world = planToThreeGlb({ x: room.rect.x + room.rect.w / 2 + point[0] * 1000,
    y: room.rect.y + room.rect.h / 2 + point[2] * 1000, z: floor.elevationMm + point[1] * 1000 })
  return [world.x, world.y, world.z]
}

export function walkthroughToRoomLocal(point: WalkthroughPoint, room: BuildingRoom, floor: BuildingFloor): WalkthroughPoint {
  const plan = threeGlbToPlan({ x: point[0], y: point[1], z: point[2] })
  return [(plan.x - room.rect.x - room.rect.w / 2) / 1000, (plan.z - floor.elevationMm) / 1000,
    (plan.y - room.rect.y - room.rect.h / 2) / 1000]
}
