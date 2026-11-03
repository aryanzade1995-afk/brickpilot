import test from 'node:test'
import assert from 'node:assert/strict'
import { checkNbcHealth } from '../src/lib/existing/nbcPreflight.ts'

test('NBC Preflight: setback check passes on fitting plot and warns on tight plot', () => {
  const survey = {
    widthM: 8,
    depthM: 10,
    heightM: 3.0,
    plotOffsetXM: 1.2,
    plotOffsetYM: 3.0,
    columns: [],
    footings: [],
    beams: [],
    walls: [],
    rooms: [{ name: 'Living', type: 'living', x: 0, y: 0, w: 8, h: 10 }],
    openings: [],
    notes: [],
  }

  // Generous plot (15 x 20) -> should pass
  const passReport = checkNbcHealth(survey, { plotWidthM: 15, plotDepthM: 20 })
  const setbackPass = passReport.checks.find((c) => c.id === 'setbacks')
  assert.equal(setbackPass?.status, 'pass')

  // Tight plot (9 x 11) -> house is 8x10, buildable is (9-2.4)=6.6 x (11-5)=6 -> should warn
  const warnReport = checkNbcHealth(survey, { plotWidthM: 9, plotDepthM: 11 })
  const setbackWarn = warnReport.checks.find((c) => c.id === 'setbacks')
  assert.equal(setbackWarn?.status, 'warn')
})

test('NBC Preflight: ventilation catches rooms without exterior openings', () => {
  const survey = {
    widthM: 10,
    depthM: 10,
    heightM: 3.0,
    plotOffsetXM: 1.2,
    plotOffsetYM: 3.0,
    columns: [],
    footings: [],
    beams: [],
    walls: [],
    rooms: [
      { name: 'Living Room', type: 'living', x: 0, y: 0, w: 5, h: 5 },
      { name: 'Inner Study', type: 'study', x: 5, y: 5, w: 3, h: 3 }, // habitable without window
    ],
    openings: [
      { x: 2.5, y: 0, kind: 'window', orient: 'h', widthM: 1.2, headM: 2.1, sillM: 0.9, swing: 1, leaf: true, emergencyExit: false },
    ],
    notes: [],
  }

  const report = checkNbcHealth(survey, { plotWidthM: 15, plotDepthM: 15 })
  const ventCheck = report.checks.find((c) => c.id === 'ventilation')
  assert.equal(ventCheck?.status, 'warn')
  assert.ok(ventCheck?.offendingRoomIds.includes('Inner Study'))
})

test('NBC Preflight: accessibility catches doors narrower than 900mm', () => {
  const survey = {
    widthM: 10,
    depthM: 10,
    heightM: 3.0,
    plotOffsetXM: 1.2,
    plotOffsetYM: 3.0,
    columns: [],
    footings: [],
    beams: [],
    walls: [],
    rooms: [{ name: 'Living', type: 'living', x: 0, y: 0, w: 5, h: 5 }],
    openings: [
      { x: 2.5, y: 0, kind: 'door', orient: 'h', widthM: 0.75, headM: 2.1, sillM: null, swing: 1, leaf: true, emergencyExit: false },
    ],
    notes: [],
  }

  const report = checkNbcHealth(survey)
  const accessCheck = report.checks.find((c) => c.id === 'accessibility')
  assert.equal(accessCheck?.status, 'warn')
  assert.ok(accessCheck?.offendingOpeningIndices.includes(0))
})

