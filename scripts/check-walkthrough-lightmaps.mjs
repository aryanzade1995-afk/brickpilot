import fs from 'node:fs/promises'
import assert from 'node:assert/strict'
import {Texture,Box3,DataUtils} from 'three'
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js'
import {HDRLoader} from 'three/examples/jsm/loaders/HDRLoader.js'
import {applyLightmapUVs,validateLightingManifest} from '../src/lib/three/walkthroughLightmaps.ts'
import {digest} from '../server/walkthrough-assets.mjs'
const {id}=JSON.parse(await fs.readFile('output/furniture-sources/lighting-job.json','utf8')),dir='output/walkthrough-lighting/'+id
const m=JSON.parse(await fs.readFile(dir+'/manifest.json','utf8')),input=JSON.parse(await fs.readFile(dir+'/input.json','utf8'))
validateLightingManifest(m,id,input.planId,input.layoutSignature)
assert.equal(m.skyDirectBaked,true,'window-visible sky diffuse was omitted')
const bytes=await fs.readFile(input.sourcePath);assert.equal(digest(bytes),m.sourceSha256)
const loader=new GLTFLoader().register(()=>({name:'QA',loadTexture:()=>Promise.resolve(new Texture())})),{scene}=await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'')
const before=new Box3().setFromObject(scene),binary=await fs.readFile(dir+'/layout.bin')
const result=applyLightmapUVs(scene,{manifest:m,layout:binary.buffer.slice(binary.byteOffset,binary.byteOffset+binary.byteLength)})
assert.equal(result.missing.length,0,JSON.stringify(result.missing));assert.equal(result.matched,m.meshes.length)
assert.ok(new Box3().setFromObject(scene).equals(before),'lighting changed architectural bounds')
const energy=[]
for(const a of m.atlases){const b=await fs.readFile(dir+'/'+a.irradiance),data=new HDRLoader().parse(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));let sum=0,peak=0,nonzero=0
 for(let i=0;i<data.data.length;i+=4){const v=DataUtils.fromHalfFloat(data.data[i]);assert.ok(Number.isFinite(v));sum+=v;peak=Math.max(peak,v);if(v>0)nonzero++}
 assert.ok(nonzero>100&&peak>0,'blank indirect atlas');energy.push({atlas:a.id,mean:+(sum/(data.width*data.height)).toFixed(4),peak})}
console.log(JSON.stringify({id,matched:result.matched,unchangedBounds:true,atlases:energy,bakeDevice:m.device,seconds:m.seconds}))
