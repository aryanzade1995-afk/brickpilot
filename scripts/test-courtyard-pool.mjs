import test from 'node:test'
import assert from 'node:assert/strict'
import {defaultBrief} from '../src/lib/model/brief.ts'
import {compile} from '../src/lib/model/canonical.ts'
import {generate} from '../src/lib/engine/generate.ts'
import {SITE_FORM_VERSION} from '../src/lib/engine/siteForm.ts'
import {validate} from '../src/lib/rules/index.ts'
import {courtyardPoolRect,courtyardPoolFits,placeSiteFeatures,validateSiteFeatures} from '../src/lib/engine/planner/siteFeatures.ts'
import {createBuildingModel} from '../src/lib/engine/buildingModel.ts'

test('courtyard plunge pools rotate to fit and reserve a full metre around all sides',()=>{
 for(const court of [{x:4000,y:5000,w:5000,h:6500},{x:4000,y:5000,w:6500,h:3900}]){
  const pool=courtyardPoolRect(court)
  assert.ok(pool&&courtyardPoolFits(pool,court))
  assert.ok(pool.w*pool.h<=6e6)
 }
 assert.equal(courtyardPoolRect({x:0,y:0,w:3000,h:5000}),null)
})

test('real courtyard plans place one pool inside the sky void without covering doors, rooms or lawns',()=>{
 for(const massing of ['courtyard-ring','courtyard']){
  const b=defaultBrief();b.site.plotWidth=25;b.site.plotDepth=30;b.style.character='modern-box';b.rooms.pool=true;b.rooms.priorities.courtyard=true
  const design=generate(compile(b),{massing,seed:41,formVersion:SITE_FORM_VERSION})
  assert.ok(validate(design).hardChecksPass,JSON.stringify(validate(design).findings.filter(f=>f.severity==='error')))
  const pools=design.siteFeatures.filter(f=>f.kind==='pool')
  assert.equal(pools.length,1)
  assert.equal(pools[0].roomId,'courtyard')
  assert.ok(courtyardPoolFits(pools[0].rect,design.floors[0].courtyard))
  assert.deepEqual(validateSiteFeatures(design.model,design.floors[0],design.siteFeatures),[])
  assert.deepEqual(createBuildingModel(design).siteFeatures,design.siteFeatures)
  const replay=generate(compile(b),{massing:design.planFamily??design.massingType,seed:design.planSeed,recipe:design.planRecipe,formVersion:design.formVersion,planner:design.planProposal?'ml':'baseline'})
  assert.deepEqual(replay.siteFeatures,design.siteFeatures)
  const rebuilt=placeSiteFeatures(design.model,design.floors[0],{pool:pools[0].rect},true)
  assert.deepEqual(rebuilt.features.find(f=>f.kind==='pool').rect,pools[0].rect)
 }
})
