import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { Group, Mesh, BoxGeometry, MeshStandardMaterial, Vector3 } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { acceptedVillaUrl, parseAcceptedVilla, acceptedVillaCollision, acceptedVillaBounds } from '../src/lib/three/acceptedVillaWalkthrough.ts'
import { HouseWalkingSimulation, initializeWalkingPhysics } from '../src/lib/walkthrough/navigation.ts'

function fixture(planId = 'accepted-plan') {
  const binary = Buffer.alloc(36)
  ;[0, 0, 0, 2, 0, 0, 0, 2, 0].forEach((v, i) => binary.writeFloatLE(v, i * 4))
  const doc = { asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }],
    nodes: [{ name: 'OriginalRoot', translation: [4, 2, -5], children: [1] }, { name: 'OriginalFurnishedMesh', mesh: 0, extras: { source_plan_id: planId, source_id: 'original-piece' } }],
    buffers: [{ byteLength: 36 }], bufferViews: [{ buffer: 0, byteLength: 36 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [2, 2, 0] }],
    materials: [{ name: 'OriginalFinish', pbrMetallicRoughness: { baseColorFactor: [.3, .5, .7, 1], metallicFactor: .7, roughnessFactor: .23 } }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }] }
  const json = Buffer.from(JSON.stringify(doc)), padding = Buffer.alloc((4 - json.length % 4) % 4, 32), n = json.length + padding.length
  const out = Buffer.alloc(28 + n + binary.length)
  out.writeUInt32LE(0x46546c67); out.writeUInt32LE(2, 4); out.writeUInt32LE(out.length, 8)
  out.writeUInt32LE(n, 12); out.writeUInt32LE(0x4e4f534a, 16); json.copy(out, 20); padding.copy(out, 20 + json.length)
  out.writeUInt32LE(binary.length, 20 + n); out.writeUInt32LE(0x004e4942, 24 + n); binary.copy(out, 28 + n)
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength)
}
function snapshot(scene) {
  scene.updateMatrixWorld(true)
  const result = []
  scene.traverse(o => result.push({ name: o.name, extras: o.userData, matrix: o.matrixWorld.toArray(),
    vertices: o instanceof Mesh ? [...o.geometry.attributes.position.array] : null,
    material: o instanceof Mesh ? { name: o.material.name, color: o.material.color.toArray(), roughness: o.material.roughness, metalness: o.material.metalness } : null }))
  return result
}

test('accepted villa loader uses the Massing URL and rejects another export or origin', () => {
  const url = '/api/villas/404b8453-156b-4285-b8c5-4d96d70d435d/files/villa_1.glb'
  assert.equal(acceptedVillaUrl(url), url)
  for (const invalid of ['https://example.com/villa.glb', '/api/walkthrough-assets/house.glb', '/api/villas/../files/villa.glb']) assert.throws(() => acceptedVillaUrl(invalid))
})
test('exact loader preserves the original hierarchy, transforms, mesh data and embedded materials', async () => {
  const bytes = fixture(), raw = (await new GLTFLoader().parseAsync(bytes, '')).scene
  const exact = await parseAcceptedVilla(bytes, 'accepted-plan')
  assert.deepEqual(snapshot(exact), snapshot(raw))
  const before = snapshot(exact), collision = acceptedVillaCollision(exact)
  assert.deepEqual(snapshot(exact), before)
  assert.deepEqual([...collision.vertices], [4, 2, -5, 6, 2, -5, 4, 4, -5])
  collision.vertices[0] = 999
  assert.deepEqual(snapshot(exact), before, 'physics owns a copy, never mutates displayed buffers')
})
test('exact loader rejects mismatched house identity instead of falling back to a reconstructed house', async () => {
  await assert.rejects(parseAcceptedVilla(fixture(), 'another-plan'), /does not match/)
})
test('collision retains parent transforms and mirrored triangle orientation', () => {
  const scene = new Group(), parent = new Group(), mesh = new Mesh(new BoxGeometry(1, 2, 3), new MeshStandardMaterial())
  parent.position.set(7, 2, -8); parent.rotation.y = Math.PI / 2; parent.scale.x = -1; parent.add(mesh); scene.add(parent)
  const before = snapshot(scene), collision = acceptedVillaCollision(scene), p = new Vector3().fromBufferAttribute(mesh.geometry.attributes.position, 0).applyMatrix4(mesh.matrixWorld)
  assert.deepEqual([...collision.vertices.slice(0, 3)], p.toArray())
  assert.deepEqual([...collision.indices.slice(0, 3)], [0, 1, 2].map((_, i) => mesh.geometry.index.getX(i === 0 ? 0 : 3 - i)))
  assert.deepEqual(snapshot(scene), before)
})
test('camera frames the villa without removing or resizing the exported presentation ground', () => {
  const scene = new Group(), villa = new Mesh(new BoxGeometry(10, 6, 12), new MeshStandardMaterial()), backdrop = new Mesh(new BoxGeometry(200, .1, 200), new MeshStandardMaterial())
  backdrop.userData.presentation_only = true; scene.add(villa, backdrop)
  const before = snapshot(scene)
  assert.deepEqual(acceptedVillaBounds(scene).getSize(new Vector3()).toArray(), [10, 6, 12])
  assert.deepEqual(snapshot(scene), before)
  assert.equal(acceptedVillaCollision(scene).indices.length, 72, 'ground is still in the actual displayed/collision scene')
})

test('walking collides with the exact displayed mesh, ignoring reconstructed shell and furniture', async () => {
  await initializeWalkingPhysics()
  const scene = new Group(), material = new MeshStandardMaterial()
  const add = (size, position) => { const mesh = new Mesh(new BoxGeometry(...size), material); mesh.position.set(...position); scene.add(mesh) }
  add([6, .2, 6], [3, -.1, -3]); add([.2, 3, 6], [2, 1.5, -3])
  const identity = { designId: 'exact', projectId: 'project', geometryKey: 'same-url', appearanceKey: 'same-url' }
  const metadata = { ...identity, floors: [{ sourceId: 'GF', level: 0, elevationM: 0 }], rooms: [{ id: 'hall', floorId: 'GF', name: 'Hall', rectMm: { x: 0, y: 0, w: 6000, h: 6000 } }],
    entries: [{ id: 'MAIN', roomId: 'hall', floorId: 'GF', position: [1, 0, -1] }], openings: [{ id: 'MAIN', kind: 'entry', sourceId: 'MAIN_ENTRANCE' }], stairs: [], issues: [] }
  // This proxy deliberately blocks the spawn. Exact mode must ignore it.
  const collision = { ...identity, version: 1, units: 'm', coordinates: 'metres-x-plan-east-y-up-z-plan-north',
    colliders: [{ id: 'unrelated-proxy', min: [0, 0, -2], max: [1.8, 3, 0] }], doors: [] }
  const before = snapshot(scene), sim = new HouseWalkingSimulation(metadata, collision, 'exact', acceptedVillaCollision(scene))
  try {
    for (let i = 0; i < 240; i++) sim.step({ forward: 0, right: 1, yaw: 0 })
    assert.ok(sim.feet.x > 1.5 && sim.feet.x < 1.8, `wall position: ${sim.feet.x}`)
    assert.equal(sim.doors.size, 0, 'no synthetic doors or invisible doorway animations')
    assert.deepEqual(snapshot(scene), before)
  } finally { sim.dispose() }
})

test('real accepted Massing GLB parses without a replacement scene and supports its source entrance', { skip: !process.env.ACCEPTED_VILLA_GLB }, async () => {
  const bytes = await readFile(process.env.ACCEPTED_VILLA_GLB), metadata = JSON.parse(await readFile(process.env.ACCEPTED_VILLA_METADATA, 'utf8'))
  const collision = JSON.parse(await readFile(process.env.ACCEPTED_VILLA_COLLISION, 'utf8'))
  const scene = await parseAcceptedVilla(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), metadata.designId)
  const before = snapshot(scene), triangles = acceptedVillaCollision(scene)
  await initializeWalkingPhysics()
  const sim = new HouseWalkingSimulation(metadata, collision, metadata.designId, triangles)
  try { assert.ok(sim.grounded); assert.ok(triangles.indices.length > 1000); assert.deepEqual(snapshot(scene), before); console.log(`Exact accepted villa: ${triangles.indices.length / 3} triangles; entrance ${JSON.stringify(sim.feet)}`) } finally { sim.dispose() }
})
