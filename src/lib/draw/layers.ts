import { terraceLayout } from '../engine/terrace.ts'
import { rectUnionEdges } from '../geometry.ts'
import type { Design, FloorPlan, SiteFeature } from '../engine/types.ts'
import { furnishFloor } from './furniture.ts'

export const LAYER_LABELS = {
  site: 'Site + setbacks', zoning: 'Room zoning', circulation: 'Circulation + access',
  walls: 'Walls + columns', openings: 'Doors + windows', supports: 'Supports',
  dimensions: 'Dimensions', labels: 'Labels', furniture: 'Furniture',
}
export type LayerId = keyof typeof LAYER_LABELS
export type DrawingLayers = Record<LayerId, boolean>
export type DrawingPreset = 'Presentation' | 'Architectural' | 'Validation' | 'Print'
const architectural: DrawingLayers = { site: true, zoning: false, circulation: false, walls: true,
  openings: true, supports: false, dimensions: true, labels: true, furniture: false }
export const DRAWING_PRESETS: Record<DrawingPreset, DrawingLayers> = {
  Presentation: { ...architectural, dimensions: false, furniture: true },
  Architectural: architectural,
  Validation: { ...architectural, zoning: true, circulation: true, supports: true },
  Print: { ...architectural },
}

/** Counts match the visible groups. No geometry is generated or changed here. */
export function drawingLayerCounts(floor: FloorPlan, features: SiteFeature[] = []): Record<LayerId, number> {
  return {
    site: 2 + (floor.level === 0 ? features.length : 0), zoning: floor.rooms.length,
    circulation: floor.rooms.filter(r => r.zone === 'circulation').length + floor.openings.filter(o => o.kind !== 'window').length,
    walls: floor.walls.length + (floor.columns?.length ?? 0), openings: floor.openings.length,
    supports: (floor.beams?.length ?? 0) + (floor.columns?.length ?? 0) + (floor.level===0?(floor.columns?.length??0)+(floor.beams?.length??0):0), dimensions: 4,
    labels: floor.rooms.filter(r => Math.min(r.rect.w, r.rect.h) >= 1400).length + (floor.level === 0 ? features.filter(f => !f.covered && f.rect.w >= 1400 && f.rect.h >= 1000).length : 0),
    furniture: furnishFloor(floor).reduce((n, f) => n + f.items.filter(i => i.role !== 'plant').length, 0) + (floor.level === 0 ? features.filter(f => !f.covered && f.kind === 'parking').length : 0),
  }
}

export function terraceLayerCounts(design: Design): Record<LayerId, number> {
  const layout = terraceLayout(design), top = design.floors.at(-1)!
  return { site: 2, zoning: layout?.slab.length ?? top.footprint.length,
    circulation: top.stair ? 1 : 0, walls: (layout ? rectUnionEdges(layout.slab).length + (layout.mumty ? 1 : 0) : top.footprint.length),
    openings: 0, supports: (top.beams?.length ?? 0) + (top.columns?.length ?? 0), dimensions: 4,
    labels: layout ? 1 + (layout.mumty ? 1 : 0) + (layout.pergola ? 1 : 0) : 1,
    furniture: (layout?.pergola ? 1 : 0) + (layout?.tank ? 1 : 0) }
}
