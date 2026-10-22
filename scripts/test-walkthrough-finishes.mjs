import test from 'node:test'
import assert from 'node:assert/strict'
import { defaultBrief } from '../src/lib/model/brief.ts'
import { compile } from '../src/lib/model/canonical.ts'
import { generate } from '../src/lib/engine/generate.ts'
import { createBuildingModel } from '../src/lib/engine/buildingModel.ts'
import { createFinishAssignments } from '../src/lib/cost/finishAssignments.ts'
import { estimateBoq } from '../src/lib/cost/boq.ts'
import { estimateProjectBoq } from '../src/lib/cost/index.ts'
import { projectFinishBrief } from '../src/lib/cost/briefSelections.ts'
import { defaultSelection } from '../src/lib/cost/specifications.ts'
import { specsCatalogue, resolveSpecification } from '../src/lib/cost/catalogue.ts'
import { createWalkthroughSource } from '../src/lib/walkthrough/source.ts'
import { buildWalkthroughScene } from '../src/lib/walkthrough/scene.ts'
import { prepareWalkthroughGeometry, prepareWalkthroughAppearance } from '../src/lib/walkthrough/delivery.ts'
import { validate } from '../src/lib/rules/index.ts'
import { Group, Mesh, BoxGeometry, MeshStandardMaterial } from 'three'
import { applyWalkthroughMaterialBindings, disposeWalkthroughAsset } from '../src/lib/three/loadWalkthroughAsset.ts'
import { buildWalkthroughAppearanceGroup, walkthroughFurnishingGeometryKey, prepareWalkthroughAppearanceUpdate } from '../src/lib/three/walkthroughAppearance.ts'
import { readWalkthroughSession, saveWalkthroughSession } from '../src/lib/walkthrough/assetSession.ts'

const brief = defaultBrief(); brief.site.plotWidth = 18; brief.site.plotDepth = 24
const design = generate(compile(brief), { seed: 41 })
const preferences = { style: 'modern', lighting: 'daylight', furnitureDensity: 'medium' }
const source = createWalkthroughSource(design, validate(design), preferences)
const geometry = prepareWalkthroughGeometry(buildWalkthroughScene(source.building, validate(design)))
const appearance = d => prepareWalkthroughAppearance(d, createWalkthroughSource(d, validate(d), preferences), geometry)
const original = appearance(design)
test('delivery handles remain project/structure scoped without storing a second selection system', () => {
  const record = { id: 'a'.repeat(64), designId: 'house', projectId: 'one', geometryKey: 'geom', appearanceKey: 'look', status: 'ready', signature: 'finish-snapshot' }
  saveWalkthroughSession('one', 'geom', record)
  assert.deepEqual(readWalkthroughSession('one', 'geom'), record)
  assert.equal(readWalkthroughSession('two', 'geom'), null); assert.equal(readWalkthroughSession('one', 'other'), null)
  assert.ok(!('selections' in readWalkthroughSession('one', 'geom')))
})
const target = source.rooms.find(r => geometry.faces.some(f => f.roomId === r.key && JSON.parse(f.binding)[2] === 'floor'))
const changed = overrides => { const d = structuredClone(design); d.model.brief.specs.overrides = { ...d.model.brief.specs.overrides, ...overrides }; return d }

test('room-only floor and paint edits match cost assignments, preserve quantities/architecture and leave other rooms untouched', () => {
  const assignments = createFinishAssignments(design), roomAssignments = assignments.rooms.find(r => r.id === target.finishRoomKey)
  const floorItem = roomAssignments.finishes.find(f => /^floor-/.test(f.item)).item
  const option = specsCatalogue.items.find(i => i.id === floorItem).options.find(o => o.id !== resolveSpecification(brief, floorItem).id && o.flooringProductId)
  assert.ok(option)
  const d = changed({ [`${floorItem}@${target.finishRoomKey}`]: option.id, [`interior-paint-colour@${target.finishRoomKey}`]: '#123456' }), result = appearance(d)
  const floorKey = JSON.stringify([target.floorId, target.key, 'floor']), wallKey = JSON.stringify([target.floorId, target.key, 'wall'])
  assert.notDeepEqual(result.bindings[floorKey], original.bindings[floorKey]); assert.equal(result.bindings[wallKey].color, '#123456')
  for (const f of geometry.faces.filter(f => f.roomId !== target.key)) assert.deepEqual(result.bindings[f.binding], original.bindings[f.binding])
  for (const r of original.specifications.filter(r => r.roomId !== target.key)) assert.deepEqual(result.specifications.find(n => n.roomId === r.roomId), r)
  assert.equal(result.specifications.find(r => r.roomId === target.key).selections.find(s => s.item === floorItem).optionId, option.id)
  assert.equal(createFinishAssignments(d).rooms.find(r => r.id === target.finishRoomKey).finishes.find(f => f.item === floorItem).option, option.id)
  assert.deepEqual(estimateBoq(d).quantities, estimateBoq(design).quantities)
  assert.equal(createBuildingModel(d).planId, source.building.planId)
  assert.deepEqual(prepareWalkthroughGeometry(buildWalkthroughScene(createBuildingModel(d), validate(d))), geometry)
})

test('save/reload uses the existing Brief overrides; visual allowance exemplars do not replace cost option IDs', () => {
  const d = changed({ [`interior-paint-colour@${target.finishRoomKey}`]: '#AEBDCA' }), before = JSON.stringify(d)
  assert.deepEqual(appearance(JSON.parse(before)), appearance(d)); assert.equal(JSON.stringify(d), before)
  for (const r of original.specifications) for (const v of r.finishes.visualBasis) {
    assert.equal(v.optionId, r.selections.find(s => s.item === v.item).optionId)
    assert.match(v.note, /approximate|illustrative/i)
    if (v.representation === 'product-photo-reference') assert.ok(v.image)
  }
})

test('untouched legacy project choices use the same read-only projection as Finishes & Cost', () => {
  const d = structuredClone(design); d.model.brief.finish = 'mid'; d.model.brief.specs.overrides = {}
  const saved = defaultSelection('refined'), before = JSON.stringify(d), sourceCost = estimateProjectBoq(d, d.model.brief, saved)
  const projected = projectFinishBrief(d, d.model.brief, saved); assert.equal(JSON.stringify(d), before); d.model.brief = projected
  const view = appearance(d), cost = estimateProjectBoq(d, projected, saved)
  assert.deepEqual(cost.quantities, sourceCost.quantities); assert.equal(cost.expected, sourceCost.expected)
  for (const r of view.specifications) for (const s of r.selections.filter(s => /^floor-/.test(s.item))) {
    const ref = createWalkthroughSource(d, validate(d), preferences).rooms.find(ref => ref.key === r.roomId)
    assert.equal(s.optionId, resolveSpecification(projected, s.item, ref.finishRoomKey).id)
  }
  const unprojected = JSON.parse(before); assert.deepEqual(unprojected.model.brief.specs.overrides, {})
  assert.equal(projectFinishBrief(unprojected, unprojected.model.brief, { ...saved, catalogue: true }), unprojected.model.brief)
})

test('wall tile and backsplash skins stay inside real wall faces and never fill architectural apertures', () => {
  assert.ok(original.skins.some(s => s.id.endsWith('wall-tiles')))
  for (const s of original.skins) {
    const f = geometry.faces.find(f => f.id === s.id.slice(0, s.id.lastIndexOf(':')))
    assert.ok(f, s.id); assert.equal(s.canonicalSurfaceId, f.canonicalSurfaceId)
    const axis = f.normal.findIndex(n => Math.abs(n) > .9)
    for (const p of s.vertices) for (let i = 0; i < 3; i++) {
      if (i === axis) continue
      assert.ok(p[i] >= Math.min(...f.vertices.map(v => v[i])) - 1e-6 && p[i] <= Math.max(...f.vertices.map(v => v[i])) + 1e-6)
    }
  }
})

test('selected ceiling, fan, light, switches, shower, exhaust and heater are separate from architectural geometry', () => {
  const d = changed({ 'false-ceiling': 'premium' }), result = appearance(d)
  for (const suffix of ['fan-hub', 'ceiling-light', 'bulb', 'switchboard', 'shower-head', 'exhaust', 'water-heater']) assert.ok(result.furniture.some(b => b.id.endsWith(suffix)), suffix)
  assert.ok(result.skins.some(s => s.id.includes('ceiling-')))
  assert.ok(geometry.faces.every(f => !f.id.includes('ceiling-trim')))
  assert.equal(estimateBoq(d).quantities.rooms.length, estimateBoq(design).quantities.rooms.length)
})

test('catalogue tile dimensions retain rectangular metre scale and fixture photos remain reference-only', () => {
  const item = specsCatalogue.items.find(i => i.id === 'floor-living'), option = item.options.find(o => o.flooringProductId === 'marble-gvt')
  const result = appearance(changed({ 'floor-living': option.id }))
  assert.ok(result.specifications.some(r => r.finishes.floor.tileSizeM?.[0] === .8 && r.finishes.floor.tileSizeM?.[1] === 1.6))
  for (const r of result.specifications) for (const key of ['fan', 'lights', 'switches', 'basin', 'waterHeater']) {
    const fixture = r.finishes[key]; if (!fixture?.image) continue
    assert.ok(!Object.values(result.bindings).some(l => l.surface?.image === fixture.image), `${key} photo cannot masquerade as a material map`)
  }
})

test('live updates retain source buffers, IDs/transforms and unrelated material objects; superseded changes never commit', async () => {
  const root = new Group(), a = new Mesh(new BoxGeometry(), new MeshStandardMaterial()), b = new Mesh(new BoxGeometry(), new MeshStandardMaterial())
  a.userData = { materialBinding: 'a', surfaceIds: ['A'] }; b.userData = { materialBinding: 'b', surfaceIds: ['B'] }; a.position.set(2, 3, -4); root.add(a, b)
  const one = { a: { color: '#ff0000', rough: .3 }, b: { color: '#00ff00', rough: .4 } }
  await applyWalkthroughMaterialBindings(root, one)
  const materialB = b.material, buffers = a.geometry, before = a.position.clone()
  await applyWalkthroughMaterialBindings(root, { ...one, a: { color: '#0000ff', rough: .8 } })
  assert.equal(b.material, materialB); assert.equal(a.geometry, buffers); assert.deepEqual(a.position, before); assert.deepEqual(a.userData.surfaceIds, ['A'])
  await assert.rejects(applyWalkthroughMaterialBindings(root, one, () => false), { name: 'AbortError' })
  assert.equal(a.material.color.getHexString(), '0000ff'); disposeWalkthroughAsset(root)
})

test('live fitted package batches room looks; geometry identity ignores material-only edits', async () => {
  const app = { bindings: { a: { color: '#123456', rough: .4 } }, furniture: [{ id: 'fixture', roomId: 'room', floorId: 'ground', sourceIds: ['fixture'], binding: 'a', kind: 'furniture', position: [2, 1, -4], size: [.4, .5, .3], shape: 'box', rotation: 0 }], skins: [], specifications: [], issues: [] }
  const group = await buildWalkthroughAppearanceGroup(app)
  assert.equal(group.children.length, 1); assert.equal(group.children[0].userData.roomId, 'room')
  assert.equal(group.children[0].material.color.getHexString(), '123456')
  assert.equal(walkthroughFurnishingGeometryKey(app), walkthroughFurnishingGeometryKey({ ...app, bindings: { a: { color: '#abcdef', rough: .1 } } }))
  disposeWalkthroughAsset(group)
})

test('unavailable or external material photos fall back to the selected colour with an explicit qualification', async () => {
  const root = new Group(), mesh = new Mesh(new BoxGeometry(), new MeshStandardMaterial())
  mesh.userData.materialBinding = 'selected'; root.add(mesh)
  const warnings = await applyWalkthroughMaterialBindings(root, { selected: { color: '#aabbcc', rough: .6, surface: { pattern: 'image', tileM: .6, image: 'https://supplier.invalid/reference.png' } } })
  assert.equal(warnings.length, 1); assert.equal(mesh.material.color.getHexString(), 'aabbcc'); assert.equal(mesh.material.map, null)
  disposeWalkthroughAsset(root)
})

test('a changed fitted product replaces its room only; other room GPU meshes survive and cancelled edits leave them attached', async () => {
  const box = roomId => ({ id: roomId, roomId, floorId: 'ground', sourceIds: [roomId], binding: roomId, kind: 'furniture', position: [0, 1, 0], size: [1, 1, 1], shape: 'box', rotation: 0 })
  const app = { furniture: [box('one'), box('two')], skins: [], bindings: { one: { color: '#aabbcc', rough: .5 }, two: { color: '#ddeeff', rough: .4 } }, specifications: [], issues: [] }
  const first = await prepareWalkthroughAppearanceUpdate(app, null), old = first.commit(), retained = old.children.find(g => g.userData.roomId === 'two'), geometry = retained.children[0].geometry
  const edited = { ...app, bindings: { ...app.bindings, one: { color: '#ccbb00', rough: .2 } } }
  const staged = await prepareWalkthroughAppearanceUpdate(edited, old)
  assert.equal(retained.parent, old, 'staging cannot mutate the visible house')
  const updated = staged.commit(); disposeWalkthroughAsset(old)
  assert.equal(updated.children.find(g => g.userData.roomId === 'two'), retained); assert.equal(retained.children[0].geometry, geometry)
  const cancelled = await prepareWalkthroughAppearanceUpdate(app, updated); cancelled.dispose()
  assert.equal(retained.parent, updated, 'disposing an uncommitted edit cannot dispose a reused room')
  disposeWalkthroughAsset(updated)
})
