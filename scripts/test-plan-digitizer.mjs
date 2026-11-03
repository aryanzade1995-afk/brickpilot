import test from 'node:test'
import assert from 'node:assert/strict'
import { parseDimension, checkDimensionPlausibility } from '../src/lib/existing/units.ts'
import {
  ManualTraceDigitizer,
  registerDigitizer,
  getDigitizer,
  listDigitizers,
  digitizeWithFallback,
  rawSurveyToSurvey,
  validateImageFile,
} from '../src/lib/existing/digitizer.ts'

test('Units: parseDimension handles metric inputs', () => {
  const m1 = parseDimension('9.1 m')
  assert.equal(m1?.meters, 9.1)
  assert.equal(m1?.unit, 'm')

  const m2 = parseDimension('9100 mm')
  assert.equal(m2?.meters, 9.1)
  assert.equal(m2?.unit, 'mm')

  const m3 = parseDimension('910 cm')
  assert.equal(m3?.meters, 9.1)
  assert.equal(m3?.unit, 'cm')

  const m4 = parseDimension('12.5')
  assert.equal(m4?.meters, 12.5)
  assert.equal(m4?.unit, 'm')
})

test('Units: parseDimension handles imperial inputs', () => {
  const ft1 = parseDimension('30 ft')
  assert.ok(Math.abs((ft1?.meters ?? 0) - 9.144) < 0.001)

  const ft2 = parseDimension("30'")
  assert.ok(Math.abs((ft2?.meters ?? 0) - 9.144) < 0.001)

  const in1 = parseDimension('120 in')
  assert.ok(Math.abs((in1?.meters ?? 0) - 3.048) < 0.001)

  const ftIn1 = parseDimension('9\'6"')
  // 9 ft = 2.7432 m, 6 in = 0.1524 m -> 2.8956 m
  assert.ok(Math.abs((ftIn1?.meters ?? 0) - 2.8956) < 0.001)

  const ftIn2 = parseDimension("9' 6 1/2\"")
  // 9 ft = 2.7432 m, 6.5 in = 0.1651 m -> 2.9083 m
  assert.ok(Math.abs((ftIn2?.meters ?? 0) - 2.9083) < 0.002)
})

test('Units: checkDimensionPlausibility warns on extreme sizes', () => {
  assert.equal(checkDimensionPlausibility(1.2, 'room').plausible, false)
  assert.equal(checkDimensionPlausibility(4.5, 'room').plausible, true)
  assert.equal(checkDimensionPlausibility(25, 'room').plausible, false)

  assert.equal(checkDimensionPlausibility(3, 'plot').plausible, false)
  assert.equal(checkDimensionPlausibility(15, 'plot').plausible, true)

  assert.equal(checkDimensionPlausibility(0.3, 'opening').plausible, false)
  assert.equal(checkDimensionPlausibility(0.9, 'opening').plausible, true)
})

test('Digitizer: registry and fallback', async () => {
  // Manual trace is registered by default
  const list = listDigitizers()
  assert.ok(list.some((d) => d.id === 'manual-trace'))

  const manual = getDigitizer('manual-trace')
  assert.ok(manual instanceof ManualTraceDigitizer)

  // Register custom test adapter
  const mockAdapter = {
    id: 'mock-ai',
    name: 'Mock AI Extractor',
    digitize: async () => ({
      imageWidth: 1000,
      imageHeight: 800,
      elements: {
        rooms: [{ id: 'r1', name: 'Master Bed', type: 'bed', box: { x: 100, y: 100, w: 400, h: 300 }, confidence: 0.95 }],
        walls: [{ id: 'w1', a: { x: 100, y: 100 }, b: { x: 500, y: 100 }, kind: 'exterior', confidence: 0.9 }],
        openings: [{ id: 'o1', kind: 'door', orient: 'h', at: { x: 250, y: 100 }, widthPx: 90, confidence: 0.85 }],
        dimensions: [{ id: 'd1', text: '4.0m', a: { x: 100, y: 90 }, b: { x: 500, y: 90 }, confidence: 0.95 }],
      },
    }),
  }
  registerDigitizer(mockAdapter)

  const active = getDigitizer()
  assert.equal(active.id, 'mock-ai')

  const dummyBlob = new Blob([''], { type: 'image/png' })
  const result = await digitizeWithFallback(dummyBlob)
  assert.equal(result.fallbackUsed, false)
  assert.equal(result.survey.elements.rooms.length, 1)

  // Mapping test: convert RawSurvey to Survey
  const scaleMPerPx = 0.01 // 100px = 1m
  const survey = rawSurveyToSurvey(result.survey, scaleMPerPx)
  assert.equal(survey.rooms.length, 1)
  assert.equal(survey.rooms[0].name, 'Master Bed')
  assert.equal(survey.rooms[0].w, 4.0)
  assert.equal(survey.rooms[0].h, 3.0)
  assert.equal(survey.walls.length, 1)
  assert.equal(survey.walls[0].kind, 'exterior')
  assert.equal(survey.openings.length, 1)
  assert.equal(survey.openings[0].kind, 'door')
})

test('Digitizer: image file validation', () => {
  const validFile = { type: 'image/jpeg', size: 2 * 1024 * 1024 }
  assert.equal(validateImageFile(validFile).valid, true)

  const tooBigFile = { type: 'image/png', size: 12 * 1024 * 1024 }
  assert.equal(validateImageFile(tooBigFile).valid, false)

  const badTypeFile = { type: 'application/pdf', size: 1024 }
  assert.equal(validateImageFile(badTypeFile).valid, false)
})
