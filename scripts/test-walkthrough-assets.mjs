import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { defaultBrief } from '../src/lib/model/brief.ts'
import { compile } from '../src/lib/model/canonical.ts'
import { generate } from '../src/lib/engine/generate.ts'
import { validate } from '../src/lib/rules/index.ts'
import { createBuildingModel } from '../src/lib/engine/buildingModel.ts'
import { buildWalkthroughScene } from '../src/lib/walkthrough/scene.ts'
import { prepareWalkthroughGeometry, materialDomains } from '../src/lib/walkthrough/delivery.ts'
import { prepareWalkthroughRequest, createWalkthroughService, inspectWalkthroughGlb, resolveWalkthroughImages } from '../server/walkthrough-assets.mjs'
import { blenderExecutable } from '../server/blender-process.mjs'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { Box3, Vector3, Group, Mesh, BoxGeometry, MeshStandardMaterial } from 'three'
import { applyWalkthroughMaterialBindings, disposeWalkthroughAsset } from '../src/lib/three/loadWalkthroughAsset.ts'
import { createServer } from 'node:http'

const brief = defaultBrief(); brief.site.plotWidth = 18; brief.site.plotDepth = 24
const design = generate(compile(brief), { seed: 41 }), building = createBuildingModel(design), scene = buildWalkthroughScene(building, validate(design))
const preferences = { style: 'modern', lighting: 'daylight', furnitureDensity: 'medium' }
const request = (d = design, projectId = 'walkthrough-test') => ({ design: d, projectId, preferences, expectedPlanId: createBuildingModel(d).planId })
const wait = ms => new Promise(r => setTimeout(r, ms))
async function complete(service, id) {
  for (let i = 0; i < 600; i++) {
    const job = await service.status(id)
    if (job.status === 'failed' || job.status === 'ready' || job.status === 'missing') return job
    await wait(100)
  }
  throw new Error('Walkthrough test timed out')
}

test('export source is immutable; invalid plans, stale design IDs and invalid preferences are rejected', () => {
  const before = JSON.stringify(design), p = prepareWalkthroughRequest(request())
  assert.equal(p.designId, building.planId); assert.equal(JSON.stringify(design), before)
  assert.throws(() => prepareWalkthroughRequest({ ...request(), expectedPlanId: 'other' }), /no longer matches/)
  assert.throws(() => prepareWalkthroughRequest({ ...request(), preferences: { ...preferences, style: 'not-real' } }), /valid interior/)
  const invalid = structuredClone(design); invalid.floors[0].rooms[0].rect.w = -1
  assert.throws(() => prepareWalkthroughRequest(request(invalid)))
  assert.equal(p.geometry.metadata.navigation.ready, false)
  assert.ok(p.geometry.metadata.issues.some(i => i.code === 'OUTDOOR_GUARDS_UNSPECIFIED'))
})

test('material partition preserves every source face area and separates each room floor and inward wall skin', () => {
  const faces = materialDomains(scene)
  const area = f => new Vector3().subVectors(new Vector3(...f.vertices[1]), new Vector3(...f.vertices[0])).cross(new Vector3().subVectors(new Vector3(...f.vertices[3]), new Vector3(...f.vertices[0]))).length()
  assert.ok(Math.abs(faces.reduce((n, f) => n + area(f), 0) - scene.surfaces.reduce((n, f) => n + area(f), 0)) < 1e-5)
  for (const r of scene.rooms.filter(r => !r.outdoor && !/stair/i.test(r.name))) assert.ok(faces.some(f => f.roomId === r.id && JSON.parse(f.binding)[2] === 'floor'), r.id)
  assert.ok(faces.some(f => JSON.parse(f.binding)[2] === 'ceiling'))
  assert.equal(new Set(faces.map(f => f.id)).size, faces.length)
})

test('collision is separate from render data, source stairs retained, entry points tested, windows never portals', () => {
  const g = prepareWalkthroughGeometry(scene)
  assert.equal(g.collision.colliders.filter(c => c.kind === 'stair').length, scene.solids.filter(s => s.role === 'stair').length)
  assert.ok(g.collision.colliders.some(c => c.kind === 'window'))
  assert.ok(g.collision.doors.length > 0)
  assert.ok(g.metadata.entries.length > 0)
  for (const entry of g.metadata.entries) assert.ok(scene.openings.some(o => o.id === entry.id && o.kind !== 'window'))
  assert.deepEqual(g.metadata.stairs, scene.stairs)
  assert.ok(g.openingParts.every(p => p.kind !== 'door' || !scene.openings.find(o => p.id.startsWith(o.id))?.operation.includes('open')))
})

test('finish changes preserve cached structure identity and IDs while updating selected material / furniture package', () => {
  const changed = structuredClone(design); changed.model.brief.finish = 'premium'
  const a = prepareWalkthroughRequest(request()), b = prepareWalkthroughRequest(request(changed))
  assert.deepEqual(a.geometry, b.geometry)
  assert.notDeepEqual(a.appearance.bindings, b.appearance.bindings)
  assert.ok(a.appearance.furniture.length > 50)
  for (const f of a.appearance.furniture) assert.ok(f.position.every(Number.isFinite) && f.size.every(n => n > 0))
})

test('missing and unsafe texture references use an explained fallback and never reach Blender', async () => {
  const a = { bindings: { one: { color: '#aaaaaa', rough: .5, surface: { image: '/not-present.png' } }, two: { color: '#bbbbbb', rough: .5, surface: { image: '/../../server/.env' } } }, furniture: [], issues: [], specifications: [] }
  const r = await resolveWalkthroughImages(a)
  assert.equal(r.appearance.bindings.one.surface.image, undefined)
  assert.equal(r.appearance.bindings.two.surface.image, undefined)
  assert.equal(r.appearance.issues.length, 2)
  assert.ok(a.bindings.one.surface.image)
})

test('failed / incomplete exports never become downloadable and can be retried', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'formstead-walk-fail-'))
  let calls = 0
  const service = createWalkthroughService({ root, rendererKey: 'test', runner: async () => { calls++; throw new Error('injected failure') } })
  try {
    const a = await service.request(request()), duplicate = await service.request(request())
    assert.equal(a.id, duplicate.id)
    assert.equal((await complete(service, a.id)).status, 'failed')
    await service.request(request()); await complete(service, a.id)
    assert.ok(calls >= 2)
    assert.equal((await createWalkthroughService({ root, rendererKey: 'test' }).status(a.id)).status, 'missing')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('GLB validator rejects truncation and unrelated design identity', () => {
  assert.throws(() => inspectWalkthroughGlb(Buffer.from('not a glb'), building.planId))
})

test('live material replacement keeps mesh buffers, transforms and surface identifiers unchanged', async () => {
  const root = new Group(), mesh = new Mesh(new BoxGeometry(), new MeshStandardMaterial())
  mesh.userData = { materialBinding: 'wall-1', surfaceIds: ['surface-1'] }; mesh.position.set(4, 3, -2); root.add(mesh)
  const geometry = mesh.geometry, positions = geometry.attributes.position.array.slice(), before = mesh.matrix.clone()
  await applyWalkthroughMaterialBindings(root, { 'wall-1': { color: '#ff0000', rough: .42 } })
  assert.equal(mesh.geometry, geometry); assert.deepEqual(mesh.geometry.attributes.position.array, positions)
  assert.deepEqual(mesh.matrix, before); assert.deepEqual(mesh.userData.surfaceIds, ['surface-1']); assert.equal(mesh.material.color.getHexString(), 'ff0000')
  disposeWalkthroughAsset(root)
})

const integration = process.env.WALKTHROUGH_BLENDER_TEST === '1'
test('real Blender: complete optimized GLBs load in Three, preserve source geometry, cache finish-only jobs, survive restart and reject corrupt artifacts', { skip: !integration, timeout: 180000 }, async () => {
  assert.ok(existsSync(blenderExecutable()), 'Local Blender is required for this explicit integration test')
  const root = resolve('output/walkthrough-integration'), service = createWalkthroughService({ root })
  const first = await service.request(request()), done = await complete(service, first.id)
  assert.equal(done.status, 'ready', JSON.stringify(done))
  const dir = resolve(root, 'jobs', first.id), bytes = await readFile(resolve(dir, 'house.glb'))
  const inspected = inspectWalkthroughGlb(bytes, building.planId)
  assert.ok(inspected.triangles < 250000); assert.ok(bytes.length < 25e6)
  // The Node loader test strips embedded images only (Node has no ImageBitmap).
  // Browser verification loads the original binary with its actual textures.
  const withoutImages = structuredClone(inspected.doc)
  for (const m of withoutImages.materials ?? []) if (m.pbrMetallicRoughness) delete m.pbrMetallicRoughness.baseColorTexture
  delete withoutImages.images; delete withoutImages.textures; delete withoutImages.samplers
  const jsonBytes = Buffer.from(JSON.stringify(withoutImages)), jsonPadded = Buffer.concat([jsonBytes, Buffer.alloc((4 - jsonBytes.length % 4) % 4, 32)])
  const originalJsonLength = bytes.readUInt32LE(12), bin = bytes.subarray(20 + originalJsonLength)
  const glb = Buffer.alloc(20 + jsonPadded.length + bin.length)
  glb.writeUInt32LE(0x46546c67, 0); glb.writeUInt32LE(2, 4); glb.writeUInt32LE(glb.length, 8); glb.writeUInt32LE(jsonPadded.length, 12); glb.writeUInt32LE(0x4e4f534a, 16); jsonPadded.copy(glb, 20); bin.copy(glb, 20 + jsonPadded.length)
  const loaded = await new Promise((ok, no) => new GLTFLoader().parse(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength), '', ok, no))
  loaded.scene.updateMatrixWorld(true)
  const bounds = new Box3().setFromObject(loaded.scene)
  assert.ok(bounds.min.y >= -.5 && bounds.max.y > 6)
  assert.ok(bounds.min.z < -5 && bounds.max.z <= .5, 'global plan y maps to negative world z')
  const metadata = JSON.parse(await readFile(resolve(dir, 'metadata.json'), 'utf8'))
  assert.equal(metadata.appearanceVersion, 'room-finishes-v1')
  assert.equal(metadata.floors.length, building.floors.length)
  assert.equal(metadata.openings.length, building.doors.length + building.windows.length)
  assert.ok(metadata.surfaces.length >= scene.surfaces.length)
  const meshIds = new Set()
  const positions = new Map(metadata.surfaces.map(f => [f.id, f.vertices]))
  const key = p => p.map(n => Math.round(n * 10000)).join(',')
  loaded.scene.traverse(o => {
    for (const id of o.userData.surfaceIds ?? []) meshIds.add(id)
    if (!o.userData.surfaceIds || !o.geometry) return
    const expected = new Set(o.userData.surfaceIds.flatMap(id => positions.get(id)).map(key)), v = new Vector3(), attr = o.geometry.attributes.position
    for (let i = 0; i < attr.count; i++) { v.fromBufferAttribute(attr, i).applyMatrix4(o.matrixWorld); assert.ok(expected.has(key(v.toArray())), 'GLB vertex matches canonical global surface coordinates') }
  })
  assert.equal(meshIds.size, metadata.surfaces.length, 'all stable IDs survive the GLB round trip')
  assert.equal((await service.request(request())).cached, true)
  const changed = structuredClone(design); changed.model.brief.finish = 'premium'
  const second = await service.request(request(changed)), revised = await complete(service, second.id)
  assert.equal(revised.status, 'ready', JSON.stringify(revised)); assert.equal(revised.geometryKey, done.geometryKey); assert.equal(revised.geometryReused, true)
  assert.notEqual(revised.appearanceKey, done.appearanceKey)
  assert.ok(JSON.parse(await readFile(resolve(root, 'jobs', second.id, 'metadata.json'), 'utf8')).furniture.length > 50)
  const other = await service.request(request(design, 'other-project')); const otherDone = await complete(service, other.id)
  assert.notEqual(other.id, first.id); assert.equal(otherDone.geometryKey, done.geometryKey)
  const restart = createWalkthroughService({ root })
  assert.equal((await restart.status(first.id)).status, 'ready')
  const http = createServer((req, res) => restart.handle(req, res, async () => { throw new Error('unused') }).then(handled => { if (!handled) { res.statusCode = 404; res.end() } }))
  await new Promise(ok => http.listen(0, '127.0.0.1', ok))
  try {
    const base = `http://127.0.0.1:${http.address().port}/api/walkthrough-assets/${first.id}`
    const status = await fetch(base); assert.equal(status.status, 200); assert.equal((await status.json()).designId, building.planId)
    const head = await fetch(`${base}/house.glb`, { method: 'HEAD' }); assert.equal(head.headers.get('content-type'), 'model/gltf-binary'); assert.equal(Number(head.headers.get('content-length')), bytes.length)
    const meta = await fetch(`${base}/metadata.json`); assert.equal((await meta.json()).projectId, 'walkthrough-test')
    assert.equal((await fetch(base.replace(first.id, '0'.repeat(64)))).status, 404)
  } finally { await new Promise(ok => http.close(ok)) }
  await assert.rejects(async () => inspectWalkthroughGlb(bytes, 'wrong-plan'))
  const collisionPath = resolve(dir, 'collision.glb'), original = await readFile(collisionPath)
  await writeFile(collisionPath, original.subarray(0, 30)); assert.equal((await restart.status(first.id)).status, 'missing')
  await writeFile(collisionPath, original)
  console.log(JSON.stringify({ walkthroughAssetId: first.id, root, triangles: inspected.triangles, bytes: bytes.length, nodes: inspected.nodes, surfaces: meshIds.size, geometryReused: revised.geometryReused }))
})
