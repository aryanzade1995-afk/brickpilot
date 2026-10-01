import assert from 'node:assert/strict'
import test from 'node:test'
import { defaultBrief, briefSchema } from '../src/lib/model/brief.ts'
import { compile } from '../src/lib/model/canonical.ts'
import { generate } from '../src/lib/engine/generate.ts'
import { costPerSqmAllIn, estimateCost } from '../src/lib/cost/index.ts'
import { FAMILY_FACTOR, FINISH_RATE_PER_SQM, STYLE_FACTOR, constructionRate } from '../src/lib/cost/rates.ts'
const design = generate(compile(defaultBrief()))
test('construction estimate retains its cost band, allowances and explicit assumptions', () => {
 const c = estimateCost(design)
 assert.ok(c.total.low > 0 && c.total.high > c.total.low)
 assert.equal(c.expected, (c.total.low+c.total.high)/2)
 assert.ok(c.basis.includes('Mid-range') && c.basis.includes('construction'))
 for (const name of ['Base building works','External works allowance','Professional fees allowance','Contingency']) assert.ok(c.lines.some(l=>l.label===name))
 assert.ok(c.excluded.some(x=>x.startsWith('Interiors')))
 assert.ok(!('budget' in c))
 assert.ok(Math.abs(costPerSqmAllIn(design.model.brief,design.structure.family)*design.builtAreaSqm-c.expected)<1)
})
test('construction rates retain style, floors and footprint factors',()=>{
 for(const f of Object.values(STYLE_FACTOR)) assert.ok(f>=.9 && f<=1.3)
 assert.equal(constructionRate(defaultBrief()),FINISH_RATE_PER_SQM.mid)
 assert.equal(constructionRate(defaultBrief(),'courtyard'),FINISH_RATE_PER_SQM.mid*FAMILY_FACTOR.courtyard)
})
test('legacy spending fields are silently discarded without affecting plan or estimate',()=>{
 const a=defaultBrief(), b=briefSchema.parse({...a,budget:{amountLakh:5,finish:'premium',scope:'all'}})
 assert.deepEqual(a,b)
 assert.ok(!('budget' in b))
 const other=generate(compile(b))
 assert.deepEqual(other,design)
 assert.deepEqual(estimateCost(other),estimateCost(design))
})
