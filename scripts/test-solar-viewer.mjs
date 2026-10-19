import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import * as THREE from 'three'
import { defaultBrief } from '../src/lib/model/brief.ts'
import { solarConfigurationSchema, solarSignature } from '../src/lib/model/solar.ts'
import { compile } from '../src/lib/model/canonical.ts'
import { generate } from '../src/lib/engine/generate.ts'
import { generateAlternativeDesign } from '../src/lib/engine/generateAlternativeDesign.ts'
import { buildSolarRoofModel } from '../src/lib/solar/roofModel.ts'
import { proposeSolarPlacement, solarPanelGeometry, solarLayoutTotals } from '../src/lib/solar/placement.ts'
import { createSolarLayoutDraft, transformSolarSelection, previewSolarLayoutDraft, validateSolarLayoutCommit } from '../src/lib/solar/layoutEditing.ts'
import { planToThreeGlb } from '../src/lib/solar/coordinates.ts'
import { solarPanelWorldMatrix, solarSupportMatrices, solarInstanceData, solarReservationLines, createPhotovoltaicTexture } from '../src/lib/three/solarGeometry.ts'
import { prepareVillaScene } from '../src/lib/three/prepareVillaScene.ts'

const brief = defaultBrief(); brief.site.plotWidth = 25; brief.site.plotDepth = 30
const design = generate(compile(brief)), architecture = generateAlternativeDesign(design, 12)
const inputs = solarConfigurationSchema.parse({ intention: 'install-now', inputs: {
  panel: { id: 'concept-550', name: 'Concept module', source: 'illustrative', dimensionsMm: { width: 1000, height: 2000, thickness: 35 }, ratedPowerW: 550 },
  request: { kind: 'panel-count', panelCount: 2 },
} })
const roof = buildSolarRoofModel(design, { architecture, inputs: inputs.inputs })
const proposal = proposeSolarPlacement(inputs, roof)
const solar = solarConfigurationSchema.parse({ ...inputs, calculated: { configurationSignature: proposal.layout.configurationSignature, layout: proposal.layout } })
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`)
const vec = p => new THREE.Vector3(p.x, p.y, p.z)

test('instanced module matrices match all canonical tilted corners in actual GLB world coordinates', () => {
  for (const angle of [0, 37, 90, 270]) for (const tilt of [0, 15, 45, 90]) {
    const panel = { ...proposal.layout.panels[0], azimuthDeg: angle, tiltDeg: tilt }
    const matrix = solarPanelWorldMatrix(panel)
    const transformed = [-.5, .5].flatMap(x => [-.5, .5].flatMap(y => [-.5, .5].map(z => new THREE.Vector3(x, y, z).applyMatrix4(matrix))))
    const expected = solarPanelGeometry(panel, proposal.layout.placementPolicy).physicalCornersMm.map(p => vec(planToThreeGlb(p)))
    for (const p of transformed) assert.ok(expected.some(e => e.distanceTo(p) < 1e-7), 'A rendered corner must match a physical panel corner')
    assert.ok(matrix.determinant() > 0, 'PV faces retain outward normals rather than mirrored geometry')
    const faceCenter = new THREE.Vector3().setFromMatrixPosition(solarPanelWorldMatrix(panel, true))
    const normal = new THREE.Vector3(0, 0, 1).transformDirection(matrix)
    close(faceCenter.clone().sub(vec(planToThreeGlb(panel.positionMm))).dot(normal), panel.dimensionsMm.thickness / 2000 + .002)
  }
})

test('mounting supports reach the real roof elevation and remain beneath the tilted module', () => {
  const panel = proposal.layout.panels[0]
  for (const m of solarSupportMatrices(panel)) {
    const bottom = new THREE.Vector3(0, -.5, 0).applyMatrix4(m), top = new THREE.Vector3(0, .5, 0).applyMatrix4(m)
    close(bottom.y, panel.baseElevationMm / 1000)
    assert.ok(top.y > bottom.y)
    const inverse = solarPanelWorldMatrix(panel).invert(), localTop = top.clone().applyMatrix4(inverse)
    close(localTop.z, -.5)
    assert.ok(Math.abs(localTop.x) < .5 && Math.abs(localTop.y) < .5)
  }
})

test('one shared texture supplies cell divisions; instance data scales by modules, never by cells', () => {
  const data = solarInstanceData(proposal.layout)
  assert.equal(data.faces.length, 2); assert.equal(data.frames.length, 2); assert.equal(data.supports.length, 8)
  const texture = createPhotovoltaicTexture()
  assert.equal(texture.image.data.length, 128 * 256 * 4)
  assert.equal(texture.generateMipmaps, true)
  assert.notDeepEqual([...texture.image.data.slice(0, 3)], [...texture.image.data.slice((128 + 1) * 4, (128 + 1) * 4 + 3)])
  texture.dispose()
})

test('keep-free lines use actual surface references and roof elevation, not building origin or guessed heights', () => {
  const top = roof.surfaces.find(s => s.kind === 'flat-top-roof')
  const area = { id: 'free', roofSurfaceId: top.id, level: top.level, rectMm: { x: 1234, y: 2345, w: 2000, h: 1500 } }
  const lines = solarReservationLines([area], roof)
  assert.equal(lines.length, 24)
  close(lines[0], 1.234); close(lines[1], (top.elevationMm + 50) / 1000); close(lines[2], -2.345)
  assert.equal(solarReservationLines([{ ...area, roofSurfaceId: 'deleted-roof' }], roof).length, 0)
})

test('group edits preserve IDs and relative spacing; a valid rotation commits one canonical layout', () => {
  const draft = createSolarLayoutDraft(solar, roof.roofSignature), before = JSON.stringify([solar, design, architecture])
  const ids = new Set(draft.panels.map(p => p.id))
  const moved = transformSolarSelection(draft.panels, ids, 400, -600, 90)
  assert.deepEqual(moved.map(p => p.id), draft.panels.map(p => p.id))
  const distance = ps => Math.hypot(ps[0].positionMm.x - ps[1].positionMm.x, ps[0].positionMm.y - ps[1].positionMm.y)
  close(distance(moved), distance(draft.panels))
  const rotated = { ...draft, panels: transformSolarSelection(draft.panels, new Set([draft.panels[0].id]), 0, 0, 180) }
  const checked = previewSolarLayoutDraft(design, solar, architecture, rotated)
  assert.ok(checked.configuration)
  const saved = validateSolarLayoutCommit(design, solar, architecture, checked.configuration, draft.baseSolarSignature, draft.roofSignature)
  assert.equal(saved.inputs.placement.mode, 'manual')
  assert.equal(saved.calculated.layout.panels.find(p => p.id === draft.panels[0].id).azimuthDeg, 180)
  assert.deepEqual(solarLayoutTotals(saved.calculated.layout), solarLayoutTotals(solar.calculated.layout))
  assert.equal(JSON.stringify([solar, design, architecture]), before)
})

test('invalid moves reject the complete edit rather than dropping a panel or accepting a partial capacity', () => {
  const draft = createSolarLayoutDraft(solar, roof.roofSignature)
  draft.panels = transformSolarSelection(draft.panels, new Set([draft.panels[0].id]), 1000000, 0, 0)
  const checked = previewSolarLayoutDraft(design, solar, architecture, draft)
  assert.equal(checked.configuration, null)
  assert.ok(checked.issues.length)
  assert.equal(solar.calculated.layout.panels.length, 2)
  const missing = createSolarLayoutDraft(solar, roof.roofSignature); missing.panels.pop()
  assert.throws(() => previewSolarLayoutDraft(design, solar, architecture, missing), /INVALID_SOLAR_EDIT/)
})

test('outside, courtyard, blocked-access and panel-conflicting keep-free drafts fail closed', () => {
  const top = roof.surfaces.find(s => s.kind === 'flat-top-roof'), base = createSolarLayoutDraft(solar, roof.roofSignature)
  const area = rectMm => ({ id: 'keep-free', roofSurfaceId: top.id, level: top.level, rectMm })
  assert.throws(() => previewSolarLayoutDraft(design, solar, architecture, { ...base, reservedAreas: [area({ x: -1000000, y: -1000000, w: 1000, h: 1000 })] }), /KEEP_FREE_OUTSIDE_ROOF/)
  const box = top.grossRegionsMm[0]
  const conflict = previewSolarLayoutDraft.bind(null, design, solar, architecture, { ...base, reservedAreas: [area({ x: box.x, y: box.y, w: box.w, h: box.h })] })
  try { assert.equal(conflict().configuration, null) } catch (e) { assert.match(e.message, /KEEP_FREE_BLOCKS_ACCESS|KEEP_FREE_OUTSIDE_ROOF/) }
  const p = base.panels[0].positionMm
  const collision = () => previewSolarLayoutDraft(design, solar, architecture, { ...base, reservedAreas: [area({ x: p.x - 100, y: p.y - 100, w: 200, h: 200 })] })
  try { assert.equal(collision().configuration, null) } catch (e) { assert.match(e.message, /KEEP_FREE_BLOCKS_ACCESS/) }
})

test('a real free-space reservation persists alongside panels and works without installing a system', () => {
  const top = roof.surfaces.find(s => s.kind === 'flat-top-roof'), base = createSolarLayoutDraft(solar, roof.roofSignature)
  let valid = null, selected = null
  for (const region of top.usableRegionsMm) {
    const area = { id: 'free-space', roofSurfaceId: top.id, level: top.level, label: 'Future free space', rectMm: { ...region, w: Math.min(region.w, 200), h: Math.min(region.h, 200) } }
    try { const candidate = previewSolarLayoutDraft(design, solar, architecture, { ...base, reservedAreas: [area] }); if (candidate.configuration) { valid = candidate; selected = area; break } } catch { /* Other clear rectangles may interrupt an approach; try the next represented region. */ }
  }
  assert.ok(valid, 'The accepted roof has a clear reservation away from these modules')
  const saved = validateSolarLayoutCommit(design, solar, architecture, valid.configuration, base.baseSolarSignature, base.roofSignature)
  assert.deepEqual(saved.inputs.reservedAreas, [selected])
  assert.equal(saved.calculated.layout.panels.length, 2)
  const undecided = solarConfigurationSchema.parse({})
  const reservation = createSolarLayoutDraft(undecided, roof.roofSignature); reservation.reservedAreas = [selected]
  const proposed = previewSolarLayoutDraft(design, undecided, architecture, reservation)
  const reserveOnly = validateSolarLayoutCommit(design, undecided, architecture, proposed.configuration, reservation.baseSolarSignature, reservation.roofSignature)
  assert.equal(reserveOnly.intention, 'reserve-space'); assert.equal(reserveOnly.calculated, null)
})

test('stale projects, changed roofs and changed specification/capacity cannot masquerade as a layout edit', () => {
  const draft = createSolarLayoutDraft(solar, roof.roofSignature), checked = previewSolarLayoutDraft(design, solar, architecture, draft)
  assert.throws(() => validateSolarLayoutCommit(design, solar, architecture, checked.configuration, 'another-project', roof.roofSignature), /SOLAR_EDIT_STALE/)
  assert.throws(() => validateSolarLayoutCommit(design, solar, architecture, checked.configuration, solarSignature(solar), 'another-roof'), /SOLAR_EDIT_STALE/)
  const changed = structuredClone(checked.configuration); changed.inputs.monthlyConsumptionKwh = 99
  assert.throws(() => validateSolarLayoutCommit(design, solar, architecture, changed, solarSignature(solar), roof.roofSignature))
  assert.throws(() => previewSolarLayoutDraft(design, { ...solar, intention: 'not-included' }, architecture, draft), /SOLAR_EDIT_STALE/)
})

test('solar instance changes leave cached prepared villa geometry and source model untouched', () => {
  const source = new THREE.Group(), material = new THREE.MeshStandardMaterial()
  source.add(new THREE.Mesh(new THREE.BoxGeometry(), material))
  const before = prepareVillaScene(source, 1), mesh = before.children.find(c => c.isMesh)
  solarInstanceData(proposal.layout)
  const after = prepareVillaScene(source, 1), other = after.children.find(c => c.isMesh)
  assert.equal(mesh.geometry, other.geometry)
  assert.equal(source.children.length, 1)
  assert.equal(after.children.some(c => c.name.startsWith('PV_')), false)
  material.dispose(); source.children[0].geometry.dispose()
})

registerHooks({ resolve(s, c, next) { return s.startsWith('@/') ? { url: new URL(`../src/${s.slice(2)}`, import.meta.url).href, shortCircuit: true } : next(s, c) } })
const storage = new Map(); globalThis.localStorage = { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) }
globalThis.window = { localStorage: globalThis.localStorage }
const { useStudio } = await import('../src/state/studio.ts'), { useBlender } = await import('../src/state/blender.ts')
test('atomic viewer edits preserve exact building result, pinned direction, plan edits, cost and accepted GLB without a fetch', () => {
  useStudio.getState().loadSaved(brief, { massing: design.massingType, seed: 12, planSeed: design.planSeed, planner: 'baseline' })
  useStudio.getState().run(); useStudio.getState().updateSolar({ intention: inputs.intention, inputs: inputs.inputs })
  const initial = useStudio.getState().proposeSolarLayout(); assert.equal(initial.ok, true)
  assert.equal(useStudio.getState().applySolarLayout(initial.proposal.layout).ok, true)
  const before = useStudio.getState(), r = before.result
  const arch = { buildingModel: r.buildingModel, massingModel: r.massingModel, facadeGrammar: r.facadeModel, villaDesignDNA: r.villaDesignDNA }
  const currentRoof = buildSolarRoofModel(r.design, { architecture: arch, inputs: before.brief.solar.inputs })
  const draft = createSolarLayoutDraft(before.brief.solar, currentRoof.roofSignature)
  const checked = previewSolarLayoutDraft(r.design, before.brief.solar, arch, draft)
  useBlender.setState({ accepted: { [r.buildingModel.planId]: { files: { glb: '/unchanged-building.glb' } } } })
  const renders = useBlender.getState(), oldFetch = globalThis.fetch
  globalThis.fetch = () => { throw new Error('Solar must not request a building render') }
  try {
    assert.equal(useStudio.getState().commitSolarLayoutEdit(checked.configuration, draft.baseSolarSignature, draft.roofSignature).ok, true)
    const after = useStudio.getState()
    assert.equal(after.result, before.result); assert.equal(after.pinned, before.pinned); assert.equal(after.layout, before.layout)
    assert.equal(after.result.cost, before.result.cost); assert.equal(useBlender.getState(), renders)
    assert.equal(after.brief.solar.inputs.placement.mode, 'manual')
    assert.equal(useStudio.getState().commitSolarLayoutEdit(checked.configuration, draft.baseSolarSignature, draft.roofSignature).ok, false, 'Old drafts are invalid after an Apply')
    const positions = JSON.stringify(after.brief.solar.calculated.layout.panels)
    useStudio.getState().loadSaved(after.brief, after.pinned, after.layout); useStudio.getState().run()
    assert.equal(JSON.stringify(useStudio.getState().brief.solar.calculated.layout.panels), positions)
    assert.equal(useStudio.getState().brief.solar.calculated.layout.validity.state, 'concept-valid')
  } finally { globalThis.fetch = oldFetch }
})
