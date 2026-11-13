import {useEffect,useMemo,useState} from 'react'
import {useThree} from '@react-three/fiber'
import type {Group} from 'three'
import {RectAreaLightUniformsLib} from 'three/addons/lights/RectAreaLightUniformsLib.js'
import type {Design} from '@/lib/engine/types.ts'
import {createWalkthroughSource,walkthroughRoomKey} from '@/lib/walkthrough/source.ts'
import {buildWalkthroughScene} from '@/lib/walkthrough/scene.ts'
import {prepareWalkthroughAppearance,prepareWalkthroughGeometry} from '@/lib/walkthrough/delivery.ts'
import {buildWalkthroughAppearanceGroup} from '@/lib/three/walkthroughAppearance.ts'
import {disposeWalkthroughAsset} from '@/lib/three/loadWalkthroughAsset.ts'

RectAreaLightUniformsLib.init()
/** The existing furnished rooms, in their original house coordinates. No walls,
 * openings, floors or independently generated replacement house are inserted. */
export default function MassingRoomLife({design,golden,onReady}:{design:Design;golden:boolean;onReady:()=>void}){
 const data=useMemo(()=>{
  const source=createWalkthroughSource(design,{hardChecksPass:true},{style:'modern',lighting:'warm',furnitureDensity:'medium'})
  const selected=source.building.rooms.filter(r=>!r.outdoor&&/living|lounge|dining|bedroom/i.test(r.name)).slice(0,6)
  const keys=new Set(selected.map(r=>walkthroughRoomKey(r.floorId,r.id)))
  const geometry=prepareWalkthroughGeometry(buildWalkthroughScene(source.building,{hardChecksPass:true}))
  const all=prepareWalkthroughAppearance(design,source,geometry)
  return {app:{...all,skins:[],furniture:all.furniture.filter(p=>p.roomId&&keys.has(p.roomId)),models:all.models?.filter(m=>keys.has(m.roomId))},lights:selected.map(r=>{
   const floor=source.building.floors.find(f=>f.id===r.floorId)!
   return {id:walkthroughRoomKey(r.floorId,r.id),position:[(r.rect.x+r.rect.w/2)/1000,(floor.elevationMm+floor.heightMm)/1000-.3,-(r.rect.y+r.rect.h/2)/1000] as [number,number,number]}
  })}
 },[design])
 const [ready,setReady]=useState<{data:typeof data;root:Group}|null>(null),invalidate=useThree(s=>s.invalidate)
 useEffect(()=>{let active=true,owned:Group|undefined
  void buildWalkthroughAppearanceGroup(data.app,()=>active).then(root=>{owned=root;if(!active){disposeWalkthroughAsset(root);return}setReady({data,root});invalidate()}).catch(()=>{})
  return()=>{active=false;if(owned)disposeWalkthroughAsset(owned)}
 },[data,invalidate])
 useEffect(()=>{if(ready?.data===data){onReady();invalidate()}},[ready,data,onReady,invalidate])
 return <group name="Photographic_room_life" userData={{presentation_only:true}}>
  {ready?.data===data&&<primitive object={ready.root} dispose={null}/>}
  {data.lights.map(light=><rectAreaLight key={light.id} name="Photo_room_light" userData={{photographicLight:true}} position={light.position} rotation={[-Math.PI/2,0,0]} width={.65} height={.65} intensity={golden?150:20} color="#ffcf99"/>)}
 </group>
}
