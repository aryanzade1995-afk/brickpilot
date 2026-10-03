import type { Brief } from '../model/brief.ts'
import type { Design } from '../engine/types.ts'
import type { CostEstimate } from './boq.ts'
import { geometryCostKey } from './quantities.ts'
import { fnv } from '../engine/massing/rng.ts'
import { costReplaySchema } from './deliverySchemas.ts'
import { parseSelection } from './specifications.ts'

export type CostReplay = { version: 1; geometryKey: string; signature: string; cost: CostEstimate }
const loaded = new Map<string, CostReplay>()
export function pricingSignature(brief: Brief) {
  return fnv(JSON.stringify({ ...brief, project: { ...brief.project, name: '' },
    specs: { overrides: Object.fromEntries(Object.entries(brief.specs.overrides).sort(([a], [b]) => a.localeCompare(b))) } })).toString(16)
}
export function snapshotCost(design: Design, brief: Brief, cost: CostEstimate): CostReplay {
  const replay = { version: 1 as const, geometryKey: geometryCostKey(design), signature: pricingSignature(brief), cost }
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
export function replayedCost(design: Design, brief: Brief, preferences?: unknown): CostEstimate | null {
  const replay = loaded.get(geometryCostKey(design))
  if (!replay || replay.signature !== pricingSignature(brief)) return null
  if (preferences && JSON.stringify(parseSelection(preferences)) !== JSON.stringify(parseSelection(replay.cost.selection))) return null
  return replay.cost
}
