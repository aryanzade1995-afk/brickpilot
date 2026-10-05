/* Local adapter for ntthanh2603/gemini-web-to-api. The bridge owns its
 * browser session; Formstead receives only image/text API responses. */

export const id = 'gemini-web'

const base = () => (process.env.GEMINI_WEB_URL || 'http://127.0.0.1:4981').replace(/\/+$/, '')

async function request(path, options = {}, timeoutMs = 180000) {
  const url = new URL(base())
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
    throw new Error('GEMINI_WEB_URL must point to a local bridge')
  const timeout = AbortSignal.timeout(timeoutMs)
  const response = await fetch(`${base()}${path}`, { ...options, signal: options.signal ? AbortSignal.any([options.signal,timeout]) : timeout })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body?.error?.message || body?.error || `Gemini Web bridge returned ${response.status}`)
  return body
}

async function model(preferred, forImage = false) {
  if (preferred) return preferred
  const listing = await request('/openai/v1/models', {}, 3500)
  const names = (listing.data || []).map((item) => item.id).filter((name) => typeof name === 'string')
  const selected = forImage
    ? names.find((name) => /image/i.test(name)) || names.find((name) => /pro|advanced/i.test(name)) || names[0]
    : names.find((name) => /flash/i.test(name)) || names.find((name) => /pro|advanced/i.test(name)) || names[0]
  if (!selected) throw new Error('Gemini Web bridge has no selectable models')
  return selected
}

export async function healthy() {
  try {
    await request('/openai/v1/models', {}, 3500)
    await model(process.env.GEMINI_WEB_MODEL || '')
    return { reachable: true, note: '' }
  } catch (error) {
    return { reachable: false, note: `${String(error?.message || error)} — start gemini-web-to-api on ${base()}` }
  }
}

function textOf(body) {
  const content = body?.choices?.[0]?.message?.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.map((part) => part?.text || '').join('\n')
  return ''
}

function jsonObject(text) {
  const stripped = text.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()
  const start = stripped.indexOf('{')
  const end = stripped.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('Gemini Web returned no JSON style analysis')
  return JSON.parse(stripped.slice(start, end + 1))
}

async function chat(prompt, images = []) {
  const selected = await model(process.env.GEMINI_WEB_MODEL || '')
  const content = [
    { type: 'text', text: prompt },
    ...images.map(({ data, mimeType }) => ({
      type: 'image_url', image_url: { url: `data:${mimeType};base64,${data}` },
    })),
  ]
  const body = await request('/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: selected, stream: false, messages: [{ role: 'user', content }] }),
  })
  const text = textOf(body)
  if (!text) throw new Error('Gemini Web returned an empty response')
  return text
}

export async function analyzeInspiration({ imageBase64, mimeType, prompt }) {
  return jsonObject(await chat(`${prompt}\nReturn one JSON object only, without Markdown.`,
    [{ data: imageBase64, mimeType }]))
}

/** This bridge currently offers portable bytes for text-to-image, while its
 * multimodal chat returns session-bound image URLs. Describe the supplied 3D
 * reference first, then request a concept image. ComfyUI is the grounded
 * fallback if this bridge cannot produce an image. */
export async function generateInterior({ beauty, edge, positive, negative = '', onProgress }) {
  onProgress?.(12, 'reading 3D room reference')
  const layout = await chat(
    'Describe only the visible room geometry in this 3D reference: camera direction, wall shape, exact window and door count and their positions. Keep it under 100 words. Do not invent openings or furniture.',
    [{ data: beauty, mimeType: 'image/png' }, { data: edge, mimeType: 'image/png' }],
  )
  onProgress?.(38, 'generating furnished interior')
  const imageModel = await model(process.env.GEMINI_WEB_IMAGE_MODEL || process.env.GEMINI_WEB_MODEL || '', true)
  const prompt = `${positive}\nReference room geometry: ${layout}\nAvoid: ${negative}. ` +
    'Preserve the stated room dimensions, window and door counts and camera perspective. Output one image.'
  const body = await request('/openai/v1/images/generations', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: imageModel, prompt, size: '1024x1024', n: 1, response_format: 'b64_json' }),
  }, 360000)
  const imageBase64 = body?.data?.[0]?.b64_json
  if (typeof imageBase64 !== 'string' || !imageBase64)
    throw new Error('Gemini Web returned no portable interior image')
  onProgress?.(95, 'interior ready')
  return { imageBase64, mimeType: 'image/png',
    meta: { provider: id, geometryGrounding: 'reference description' } }
}

/** Building concepts use the same bridge as InteriorStudio. Reference description
 * is a soft constraint; ComfyUI uses the actual reference edge map. */
export async function generateBuilding({ beauty, edge, positive, negative = '', inspiration, params = {} }) {
  const images = [{ data: beauty, mimeType: 'image/png' }]
  if (edge) images.push({ data: edge, mimeType: 'image/png' })
  if (inspiration) images.push({data: inspiration.data, mimeType: inspiration.mimeType})
  const reference = await chat(
    'Describe the exact building or plan geometry in the FIRST image: floor count, footprint, silhouette, stair headroom, clear flat terrace, entrance and opening positions, balconies and camera. Do not invent volumes or openings. The edge map confirms geometry. Any final inspiration photo guides finishes only; never copy its structure. Keep this under 160 words.', images)
  const selected = await model(process.env.GEMINI_WEB_IMAGE_MODEL || process.env.GEMINI_WEB_MODEL || '', true)
  const body = await request('/openai/v1/images/generations', {
    method:'POST', headers:{'content-type':'application/json'},
    body:JSON.stringify({model:selected, prompt:`${positive}\nAuthoritative reference: ${reference}\nAvoid: ${negative}. Preserve silhouette, floor count, openings, entrance and camera. Keep the roof terrace clear except for stair headroom and a corner tank. Output one architectural visualization.`,size:'1024x1024',n:1,response_format:'b64_json'})
  },360000)
  const imageBase64 = body?.data?.[0]?.b64_json
  if (typeof imageBase64 !== 'string' || !imageBase64) throw new Error('Gemini Web returned no portable building image')
  return {imageBase64,mimeType:'image/png',meta:{provider:id,seed:params.seed,geometryGrounding:'reference description'}}
}

/** Direct multimodal edit. Never replace the actual image with a text description.
 * The documented bridge chat may return session-bound Google image URLs. If those
 * cannot be read without cookies, the paired service uses ComfyUI automatically.
 */
export async function generateVillaView({beauty, otherBeauty, positive, signal}) {
  const selected=await model(process.env.GEMINI_WEB_IMAGE_MODEL||process.env.GEMINI_WEB_MODEL||'',true)
  signal?.throwIfAborted()
  const body=await request('/openai/v1/chat/completions',{method:'POST',signal,headers:{'content-type':'application/json'},
    body:JSON.stringify({model:selected,stream:false,messages:[{role:'user',content:[{type:'text',text:positive},
      ...[beauty,otherBeauty].filter(Boolean).map(data=>({type:'image_url',image_url:{url:`data:image/png;base64,${data}`}}))]}]})},60000)
  const content=body?.choices?.[0]?.message?.content
  const inline=Array.isArray(content)?content.find(p=>p.type==='image_url'&&p.image_url?.url?.startsWith('data:image/'))?.image_url?.url:null
  const text=inline||textOf(body)
  const data=text.match(/data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)/)
  if(data)return {mimeType:data[1],imageBase64:data[2]}
  const links=[...text.matchAll(/!\[[^\]]*\]\((https:\/\/[^\s)]+)\)/g)]
  if(links.length!==1)throw new Error('No directly conditioned image returned')
  const url=new URL(links[0][1])
  if(!url.hostname.endsWith('.googleusercontent.com')||url.username||url.password||url.port)throw new Error('Unexpected generated image host')
  const response=await fetch(url,{signal,redirect:'error'})
  if(!response.ok)throw new Error('Generated image needs its bridge session')
  if(Number(response.headers.get('content-length'))>12e6)throw new Error('Generated image is too large')
  const chunks=[];let size=0
  for await(const chunk of response.body){size+=chunk.length;if(size>12e6){await response.body.cancel().catch(()=>{});throw new Error('Generated image is too large')}chunks.push(chunk)}
  return {imageBase64:Buffer.concat(chunks).toString('base64'),mimeType:response.headers.get('content-type')?.split(';')[0]}
}
