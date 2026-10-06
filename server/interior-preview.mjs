import { createHash } from 'node:crypto'
import { mkdir, writeFile, readFile, rename, rm } from 'node:fs/promises'
import { existsSync, createReadStream, readdirSync, readFileSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { createInteriorScene, INTERIOR_STYLES, FLOORINGS, CEILINGS, LIGHTINGS, DENSITIES } from '../src/lib/interior/preview.ts'
import { interiorFinishes } from '../src/lib/interior/finishes.ts'
import { validate } from '../src/lib/rules/index.ts'
import { createBuildingModel } from '../src/lib/engine/buildingModel.ts'
import { PROJECT_ROOT, runBlender } from './blender-process.mjs'

const root = resolve(PROJECT_ROOT, 'output/interior')
const files = new Map()
const safeId=value=>String(value).replace(/[^a-z0-9_-]/gi,'_').slice(0,120)||'room'
const pending = new Map()
const stages = new Map()
const MAX_RENDERS = 2, queue = []
let running = 0
// the renderer version covers every Blender module the panorama depends on, so a change to any of them re-renders
const rendererFiles = ['interior_preview.py','interior_finishes.py','interior_furniture.py','interior_bathroom.py']
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]))
  return value
}
/** product images are public files: give Blender their path on disk, only for files that exist inside public/ */
const PUBLIC=resolve(PROJECT_ROOT,'public')
export function withFiles(value) {
  if(Array.isArray(value)) return value.map(withFiles)
  if(value && typeof value==='object') return Object.fromEntries(Object.entries(value).map(([k,v])=>{
    if(k==='image' && typeof v==='string') {
      const file=v.startsWith('/')?resolve(PUBLIC,'.'+decodeURIComponent(v)):resolve(v)
      if(!file.startsWith(PUBLIC+sep)||!existsSync(file)) throw new Error('The selected product image is unavailable. Restore its catalogue photo and retry.')
      return [k,file]
    }
    return [k,withFiles(v)]
  }))
  return value
}
export function previewKey(scene) {
  // Read the renderer and used images for each request. Replacing an asset at the
  // same URL, or updating Blender code, must never reuse an outdated panorama.
  const hash=createHash('sha256')
  for(const file of rendererFiles) hash.update(readFileSync(resolve(PROJECT_ROOT,'blender',file)))
  const images=new Set()
  const scan=v=>{if(Array.isArray(v))v.forEach(scan);else if(v&&typeof v==='object')for(const [k,x] of Object.entries(v)){if(k==='image'&&typeof x==='string')images.add(x);else scan(x)}}
  scan(scene)
  for(const image of [...images].sort()) {
    const file=image.startsWith('/')?resolve(PUBLIC,'.'+decodeURIComponent(image)):resolve(image)
    if(!file.startsWith(PUBLIC+sep)||!existsSync(file))throw new Error('The selected product image is unavailable. Restore its catalogue photo and retry.')
    hash.update(image);hash.update(readFileSync(file))
  }
  return hash.update(JSON.stringify(canonical(scene))).digest('hex')
}
export function validPanorama(file, quality) {
  if(!existsSync(file))return false
  try {
    const bytes=readFileSync(file)
    if(bytes.length<30 || bytes.toString('ascii',0,4)!=='RIFF' || bytes.toString('ascii',8,12)!=='WEBP' || bytes.readUInt32LE(4)+8!==bytes.length)return false
    const type=bytes.toString('ascii',12,16)
    let w,h
    if(type==='VP8 ') {w=bytes.readUInt16LE(26)&0x3fff;h=bytes.readUInt16LE(28)&0x3fff}
    else if(type==='VP8L') {const bits=bytes.readUInt32LE(21);w=(bits&0x3fff)+1;h=((bits>>>14)&0x3fff)+1}
    else if(type==='VP8X') {w=bytes.readUIntLE(24,3)+1;h=bytes.readUIntLE(27,3)+1}
    else return false
    return w===(quality==='high'?4096:2048) && h===w/2
  }catch{return false}
}
export function prepareInteriorPreview(design,config,quality) {
  validateConfiguration(config,quality)
  if(!validate(design).hardChecksPass)throw new Error('The plan must pass validation before previewing.')
  const scene=createInteriorScene(design,createBuildingModel(design).planId,config,design.model.brief.style.character,quality)
  if(!scene)throw new Error('Interior preview could not be prepared for this room.')
  const finishes=interiorFinishes(design,config.floor,config.roomId)
  if(finishes) {
    scene.finishes=withFiles(finishes)
    scene.config={...scene.config,flooring:{...scene.config.flooring,color:finishes.floor.color},walls:{color:finishes.walls.color},ceiling:{type:finishes.ceiling.type,color:finishes.ceiling.color}}
    // Visible rooms across open connections keep their own floor and wall choices.
    scene.connectedFinishes=design.floors.find(f=>f.level===config.floor).rooms.filter(r=>scene.shell.some(b=>b.id.startsWith(`connected-${r.id}-`))).map(r=>({prefix:`connected-${r.id}-`,finishes:withFiles(interiorFinishes(design,config.floor,r.id))}))
  }
  return scene
}
export function validateConfiguration(c, quality) {
  if (!c || typeof c.roomId !== 'string' || !Number.isInteger(c.floor) || !['fast','high'].includes(quality)) throw new Error('Select a valid room, floor and quality.')
  for (const [value, list] of [[c.style,INTERIOR_STYLES],[c.flooring?.material,FLOORINGS],[c.ceiling?.type,CEILINGS],[c.lighting,LIGHTINGS],[c.furnitureDensity,DENSITIES]]) if (!list.some(o=>o.id===value)) throw new Error('Invalid interior option.')
  for (const color of [c.flooring?.color,c.walls?.color,c.ceiling?.color]) if (!/^#[0-9a-f]{6}$/i.test(color)) throw new Error('Choose valid colours.')
}
export async function renderPreview(scene, onStage = ()=>{}, lookupOnly = false) {
  const key = previewKey(scene), cachePath=`${safeId(scene.designId)}/${safeId(scene.room.id)}/${key}`, dir = resolve(root,cachePath), output = resolve(dir,'preview-360.webp')
  files.set(key,output)
  if (validPanorama(output,scene.quality)) return { key, cachePath, cached:true, url:`/api/interior-preview/${key}.webp`, initialYaw:scene.initialYaw }
  if(lookupOnly)return {key,cached:false}
  if (pending.has(key)) {const existing=pending.get(key);existing.listeners.add(onStage);onStage(existing.stage);return existing.promise}

  const record={listeners:new Set([onStage]),stage:'Preparing selected room',promise:null}
  const report=stage=>{record.stage=stage;for(const listener of record.listeners) listener(stage)}
  const job = (async()=> {
    // never refuse: a request made while two renders run waits its turn (finishes changed mid-render still get their preview)
    if(running>=MAX_RENDERS){report('Waiting for the renderer');await new Promise(go=>queue.push(go))} else running++
    try {
    await mkdir(dir,{recursive:true})
    const input=resolve(dir,'scene.json'), temporary=resolve(dir,'render.webp')
    try {
      await writeFile(input,JSON.stringify(scene))
      await writeFile(resolve(dir,'config.json'),JSON.stringify(scene.config,null,2))
      let buffer=''
      const onOutput=chunk=>{
        buffer+=chunk;const lines=buffer.split('\n');buffer=lines.pop()??''
        const labels={preparing:'Preparing selected room',flooring:'Applying flooring',walls:'Applying walls',ceiling:'Applying ceiling',furniture:'Placing furniture',lighting:'Setting lighting',saving:'Saving panorama'}
        for(const line of lines) {const match=/@@stage (\w+)\s*(.*)/.exec(line);if(match)report(match[1]==='rendering'?`Rendering 360° · ${match[2]}`:labels[match[1]]??match[1])}
      }
      const execute=fallback=>runBlender(['--scene',input,'--out',temporary],resolve(dir,'render.log'),600_000,undefined,undefined,'blender/interior_preview.py',onOutput,{fallback})
      try {await execute(false)} catch(error) {
        const log=await readFile(resolve(dir,'render.log'),'utf8').catch(()=> '')
        if(!/GPU|OpenGL|Vulkan|EGL|graphics device|driver/i.test(log))throw error
        report('Retrying Eevee with basic OpenGL lighting')
        await writeFile(input,JSON.stringify({...scene,fallback:true}))
        const facesPath=resolve(dir,'faces')
        if(!facesPath.startsWith(root+sep))throw new Error('Invalid render workspace.')
        await rm(facesPath,{recursive:true,force:true})
        await execute(true)
      }
      if (!validPanorama(temporary,scene.quality)) throw new Error('Blender returned an incomplete panorama. Please retry.')
      await rename(temporary,output)
      await writeFile(resolve(dir,'specifications.json'),JSON.stringify(scene.finishes?.specifications??[],null,2))
      return {key,cachePath,cached:false,url:`/api/interior-preview/${key}.webp`,initialYaw:scene.initialYaw}
    } catch(error) {
      await rm(temporary,{force:true})
      const log=await readFile(resolve(dir,'render.log'),'utf8').catch(()=> '')
      throw new Error(log.match(/@@error ([^\r\n]+)/)?.[1] || error.message)
    }
    } finally { pending.delete(key);const next=queue.shift();if(next)next();else running-- }
  })()
  record.promise=job;pending.set(key,record)
  return job
}
export async function handleInteriorPreview(req,res,readJson) {
  const status=/^\/api\/interior-preview\/status\/([a-z0-9-]{1,64})$/.exec(req.url)
  if(req.method==='GET' && status) {res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify({stage:stages.get(status[1])??'Preparing selected room'}));return true}
  const match = /^\/api\/interior-preview\/([a-f0-9]{64})\.webp$/.exec(req.url)
  if (req.method==='GET' && match) {
    let file=files.get(match[1])
    if(!file && existsSync(root)) {const name=readdirSync(root,{recursive:true}).find(p=>String(p).replaceAll('\\','/').endsWith(`/${match[1]}/preview-360.webp`));if(name){file=resolve(root,String(name));files.set(match[1],file)}}
    if(!file || !existsSync(file)) {res.writeHead(404,{'cache-control':'no-store'});res.end();return true}
    res.writeHead(200,{'content-type':'image/webp','cache-control':'public, max-age=31536000, immutable'})
    createReadStream(file).pipe(res);return true
  }
  if (req.method!=='POST' || req.url!=='/api/interior-preview') return false
  const send=(code,data)=>{res.writeHead(code,{'content-type':'application/json'});res.end(JSON.stringify(data))}
  let scene, requestId, lookupOnly
  try {
    const p=await readJson(req,8e6)
    requestId=/^[a-z0-9-]{1,64}$/.test(p.requestId??'')?p.requestId:null
    lookupOnly=p.lookupOnly===true
    scene=prepareInteriorPreview(p.design,p.config,p.quality)
  } catch(error) {send(400,{error:error.message});return true}
  try { send(200,await renderPreview(scene,stage=>{if(requestId)stages.set(requestId,stage)},lookupOnly)) } catch(error) {send(503,{error:`Preview failed: ${error.message}`})}
  finally {if(requestId)stages.delete(requestId)}
  return true
}
