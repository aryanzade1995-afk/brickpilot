import * as geminiWeb from './providers/gemini-web.mjs'
import * as gemini from './providers/gemini.mjs'
import * as comfyui from './providers/comfyui.mjs'

export const VILLA_VIEWS = ['front-left', 'rear-right']
export const VISUALIZATION_LIMITS = Object.freeze({geminiTimeoutMs:60000, comfyTimeoutMs:100000,
  maxImageBytes:12e6, width:1024, height:768, steps:12, cfg:2.6, denoise:.28, cnCanny:.95, cnEnd:1})
const PRESERVE = 'Edit the FIRST image, the authoritative completed 3D villa. The second image shows its other side for consistency only. Keep the FIRST camera exactly. Preserve footprint, silhouette, storeys, roof, stair headroom, clear terrace, all walls, columns, entrances, windows, doors, balconies, safety equipment, facade features, paths and landscape positions. Keep the same colours and material placement in both views. Improve surface realism, physical lighting, reflections, vegetation realism and architectural photographic quality only. No invented or moved architecture. Natural daylight, realistic architectural lens, little empty sky, no cropped elements. Return ONE image, no text.'
const NEGATIVE = 'redesigned villa, changed footprint, extra or missing floor, extra or moved window, changed roof, new balcony, blocked exit, distorted architecture, different materials, solid roof blocks, extreme wide angle, excessive sky, text, collage, illustration'
const crcTable=Uint32Array.from({length:256},(_,value)=>{for(let i=0;i<8;i++)value=(value&1)?0xedb88320^(value>>>1):value>>>1;return value>>>0})
function crc32(bytes){let value=0xffffffff;for(const byte of bytes)value=crcTable[(value^byte)&255]^(value>>>8);return (value^0xffffffff)>>>0}

/** Reject empty, HTML, wrong MIME, corrupt/truncated containers and unreasonable sizes. */
export function validImage(imageBase64, mimeType) {
  if(typeof imageBase64!=='string'||!imageBase64||!/^image\/(png|jpeg|webp)$/.test(mimeType)||! /^[A-Za-z0-9+/]+={0,2}$/.test(imageBase64))return false
  const b=Buffer.from(imageBase64,'base64')
  if(b.length<24||b.length>VISUALIZATION_LIMITS.maxImageBytes)return false
  if(mimeType==='image/png') {
    if(b.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||b.subarray(12,16).toString()!=='IHDR')return false
    const w=b.readUInt32BE(16),h=b.readUInt32BE(20)
    if(!w||!h||w*h>24e6)return false
    let offset=8,hasPixels=false
    while(offset+12<=b.length){const n=b.readUInt32BE(offset),type=b.subarray(offset+4,offset+8).toString();if(offset+n+12>b.length)return false
      if(crc32(b.subarray(offset+4,offset+8+n))!==b.readUInt32BE(offset+8+n))return false
      if(type==='IDAT')hasPixels ||= n>0
      if(type==='IEND')return hasPixels&&n===0&&offset+12===b.length
      offset+=n+12
    }
    return false
  }
  if(mimeType==='image/jpeg')return b[0]===255&&b[1]===216&&b[2]===255&&b.at(-2)===255&&b.at(-1)===217
  return b.subarray(0,4).toString()==='RIFF'&&b.subarray(8,12).toString()==='WEBP'&&b.readUInt32LE(4)+8===b.length
}

export function validateVillaReference(reference) {
  if(!reference||typeof reference.sourceId!=='string'||!reference.sourceId.trim()||reference.sourceId.length>512||
    !['blender','study'].includes(reference.source)||!Number.isSafeInteger(reference.seed)||reference.seed<0||
    !Array.isArray(reference.views)||reference.views.length!==2)throw new Error('Invalid villa reference')
  if(reference.facts!==undefined&&(typeof reference.facts!=='string'||reference.facts.length>4000))throw new Error('Invalid villa facts')
  return VILLA_VIEWS.map(view=>{
    const matches=reference.views.filter(r=>r.view===view)
    if(matches.length!==1||!validImage(matches[0].beauty,'image/png')||!validImage(matches[0].edge,'image/png'))throw new Error('Two actual model views and edge maps are required')
    return matches[0]
  })
}

/** Atomic pair: discard a partial primary result and render BOTH views with the fallback.
 * No mock images, provider controls, provider details or session URLs escape to the UI.
 */
export async function generateVillaVisualizations(reference, {registry, limits=VISUALIZATION_LIMITS, signal}={}) {
  const views=validateVillaReference(reference)
  const primary=process.env.BUILDING_PROVIDER==='gemini' ? gemini : geminiWeb
  const providers=registry??{gemini:primary,comfyui}
  // local SDXL first (fast, edge-conditioned), Gemini Web as the fallback
  for(const [name,timeout] of [['comfyui',limits.comfyTimeoutMs],['gemini',limits.geminiTimeoutMs]]) {
    signal?.throwIfAborted()
    const controller=new AbortController(), timer=setTimeout(()=>controller.abort(new Error('Visualization timed out')),timeout)
    const operationSignal=signal?AbortSignal.any([signal,controller.signal]):controller.signal
    try {
      const abort=new Promise((_,reject)=>operationSignal.addEventListener('abort',()=>reject(operationSignal.reason),{once:true}))
      const pair=(async()=>{
        const images=[]
        for(let i=0;i<views.length;i++) {
          operationSignal.throwIfAborted()
          const view=views[i], result=await providers[name].generateVillaView({beauty:view.beauty,edge:view.edge,otherBeauty:views[1-i].beauty,
            positive:`${PRESERVE}\nView: ${view.view}. ${reference.facts??''}`,negative:NEGATIVE,signal:operationSignal,
            params:{...limits,seed:reference.seed}})
          operationSignal.throwIfAborted()
          if(!validImage(result?.imageBase64,result?.mimeType))throw new Error('Invalid generated image')
          images.push({view:view.view,url:`data:${result.mimeType};base64,${result.imageBase64}`})
        }
        return {sourceId:reference.sourceId,images}
      })()
      return await Promise.race([pair,abort])
    } catch(error) {
      signal?.throwIfAborted()
      // Detailed reasons remain server-side. Never send cookies/remote response bodies to the user.
      console.warn(`[villa-visualizations] ${name} attempt unavailable: ${error?.name??'Error'}`)
    } finally {clearTimeout(timer);controller.abort()}
  }
  throw new Error('Visualizations are unavailable right now. Your 3D model is ready.')
}
