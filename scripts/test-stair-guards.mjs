import test from 'node:test'
import assert from 'node:assert/strict'
import {createStairGuards} from '../src/lib/walkthrough/stairGuards.ts'
import {defaultBrief} from '../src/lib/model/brief.ts'
import {compile} from '../src/lib/model/canonical.ts'
import {generate} from '../src/lib/engine/generate.ts'
import {createBuildingModel} from '../src/lib/engine/buildingModel.ts'
import {buildWalkthroughScene} from '../src/lib/walkthrough/scene.ts'
import {prepareWalkthroughGeometry} from '../src/lib/walkthrough/delivery.ts'
import {validate} from '../src/lib/rules/index.ts'
import {createBlenderInput} from './export-blender-input.mjs'
import {readFile} from 'node:fs/promises'
import {join} from 'node:path'
import {parseAcceptedVilla} from '../src/lib/three/acceptedVillaWalkthrough.ts'
import {Box3,Vector3} from 'three'

function fixture(side) {
  const rect={x:1000,y:2000,w:['N','S'].includes(side)?2400:3300,h:['N','S'].includes(side)?3300:2400}
  const world=(a,b)=>({N:[rect.x+a,rect.y+b],S:[rect.x+a,rect.y+rect.h-b],W:[rect.x+b,rect.y+a],E:[rect.x+rect.w-b,rect.y+a]}[side])
  const stair={id:'stair',floorId:'GF',rect,startSide:side,direction:'up',treads:Array.from({length:8},(_,i)=>[[0,1150],[1250,2400]].map(([a,b])=>[world(a,(i+1)*250),world(b,(i+1)*250)].map(([x,y])=>({x,y})))).flat()}
  return {stairs:[stair],floors:[{id:'GF',heightMm:3100,elevationMm:0}],quantityRules:{stairs:{waistMm:150,landingThicknessMm:180}}}
}

for(const side of ['N','S','E','W'])test(`guards follow ${side}-entry source nosings, keeping treads and portals clear`,()=>{
  const building=fixture(side),before=JSON.stringify(building),result=createStairGuards(building),r=building.stairs[0].rect
  assert.equal(result.issues.length,0);assert.equal(result.parts.filter(p=>p.kind==='handrail').length,2)
  assert.equal(JSON.stringify(building),before)
  for(const part of result.parts) {
    assert.equal(part.verticesMm.length,8);assert.equal(part.faces.length,6)
    for(const [x,y,z] of part.verticesMm) {
      const across=['N','S'].includes(side)?x-r.x:y-r.y
      assert.ok(across>1150 && across<1250,'Guard stays in the existing well, outside both clear flights')
      assert.ok(z>=-20 && z<=4140,'No exaggerated height or storey offset')
    }
    if(part.kind!=='handrail')assert.ok(part.toMm[2]>part.fromMm[2])
  }
  const ids=result.parts.map(p=>p.id);assert.equal(new Set(ids).size,ids.length)
  assert.deepEqual(createStairGuards(structuredClone(building)),result)
})

test('missing nosings or narrow well reports review rather than guessing another stair',()=>{
  const b=fixture('N');b.stairs[0].treads=[]
  const result=createStairGuards(b);assert.equal(result.parts.length,0);assert.equal(result.issues.length,1)
})

test('delivery uses identical guard vertices and references without changing house identity or source rooms',()=>{
  const brief=defaultBrief();brief.site.plotWidth=18;brief.site.plotDepth=24
  const design=generate(compile(brief),{seed:41}),building=createBuildingModel(design),before=JSON.stringify(building)
  const guards=createStairGuards(building),geometry=prepareWalkthroughGeometry(buildWalkthroughScene(building,validate(design)))
  assert.ok(guards.parts.length>10)
  for(const part of guards.parts) {
    const face=geometry.faces.find(f=>f.canonicalSurfaceId===part.id),collider=geometry.collision.colliders.find(c=>c.id===part.id)
    assert.ok(face && collider)
    assert.deepEqual(face.vertices,part.faces[0].map(i=>{const [x,y,z]=part.verticesMm[i];return [x/1000,z/1000,-y/1000]}))
  }
  assert.equal(JSON.stringify(building),before);assert.equal(geometry.planId,building.planId)
  assert.deepEqual(createBlenderInput(design,41).stairGuards,guards,'Blender receives this exact canonical layout')
})

test('accepted Blender GLB contains exactly the canonical guard parts at their original global coordinates',{skip:!process.env.WALKTHROUGH_VILLA_JOB},async()=>{
  const accepted=JSON.parse(await readFile(join(process.env.WALKTHROUGH_VILLA_JOB,'accepted.json'),'utf8'))
  const input=JSON.parse(await readFile(join(accepted.directory,'input.json'),'utf8')),guards=createStairGuards(input.buildingModel)
  const bytes=await readFile(join(accepted.directory,accepted.files.find(f=>f.endsWith('.glb')))),root=await parseAcceptedVilla(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),accepted.planId)
  const meshes=[];root.traverse(m=>{if(m.isMesh && m.userData.stair_guard_part_id)meshes.push(m)})
  assert.equal(meshes.length,guards.parts.length);assert.ok(meshes.length>20)
  for(const part of guards.parts) {
    const mesh=meshes.find(m=>m.userData.stair_guard_part_id===part.id);assert.ok(mesh)
    const actual=new Box3().setFromObject(mesh),expected=new Box3().setFromPoints(part.verticesMm.map(([x,y,z])=>new Vector3(x/1000,z/1000,-y/1000)))
    for(const side of ['min','max'])for(const axis of ['x','y','z'])assert.ok(Math.abs(actual[side][axis]-expected[side][axis])<.0021,`${part.id}: only 2mm edge bevel, no repositioning`)
  }
})
