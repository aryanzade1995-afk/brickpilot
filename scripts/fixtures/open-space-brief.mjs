import { defaultBrief } from '../../src/lib/model/brief.ts'

/** Same household, rooms, budget and seed for the four comparison drawings. */
export function openSpaceBrief(mode = 'auto') {
  const b = defaultBrief()
  b.site.plotWidth = 18; b.site.plotDepth = 22
  b.site.setbacks = { N: 5, E: 3, S: 3, W: 3 }
  b.site.openSpace = { mode, metres: { N: 5, E: 3, S: 4, W: 3 }, sides: ['E'], amount: 4 }
  b.rooms.priorities.coveredParking = false; b.rooms.priorities.coveredVerandah = false
  b.rooms.balcony = false; b.rooms.pool = true
  b.budget.amountLakh = 180
  return b
}
