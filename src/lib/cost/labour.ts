import { validatedLabour } from './data/validated.ts'

export type LabourMode = 'additional' | 'replace'
export type LabourWageMode = 'auto' | 'manual'

export type LabourOptions = {
  labourMode?: LabourMode
  wageMode?: LabourWageMode
  customDailyWage?: number
  city?: string
  crewSize?: number
  skilledDailyRate?: number
  unskilledDailyRate?: number
  daysOverride?: number
}

export type CityWageBenchmark = {
  city: string
  tier?: number
  skilledDailyRate: number
  unskilledDailyRate: number
  isBenchmark: boolean
  label: string
}

export type SiteLabourCalculation = {
  mode: LabourMode
  wageMode: LabourWageMode
  rate: number
  crew: number
  days: number
  months: number
  total: number
  builtUpAreaSqft: number
  finishFactor: number
  storeyFactor: number
  personDays: number
  crewSize: number
  workingDays: number
  workingMonths: number
  skilledDailyRate: number
  unskilledDailyRate: number
  skilledShare: number
  blendedDailyRate: number
  dailyCrewCost: number
  siteLabourTotal: number
  embeddedLabour: number
  daysOverride?: number
  customDailyWage?: number
  city: string
  wageSourceLabel: string
  note: string
}

/**
 * Resolve city wage benchmark from data/labour.json.
 * Matches known tier entries (e.g. Pune, Mumbai, Delhi, Bengaluru, etc.)
 * or defaults to Maharashtra / Pune Tier 2 baseline.
 */
export function resolveCityWageBenchmark(city?: string): CityWageBenchmark {
  const d = validatedLabour.defaults
  const tiers = validatedLabour.cityTiers ?? {}
  if (city) {
    const norm = city.trim().toLowerCase()
    for (const [key, item] of Object.entries(tiers)) {
      if (norm === key || norm.includes(key) || norm.includes(item.name.toLowerCase())) {
        return {
          city: item.name,
          tier: item.tier,
          skilledDailyRate: item.skilledDailyRate,
          unskilledDailyRate: item.unskilledDailyRate,
          isBenchmark: true,
          label: `${item.name} benchmark (Tier ${item.tier})`,
        }
      }
    }
  }

  const puneTier = tiers['pune']
  return {
    city: puneTier?.name ?? validatedLabour.city ?? 'Pune',
    tier: puneTier?.tier ?? 2,
    skilledDailyRate: puneTier?.skilledDailyRate ?? d.skilledDailyRate,
    unskilledDailyRate: puneTier?.unskilledDailyRate ?? d.unskilledDailyRate,
    isBenchmark: true,
    label: `${puneTier?.name ?? 'Pune'} benchmark (Tier ${puneTier?.tier ?? 2})`,
  }
}

/**
 * Pure deterministic site labour and duration estimator.
 * No RNG, zero external side effects.
 *
 * Formula:
 *   personDays = builtUpAreaSqft * personDaysPerSqft * finishFactor * storeyFactor
 *   days = ceil(personDays / crewSize)
 *   months = days / 26
 *   blendedDailyRate:
 *     - if wageMode === 'manual' and customDailyWage provided: customDailyWage
 *     - else: skilledShare * skilled + (1 - skilledShare) * unskilled
 *   siteLabourTotal = workingDays * crewSize * blendedDailyRate
 */
export function estimateSiteLabour(
  builtUpAreaSqft: number,
  finish: string = 'standard',
  storeys: number = 1,
  options: LabourOptions = {},
  embeddedLabour: number = 0,
): SiteLabourCalculation {
  const d = validatedLabour.defaults

  const finishKey = finish.toLowerCase()
  const finishFactor = d.finishFactors[finishKey] ?? (finishKey === 'refined' ? d.finishFactors.premium : (d.finishFactors.mid ?? 1.0))

  const storeyKey = String(Math.max(1, Math.floor(storeys)))
  const storeyFactor = d.storeyFactors[storeyKey] ?? (storeys > 3 ? 1.10 : 1.0)

  const personDays = Math.round(builtUpAreaSqft * d.personDaysPerSqft * finishFactor * storeyFactor * 100) / 100

  const crewSize = options.crewSize !== undefined && Number.isFinite(options.crewSize) && options.crewSize > 0
    ? Math.max(1, Math.round(options.crewSize))
    : d.crewSize

  const calculatedDays = crewSize > 0 ? Math.ceil(personDays / crewSize) : 0

  const hasOverride = options.daysOverride !== undefined && Number.isFinite(options.daysOverride) && options.daysOverride > 0
  const workingDays = hasOverride ? Math.round(options.daysOverride!) : calculatedDays

  const workingMonths = Math.round((workingDays / d.workingDaysPerMonth) * 10) / 10

  const wageMode: LabourWageMode = options.wageMode === 'manual' ? 'manual' : 'auto'
  const skilledShare = d.skilledShare

  let skilledDailyRate: number
  let unskilledDailyRate: number
  let blendedDailyRate: number
  let wageSourceLabel: string
  let resolvedCity: string

  if (wageMode === 'manual') {
    resolvedCity = options.city?.trim() || validatedLabour.city || 'Pune'
    if (options.customDailyWage !== undefined && Number.isFinite(options.customDailyWage) && options.customDailyWage > 0) {
      blendedDailyRate = Math.round(options.customDailyWage * 100) / 100
      skilledDailyRate = options.skilledDailyRate !== undefined && Number.isFinite(options.skilledDailyRate) && options.skilledDailyRate > 0
        ? options.skilledDailyRate
        : blendedDailyRate
      unskilledDailyRate = options.unskilledDailyRate !== undefined && Number.isFinite(options.unskilledDailyRate) && options.unskilledDailyRate > 0
        ? options.unskilledDailyRate
        : blendedDailyRate
      wageSourceLabel = `Manual rate (INR ${blendedDailyRate}/day)`
    } else {
      skilledDailyRate = options.skilledDailyRate !== undefined && Number.isFinite(options.skilledDailyRate) && options.skilledDailyRate >= 0
        ? options.skilledDailyRate
        : d.skilledDailyRate
      unskilledDailyRate = options.unskilledDailyRate !== undefined && Number.isFinite(options.unskilledDailyRate) && options.unskilledDailyRate >= 0
        ? options.unskilledDailyRate
        : d.unskilledDailyRate
      blendedDailyRate = Math.round((skilledShare * skilledDailyRate + (1 - skilledShare) * unskilledDailyRate) * 100) / 100
      wageSourceLabel = `Manual rate (INR ${blendedDailyRate}/day)`
    }
  } else {
    // Auto mode: resolve city benchmark
    const benchmark = resolveCityWageBenchmark(options.city)
    resolvedCity = benchmark.city
    skilledDailyRate = options.skilledDailyRate !== undefined && Number.isFinite(options.skilledDailyRate) && options.skilledDailyRate >= 0
      ? options.skilledDailyRate
      : benchmark.skilledDailyRate
    unskilledDailyRate = options.unskilledDailyRate !== undefined && Number.isFinite(options.unskilledDailyRate) && options.unskilledDailyRate >= 0
      ? options.unskilledDailyRate
      : benchmark.unskilledDailyRate
    blendedDailyRate = Math.round((skilledShare * skilledDailyRate + (1 - skilledShare) * unskilledDailyRate) * 100) / 100
    wageSourceLabel = `Auto: ${benchmark.label}`
  }

  const dailyCrewCost = Math.round(crewSize * blendedDailyRate * 100) / 100
  const siteLabourTotal = Math.round(workingDays * dailyCrewCost)

  const mode: LabourMode = options.labourMode === 'replace' ? 'replace' : 'additional'

  const note = mode === 'additional'
    ? `Rate INR ${blendedDailyRate}/day (${wageSourceLabel}) × ${crewSize} crew × ${workingDays} days (${workingMonths.toFixed(1)} mos). Additional site labour allowance.`
    : `Rate INR ${blendedDailyRate}/day (${wageSourceLabel}) × ${crewSize} crew × ${workingDays} days (${workingMonths.toFixed(1)} mos). Replaces embedded BOQ labour.`

  return {
    mode,
    wageMode,
    rate: blendedDailyRate,
    crew: crewSize,
    days: workingDays,
    months: workingMonths,
    total: siteLabourTotal,
    builtUpAreaSqft: Math.round(builtUpAreaSqft * 100) / 100,
    finishFactor,
    storeyFactor,
    personDays,
    crewSize,
    workingDays,
    workingMonths,
    skilledDailyRate,
    unskilledDailyRate,
    skilledShare,
    blendedDailyRate,
    dailyCrewCost,
    siteLabourTotal,
    embeddedLabour: Math.round(embeddedLabour * 100) / 100,
    daysOverride: hasOverride ? options.daysOverride : undefined,
    customDailyWage: options.customDailyWage,
    city: resolvedCity,
    wageSourceLabel,
    note,
  }
}
