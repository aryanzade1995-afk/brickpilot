import test from 'node:test'
import assert from 'node:assert/strict'
import {raytraceRenderScale,presentRaytrace} from '../src/lib/three/raytracePerformance.ts'

test('adaptive ray resolution respects GPU budgets without upscaling small views',()=>{
 for(const gpu of ['Intel Iris Xe','NVIDIA GeForce RTX 3050','Software graphics']){
  for(const quality of ['balanced','fine']){
   const scale=raytraceRenderScale(quality,1920,1080,1.5,gpu)
   const budget=quality==='balanced'?(gpu.includes('NVIDIA')?1600000:900000):(gpu.includes('NVIDIA')?2400000:1600000)
   assert.ok(scale>0&&scale<=1);assert.ok(1920*1080*1.5**2*scale**2<=budget+1)
   assert.equal(raytraceRenderScale(quality,320,240,1,gpu),1)
  }
 }
 assert.ok(raytraceRenderScale('balanced',1920,1080,1.5,'Intel')<raytraceRenderScale('fine',1920,1080,1.5,'Intel'))
})
test('Photo retains native resolution and invalid view dimensions are safe',()=>{
 for(const gpu of ['Intel','NVIDIA'])for(const dpr of [1,1.5,2,3])assert.equal(raytraceRenderScale('photo',3840,2160,dpr,gpu),1)
 for(const invalid of [0,-1,NaN,Infinity])assert.equal(raytraceRenderScale('balanced',invalid,1080,1,'Intel'),1)
})
test('tile presentation is throttled without losing the final image',()=>{
 assert.equal(presentRaytrace(100,0,3,64),false)
 assert.equal(presentRaytrace(160,0,4,64),true)
 assert.equal(presentRaytrace(101,100,64,64),true)
 const displays=Array.from({length:60},(_,i)=>i*1000/60).reduce((state,now)=>presentRaytrace(now,state.last,1,64)?{last:now,count:state.count+1}:state,{last:-Infinity,count:0})
 assert.ok(displays.count>=5&&displays.count<=7,'expensive display passes are limited to about six per second')
})
