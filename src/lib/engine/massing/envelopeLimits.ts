import { MAX_BEAM_SPAN, MAX_CANTILEVER } from '../planner/program.ts'

/** Millimetres, except the bearing ratio. Concept geometry only. */
export const DEFAULT_ENVELOPE_LIMITS = {
  maxRoofHeightMm: 3200, minRoofWidthMm: 500, minRoofSupportRatio: .75, maxRoofProjectionMm: 900,
  minSupportSectionMm: 250, maxSupportHeightMm: 6500, minCanopyClearanceMm: 2700,
  maxCanopyThicknessMm: 300, minCanopyWidthMm: 500, maxCanopySpanMm: MAX_BEAM_SPAN,
  maxCantileverMm: MAX_CANTILEVER,
}
