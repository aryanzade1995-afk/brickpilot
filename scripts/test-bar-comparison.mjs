import test from 'node:test'
import assert from 'node:assert/strict'
import {comparisonData,comparisonValue} from '../src/lib/impact/barComparison.ts'

test('cost visuals use supplied amounts, distinguish changes and leave source data intact',()=>{
 const rows=[{label:'Structure',currentVal:3541647.077,swappedVal:3541647.077,unit:'₹'},{label:'Finishes',currentVal:100000,swappedVal:80000,unit:'₹'}]
 const before=structuredClone(rows),model=comparisonData(rows)
 assert.equal(model.current,3641647.077);assert.equal(model.proposed,3621647.077)
 assert.equal(model.difference,20000);assert.equal(model.changed,1)
 assert.equal(model.maximum,3541647.077);assert.deepEqual(rows,before)
 assert.equal(comparisonValue(rows[0].currentVal,'₹'),'₹35,41,647')
})
test('zero values are genuine zeros; missing data is never converted into a cost saving',()=>{
 const zero=comparisonData([{label:'Empty allowance',currentVal:0,swappedVal:0,unit:'₹'}])
 assert.equal(zero.maximum,0);assert.equal(zero.difference,0);assert.equal(zero.changed,0)
 for(const bad of [NaN,Infinity,-10]){
  const model=comparisonData([{label:'Unverified',currentVal:bad,swappedVal:0,unit:'₹'}])
  assert.equal(model.rows[0].valid,false);assert.equal(model.current,null);assert.equal(model.difference,null)
 }
 assert.equal(comparisonData([]).current,null)
})
test('non-cost units remain intact, mixed units are not summed, and cost increases remain negative differences',()=>{
 const doors=comparisonData([{label:'Door',currentVal:850,swappedVal:900,unit:'mm'}])
 assert.equal(doors.current,null);assert.equal(doors.maximum,900)
 assert.equal(comparisonValue(850,'mm'),'850 mm')
 const mixed=comparisonData([{label:'A',currentVal:100,swappedVal:90,unit:'₹'},{label:'B',currentVal:850,swappedVal:900,unit:'mm'}])
 assert.equal(mixed.current,null);assert.equal(mixed.maximum,0)
 const increase=comparisonData([{label:'A',currentVal:100,swappedVal:120,unit:'₹'}])
 assert.equal(increase.difference,-20)
})
