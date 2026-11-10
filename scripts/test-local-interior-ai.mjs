import test from 'node:test'
import assert from 'node:assert/strict'
import {roomAIWorkflow} from '../server/interior-ai.mjs'
test('local RTX workflow uses selected room reference, bounded img2img and explicitly upscaled 4K output',()=>{
 const graph=roomAIWorkflow('room.png','Selected warm timber living room',17)
 assert.equal(graph['2'].inputs.image,'room.png');assert.equal(graph['4'].inputs.text,'Selected warm timber living room')
 assert.equal(graph['7'].inputs.seed,17);assert.ok(graph['7'].inputs.denoise<=.35)
 assert.equal(graph['6'].class_type,'VAEEncodeTiled');assert.equal(graph['8'].class_type,'VAEDecodeTiled')
 assert.equal(graph['6'].inputs.temporal_size,64);assert.equal(graph['8'].inputs.temporal_overlap,8)
 assert.equal(graph['9'].inputs.width,3840);assert.equal(graph['9'].inputs.height,2160)
 assert.equal(graph['3'].inputs.width,1024,'does not claim native 4K diffusion')
})
