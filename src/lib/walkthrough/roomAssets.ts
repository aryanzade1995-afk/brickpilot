import type { Design } from '../engine/types.ts'
import { createBuildingModel } from '../engine/buildingModel.ts'
import { interiorFinishes } from '../interior/finishes.ts'
import { dressRoom } from '../three/dressRoom.ts'
import { INTERIOR_STYLES, LIGHTINGS, DENSITIES } from '../interior/preview.ts'
import { walkthroughAppearanceKey, type WalkthroughSource } from './source.ts'

/** Explicit, on-demand adapter. Never run across the house on page mount.
 * dressRoom already calls roomFurnishing: do not place a second furniture set.
 * Output remains room-local; apply coordinates.ts when a future scene consumes it.
 */
export function resolveWalkthroughRoomAssets(design: Design, source: WalkthroughSource, roomKey: string) {
  if (source.state === 'blocked' || createBuildingModel(design).planId !== source.building.planId ||
    walkthroughAppearanceKey(design, source.preferences) !== source.appearanceKey) return { state: 'stale-or-blocked' as const }
  const ref = source.rooms.find(r => r.key === roomKey)
  if (!ref || ref.outdoor) return { state: 'unsupported-space' as const }
  const floor = source.building.floors.find(f => f.id === ref.floorId)!
  const { style, lighting, furnitureDensity } = source.preferences
  if (!INTERIOR_STYLES.some(s => s.id === style) || !LIGHTINGS.some(l => l.id === lighting) || !DENSITIES.some(d => d.id === furnitureDensity))
    return { state: 'unsupported-preferences' as const }
  try {
    const finishes = interiorFinishes(design, floor.level, ref.sourceRoomId)
    if (!finishes) return { state: 'finishes-unavailable' as const }
    try {
      const furnishing = dressRoom(design, source.building, floor.level, ref.sourceRoomId, style, furnitureDensity, finishes)
      return { state: 'resolved' as const, finishes, furnishing, coordinateFrame: 'room-local-x-east-y-up-z-south-metres' as const }
    } catch {
      // Existing isolation refuses some double-height rooms. Keep their actual
      // finish selections; never replace their architecture with a guessed box.
      return { state: 'furnishing-unavailable' as const, finishes }
    }
  } catch { return { state: 'finishes-unavailable' as const } }
}
