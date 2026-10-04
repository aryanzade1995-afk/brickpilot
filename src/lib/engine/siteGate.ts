import type { Design } from './types.ts'

export type SiteGate = { centerX: number; widthMm: number }
/** One actual opening shared by the escape graph, study model and Blender. */
export function siteGate(design: Design): SiteGate | null {
  if (!design.model.brief.rooms.priorities.compoundWall) return null
  const width = design.model.plot.width
  const features = design.siteFeatures ?? []
  const path = features.find(f => f.kind === 'driveway') ?? features.find(f => f.kind === 'path')
  if (path && path.rect.w >= 1200) {
    const left = Math.max(0, path.rect.x - 280), right = Math.min(width, path.rect.x + path.rect.w + 280)
    return { centerX: (left + right) / 2, widthMm: right - left - 560 }
  }
  const half = Math.min(1900, (width - 600) / 2)
  const driveway = features.find(f => f.kind === 'driveway')
  const center = driveway ? driveway.rect.x + driveway.rect.w / 2 : width / 2
  return { centerX: Math.min(width - half - 300, Math.max(half + 300, center)), widthMm: half * 2 }
}
