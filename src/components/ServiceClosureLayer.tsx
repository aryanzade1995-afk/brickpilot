import {useEffect,useMemo,useState} from 'react'
import {useThree} from '@react-three/fiber'
import {Group,Mesh,Box3,Vector3,type Material} from 'three'
import {useGLTF} from '@react-three/drei'
import type {Design} from '@/lib/engine/types.ts'
import type {BuildingModel} from '@/lib/engine/buildingModel.ts'
import {bathroomServiceCovers,roofServiceClosures} from '@/lib/walkthrough/serviceCovers.ts'
import {interiorFinishes} from '@/lib/interior/finishes.ts'
import {surfaceLook} from '@/lib/three/dressRoom.ts'
import type {Look} from '@/lib/three/dressRoom.ts'
import {buildWalkthroughAppearanceGroup} from '@/lib/three/walkthroughAppearance.ts'
import {disposeWalkthroughAsset} from '@/lib/three/loadWalkthroughAsset.ts'

export function ServiceClosureLayer({building,design,url}:{building:BuildingModel;design:Design;url:string}){
 const gltf=useGLTF(url)
 const roof=useMemo(()=>{
  let material:Material|undefined
  const existing:Box3[]=[]
  gltf.scene.updateMatrixWorld(true)
  gltf.scene.traverse(o=>{if(!(o instanceof Mesh))return
   if(o.userData.material_role==='wall'){
    if(!material||/Parapet|Roofline/.test(o.name))material=Array.isArray(o.material)?o.material[0]:o.material
    existing.push(new Box3().setFromObject(o))
   }
  })
  return {material,parts:roofServiceClosures(building).filter(({boundsMm:b})=>!existing.some(box=>box.containsPoint(new Vector3((b.x+b.w/2)/1000,(b.z+b.h/2)/1000,-(b.y+b.d/2)/1000))))}
 },[building,gltf.scene])
 const [ready,setReady]=useState<{key:unknown;root:Group}|null>(null),invalidate=useThree(s=>s.invalidate)
 const data=useMemo(()=>{
  const bindings:Record<string,Look>={},furniture=[]
  for(const room of building.rooms){const level=building.floors.find(f=>f.id===room.floorId)!.level
   if(room.outdoor)continue
   const fin=interiorFinishes(design,level,room.id);if(!fin)continue
   const binding=`cover:${room.floorId}:${room.id}`;bindings[binding]=surfaceLook(fin.floor)
   furniture.push(...bathroomServiceCovers(building,room,JSON.stringify([room.floorId,room.id]),binding))
  }
  return {bindings,furniture,skins:[],models:[],specifications:[],issues:[]}
 },[building,design,url])
 useEffect(()=>{let active=true;let owned:Group|undefined
  void buildWalkthroughAppearanceGroup(data,()=>active).then(root=>{owned=root;if(!active){disposeWalkthroughAsset(root);return}setReady({key:data,root});invalidate()}).catch(()=>{})
  return()=>{active=false;if(owned)disposeWalkthroughAsset(owned)}
 },[data,invalidate])
 return <group name="Service_access_finishes">{ready?.key===data&&<primitive object={ready.root} dispose={null}/>} {roof.parts.map(({id,boundsMm:b})=><mesh key={id} name={id} position={[(b.x+b.w/2)/1000,(b.z+b.h/2)/1000,-(b.y+b.d/2)/1000]} material={roof.material} castShadow receiveShadow><boxGeometry args={[b.w/1000,b.h/1000,b.d/1000]}/>{!roof.material&&<meshStandardMaterial color="#eeeae2" roughness={.9}/>}</mesh>)}</group>
}
