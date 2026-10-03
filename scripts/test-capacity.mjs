import assert from 'node:assert/strict'
import test from 'node:test'
import { defaultBrief } from '../src/lib/model/brief.ts'
import { assessBriefFit, canIncreaseBrief, evaluateBriefChoice } from '../src/lib/engine/planner/fit.ts'
import { generate } from '../src/lib/engine/generate.ts'
import { compile } from '../src/lib/model/canonical.ts'
import { validate } from '../src/lib/rules/index.ts'
test('every allowed capacity fixture produces a plan passing room minimums and all hard checks',()=>{
 let allowed=0, blocked=0
 for(let i=0;i<20;i++) {
  const b=defaultBrief(); b.site.plotWidth=10+(i%5)*3; b.site.plotDepth=14+(i%4)*4
  b.levels.storeys=i%3; b.rooms.bedroomsWithBath=1+i%5; b.rooms.bedroomsNoBath=i%3
  b.site.openSpace.mode=['auto','perSide','chosenSides','maxBuild'][i%4]
  if(assessBriefFit(b).fits){ allowed++; const d=generate(compile(b)); assert.ok(validate(d).hardChecksPass,JSON.stringify(validate(d).findings)) }
  else blocked++
 }
 assert.ok(allowed>0 && blocked>0)
})

test('manual choices and suggestions cannot replace a valid brief with an impossible programme',()=>{
 const b=defaultBrief(); b.site.plotWidth=22;b.site.plotDepth=26;b.levels.storeys=1
 assert.ok(assessBriefFit(b).fits)
 const before=JSON.stringify(b)
 const rejected=evaluateBriefChoice(b,c=>{c.rooms.bedroomsWithBath=50})
 assert.equal(rejected.allowed,false)
 assert.equal(JSON.stringify(rejected.brief),before)
 assert.match(rejected.reason,/previous selection is kept/)
 const finish=evaluateBriefChoice(b,c=>{c.specs.overrides={}})
 assert.equal(finish.allowed,true)
 const accepted=evaluateBriefChoice(b,c=>{c.site.plotWidth=24})
 assert.ok(accepted.allowed)
 assert.ok(validate(generate(compile(accepted.brief))).hardChecksPass)
 assert.equal(JSON.stringify(b),before)
})
test('impossible room and member increments are blocked and checks do not mutate the brief',()=>{
 const b=defaultBrief(); b.site.plotWidth=9; b.site.plotDepth=11; b.levels.storeys=0
 const before=JSON.stringify(b)
 assert.equal(canIncreaseBrief(b,c=>{c.rooms.bedroomsWithBath+=1}),false)
 assert.equal(canIncreaseBrief(b,c=>{c.household.members.push({role:'senior',needsGroundFloor:true})}),false)
 assert.equal(JSON.stringify(b),before)
 b.site.plotWidth=22;b.site.plotDepth=26;b.levels.storeys=2
 assert.equal(assessBriefFit(b).fits,true)
})
