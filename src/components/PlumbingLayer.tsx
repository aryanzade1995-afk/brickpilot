import { useEffect, useMemo } from 'react'
import { useThree } from '@react-three/fiber'
import { createPlumbingGroup, disposePlumbingGroup } from '@/lib/plumbing/pipeGeometry.ts'
import type { VillaPlumbing } from '@/lib/plumbing/villaPlumbing.ts'
export function PlumbingLayer({layout,water,drain,xray}:{layout:VillaPlumbing;water:boolean;drain:boolean;xray:boolean}){
  const invalidate=useThree(s=>s.invalidate)
  const group=useMemo(()=>createPlumbingGroup(layout,xray),[layout,xray])
  useEffect(()=>()=>disposePlumbingGroup(group),[group])
  useEffect(()=>{group.children.forEach(o=>{o.visible=o.userData.service==='water'?water:drain});invalidate()},[group,water,drain,invalidate])
  return <primitive object={group} dispose={null}/>
}
