import assert from 'node:assert/strict'
import { defaultBrief } from '../../src/lib/model/brief.ts'
import { compile } from '../../src/lib/model/canonical.ts'
import { generate } from '../../src/lib/engine/generate.ts'
import { createBuildingModel } from '../../src/lib/engine/buildingModel.ts'
import { createVillaDesignDNA } from '../../src/lib/engine/villaDesignDna.ts'
import { MassingGenerator } from '../../src/lib/engine/massing/MassingGenerator.ts'
import { ArchitectureValidator } from '../../src/lib/engine/massing/ArchitectureValidator.ts'
import { buildFacadeZones } from '../../src/lib/engine/facade/FacadeGrammar.ts'
import { DEFAULT_GRAMMAR_LIMITS } from '../../src/lib/engine/facade/specialized/types.ts'

// Authored source-plan fixtures: every source coordinate is translated together.
// Extra site margin allows the recipes to be isolated from a tight property's edges.
export function sourceFixture(width = 15, depth = 18, seed = 41, court = false) {
  const brief = defaultBrief(); brief.site.plotWidth = width; brief.site.plotDepth = depth
  brief.rooms.priorities.courtyard = court
  const building = createBuildingModel(generate(compile(brief), { seed, ...(court ? { massing: 'courtyard' } : {}) }))
  const movePoint = (p) => { p.x += 1000; p.y += 1000 }
  const moveRect = movePoint
  for (const f of building.floors) { moveRect(f.outline); f.footprint.forEach(moveRect); if (f.courtyard) moveRect(f.courtyard) }
  building.rooms.forEach(r => moveRect(r.rect)); building.walls.forEach(w => { movePoint(w.a); movePoint(w.b) })
  for (const o of [...building.doors, ...building.windows, ...building.columns]) movePoint(o.at)
  building.beams.forEach(b => { movePoint(b.a); movePoint(b.b) })
  for (const r of [...building.slabs, ...building.shafts, ...building.supportZones]) moveRect(r.rect)
  for (const s of building.stairs) { moveRect(s.rect); s.treads.forEach(line => line.forEach(movePoint)) }
  building.plot.widthMm += 2000; building.plot.depthMm += 2000
  building.plot.buildable.w += 2000; building.plot.buildable.h += 2000
  building.planId += '-margin'
  return building
}
export function context(building, bareRoof = false) {
  const dna = { ...createVillaDesignDNA(building, 41), roofType: 'flat-terrace' }
  const massing = MassingGenerator.generate(building, dna)
  if (bareRoof) massing.masses = massing.masses.filter(m => m.usage !== 'roof')
  massing.architectureReport = ArchitectureValidator.validate(building, massing.masses)
  assert.ok(massing.architectureReport.valid, JSON.stringify(massing.architectureReport.issues))
  const facade = { schemaVersion: 2, sourcePlanId: building.planId, massingSeed: 41,
    architecturalFamily: dna.architecturalFamily, status: 'valid', issues: [], attemptsTried: 0,
    zones: buildFacadeZones(building, massing), features: [] }
  return { building, dna, massing, facade, limits: DEFAULT_GRAMMAR_LIMITS }
}
export function cornerFixture() {
  const b = sourceFixture(), bed = b.rooms.find(r => r.id === 'bed3'), balcony = b.rooms.find(r => r.id === 'balcony1')
  balcony.rect = { x: bed.rect.x, y: bed.rect.y + bed.rect.h, w: bed.rect.w, h: 1500 }
  balcony.area = balcony.rect.w * balcony.rect.h / 1e6
  const door = b.doors.find(d => d.rooms?.includes('balcony1'))
  door.rooms = ['bed3', 'balcony1']; door.at = { x: bed.rect.x + 1100, y: balcony.rect.y }
  const window = b.windows.find(w => w.rooms?.includes('bed3'))
  window.orient = 'v'; window.width = 1000; window.at = { x: bed.rect.x, y: bed.rect.y + bed.rect.h / 2 }
  b.planId += '-corner'
  return b
}
export function sideFixture() {
  const b = sourceFixture(), entry = b.doors.find(d => d.kind === 'entry'), window = b.windows.find(w => w.rooms?.includes('utility'))
  b.doors = b.doors.filter(d => d.id !== entry.id)
  b.doors.push({ ...window, at: { ...window.at }, id: 'GF_SIDE_MAIN_DOOR', kind: 'entry', width: 900, sill: undefined })
  window.at.y -= 1500; window.width = 600
  b.planId += '-side-entry'
  return b
}
export function courtEntryFixture() {
  const b = sourceFixture(25, 25, 41, true)
  const entry = b.doors.find(d => d.kind === 'entry')
  const court = b.rooms.find(r => r.id === 'courtyard')
  const gate = b.doors.find(d => d.rooms?.includes(court.id))
  b.doors = b.doors.filter(d => d.id !== entry.id); gate.kind = 'entry'; b.planId += '-court-entry'
  return b
}
