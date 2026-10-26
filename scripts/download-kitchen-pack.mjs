import fs from 'node:fs/promises'
import path from 'node:path'
import {unzipSync} from 'three/examples/jsm/libs/fflate.module.js'
const root='output/furniture-sources',page='https://www.sweethome3d.com/free-3d-models/'
const html=await(await fetch(page)).text(),section=html.slice(html.indexOf('Models by Blend Swap contributors'))
const choices={'kitchen-base':'kitchenSmallLowerCabinet','kitchen-drawers':'kitchenDrawersCabinet','kitchen-upper':'kitchenUpperCabinet','kitchen-hob':'largeStove'}
const manifest=JSON.parse(await fs.readFile(root+'/downloads.json','utf8'))
for(const [id,file]of Object.entries(choices)){
 const url=section.match(new RegExp('data-model="([^"]*/blendswap-cc-by/'+file+'\\.zip)"'))?.[1]
 if(!url)throw new Error('Official kitchen source unavailable: '+id)
 const dir=path.join(root,id);await fs.mkdir(dir,{recursive:true})
 const response=await fetch(url);if(!response.ok)throw new Error('Download failed '+response.status)
 const bytes=new Uint8Array(await response.arrayBuffer());await fs.writeFile(dir+'/source.zip',bytes)
 for(const [name,data]of Object.entries(unzipSync(bytes))){
  if(name.endsWith('/'))continue
  const dest=path.resolve(dir,name)
  if(!dest.startsWith(path.resolve(dir)+path.sep)||!/\.(obj|mtl|png|jpe?g|txt|html)$/i.test(name))throw new Error('Unexpected archive entry')
  await fs.mkdir(path.dirname(dest),{recursive:true});await fs.writeFile(dest,data)
 }
 const record={id,label:({'kitchen-base':'Kitchen base cabinet','kitchen-drawers':'Kitchen drawer cabinet','kitchen-upper':'Kitchen wall cabinet','kitchen-hob':'Gas hob'})[id],sourceUrl:url,sourcePage:page,license:'CC-BY-3.0',licenseUrl:'https://creativecommons.org/licenses/by/3.0/',verifiedAt:'2026-10-24',dir}
 const previous=manifest.findIndex(a=>a.id===id);if(previous<0)manifest.push(record);else manifest[previous]=record
 console.log('DOWNLOADED',id)
}
await fs.writeFile(root+'/downloads.json',JSON.stringify(manifest,null,2))
