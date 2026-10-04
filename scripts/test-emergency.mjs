import test from 'node:test'
import assert from 'node:assert/strict'
import {defaultBrief} from '../src/lib/model/brief.ts'
import {compile} from '../src/lib/model/canonical.ts'
import {generate} from '../src/lib/engine/generate.ts'
import {validate} from '../src/lib/rules/index.ts'
import {withEmergencyExit,emergencyPlan,outsideEscapePath,ESCAPE_LIMITS} from '../src/lib/engine/safety.ts'
import {createBuildingModel} from '../src/lib/engine/buildingModel.ts'
import {buildMassing} from '../src/lib/three/buildMassing.ts'

function plan(family='rectangular',floors=2){const b=defaultBrief();b.site.plotWidth=28;b.site.plotDepth=32;b.levels.floors=floors;
  return generate(compile(b),{seed:41,massing:family})}
for(const family of ['rectangular','twin-wing','u-wing','courtyard-ring','pavilion'])test(`${family}: escape doors preserve authoritative rooms and pass the existing hard checks`,()=>{
  const d=plan(family),s=emergencyPlan(d),door=d.floors[0].openings.find(o=>o.emergencyExit)
  assert.ok(validate(d).hardChecksPass,JSON.stringify(validate(d).findings.filter(f=>f.severity==='error')))
  assert.ok(door,`${family} needs a secondary exit on this generous site`)
  assert.ok(outsideEscapePath(d,door).length>1)
  assert.equal(door.width,ESCAPE_LIMITS.doorWidthMm)
  assert.equal(door.rooms[1],null)
  const again=withEmergencyExit(d);assert.deepEqual(again,d)
  const removed=structuredClone(d);removed.floors[0].openings=removed.floors[0].openings.filter(o=>!o.emergencyExit);removed.openingCounts.doors--
  const readded=withEmergencyExit(removed)
  assert.deepEqual(readded.floors.map(f=>f.rooms),d.floors.map(f=>f.rooms))
  assert.deepEqual(readded.floors.map(f=>f.footprint),d.floors.map(f=>f.footprint))
  assert.deepEqual(readded.floors[0].openings,d.floors[0].openings)
  assert.equal(s.secondaryExitId,door.id)
  for(const r of s.routes)for(const id of r.openingIds)assert.ok(d.floors[r.level].openings.some(o=>(o.id??`${o.at.x}:${o.at.y}`)===id))
  assert.ok(s.notes.some(n=>n.includes('not an independent')))
  assert.ok(createBuildingModel(d).emergency.markers.some(m=>m.kind==='alarm'))
  assert.ok(buildMassing(d).boxes.some(b=>b.id==='secondary-exit-leaf'))
  assert.ok(buildMassing(d).boxes.some(b=>b.kind==='safety'&&b.color==='#278259'))
})
test('a blocked exterior route is rejected, not advertised as an exit',()=>{
  const d=plan(),door=d.floors[0].openings.find(o=>o.emergencyExit);assert.ok(door)
  d.siteFeatures.push({id:'block',kind:'pool',covered:false,rect:{x:0,y:0,w:d.model.plot.width,h:d.model.plot.depth}})
  assert.equal(outsideEscapePath(d,door).length,0)
  assert.ok(validate(d).findings.some(f=>f.code==='EMERGENCY_EXIT_INVALID'))
})
test('a legacy plan has honest escape guidance and no invented upper-floor exterior door',()=>{
  const d=plan();d.floors[0].openings=d.floors[0].openings.filter(o=>!o.emergencyExit)
  const s=emergencyPlan(d);assert.equal(s.secondaryExitId,null);assert.ok(s.notes.some(n=>n.includes('could not fit')))
  assert.ok(s.routes.filter(r=>r.level>0).every(r=>r.destination==='Stair → ground exit'))
  assert.match(s.disclaimer,/qualified architect/)
})
