import test from 'node:test'
import assert from 'node:assert/strict'
import { rawSurveyToSurvey } from '../src/lib/existing/digitizer.ts'
import { applyIndianConstructionSnapping } from '../src/lib/existing/snapping.ts'
import { checkNbcHealth } from '../src/lib/existing/nbcPreflight.ts'
import { measuredStructure } from '../src/lib/existing/survey.ts'
import { briefFromAnswers } from '../src/lib/existing/plan.ts'
import { compile } from '../src/lib/model/canonical.ts'
import { generateExisting } from '../src/lib/engine/generateExisting.ts'
import { validate } from '../src/lib/rules/index.ts'

test('Integration: RawSurvey fixture -> Snap -> NBC Check -> measuredStructure -> Valid Canonical Design', () => {
  // Fixture: 1000 x 800 image representing a 10m x 8m house (0.01 m/px)
  const rawSurvey = {
    imageWidth: 1000,
    imageHeight: 800,
    elements: {
      rooms: [
        // Living room on the left
        { id: 'r1', name: 'Living Room', type: 'living', box: { x: 0, y: 0, w: 500, h: 400 }, confidence: 0.95 },
        // Kitchen next to Living
        { id: 'r2', name: 'Kitchen', type: 'kitchen', box: { x: 502, y: 0, w: 300, h: 400 }, confidence: 0.92 },
        // Master Bed behind Living
        { id: 'r3', name: 'Master Bedroom', type: 'bed', box: { x: 0, y: 402, w: 450, h: 398 }, confidence: 0.88 },
        // Bed 2 behind Kitchen
        { id: 'r4', name: 'Bedroom 2', type: 'bed', box: { x: 450, y: 400, w: 350, h: 400 }, confidence: 0.91 },
      ],
      walls: [
        // Exterior perimeter
        { id: 'w1', a: { x: 0, y: 0 }, b: { x: 800, y: 0 }, kind: 'exterior', confidence: 0.95 },
        { id: 'w2', a: { x: 800, y: 0 }, b: { x: 800, y: 800 }, kind: 'exterior', confidence: 0.95 },
        { id: 'w3', a: { x: 800, y: 800 }, b: { x: 0, y: 800 }, kind: 'exterior', confidence: 0.95 },
        { id: 'w4', a: { x: 0, y: 800 }, b: { x: 0, y: 0 }, kind: 'exterior', confidence: 0.95 },
        // Partitions
        { id: 'w5', a: { x: 500, y: 0 }, b: { x: 500, y: 400 }, kind: 'interior', confidence: 0.9 },
        { id: 'w6', a: { x: 0, y: 400 }, b: { x: 800, y: 400 }, kind: 'interior', confidence: 0.9 },
        { id: 'w7', a: { x: 450, y: 400 }, b: { x: 450, y: 800 }, kind: 'interior', confidence: 0.9 },
      ],
      openings: [
        // Main entry door on front exterior wall (y=0)
        { id: 'o1', kind: 'entry', orient: 'h', at: { x: 250, y: 0 }, widthPx: 100, swing: 1, confidence: 0.95 },
        // Living to Kitchen door
        { id: 'o2', kind: 'door', orient: 'v', at: { x: 500, y: 200 }, widthPx: 90, swing: 1, confidence: 0.85 },
        // Living to Master Bed door
        { id: 'o3', kind: 'door', orient: 'h', at: { x: 200, y: 400 }, widthPx: 90, swing: 1, confidence: 0.85 },
        // Living to Bed 2 door
        { id: 'o4', kind: 'door', orient: 'h', at: { x: 600, y: 400 }, widthPx: 90, swing: 1, confidence: 0.85 },
        // Windows on exterior walls
        { id: 'o5', kind: 'window', orient: 'v', at: { x: 0, y: 200 }, widthPx: 120, confidence: 0.9 },
        { id: 'o6', kind: 'window', orient: 'v', at: { x: 0, y: 600 }, widthPx: 120, confidence: 0.9 },
        { id: 'o7', kind: 'window', orient: 'v', at: { x: 800, y: 200 }, widthPx: 120, confidence: 0.9 },
        { id: 'o8', kind: 'window', orient: 'v', at: { x: 800, y: 600 }, widthPx: 120, confidence: 0.9 },
      ],
      dimensions: [
        { id: 'd1', text: '8.0 m', a: { x: 0, y: 0 }, b: { x: 800, y: 0 }, confidence: 0.95 },
      ],
    },
  }

  // 1. Scale calibration: 800 px = 8.0 m -> 0.01 m/px
  const scaleMPerPx = 0.01
  const rawSurveyMetres = rawSurveyToSurvey(rawSurvey, scaleMPerPx)
  assert.equal(rawSurveyMetres.rooms.length, 4)

  // 2. Snapping
  const { snappedSurvey, diff } = applyIndianConstructionSnapping(rawSurveyMetres)
  assert.ok(diff.cornersSnapped >= 1, 'Expected centrelines to snap')
  assert.ok(snappedSurvey.walls.length >= 4, 'Expected walls preserved')

  // 3. NBC Pre-Flight Check
  const answers = {
    plotWidthM: 14,
    plotDepthM: 16,
    roadSide: 'S',
    floorHeightM: 3.0,
    storeysBuilt: 1,
    storeysWanted: 1,
    columnSizeMm: 230,
    beamWidthMm: 230,
    bedroomsWithBath: 1,
    bedroomsNoBath: 1,
    sharedBaths: 1,
    studies: 0,
    parking: false,
    pooja: false,
    utility: false,
  }

  const nbcReport = checkNbcHealth(snappedSurvey, {
    plotWidthM: answers.plotWidthM,
    plotDepthM: answers.plotDepthM,
  })
  assert.equal(nbcReport.hasErrors, false)
  assert.ok(nbcReport.checks.length === 4)

  // 4. measuredStructure
  const asBuilt = measuredStructure(snappedSurvey, answers, true)
  assert.ok(asBuilt.structure.measuredPlan, 'Expected measuredPlan to be created')
  assert.equal(asBuilt.structure.measuredPlan.rooms.length, 4)

  // 5. Downstream pipeline handoff via generateExisting
  const brief = briefFromAnswers(answers)
  const canonicalModel = compile(brief)
  const result = generateExisting(canonicalModel, asBuilt.structure, 1)

  assert.ok(result.design, 'generateExisting must succeed with measuredPlan')
  const design = result.design

  // Downstream validation check: verify hard checks pass
  const validation = validate(design)
  assert.ok(validation.hardChecksPass, 'Downstream design must pass all validation hard checks')
  assert.equal(design.floors[0].rooms.length, 4)
  assert.equal(design.existingStructure?.structure.measuredPlan?.rooms.length, 4)
})

