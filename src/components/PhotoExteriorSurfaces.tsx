import {useEffect,useLayoutEffect,useMemo,type RefObject} from 'react'
import {useTexture,useProgress} from '@react-three/drei'
import {useThree} from '@react-three/fiber'
import type {Group} from 'three'
import {PHOTO_MAP_URLS,photoMaps,refinePhotoSurfaces,repeatPhotoMaps} from '@/lib/three/photoExterior.ts'

export default function PhotoExteriorSurfaces({root,revision,onReady}:{root:RefObject<Group|null>;revision:string;onReady:()=>void}){
 const source=useTexture(PHOTO_MAP_URLS),loading=useProgress(s=>s.active),{gl,invalidate}=useThree()
 const owned=useMemo(()=>{const result=photoMaps(source,gl.capabilities.getMaxAnisotropy());repeatPhotoMaps(result.maps,'painted_plaster',6,6);repeatPhotoMaps(result.maps,'concrete_floor',3,3);repeatPhotoMaps(result.maps,'lawn',.5,.5);return result},[source,gl])
 useEffect(()=>()=>owned.dispose(),[owned])
 useLayoutEffect(()=>{
  if(loading||!root.current)return
  const result=refinePhotoSurfaces(root.current,owned.maps);onReady();invalidate()
  return()=>{result.restore();invalidate()}
 },[root,revision,owned,loading,onReady,invalidate])
 return null
}
