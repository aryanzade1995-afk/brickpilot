import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { prepareVillaScene } from '../src/lib/three/prepareVillaScene.ts'

const visibleMeshes = root => {
  const meshes = []
  root.traverseVisible(object => { if (object.isMesh) meshes.push(object) })
  return meshes
}

test('static villa batching preserves bounds, transparency and hidden objects', () => {
  const source = new THREE.Group(), body = new THREE.Group()
  source.position.set(3, 2, 1); body.rotation.y = Math.PI / 2; source.add(body)
  const material = new THREE.MeshStandardMaterial({ color: 'white' })
  for (let i = 0; i < 80; i++) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), material)
    mesh.name = `Wall_${i}`; mesh.position.set(i * 2, 0, 0); body.add(mesh)
  }
  const glass = new THREE.MeshPhysicalMaterial({ transparent: true, opacity: .3, transmission: .7 })
  for (let i = 0; i < 2; i++) {
    const pane = new THREE.Mesh(new THREE.BoxGeometry(.03, 2, 1), glass)
    pane.name = `Glass_${i}`; pane.position.set(0, 0, i * 2); body.add(pane)
  }
  const hidden = new THREE.Group(); hidden.visible = false; source.add(hidden)
  hidden.add(new THREE.Mesh(new THREE.BoxGeometry(), material))
  const before = new THREE.Box3().setFromObject(source)
  const scene = prepareVillaScene(source, 8), after = new THREE.Box3().setFromObject(scene)
  assert.ok(before.min.distanceTo(after.min) < .01)
  assert.ok(before.max.distanceTo(after.max) < .01)
  assert.equal(visibleMeshes(scene).length, 3, '80 opaque meshes should make one draw call; glass stays separate')
  assert.equal(visibleMeshes(source).length, 82, 'source hierarchy must stay unchanged')
  assert.equal(visibleMeshes(scene).filter(mesh => mesh.material === glass).length, 2)
})

test('returning to the villa shares repaired geometry but owns an independent hierarchy', () => {
  const source = new THREE.Group(), material = new THREE.MeshStandardMaterial()
  for (let i = 0; i < 2; i++) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), material)
    mesh.name = `Wall_${i}`; mesh.position.x = i; source.add(mesh)
  }
  const positions = source.children.map(mesh => Array.from(mesh.geometry.attributes.position.array))
  const first = prepareVillaScene(source, 8), second = prepareVillaScene(source, 8)
  const a = visibleMeshes(first), b = visibleMeshes(second)
  assert.notEqual(first, second); assert.notEqual(a[0], b[0])
  assert.equal(a[0].geometry, b[0].geometry, 'remount must reuse the prepared GPU geometry')
  first.remove(a[0]); assert.equal(visibleMeshes(second).length, 1)
  assert.deepEqual(source.children.map(mesh => Array.from(mesh.geometry.attributes.position.array)), positions)
})
