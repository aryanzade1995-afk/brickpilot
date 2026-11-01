/**
 * National Standards, Statutory Benchmarks & Technical Assumptions
 * Aligned with NBC 2016, IS 1172, Eco-Niwas Samhita (ENS 2021), DEPwD 2021, and PM Surya Ghar.
 *
 * Rule:
 * - A record may keep a clause field ONLY if it is copied from a file added under docs/sources/;
 *   otherwise clause is set to null.
 * - sourceUrl must be a specific document URL, not a homepage. If unknown, set to null and verified: false.
 * - Keep verified: true ONLY for PM Surya Ghar (FAQ notification) and PMAY-U 2.0 (FAQ page).
 * - Pune RWH threshold is 300 m² with verified: false (secondary sources conflict).
 * - All other cities in RWH table are verified: false.
 */

export interface StandardBenchmark<T = number> {
  value: T
  unit: string
  label: string
  source: string
  clause: string | null
  sourceUrl: string | null
  verifiedOn: string
  verified: boolean
  notes?: string
}

export interface CityRwhRule {
  city: string
  plotThresholdM2: number | null
  source: string
  clause: string | null
  sourceUrl: string | null
  verifiedOn: string
  verified: boolean
  notes: string
}

export const RWH_CITY_THRESHOLDS: Record<string, CityRwhRule> = {
  pune: {
    city: 'Pune',
    plotThresholdM2: 300,
    source: 'Pune Municipal Corporation Development Control Regulations',
    clause: null,
    sourceUrl: null,
    verifiedOn: '2026-10-31',
    verified: false,
    notes: 'Secondary sources conflict between 100 m² and 300 m² thresholds; 300 m² threshold applied under unverified status.',
  },
  bengaluru: {
    city: 'Bengaluru',
    plotThresholdM2: 60,
    source: 'BWSSB Rainwater Harvesting Regulations',
    clause: null,
    sourceUrl: null,
    verifiedOn: '2026-10-31',
    verified: false,
    notes: 'Mandatory for residential sites measuring 60 m² (approx 600 sq ft) and above.',
  },
  delhi: {
    city: 'Delhi',
    plotThresholdM2: 100,
    source: 'Delhi Jal Board Rainwater Harvesting Norms',
    clause: null,
    sourceUrl: null,
    verifiedOn: '2026-10-31',
    verified: false,
    notes: 'Mandatory for building plots of 100 m² and above.',
  },
  mumbai: {
    city: 'Mumbai',
    plotThresholdM2: 300,
    source: 'MCGM Building Bye-Laws',
    clause: null,
    sourceUrl: null,
    verifiedOn: '2026-10-31',
    verified: false,
    notes: 'Mandatory for plots exceeding 300 m² under municipal building regulations.',
  },
  chennai: {
    city: 'Chennai',
    plotThresholdM2: 0,
    source: 'Chennai Metropolitan Water Supply and Sewerage Guidelines',
    clause: null,
    sourceUrl: null,
    verifiedOn: '2026-10-31',
    verified: false,
    notes: 'Mandate applies to all buildings and sites regardless of plot size.',
  },
  hyderabad: {
    city: 'Hyderabad',
    plotThresholdM2: 300,
    source: 'GHMC Building Rules',
    clause: null,
    sourceUrl: null,
    verifiedOn: '2026-10-31',
    verified: false,
    notes: 'Mandatory rainwater harvesting structure for plots of 300 m² and above.',
  },
}

export function lookupCityRwhRule(cityName: string): CityRwhRule {
  const norm = (cityName || '').trim().toLowerCase()
  const matchKey = Object.keys(RWH_CITY_THRESHOLDS).find(k => norm.includes(k) || k.includes(norm))
  if (matchKey) return RWH_CITY_THRESHOLDS[matchKey]
  return {
    city: cityName || 'Custom Location',
    plotThresholdM2: null,
    source: 'rule not loaded for this city',
    clause: null,
    sourceUrl: null,
    verifiedOn: '2026-10-31',
    verified: false,
    notes: 'Local municipal by-law threshold is not in the repository dataset. Check with municipal authority.',
  }
}

export const NATIONAL_STANDARDS = {
  // --- WATER SECURITY ---
  domesticLpcd: {
    value: 135,
    unit: 'LPCD',
    label: 'Domestic Water Consumption Benchmark',
    source: 'IS 1172 / NBC 2016 Part 9 baseline',
    clause: null,
    sourceUrl: null,
    verifiedOn: '2026-10-31',
    verified: false,
    notes: 'Per capita daily requirement for full domestic plumbing in residential dwellings.',
  } satisfies StandardBenchmark,

  runoffCoefficientRcc: {
    value: 0.85,
    unit: 'fraction',
    label: 'RCC Terrace Runoff Coefficient',
    source: 'NBC 2016 Part 9 Section 2 baseline',
    clause: null,
    sourceUrl: null,
    verifiedOn: '2026-10-31',
    verified: false,
    notes: 'Fraction of rainwater drained from flat concrete roof slabs.',
  } satisfies StandardBenchmark,

  collectionFilterEfficiency: {
    value: 0.80,
    unit: 'fraction',
    label: 'First-Flush & Filter Retention Efficiency',
    source: 'CPHEEO Manual on Water Supply guidance',
    clause: null,
    sourceUrl: null,
    verifiedOn: '2026-10-31',
    verified: false,
    notes: 'Accounts for initial first-flush diverter and filtration mesh losses.',
  } satisfies StandardBenchmark,

  tankerRateInrPer5kL: {
    value: 1200,
    unit: 'INR / 5,000 L',
    label: 'Private Tanker Water Rate (Dry Season)',
    source: 'Private commercial water tanker market survey approximation',
    clause: null,
    sourceUrl: null,
    verifiedOn: '2026-10-31',
    verified: false,
    notes: 'Estimated commercial water tanker delivery cost during dry months (approx ₹0.24 / L).',
  } satisfies StandardBenchmark,

  // --- UNIVERSAL ACCESSIBILITY ---
  accessibleDoorClearWidthMm: {
    value: 900,
    unit: 'mm',
    label: 'Minimum Clear Door Width for Wheelchair Access',
    source: 'DEPwD 2021 Harmonised Guidelines',
    clause: null,
    sourceUrl: null,
    verifiedOn: '2026-10-31',
    verified: false,
    notes: 'Nominal 900mm clear door opening for barrier-free circulation along accessible routes.',
  } satisfies StandardBenchmark,

  rampMaxGradientRatio: {
    value: 12,
    unit: 'ratio',
    label: 'Maximum Accessible Ramp Slope (1:12)',
    source: 'DEPwD 2021 Harmonised Guidelines',
    clause: null,
    sourceUrl: null,
    verifiedOn: '2026-10-31',
    verified: false,
    notes: 'Maximum slope ratio 1:12 for rise up to 750mm without power assist.',
  } satisfies StandardBenchmark,

  // --- AFFORDABILITY & SOCIAL HOUSING (PMAY-U 2.0) - VERIFIED TRUE ---
  pmayU2: {
    source: 'PMAY-U 2.0 Scheme Guidelines 2024 FAQ',
    clause: null,
    sourceUrl: 'https://pmaymis.gov.in/Open/Find_Beneficiary_Details_FAQ.aspx',
    verifiedOn: '2026-10-31',
    verified: true,
    incomeBands: {
      ewsMaxLakhPerYear: 3,
      ligMinLakhPerYear: 3,
      ligMaxLakhPerYear: 6,
      migMinLakhPerYear: 6,
      migMaxLakhPerYear: 9,
    },
    verticalCeilingsM2: {
      minCarpetAreaM2: 30,
      blcAhpCeilingM2: 45, // Beneficiary-led Construction / Affordable Housing in Partnership
      arhCeilingM2: 60,    // Affordable Rental Housing
      issCeilingM2: 120,   // Interest Subsidy Scheme
    },
    legacyClssNote: 'Legacy PMAY-U (CLSS): EWS ≤ 30 m², LIG ≤ 60 m²',
  },

  // --- SOLAR & PM SURYA GHAR: MUFT BIJLI YOJANA - VERIFIED TRUE ---
  pmSuryaGhar: {
    source: 'MNRE PM Surya Ghar Notification / FAQ 2024',
    clause: null,
    sourceUrl: 'https://pmsuryaghar.gov.in/faq',
    verifiedOn: '2026-10-31',
    verified: true,
    ratePerKwFirst2Kw: 30000,
    ratePerKwThirdKw: 18000,
    maxSubsidyCapInr: 78000,
    maxSubsidyKw: 3,
    notes: 'Central Financial Assistance (CFA). Subsidies: ₹30,000/kW up to 2 kW, ₹18,000 for 3rd kW, ₹78,000 maximum cap.',
  },

  solarAnnualKwhPerKwp: {
    value: 1450,
    unit: 'kWh/kWp/year',
    label: 'Specific Annual Solar Energy Generation Factor',
    source: 'SECI / NISE regional insolation factor',
    clause: null,
    sourceUrl: null,
    verifiedOn: '2026-10-31',
    verified: false,
    notes: 'Average 4.0 Peak Sun Hours (PSH) representative for Central and Western India.',
  } satisfies StandardBenchmark,

  solarTurnkeyCostPerKw: {
    value: 60000,
    unit: 'INR/kW',
    label: 'Rooftop Solar Turnkey Installation Benchmark',
    source: 'Market turnkey survey average',
    clause: null,
    sourceUrl: null,
    verifiedOn: '2026-10-31',
    verified: false,
    notes: 'Estimated turnkey capital expenditure per kWp for residential grid-tied mono-PERC systems.',
  } satisfies StandardBenchmark,

  electricityTariffInrPerKwh: {
    value: 8.5,
    unit: 'INR/kWh',
    label: 'Residential Tier-2 Electricity Slab Tariff',
    source: 'Representative domestic slab tariff estimate',
    clause: null,
    sourceUrl: null,
    verifiedOn: '2026-10-31',
    verified: false,
    notes: 'Estimated composite domestic utility grid rate for 100–300 kWh consumption tiers.',
  } satisfies StandardBenchmark,

  // --- THERMAL & PASSIVE COOLING ---
  standardRoofUValue: {
    value: 2.0,
    unit: 'W/m²K',
    label: 'Standard Uninsulated RCC Roof Slab U-Value',
    source: 'BEE Eco-Niwas Samhita (ENS 2021) baseline slab',
    clause: null,
    sourceUrl: null,
    verifiedOn: '2026-10-31',
    verified: false,
    notes: '150mm cast-in-place concrete slab with screed.',
  } satisfies StandardBenchmark,

  coolRoofUValue: {
    value: 0.5,
    unit: 'W/m²K',
    label: 'High-Performance Insulated Cool Roof U-Value',
    source: 'High-SRI + 50mm insulation board engineering model',
    clause: null,
    sourceUrl: null,
    verifiedOn: '2026-10-31',
    verified: false,
    notes: 'Modeling assumption: 50mm insulation board with high-SRI (≥78) reflective finish.',
  } satisfies StandardBenchmark,

  coolRoofTempDeltaK: {
    value: 15,
    unit: 'K',
    label: 'Peak Solar Heat Conduction Temperature Differential (Delta T)',
    source: 'Peak direct solar surface-to-indoor differential model',
    clause: null,
    sourceUrl: null,
    verifiedOn: '2026-10-31',
    verified: false,
    notes: 'Modeling assumption: Representative afternoon solar surface-to-indoor differential.',
  } satisfies StandardBenchmark,
} as const

// --- EMBODIED CARBON MATERIAL DEFAULTS (kgCO2e per unit) ---
export const EMBODIED_CARBON_DEFAULTS: Record<string, {
  factor: number
  unit: string
  source: string
  clause: string | null
  sourceUrl: string | null
  verifiedOn: string
  verified: boolean
  notes: string
}> = {
  // Flooring
  'ceramic-tile': { factor: 16.0, unit: 'm²', source: 'Market average estimate', clause: null, sourceUrl: null, verifiedOn: '2026-10-31', verified: false, notes: 'Estimated vitrified tile standard cradle-to-gate' },
  'kota-stone': { factor: 6.2, unit: 'm²', source: 'Market average estimate', clause: null, sourceUrl: null, verifiedOn: '2026-10-31', verified: false, notes: 'Estimated natural quarry dressed stone' },
  'granite': { factor: 22.0, unit: 'm²', source: 'Market average estimate', clause: null, sourceUrl: null, verifiedOn: '2026-10-31', verified: false, notes: 'Estimated polished granite slab' },
  'marble': { factor: 19.5, unit: 'm²', source: 'Market average estimate', clause: null, sourceUrl: null, verifiedOn: '2026-10-31', verified: false, notes: 'Estimated cut marble tile' },
  'terrazzo': { factor: 14.0, unit: 'm²', source: 'Market average estimate', clause: null, sourceUrl: null, verifiedOn: '2026-10-31', verified: false, notes: 'Estimated cast terrazzo tile' },
  'wood-flooring': { factor: 12.0, unit: 'm²', source: 'Market average estimate', clause: null, sourceUrl: null, verifiedOn: '2026-10-31', verified: false, notes: 'Estimated engineered wood flooring' },

  // Walls & Masonry
  'red-clay-brick': { factor: 240.0, unit: 'm³', source: 'Market average estimate', clause: null, sourceUrl: null, verifiedOn: '2026-10-31', verified: false, notes: 'Estimated country kiln-fired clay bricks' },
  'fly-ash-brick': { factor: 110.0, unit: 'm³', source: 'Market average estimate', clause: null, sourceUrl: null, verifiedOn: '2026-10-31', verified: false, notes: 'Estimated steam-cured fly ash / lime mix' },
  'aac-blocks': { factor: 95.0, unit: 'm³', source: 'Market average estimate', clause: null, sourceUrl: null, verifiedOn: '2026-10-31', verified: false, notes: 'Estimated autoclaved aerated concrete' },

  // Plaster & Paints
  'acrylic-emulsion': { factor: 3.5, unit: 'm²', source: 'Market average estimate', clause: null, sourceUrl: null, verifiedOn: '2026-10-31', verified: false, notes: 'Estimated 2 coats premium emulsion' },
  'low-voc-distemper': { factor: 0.8, unit: 'm²', source: 'Market average estimate', clause: null, sourceUrl: null, verifiedOn: '2026-10-31', verified: false, notes: 'Estimated traditional mineral lime/distemper' },

  // Doors & Windows
  'flush-door': { factor: 45.0, unit: 'number', source: 'Market average estimate', clause: null, sourceUrl: null, verifiedOn: '2026-10-31', verified: false, notes: 'Estimated composite timber flush door unit' },
  'solid-wood-door': { factor: 65.0, unit: 'number', source: 'Market average estimate', clause: null, sourceUrl: null, verifiedOn: '2026-10-31', verified: false, notes: 'Estimated hardwood framed door unit' },
  'aluminium-window': { factor: 35.0, unit: 'm²', source: 'Market average estimate', clause: null, sourceUrl: null, verifiedOn: '2026-10-31', verified: false, notes: 'Estimated anodized aluminium sliding frame' },
  'upvc-window': { factor: 24.0, unit: 'm²', source: 'Market average estimate', clause: null, sourceUrl: null, verifiedOn: '2026-10-31', verified: false, notes: 'Estimated multi-chamber uPVC profile' },

  // Roof & Waterproofing
  'standard-bitumen': { factor: 12.0, unit: 'm²', source: 'Market average estimate', clause: null, sourceUrl: null, verifiedOn: '2026-10-31', verified: false, notes: 'Estimated multi-layer bitumen waterproofing' },
  'reflective-cool-roof': { factor: 4.5, unit: 'm²', source: 'Market average estimate', clause: null, sourceUrl: null, verifiedOn: '2026-10-31', verified: false, notes: 'Estimated high-SRI elastomer coating' },
}
