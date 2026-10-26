import {Group,Mesh,MeshStandardMaterial,Texture,TextureLoader,RepeatWrapping,SRGBColorSpace} from 'three'
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js'
import {interiorAsset} from '../interior-assets/catalogue.ts'
import type {InteriorModelInstance} from '../interior-assets/placements.ts'

// Bounded by the shipped catalogue. Geometry/maps are uploaded once per asset,
// shared by room instances; owned material clones carry selected colours.
const templates=new Map<string,Promise<Group>>()
const finishMaps=new Map<string,Promise<Texture>>()
async function selectedFinishMap(image?:string){
 if(!image)return null
 if(!image.startsWith('/')||image.startsWith('//')||image.split('/').includes('..'))throw new Error('Invalid selected cabinet texture')
 let pending=finishMaps.get(image)
 if(!pending){pending=new TextureLoader().loadAsync(image).then(t=>{t.colorSpace=SRGBColorSpace;t.flipY=false;t.wrapS=t.wrapT=RepeatWrapping;t.anisotropy=4;t.userData.sharedInteriorAsset=true;return t}).catch(e=>{finishMaps.delete(image);throw e});finishMaps.set(image,pending)}
 return pending
}
async function template(id:string){
 const asset=interiorAsset(id);if(!asset)throw new Error('Unknown interior asset')
 let pending=templates.get(id)
 if(!pending){pending=new GLTFLoader().loadAsync(`${asset.url}?v=${asset.sha256.slice(0,12)}`).then(g=>{
  g.scene.traverse(o=>{if(!(o instanceof Mesh))return;o.geometry.userData.sharedInteriorAsset=true
   for(const m of Array.isArray(o.material)?o.material:[o.material])for(const v of Object.values(m))if(v instanceof Texture){v.userData.sharedInteriorAsset=true;v.anisotropy=4}
  });return g.scene
 }).catch(e=>{templates.delete(id);throw e});templates.set(id,pending)}
 return pending
}
export async function instantiateInteriorModel(instance:InteriorModelInstance,load=template){
 const asset=interiorAsset(instance.assetId)
 if(!asset||asset.sha256!==instance.assetRevision)throw new Error('Interior model revision is unavailable')
 const [base,finishMap]=await Promise.all([load(instance.assetId),selectedFinishMap(instance.finish?.surface?.image)]),root=new Group(),model=base.clone(true)
 model.scale.set(...instance.scale);root.position.set(...instance.position);root.rotation.y=instance.rotation;root.add(model)
 root.userData={interiorModel:instance.assetId,roomId:instance.roomId,sourceProduct:instance.sourceProduct,instanceId:instance.id}
 model.traverse(o=>{if(!(o instanceof Mesh))return
  const clone=(original:MeshStandardMaterial)=>{
   const m=original.clone(),role=instance.assetId==='bed'&&m.roughness>=.7?'upholstery':m.userData.formsteadFinishRole
   if(instance.color&&['ceramic','paint','upholstery'].includes(role)){
    m.color.set(instance.color)
    if(role==='paint')m.map=null // Preserve normal/roughness maps on recoloured paint.
   }
   if(instance.hardwareColor&&m.metalness>=.6){m.color.set(instance.hardwareColor);m.map=null}
   if(role==='paint'&&instance.finish){m.roughness=instance.finish.rough;if(finishMap){m.map=finishMap;m.color.set('#ffffff')}}
   const colour=instance.materialColors?.[m.name]??instance.materialColors?.[m.name.replace(/\.\d+$/,'')]
   if(colour)m.color.set(colour)
   return m
  }
  o.material=Array.isArray(o.material)?o.material.map(clone):clone(o.material)
  o.castShadow=o.receiveShadow=true
 });return root
}
