import {useEffect,useState} from 'react'
import type {Design} from '@/lib/engine/types.ts'
import type {InteriorConfiguration} from '@/lib/interior/preview.ts'
export function LocalInteriorAI({design,config,canvas,ready}:{design:Design;config:InteriorConfiguration;canvas:()=>HTMLCanvasElement|null|undefined;ready:boolean}){
 const [health,setHealth]=useState<{ready:boolean;device?:string}>(),[busy,setBusy]=useState(false),[image,setImage]=useState(''),[error,setError]=useState('')
 useEffect(()=>{const controller=new AbortController();const check=()=>{fetch('/api/interior-ai',{signal:controller.signal}).then(r=>r.json()).then(data=>{setHealth(data);if(data.ready)clearInterval(timer)}).catch(()=>{})};const timer=setInterval(check,5000);check();return()=>{clearInterval(timer);controller.abort()}},[])
 const generate=async()=>{const source=canvas();if(!source)return;setBusy(true);setError('');try{
  const imageBase64=source.toDataURL('image/png').split(',')[1]
  const r=await fetch('/api/interior-ai',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({design,config,imageBase64})}),data=await r.json();if(!r.ok)throw Error(data.error||'Local AI is unavailable.');setImage(`data:${data.mimeType};base64,${data.imageBase64}`)
 }catch(e){setError(e instanceof Error?e.message:'AI generation failed.')}finally{setBusy(false)}}
 return <section className="mt-5 rounded-lg border border-line bg-bg p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-sm font-medium">AI room concept · local RTX</h3><p className="mt-1 text-xs text-ink-dim">RealVisXL Lightning · {health?.ready?health.device:'Local ComfyUI required'}</p></div><button type="button" disabled={!ready||busy||!health?.ready} onClick={()=>void generate()} className="min-h-11 border border-line px-4 text-sm disabled:opacity-40">{busy?'Generating on your GPU…':'Generate AI room view'}</button></div>
  <p className="mt-2 text-xs leading-relaxed text-ink-dim">Uses your current room view, style and finishes. 3840 × 2160 upscaled image; AI details are illustrative. Use the 3D walkthrough for navigation.</p>
  {!ready&&<p className="mt-2 text-xs text-ink-dim">Generate the 360° room preview first, then face the view you want to refine.</p>}
  {busy&&<div role="status" className="mt-3 flex items-center gap-3 text-xs"><span className="h-4 w-4 animate-spin rounded-full border border-line border-t-ink motion-reduce:animate-none"/>Refining materials and lighting. The first render loads the model into GPU memory.</div>}
  {error&&<p role="alert" className="mt-3 text-xs">{error}</p>}
  {image&&<figure className="mt-4"><img src={image} alt="AI interpretation of your selected room view" className="w-full rounded"/><figcaption className="mt-2 flex justify-between text-xs text-ink-dim"><span>AI concept · 4K upscaled still</span><a href={image} download="formstead-ai-interior-4k.png" className="underline">Download image</a></figcaption></figure>}
 </section>
}
