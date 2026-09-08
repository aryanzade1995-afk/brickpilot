/* ------------------------------------------------------------------ *
 *  Layout grammar — the real-plan numbers the room engine places to.
 *
 *  `scripts/resplan_layout.py` mines ResPlan (17k real South-Asian
 *  floor plans, CC BY 4.0 — statistics only, no geometry copied) and
 *  writes `scripts/resplan_layout.json`. The scale-invariant values
 *  below are transcribed from that file; refresh after re-running:
 *
 *    python scripts/resplan_layout.py "~/Downloads/archive (2).zip"
 *
 *  The headline finding: the LIVING ROOM is the circulation hub —
 *  front_door→living in 97 % of plans, living↔bedroom in ~100 %,
 *  and there is no dedicated corridor (corridor_share ≈ 0). The room
 *  engine builds every plan around that.
 * ------------------------------------------------------------------ */

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

/** living-room floor-area fraction by bedroom count (p50, ResPlan) */
const LIVING_FRAC: Record<number, number> = { 1: 0.5, 2: 0.4, 3: 0.35, 4: 0.33, 5: 0.32 }

export const GRAMMAR = {
  /** the central hub takes roughly this share of the floor width */
  livingWidthFrac: (beds: number) => clamp(LIVING_FRAC[clamp(beds, 1, 5)] ?? 0.36, 0.3, 0.5),

  /** every one of these room kinds gets a guaranteed door onto the hub
   *  (ResPlan attach-to-living: bed 0.99, kitchen 0.79, common-bath 0.87,
   *  utility 0.52, dining/pooja/study by extension) */
  hubRooms: new Set(['living', 'livingDining', 'dining', 'kitchen', 'utility', 'pooja', 'study']),

  /** an attached bath doors to its bedroom, not the hub (ResPlan bath→bed 0.55) */
  ensuiteToBed: true,

  /** no plan gets a corridor — corridor_share ≈ 0 in ResPlan */
  corridors: false,

  /** minimum clear dims, mm — concept-plan sane, not NBC-strict */
  min: {
    hub: 3200,
    serviceCol: 2900,
    sleepCol: 3300,
    bed: 2700,
    bath: 1500,
    foyer: 1400,
    landing: 2600,
  },
} as const

export type LayoutGrammar = typeof GRAMMAR
