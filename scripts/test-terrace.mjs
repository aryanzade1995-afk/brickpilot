import test from 'node:test'
import assert from 'node:assert/strict'
import { defaultBrief } from '../src/lib/model/brief.ts'
import { compile } from '../src/lib/model/canonical.ts'
import { generate } from '../src/lib/engine/generate.ts'
import { validate } from '../src/lib/rules/index.ts'
import { terraceLayout,terraceFreeRatio } from '../src/lib/engine/terrace.ts'
import { generateAlternativeDesign } from '../src/lib/engine/generateAlternativeDesign.ts'
import { buildMassing } from '../src/lib/three/buildMassing.ts'
test('top terrace services fit the real roof union and leave at least eighty percent clear',()=>{
 for(const mode of ['auto','maxBuild','perSide','chosenSides']){
  const b=defaultBrief();b.site.plotWidth=24;b.site.plotDepth=28;b.site.openSpace.mode=mode
  const d=generate(compile(b)), t=terraceLayout(d)
  assert.ok(validate(d).hardChecksPass);assert.ok(t);assert.equal(t.pergola,null)
  assert.ok(terraceFreeRatio(t)>=.8)
  const out=generateAlternativeDesign(d,12)
  assert.ok(!out.massingModel.masses.some(m=>m.usage==='roof'))
  assert.ok(out.facadeGrammar.specialized.assemblies.filter(a=>a.category==='ROOFLINE').every(a=>a.type==='FLAT_PARAPET'))
  assert.ok(!buildMassing(d).boxes.some(o=>o.id.startsWith('sig-')))
 }
})
test('terrace free-area hard check rejects oversize headroom',()=>{
 const d=generate(compile(defaultBrief())), top=d.floors.at(-1)
 top.stair.rect={...top.outline}
 assert.ok(validate(d).findings.some(f=>f.code==='TERRACE_FREE_AREA'))
})

test('ground-only villas still have a real stair to the usable terrace',()=>{
 const b=defaultBrief();b.levels.storeys=0;b.site.plotWidth=24;b.site.plotDepth=28
 const d=generate(compile(b));assert.ok(validate(d).hardChecksPass)
 assert.ok(d.floors[0].stair);assert.ok(terraceLayout(d).mumty)
 const altered=structuredClone(d);delete altered.floors[0].stair
 assert.ok(validate(altered).findings.some(f=>f.code==='TERRACE_ACCESS'))
})
