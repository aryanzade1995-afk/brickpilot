import { createHash } from 'node:crypto'
import { mkdir, writeFile, readFile, rename, rm } from 'node:fs/promises'
import { existsSync, createReadStream, readdirSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { createInteriorScene, INTERIOR_STYLES, FLOORINGS, CEILINGS, LIGHTINGS, DENSITIES } from '../src/lib/interior/preview.ts'
import { validate } from '../src/lib/rules/index.ts'
import { createBuildingModel } from '../src/lib/engine/buildingModel.ts'
import { PROJECT_ROOT, runBlender } from './blender-process.mjs'

const root = resolve(PROJECT_ROOT, 'output/interior')
const files = new Map()
const safeId=value=>String(value).replace(/[^a-z0-9_-]/gi,'_').slice(0,120)||'room'
const pending = new Map()
const stages = new Map()
const renderer = await readFile(resolve(PROJECT_ROOT, 'blender/interior_preview.py'))
const version = createHash('sha256').update(renderer).digest('hex')
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]))
  return value
}
export function previewKey(scene) { return createHash('sha256').update(JSON.stringify(canonical({version, scene}))).digest('hex') }
export function validateConfiguration(c, quality) {
  if (!c || typeof c.roomId !== 'string' || !Number.isInteger(c.floor) || !['fast','high'].includes(quality)) throw new Error('Select a valid room, floor and quality.')
  for (const [value, list] of [[c.style,INTERIOR_STYLES],[c.flooring?.material,FLOORINGS],[c.ceiling?.type,CEILINGS],[c.lighting,LIGHTINGS],[c.furnitureDensity,DENSITIES]]) if (!list.some(o=>o.id===value)) throw new Error('Invalid interior option.')
  for (const color of [c.flooring?.color,c.walls?.color,c.ceiling?.color]) if (!/^#[0-9a-f]{6}$/i.test(color)) throw new Error('Choose valid colours.')
}
export async function renderPreview(scene, onStage = ()=>{}) {
  const key = previewKey(scene), cachePath=`${safeId(scene.designId)}/${safeId(scene.room.id)}/${key}`, dir = resolve(root,cachePath), output = resolve(dir,'preview-360.webp')
  files.set(key,output)
  if (existsSync(output)) return { key, cachePath, cached:true, url:`/api/interior-preview/${key}.webp`, initialYaw:scene.initialYaw }
  if (pending.has(key)) {const existing=pending.get(key);existing.listeners.add(onStage);onStage(existing.stage);return existing.promise}
  if (pending.size >= 2) throw new Error('Preview renderer is busy. Try again shortly.')
  const record={listeners:new Set([onStage]),stage:'Preparing selected room',promise:null}
  const report=stage=>{record.stage=stage;for(const listener of record.listeners) listener(stage)}
  const job = (async()=> {
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
      if (!existsSync(temporary)) throw new Error('Blender returned no panorama.')
      await rename(temporary,output)
      return {key,cachePath,cached:false,url:`/api/interior-preview/${key}.webp`,initialYaw:scene.initialYaw}
    } catch(error) {
      await rm(temporary,{force:true})
      const log=await readFile(resolve(dir,'render.log'),'utf8').catch(()=> '')
      throw new Error(log.match(/@@error ([^\r\n]+)/)?.[1] || error.message)
    } finally { pending.delete(key) }
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
    if(!file || !existsSync(file)) {res.writeHead(404);res.end();return true}
    res.writeHead(200,{'content-type':'image/webp','cache-control':'public, max-age=31536000, immutable'})
    createReadStream(file).pipe(res);return true
  }
  if (req.method!=='POST' || req.url!=='/api/interior-preview') return false
  const send=(code,data)=>{res.writeHead(code,{'content-type':'application/json'});res.end(JSON.stringify(data))}
  let scene, requestId
  try {
    const p=await readJson(req,8e6)
    requestId=/^[a-z0-9-]{1,64}$/.test(p.requestId??'')?p.requestId:null
    validateConfiguration(p.config,p.quality)
    if(!validate(p.design).hardChecksPass) throw new Error('The plan must pass validation before previewing.')
    scene=createInteriorScene(p.design,createBuildingModel(p.design).planId,p.config,p.design.model.brief.style.character,p.quality)
    if(!scene) throw new Error('Interior preview could not be prepared for this room.')
  } catch(error) {send(400,{error:error.message});return true}
  try { send(200,await renderPreview(scene,stage=>{if(requestId)stages.set(requestId,stage)})) } catch(error) {send(503,{error:`Preview failed: ${error.message}`})}
  finally {if(requestId)stages.delete(requestId)}
  return true
}
