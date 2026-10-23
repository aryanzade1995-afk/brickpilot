import type { DrainageFixtureKind } from './drainageInputs.ts'

/** Reviewed subset, not a copy of the entire code or a compliance certificate.
 * No 2025 draft provisions are used. Keep source/edition/clause with each table.
 * Private residential fixture loading only; public/industrial uses unsupported. */
export const DRAINAGE_SOURCES = {
  nbc: { title: 'NBC 2016, Part 9 Section 2', edition: 'SP 7:2016', verified: '2026-10-22', url: 'https://hsamb.org.in/sites/default/files/documents/National%20Building%20Code-2016%20%28Volume-II%29NBC2.pdf' },
  bis: { title: 'BIS: NBC scope and adoption', url: 'https://www.bis.gov.in/standards/national-building-code/?lang=en', verified: '2026-10-22' },
  pune: { title: 'PMC-hosted UDCPR 2020, updated 2022, 12.5–12.6', url: 'https://autodcr.pmc.gov.in/swc.client/Downloads/Building%20regulations%20%26%20related%20notifications/Updated-UDCPR-2022.pdf', verified: '2026-10-22', limitation: 'Reference baseline only. Current amendments, exact jurisdiction and project approval require local review.' },
} as const
export const DRAINAGE_COLORS = { soil: '#8c443a', waste: '#287f91', vent: '#77648b', stormwater: '#3b78b8', building_drain: '#72502e' } as const
export type DrainageService = keyof typeof DRAINAGE_COLORS
export const FIXTURE_RULES: Record<string, { kind: DrainageFixtureKind; label: string; dfu: number; minimumMm: number; clause: string }> = {
  wc_tank: { kind: 'toilet', label: 'Private WC with flush tank', dfu: 3, minimumMm: 100, clause: 'Table 18(xix); 4.5.3.6.1.5(i)(a)' },
  wc_valve: { kind: 'toilet', label: 'Private WC with flush valve', dfu: 4, minimumMm: 100, clause: 'Table 18(xviii); 4.5.3.6.1.5(i)(a)' },
  washbasin: { kind: 'washbasin', label: 'Private washbasin', dfu: 1, minimumMm: 32, clause: 'Table 18(ix); 4.5.3.6.1.5(ii)(b)' },
  shower: { kind: 'shower', label: 'Shower', dfu: 2, minimumMm: 50, clause: 'Table 18(xii), minimum trap 50 mm' },
  bathtub: { kind: 'bathtub', label: 'Domestic bathtub', dfu: 3, minimumMm: 50, clause: 'Table 18(ii); 4.5.3.6.1.5(ii)(f)' },
  kitchen_sink: { kind: 'kitchen_sink', label: 'Domestic kitchen sink', dfu: 2, minimumMm: 40, clause: 'Table 18(xi); 4.5.3.6.1.5(ii)(d)' },
  washing_machine: { kind: 'washing_machine', label: 'Clothes washer', dfu: 3, minimumMm: 50, clause: 'Table 18(v)' },
  floor_drain: { kind: 'floor_drain', label: 'Private floor drain / floor trap outlet', dfu: 1, minimumMm: 75, clause: 'Table 18(viii), note 2; 4.5.3.6.1.5(ii)(h). Catchment adequacy separately unchecked.' },
}
// Table 20, horizontal fixture branches ONLY. Not building drains or stack totals.
export const BRANCH_CAPACITY = [[32, 1], [40, 3], [50, 6], [65, 12], [75, 20], [100, 160], [125, 360], [150, 620]] as const
// Table 21 subset. Columns are slope 1:100, 1:50, 1:25. No extrapolation.
export const BUILDING_CAPACITY = [[75, 36, 42, 50], [100, 180, 216, 250], [125, 390, 480, 575], [150, 700, 840, 1000]] as const
// Table 22 ruling half-full gradients, n=.015 (4.5.3.5.2.5).
export const RULING_GRADIENTS: Record<number, { ratio: number; steepestRatio: number }> = { 100: { ratio: 57, steepestRatio: 5.6 }, 150: { ratio: 100, steepestRatio: 9.7 } }
export const INSPECTION_SPACING = { maximumMm: 45000, upToDiameterMm: 300, reference: 'NBC 2016 P9/S2 4.5.10.2' } as const
export const RULE_REFERENCES = {
  connectivity: 'NBC 2016 P9/S2 3.1.6; 3.2.3; 4.5.2', sizing: 'NBC 2016 P9/S2 4.5.3.5.1, Tables 18, 20, 21',
  gradient: 'NBC 2016 P9/S2 4.5.3.5.2, Table 22', traps: 'NBC 2016 P9/S2 3.1.8; 4.5.3.6.1',
  vent: 'NBC 2016 P9/S2 3.1.8–3.1.9; 4.5.3.4, Table 17', access: 'NBC 2016 P9/S2 3.1.6; 4.5.3.6.3; 4.5.10.1–4.5.10.2',
  structure: 'NBC 2016 P9/S2 4.5.2 (structural review required)', separation: 'Separate sanitary/stormwater policy; NBC 2016 P9/S2 4.5.11–4.5.12; local permission not established',
} as const
