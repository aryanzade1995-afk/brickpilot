/** Reviewed reference subset only. No invented ampacity, diversity or wet-zone tables.
 * NBC numerical checks are conditional on a designer confirming applicability. */
export const ELECTRICAL_SOURCES = {
  nbc: { title: 'NBC 2016 Part 8 Section 2', edition: 'SP 7:2016', date: '2026-10-22', url: 'https://hsamb.org.in/sites/default/files/documents/National%20Building%20Code-2016%20%28Volume-II%29NBC2.pdf', scope: 'Reviewed clauses 5.4.4.1–3, 5.7.1, 6.2, 6.5.1, 8 and 9. Project applicability still needs confirmation.' },
  is732: { title: 'IS 732:2019, fourth revision', edition: '2019; BIS reviewed December 2024', date: '2026-10-22', url: 'https://standards.bis.gov.in/website/standard-details?encryptedId=eyJpdiI6ImpvbGo4cVFET2VSWTgwVnlBU3JkY1E9PSIsInZhbHVlIjoiQytmWjVqR3I5VXJZaTRwY2R0d0Fhdz09IiwibWFjIjoiYzg5NzdhMWE0MWQ5NzBiZDMyYmEzYzRjNjNmMzU0NGU3MDU3YWEzOWJhMDY4N2FkZTUwOWFhNjcyZGRjNTAyZCIsInRhZyI6IiJ9', scope: 'BIS catalogue confirms edition. Detailed ampacity and special-location tables are not encoded; designer must supply the applicable table and conditions.' },
  cea: { title: 'CEA safety regulations 2023 and 2026 amendment', edition: '2023 / 2026', date: '2026-10-22', url: 'https://cea.nic.in/regulations/?lang=en', scope: 'Official listing checked; consolidated amended text not verified here. No statutory-compliance decision is generated.' },
  local: { title: 'MSEDCL contractor test report D-1', edition: 'Official application forms', date: '2026-10-22', url: 'https://dev.mahadiscom.in/en/application-forms/', scope: 'Relevant only where MSEDCL is the supplier. Sanctioned load, supply conditions and current local approvals need confirmation.' },
  protection: { title: 'RDSO / CAMTECH: LV protective devices, Volume 2', edition: 'Government engineering guidance; selection / coordination chapter', date: '2026-10-22', url: 'https://rdso.indianrailways.gov.in/uploads/Safety%20in%20Low%20Voltage%20Installations,%20Vol-2%20Selection%20and%20Application%20of%20LV%20Protective%20Devices.pdf', scope: 'Supports overload coordination equations; not a replacement for residential design or manufacturer data.' },
} as const
export const ELECTRICAL_RULES = {
  mixedLighting: { maxPoints: 10, maxWatts: 800, reference: 'NBC 2016 P8/S2 5.4.4.3 (mixed light/fan/6 A circuit only)' },
  lightsOnly: { maxWatts: 400, reference: 'NBC 2016 P8/S2 5.4.4.3 (dedicated light-fixture circuit)' },
  voltageDrop: { maxTotalPercent: 3, reference: 'NBC 2016 P8/S2 6.2 (consumer terminals to final point)' },
  residualCurrent: { maxMa: 30, reference: 'NBC 2016 P8/S2 5.4.4.1 (residential DB incomer)' },
  sizing: { reference: 'NBC 2016 P8/S2 5.7.1, 6.2, 6.5.1; applicable IS 732:2019 tables required' },
  coordination: { reference: 'Formstead concept review: plan/section coordination; not a statutory separation table' },
  overload: { izMultiplier: 1.45, reference: 'IS 732:2019 4.1.3.6 / 5.2.7; RDSO/CAMTECH LV protection Vol 2, 5.4 (printed p61)' },
  minimumCopper: { lightingMm2: 1.5, powerMm2: 2.5, equipmentOver1KwMm2: 4, reference: 'IS 732:2019 5.2.7.1, Table 33 (RDSO Vol 2 printed p46); NBC 2016 P8/S2 5.4.4.3 / 6.5.1' },
} as const
export const ELECTRICAL_COMMISSIONING = ['Protective-conductor continuity', 'Insulation resistance', 'Polarity', 'Earthing and bonding', 'Fault-loop / disconnection verification', 'RCD / protective-device operation'] as const
