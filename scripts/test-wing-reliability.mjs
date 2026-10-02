import assert from 'node:assert/strict'
import test from 'node:test'
import {defaultBrief,briefSchema} from '../src/lib/model/brief.ts'
import {compile} from '../src/lib/model/canonical.ts'
import {generate} from '../src/lib/engine/generate.ts'
import {validate} from '../src/lib/rules/index.ts'
import {assessBriefFit,assessShape,SHAPE_CHOICES} from '../src/lib/engine/planner/fit.ts'

test('four wing choices build their exact family for ordinary and large villas, G through G+3 and different seeds',()=>{
 for(const type of ['villa','large-villa'])for(const [w,h] of [[24,30],[30,40],[40,60]])for(const storeys of [0,1,2,3]){
  const brief=defaultBrief();brief.project.buildingType=type;brief.site.plotWidth=w;brief.site.plotDepth=h;brief.levels.storeys=storeys
  const model=compile(brief)
  for(const family of SHAPE_CHOICES)for(const seed of [1,41,100]){
   const plan=generate(model,{massing:family,seed}),report=validate(plan)
   const context=`${type} ${w}x${h} G+${storeys} ${family} seed ${seed}`
   assert.equal(plan.massingType,family,context)
   assert.ok(report.hardChecksPass,`${context}: ${JSON.stringify(report.findings.filter(f=>f.severity==='error'))}`)
   assert.ok(plan.floors.every(f=>f.reachable),context)
  }
 }
})

test('unavailable wing shapes fail capacity rather than accepting a rectangular substitute; legacy choices still load',()=>{
 const brief=defaultBrief();brief.site.plotWidth=10;brief.site.plotDepth=14
 for(const family of SHAPE_CHOICES){
  brief.style.massing=family
  const plan=generate(compile(brief),{massing:family,seed:100})
  assert.ok(!validate(plan).hardChecksPass)
  if(plan.massingType!==family)assert.ok(validate(plan).findings.some(f=>f.code==='REQUESTED_MASSING_UNAVAILABLE'))
  assert.equal(assessShape(brief,family).ok,false)
  assert.equal(assessBriefFit(brief).fits,false)
 }
 for(const legacy of ['rectangular','l-shape','courtyard'])assert.equal(briefSchema.parse({style:{massing:legacy}}).style.massing,legacy)
})

test('live wing availability respects open-space settings and the same passing seed replays every floor',()=>{
 for(const mode of ['auto','perSide','chosenSides','maxBuild'])for(const family of SHAPE_CHOICES){
  const brief=defaultBrief();brief.site.plotWidth=40;brief.site.plotDepth=60;brief.style.massing=family
  brief.site.openSpace.mode=mode
  if(mode==='perSide')brief.site.openSpace.metres={N:3,E:3,S:6,W:3}
  if(mode==='chosenSides'){brief.site.openSpace.sides=['E','W'];brief.site.openSpace.amount=4}
  const plan=generate(compile(brief),{massing:family})
  assert.equal(assessShape(brief,family).ok,true,`${mode}: ${family}`)
  assert.equal(assessBriefFit(brief).fits,true,`${mode}: ${family}`)
  assert.ok(validate(plan).hardChecksPass)
  assert.deepEqual(generate(compile(brief),{massing:family,seed:plan.planSeed}),plan)
 }
})
