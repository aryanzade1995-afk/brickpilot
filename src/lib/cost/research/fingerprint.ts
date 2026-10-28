import type { Design } from '../../engine/types.ts'
import type { Brief } from '../../model/brief.ts'
import { geometryCostKey } from '../quantities.ts'
import { fnv } from '../../engine/massing/rng.ts'
import { defaultSolarConfiguration, solarSignature } from '../../model/solar.ts'
import { boqRules } from '../data/boqRules.ts'
import type { CostSelection } from '../specifications.ts'
import type { ResearchLocation, ScopeMode, InteriorItemSchedule } from './types.ts'

export function interiorScheduleSignature(schedule?: InteriorItemSchedule | any[] | null): string {
  if (!schedule) return 'none'
  const itemsList = Array.isArray(schedule) ? schedule : (schedule as any).items
  if (!itemsList || !itemsList.length) return 'none'
  const items = itemsList
    .slice()
    .sort((a: any, b: any) => a.id.localeCompare(b.id))
    .map((i: any) => `${i.id}:${i.includedInEstimate ? 1 : 0}:${i.count}:${i.estimatedRate}`)
  return fnv(items.join('|')).toString(16)
}


export function estimationFingerprint(
  design: Design,
  brief: Brief,
  selection?: CostSelection | null,
  location?: ResearchLocation | null,
  scope: ScopeMode = 'combined',
  interiorSchedule?: InteriorItemSchedule | null,
  pricingSnapshotId?: string | null,
): string {
  const geoKey = geometryCostKey(design)
  const solar = brief.solar ?? defaultSolarConfiguration()
  const solarSig = solarSignature(solar)
  const sortedOverrides = Object.entries(brief.specs.overrides || {}).sort(([a], [b]) => a.localeCompare(b))
  
  const payload = {
    geoKey,
    floors: design.floors.map(f => ({
      level: f.level,
      roomCount: f.rooms.length,
      rooms: f.rooms.map(r => `${r.id}:${r.area.toFixed(2)}`).sort(),
    })),
    site: { w: brief.site.plotWidth, d: brief.site.plotDepth },
    levels: brief.levels.storeys,
    buildingType: brief.project.buildingType,
    finish: brief.finish,
    overrides: sortedOverrides,
    solarSig,
    allowances: selection ? {
      overhead: selection.overheadPercent,
      contingency: selection.contingencyPercent,
      fee: selection.feePercent,
      gst: selection.gstPercent,
      includeGst: selection.includeGst,
    } : null,
    location: location ? { city: location.city.toLowerCase().trim(), pincode: location.pincode } : null,
    scope,
    interiorSig: interiorScheduleSignature(interiorSchedule),
    pricingSnapshotId: pricingSnapshotId || 'baseline',
    boqVersion: boqRules.version,
  }

  return fnv(JSON.stringify(payload)).toString(16)
}
