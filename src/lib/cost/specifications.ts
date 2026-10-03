import catalog from './data/finishes.json' with { type: 'json' }
import policy from './data/pune.json' with { type: 'json' }

export { catalog, policy }
export type FinishCategory = 'floor' | 'wall' | 'door' | 'window' | 'roof'
export type CostSelection = {
  preset: string
  choices: Record<FinishCategory, string>
  roomFloors: Record<string, string>
  includeGst: boolean
  overheadPercent: number; contingencyPercent: number; feePercent: number; gstPercent: number
}
export function defaultSelection(preset = policy.defaults.preset): CostSelection {
  const item = catalog.presets.find(p => p.id === preset) ?? catalog.presets.find(p => p.id === policy.defaults.preset)!
  return { ...policy.defaults, preset: item.id, choices: { ...item.choices }, roomFloors: {} }
}
/** Strip unknown saved fields and recover obsolete option IDs without touching the brief. */
export function parseSelection(value: unknown): CostSelection {
  const defaults = defaultSelection()
  if (!value || typeof value !== 'object') return defaults
  const saved = value as Partial<CostSelection>
  const choices = { ...defaults.choices }
  for (const category of catalog.categories) {
    const key = category.id as FinishCategory, id = saved.choices?.[key]
    if (category.options.some(o => o.id === id)) choices[key] = id!
  }
  const validFloors = catalog.categories.find(c => c.id === 'floor')!.options.map(o => o.id)
  const roomFloors = Object.fromEntries(Object.entries(saved.roomFloors ?? {}).filter(([, id]) => validFloors.includes(id)))
  const percent = (key: 'overheadPercent' | 'contingencyPercent' | 'feePercent' | 'gstPercent') => {
    const v = saved[key]
    return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= policy.percentageLimit ? v : defaults[key]
  }
  return { preset: catalog.presets.some(p => p.id === saved.preset) ? saved.preset! : defaults.preset,
    choices, roomFloors, includeGst: saved.includeGst === true,
    overheadPercent: percent('overheadPercent'), contingencyPercent: percent('contingencyPercent'),
    feePercent: percent('feePercent'), gstPercent: percent('gstPercent') }
}
export function finishOption(category: FinishCategory, id: string) {
  const group = catalog.categories.find(c => c.id === category)!
  return group.options.find(o => o.id === id) ?? group.options.find(o => o.id === defaultSelection().choices[category])!
}
export const estimateLabel = () => `Concept estimate ±${policy.uncertaintyPercent}% · approximate · ${policy.city} rates ${policy.date}`
