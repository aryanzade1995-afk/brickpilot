import type { Design } from '../engine/types.ts'
import type { Character } from '../model/themes.ts'
import { buildRoom, type RoomBox, type Side } from '../three/buildRoom.ts'
import { furnishSingleRoom, type DollBox } from '../three/buildDollhouse.ts'

/* ------------------------------------------------------------------ *
 *  Fast 360° interior preview: the interior is styled, the architecture
 *  is locked. The room shell (walls, real doors and windows at their real
 *  sill / head heights, ceiling height) comes from buildRoom, the
 *  furniture from the same rule-based placer as the furnished 3D view.
 *  Nothing here may move a wall, a door, a window or change a dimension.
 * ------------------------------------------------------------------ */

export const INTERIOR_STYLES = [
  { id: 'modern', label: 'Modern' }, { id: 'contemporary', label: 'Contemporary' }, { id: 'minimal', label: 'Minimal' },
  { id: 'luxury', label: 'Luxury' }, { id: 'indian-contemporary', label: 'Indian Contemporary' }, { id: 'scandinavian', label: 'Scandinavian' },
] as const
export const FLOORINGS = [
  { id: 'beige-marble', label: 'Beige Marble', color: '#D8CBB8' }, { id: 'white-marble', label: 'White Marble', color: '#EEEBE6' },
  { id: 'grey-marble', label: 'Grey Marble', color: '#B9B8B5' }, { id: 'light-wood', label: 'Light Wood', color: '#C9A47C' },
  { id: 'dark-wood', label: 'Dark Wood', color: '#6B4A33' }, { id: 'travertine', label: 'Travertine', color: '#D6C3A3' },
  { id: 'concrete', label: 'Concrete', color: '#A9A6A0' }, { id: 'ceramic-tile', label: 'Ceramic Tile', color: '#D9D4CC' },
] as const
export const CEILINGS = [
  { id: 'plain', label: 'Plain White' }, { id: 'false', label: 'False Ceiling' }, { id: 'cove', label: 'Cove Ceiling' },
  { id: 'tray', label: 'Tray Ceiling' }, { id: 'wooden', label: 'Wooden Accent Ceiling' },
] as const
export const LIGHTINGS = [
  { id: 'daylight', label: 'Daylight' }, { id: 'warm', label: 'Warm' }, { id: 'neutral', label: 'Neutral' }, { id: 'evening', label: 'Evening' },
] as const
export const DENSITIES = [{ id: 'low', label: 'Low' }, { id: 'medium', label: 'Medium' }, { id: 'full', label: 'Full' }] as const
export const WALL_PRESETS = [
  { label: 'Cream', color: '#F2EADC' }, { label: 'Warm white', color: '#F4F0E8' }, { label: 'Pure white', color: '#FAFAF7' },
  { label: 'Greige', color: '#D9D2C5' }, { label: 'Sage', color: '#C9D2C0' }, { label: 'Dusty blue', color: '#C7D3DC' },
  { label: 'Blush', color: '#E7CDBF' }, { label: 'Charcoal', color: '#4A4A48' },
] as const

type Id<T extends readonly { id: string }[]> = T[number]['id']
export type InteriorConfiguration = {
  roomId: string
  floor: number
  style: Id<typeof INTERIOR_STYLES>
  flooring: { material: Id<typeof FLOORINGS>; color: string }
  walls: { color: string }
  ceiling: { type: Id<typeof CEILINGS>; color: string }
  lighting: Id<typeof LIGHTINGS>
  furnitureDensity: Id<typeof DENSITIES>
}
export type Quality = 'fast' | 'high'

export const defaultConfiguration = (roomId: string, floor: number): InteriorConfiguration => ({
  roomId, floor, style: 'modern', flooring: { material: 'beige-marble', color: '#D8CBB8' }, walls: { color: '#F2EADC' },
  ceiling: { type: 'cove', color: '#FAFAF7' }, lighting: 'warm', furnitureDensity: 'medium',
})

/** rooms a person would style: no stairs, shafts, corridors, lobbies, stores or open-air spaces */
export function previewRooms(design: Design) {
  const skip = /^(stair|lift|corridor|foyer|lobby|shaft|vacant|store|duct|passage|landing)/i
  return design.floors.flatMap((f) => f.rooms.filter((r) => !r.outdoor && r.zone !== 'circulation' && !skip.test(r.id)).map((r) => ({
    floor: f.level, floorName: f.name, id: r.id, name: r.name, w: r.rect.w / 1000, d: r.rect.h / 1000,
  })))
}

/** decor that a lighter furniture level leaves out; the working pieces always stay */
const DECOR: Record<InteriorConfiguration['furnitureDensity'], RegExp | null> = {
  low: /art|plant|lamp|rug|cushion|pillow|throw|vase|decor|shelf/i, medium: /art|vase|decor/i, full: null,
}

export type InteriorScene = {
  designId: string
  room: { id: string; name: string; floor: number; floorName: string; dims: { w: number; d: number; h: number }; focal: Side }
  shell: RoomBox[]
  furniture: DollBox[]
  openings: { kind: string; side: Side; widthM: number; sillM: number; headM: number; exterior: boolean }[]
  /** room-local metres, y up: a clear standing point near the centre at eye height */
  camera: [number, number, number]
  /** where the 360 opens: facing the main window wall, in degrees clockwise from north */
  initialYaw: number
  daylightDir: [number, number, number]
  config: InteriorConfiguration
  quality: Quality
}

/** isolate the selected room from the validated plan and dress it — never altering its architecture */
export function createInteriorScene(design: Design, designId: string, config: InteriorConfiguration, character: Character, quality: Quality = 'fast'): InteriorScene | null {
  const shell = buildRoom(design, config.floor, config.roomId, character)
  if (!shell) return null
  const drop = DECOR[config.furnitureDensity]
  const furniture = furnishSingleRoom(design, config.floor, config.roomId).filter((b) => !drop || !(drop.test(b.id) || drop.test(b.mat)))
  const camera = standingPoint(shell.dims.w, shell.dims.d, furniture)
  return {
    designId,
    room: { id: config.roomId, name: shell.name, floor: shell.floorLevel, floorName: shell.floorName, dims: shell.dims, focal: shell.focal },
    shell: shell.boxes,
    furniture,
    openings: shell.openings.map(({ kind, side, widthM, sillM, headM, exterior }) => ({ kind, side, widthM, sillM, headM, exterior })),
    camera,
    initialYaw: { N: 0, E: 90, S: 180, W: 270 }[shell.focal],
    daylightDir: shell.daylightDir,
    config,
    quality,
  }
}

/** the clear point nearest the room centre: away from the walls and out of every piece of furniture, at 1.6 m eye height */
function standingPoint(w: number, d: number, furniture: DollBox[]): [number, number, number] {
  const solid = furniture.filter((b) => b.size[1] > 0.05 && b.pos[1] - b.size[1] / 2 < 1.7)
  const clearance = (x: number, z: number) => Math.min(
    w / 2 - Math.abs(x), d / 2 - Math.abs(z),
    ...solid.map((b) => Math.max(Math.abs(x - b.pos[0]) - b.size[0] / 2, Math.abs(z - b.pos[2]) - b.size[2] / 2)),
  )
  let best: [number, number] = [0, 0], bestScore = -Infinity
  for (let x = -w / 2 + 0.3; x <= w / 2 - 0.3; x += 0.1) for (let z = -d / 2 + 0.3; z <= d / 2 - 0.3; z += 0.1) {
    const c = clearance(x, z)
    // enough room to stand (0.45 m all round) wins; among those, the one nearest the centre
    const score = c >= 0.45 ? 10 - Math.hypot(x, z) : c
    if (score > bestScore) { bestScore = score; best = [x, z] }
  }
  return [Math.round(best[0] * 100) / 100, 1.6, Math.round(best[1] * 100) / 100]
}
