import test from 'node:test'
import assert from 'node:assert/strict'
import {budgetComparison} from '../src/lib/impact/budgetComparison.ts'

test('an unset budget never becomes a baseline or a within-budget claim',()=>{
 const input={budget:null,currentCost:11751343,swappedCost:11511642}
 const snapshot=structuredClone(input),result=budgetComparison(input)
 assert.equal(result.target,null)
 assert.equal(result.status,'missing')
 assert.equal(result.remaining,null)
 assert.equal(result.difference,239701)
 assert.ok(Math.abs(result.percent-2.0397753)<.00001)
 assert.deepEqual(input,snapshot)
})
test('target status and headroom follow changing target and estimate values',()=>{
 const inputs={budget:12000000,currentCost:11751343,swappedCost:11511642}
 assert.equal(budgetComparison(inputs).status,'within')
 assert.equal(budgetComparison(inputs).remaining,488358)
 assert.equal(budgetComparison({...inputs,budget:11000000}).status,'over')
 assert.equal(budgetComparison({...inputs,budget:11000000}).remaining,-511642)
 assert.equal(budgetComparison({...inputs,budget:11511642}).status,'on-target')
 assert.equal(budgetComparison({...inputs,swappedCost:12500000}).status,'over')
 assert.equal(budgetComparison({...inputs,swappedCost:12500000}).difference,-748657)
})
test('zero estimates, zero targets and increases are distinct from missing values',()=>{
 assert.equal(budgetComparison({budget:0,currentCost:0,swappedCost:0}).status,'on-target')
 assert.equal(budgetComparison({budget:0,currentCost:0,swappedCost:0}).percent,0)
 assert.equal(budgetComparison({budget:0,currentCost:10,swappedCost:5}).status,'over')
 const increase=budgetComparison({budget:null,currentCost:0,swappedCost:500})
 assert.equal(increase.difference,-500)
 assert.equal(increase.percent,null)
 assert.equal(increase.maximum,500)
})
test('invalid data is excluded rather than converted to a zero or a saving',()=>{
 for(const invalid of [NaN,Infinity,-1,undefined,'1000']){
  const target=budgetComparison({budget:invalid,currentCost:100,swappedCost:80})
  assert.equal(target.status,'invalid');assert.equal(target.target,null)
  const estimate=budgetComparison({budget:100,currentCost:invalid,swappedCost:80})
  assert.equal(estimate.ready,false);assert.equal(estimate.difference,null)
  assert.equal(estimate.percent,null)
  const proposed=budgetComparison({budget:100,currentCost:100,swappedCost:invalid})
  assert.equal(proposed.status,'incomplete');assert.equal(proposed.remaining,null)
  assert.equal(proposed.difference,null)
 }
})
