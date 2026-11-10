import test from 'node:test'
import assert from 'node:assert/strict'
import {walkthroughPixelRatio,adaptWalkthroughResolution} from '../src/lib/walkthrough/quality.ts'
test('2K uses QHD pixels at 16:9 and preserves portrait aspect without letterboxing',()=>{
 const ratio=walkthroughPixelRatio('smooth2k',1280,720,true)
 assert.equal(1280*ratio,2560);assert.equal(720*ratio,1440)
 const portrait=walkthroughPixelRatio('smooth2k',600,900,true)
 assert.ok(Math.abs(600*900*portrait**2-2560*1440)<1e-6)
 assert.ok(Math.abs(600*portrait/(900*portrait)-600/900)<1e-12)
 assert.equal(walkthroughPixelRatio('smooth2k',1280,720,false),1)
 const lower=adaptWalkthroughResolution('smooth2k',30,1,0)
 assert.ok(lower.ratio<1);assert.ok(lower.ratio>=.5)
})
