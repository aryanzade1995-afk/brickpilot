/**
 * Automatic Indian Construction Snapping Engine
 *
 * Implements architectural alignment, centreline snapping, angle orthogonalization,
 * structural thickness assignment (230 mm exterior, 115 mm interior), and opening
 * standardisation according to Indian residential building conventions.
 */

import { type Survey, SURVEY_DEFAULTS, withDefaults } from './survey.ts'

export interface SnappingOptions {
  centrelineToleranceM?: number // Default: 0.075 m (75 mm)
  angularToleranceDeg?: number // Default: 5 degrees
  gapClosureToleranceM?: number // Default: 0.10 m (100 mm)
  exteriorWallThicknessMm?: number // Default: 230 mm
  interiorWallThicknessMm?: number // Default: 115 mm
}

export interface SnappingDiff {
  cornersSnapped: number
  anglesStraightened: number
  gapsClosed: number
  wallsAdjusted: number
  openingsAligned: number
  summary: string
}

export interface SnappingOutcome {
  originalSurvey: Survey
  snappedSurvey: Survey
  diff: SnappingDiff
}

const DEFAULT_OPTIONS: Required<SnappingOptions> = {
  centrelineToleranceM: 0.075,
  angularToleranceDeg: 5.0,
  gapClosureToleranceM: 0.10,
  exteriorWallThicknessMm: 230,
  interiorWallThicknessMm: 115,
}

function cluster1D(values: number[], tolerance: number): Map<number, number> {
  const sorted = [...new Set(values)].sort((a, b) => a - b)
  const map = new Map<number, number>()
  if (!sorted.length) return map

  let cluster: number[] = [sorted[0]]
  for (let i = 1; i < sorted.length; i++) {
    const val = sorted[i]
    if (val - cluster[0] <= tolerance) {
      cluster.push(val)
    } else {
      const avg = +(cluster.reduce((a, b) => a + b, 0) / cluster.length).toFixed(3)
      for (const v of cluster) map.set(v, avg)
      cluster = [val]
    }
  }
  if (cluster.length) {
    const avg = +(cluster.reduce((a, b) => a + b, 0) / cluster.length).toFixed(3)
    for (const v of cluster) map.set(v, avg)
  }
  return map
}

/**
 * Executes the automatic Indian construction snapping and repair rules.
 */
export function applyIndianConstructionSnapping(
  survey: Survey,
  opts?: SnappingOptions
): SnappingOutcome {
  const config = { ...DEFAULT_OPTIONS, ...opts }
  let cornersSnapped = 0
  let anglesStraightened = 0
  let gapsClosed = 0
  let wallsAdjusted = 0
  let openingsAligned = 0

  // Clone input
  const original = structuredClone(survey)

  // 1. Straighten wobbly wall angles within angular tolerance
  // Angular tolerance 5 deg -> tan(5 deg) ~ 0.0875
  const maxTan = Math.tan((config.angularToleranceDeg * Math.PI) / 180)

  let walls = original.walls.map((w) => {
    const dx = Math.abs(w.b.x - w.a.x)
    const dy = Math.abs(w.b.y - w.a.y)

    // Check if nearly horizontal
    if (dx > 0 && dy / dx <= maxTan && dy > 0) {
      anglesStraightened++
      return { ...w, b: { ...w.b, y: w.a.y } }
    }
    // Check if nearly vertical
    if (dy > 0 && dx / dy <= maxTan && dx > 0) {
      anglesStraightened++
      return { ...w, b: { ...w.b, x: w.a.x } }
    }
    return w
  })

  // 2. Snap neighbouring room boundaries and wall endpoints to shared centrelines
  const allX: number[] = []
  const allY: number[] = []

  for (const w of walls) {
    allX.push(w.a.x, w.b.x)
    allY.push(w.a.y, w.b.y)
  }
  for (const r of original.rooms) {
    allX.push(r.x, r.x + r.w)
    allY.push(r.y, r.y + r.h)
  }

  const mapX = cluster1D(allX, config.centrelineToleranceM)
  const mapY = cluster1D(allY, config.centrelineToleranceM)

  // Apply snapping to walls
  walls = walls.map((w) => {
    const snapAx = mapX.get(w.a.x) ?? w.a.x
    const snapAy = mapY.get(w.a.y) ?? w.a.y
    const snapBx = mapX.get(w.b.x) ?? w.b.x
    const snapBy = mapY.get(w.b.y) ?? w.b.y

    if (snapAx !== w.a.x || snapAy !== w.a.y || snapBx !== w.b.x || snapBy !== w.b.y) {
      cornersSnapped++
    }
    return {
      ...w,
      a: { x: snapAx, y: snapAy },
      b: { x: snapBx, y: snapBy },
    }
  })

  // Apply snapping to rooms
  const rooms = original.rooms.map((r) => {
    const snapX0 = mapX.get(r.x) ?? r.x
    const snapY0 = mapY.get(r.y) ?? r.y
    const snapX1 = mapX.get(r.x + r.w) ?? r.x + r.w
    const snapY1 = mapY.get(r.y + r.h) ?? r.y + r.h

    const w = +(snapX1 - snapX0).toFixed(3)
    const h = +(snapY1 - snapY0).toFixed(3)

    if (snapX0 !== r.x || snapY0 !== r.y || w !== r.w || h !== r.h) {
      cornersSnapped++
    }
    return {
      ...r,
      x: snapX0,
      y: snapY0,
      w: w > 0 ? w : r.w,
      h: h > 0 ? h : r.h,
    }
  })

  // 3. Close small gaps between wall endpoints (< gapClosureToleranceM)
  for (let i = 0; i < walls.length; i++) {
    for (let j = 0; j < walls.length; j++) {
      if (i === j) continue
      const w1 = walls[i]
      const w2 = walls[j]

      // Check w1.b against w2.a
      const distBA = Math.hypot(w1.b.x - w2.a.x, w1.b.y - w2.a.y)
      if (distBA > 0 && distBA <= config.gapClosureToleranceM) {
        // Prefer preserving orthogonal coordinates
        if (w1.a.y === w1.b.y) {
          // w1 is horizontal, so keep w1.b.y and snap w2.a to it
          w2.a.y = w1.b.y
          w1.b.x = w2.a.x
        } else if (w1.a.x === w1.b.x) {
          // w1 is vertical, so keep w1.b.x and snap w2.a to it
          w2.a.x = w1.b.x
          w1.b.y = w2.a.y
        } else {
          w2.a.x = w1.b.x
          w2.a.y = w1.b.y
        }
        gapsClosed++
      }

      // Check w1.b against w2.b
      const distBB = Math.hypot(w1.b.x - w2.b.x, w1.b.y - w2.b.y)
      if (distBB > 0 && distBB <= config.gapClosureToleranceM) {
        if (w1.a.y === w1.b.y) {
          w2.b.y = w1.b.y
          w1.b.x = w2.b.x
        } else if (w1.a.x === w1.b.x) {
          w2.b.x = w1.b.x
          w1.b.y = w2.b.y
        } else {
          w2.b.x = w1.b.x
          w2.b.y = w1.b.y
        }
        gapsClosed++
      }
    }
  }

  // Filter out zero-length walls created by snapping
  walls = walls.filter((w) => !(w.a.x === w.b.x && w.a.y === w.b.y))

  // 4. Assign structural thickness: 230 mm exterior perimeter, 115 mm interior partitions
  // Determine exterior envelope bounding box
  const minX = rooms.length ? Math.min(...rooms.map((r) => r.x)) : 0
  const maxX = rooms.length ? Math.max(...rooms.map((r) => r.x + r.w)) : 0
  const minY = rooms.length ? Math.min(...rooms.map((r) => r.y)) : 0
  const maxY = rooms.length ? Math.max(...rooms.map((r) => r.y + r.h)) : 0

  walls = walls.map((w) => {
    const isPerimeter =
      (Math.abs(w.a.x - minX) < 0.05 && Math.abs(w.b.x - minX) < 0.05) ||
      (Math.abs(w.a.x - maxX) < 0.05 && Math.abs(w.b.x - maxX) < 0.05) ||
      (Math.abs(w.a.y - minY) < 0.05 && Math.abs(w.b.y - minY) < 0.05) ||
      (Math.abs(w.a.y - maxY) < 0.05 && Math.abs(w.b.y - maxY) < 0.05) ||
      w.kind === 'exterior'

    const targetThickness = isPerimeter ? config.exteriorWallThicknessMm : config.interiorWallThicknessMm
    const targetKind: 'exterior' | 'interior' = isPerimeter ? 'exterior' : 'interior'

    if (w.thicknessMm !== targetThickness || w.kind !== targetKind) {
      wallsAdjusted++
    }

    return {
      ...w,
      kind: targetKind,
      thicknessMm: targetThickness,
    }
  })

  // 5. Align openings to nearest wall centrelines and enforce standard dimensions
  let openings = original.openings.map((o) => {
    let atX = o.x
    let atY = o.y
    let orient = o.orient

    // Find closest wall
    let closestWall: (typeof walls)[number] | null = null
    let minDist = Infinity

    for (const w of walls) {
      const isH = w.a.y === w.b.y
      const dist = isH
        ? Math.abs(o.y - w.a.y) + (o.x < Math.min(w.a.x, w.b.x) - 0.2 || o.x > Math.max(w.a.x, w.b.x) + 0.2 ? 10 : 0)
        : Math.abs(o.x - w.a.x) + (o.y < Math.min(w.a.y, w.b.y) - 0.2 || o.y > Math.max(w.a.y, w.b.y) + 0.2 ? 10 : 0)

      if (dist < minDist) {
        minDist = dist
        closestWall = w
      }
    }

    if (closestWall && minDist < 0.3) {
      if (closestWall.a.y === closestWall.b.y) {
        // Horizontal wall
        if (atY !== closestWall.a.y || orient !== 'h') openingsAligned++
        atY = closestWall.a.y
        orient = 'h'
      } else {
        // Vertical wall
        if (atX !== closestWall.a.x || orient !== 'v') openingsAligned++
        atX = closestWall.a.x
        orient = 'v'
      }
    }

    const headM = o.headM ?? (o.kind === 'window' ? SURVEY_DEFAULTS.windowHeadM : SURVEY_DEFAULTS.doorHeadM)
    const sillM = o.kind === 'window' ? o.sillM ?? SURVEY_DEFAULTS.windowSillM : null
    const widthM = o.widthM ?? (o.kind === 'window' ? 1.2 : o.kind === 'entry' ? 1.0 : 0.9)

    return {
      ...o,
      x: atX,
      y: atY,
      orient,
      headM,
      sillM,
      widthM,
    }
  })

  // Ensure at least one exterior opening is marked 'entry'
  const hasEntry = openings.some((o) => o.kind === 'entry')
  if (!hasEntry && openings.some((o) => o.kind === 'door')) {
    // Pick the door on the exterior perimeter or the first door
    let entryDoorIdx = openings.findIndex((o) => {
      return (
        o.kind === 'door' &&
        (Math.abs(o.x - minX) < 0.1 || Math.abs(o.x - maxX) < 0.1 || Math.abs(o.y - minY) < 0.1 || Math.abs(o.y - maxY) < 0.1)
      )
    })
    if (entryDoorIdx === -1) entryDoorIdx = openings.findIndex((o) => o.kind === 'door')
    if (entryDoorIdx !== -1) {
      openings[entryDoorIdx] = {
        ...openings[entryDoorIdx],
        kind: 'entry',
        widthM: Math.max(openings[entryDoorIdx].widthM ?? 0.9, 1.0),
      }
      openingsAligned++
    }
  }

  // Run withDefaults to populate columns at corners and ensure structural integrity
  const preFilled: Survey = {
    ...original,
    walls,
    rooms,
    openings,
  }
  const snappedSurvey = withDefaults(preFilled)

  // Construct readable diff summary
  const summaryParts: string[] = []
  if (cornersSnapped > 0) summaryParts.push(`${cornersSnapped} corners snapped`)
  if (anglesStraightened > 0) summaryParts.push(`${anglesStraightened} angles straightened`)
  if (gapsClosed > 0) summaryParts.push(`${gapsClosed} gaps closed`)
  if (wallsAdjusted > 0) summaryParts.push(`${wallsAdjusted} walls set to 230/115 mm`)
  if (openingsAligned > 0) summaryParts.push(`${openingsAligned} openings aligned to centrelines`)

  const summary = summaryParts.length
    ? summaryParts.join(', ') + '.'
    : 'All walls and rooms are already orthogonal and aligned.'

  return {
    originalSurvey: original,
    snappedSurvey,
    diff: {
      cornersSnapped,
      anglesStraightened,
      gapsClosed,
      wallsAdjusted,
      openingsAligned,
      summary,
    },
  }
}
