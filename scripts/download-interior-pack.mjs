import fs from 'node:fs/promises'
import path from 'node:path'
import {unzipSync} from 'three/examples/jsm/libs/fflate.module.js'
const root='output/furniture-sources', publicRoot='public/interior-assets'
await fs.mkdir(publicRoot,{recursive:true})
await fs.mkdir(root,{recursive:true})
const html=await(await fetch('https://www.sweethome3d.com/free-3d-models/')).text()
await fs.writeFile(root+'/sweethome3d.html',html)
const section=html.slice(html.indexOf('Models by Blend Swap contributors'))
const cards=[...section.matchAll(/<div class="model-card">([\s\S]*?)<div class="model-name">([\s\S]*?)<\/div><\/div>/g)].map(m=>({name:m[1].match(/alt="([^"]+)"/)?.[1],url:m[1].match(/data-model="([^"]+)"/)?.[1]})).filter(c=>c.url?.includes('/blendswap-cc-by/'))
async function unzip(bytes,dir){
 for(const [name,data]of Object.entries(unzipSync(bytes))){
  if(name.endsWith('/'))continue
  const dest=path.resolve(dir,name)
  if(!dest.startsWith(path.resolve(dir)+path.sep)||! /\.(obj|mtl|png|jpe?g|txt|html)$/i.test(name))throw new Error('Unexpected archive entry '+name)
  await fs.mkdir(path.dirname(dest),{recursive:true});await fs.writeFile(dest,data)
 }
}
const choices={sofa:'sofa2',bed:'lettoCloud','dining-chair':'chairWithCushion','dining-table':'table','coffee-table':'coffeeTable',wardrobe:'wardrobe',nightstand:'bedsideTable',toilet:'toilets_unit_jay_hardy', 'toilet-modern':'modernToilet',basin:'washbasin_jay_hardy',bathtub:'bath_jay_hardy', 'kitchen-sink':'kitchenSink', 'washing-machine':'washing_machine',lamp:'hangingLight'}
const manifest=[]
for(const [id,file]of Object.entries(choices)){
 const c=cards.find(c=>c.url?.endsWith('/'+file+'.zip'))
 if(!c){console.log('MISSING',id,file);continue}
 const dir=path.join(root,id);await fs.mkdir(dir,{recursive:true})
 const r=await fetch(c.url);if(!r.ok)throw new Error(c.url+' '+r.status)
 const bytes=new Uint8Array(await r.arrayBuffer());await fs.writeFile(dir+'/source.zip',bytes);await unzip(bytes,dir)
 manifest.push({id,label:c.name,sourceUrl:c.url,sourcePage:'https://www.sweethome3d.com/free-3d-models/',license:'CC-BY-3.0',licenseUrl:'https://creativecommons.org/licenses/by/3.0/',verifiedAt:'2026-10-24',dir})
 console.log('DOWNLOADED',id)
}
for(const [id,file]of [['toilet-wall','toilet_hang_round'],['exhaust','bathroom_fan']]){
 const url=html.match(new RegExp('data-model="([^"]*'+file+'\\.zip)"'))?.[1]
 if(!url)throw new Error('Official model source missing: '+id)
 const dir=path.join(root,id);await fs.mkdir(dir,{recursive:true})
 const r=await fetch(url);if(!r.ok)throw new Error(url+' '+r.status)
 const bytes=new Uint8Array(await r.arrayBuffer());await fs.writeFile(dir+'/source.zip',bytes);await unzip(bytes,dir)
 manifest.push({id,label:id==='exhaust'?'Exhaust fan':'Wall-hung toilet',sourceUrl:url,sourcePage:'https://www.sweethome3d.com/free-3d-models/',license:'CC-BY-3.0',licenseUrl:'https://creativecommons.org/licenses/by/3.0/',author:'Ola-Kristian HOFF'+(id==='exhaust'?'; volume adaptation by Emmanuel Puybaret / eTeks':''),verifiedAt:'2026-10-24',dir})
}
for(const id of ['ceiling_fan','modern_arm_chair_01']){
 const dir=path.join(root,id);await fs.mkdir(dir,{recursive:true})
 const data=await(await fetch('https://api.polyhaven.com/files/'+id)).json(), f=data.gltf['1k'].gltf
 for(const [name,meta]of [[id+'.gltf',f],...Object.entries(f.include)]){
  const dest=path.join(dir,name);await fs.mkdir(path.dirname(dest),{recursive:true});const r=await fetch(meta.url);if(!r.ok)throw new Error(meta.url+' '+r.status);await fs.writeFile(dest,new Uint8Array(await r.arrayBuffer()))
 }
 const info=await(await fetch('https://api.polyhaven.com/info/'+id)).json()
 manifest.push({id:id==='ceiling_fan'?'fan':'armchair',label:info.name,sourceUrl:'https://polyhaven.com/a/'+id,sourcePage:'https://polyhaven.com/a/'+id,license:'CC0-1.0',licenseUrl:'https://creativecommons.org/publicdomain/zero/1.0/',author:Object.keys(info.authors??{}).join(', '),verifiedAt:'2026-10-24',dir,format:'gltf'})
 console.log('DOWNLOADED',id)
}
await fs.writeFile(root+'/downloads.json',JSON.stringify(manifest,null,2))
await import('./download-kitchen-pack.mjs')
