import {mkdir,readFile,writeFile,stat} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {unzipSync} from 'three/addons/libs/fflate.module.js'
const root=new URL('../public/exterior-assets/photo/',import.meta.url)
await mkdir(root,{recursive:true})
const assets=[['suburban_field_01','hdri'],['industrial_sunset_puresky','hdri'],['asphalt_01','surface'],['painted_plaster_wall','detail'],['concrete_floor_02','surface']]
const manifest=[]
await Promise.all(assets.map(async([id,kind])=>{
 let metadata
 try{metadata=JSON.parse(await readFile(new URL(`../output/photo-${id}.json`,import.meta.url),'utf8'))}catch{
  const response=await fetch(`https://api.polyhaven.com/files/${id}`,{headers:{'User-Agent':'Formstead/1.0 local architectural visualization'},signal:AbortSignal.timeout(20000)})
  if(!response.ok)throw Error(`${id}: ${response.status}`);metadata=await response.json()
 }
 const entries=kind==='hdri'?[['environment',metadata.hdri?.['2k']?.hdr]]:(kind==='detail'?['nor_gl','Rough']:['Diffuse','nor_gl','Rough']).map(map=>[map,metadata[map]?.['1k']?.jpg])
 await Promise.all(entries.map(async([map,file])=>{
  if(!file?.url||!file.md5)throw Error(`Missing verified ${id}/${map} download`)
  const name=`${id}-${map}.${kind==='hdri'?'hdr':'jpg'}`,target=new URL(name,root)
  let bytes
  try{bytes=await readFile(target)}catch{}
  if(!bytes||createHash('md5').update(bytes).digest('hex')!==file.md5){
   const response=await fetch(file.url,{signal:AbortSignal.timeout(90000)})
   if(!response.ok)throw Error(`${name}: ${response.status}`);bytes=Buffer.from(await response.arrayBuffer())
   if(createHash('md5').update(bytes).digest('hex')!==file.md5)throw Error(`${name}: checksum mismatch`)
   await writeFile(target,bytes)
  }
  manifest.push({asset:id,map,file:name,bytes:(await stat(target)).size,md5:file.md5,url:file.url,source:`https://polyhaven.com/a/${id}`,license:'CC0-1.0'})
  console.log(name,bytes.length)
 }))
}))
// A maintained lawn rather than the dry woodland floor in the first preview.
const lawnUrl='https://acg-download.struffelproductions.com/file/ambientCG-Web/download/Grass008_rCjsZG5x/Grass008_1K-JPG.zip'
const lawnHash='9239813af20889949b6d0f50245fd0dab9f43b8ae627b1f07c6e327509e71403'
let archive
try{archive=await readFile(new URL('../output/Grass008_1K-JPG.zip',import.meta.url))}catch{}
if(!archive||createHash('sha256').update(archive).digest('hex')!==lawnHash){
 const response=await fetch(lawnUrl,{signal:AbortSignal.timeout(90000)})
 if(!response.ok)throw Error(`Grass008: ${response.status}`);archive=Buffer.from(await response.arrayBuffer())
 if(createHash('sha256').update(archive).digest('hex')!==lawnHash)throw Error('Grass008: checksum mismatch')
}
const lawn=unzipSync(archive)
for(const [map,entry] of [['Diffuse','Color'],['nor_gl','NormalGL'],['Rough','Roughness']]){
 const bytes=lawn[`Grass008_1K-JPG_${entry}.jpg`],file=`lawn-${map}.jpg`
 if(!bytes)throw Error(`Grass008: missing ${entry}`)
 await writeFile(new URL(file,root),bytes)
 manifest.push({asset:'Grass008',map,file,bytes:bytes.length,md5:createHash('md5').update(bytes).digest('hex'),archiveSha256:lawnHash,url:lawnUrl,source:'https://ambientcg.com/view?id=Grass008',license:'CC0-1.0'})
}
await writeFile(new URL('manifest.json',root),JSON.stringify(manifest.sort((a,b)=>a.file.localeCompare(b.file)),null,2)+'\n')
await writeFile(new URL('CREDITS.md',root),'# Photographic exterior assets\n\nHDRIs and surface maps by Poly Haven contributors; Grass 008 lawn by ambientCG. Licensed CC0-1.0; source pages, original download URLs and integrity hashes are in manifest.json. https://polyhaven.com/license · https://docs.ambientcg.com/license/\n\nOptimized Tree Small 02 and Shrub 04 models by Poly Haven contributors, CC0-1.0. Sources and conversion checksums are in vegetation-manifest.json.\n\nLocal, checked downloads; no remote assets are fetched while viewing a house.\n')
