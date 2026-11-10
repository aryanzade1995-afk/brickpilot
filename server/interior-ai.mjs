import {prepareInteriorPreview} from './interior-preview.mjs'
const base=()=>process.env.COMFYUI_URL||'http://127.0.0.1:8188'
let busy=false
export function roomAIWorkflow(image,positive,seed=42){return {
 '1':{class_type:'CheckpointLoaderSimple',inputs:{ckpt_name:process.env.SDXL_CKPT||'RealVisXL_V5.0_Lightning_fp16.safetensors'}},
 '2':{class_type:'LoadImage',inputs:{image}},
 '3':{class_type:'ImageScale',inputs:{image:['2',0],upscale_method:'lanczos',width:1024,height:576,crop:'center'}},
 '4':{class_type:'CLIPTextEncode',inputs:{text:positive,clip:['1',1]}},
 '5':{class_type:'CLIPTextEncode',inputs:{text:'distorted furniture, changed architecture, extra doors, blocked doorway, floating objects, illustration, text, watermark',clip:['1',1]}},
 '6':{class_type:'VAEEncodeTiled',inputs:{pixels:['3',0],vae:['1',2],tile_size:512,overlap:64,temporal_size:64,temporal_overlap:8}},
 '7':{class_type:'KSampler',inputs:{model:['1',0],positive:['4',0],negative:['5',0],latent_image:['6',0],seed,steps:8,cfg:1.8,sampler_name:'dpmpp_sde',scheduler:'karras',denoise:.3}},
 '8':{class_type:'VAEDecodeTiled',inputs:{samples:['7',0],vae:['1',2],tile_size:512,overlap:64,temporal_size:64,temporal_overlap:8}},
 '9':{class_type:'ImageScale',inputs:{image:['8',0],upscale_method:'lanczos',width:3840,height:2160,crop:'disabled'}},
 '10':{class_type:'SaveImage',inputs:{images:['9',0],filename_prefix:'Formstead_Interior_AI'}}
}}
export async function handleInteriorAI(req,res,readJson){
 if(req.url!=='/api/interior-ai')return false
 const send=(code,data)=>{res.writeHead(code,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(data))}
 if(req.method==='GET'){try{const r=await fetch(`${base()}/system_stats`,{signal:AbortSignal.timeout(2500)});if(!r.ok)throw Error();const data=await r.json();send(200,{ready:true,device:data.devices?.[0]?.name,model:'RealVisXL Lightning',output:'3840 × 2160 · upscaled AI still image'})}catch{send(200,{ready:false,message:'Start local ComfyUI to generate AI interiors.'})}return true}
 if(req.method!=='POST'){send(405,{error:'Method not allowed'});return true}
 if(busy){send(409,{error:'The local GPU is generating an interior. Please wait.'});return true}
 let p,scene
 try{p=await readJson(req,16e6);scene=prepareInteriorPreview(p.design,p.config,'high');if(typeof p.imageBase64!=='string'||p.imageBase64.length>12e6||!/^iVBORw0KGgo/.test(p.imageBase64))throw Error('Generate a room preview first.')}catch(e){send(400,{error:e.message});return true}
 busy=true
 const signal=AbortSignal.timeout(900_000)
 try{
  const fd=new FormData();fd.append('image',new Blob([Buffer.from(p.imageBase64,'base64')],{type:'image/png'}),`formstead-${Date.now()}.png`)
  const upload=await fetch(`${base()}/upload/image`,{method:'POST',body:fd,signal});if(!upload.ok)throw Error('Local AI could not read the room reference.');const image=await upload.json()
  const finishes=scene.finishes?.specifications?.map(s=>s.name).join(', ')||''
  const workflow=roomAIWorkflow(image.name,`Photorealistic architectural interior photograph, ${scene.room.name}, ${p.config.style} interior, ${p.config.lighting} lighting, ${p.config.furnitureDensity} furniture density, ${finishes}. Preserve the reference room layout, furniture positions, doors and windows. Realistic fabric, timber grain, ceramic detail, natural soft shadows.`)
  const queued=await fetch(`${base()}/prompt`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({prompt:workflow}),signal});const job=await queued.json();if(!queued.ok)throw Error('Local AI workflow unavailable. Check the installed checkpoint and ComfyUI nodes.')
  let output
  while(!output){await new Promise(r=>setTimeout(r,1000));const r=await fetch(`${base()}/history/${job.prompt_id}`,{signal});const h=(await r.json())[job.prompt_id];if(h?.status?.status_str==='error')throw Error('Local GPU generation failed; see ComfyUI log.');output=h?.outputs?.['10']?.images?.[0]}
  const r=await fetch(`${base()}/view?${new URLSearchParams({filename:output.filename,subfolder:output.subfolder||'',type:'output'})}`,{signal});if(!r.ok)throw Error('Generated image could not be retrieved.')
  send(200,{imageBase64:Buffer.from(await r.arrayBuffer()).toString('base64'),mimeType:'image/png',width:3840,height:2160,kind:'upscaled-ai-still'})
 }catch(e){send(503,{error:e.name==='TimeoutError'?'Local AI timed out. Retry after the GPU is free.':e.message})}finally{busy=false}
 return true
}
