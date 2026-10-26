import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { runBlender } from '../server/blender-process.mjs'
const inputs=resolve('output/house-ideas'),output=resolve('public/house-ideas')
await mkdir(output,{recursive:true})
const manifest=JSON.parse(await readFile(resolve(inputs,'index.json'),'utf8'))
const value=(name,fallback)=>{const i=process.argv.indexOf(name);return i<0?fallback:Number(process.argv[i+1])}
const begin=value('--start',0),limit=value('--end',value('--limit',manifest.entries.length))
if(!Number.isInteger(begin)||!Number.isInteger(limit)||begin<0||limit<begin||limit>manifest.entries.length)throw new Error('Choose a valid start/end range within the library')
for(let start=begin;!process.argv.includes('--publish-only')&&start<limit;start+=12){
 console.log(`Rendering library ${start+1}–${Math.min(start+12,limit)} / ${manifest.entries.length}`)
 await runBlender(['--inputs',inputs,'--output',output,'--start',String(start),'--end',String(Math.min(start+12,limit))],resolve(inputs,`render-${start}.log`),90*60*1000,4,undefined,'blender/house_ideas.py')
}
const entries=[]
for(const item of manifest.entries){
 let record
 try{record=JSON.parse(await readFile(resolve(inputs,`${item.id}.render.json`),'utf8'))}catch{}
 let digest
 try { const source=await readFile(resolve(inputs,`${item.id}.json`)); const options={render:{engine:'EEVEE',quality:'preview',samples:16,resolution:[768,576]},landscape:{enabled:false}}
  // Python's sort_keys JSON formatting is part of the resumable cache contract.
  const sorted=v=>Array.isArray(v)?'['+v.map(sorted).join(', ')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+': '+sorted(v[k])).join(', ')+'}':JSON.stringify(v)
  digest=createHash('sha256').update(source).update(sorted(options)).digest('hex')
 }catch{}
 const ready=item.status==='ready'&&existsSync(resolve(output,`${item.id}.png`))&&record?.source==='Blender'&&record.planId===item.planId&&record.seed===item.seed&&record.digest===digest
 entries.push(item.status==='ready'?(ready?{...item,renderDigest:record.digest}:{...item,status:'unavailable',image:undefined,reason:record?.reason??'Offline image has not been rendered.'}):item)
}
if(process.argv.includes('--publish-only')||begin===0&&limit>=manifest.entries.length) await writeFile(resolve(output,'manifest.json'),JSON.stringify({...manifest,entries},null,2))
console.log(JSON.stringify({total:entries.length,ready:entries.filter(e=>e.status==='ready').length,unavailable:entries.filter(e=>e.status!=='ready').length}))
