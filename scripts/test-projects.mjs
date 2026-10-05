import assert from 'node:assert/strict'
import test, { mock } from 'node:test'
import { registerHooks } from 'node:module'
import { defaultBrief } from '../src/lib/model/brief.ts'
import { DEFAULT_DIVERSITY_LIMITS } from '../src/lib/engine/fingerprint/VillaDiversityGate.ts'
import * as O from '../src/lib/plan/ops.ts'

registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) return { url: new URL(`../src/${specifier.slice(2)}`, import.meta.url).href, shortCircuit: true }
  return nextResolve(specifier, context)
} })
const storage = new Map()
globalThis.localStorage = { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) }
globalThis.window = { localStorage: globalThis.localStorage }
mock.method(console, 'debug', () => {})
const { useStudio } = await import('../src/state/studio.ts')
const { useProjects, parseCore, STAGES } = await import('../src/state/projects.ts')

const fresh = () => {
  storage.clear()
  const b = defaultBrief(); b.site.plotWidth = 18; b.site.plotDepth = 24; b.levels.storeys = 1; b.project.name = 'Test villa'
  useStudio.setState({ brief: b, directions: null, pinned: null, result: null, layout: null, existing: null, referencePreferences: null,
    recentExteriorSeeds: [], recentVillaFingerprints: [], diversityLimits: { ...DEFAULT_DIVERSITY_LIMITS }, shapeDebug: [], generationNotice: null })
  useProjects.setState({ items: [], currentId: null, stage: 'concept', lastSavedAt: null, error: null })
  useStudio.getState().run()
}
const P = () => useProjects.getState()
const ground = () => useStudio.getState().result.design.floors[1].rooms.map((r) => [r.id, r.rect])

test('nothing is saved before a design exists; Save then stores plot, plan, 3D data, stage and locks', () => {
  storage.clear()
  useStudio.setState({ result: null, pinned: null })
  useProjects.setState({ items: [], currentId: null })
  assert.equal(P().save(), null)
  P().autoSave()
  assert.equal(P().items.length, 0)

  fresh()
  P().setStage('foundation')
  const lockedLayout = useStudio.getState().applyPlanOp((l) => O.toggleLock(l, 1, 'bed1'))
  assert.ok(lockedLayout.ok, lockedLayout.reason)
  P().setStage('foundation')
  const saved = P().save({ name: 'Sharma villa' })
  assert.ok(saved)
  assert.equal(saved.name, 'Sharma villa')
  assert.equal(saved.core.stage, 'foundation')
  assert.ok(saved.core.layout, 'the 2D layout is saved')
  const s = saved.summary
  assert.deepEqual(s.plot, { widthM: 18, depthM: 24 })
  assert.equal(s.storeys, 1)
  assert.ok(s.design.massing && s.design.planSeed !== undefined, '3D design data is saved')
  assert.ok(s.floors.length === 2 && s.floors[1].rooms.every((r) => r.w > 0 && r.h > 0 && typeof r.areaSqm === 'number'), 'room positions and sizes')
  assert.ok(s.locked.includes('1:bed1'), 'locked elements')
  assert.equal(s.floors[1].rooms.find((r) => r.id === 'bed1').locked, true)
  assert.ok(storage.get('brickpilot.projects.v1'), 'persisted to the device')
})

test('auto-save keeps the open project current, creating a draft the first time', () => {
  fresh()
  P().autoSave()
  assert.equal(P().items.length, 1)
  assert.equal(P().items[0].draft, true)
  const id = P().currentId
  useStudio.getState().applyPlanOp((l, p) => O.deleteRoom(l, p, 1, 'study1'))
  P().autoSave('Deleted Study / office 1')
  assert.equal(P().items.length, 1, 'same project')
  assert.equal(P().currentId, id)
  assert.ok(P().items[0].core.layout)
  assert.equal(P().items[0].versions[0].label, 'Deleted Study / office 1')
  // an unchanged state writes nothing new
  const count = P().items[0].versions.length
  P().autoSave('again')
  assert.equal(P().items[0].versions.length, count)
  // plain auto-saves within two minutes replace each other instead of piling up
  useStudio.getState().applyPlanOp((l) => O.toggleLock(l, 1, 'bed1'))
  P().autoSave()
  const n = P().items[0].versions.length
  useStudio.getState().applyPlanOp((l) => O.toggleLock(l, 1, 'bed2'))
  P().autoSave()
  assert.equal(P().items[0].versions.length, n)
})

test('open, rename, duplicate and delete', () => {
  fresh()
  P().save({ name: 'One' })
  const id = P().items[0].id
  P().rename(id, '  Renamed  ')
  assert.equal(P().items[0].name, 'Renamed')
  const copyId = P().duplicate(id)
  assert.equal(P().items.length, 2)
  const copy = P().items.find((p) => p.id === copyId)
  assert.equal(copy.name, 'Renamed (copy)')
  assert.notEqual(copy.id, id)
  assert.deepEqual(copy.core.brief, P().items.find((p) => p.id === id).core.brief)
  // editing the copy does not touch the original
  P().open(copyId)
  useStudio.getState().run()
  useStudio.getState().applyPlanOp((l, p) => O.deleteRoom(l, p, 1, 'study1'))
  P().save()
  assert.equal(P().items.find((p) => p.id === id).core.layout, null)
  assert.ok(P().items.find((p) => p.id === copyId).core.layout)
  // opening the original restores the unedited plan; the working state follows
  P().open(id)
  const r = useStudio.getState().run()
  assert.ok(r.design.floors[1].rooms.some((x) => x.id === 'study1'))
  assert.equal(useStudio.getState().layout, null)
  P().remove(copyId)
  assert.equal(P().items.length, 1)
  P().remove(id)
  assert.equal(P().items.length, 0)
  assert.equal(P().currentId, null)
})

test('version history restores an earlier plan, and the restore itself can be undone', () => {
  fresh()
  P().save({ name: 'History', label: 'First save' })
  const id = P().currentId
  const original = ground()
  useStudio.getState().applyPlanOp((l, p) => O.deleteRoom(l, p, 1, 'study1'))
  P().save({ label: 'Removed the study' })
  const edited = ground()
  assert.notDeepEqual(edited, original)
  const versions = P().items[0].versions
  assert.deepEqual(versions.map((v) => v.label).slice(0, 2), ['Removed the study', 'First save'])
  const first = versions.find((v) => v.label === 'First save')
  assert.ok(P().restore(id, first.id))
  assert.deepEqual(ground(), original)
  assert.equal(useStudio.getState().layout, null)
  assert.equal(P().items[0].versions[0].label, 'Before restore')
  // restore the "before restore" state: the edit comes back exactly
  assert.ok(P().restore(id, P().items[0].versions[0].id))
  assert.deepEqual(ground(), edited)
})

test('history is capped and a corrupt store is ignored, not trusted', () => {
  fresh()
  P().save({ name: 'Cap' })
  for (let i = 0; i < 30; i++) { useStudio.getState().applyPlanOp((l) => O.toggleLock(l, 1, 'bed1')); P().save({ label: `v${i}` }) }
  assert.ok(P().items[0].versions.length <= 20)
  assert.equal(parseCore({ brief: 'not a brief' }), null)
  assert.equal(parseCore(null), null)
  assert.ok(STAGES.length >= 6 && STAGES.some((s) => s.id === 'foundation'))
  assert.equal(parseCore({ brief: useStudio.getState().brief, stage: 'bogus', layout: { version: 1, signature: 1 } }).stage, 'concept')
})
