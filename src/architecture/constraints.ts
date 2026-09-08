/* ------------------------------------------------------------------ *
 *  GenerationConstraints — the hard limits every generated villa must
 *  respect, whatever the style. A StyleGrammar may tighten (never
 *  loosen) individual values via `grammar.constraints`. The Blender
 *  generator's validator.py checks the same numbers.
 * ------------------------------------------------------------------ */

import type { DesignRequirements, GenerationConstraints } from './types.ts'

/** global defaults — Indian residential, concept-plan sane (not NBC-strict) */
export const DEFAULT_CONSTRAINTS: GenerationConstraints = {
  setbackMinMm: { N: 1200, E: 900, S: 900, W: 900 },
  maxCoverage: 0.65,
  minRoomDimMm: 2400,
  floorHeightMm: [2900, 4200],
  maxFloors: 4,
  minWallSegmentMm: 600,
  window: {
    // window area must not exceed this fraction of the room's exterior wall area
    maxWindowRatio: 0.42,
    minWallBetweenWindowsMm: 600,
    minCornerOffsetMm: 450,
    minDoorWindowDistanceMm: 400,
    maxWindowsPerRoom: 3,
    preferredWindowsPerRoom: 1,
  },
  balcony: { minDepthMm: 1200, maxDepthMm: 2800, minWidthMm: 1500 },
  massing: { maxCantileverMm: 1800, minLinkMm: 1800, maxStoreyOffsetMm: 2400 },
}

const clampLo = (v: number, lo: number) => Math.max(v, lo)

/** merge the global defaults, the style overrides and the brief's real setbacks */
export function resolveConstraints(
  req: DesignRequirements,
  styleOverride?: Partial<GenerationConstraints>,
): GenerationConstraints {
  const d = DEFAULT_CONSTRAINTS
  const s = styleOverride ?? {}
  return {
    // the brief's setbacks win, but never below the style/global minimum
    setbackMinMm: {
      N: clampLo(req.setbacksMm.N, (s.setbackMinMm ?? d.setbackMinMm).N),
      E: clampLo(req.setbacksMm.E, (s.setbackMinMm ?? d.setbackMinMm).E),
      S: clampLo(req.setbacksMm.S, (s.setbackMinMm ?? d.setbackMinMm).S),
      W: clampLo(req.setbacksMm.W, (s.setbackMinMm ?? d.setbackMinMm).W),
    },
    maxCoverage: Math.min(d.maxCoverage, s.maxCoverage ?? d.maxCoverage),
    minRoomDimMm: Math.max(d.minRoomDimMm, s.minRoomDimMm ?? 0),
    floorHeightMm: s.floorHeightMm ?? d.floorHeightMm,
    maxFloors: s.maxFloors ?? d.maxFloors,
    minWallSegmentMm: s.minWallSegmentMm ?? d.minWallSegmentMm,
    window: { ...d.window, ...s.window },
    balcony: { ...d.balcony, ...s.balcony },
    massing: { ...d.massing, ...s.massing },
  }
}
