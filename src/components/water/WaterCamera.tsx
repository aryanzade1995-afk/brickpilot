import { useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import { PerspectiveCamera, Vector3 } from 'three'
import type { OrbitControls } from 'three-stdlib'
import type { BuildingModel } from '@/lib/engine/buildingModel.ts'
import { drainageOverviewPose } from '@/lib/water/drainageNetwork.ts'
import type { DrainStorage } from '@/lib/water/drainageStorage.ts'
import type { VillaPlumbing } from '@/lib/plumbing/villaPlumbing.ts'
import type { RainCollection } from '@/lib/water/simpleSystem.ts'
import { planToThreeGlb } from '@/lib/solar/coordinates.ts'
export type WaterView={kind:'house'|'tank'|'level'|'drain'|'supply'|'drain-overview'|'fixture';point?:{x:number;y:number;z:number};nonce:number}|null
export function WaterCamera({request,building,rain,home,drainage}:{home?:VillaPlumbing;drainage?:DrainStorage;request:WaterView;building:BuildingModel;rain:RainCollection}) {
  const {camera,controls,invalidate,size}=useThree()
  useEffect(()=>{
    if(!request)return
    const orbit=controls as OrbitControls|undefined
    const top=building.floors.at(-1)
    const target=new Vector3(building.plot.widthMm/2000,top?(top.elevationMm+top.heightMm)/2000:2,-building.plot.depthMm/2000)
    if(request.kind==='drain-overview'){
      const pose=drainageOverviewPose(building,drainage,camera instanceof PerspectiveCamera?camera.fov:40,size.width/Math.max(1,size.height));target.set(...pose.target);camera.position.set(...pose.position)
    }else if(request.kind==='fixture'&&request.point){
      const p=planToThreeGlb(request.point);target.set(p.x,p.y+.65,p.z);if(size.width<800)target.add(new Vector3(.7,0,-.62));camera.position.copy(target).add(new Vector3(2.5,2.2,2.8))
    }else if(request.kind==='drain'&&drainage?.tank){
      const t=drainage.tank,p=planToThreeGlb(t.center);target.set(p.x,p.y,p.z);camera.position.copy(target).add(new Vector3(t.alongX?-2.5:5,2.1,t.alongX?5:2.5))
    }else if(request.kind==='supply'&&home?.tankPorts.length){
      const ps=home.tankPorts.map(t=>planToThreeGlb(t.center));target.set(ps.reduce((n,p)=>n+p.x,0)/ps.length,ps.reduce((n,p)=>n+p.y,0)/ps.length,ps.reduce((n,p)=>n+p.z,0)/ps.length);const span=Math.max(5,home.tankPorts.length*1.5);camera.position.copy(target).add(new Vector3(span*.7,span*.65,-span))
    }else if(request.kind==='level'&&rain.tank&&rain.collector){
      const p=planToThreeGlb(rain.tank.center),c=planToThreeGlb(rain.collector),away=new Vector3(p.x-c.x,0,p.z-c.z).normalize(),span=Math.max(2.3,rain.tank.heightMm/1000*2.6,rain.tank.radiusMm/1000*5)
      target.copy(p);camera.position.copy(target).addScaledVector(away,span).add(new Vector3(span*.28,span*.25,0))
    }else if(request.kind==='tank'&&rain.tank&&rain.collector){
      const p=planToThreeGlb(rain.tank.center),c=planToThreeGlb(rain.collector),away=new Vector3(p.x-c.x,0,p.z-c.z).normalize(),span=Math.max(5,c.y)
      target.set(p.x,span*.4,p.z);camera.position.copy(target).addScaledVector(away,span*1.4).add(new Vector3(0,span*.32,0))
    }else {const span=Math.max(building.plot.widthMm,building.plot.depthMm)/1000;camera.position.copy(target).add(new Vector3(span*.85,span*.7,-span*.95))}
    camera.up.set(0,1,0);camera.lookAt(target);camera.updateProjectionMatrix()
    if(orbit){orbit.target.copy(target);orbit.update()}
    invalidate()
  },[request,building,rain,home,drainage,camera,controls,invalidate,size.width,size.height])
  return null
}
