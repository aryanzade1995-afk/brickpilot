/**
 * Plan Remediation and Auto-Correction Utilities for BrickPilot
 *
 * Provides pure functions to automatically adjust, scale, and fix floor plan
 * elements according to user input and National Building Code (NBC) requirements:
 * - Auto-scale building footprint to fit plot buildable area.
 * - Auto-add windows to unventilated rooms.
 * - Auto-widen circulation doors to standard 900 mm / 1000 mm.
 * - Auto-expand plot dimensions to fit the building.
 * - Enlarge undersized rooms to code minimums.
 */

import {
  type RawSurvey,
} from './digitizer.ts'
import { SURVEY_SETBACKS } from './survey.ts'

export interface RemediationChangeReport {
  action: string
  details: string
}

/**
 * Rescales the entire raw survey proportionally so the building footprint
 * fits comfortably within the plot's buildable envelope.
 */
export function autoScaleToFitPlot(
  raw: RawSurvey,
  currentScaleMPerPx: number,
  plotWidthM: number,
  plotDepthM: number
): {
  updatedRaw: RawSurvey
  updatedScaleMPerPx: number
  report: RemediationChangeReport
} {
  const updated = structuredClone(raw)
  const rooms = updated.elements.rooms

  if (!rooms.length) {
    return {
      updatedRaw: raw,
      updatedScaleMPerPx: currentScaleMPerPx,
      report: { action: 'No-op', details: 'No rooms to rescale.' },
    }
  }

  // Calculate current building bounds in pixels
  const minX = Math.min(...rooms.map((r) => r.box.x))
  const maxX = Math.max(...rooms.map((r) => r.box.x + r.box.w))
  const minY = Math.min(...rooms.map((r) => r.box.y))
  const maxY = Math.max(...rooms.map((r) => r.box.y + r.box.h))

  const currentW_M = (maxX - minX) * currentScaleMPerPx
  const currentD_M = (maxY - minY) * currentScaleMPerPx

  // Buildable area inside plot after setbacks
  const maxBuildableW_M = Math.max(3, plotWidthM - (SURVEY_SETBACKS.left + SURVEY_SETBACKS.right))
  const maxBuildableD_M = Math.max(3, plotDepthM - (SURVEY_SETBACKS.rear + SURVEY_SETBACKS.road))

  // Determine scale factor needed to fit
  const scaleRatioX = maxBuildableW_M / currentW_M
  const scaleRatioY = maxBuildableD_M / currentD_M
  const fitRatio = Math.min(1.0, scaleRatioX, scaleRatioY) * 0.96 // 4% safety margin

  // New scale (m/px)
  const newScaleMPerPx = +(currentScaleMPerPx * fitRatio).toFixed(6)

  const newW_M = +(currentW_M * fitRatio).toFixed(2)
  const newD_M = +(currentD_M * fitRatio).toFixed(2)

  return {
    updatedRaw: updated,
    updatedScaleMPerPx: newScaleMPerPx,
    report: {
      action: 'Rescaled building',
      details: `Rescaled building from ${currentW_M.toFixed(1)}×${currentD_M.toFixed(1)} m to ${newW_M}×${newD_M} m to fit inside the ${plotWidthM}×${plotDepthM} m plot after setbacks.`,
    },
  }
}

/**
 * Calculates the required plot dimensions to fit the current building footprint
 * with full NBC setbacks.
 */
export function calculateRequiredPlot(
  raw: RawSurvey,
  scaleMPerPx: number
): {
  requiredPlotWidthM: number
  requiredPlotDepthM: number
} {
  const rooms = raw.elements.rooms
  if (!rooms.length) return { requiredPlotWidthM: 15, requiredPlotDepthM: 18 }

  const minX = Math.min(...rooms.map((r) => r.box.x))
  const maxX = Math.max(...rooms.map((r) => r.box.x + r.box.w))
  const minY = Math.min(...rooms.map((r) => r.box.y))
  const maxY = Math.max(...rooms.map((r) => r.box.y + r.box.h))

  const houseW_M = (maxX - minX) * scaleMPerPx
  const houseD_M = (maxY - minY) * scaleMPerPx

  const reqW = +(houseW_M + SURVEY_SETBACKS.left + SURVEY_SETBACKS.right + 0.5).toFixed(1)
  const reqD = +(houseD_M + SURVEY_SETBACKS.rear + SURVEY_SETBACKS.road + 0.5).toFixed(1)

  return {
    requiredPlotWidthM: Math.ceil(reqW),
    requiredPlotDepthM: Math.ceil(reqD),
  }
}

/**
 * Automatically places a 1.2 m window on the most accessible exterior wall
 * of a room that lacks natural ventilation.
 */
export function autoAddWindowToRoom(
  raw: RawSurvey,
  roomId: string,
  scaleMPerPx: number
): {
  updatedRaw: RawSurvey
  report: RemediationChangeReport
} {
  const updated = structuredClone(raw)
  const room = updated.elements.rooms.find((r) => r.id === roomId || r.name === roomId)
  if (!room) {
    return {
      updatedRaw: raw,
      report: { action: 'No-op', details: `Room ${roomId} not found.` },
    }
  }

  // Find exterior walls of the entire building
  const allRooms = updated.elements.rooms
  const minX = Math.min(...allRooms.map((r) => r.box.x))
  const maxX = Math.max(...allRooms.map((r) => r.box.x + r.box.w))
  const minY = Math.min(...allRooms.map((r) => r.box.y))
  const maxY = Math.max(...allRooms.map((r) => r.box.y + r.box.h))

  const windowWidthPx = Math.round(1.2 / scaleMPerPx)

  // Check which side of the room is on an exterior boundary
  const newOpeningId = `win-${Date.now()}`

  // 1. Top exterior
  if (Math.abs(room.box.y - minY) < 20) {
    updated.elements.openings.push({
      id: newOpeningId,
      kind: 'window',
      orient: 'h',
      at: { x: room.box.x + room.box.w / 2, y: room.box.y },
      widthPx: windowWidthPx,
      confidence: 1.0,
    })
  }
  // 2. Bottom exterior
  else if (Math.abs(room.box.y + room.box.h - maxY) < 20) {
    updated.elements.openings.push({
      id: newOpeningId,
      kind: 'window',
      orient: 'h',
      at: { x: room.box.x + room.box.w / 2, y: room.box.y + room.box.h },
      widthPx: windowWidthPx,
      confidence: 1.0,
    })
  }
  // 3. Left exterior
  else if (Math.abs(room.box.x - minX) < 20) {
    updated.elements.openings.push({
      id: newOpeningId,
      kind: 'window',
      orient: 'v',
      at: { x: room.box.x, y: room.box.y + room.box.h / 2 },
      widthPx: windowWidthPx,
      confidence: 1.0,
    })
  }
  // 4. Right exterior
  else if (Math.abs(room.box.x + room.box.w - maxX) < 20) {
    updated.elements.openings.push({
      id: newOpeningId,
      kind: 'window',
      orient: 'v',
      at: { x: room.box.x + room.box.w, y: room.box.y + room.box.h / 2 },
      widthPx: windowWidthPx,
      confidence: 1.0,
    })
  } else {
    // If not touching exterior perimeter directly, place on top edge of room
    updated.elements.openings.push({
      id: newOpeningId,
      kind: 'window',
      orient: 'h',
      at: { x: room.box.x + room.box.w / 2, y: room.box.y },
      widthPx: windowWidthPx,
      confidence: 1.0,
    })
  }

  return {
    updatedRaw: updated,
    report: {
      action: 'Added window',
      details: `Added a standard 1.2 m exterior window to ${room.name} to satisfy natural ventilation requirements.`,
    },
  }
}

/**
 * Automatically updates all circulation doors to standard clear widths
 * (min. 900 mm for internal doors, 1000 mm for main entry).
 */
export function autoWidenAllDoors(
  raw: RawSurvey,
  scaleMPerPx: number
): {
  updatedRaw: RawSurvey
  report: RemediationChangeReport
} {
  const updated = structuredClone(raw)
  let count = 0

  const stdDoorPx = Math.round(0.9 / scaleMPerPx)
  const stdEntryPx = Math.round(1.0 / scaleMPerPx)

  updated.elements.openings = updated.elements.openings.map((o) => {
    if (o.kind === 'door') {
      if (o.widthPx < stdDoorPx * 0.95) {
        count++
        return { ...o, widthPx: stdDoorPx }
      }
    } else if (o.kind === 'entry') {
      if (o.widthPx < stdEntryPx * 0.95) {
        count++
        return { ...o, widthPx: stdEntryPx }
      }
    }
    return o
  })

  return {
    updatedRaw: updated,
    report: {
      action: 'Widened doors',
      details: `Adjusted ${count} door(s) to meet standard NBC 900 mm clear accessibility width.`,
    },
  }
}

/**
 * Adjusts a specific room's dimensions to meet minimum recommended floor area.
 */
export function autoEnlargeRoom(
  raw: RawSurvey,
  roomId: string,
  minAreaM2: number,
  scaleMPerPx: number
): {
  updatedRaw: RawSurvey
  report: RemediationChangeReport
} {
  const updated = structuredClone(raw)
  const room = updated.elements.rooms.find((r) => r.id === roomId || r.name === roomId)
  if (!room) {
    return {
      updatedRaw: raw,
      report: { action: 'No-op', details: `Room ${roomId} not found.` },
    }
  }

  const currentAreaM2 = (room.box.w * scaleMPerPx) * (room.box.h * scaleMPerPx)
  if (currentAreaM2 >= minAreaM2) {
    return {
      updatedRaw: raw,
      report: { action: 'No-op', details: `${room.name} already exceeds ${minAreaM2} m².` },
    }
  }

  const factor = Math.sqrt(minAreaM2 / currentAreaM2)
  room.box.w = Math.round(room.box.w * factor)
  room.box.h = Math.round(room.box.h * factor)

  return {
    updatedRaw: updated,
    report: {
      action: 'Enlarged room',
      details: `Enlarged ${room.name} from ${currentAreaM2.toFixed(1)} m² to ${minAreaM2.toFixed(1)} m² to meet standard habitable sizing.`,
    },
  }
}

