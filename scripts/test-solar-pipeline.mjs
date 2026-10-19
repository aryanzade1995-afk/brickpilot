import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import * as THREE from 'three'
import { defaultBrief } from '../src/lib/model/brief.ts'
import { solarConfigurationSchema } from '../src/lib/model/solar.ts'
import { compile } from '../src/lib/model/canonical.ts'
import { generate } from '../src/lib/engine/generate.ts'
import { generateAlternativeDesign } from '../src/lib/engine/generateAlternativeDesign.ts'
import { buildSolarRoofModel } from '../src/lib/solar/roofModel.ts'
import { proposeSolarPlacement, solarPanelGeometry } from '../src/lib/solar/placement.ts'
import { createSolarRenderContract, solarVisualSignature } from '../src/lib/solar/renderContract.ts'
import { solarPanelWorldMatrix, solarSupportMatrices } from '../src/lib/three/solarGeometry.ts'
import { prepareVillaScene } from '../src/lib/three/prepareVillaScene.ts'
import { estimateBoq, boqCsv } from '../src/lib/cost/index.ts'
import { savedCostSchema, publicSheetSchema } from '../src/lib/cost/deliverySchemas.ts'
import { specificationSchedule } from '../src/lib/cost/schedule.ts'
import { createPublicSheet } from '../src/lib/cost/publicSheet.ts'
import { snapshotCost, parseCostReplay } from '../src/lib/cost/replay.ts'
import { validate } from '../src/lib/rules/index.ts'
registerHooks({ resolve(s, c, next) { return s.startsWith('@/') ? { url: new URL(`../src/${s.slice(2)}`, import.meta.url).href, shortCircuit: true } : next(s, c) } })
const brief = defaultBrief(); brief.site.plotWidth = 25; brief.site.plotDepth = 30
const design = generate(compile(brief)), architecture = generateAlternativeDesign(design, 12)
const input = solarConfigurationSchema.parse({ intention: 'install-now', inputs: {
  panel: { id: 'pipeline-550', name: 'Illustrative 550 W', source: 'illustrative', revision: 'v1', dimensionsMm: { width: 1000, height: 2000, thickness: 35 }, ratedPowerW: 550 },
  request: { kind: 'panel-count', panelCount: 2 }, placement: { arrayRotationDeg: 0, tiltDeg: 10 },
} })
const roof = buildSolarRoofModel(design, { architecture, inputs: input.inputs }), proposal = proposeSolarPlacement(input, roof)
assert.equal(proposal.layout.panels.length, 2)
const solar = solarConfigurationSchema.parse({ ...input, calculated: { configurationSignature: proposal.layout.configurationSignature, layout: proposal.layout } })
const applied = { ...brief, solar }, context = { ...architecture, facadeModel: architecture.facadeGrammar }
const cost = estimateBoq(design, applied, undefined, context)
const contract = createSolarRenderContract(design, architecture, solar)
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`)

test('Blender contract corners equal canonical physical corners; support transforms equal live geometry', () => {
  for (let i = 0; i < contract.panels.length; i++) {
    const p = proposal.layout.panels[i], frame = new THREE.Matrix4().fromArray(contract.panels[i].frame)
    const corners = [-.5, .5].flatMap(x => [-.5, .5].flatMap(y => [-.5, .5].map(z => new THREE.Vector3(x, y, z).applyMatrix4(frame))))
    const physical = solarPanelGeometry(p, proposal.layout.placementPolicy).physicalCornersMm.map(v => new THREE.Vector3(v.x / 1000, v.y / 1000, v.z / 1000))
    for (const v of corners) assert.ok(physical.some(e => e.distanceTo(v) < 1e-7))
    const glbAxis = new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1)
    const expected = [solarPanelWorldMatrix(p), solarPanelWorldMatrix(p, true), ...solarSupportMatrices(p)]
    for (const [j, values] of [contract.panels[i].frame, contract.panels[i].face, ...contract.panels[i].supports].entries())
      glbAxis.clone().multiply(new THREE.Matrix4().fromArray(values)).elements.forEach((v, k) => close(v, expected[j].elements[k]))
  }
  assert.equal(contract.panelCount, 2); assert.equal(contract.capacityKwp, 1.1)
})

test('replay rejects stale/tampered geometry instead of recalculating or dropping panels', () => {
  for (const mutate of [s => s.calculated.layout.panels[0].positionMm.x += 1e6, s => s.calculated.layout.roofSignature = 'other-roof',
    s => s.calculated.layout.validity.state = 'needs-review', s => s.inputs.panel.ratedPowerW = 600]) {
    const bad = structuredClone(solar); mutate(bad); assert.throws(() => createSolarRenderContract(design, architecture, bad))
  }
  const changed = structuredClone(solar); changed.assessmentInputs.objective = 'both'
  assert.equal(solarVisualSignature(changed), solarVisualSignature(solar))
  changed.inputs.reservedAreas.push({ id: 'reserved', label: '', roofSurfaceId: null, level: 1, rectMm: { x: 0, y: 0, w: 100, h: 100 } })
  assert.notEqual(solarVisualSignature(changed), solarVisualSignature(solar))
})

test('reservation and removal exports have zero installed panels even if an old layout exists', () => {
  for (const intention of ['reserve-space', 'undecided', 'not-included']) {
    const s = solarConfigurationSchema.parse({ ...solar, intention, calculated: null })
    const c = createSolarRenderContract(design, architecture, s)
    assert.equal(c.panelCount, 0); assert.equal(c.capacityKwp, 0); assert.deepEqual(c.panels, [])
  }
})

test('reopened combined GLB strips embedded PV from building cache; canonical layer is not doubled', () => {
  const source = new THREE.Group(), wall = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()), pv = new THREE.Group()
  wall.name = 'AcceptedWall'; pv.userData.formstead_solar = true
  pv.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()))
  source.add(wall, pv)
  const prepared = prepareVillaScene(source, 1), meshes = []
  prepared.traverse(o => { if (o.isMesh) meshes.push(o) })
  assert.equal(meshes.length, 1); assert.equal(source.children.length, 2); assert.equal(pv.children.length, 1)
})

test('saved replay and public schedule validate canonical inventory, capacity and gross cost without breaking older snapshots', () => {
  assert.equal(cost.solar.status, 'applied'); assert.equal(cost.solar.delivery.layoutStatus, 'concept-valid')
  const snapshot = snapshotCost(design, applied, cost)
  assert.deepEqual(parseCostReplay(snapshot).cost.solar.delivery, cost.solar.delivery)
  assert.ok(publicSheetSchema.safeParse(createPublicSheet(applied, cost)).success)
  assert.equal(specificationSchedule(applied, cost).filter(r => r.id.startsWith('solar-pv:')).length, 8)
  for (const mutate of [c => c.solar.capacityKwp++, c => c.solar.delivery.arrays[0].ratedPowerW++, c => c.solar.delivery.arrays[0].panelIds.pop(),
    c => c.solar.delivery.layoutStatus = 'needs-review', c => c.solar.grossInstallationCost++]) {
    const bad = structuredClone(cost); mutate(bad); assert.equal(savedCostSchema.safeParse(bad).success, false)
  }
  const legacy = structuredClone(snapshot); delete legacy.cost.solar.delivery
  assert.ok(parseCostReplay(legacy))
  const shared = createPublicSheet(applied, cost)
  shared.schedule.find(r => r.id === 'solar-pv:panels').rate++
  assert.equal(publicSheetSchema.safeParse(shared).success, false)
  const invalidQuantity = createPublicSheet(applied, cost)
  invalidQuantity.schedule.find(r => r.id === 'solar-pv:inverter').quantity = 'unknown'
  assert.equal(publicSheetSchema.safeParse(invalidQuantity).success, false)
  assert.match(boqCsv(cost), /Canonical solar panel schedule/); assert.match(boqCsv(cost), /pipeline-550/)
  assert.match(boqCsv(cost), /Illustrative specifications/)
})

test('both PDFs and Excel carry schedule, qualifications, count, capacity and separate assistance', async () => {
  const { buildSpecSheetPdf } = await import('../src/lib/report/specSheet.ts')
  const { buildReportPdf } = await import('../src/lib/report/buildPdf.ts')
  const { buildBoqExcel } = await import('../src/lib/cost/exportExcel.ts')
  const { default: ExcelJS } = await import('exceljs')
  const specification = await buildSpecSheetPdf({ projectName: 'Solar delivery verification', cost, schedule: specificationSchedule(applied, cost), photos: {} })
  const report = await buildReportPdf({ projectName: 'Solar delivery verification', cost, brief: applied, design, report: validate(design),
    planImages: [], massingImages: [{ label: 'Old solar render', dataUrl: 'invalid', artifactScope: 'building-plus-solar', solarVisualSignature: 'old' }], conceptImages: [], specPhotos: {} })
  for (const pdf of [specification, report]) {
    const bytes = Buffer.from(await pdf.arrayBuffer()).toString('latin1')
    for (const word of ['pipeline-550', 'concept-valid', '1.1', 'INR 0 deducted', 'Illustrative specifications', 'Local pose']) assert.ok(bytes.includes(word), word)
  }
  assert.match(Buffer.from(await report.arrayBuffer()).toString('latin1'), /OUT OF DATE/)
  const excel = await buildBoqExcel(cost), book = new ExcelJS.Workbook()
  await book.xlsx.load(await excel.arrayBuffer())
  const schedule = book.getWorksheet('Solar panel schedule')
  assert.equal(schedule.getCell('D6').value, 2); assert.equal(schedule.getCell('E6').value, 550); assert.equal(schedule.getCell('F6').value, 1.1)
  if (process.env.SOLAR_TEST_OUTPUT) {
    await mkdir(process.env.SOLAR_TEST_OUTPUT, { recursive: true })
    for (const [name, blob] of [['solar-specifications.pdf', specification], ['solar-project-report.pdf', report], ['solar-boq.xlsx', excel]])
      await writeFile(resolve(process.env.SOLAR_TEST_OUTPUT, name), Buffer.from(await blob.arrayBuffer()))
    await writeFile(resolve(process.env.SOLAR_TEST_OUTPUT, 'solar-boq.csv'), boqCsv(cost))
  }
})

test('solar worker has no architectural search/history path and Python has no panel-placement algorithm', async () => {
  const worker = await readFile(new URL('solar-villa-worker.mjs', import.meta.url), 'utf8')
  assert.doesNotMatch(worker, /generateAlternativeDesign|diversityGate|from ['"].*history|acquireLock|recordModern/)
  const python = await readFile(new URL('../blender/solar_replay.py', import.meta.url), 'utf8')
  assert.doesNotMatch(python, /create_scene|proposeSolarPlacement|rowGapMm|edgeClearanceMm|makePanel/)
  assert.match(python, /before != after/)
})

test('solar render persistence isolates accepted building, project/seed, edited layouts and out-of-order completions', async () => {
  const storage = new Map()
  globalThis.localStorage = { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) }
  globalThis.window = { localStorage: globalThis.localStorage }
  const { useSolarArtifacts, solarArtifactKey, isCurrentSolarArtifact } = await import('../src/state/solarArtifacts.ts')
  const { useBlender } = await import('../src/state/blender.ts')
  const baseId = '17389bc0-d2f4-4126-9cbd-a01d1ebd6e5d'
  const building = { seed: 12, requestedSeed: 12, planId: 'accepted-plan', finishSignature: 'finish-1', quality: 'preview', warnings: [],
    family: 'L_SHAPED', hero: '', roofline: '', files: { glb: `/api/villas/${baseId}/files/villa.glb`, blend: '', hero: '', front: '', aerial: '' } }
  useBlender.setState({ accepted: { 'accepted-plan': building } })
  const acceptedState = useBlender.getState(), beforeSolar = structuredClone(solar)
  const artifact = { ...building, jobId: '7354db53-720d-4f04-9d95-ce49365dd808', artifactScope: 'building-plus-solar', baseJobId: baseId,
    buildingCacheKey: 'building-key', solarCacheKey: 'solar-key', solarVisualSignature: solarVisualSignature(solar), roofSignature: roof.roofSignature,
    panelCount: 2, capacityKwp: 1.1, files: { ...building.files, glb: '/combined.glb', solarLayout: '/solar-layout.json' } }
  const oldFetch = globalThis.fetch
  let finishRequest
  globalThis.fetch = async (url, options) => {
    assert.equal(url, '/api/villas/solar')
    const body = JSON.parse(options.body)
    assert.equal(body.baseJobId, baseId); assert.ok(!('plan' in body)); assert.ok(!('seed' in body))
    return new Promise(resolve => { finishRequest = () => resolve(new Response(JSON.stringify({ id: artifact.jobId, status: 'complete', phase: 'Ready', result: artifact }))) })
  }
  try {
    const pending = useSolarArtifacts.getState().render(building, solar, 'preview')
    const changed = solarConfigurationSchema.parse({ ...solar, calculated: null, intention: 'not-included' })
    assert.equal(isCurrentSolarArtifact(artifact, building, changed), false)
    finishRequest(); await pending
    assert.equal(useBlender.getState(), acceptedState)
    const cached = useSolarArtifacts.getState().renders[solarArtifactKey(building, solar)]
    assert.equal(isCurrentSolarArtifact(cached, building, solar), true)
    assert.equal(isCurrentSolarArtifact(cached, { ...building, seed: 99 }, solar), false)
    assert.equal(isCurrentSolarArtifact(cached, { ...building, files: { ...building.files, glb: '/other-project.glb' } }, solar), false)
    assert.equal(isCurrentSolarArtifact(cached, building, changed), false)
    assert.deepEqual(solar, beforeSolar)
    const reloaded = await import('../src/state/solarArtifacts.ts?pipeline-reload')
    assert.ok(reloaded.isCurrentSolarArtifact(reloaded.useSolarArtifacts.getState().renders[solarArtifactKey(building, solar)], building, solar))
    assert.equal(reloaded.useSolarArtifacts.getState().renders[solarArtifactKey(building, changed)], undefined)
  } finally { globalThis.fetch = oldFetch }
})
