import test from 'node:test'
import assert from 'node:assert/strict'
import {roofComparison} from '../src/lib/impact/roofComparison.ts'
const inputs={areaM2:null,currentRoofU:2,proposedRoofU:.5,temperatureDifferenceK:15,source:'Entered roof properties'}

test('roof comparison follows project area and entered thermal properties without mutating inputs',()=>{
 const before=structuredClone(inputs),a=roofComparison(inputs,106),b=roofComparison(inputs,212)
 assert.equal(a.ready,true);assert.equal(a.currentW,3180);assert.equal(a.proposedW,795)
 assert.equal(a.differenceW,2385);assert.equal(a.percent,75)
 assert.equal(b.proposedW,1590);assert.equal(b.differenceW,4770)
 assert.equal(a.areaBasis,'From current plan');assert.deepEqual(inputs,before)
 const manual=roofComparison({...inputs,areaM2:80,currentRoofU:1.5,temperatureDifferenceK:10},106)
 assert.equal(manual.currentW,1200);assert.equal(manual.proposedW,400)
 assert.equal(manual.areaBasis,'Entered roof area')
})
test('missing or invalid properties do not produce verified-looking default totals',()=>{
 for(const patch of [{currentRoofU:null},{proposedRoofU:null},{temperatureDifferenceK:null},{areaM2:0},{currentRoofU:-1},{proposedRoofU:NaN},{temperatureDifferenceK:Infinity}]){
  const result=roofComparison({...inputs,...patch},106)
  assert.equal(result.ready,false);assert.ok(result.missing.length)
  assert.equal(result.currentW,null);assert.equal(result.proposedW,null);assert.equal(result.differenceW,null)
 }
})
test('zero flow and a worse proposed roof are handled honestly without divisions by zero',()=>{
 const zero=roofComparison({...inputs,temperatureDifferenceK:0},106)
 assert.equal(zero.ready,true);assert.equal(zero.currentW,0);assert.equal(zero.percent,0)
 const worse=roofComparison({...inputs,proposedRoofU:4},106)
 assert.equal(worse.differenceW,-3180);assert.equal(worse.percent,-100)
 const noBaseline=roofComparison({...inputs,currentRoofU:0},106)
 assert.equal(noBaseline.percent,null);assert.equal(noBaseline.differenceW,-795)
})
