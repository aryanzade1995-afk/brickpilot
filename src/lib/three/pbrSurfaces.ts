import {DataTexture,LinearMipmapLinearFilter,RepeatWrapping,RGBAFormat,type MeshStandardMaterial} from 'three'
import type {Look} from './dressRoom.ts'
export type SurfaceProfile={role:'paint'|'gypsum'|'wood'|'floor'|'stone';normalStrength:number;roughnessVariation:number;detailSizeM:number;basis:'illustrative-microdetail'}
export function surfaceProfile(key:string,look:Look):SurfaceProfile|null{
 const role=key.startsWith('[')?JSON.parse(key)[2]:look.finish==='worktop'?'counter':''
 if(role==='wall')return {role:'paint',normalStrength:.035,roughnessVariation:.035,detailSizeM:.25,basis:'illustrative-microdetail'}
 if(role==='ceiling')return {role:'gypsum',normalStrength:.045,roughnessVariation:.05,detailSizeM:.3,basis:'illustrative-microdetail'}
 if(role==='door'||role==='mainDoor')return {role:'wood',normalStrength:.16,roughnessVariation:.12,detailSizeM:.6,basis:'illustrative-microdetail'}
 if(role==='floor'||role==='counter')return {role:role==='counter'?'stone':'floor',normalStrength:0,roughnessVariation:look.rough<.3?.12:.2,detailSizeM:look.surface?.tileM??.8,basis:'illustrative-microdetail'}
 return null
}
/** Neutral maps modulate selected PBR values, never invent a product scan or
 * recolour a catalogue texture. Metre UVs keep the microdetail scale stable. */
export function applySurfaceMicrodetail(material:MeshStandardMaterial,profile:SurfaceProfile,textures:Map<string,DataTexture>){
 const map=(normal:boolean)=>{
  const key=JSON.stringify([profile,normal]);let texture=textures.get(key);if(texture)return texture
  const size=128,pixels=new Uint8Array(size*size*4)
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
   const n=(((x*73856093)^(y*19349663))>>>0)%255/255
   const grain=profile.role==='wood'?Math.sin(x*.5+Math.sin(y*.04)*2):n*2-1
   if(normal)pixels.set([Math.round(128+grain*10),Math.round(128+(n-.5)*8),254,255],(y*size+x)*4)
   else {const v=Math.round(255*(1-profile.roughnessVariation*n));pixels.set([v,v,v,255],(y*size+x)*4)}
  }
  texture=new DataTexture(pixels,size,size,RGBAFormat);texture.wrapS=texture.wrapT=RepeatWrapping;texture.repeat.set(1/profile.detailSizeM,1/profile.detailSizeM)
  texture.generateMipmaps=true;texture.minFilter=LinearMipmapLinearFilter;texture.anisotropy=4;texture.needsUpdate=true;texture.userData.proceduralKey='formstead-pbr:'+key
  textures.set(key,texture);return texture
 }
 material.roughnessMap=map(false)
 // Studio reflection cards look like glossy stains on shaded matte plaster.
 // Attenuate only the reflection environment; keep selected paint colour,
 // roughness, direct fixture lighting and glossy tile/stone materials intact.
 if(profile.role==='paint')material.envMapIntensity=.18
 if(profile.normalStrength&&!material.normalMap){material.normalMap=map(true);material.normalScale.set(profile.normalStrength,profile.normalStrength)}
 material.userData.surfaceProfile=profile
}
