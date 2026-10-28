import { useEffect, useMemo } from 'react'
import { useGLTF } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import { createShadeOverlay, type ShadeChoice } from '@/lib/three/shadeVariants.ts'

export function BalconyShadeLayer({url,choice}:{url:string;choice:Exclude<ShadeChoice,'original'>}){
 const source=useGLTF(url),asset=useGLTF(`/exterior-assets/kenney-shades/${choice==='terracotta'?'detail-awning':'detail-awning-wide'}.glb`)
 const layer=useMemo(()=>createShadeOverlay(source.scene,asset.scene,choice),[source.scene,asset.scene,choice]),invalidate=useThree(s=>s.invalidate)
 useEffect(()=>{invalidate();return()=>layer.dispose()},[layer,invalidate])
 return <primitive object={layer.root} dispose={null}/>
}
