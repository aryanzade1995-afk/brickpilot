import { useLayoutEffect, useMemo } from 'react'
import { useGLTF } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import { separateTankModels, sizeTankModels } from '@/lib/water/tankSizing.ts'
import { ghostWaterArchitecture } from '@/lib/water/ghostScene.ts'
import type { VillaPlumbing } from '@/lib/plumbing/villaPlumbing.ts'
export function ResizableRoofTanks({url,ports,diameterScale,heightScale,xray,onSelect}:{url:string;ports:VillaPlumbing['tankPorts'];diameterScale:number;heightScale:number;xray:boolean;onSelect:()=>void}) {
  const gltf=useGLTF(url),invalidate=useThree(s=>s.invalidate)
  const models=useMemo(()=>separateTankModels(gltf.scene),[gltf.scene])
  useLayoutEffect(()=>{sizeTankModels(models,ports,diameterScale,heightScale);invalidate()},[models,ports,diameterScale,heightScale,invalidate])
  useLayoutEffect(()=>{if(!xray)return;const restore=ghostWaterArchitecture(models.root);invalidate();return()=>{restore();invalidate()}},[models,xray,invalidate])
  return <group onClick={e=>{e.stopPropagation();onSelect()}}><primitive object={models.root} dispose={null}/></group>
}
