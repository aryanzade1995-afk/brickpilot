import {readFile,writeFile,mkdir,realpath,stat,rename,rm} from 'node:fs/promises'
import {createReadStream,readFileSync} from 'node:fs'
import {createGzip} from 'node:zlib'
import {resolve,sep} from 'node:path'
import {Texture} from 'three'
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js'
import {acceptedVillaDoors} from '../src/lib/three/acceptedVillaWalkthrough.ts'
import {lightingLayoutSignature,LIGHTING_VERSION} from '../src/lib/walkthrough/lighting.ts'
import {prepareWalkthroughRequest,resolveWalkthroughImages,digest} from './walkthrough-assets.mjs'
import {runBlender,PROJECT_ROOT} from './blender-process.mjs'
const ROOT=resolve(PROJECT_ROOT,'output/walkthrough-lighting'),jobs=new Map(),queue=[]
let active=false
const engineIdentity=()=>digest([LIGHTING_VERSION,...['blender/walkthrough_bake.py','blender/walkthrough_denoise.py'].map(f=>readFileSync(resolve(PROJECT_ROOT,f),'utf8'))])
const save=(dir,file,value)=>writeFile(resolve(dir,file),JSON.stringify(value))
export async function prepareLightingRequest(payload){
 const match=/^\/api\/villas\/([a-f0-9-]{36})\/files\/([\w-]+\.glb)$/.exec(payload.acceptedUrl??'')
 if(!match)throw new Error('Choose the accepted villa before preparing lighting.')
 const request=prepareWalkthroughRequest(payload),villaRoot=await realpath(resolve(PROJECT_ROOT,'output/villa-jobs'))
 const accepted=JSON.parse(await readFile(resolve(villaRoot,match[1],'accepted.json'),'utf8'))
 if(accepted.planId!==request.designId||!accepted.files.includes(match[2]))throw new Error('The accepted villa no longer matches this plan.')
 const sourcePath=await realpath(resolve(accepted.directory,match[2]))
 if(!sourcePath.startsWith(villaRoot+sep))throw new Error('Invalid accepted source.')
 const bytes=await readFile(sourcePath),sourceSha256=digest(bytes),layoutSignature=lightingLayoutSignature(request.appearance)
 const quality=payload.lightingQuality??'balanced'
 if(!['performance','balanced','high'].includes(quality))throw new Error('Choose a supported lighting quality.')
 const settings={performance:[1024,16],balanced:[2048,32],high:[4096,64]}[quality]
 const identity=digest([engineIdentity(),sourceSha256,layoutSignature,settings])
 return {...request,sourcePath,sourceSha256,layoutSignature,identity,resolution:settings[0],samples:settings[1],acceptedUrl:payload.acceptedUrl}
}
async function manifest(id){
 const dir=resolve(ROOT,id),data=JSON.parse(await readFile(resolve(dir,'manifest.json'),'utf8'))
 if(data.identity!==id||data.version!==1||!data.files?.length)throw new Error('Incomplete lighting package')
 for(const f of data.files){if(!/^(?:layout\.bin|indirect-\d+\.hdr|ao-\d+\.png)$/.test(f.name))throw new Error('Invalid lighting file')
  const bytes=await readFile(resolve(dir,f.name));if(bytes.length!==f.bytes||digest(bytes)!==f.sha256)throw new Error('Changed lighting artifact')}
 return data
}
async function pump(){
 if(active)return;active=true
 while(queue.length){const data=queue.shift(),job=jobs.get(data.identity),stage=resolve(ROOT,data.identity+'.tmp'),dir=resolve(ROOT,data.identity)
  try{
   await mkdir(ROOT,{recursive:true});await mkdir(stage,{recursive:true})
   job.status='baking';job.stage='Preparing exact accepted geometry'
   const loader=new GLTFLoader().register(()=>({name:'LIGHTING_GEOMETRY_ONLY',loadTexture:()=>Promise.resolve(new Texture())}))
   const bytes=await readFile(data.sourcePath),{scene}=await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'')
   acceptedVillaDoors(scene,data.geometry.metadata.openings)
   const dynamicNames=[];scene.traverse(o=>{if(o.userData.walkthroughDoorId)dynamicNames.push(o.name)})
   const {appearance}=await resolveWalkthroughImages(data.appearance)
   await save(stage,'input.json',{...data,appearance,planId:data.designId,dynamicNames})
   await runBlender(['--input',resolve(stage,'input.json'),'--out',stage],resolve(stage,'bake.log'),45*60e3,'4',undefined,'blender/walkthrough_bake.py',output=>{const m=output.match(/@@bake ([^\r\n]+)/);if(m)job.stage=m[1]})
   const m=JSON.parse(await readFile(resolve(stage,'manifest.json'),'utf8'))
   if(m.identity!==data.identity||m.sourceSha256!==data.sourceSha256||m.layoutSignature!==data.layoutSignature||!m.meshes.length)throw new Error('Bake identity mismatch')
   for(const f of m.files){const b=await readFile(resolve(stage,f.name));if(digest(b)!==f.sha256)throw new Error('Incomplete bake output')}
   await rename(stage,dir);job.status='ready';job.stage='Baked daylight ready'
  }catch(e){job.status='failed';job.error='Lighting could not be prepared. Your accepted villa and finishes are unchanged.';job.detail=e.message;console.error('[walkthrough-lighting]',e.message)}
 }
 active=false
}
export async function requestLighting(payload){
 const data=await prepareLightingRequest(payload),id=data.identity
 try{await manifest(id);return {id,status:'ready',stage:'Baked daylight ready'}}catch{}
 const existing=jobs.get(id);if(existing&&existing.status!=='failed')return existing
 if(queue.length>=2)throw new Error('Lighting queue is full. Please try again after the current bake.')
 const job={id,status:'queued',stage:'Waiting for Cycles'};jobs.set(id,job);queue.push(data);void pump();return job
}
export async function handleWalkthroughLighting(req,res,readJson){
 const url=new URL(req.url,'http://localhost'),path=url.pathname
 if(!path.startsWith('/api/walkthrough-lighting'))return false
 const send=(code,obj)=>{res.writeHead(code,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(obj))}
 try{
  if(req.method==='POST'&&path==='/api/walkthrough-lighting'){const job=await requestLighting(await readJson(req,16e6));send(job.status==='ready'?200:202,job);return true}
  const match=/^\/api\/walkthrough-lighting\/([a-f0-9]{64})(?:\/(manifest\.json|layout\.bin|indirect-\d+\.hdr|ao-\d+\.png))?$/.exec(path)
  if(!match||!['GET','HEAD'].includes(req.method)){send(404,{error:'Unknown lighting endpoint'});return true}
  const [,id,file]=match
  let m;try{m=await manifest(id)}catch{const job=jobs.get(id);send(job?200:404,job??{status:'missing'});return true}
  if(!file){send(200,{id,status:'ready',stage:'Baked daylight ready'});return true}
  if(file==='manifest.json'){send(200,m);return true}
  if(!m.files.some(f=>f.name===file)){send(404,{error:'Lighting file unavailable'});return true}
  const filename=resolve(ROOT,id,file),info=await stat(filename)
  const compress=file==='layout.bin'&&/\bgzip\b/.test(req.headers['accept-encoding']??'')
  res.writeHead(200,{'content-type':file.endsWith('.png')?'image/png':'application/octet-stream',...(compress?{'content-encoding':'gzip','vary':'Accept-Encoding'}:{'content-length':info.size}),'cache-control':'private,max-age=31536000,immutable','x-content-type-options':'nosniff'})
  if(req.method==='HEAD')res.end();else if(compress)createReadStream(filename).pipe(createGzip()).pipe(res);else createReadStream(filename).pipe(res)
 }catch(e){send(400,{error:e.message})}
 return true
}
