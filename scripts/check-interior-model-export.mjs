import fs from 'node:fs'
import assert from 'node:assert/strict'
import {Box3,Texture,Vector3} from 'three'
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js'
const bytes=fs.readFileSync('output/furniture-sources/models.glb'),app=JSON.parse(fs.readFileSync('output/furniture-sources/appearance.json'))
const loader=new GLTFLoader().register(()=>({name:'GEOMETRY_QA',loadTexture:()=>Promise.resolve(new Texture())})),{scene}=await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'')
let checked=0
for(const instance of app.models){
 let actual;scene.traverse(o=>{if(o.userData.instanceId===instance.id)actual=o})
 assert.ok(actual,instance.id)
 const bounds=new Box3().setFromObject(actual),c=Math.abs(Math.cos(instance.rotation)),s=Math.abs(Math.sin(instance.rotation)),size=[instance.size[0]*c+instance.size[2]*s,instance.size[1],instance.size[0]*s+instance.size[2]*c]
 const min=[instance.position[0]-size[0]/2,instance.position[1],instance.position[2]-size[2]/2],max=[instance.position[0]+size[0]/2,instance.position[1]+size[1],instance.position[2]+size[2]/2]
 if(bounds.min.distanceTo(new Vector3(...min))>=.003||bounds.max.distanceTo(new Vector3(...max))>=.003)console.log({asset:instance.assetId,actual:[bounds.min.toArray(),bounds.max.toArray()],expected:[min,max]})
 assert.ok(bounds.min.distanceTo(new Vector3(...min))<.003&&bounds.max.distanceTo(new Vector3(...max))<.003,instance.assetId+' live/Blender transform mismatch')
 checked++
}
console.log(JSON.stringify({canonicalInstances:checked,matchedBlenderGLB:true,coordinates:'metres / x east / y up / z plan north'}))
