import type { AssetBox, WalkthroughGeometryPayload } from './delivery.ts'

/** Illustrative fixture illumination, not manufacturer photometry or a lux
 * calculation. Keep a bounded two-light budget and never light a neighbouring
 * room through a solid wall merely because its fitting is closer. */
export const LOCAL_FIXTURE_MAX_INTENSITY = 24
export function nearbyRoomEmitters(emitters: AssetBox[], position: readonly number[], geometry?: Pick<WalkthroughGeometryPayload, 'metadata'>) {
  const [x,y,z] = position
  const room = geometry?.metadata.rooms.find(r => {
    const ceiling = geometry.metadata.floors.find(f => f.id === r.floorId)?.clearCeilingM
    // clearCeilingM is an absolute source elevation, not a storey height.
    const top = ceiling === null || ceiling === undefined ? geometry.metadata.floors.filter(f => f.elevationM > r.elevationM).sort((a,b)=>a.elevationM-b.elevationM)[0]?.elevationM : ceiling
    const rect = r.rectMm
    return !r.outdoor && y >= r.elevationM && (top === undefined || y < top) && x >= rect.x/1000 && x <= (rect.x+rect.w)/1000 && -z >= rect.y/1000 && -z <= (rect.y+rect.h)/1000
  })
  if (geometry && !room) return []
  const candidates = emitters.filter(p => (!room || p.roomId === room.id) && p.position[1] > y && p.position[1]-y < 3)
  // Exposure-calibrated concept budget, not a conversion from product watts.
  // Small foyers must not receive the same illumination as a large living room.
  const total = room ? Math.min(LOCAL_FIXTURE_MAX_INTENSITY,Math.max(6,room.rectMm.w*room.rectMm.h/1e6*.75)) : 14
  const intensity = total/Math.max(1,Math.min(2,candidates.length))
  return candidates
    .map(p => ({p,intensity,distance:Math.hypot(p.position[0]-x,p.position[2]-z)}))
    .filter(p => p.distance < 6).sort((a,b)=>a.distance-b.distance).slice(0,2)
}
