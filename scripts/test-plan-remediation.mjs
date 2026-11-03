import test from 'node:test'
import assert from 'node:assert/strict'
import {
  autoScaleToFitPlot,
  calculateRequiredPlot,
  autoAddWindowToRoom,
  autoWidenAllDoors,
} from '../src/lib/existing/remediation.ts'
import {
  synthesizeIntelligentPlanFromImage,
  AutomaticDrawingDigitizer,
  getDigitizer,
} from '../src/lib/existing/digitizer.ts'

test('Remediation: autoScaleToFitPlot rescales large building to fit plot envelope', () => {
  const raw = {
    imageWidth: 1000,
    imageHeight: 1000,
    elements: {
      rooms: [
        { id: 'r1', name: 'Big Living', type: 'living', box: { x: 100, y: 100, w: 800, h: 800 }, confidence: 0.9 },
      ],
      walls: [],
      openings: [],
      dimensions: [],
    },
  }

  // Current scale: 100px = 2m -> 800px = 16m wide
  const scale = 0.02
  const plotW = 12
  const plotD = 14

  const res = autoScaleToFitPlot(raw, scale, plotW, plotD)
  // Max buildable width = 12 - 3.0 = 9.0m
  const newWidthM = 800 * res.updatedScaleMPerPx
  assert.ok(newWidthM <= 9.0, `New width ${newWidthM} must fit inside buildable width 9.0m`)
  assert.ok(res.report.action === 'Rescaled building')
})

test('Remediation: calculateRequiredPlot derives minimum plot with NBC setbacks', () => {
  const raw = {
    imageWidth: 1000,
    imageHeight: 1000,
    elements: {
      rooms: [
        { id: 'r1', name: 'Living', type: 'living', box: { x: 0, y: 0, w: 1000, h: 800 }, confidence: 0.9 },
      ],
      walls: [],
      openings: [],
      dimensions: [],
    },
  }

  // 1000px = 10m, 800px = 8m
  const scale = 0.01
  const req = calculateRequiredPlot(raw, scale)
  // House is 10m x 8m. Setbacks: 3.0m sides (1.5*2), 5.6m rear+front (3.3+2.3) -> 13.5m x 14.1m
  assert.ok(req.requiredPlotWidthM >= 13)
  assert.ok(req.requiredPlotDepthM >= 14)
})

test('Remediation: autoAddWindowToRoom adds 1.2m exterior window', () => {
  const raw = {
    imageWidth: 1000,
    imageHeight: 1000,
    elements: {
      rooms: [
        { id: 'r1', name: 'Master Bedroom', type: 'bed', box: { x: 100, y: 100, w: 400, h: 400 }, confidence: 0.9 },
      ],
      walls: [],
      openings: [],
      dimensions: [],
    },
  }

  const scale = 0.01 // 100px = 1m
  const res = autoAddWindowToRoom(raw, 'r1', scale)
  assert.equal(res.updatedRaw.elements.openings.length, 1)
  assert.equal(res.updatedRaw.elements.openings[0].kind, 'window')
  assert.equal(res.updatedRaw.elements.openings[0].widthPx, 120) // 1.2m = 120px
})

test('Remediation: autoWidenAllDoors widens narrow circulation doors to 900mm', () => {
  const raw = {
    imageWidth: 1000,
    imageHeight: 1000,
    elements: {
      rooms: [],
      walls: [],
      openings: [
        { id: 'o1', kind: 'door', orient: 'h', at: { x: 200, y: 200 }, widthPx: 70, swing: 1, confidence: 0.9 }, // 0.7m
        { id: 'o2', kind: 'entry', orient: 'h', at: { x: 500, y: 100 }, widthPx: 80, swing: 1, confidence: 0.9 }, // 0.8m
      ],
      dimensions: [],
    },
  }

  const scale = 0.01 // 100px = 1m
  const res = autoWidenAllDoors(raw, scale)
  assert.equal(res.updatedRaw.elements.openings[0].widthPx, 90) // 0.9m = 90px
  assert.equal(res.updatedRaw.elements.openings[1].widthPx, 100) // 1.0m = 100px
})

test('Automatic Drawing Digitizer: synthesizes full architectural layout when image uploaded', async () => {
  const synthesized = synthesizeIntelligentPlanFromImage(1200, 900)
  assert.ok(synthesized.elements.rooms.length >= 5, 'Must generate full suite of rooms')
  assert.ok(synthesized.elements.walls.length >= 8, 'Must generate exterior & interior walls')
  assert.ok(synthesized.elements.openings.some((o) => o.kind === 'entry'), 'Must generate main entry')
  assert.ok(synthesized.elements.openings.some((o) => o.kind === 'window'), 'Must generate exterior windows')

  // Verify digitizer registry uses AutomaticDrawingDigitizer by default
  const activeDigitizer = getDigitizer()
  assert.ok(activeDigitizer instanceof AutomaticDrawingDigitizer)
})

