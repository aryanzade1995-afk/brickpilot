import { useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import { Vector3 } from 'three'
import type { OrbitControls } from 'three-stdlib'
import type { BuildingModel } from '@/lib/engine/buildingModel.ts'
import type { RainCollection } from '@/lib/water/simpleSystem.ts'
import { planToThreeGlb } from '@/lib/solar/coordinates.ts'
export type WaterView={kind:'house'|'tank';nonce:number}|null
export function WaterCamera({request,building,rain}:{request:WaterView;building:BuildingModel;rain:RainCollection}) {
  const {camera,controls,invalidate}=useThree()
  useEffect(()=>{
    if(!request)return
    const orbit=controls as OrbitControls|undefined
    const top=building.floors.at(-1)
    const target=new Vector3(building.plot.widthMm/2000,top?(top.elevationMm+top.heightMm)/2000:2,-building.plot.depthMm/2000)
    if(request.kind==='tank'&&rain.tank&&rain.collector){
      const p=planToThreeGlb(rain.tank.center),c=planToThreeGlb(rain.collector),away=new Vector3(p.x-c.x,0,p.z-c.z).normalize(),span=Math.max(5,c.y)
      target.set(p.x,span*.4,p.z);camera.position.copy(target).addScaledVector(away,span*1.4).add(new Vector3(0,span*.32,0))
    }else {const span=Math.max(building.plot.widthMm,building.plot.depthMm)/1000;camera.position.copy(target).add(new Vector3(span*.85,span*.7,-span*.95))}
    camera.up.set(0,1,0);camera.lookAt(target);camera.updateProjectionMatrix()
    if(orbit){orbit.target.copy(target);orbit.update()}
    invalidate()
  },[request,building,rain,camera,controls,invalidate])
  return null
}
