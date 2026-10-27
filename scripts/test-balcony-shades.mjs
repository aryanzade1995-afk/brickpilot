import assert from 'node:assert/strict'
import test from 'node:test'
import { Box3, BoxGeometry, Group, Mesh, MeshStandardMaterial } from 'three'
import { completeBalconyShades } from '../src/lib/three/balconyShades.ts'

function fixture(rotation=0) {
  const root=new Group(), building=new Group(), material=new MeshStandardMaterial()
  root.add(building); building.rotation.y=rotation; root.position.set(4,0,-3)
  const slab=new Mesh(new BoxGeometry(5,.2,2),material)
  slab.name='FF_Balcony_balcony1_Slab'; slab.position.set(1,3,2); slab.userData.source_id='FF:balcony1'
  const beam=new Mesh(new BoxGeometry(2.9,.14,1.84),material)
  beam.name='Grammar_Balcony_PartialWidth_01_Beam_001'; beam.position.set(-.05,5.7,2.08)
  beam.userData={grammar_category:'BALCONY',source_anchor_id:'FF:balcony1'}
  building.add(slab,beam)
  return {root,slab,beam}
}
test('saved balcony shades cover full source slab in both plan orientations without changing shared meshes',()=>{
  for(const rotation of [0,Math.PI/2]) {
    const {root,slab,beam}=fixture(rotation), before=beam.geometry.attributes.position.array.slice()
    assert.equal(completeBalconyShades(root),1)
    root.updateMatrixWorld(true)
    const cover=root.children.find(o=>o.userData.fullBalconyShade)
    const a=new Box3().setFromObject(slab), b=new Box3().setFromObject(cover), roof=new Box3().setFromObject(beam)
    for(const axis of ['x','z']) { assert.ok(Math.abs(a.min[axis]-b.min[axis])<1e-6); assert.ok(Math.abs(a.max[axis]-b.max[axis])<1e-6) }
    assert.ok(Math.abs(b.max.y-roof.max.y)<1e-6)
    assert.deepEqual(beam.geometry.attributes.position.array,before)
    assert.equal(cover.material,beam.material)
    assert.equal(completeBalconyShades(root),0,'reapplying cannot duplicate covers')
  }
})
test('untagged outdoor slabs and balconies without existing overhead structure remain unchanged',()=>{
  const {root,beam}=fixture(); beam.position.y=3.5
  assert.equal(completeBalconyShades(root),0)
  beam.position.y=5.7; delete beam.userData.source_anchor_id
  assert.equal(completeBalconyShades(root),0)
})
test('new full-footprint exported covers do not get a duplicate live shade',()=>{
  const {root,beam}=fixture(); beam.geometry=new BoxGeometry(5,.1,2); beam.position.set(1,5.7,2)
  assert.equal(completeBalconyShades(root),0)
})
