import test from 'node:test'
import assert from 'node:assert/strict'
import {defaultBrief} from '../src/lib/model/brief.ts'
import {compile} from '../src/lib/model/canonical.ts'
import {generate} from '../src/lib/engine/generate.ts'
import {generateAlternativeDesign} from '../src/lib/engine/generateAlternativeDesign.ts'
import {PARKING_WIDTH,PARKING_DEPTH} from '../src/lib/engine/planner/program.ts'
import {hideBakedPipelines} from '../src/lib/three/pipelineVisibility.ts'
import {Group,Mesh} from 'three'

test('compact parking retains a full-size car and four corner canopy pillars',()=>{
  const brief=defaultBrief();brief.site.plotWidth=22;brief.site.plotDepth=30
  const design=generate(compile(brief),{seed:41,massing:'stepped'})
  const bay=design.floors[0].rooms.find(r=>r.id==='parking')
  assert.equal(bay.rect.w,PARKING_WIDTH);assert.equal(bay.rect.h,PARKING_DEPTH)
  const villa=generateAlternativeDesign(design,6),covered=villa.facadeGrammar.coveredOutdoor
  const roofs=covered.roofs.filter(r=>r.roomId===bay.semanticId)
  assert.equal(roofs.length,1)
  assert.equal(roofs[0].posts.length,4)
  assert.equal(covered.cars.filter(r=>r.roomId===bay.semanticId).length,1)
  assert.deepEqual(covered.issues,[])
})

test('baked service pipes stay hidden without hiding walls or roof tanks',()=>{
  const root=new Group(),pipe=new Mesh(),legacy=new Mesh(),wall=new Mesh(),tank=new Mesh()
  pipe.userData.formstead_plumbing=true;legacy.name='Service_water_001';wall.name='GF_Wall_001';tank.name='Roof_WaterTank_1'
  root.add(pipe,legacy,wall,tank);hideBakedPipelines(root)
  assert.equal(pipe.visible,false);assert.equal(legacy.visible,false)
  assert.equal(wall.visible,true);assert.equal(tank.visible,true)
})
