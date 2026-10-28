import type { Brief } from '../model/brief.ts'
import type { Design } from '../engine/types.ts'
import type { CostEstimate } from './boq.ts'
import { geometryCostKey } from './quantities.ts'
import { fnv } from '../engine/massing/rng.ts'
import { costReplaySchema } from './deliverySchemas.ts'
import { solarSignature, defaultSolarConfiguration } from '../model/solar.ts'
import { parseSelection } from './specifications.ts'

export type CostReplay = {
  version: 1
  geometryKey: string
  signature: string
  cost: CostEstimate
  pricingSnapshot?: unknown
  interiorSchedule?: unknown
}
const loaded = new Map<string, CostReplay>()
export function pricingSignature(brief: Brief) {
  // Preserve untouched historical keys; structured solar pricing and assessment edits invalidate replay.
  const { solar: _solar, ...pricedBrief } = brief
  const solar = brief.solar ?? defaultSolarConfiguration()
  const extra = solarSignature(solar) === solarSignature(defaultSolarConfiguration()) ? {} : { solarPricingV1: solarSignature(solar) }
  return fnv(JSON.stringify({ ...pricedBrief, ...extra, project: { ...brief.project, name: '' },
    specs: { overrides: Object.fromEntries(Object.entries(brief.specs.overrides).sort(([a], [b]) => a.localeCompare(b))) } })).toString(16)
}
export function snapshotCost(
  design: Design,
  brief: Brief,
  cost: CostEstimate,
  pricingSnapshot?: unknown,
  interiorSchedule?: unknown,
): CostReplay {
  const replay = {
    version: 1 as const,
    geometryKey: geometryCostKey(design),
    signature: pricingSignature(brief),
    cost,
    pricingSnapshot: pricingSnapshot ?? undefined,
    interiorSchedule: interiorSchedule ?? undefined,
  }
  costReplaySchema.parse(replay)
  return structuredClone(replay)
}
export function parseCostReplay(value: unknown): CostReplay | null {
  const parsed = costReplaySchema.safeParse(value)
  return parsed.success ? parsed.data as unknown as CostReplay : null
}
export function restoreCostReplay(replay: CostReplay | null) {
  loaded.clear()
  if (replay) loaded.set(replay.geometryKey, structuredClone(replay))
}
export function getLoadedCostReplay(geometryKey: string): CostReplay | null {
  return loaded.get(geometryKey) ?? null
}
export function replayedCost(design: Design, brief: Brief, preferences?: unknown): CostEstimate | null {
  // Applied solar must always be rechecked against the current roof, not replayed from a cost snapshot.
  if (brief.solar?.intention === 'install-now') return null
  const replay = loaded.get(geometryCostKey(design))
  // Historical snapshots remain readable, but a pre-services estimate cannot
  // supply the new pipe/tank controls or their per-size cost lines.
  if (!replay || !replay.cost.quantities.plumbing || replay.signature !== pricingSignature(brief)) return null
  if (preferences && JSON.stringify(parseSelection(preferences)) !== JSON.stringify(parseSelection(replay.cost.selection))) return null
  return replay.cost
}
