import test from 'node:test'
import assert from 'node:assert/strict'
import {tankArrivalSeconds,tankFillPreview} from '../src/lib/water/tankFillPreview.ts'

test('tank stays empty until the illustrative pipe front reaches its inlet',()=>{
  const points=[{x:0,y:0,z:6000},{x:0,y:0,z:1500},{x:1800,y:0,z:1500}],before=JSON.stringify(points)
  const arrival=tankArrivalSeconds(points)
  assert.equal(arrival,7.5)
  assert.equal(tankFillPreview(0,arrival),0)
  assert.equal(tankFillPreview(arrival,arrival),0)
  assert.equal(tankFillPreview(arrival+12,arrival),.45)
  assert.equal(tankFillPreview(arrival+24,arrival),.9)
  assert.equal(tankFillPreview(1e6,arrival),.9)
  assert.equal(JSON.stringify(points),before)
})
test('preview preserves a paused level and rejects invalid time and coordinate data',()=>{
  const elapsed=18,delay=6,paused=tankFillPreview(elapsed,delay)
  assert.equal(tankFillPreview(elapsed,delay),paused)
  assert.ok(tankFillPreview(elapsed+1,delay)>paused)
  for(const invalid of [-1,NaN,Infinity]){
    assert.throws(()=>tankFillPreview(invalid,0),RangeError)
    assert.throws(()=>tankFillPreview(0,invalid),RangeError)
  }
  assert.throws(()=>tankArrivalSeconds([{x:NaN,y:0,z:0}]),RangeError)
})
