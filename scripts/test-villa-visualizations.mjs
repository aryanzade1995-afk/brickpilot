import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {deflateSync} from 'node:zlib'
import {generateVillaVisualizations,validImage,validateVillaReference,VISUALIZATION_LIMITS} from '../server/villa-visualizations.mjs'
import {buildVillaWorkflow} from '../server/providers/comfyui.mjs'
import {generateVillaView as geminiView} from '../server/providers/gemini-web.mjs'
import {readVisualizationPair,visualizationSourceId} from '../src/lib/render/villaVisualizations.ts'

// Tiny synthetic PNG fixtures used solely for protocol tests, never as app images.
function png(v){const chunk=(type,data)=>{const b=Buffer.alloc(data.length+12);b.writeUInt32BE(data.length);b.write(type,4);data.copy(b,8);
  let crc=0xffffffff;for(const byte of b.subarray(4,-4)){crc^=byte;for(let i=0;i<8;i++)crc=(crc&1)?0xedb88320^(crc>>>1):crc>>>1}b.writeUInt32BE((crc^0xffffffff)>>>0,b.length-4);return b}
  const h=Buffer.alloc(13);h.writeUInt32BE(2);h.writeUInt32BE(2,4);h[8]=8;h[9]=2
  return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',h),chunk('IDAT',deflateSync(Buffer.from([0,v,v,v,v,v,v,0,v,v,v,v,v,v]))),chunk('IEND',Buffer.alloc(0))]).toString('base64')}
const first=png(60),second=png(140),output=(imageBase64=first)=>({imageBase64,mimeType:'image/png'})
const reference={sourceId:'plan-A|study|41',source:'study',seed:41,views:[{view:'front',beauty:first,edge:second}]}
const limits={...VISUALIZATION_LIMITS,geminiTimeoutMs:25,comfyTimeoutMs:150}

test('a successful run returns the single source-bound front view and never exposes provider details',async()=>{
  const calls=[],registry={gemini:{generateVillaView:async job=>{calls.push(job);return output(job.beauty)}},comfyui:{generateVillaView:()=>{throw Error('must not run')}}}
  const pair=await generateVillaVisualizations(reference,{registry,limits})
  assert.deepEqual(pair.images.map(i=>i.view),['front'])
  assert.deepEqual(Object.keys(pair),['sourceId','images']);assert.equal(calls.length,1)
  assert.equal(calls[0].beauty,first);assert.equal(calls[0].otherBeauty,undefined)
  assert.match(calls[0].positive,/authoritative completed 3D villa/)
  assert.deepEqual(readVisualizationPair(pair,reference.sourceId),pair)
})
for(const cause of ['authentication','network','empty','invalid','partial','timeout'])test(`${cause}: primary failure automatically replaces the entire pair`,async()=>{
  let g=0,c=0
  const registry={gemini:{generateVillaView:async()=>{g++;if(cause==='partial'&&g===1)return output(second)
    if(cause==='timeout')return new Promise(()=>{})
    if(cause==='empty')return output('')
    if(cause==='invalid')return {imageBase64:Buffer.from('<html>broken</html>').toString('base64'),mimeType:'image/png'}
    throw Error(cause)}},comfyui:{generateVillaView:async()=>{c++;return output(first)}}}
  const pair=await generateVillaVisualizations(reference,{registry,limits})
  assert.equal(c,1);assert.equal(pair.images.length,1)
  assert.ok(pair.images.every(i=>i.url.endsWith(first)))
})
test('no mock or partial gallery when both providers fail; client cancellation stops fallback',async()=>{
  let calls=0;const registry={gemini:{generateVillaView:async()=>{throw Error('secret-cookie')}},comfyui:{generateVillaView:async()=>{calls++;throw Error('GPU missing')}}}
  await assert.rejects(generateVillaVisualizations(reference,{registry,limits}),/Visualizations are unavailable right now/)
  const controller=new AbortController();controller.abort()
  await assert.rejects(generateVillaVisualizations(reference,{registry,limits,signal:controller.signal}),{name:'AbortError'})
  assert.equal(calls,1)
})
test('reject corrupt containers, duplicate/missing views and stale responses',()=>{
  assert.ok(validImage(first,'image/png'));assert.ok(!validImage(first.slice(0,-12),'image/png'))
  assert.ok(!validImage(first,'image/jpeg'));assert.ok(!validImage('abcd','image/png'))
  const corrupt=Buffer.from(first,'base64');corrupt[45]^=1;assert.ok(!validImage(corrupt.toString('base64'),'image/png'))
  assert.throws(()=>validateVillaReference({...reference,views:[reference.views[0],reference.views[0]]}))
  assert.throws(()=>readVisualizationPair({sourceId:'old',images:[]},reference.sourceId))
  assert.notEqual(visualizationSourceId('A','study',41),visualizationSourceId('A','blender',41))
  assert.notEqual(visualizationSourceId('A','blender',41,'old.glb'),visualizationSourceId('A','blender',41,'new.glb'))
})
test('local workflow seeds the actual colour render, preserves edges and uses bounded moderate-denoise settings',()=>{
  const {graph,seed}=buildVillaWorkflow({beautyName:'actual.png',edgeName:'edges.png',positive:'villa',negative:'redesign',params:{...VISUALIZATION_LIMITS,denoise:.75,cnCanny:.85,cnEnd:.8,steps:12,seed:41}})
  assert.equal(seed,41);assert.equal(graph['12'].class_type,'VAEEncode');assert.equal(graph['80'].inputs.image,'actual.png')
  assert.equal(graph['11'].inputs.image,'edges.png');assert.deepEqual(graph['50'].inputs.latent_image,['12',0])
  assert.equal(graph['50'].inputs.denoise,.75);assert.equal(graph['31'].inputs.end_percent,.8)
  assert.equal(graph['50'].inputs.steps,12);assert.equal(graph['50'].inputs.seed,41)
})
test('Gemini receives both real renders in a direct edit rather than generating from a description',async t=>{
  const requests=[]
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    requests.push({url:String(url),options})
    if(String(url).endsWith('/models'))return Response.json({data:[{id:'gemini-pro'}]})
    assert.ok(String(url).endsWith('/chat/completions'))
    return Response.json({choices:[{message:{content:`![villa](data:image/png;base64,${first})`}}]})
  })
  const img=await geminiView({beauty:first,otherBeauty:second,positive:'edit actual model',signal:new AbortController().signal})
  assert.equal(img.imageBase64,first)
  const payload=JSON.parse(requests.at(-1).options.body),parts=payload.messages[0].content
  assert.equal(parts.filter(p=>p.type==='image_url').length,2)
  assert.equal(parts[1].image_url.url,`data:image/png;base64,${first}`)
  assert.ok(!requests.some(r=>r.url.includes('images/generations')))
})
test('Render has two source tabs (AI Interior moved after Finishes & Cost), large actual viewport and a single visualization action',async()=>{
  const route=await readFile(new URL('../src/routes/Render.tsx',import.meta.url),'utf8')
  assert.match(route,/Blender Villa/);assert.match(route,/Study Model/);assert.doesNotMatch(route,/InteriorStudio/)
  assert.match(route,/Generate AI Visualization/);assert.match(route,/VillaVisualizationViewport/)
  assert.doesNotMatch(route,/md:grid-cols-2/);assert.doesNotMatch(route,/runJobs|probeHealth|REF_KEYS|Docker|Cookie|switching/i)
})
