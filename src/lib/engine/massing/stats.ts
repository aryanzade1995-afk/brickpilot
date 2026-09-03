/* ------------------------------------------------------------------ *
 *  Dataset-derived parameter ranges for the massing grammar.
 *
 *  `scripts/analyze_datasets.py` mines SYNBUILD-3D-style building models for
 *  distributions (statistics only — no geometry is copied) and writes
 *  `scripts/massing_stats.json`. The scale-invariant ratios below are
 *  transcribed from that file; refresh them after re-running:
 *
 *    python scripts/analyze_datasets.py ~/Downloads/sample_100.zip ...
 *
 *  The current sample is multi-storey residential blocks, not villas, so only
 *  the scale-invariant ratios (footprint solidity, per-floor offset / shrink,
 *  aspect) are taken from it; villa-specific values (courtyard size, verandah
 *  depth, cantilever reach) stay on the hand-tuned defaults in `archetypes.ts`.
 *  Every value is clamped to a safe band so a noisy stat can't destabilise
 *  generation.
 * ------------------------------------------------------------------ */

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

/** raw p50/p90 numbers last transcribed from scripts/massing_stats.json */
const RAW = {
  share_non_rectangular_footprint: 0.19,
  footprint_aspect_p90: 1.93,
  floor_offset_ratio_p90: 0.26,
  floor_shrink_ratio_p10: 0.79,
}

export const STATS = {
  /** fraction of real buildings whose footprint is not a plain rectangle —
   *  the `auto` picker aims its rect / non-rect split at this. */
  nonRectShare: clamp(RAW.share_non_rectangular_footprint, 0.12, 0.45),
  /** how elongated a footprint typically gets (long / short side, 90th pct) */
  aspectP90: clamp(RAW.footprint_aspect_p90, 1.4, 2.6),
  /** an upper storey's centroid shift as a fraction of its span (90th pct) —
   *  the ceiling for `stepped` / `offset-box` moves */
  offsetRatioP90: clamp(RAW.floor_offset_ratio_p90, 0.12, 0.4),
  /** how far an upper storey shrinks relative to the one below (10th pct) —
   *  a soft floor for `upperTarget` when the plot has real slack */
  shrinkRatioLo: clamp(RAW.floor_shrink_ratio_p10, 0.55, 0.9),
} as const

export type MassingStats = typeof STATS
