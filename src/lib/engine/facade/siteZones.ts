import type { BuildingModel } from '../buildingModel.ts'
import type { FacadeSide, FacadeZone } from './proceduralTypes.ts'
import { ELEMENT_LIMITS } from './elementLimits.ts'
const opposite: Record<FacadeSide, FacadeSide> = { N: 'S', S: 'N', E: 'W', W: 'E' }
export function siteFacadeZones(building: BuildingModel): FacadeZone[] {
  const ground = [...building.floors].sort((a, b) => a.level - b.level)[0]
  if (!ground) return []
  const zones: FacadeZone[] = [], features = building.siteFeatures ?? []
  const path = features.find(f => f.kind === 'driveway') ?? features.find(f => f.kind === 'path')
  if (building.siteRequirements?.compoundWall && path && path.rect.w >= 1200) {
    zones.push({ id: `site:gate:${path.id}`, anchorKind: 'gate', sourceSiteId: path.id,
      kind: 'ENTRANCE', floorId: ground.id, wallId: null, hostMassIds: [], roomId: null,
      side: 'N', fixedMm: building.plot.depthMm, startMm: Math.max(0, path.rect.x - 280),
      endMm: Math.min(building.plot.widthMm, path.rect.x + path.rect.w + 280),
      elevationMm: ground.elevationMm, heightMm: 3400, openingIds: [] })
  }
  for (const sit of features.filter(f => f.kind === 'sitOut')) {
    const distance = (a: typeof sit.rect, b: typeof sit.rect) => Math.hypot(
      Math.max(a.x - b.x - b.w, b.x - a.x - a.w, 0), Math.max(a.y - b.y - b.h, b.y - a.y - a.h, 0))
    if (!features.some(f => f.kind === 'pool' && distance(sit.rect, f.rect) <= ELEMENT_LIMITS.poolAdjacencyMm)) continue
    zones.push({ id: `site:pool:${sit.id}`, anchorKind: 'pool-sitout', sourceSiteId: sit.id,
      kind: 'SECONDARY', floorId: ground.id, wallId: null, hostMassIds: [], roomId: null,
      side: 'N', fixedMm: sit.rect.y + sit.rect.h, startMm: sit.rect.x, endMm: sit.rect.x + sit.rect.w,
      elevationMm: ground.elevationMm, heightMm: 3200, openingIds: [] })
  }
  return zones
}
export function interiorRoofZones(zones: FacadeZone[]): FacadeZone[] {
  return zones.filter(z => z.kind === 'ROOFLINE' && !z.anchorKind).map(z => ({
    ...z, id: `inside:${z.id}`, anchorKind: 'roof-interior', side: opposite[z.side], heightMm: 3200,
  }))
}
