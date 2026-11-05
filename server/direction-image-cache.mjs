import {createHash} from 'node:crypto'
import {readFileSync,readdirSync} from 'node:fs'
import {resolve,relative} from 'node:path'
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises'
import {PROJECT_ROOT} from './blender-process.mjs'

let revision
function renderRevision(){
 if(revision)return revision
 const hash=createHash('sha256')
 const visit=path=>{for(const item of readdirSync(path,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
  if(item.name==='__pycache__')continue
  const file=resolve(path,item.name)
  if(item.isDirectory())visit(file)
  else if(/\.(?:py|ts|json|mjs)$/.test(item.name)){hash.update(relative(PROJECT_ROOT,file));hash.update(readFileSync(file))}
 }}
 visit(resolve(PROJECT_ROOT,'blender'));visit(resolve(PROJECT_ROOT,'src/lib'))
 hash.update(readFileSync(resolve(PROJECT_ROOT,'server/direction-render-profile.mjs')))
 hash.update(readFileSync(resolve(PROJECT_ROOT,'scripts/direction-image-worker.mjs')))
 return revision=hash.digest('hex')
}
const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value
export function directionImageKey(request,sourceRevision=renderRevision()){
 return createHash('sha256').update(JSON.stringify(stable({plan:request.plan,seed:request.seed,quality:request.quality,sourceRevision}))).digest('hex')
}
export async function readDirectionImageCache(root,key){
 try{
  const record=JSON.parse(await readFile(resolve(root,'direction-image-cache',key+'.json'),'utf8'))
  return /^[a-f0-9-]{36}$/.test(record.jobId)?record.jobId:null
 }catch{return null}
}
export async function writeDirectionImageCache(root,key,jobId){
 const directory=resolve(root,'direction-image-cache');await mkdir(directory,{recursive:true})
 const file=resolve(directory,key+'.json'),temporary=file+'.'+jobId+'.tmp'
 await writeFile(temporary,JSON.stringify({jobId}));await rename(temporary,file)
}
