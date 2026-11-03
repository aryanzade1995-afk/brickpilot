/**
 * Unit & Dimension Parsing Utility for Architectural Plans
 *
 * Robustly parses imperial and metric dimension strings into normalised metres.
 * Supports:
 * - Metric: "9.1 m", "9.1m", "9100 mm", "910 cm", "9.1"
 * - Imperial: "30 ft", "30'", "30 feet", "9'6\"", "9' 6\"", "9 ft 6 in", "120 in", "120\""
 * - Mixed fractions: "9' 6 1/2\"", "30 1/2 ft"
 */

export interface ParsedDimension {
  meters: number
  original: string
  unit: 'm' | 'mm' | 'cm' | 'ft-in' | 'in' | 'ft'
}

const INCH_TO_M = 0.0254
const FOOT_TO_M = 0.3048

/**
 * Parses fractional strings like "1/2", "3/4", "0.5" into a decimal number.
 */
function parseFraction(str: string): number {
  const parts = str.trim().split('/')
  if (parts.length === 2) {
    const num = parseFloat(parts[0])
    const den = parseFloat(parts[1])
    if (!isNaN(num) && !isNaN(den) && den !== 0) {
      return num / den
    }
  }
  const val = parseFloat(str)
  return isNaN(val) ? 0 : val
}

/**
 * Parses a user-supplied dimension string into metres.
 * Returns null if the string cannot be parsed into a positive number.
 */
export function parseDimension(raw: string): ParsedDimension | null {
  if (!raw || typeof raw !== 'string') return null
  const str = raw.trim().toLowerCase()
  if (!str) return null

  // 1. Imperial feet and inches: e.g. 9'6", 9' 6", 9'6 1/2", 9 ft 6 in
  const ftInMatch = str.match(/^(\d+(?:\.\d+)?)\s*(?:'|ft|feet)\s*(?:(\d+)(?:\s+(\d+\/\d+))?|(\d+(?:\.\d+)?))?\s*(?:"|''|in|inch|inches)?$/i)
  if (ftInMatch) {
    const feet = parseFloat(ftInMatch[1])
    let inches = 0
    if (ftInMatch[2] !== undefined) {
      inches = parseFloat(ftInMatch[2]) + (ftInMatch[3] ? parseFraction(ftInMatch[3]) : 0)
    } else if (ftInMatch[4] !== undefined) {
      inches = parseFloat(ftInMatch[4])
    }
    const meters = feet * FOOT_TO_M + inches * INCH_TO_M
    if (meters > 0 && Number.isFinite(meters)) {
      return { meters: +(meters.toFixed(4)), original: raw, unit: 'ft-in' }
    }
  }

  // 2. Pure feet: e.g. "30'", "30 ft", "30.5 feet"
  const ftMatch = str.match(/^(\d+(?:\.\d+)?)\s*(?:'|ft|feet)$/i)
  if (ftMatch) {
    const feet = parseFloat(ftMatch[1])
    const meters = feet * FOOT_TO_M
    if (meters > 0 && Number.isFinite(meters)) {
      return { meters: +(meters.toFixed(4)), original: raw, unit: 'ft' }
    }
  }

  // 3. Pure inches: e.g. "120\"", "120 in", "120 inches"
  const inMatch = str.match(/^(\d+(?:\.\d+)?)\s*(?:"|''|in|inch|inches)$/i)
  if (inMatch) {
    const inches = parseFloat(inMatch[1])
    const meters = inches * INCH_TO_M
    if (meters > 0 && Number.isFinite(meters)) {
      return { meters: +(meters.toFixed(4)), original: raw, unit: 'in' }
    }
  }

  // 4. Millimetres: e.g. "9100 mm", "9100mm"
  const mmMatch = str.match(/^(\d+(?:\.\d+)?)\s*mm$/i)
  if (mmMatch) {
    const mm = parseFloat(mmMatch[1])
    const meters = mm / 1000
    if (meters > 0 && Number.isFinite(meters)) {
      return { meters: +(meters.toFixed(4)), original: raw, unit: 'mm' }
    }
  }

  // 5. Centimetres: e.g. "910 cm", "910cm"
  const cmMatch = str.match(/^(\d+(?:\.\d+)?)\s*cm$/i)
  if (cmMatch) {
    const cm = parseFloat(cmMatch[1])
    const meters = cm / 100
    if (meters > 0 && Number.isFinite(meters)) {
      return { meters: +(meters.toFixed(4)), original: raw, unit: 'cm' }
    }
  }

  // 6. Metres explicitly or naked number: e.g. "9.1 m", "9.1m", "9.1"
  const mMatch = str.match(/^(\d+(?:\.\d+)?)\s*(?:m|meter|meters)?$/i)
  if (mMatch) {
    const meters = parseFloat(mMatch[1])
    if (meters > 0 && Number.isFinite(meters)) {
      return { meters: +(meters.toFixed(4)), original: raw, unit: 'm' }
    }
  }

  return null
}

/**
 * Checks whether a room or plot dimension in metres is plausible for a residential building.
 */
export function checkDimensionPlausibility(meters: number, kind: 'room' | 'plot' | 'opening'): {
  plausible: boolean
  warning?: string
} {
  if (!Number.isFinite(meters) || meters <= 0) {
    return { plausible: false, warning: 'Dimension must be a positive number.' }
  }

  if (kind === 'room') {
    if (meters < 1.5) {
      return { plausible: false, warning: `Dimension (${meters.toFixed(2)} m) is unusually small for a habitable room (min recommended: 1.8 m).` }
    }
    if (meters > 18) {
      return { plausible: false, warning: `Dimension (${meters.toFixed(2)} m) is unusually large for an individual residential room.` }
    }
  } else if (kind === 'plot') {
    if (meters < 4) {
      return { plausible: false, warning: `Plot dimension (${meters.toFixed(2)} m) is narrower than standard residential plots.` }
    }
    if (meters > 100) {
      return { plausible: false, warning: `Plot dimension (${meters.toFixed(2)} m) is unusually large for a single villa plot.` }
    }
  } else if (kind === 'opening') {
    if (meters < 0.5) {
      return { plausible: false, warning: `Opening width (${meters.toFixed(2)} m) is narrower than 500 mm.` }
    }
    if (meters > 4.5) {
      return { plausible: false, warning: `Opening width (${meters.toFixed(2)} m) exceeds standard residential doors/windows.` }
    }
  }

  return { plausible: true }
}
