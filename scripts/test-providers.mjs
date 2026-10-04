import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'
import { analyzeInspiration, generateInterior, generateBuilding, healthy } from '../server/providers/gemini-web.mjs'
import { generateInteriorWithFallback, generateBuildingWithFallback, resolveProvider } from '../server/providers/index.mjs'

async function localServer(handler) {
  const server = createServer(handler)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)) }
}

test('Gemini Web bridge analyzes an image and creates an interior with portable bytes', async () => {
  const requests = []
  const upstream = await localServer(async (req, res) => {
    let input = ''
    for await (const chunk of req) input += chunk
    requests.push({ path: req.url, input: input ? JSON.parse(input) : null })
    res.setHeader('content-type', 'application/json')
    if (req.url === '/openai/v1/models')
      return res.end(JSON.stringify({ data: [{ id: 'gemini-flash' }] }))
    if (req.url === '/openai/v1/chat/completions') {
      const prompt = requests.at(-1).input.messages[0].content[0].text
      return res.end(JSON.stringify({ choices: [{ message: { content: prompt.includes('Classify')
        ? '```json\n{"styleFamily":"modern-indian","roofDesign":"flat"}\n```'
        : 'Two windows on the left wall and one door behind the camera.' } }] }))
    }
    if (req.url === '/openai/v1/images/generations')
      return res.end(JSON.stringify({ data: [{ b64_json: Buffer.from('image').toString('base64') }] }))
    res.writeHead(404).end('{}')
  })
  const old = process.env.GEMINI_WEB_URL
  process.env.GEMINI_WEB_URL = upstream.url
  try {
    assert.equal((await healthy()).reachable, true)
    assert.deepEqual(await analyzeInspiration({ imageBase64: 'aW1hZ2U=', mimeType: 'image/png', prompt: 'Classify this villa' }),
      { styleFamily: 'modern-indian', roofDesign: 'flat' })
    const result = await generateInterior({ beauty: 'aW1hZ2U=', edge: 'ZWRnZQ==', positive: 'Furnished room', negative: 'extra windows' })
    assert.equal(result.imageBase64, Buffer.from('image').toString('base64'))
    assert.equal(result.meta.provider, 'gemini-web')
    const chat = requests.filter((entry) => entry.path === '/openai/v1/chat/completions')
    assert.equal(chat.length, 2)
    assert.ok(chat[0].input.messages[0].content[1].image_url.url.startsWith('data:image/png;base64,'))
    assert.ok(requests.at(-1).input.prompt.includes('Two windows on the left wall'))
    const building = await generateBuilding({beauty:'aW1hZ2U=',edge:'ZWRnZQ==',positive:'Photoreal villa',params:{seed:117}})
    assert.equal(building.meta.provider,'gemini-web')
    assert.equal(building.meta.seed,117)
    assert.match(requests.at(-1).input.prompt,/Keep the roof terrace clear/)
    assert.match(requests.at(-1).input.prompt,/Two windows on the left wall/)

  } finally {
    if (old === undefined) delete process.env.GEMINI_WEB_URL
    else process.env.GEMINI_WEB_URL = old
    await upstream.close()
  }
})

test('ComfyUI becomes the active interior provider when Gemini Web is offline', async () => {
  const comfy = await localServer((req, res) => {
    res.setHeader('content-type', 'application/json')
    res.end(req.url === '/system_stats' ? '{}' : '{"error":"not found"}')
  })
  const oldBridge = process.env.GEMINI_WEB_URL
  const oldComfy = process.env.COMFYUI_URL
  const oldProvider = process.env.INTERIOR_PROVIDER
  process.env.GEMINI_WEB_URL = 'http://127.0.0.1:1'
  process.env.COMFYUI_URL = comfy.url
  process.env.INTERIOR_PROVIDER = 'gemini-web'
  try {
    const selected = await resolveProvider()
    assert.equal(selected.activeId, 'comfyui')
    assert.equal(selected.reachable, true)
    assert.equal(selected.usingMock, false)
  } finally {
    if (oldBridge === undefined) delete process.env.GEMINI_WEB_URL
    else process.env.GEMINI_WEB_URL = oldBridge
    if (oldComfy === undefined) delete process.env.COMFYUI_URL
    else process.env.COMFYUI_URL = oldComfy
    if (oldProvider === undefined) delete process.env.INTERIOR_PROVIDER
    else process.env.INTERIOR_PROVIDER = oldProvider
    await comfy.close()
  }
})

test('a Gemini Web image failure runs the ComfyUI fallback', async () => {
  const bridge = await localServer(async (req, res) => {
    res.setHeader('content-type', 'application/json')
    if (req.url === '/openai/v1/models') return res.end('{"data":[{"id":"gemini-flash"}]}')
    if (req.url === '/openai/v1/chat/completions')
      return res.end('{"choices":[{"message":{"content":"One window on the left."}}]}')
    res.writeHead(503).end('{"error":"image quota exhausted"}')
  })
  const comfy = await localServer(async (req, res) => {
    if (req.url === '/system_stats') return res.end('{}')
    if (req.url === '/upload/image') {
      for await (const _ of req) { /* consume multipart body */ }
      return res.end('{"name":"edge.png"}')
    }
    if (req.url === '/prompt') {
      for await (const _ of req) { /* consume workflow body */ }
      return res.end('{"prompt_id":"test-prompt"}')
    }
    if (req.url === '/history/test-prompt')
      return res.end('{"test-prompt":{"outputs":{"1":{"images":[{"filename":"done.png","type":"output"}]}}}}')
    if (req.url.startsWith('/view?')) {
      res.setHeader('content-type', 'image/png')
      return res.end(Buffer.from('fallback image'))
    }
    res.writeHead(404).end('{}')
  })
  const old = [process.env.GEMINI_WEB_URL, process.env.COMFYUI_URL, process.env.INTERIOR_PROVIDER]
  process.env.GEMINI_WEB_URL = bridge.url
  process.env.COMFYUI_URL = comfy.url
  process.env.INTERIOR_PROVIDER = 'gemini-web'
  const messages = []
  try {
    const result = await generateInteriorWithFallback({
      beauty: 'aW1hZ2U=', edge: 'ZWRnZQ==', positive: 'Furnished room', negative: 'extra door',
    }, (message) => messages.push(message))
    assert.equal(result.meta.provider, 'comfyui')
    assert.equal(Buffer.from(result.imageBase64, 'base64').toString(), 'fallback image')
    assert.ok(messages.some((message) => /switching to comfyui/i.test(message)))
  } finally {
    for (const [key, value] of [['GEMINI_WEB_URL', old[0]], ['COMFYUI_URL', old[1]], ['INTERIOR_PROVIDER', old[2]]]) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    await bridge.close()
    await comfy.close()
  }
})

test('an offline setup does not label the 3D reference as an AI interior', async () => {
  const old = [process.env.GEMINI_WEB_URL, process.env.COMFYUI_URL, process.env.INTERIOR_PROVIDER]
  process.env.GEMINI_WEB_URL = 'http://127.0.0.1:1'
  process.env.COMFYUI_URL = 'http://127.0.0.1:1'
  process.env.INTERIOR_PROVIDER = 'gemini-web'
  try {
    const selected = await resolveProvider()
    assert.equal(selected.activeId, 'unavailable')
    assert.equal(selected.reachable, false)
    await assert.rejects(generateInteriorWithFallback({ beauty: 'aW1hZ2U=' }), /comfyui also unavailable/i)
  } finally {
    for (const [key, value] of [['GEMINI_WEB_URL', old[0]], ['COMFYUI_URL', old[1]], ['INTERIOR_PROVIDER', old[2]]]) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
})

const ORDER = ['comfyui','gemini-web','mock']
for (const scenario of ['primary','primary-error','offline','both-error','empty-image']) {
  test(`building provider order and truthful provenance: ${scenario}`,async()=>{
    const calls = []
    const registry = Object.fromEntries(ORDER.map(id=>[id,{
      healthy:async()=>{calls.push(id+':health');return {reachable:scenario !== 'offline' || id==='mock',note:'offline'}},
      generateBuilding:async(job)=>{calls.push(id+':image');assert.equal(job.params.seed,117)
        if((id==='comfyui'&&['primary-error','both-error'].includes(scenario)) || (id==='gemini-web'&&scenario==='both-error')) throw new Error('image failed')
        return {imageBase64:scenario==='empty-image'&&id!=='mock'?'':job.beauty,mimeType:'image/png',meta:{provider:'wrong'}}
      }
    }]))
    const result = await generateBuildingWithFallback({beauty:'aW1hZ2U=',params:{seed:117}},registry)
    const provider = scenario==='primary'?'comfyui':scenario==='primary-error'?'gemini-web':'mock'
    assert.equal(result.provider,provider)
    assert.equal(result.meta.provider,provider)
    assert.equal(result.mock,provider==='mock')
    assert.equal(result.imageBase64,'aW1hZ2U=')
    assert.deepEqual(calls.filter(c=>c.endsWith(':health')),ORDER.slice(0,ORDER.indexOf(provider)+1).map(x=>x+':health'))
    assert.equal(result.meta.attempts.length,ORDER.indexOf(provider))
  })
}
