import test from 'node:test'
import assert from 'node:assert/strict'
import {
  sqmToGuntha,
  gunthaToSqm,
  sqmToSqft,
  calculatePlotFromGuntha,
  SQM_PER_GUNTHA,
} from '../src/lib/existing/units.ts'
import { calculateRequiredPlot } from '../src/lib/existing/remediation.ts'
import { briefFromAnswers } from '../src/lib/existing/plan.ts'

test('Units: Guntha conversions and presets', () => {
  // 1 Guntha = 101.17141 m²
  assert.equal(sqmToGuntha(101.17141), 1)
  assert.equal(sqmToGuntha(202.34), 2)
  assert.equal(gunthaToSqm(1), 101.17)
  assert.equal(sqmToSqft(101.17141), 1089)

  // Calculate plot from 2 Guntha
  const plot = calculatePlotFromGuntha(2, 1.25)
  assert.ok(plot.widthM >= 6 && plot.widthM <= 80)
  assert.ok(plot.depthM >= 6 && plot.depthM <= 80)
  assert.ok(plot.areaM2 >= 180 && plot.areaM2 <= 220)
  assert.ok(plot.areaSqft > 1900)
})

test('Remediation: calculateRequiredPlot includes Guntha and sqft', () => {
  const dummySurvey = {
    imageWidth: 1000,
    imageHeight: 800,
    elements: {
      rooms: [
        { id: 'r1', name: 'Living', box: { x: 100, y: 100, w: 500, h: 400 }, confidence: 0.95 },
      ],
      walls: [],
      doors: [],
      windows: [],
      openings: [],
    },
  }

  const result = calculateRequiredPlot(dummySurvey, 0.02) // 500 * 0.02 = 10m, 400 * 0.02 = 8m
  assert.ok(result.requiredPlotWidthM > 10)
  assert.ok(result.requiredPlotDepthM > 8)
  assert.ok(result.areaM2 > 0)
  assert.ok(result.areaGuntha > 0)
  assert.ok(result.areaSqft > 0)
  assert.equal(result.areaGuntha, +(result.areaM2 / SQM_PER_GUNTHA).toFixed(2))
})

test('Plan: briefFromAnswers applies plinthHeight override', () => {
  const answers = {
    plotWidthM: 15,
    plotDepthM: 18,
    roadSide: 'N',
    storeysBuilt: 1,
    storeysWanted: 1,
    bedroomsWithBath: 2,
    bedroomsNoBath: 1,
    sharedBaths: 1,
    studies: 0,
    parking: true,
    utility: true,
    pooja: true,
  }

  const briefStandard = briefFromAnswers(answers, { plinthHeight: 'standard' })
  assert.equal(briefStandard.specs.overrides['plinth-height'], 'standard')

  const briefRaised = briefFromAnswers(answers, { plinthHeight: 'raised' })
  assert.equal(briefRaised.specs.overrides['plinth-height'], 'raised')

  const briefFlood = briefFromAnswers(answers, { plinthHeight: 'flood' })
  assert.equal(briefFlood.specs.overrides['plinth-height'], 'flood')
})
