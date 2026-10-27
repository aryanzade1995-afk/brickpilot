import { useLayoutEffect } from 'react'
import { useThree } from '@react-three/fiber'
import { PerspectiveCamera } from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import type { BuildingModel } from '@/lib/engine/buildingModel.ts'
import { airOverviewPose } from '@/lib/utilities/airVisual.ts'

/** Frame the occupied house rather than the large site/context backdrop.
 * Changing wind direction never moves a camera the user has adjusted. */
export function VentilationCamera({building}:{building:BuildingModel}){
 const camera=useThree(s=>s.camera),controls=useThree(s=>s.controls),invalidate=useThree(s=>s.invalidate),size=useThree(s=>s.size)
 useLayoutEffect(()=>{
  if(!(camera instanceof PerspectiveCamera))return
  const pose=airOverviewPose(building,camera.fov,size.width/size.height);if(!pose)return
  camera.position.copy(pose.position);camera.lookAt(pose.target)
  if(controls){(controls as OrbitControlsImpl).target.copy(pose.target);(controls as OrbitControlsImpl).update()}
  camera.updateProjectionMatrix();invalidate()
 },[building,camera,controls,invalidate,size.width,size.height])
 return null
}
