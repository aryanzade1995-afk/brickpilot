import assert from 'node:assert/strict'
import test from 'node:test'
import {defaultBrief} from '../src/lib/model/brief.ts'
import {compile} from '../src/lib/model/canonical.ts'
import {generate} from '../src/lib/engine/generate.ts'
import {planFeatures,planDistance,diversePlans} from '../src/lib/engine/planner/planDiversity.ts'
test('plan diversity uses occupied footprints and anchors and is deterministic',()=>{
 const b=defaultBrief();b.project.buildingType='large-villa';b.site.plotWidth=40;b.site.plotDepth=50
 const a=generate(compile(b),{massing:'twin-wing',seed:1})
 const c=generate(compile(b),{massing:'u-wing',seed:2})
 assert.equal(planFeatures(a).length,1024)
 assert.equal(planDistance(a,a),0)
 assert.ok(planDistance(a,c)>0)
 const pool=[{plan:a},{plan:structuredClone(a)},{plan:c}]
 assert.equal(diversePlans(pool,2)[1].plan,c)
 assert.deepEqual(diversePlans(pool,2),diversePlans(pool,2))
})
