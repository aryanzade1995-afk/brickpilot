import test from 'node:test'
import assert from 'node:assert/strict'
import { applyIndianConstructionSnapping } from '../src/lib/existing/snapping.ts'
import { SURVEY_DEFAULTS } from '../src/lib/existing/survey.ts'

test('Snapping: straightens wobbly angles within tolerance', () => {
  const survey = {
    widthM: 10,
    depthM: 8,
    heightM: 3.0,
    plotOffsetXM: 1.2,
    plotOffsetYM: 3.0,
    columns: [],
    footings: [],
    beams: [],
    walls: [
      // Nearly horizontal wall: dx = 6.0, dy = 0.1 (tan ~ 0.016 <= tan 5 deg ~ 0.087)
      { a: { x: 0, y: 0 }, b: { x: 6, y: 0.1 }, thicknessMm: 230, kind: 'exterior' },
      // Nearly vertical wall: dx = 0.08, dy = 5.0
      { a: { x: 6, y: 0.1 }, b: { x: 6.08, y: 5 }, thicknessMm: 230, kind: 'exterior' },
    ],
    rooms: [],
    openings: [],
    notes: [],
  }

  const result = applyIndianConstructionSnapping(survey)
  assert.ok(result.diff.anglesStraightened >= 1)
  assert.equal(result.snappedSurvey.walls[0].b.y, 0) // straightened to horizontal
})

test('Snapping: snaps room boundaries to shared centrelines', () => {
  const survey = {
    widthM: 10,
    depthM: 8,
    heightM: 3.0,
    plotOffsetXM: 1.2,
    plotOffsetYM: 3.0,
    columns: [],
    footings: [],
    beams: [],
    walls: [],
    rooms: [
      // Room 1 right edge is at x=4.02
      { name: 'Living', type: 'living', x: 0, y: 0, w: 4.02, h: 4 },
      // Room 2 left edge is at x=4.00 (within 75mm of 4.02)
      { name: 'Kitchen', type: 'kitchen', x: 4.00, y: 0, w: 3, h: 4 },
    ],
    openings: [],
    notes: [],
  }

  const result = applyIndianConstructionSnapping(survey)
  assert.ok(result.diff.cornersSnapped >= 1)
  const livingRight = result.snappedSurvey.rooms[0].x + result.snappedSurvey.rooms[0].w
  const kitchenLeft = result.snappedSurvey.rooms[1].x
  assert.ok(Math.abs(livingRight - kitchenLeft) < 0.001)
})

test('Snapping: assigns 230mm exterior and 115mm interior walls', () => {
  const survey = {
    widthM: 8,
    depthM: 8,
    heightM: 3.0,
    plotOffsetXM: 1.2,
    plotOffsetYM: 3.0,
    columns: [],
    footings: [],
    beams: [],
    walls: [
      { a: { x: 0, y: 0 }, b: { x: 8, y: 0 }, thicknessMm: null, kind: 'exterior' },
      { a: { x: 4, y: 0 }, b: { x: 4, y: 8 }, thicknessMm: null, kind: 'interior' },
    ],
    rooms: [
      { name: 'Bed 1', type: 'bed', x: 0, y: 0, w: 4, h: 8 },
      { name: 'Bed 2', type: 'bed', x: 4, y: 0, w: 4, h: 8 },
    ],
    openings: [],
    notes: [],
  }

  const result = applyIndianConstructionSnapping(survey)
  assert.ok(result.diff.wallsAdjusted >= 1)
  const extWall = result.snappedSurvey.walls.find((w) => w.kind === 'exterior')
  const intWall = result.snappedSurvey.walls.find((w) => w.kind === 'interior')
  assert.equal(extWall?.thicknessMm, 230)
  assert.equal(intWall?.thicknessMm, 115)
})
