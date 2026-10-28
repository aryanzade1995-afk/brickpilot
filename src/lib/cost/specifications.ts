import { validatedFinishes as catalog, validatedPunePolicy as policy, validatedLabour } from './data/validated.ts'

export { catalog, policy, validatedLabour }
export type FinishCategory = 'floor' | 'wall' | 'door' | 'window' | 'roof'
export type CostSelection = {
  preset: string
  catalogue?: true
  choices: Record<FinishCategory, string>
  roomFloors: Record<string, string>
  includeGst: boolean
  overheadPercent: number; contingencyPercent: number; feePercent: number; gstPercent: number
  labourMode?: 'additional' | 'replace'
  wageMode?: 'auto' | 'manual'
  customDailyWage?: number
  crewSize?: number
  skilledDailyRate?: number
  unskilledDailyRate?: number
  daysOverride?: number
}
export function defaultSelection(preset = policy.defaults.preset): CostSelection {
  const item = catalog.presets.find(p => p.id === preset) ?? catalog.presets.find(p => p.id === policy.defaults.preset)!
  return {
    ...policy.defaults,
    preset: item.id,
    choices: { ...item.choices },
    roomFloors: {},
    labourMode: 'additional',
    wageMode: 'auto',
    crewSize: validatedLabour.defaults.crewSize,
    skilledDailyRate: validatedLabour.defaults.skilledDailyRate,
    unskilledDailyRate: validatedLabour.defaults.unskilledDailyRate,
  }
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
  const labourMode = saved.labourMode === 'replace' ? ('replace' as const) : ('additional' as const)
  const wageMode = saved.wageMode === 'manual' ? ('manual' as const) : ('auto' as const)
  const customDailyWage = typeof saved.customDailyWage === 'number' && Number.isFinite(saved.customDailyWage) && saved.customDailyWage > 0
    ? saved.customDailyWage
    : undefined
  const crewSize = typeof saved.crewSize === 'number' && Number.isFinite(saved.crewSize) && saved.crewSize > 0
    ? saved.crewSize
    : defaults.crewSize
  const skilledDailyRate = typeof saved.skilledDailyRate === 'number' && Number.isFinite(saved.skilledDailyRate) && saved.skilledDailyRate >= 0
    ? saved.skilledDailyRate
    : defaults.skilledDailyRate
  const unskilledDailyRate = typeof saved.unskilledDailyRate === 'number' && Number.isFinite(saved.unskilledDailyRate) && saved.unskilledDailyRate >= 0
    ? saved.unskilledDailyRate
    : defaults.unskilledDailyRate
  const daysOverride = typeof saved.daysOverride === 'number' && Number.isFinite(saved.daysOverride) && saved.daysOverride > 0
    ? saved.daysOverride
    : undefined

  return { ...(saved.catalogue === true ? { catalogue: true as const } : {}), preset: catalog.presets.some(p => p.id === saved.preset) ? saved.preset! : defaults.preset,
    choices, roomFloors, includeGst: saved.includeGst === true,
    overheadPercent: percent('overheadPercent'), contingencyPercent: percent('contingencyPercent'),
    feePercent: percent('feePercent'), gstPercent: percent('gstPercent'),
    labourMode, wageMode, ...(customDailyWage !== undefined ? { customDailyWage } : {}),
    crewSize, skilledDailyRate, unskilledDailyRate, ...(daysOverride !== undefined ? { daysOverride } : {}) }
}
export function finishOption(category: FinishCategory, id: string) {
  const group = catalog.categories.find(c => c.id === category)!
  return group.options.find(o => o.id === id) ?? group.options.find(o => o.id === defaultSelection().choices[category])!
}
export const estimateLabel = () => `Concept estimate ±${policy.uncertaintyPercent}% · approximate · ${policy.city} rates ${policy.date}`
