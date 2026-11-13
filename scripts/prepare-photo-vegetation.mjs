import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {resolve,dirname} from 'node:path'
import {createHash} from 'node:crypto'
import {runBlender} from '../server/blender-process.mjs'
const root=resolve('output/photo-vegetation-source'),output=resolve('public/exterior-assets/photo'),records=[]
for(const [id,budget,name] of [['tree_small_02',90000,'garden-tree'],['shrub_04',14000,'garden-shrub']]){
 let metadata
 try{metadata=JSON.parse(await readFile(`output/photo-${id}.json`,'utf8'))}catch{
  const response=await fetch(`https://api.polyhaven.com/files/${id}`,{headers:{'User-Agent':'Formstead/1.0 local architectural visualization'},signal:AbortSignal.timeout(20000)})
  if(!response.ok)throw Error(`${id}: ${response.status}`);metadata=await response.json()
 }
 const entry=metadata.gltf['1k'].gltf,folder=resolve(root,id)
 const files=[[`${id}.gltf`,entry],...Object.entries(entry.include)]
 await Promise.all(files.map(async([relative,file])=>{
  if(!/^(?:textures\/)?[a-zA-Z0-9_.-]+$/.test(relative)||relative.includes('..')||new URL(file.url).hostname!=='dl.polyhaven.org')throw Error('Invalid asset path')
  const path=resolve(folder,relative);if(!path.startsWith(folder+'\\')&&!path.startsWith(folder+'/'))throw Error('Asset path escaped source directory')
  await mkdir(dirname(path),{recursive:true});let bytes
  try{bytes=await readFile(path)}catch{}
  if(!bytes||createHash('md5').update(bytes).digest('hex')!==file.md5){const response=await fetch(file.url,{signal:AbortSignal.timeout(120000)});if(!response.ok)throw Error(`${id}: ${response.status}`);bytes=Buffer.from(await response.arrayBuffer());if(createHash('md5').update(bytes).digest('hex')!==file.md5)throw Error('Asset checksum mismatch');await writeFile(path,bytes)}
  console.log('Verified',relative,bytes.length)
 }))
 const request=resolve(root,`${id}.json`)
 await writeFile(request,JSON.stringify({input:resolve(folder,`${id}.gltf`),output:resolve(output,`${name}.glb`),budget,source:`https://polyhaven.com/a/${id}`}))
 console.log('Optimising vegetation',id,'budget',budget)
 await runBlender([request],resolve(root,`${id}.log`),600000,'4',undefined,'blender/photo_vegetation.py')
 const bytes=await readFile(resolve(output,`${name}.glb`))
 records.push({asset:id,file:`${name}.glb`,source:`https://polyhaven.com/a/${id}`,license:'CC0-1.0',triangleBudget:budget,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),sourceFiles:files.map(([path,file])=>({path,url:file.url,md5:file.md5}))})
 console.log('Prepared',name,bytes.length)
}
await writeFile(resolve(output,'vegetation-manifest.json'),JSON.stringify(records,null,2)+'\n')
