import {useEffect,useMemo} from 'react'
import {useThree} from '@react-three/fiber'
import type {ProjectPipelines} from '@/lib/water/projectPipelines.ts'
import {projectDrainageLayout} from '@/lib/water/projectDrainageLayout.ts'
import {createPlumbingGroup,disposePlumbingGroup} from '@/lib/plumbing/pipeGeometry.ts'
import {DrainageTank} from './DrainageTank.tsx'

/** Single static connected assembly; no per-frame routing or duplicate branch
 * renderer. Uses the same plan coordinates and fixture outlets as Utilities. */
export function ProjectDrainageLayer({network,xray}:{network:ProjectPipelines;xray:boolean}){
 const invalidate=useThree(s=>s.invalidate)
 const layout=useMemo(()=>projectDrainageLayout(network),[network])
 const group=useMemo(()=>createPlumbingGroup(layout,xray),[layout,xray])
 useEffect(()=>{invalidate();return()=>disposePlumbingGroup(group)},[group,invalidate])
 return <group name="Massing_Canonical_Drainage" userData={{formstead_plumbing:true,source_plan_id:network.planId}}>
  <primitive object={group} dispose={null}/>
  {!network.fixtureScene.configuredDischarge&&<DrainageTank storage={network.drainage} xray={xray} onSelect={()=>{}}/>}
 </group>
}
