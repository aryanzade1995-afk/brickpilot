import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {Group,Mesh,BoxGeometry,MeshStandardMaterial} from 'three'
import {defaultBrief} from '../src/lib/model/brief.ts'
import {generateAlternativeDesign} from '../src/lib/engine/generateAlternativeDesign.ts'
import {prepareVillaScene} from '../src/lib/three/prepareVillaScene.ts'

test('garden shade is optional and never creates a tall default forecourt structure',()=>{
 assert.equal(defaultBrief().rooms.priorities.gardenShade,false)
 const plan=JSON.parse(readFileSync(new URL('./fixtures/walkthrough-room-regression.json',import.meta.url)))
 const before=JSON.stringify(plan)
 for(const seed of [1,6,2932]){
  const result=generateAlternativeDesign(plan,seed)
  assert.ok(!result.massingModel.masses.some(m=>m.id==='forecourt-canopy'||m.id.startsWith('exterior-pier-')))
 }
 assert.equal(JSON.stringify(plan),before)
 plan.model.brief.rooms.priorities.gardenShade=true
 plan.model.brief.rooms.priorities.garden=true
 const enabled=generateAlternativeDesign(plan,2932)
 for(const m of enabled.massingModel.masses.filter(m=>m.id==='forecourt-canopy'))
  assert.ok(m.elevation<=enabled.buildingModel.floors[0].elevationMm+2750)
})

test('old exported canopy is removed from default display without changing source buffers or parking',()=>{
 const root=new Group()
 for(const name of ['EnvelopeCanopy_forecourt-canopy','EnvelopePier_exterior-pier-0','EnvelopeFoundation_exterior-pier-0','GF_parking_Roof_01_Post_01']){
  const mesh=new Mesh(new BoxGeometry(1,1,1),new MeshStandardMaterial());mesh.name=name;root.add(mesh)
 }
 const prepared=prepareVillaScene(root,1)
 assert.equal(root.children.length,4)
 assert.equal(prepared.children.length,1)
 assert.ok(prepared.getObjectByName('GF_parking_Roof_01_Post_01'))
 assert.ok(prepareVillaScene(root,1,false,true).children.length>1)
})
