import {Float32BufferAttribute,HalfFloatType,LinearSRGBColorSpace,Mesh,MeshStandardMaterial,NoColorSpace,TextureLoader,Vector3,type Group,type Texture,type Material,type BufferGeometry} from 'three'
import {HDRLoader} from 'three/examples/jsm/loaders/HDRLoader.js'
import type {LightingManifest} from '../walkthrough/lighting.ts'
type Assets={manifest:LightingManifest;layout:ArrayBuffer;indirect:Texture[];ao:Texture[]}
const owned=new WeakMap<Group,Set<Material>>()
const key=(p:number[])=>p.map(v=>Math.round(v*10000)).join(',')
const triangleKey=(p:number[][])=>p.map(key).sort().join('|')
export function validateLightingManifest(m:LightingManifest,id:string,planId:string,signature:string){
 if(m.version!==1||m.identity!==id||m.planId!==planId||m.layoutSignature!==signature||m.preset!=='daylight'||m.uvChannel!==2||m.directLightBaked!==false||m.albedoBaked!==false||m.transport!=='neutral-indirect-diffuse'||m.meshes.length>10000||m.atlases.length>16||m.layoutBytes>100e6)throw new Error('Lighting belongs to another design or configuration.')
 for(const a of m.atlases)if(!/^indirect-\d+\.hdr$/.test(a.irradiance)||!/^ao-\d+\.png$/.test(a.ao)||a.width>4096||a.height>4096)throw new Error('Invalid lighting atlas')
 for(const mesh of m.meshes)if(!Number.isInteger(mesh.count)||mesh.count%3||mesh.count<=0||mesh.offset<0||mesh.offset%20||mesh.offset+mesh.count*20>m.layoutBytes||!m.atlases[mesh.atlas])throw new Error('Invalid lightmap UV range')
}
export async function loadWalkthroughLightmaps(id:string,planId:string,signature:string):Promise<Assets>{
 if(!/^[a-f0-9]{64}$/.test(id))throw new Error('Invalid lighting package')
 const base=`/api/walkthrough-lighting/${id}/`,r=await fetch(base+'manifest.json');if(!r.ok)throw new Error('Lighting package unavailable')
 const manifest=await r.json() as LightingManifest;validateLightingManifest(manifest,id,planId,signature)
 const layout=await(await fetch(base+'layout.bin')).arrayBuffer();if(layout.byteLength!==manifest.layoutBytes)throw new Error('Incomplete lighting UV data')
 const indirect:Texture[]=[],ao:Texture[]=[]
 try{
  for(const a of manifest.atlases){
   const light=await new HDRLoader().setDataType(HalfFloatType).loadAsync(base+a.irradiance);light.channel=2;light.flipY=false;light.colorSpace=LinearSRGBColorSpace;light.userData.bakedLighting=true;indirect.push(light)
   const occlusion=await new TextureLoader().loadAsync(base+a.ao);occlusion.channel=2;occlusion.flipY=false;occlusion.colorSpace=NoColorSpace;occlusion.userData.bakedLighting=true;ao.push(occlusion)
  }
  return {manifest,layout,indirect,ao}
 }catch(error){[...indirect,...ao].forEach(t=>t.dispose());throw error}
}
/** Match world-space triangles, not exporter indices. Only add a UV attribute;
 * no vertex moves, mesh replacements, door merges or collision updates. */
export function applyLightmapUVs(root:Group,assets:Pick<Assets,'manifest'|'layout'>){
 const data=new DataView(assets.layout);root.updateMatrixWorld(true)
 let matched=0;const missing:string[]=[],retired=new Set<BufferGeometry>()
 for(const rec of assets.manifest.meshes){
  const mesh=root.getObjectByName(rec.name);if(!(mesh instanceof Mesh)){missing.push(rec.name);continue}
  const triangles=new Map<string,{points:number[][];uv:number[][]}[]>()
  for(let i=0;i<rec.count;i+=3){const points:number[][]=[],uv:number[][]=[]
   for(let j=0;j<3;j++){const at=rec.offset+(i+j)*20,p=[0,1,2].map(k=>data.getFloat32(at+k*4,true)),v=[data.getFloat32(at+12,true),data.getFloat32(at+16,true)];if([...p,...v].some(n=>!Number.isFinite(n))||v.some(n=>n<-.001||n>1.001))throw new Error('Non-finite lighting UV data');points.push(p);uv.push(v)}
   const k=triangleKey(points),list=triangles.get(k)??[];list.push({points,uv});triangles.set(k,list)
  }
  const geometry=mesh.geometry.index?mesh.geometry.toNonIndexed():mesh.geometry.clone(),position=geometry.attributes.position,uv=new Float32Array(position.count*2),point=new Vector3();let valid=true
  for(let i=0;i<position.count;i+=3){const points=[0,1,2].map(j=>point.fromBufferAttribute(position,i+j).applyMatrix4(mesh.matrixWorld).toArray()),entry=triangles.get(triangleKey(points))?.[0]
   if(!entry){valid=false;break}
   // Sidecar images are Blender top-row-first files; unlike a glTF export,
   // their raw Blender UVs have not yet had the V coordinate converted.
   for(let j=0;j<3;j++){const corner=entry.points.findIndex(p=>key(p)===key(points[j]));if(corner<0){valid=false;break}uv.set([entry.uv[corner][0],1-entry.uv[corner][1]],(i+j)*2)}
  }
  if(!valid){geometry.dispose();missing.push(rec.name);continue}
  geometry.setAttribute('uv2',new Float32BufferAttribute(uv,2));retired.add(mesh.geometry);mesh.geometry=geometry;mesh.userData.lightingAtlas=rec.atlas;matched++
 }
 if(!matched)throw new Error('Baked UVs do not match the accepted model.')
 root.userData.lightmapIdentity=assets.manifest.identity
 const retained=new Set<BufferGeometry>();root.traverse(o=>{if(o instanceof Mesh)retained.add(o.geometry)});for(const g of retired)if(!retained.has(g))g.dispose()
 return {matched,missing}
}
export function applyWalkthroughLightmaps(root:Group,assets:Assets){
 const previous=owned.get(root)??new Set(),next=new Set<Material>(),cache=new Map<Material,Map<number,Material>>()
 root.traverse(o=>{
  if(!(o instanceof Mesh)||!Number.isInteger(o.userData.lightingAtlas)||!o.geometry.attributes.uv2)return
  const atlas=o.userData.lightingAtlas
  const convert=(source:Material)=>{
   if(!(source instanceof MeshStandardMaterial)||source.transparent)return source
   const variants=cache.get(source)??new Map<number,Material>();let material=variants.get(atlas)
   if(!material){const m=source.clone();m.lightMap=assets.indirect[atlas];m.lightMapIntensity=Math.PI;m.aoMap=assets.ao[atlas];m.aoMapIntensity=.55;m.userData.bakedLighting=true
    // Bright residential presentation: retain the existing neutral ambient and
    // diffuse environment fill. Replacing both with only a dim bake turned the
    // selected cream paint, pale floors and concrete returns charcoal. Three's
    // normal light-map chunk already adds the baked bounce exactly once.
    // This is a viewing fill, not a claim of physically measured illumination.
    // AO gives gentle contact definition without crushing the whole room.
    m.onBeforeCompile=shader=>{shader.fragmentShader=shader.fragmentShader.replace('#include <aomap_fragment>','vec3 daylightDiffuseBeforeAO = reflectedLight.indirectDiffuse;\n#include <aomap_fragment>\n#ifdef USE_LIGHTMAP\nreflectedLight.indirectDiffuse = mix(daylightDiffuseBeforeAO, reflectedLight.indirectDiffuse, 0.25);\n#endif')}
    m.customProgramCacheKey=()=> 'formstead-bright-residential-v3';m.needsUpdate=true;material=m;variants.set(atlas,m);cache.set(source,variants);next.add(m)}
   return material
  }
  o.material=Array.isArray(o.material)?o.material.map(convert):convert(o.material)
 })
 owned.set(root,next);for(const m of previous)if(!next.has(m))m.dispose()
}
export function disposeWalkthroughLightmaps(assets:Assets){[...assets.indirect,...assets.ao].forEach(t=>t.dispose())}
