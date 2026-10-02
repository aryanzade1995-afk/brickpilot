/** Shared architectural limits for the additional element grammar, in mm. */
export const ELEMENT_LIMITS = {
  clearOffsetMm: 180, screenOffsetMm: 350, minimumProjectionMm: 300,
  courtMinimumMm: 3000, minimumCanopyDepthMm: 900,
  postWidthMm: 140, roofHeadroomMm: 2400, roofEdgeDepthMm: 260,
  roofServiceClearanceMm: 300, maximumScreenOcclusion: .35,
  poolAdjacencyMm: 4000, maximumProjectionMm: 2600,
} as const
