/**
 * Pre-Flight NBC Health Checker for Existing Drawings
 *
 * Implements the 4-point National Building Code (NBC) inspection badges:
 * 1. Setback fit: Verifies building footprint fits inside plot setbacks.
 * 2. Ventilation: Ensures every habitable room has at least one exterior window/opening.
 * 3. Accessibility: Ensures circulation doors have at least 900 mm clear width.
 * 4. Circulation: Ensures rooms are reachable from entry without crossing private bedrooms.
 *
 * Note: Non-blocking. Returns pass / warn / fail with fix suggestions and offending element IDs.
 */

import { type Survey, SURVEY_SETBACKS } from './survey.ts'

export type HealthStatus = 'pass' | 'warn' | 'fail'

export interface NbcCheckResult {
  id: 'setbacks' | 'ventilation' | 'accessibility' | 'circulation'
  title: string
  status: HealthStatus
  message: string
  suggestion?: string
  offendingRoomIds: string[]
  offendingOpeningIndices: number[]
  assumedPlot?: boolean
}

export interface NbcHealthReport {
  checks: NbcCheckResult[]
  allPass: boolean
  hasErrors: boolean
}

const HABITABLE_TYPES = new Set(['living', 'livingDining', 'dining', 'bed', 'master_bed', 'study'])

/**
 * Runs the 4-point NBC preflight check on a survey.
 */
export function checkNbcHealth(
  survey: Survey,
  opts?: {
    plotWidthM?: number | null
    plotDepthM?: number | null
  }
): NbcHealthReport {
  const checks: NbcCheckResult[] = []

  // Envelope bounds of the building in metres
  const rooms = survey.rooms
  const minX = rooms.length ? Math.min(...rooms.map((r) => r.x)) : 0
  const maxX = rooms.length ? Math.max(...rooms.map((r) => r.x + r.w)) : survey.widthM ?? 0
  const minY = rooms.length ? Math.min(...rooms.map((r) => r.y)) : 0
  const maxY = rooms.length ? Math.max(...rooms.map((r) => r.y + r.h)) : survey.depthM ?? 0

  const houseWidth = +(maxX - minX).toFixed(2)
  const houseDepth = +(maxY - minY).toFixed(2)

  // 1. SETBACK FIT CHECK
  let plotW = opts?.plotWidthM ?? null
  let plotD = opts?.plotDepthM ?? null
  let assumedPlot = false

  if (!plotW || !plotD || plotW <= 0 || plotD <= 0) {
    // Infer default plot with standard setbacks: 1.2m sides, 3.0m rear, 2.0m front
    plotW = +(houseWidth + SURVEY_SETBACKS.left + SURVEY_SETBACKS.right).toFixed(2)
    plotD = +(houseDepth + SURVEY_SETBACKS.rear + SURVEY_SETBACKS.road).toFixed(2)
    assumedPlot = true
  }

  const buildableW = +(plotW - (SURVEY_SETBACKS.left + SURVEY_SETBACKS.right)).toFixed(2)
  const buildableD = +(plotD - (SURVEY_SETBACKS.rear + SURVEY_SETBACKS.road)).toFixed(2)

  if (houseWidth <= buildableW && houseDepth <= buildableD) {
    checks.push({
      id: 'setbacks',
      title: 'Setback fit',
      status: 'pass',
      message: assumedPlot
        ? `Fits assumed plot (${plotW} × ${plotD} m) with standard setbacks (1.2m sides, 3m rear, 2m front).`
        : `Building (${houseWidth} × ${houseDepth} m) fits comfortably inside plot buildable envelope (${buildableW} × ${buildableD} m).`,
      offendingRoomIds: [],
      offendingOpeningIndices: [],
      assumedPlot,
    })
  } else {
    checks.push({
      id: 'setbacks',
      title: 'Setback fit',
      status: 'warn',
      message: `Building (${houseWidth} × ${houseDepth} m) exceeds standard buildable area (${buildableW} × ${buildableD} m) on the ${plotW} × ${plotD} m plot.`,
      suggestion: 'Increase your plot dimensions or scale down the rooms to satisfy municipal setback rules.',
      offendingRoomIds: [],
      offendingOpeningIndices: [],
      assumedPlot,
    })
  }

  // 2. VENTILATION CHECK: Habitable rooms must have at least one exterior opening
  const unventilatedRooms: string[] = []
  const openings = survey.openings

  for (let i = 0; i < rooms.length; i++) {
    const r = rooms[i]
    if (!HABITABLE_TYPES.has(r.type)) continue

    // A room is considered to have exterior ventilation if an opening touches its boundary
    // and is on/near the exterior perimeter (minX, maxX, minY, maxY)
    const touchesOpening = openings.some((o) => {
      // Must be a window or entry door
      if (o.kind !== 'window' && o.kind !== 'entry') return false

      const onPerimeter =
        Math.abs(o.x - minX) < 0.2 ||
        Math.abs(o.x - maxX) < 0.2 ||
        Math.abs(o.y - minY) < 0.2 ||
        Math.abs(o.y - maxY) < 0.2

      if (!onPerimeter) return false

      // Check if opening touches room rectangle
      const nearX = o.x >= r.x - 0.2 && o.x <= r.x + r.w + 0.2
      const nearY = o.y >= r.y - 0.2 && o.y <= r.y + r.h + 0.2
      return nearX && nearY
    })

    if (!touchesOpening) {
      unventilatedRooms.push(r.name || `Room ${i + 1}`)
    }
  }

  if (unventilatedRooms.length === 0) {
    checks.push({
      id: 'ventilation',
      title: 'Natural ventilation',
      status: 'pass',
      message: 'All habitable rooms have direct exterior window ventilation.',
      offendingRoomIds: [],
      offendingOpeningIndices: [],
    })
  } else {
    checks.push({
      id: 'ventilation',
      title: 'Natural ventilation',
      status: 'warn',
      message: `${unventilatedRooms.join(', ')} lacks an exterior window or ventilation opening.`,
      suggestion: 'Add at least one exterior window (min. 1.2 m width recommended) on an external wall.',
      offendingRoomIds: unventilatedRooms,
      offendingOpeningIndices: [],
    })
  }

  // 3. ACCESSIBILITY CHECK: All circulation doors >= 900 mm clear width
  const narrowDoorIndices: number[] = []
  openings.forEach((o, idx) => {
    if (o.kind === 'door' || o.kind === 'entry') {
      const widthM = o.widthM ?? 0.9
      if (widthM < 0.89) {
        narrowDoorIndices.push(idx)
      }
    }
  })

  if (narrowDoorIndices.length === 0) {
    checks.push({
      id: 'accessibility',
      title: 'Clear door accessibility',
      status: 'pass',
      message: 'All circulation doors meet the 900 mm minimum clear width threshold.',
      offendingRoomIds: [],
      offendingOpeningIndices: [],
    })
  } else {
    checks.push({
      id: 'accessibility',
      title: 'Clear door accessibility',
      status: 'warn',
      message: `${narrowDoorIndices.length} door(s) are narrower than 900 mm.`,
      suggestion: 'Widen circulation doorways to 900 mm (1000 mm for main entry) for wheelchair & furniture clearance.',
      offendingRoomIds: [],
      offendingOpeningIndices: narrowDoorIndices,
    })
  }

  // 4. CIRCULATION CHECK: Every room reachable from entry without passing through a private bedroom
  const bedrooms = new Set(rooms.filter((r) => r.type === 'bed').map((r) => r.name))
  const trappedRooms: string[] = []

  // Check if any non-private room is only connected through a bedroom
  // Build room-to-room connectivity graph via doors
  const adj = new Map<string, Set<string>>()
  for (const r of rooms) adj.set(r.name, new Set())

  // Check which doors touch which pairs of rooms
  for (const o of openings.filter((o) => o.kind === 'door')) {
    const touching = rooms.filter(
      (r) => o.x >= r.x - 0.25 && o.x <= r.x + r.w + 0.25 && o.y >= r.y - 0.25 && o.y <= r.y + r.h + 0.25
    )
    if (touching.length >= 2) {
      adj.get(touching[0].name)?.add(touching[1].name)
      adj.get(touching[1].name)?.add(touching[0].name)
    }
  }

  // Identify entry room (touching 'entry' opening, or default living/foyer)
  const entryOpening = openings.find((o) => o.kind === 'entry')
  let entryRoom = rooms.find(
    (r) => entryOpening && entryOpening.x >= r.x - 0.25 && entryOpening.x <= r.x + r.w + 0.25 && entryOpening.y >= r.y - 0.25 && entryOpening.y <= r.y + r.h + 0.25
  )
  if (!entryRoom) entryRoom = rooms.find((r) => r.type === 'foyer' || r.type === 'living') ?? rooms[0]

  if (entryRoom) {
    // BFS traversal without crossing bedrooms (except to reach the bedroom itself)
    const visited = new Set<string>()
    const queue = [entryRoom.name]
    visited.add(entryRoom.name)

    while (queue.length > 0) {
      const curr = queue.shift()!
      // If current is bedroom, do not traverse through it to other rooms (unless it's an attached bath)
      if (bedrooms.has(curr)) continue

      const neighbors = adj.get(curr) ?? new Set()
      for (const n of neighbors) {
        if (!visited.has(n)) {
          visited.add(n)
          queue.push(n)
        }
      }
    }

    for (const r of rooms) {
      if (!visited.has(r.name) && r.type !== 'bath') {
        trappedRooms.push(r.name)
      }
    }
  }

  if (trappedRooms.length === 0) {
    checks.push({
      id: 'circulation',
      title: 'Circulation & privacy',
      status: 'pass',
      message: 'All social and common zones are reachable from entry without crossing private bedrooms.',
      offendingRoomIds: [],
      offendingOpeningIndices: [],
    })
  } else {
    checks.push({
      id: 'circulation',
      title: 'Circulation & privacy',
      status: 'warn',
      message: `${trappedRooms.join(', ')} can only be reached by walking through a private bedroom.`,
      suggestion: 'Add a corridor or doorway connecting directly to the living/lobby area.',
      offendingRoomIds: trappedRooms,
      offendingOpeningIndices: [],
    })
  }

  const allPass = checks.every((c) => c.status === 'pass')
  const hasErrors = checks.some((c) => c.status === 'fail')

  return {
    checks,
    allPass,
    hasErrors,
  }
}

