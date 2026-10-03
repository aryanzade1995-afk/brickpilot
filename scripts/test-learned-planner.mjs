import assert from 'node:assert/strict'
import test from 'node:test'
import rawModel from '../src/lib/engine/planner/ml/data/plan-model.json' with {type:'json'}
import {parsePlanModel,proposePlan,briefFeatures} from '../src/lib/engine/planner/ml/proposal.ts'
import {mlReviewBriefs} from './ml-review-data.mjs'
import {compile} from '../src/lib/model/canonical.ts'
import {generate} from '../src/lib/engine/generate.ts'
import {validate} from '../src/lib/rules/index.ts'
import {planFeatures} from '../src/lib/engine/planner/planDiversity.ts'
import {createBlenderInput} from './export-blender-input.mjs'

test('trained ResPlan artifact has validated finite weights and held-out evaluation',()=>{
 assert.ok(parsePlanModel(rawModel).success)
 assert.ok(rawModel.trainingCount>1000)
 assert.equal(rawModel.licence,'CC BY 4.0')
 assert.ok(rawModel.metrics.test.modelMSE<rawModel.metrics.test.meanBaselineMSE)
 assert.equal(parsePlanModel({...rawModel,weights:[[NaN]]}).success,false)
 assert.equal(parsePlanModel({...rawModel,scale:[0,0,0,0]}).success,false)
 assert.equal(parsePlanModel({...rawModel,exemplars:[]}).success,false)
})
test('learned proposals replay exactly, change with seeds and never mutate requirements',()=>{
 const {brief}=mlReviewBriefs()[8],model=compile(brief),before=JSON.stringify(model)
 assert.ok(briefFeatures(model).every(Number.isFinite))
 assert.deepEqual(proposePlan(model,7),proposePlan(model,7))
 assert.ok(new Set(Array.from({length:20},(_,i)=>proposePlan(model,i+1).exemplarId)).size>3)
 assert.equal(JSON.stringify(model),before)
})
test('20 varied briefs keep all hard checks and show actual coordinate changes',()=>{
 let changed=0,footprints=0
 for(const {name,brief} of mlReviewBriefs()){
  const model=compile(brief),before=generate(model,{seed:1,planner:'baseline'}),after=generate(model,{seed:1})
  assert.ok(validate(before).hardChecksPass,`baseline ${name}`)
  assert.ok(validate(after).hardChecksPass,`learned ${name}`)
  changed+=Number(JSON.stringify(before.floors)!==JSON.stringify(after.floors))
  footprints+=Number(JSON.stringify(planFeatures(before))!==JSON.stringify(planFeatures(after)))
  assert.deepEqual(generate(model,{massing:after.planFamily??after.massingType,seed:after.planSeed,recipe:after.planRecipe,planner:after.planProposal?'ml':'baseline'}).floors,after.floors,`replay ${name}`)
 }
 assert.ok(changed>=10,`${changed}/20 changed layouts`)
 assert.ok(footprints>=8,`${footprints}/20 changed footprints`)
})
test('auto large villa seeds change occupied silhouettes and preserve production Blender handoff',()=>{
 const {brief}=mlReviewBriefs()[8],model=compile(brief),signatures=new Set(),families=new Set()
 for(let seed=1;seed<=20;seed++){
  const d=generate(model,{seed});assert.ok(validate(d).hardChecksPass)
  signatures.add(JSON.stringify(planFeatures(d)));families.add(d.massingType)
  if(seed<=4){const input=createBlenderInput(d,41);assert.ok(input.buildingModel.floors.length>0)}
 }
 assert.ok(signatures.size>=3,`${signatures.size} silhouettes`)
 assert.ok(families.size>=3,`${families.size} families`)
})
