import {useMemo} from 'react'
import {useGLTF} from '@react-three/drei'
import {Box3,Vector3} from 'three'
import type {BuildingModel} from '@/lib/engine/buildingModel.ts'
import {makeVehicle,parkedVehicleAnchors,VEHICLES,type VehicleId} from '@/lib/three/vehicleGeometry.ts'

export function ParkedCarsLayer({url,choice,building}:{url:string;choice:VehicleId;building?:BuildingModel}){
 const villa=useGLTF(url),asset=useGLTF(VEHICLES[choice].url)
 const cars=useMemo(()=>{
  const recorded=parkedVehicleAnchors(villa.scene)
  const grade=building?Math.min(...building.floors.map(f=>f.elevationMm))/1000-.4:0
  const anchors=recorded.length?recorded:(building?.siteFeatures??[]).filter(f=>f.kind==='parking'&&f.rect.w>=1800&&f.rect.h>=1800).map(f=>{
   const box=new Box3(new Vector3(f.rect.x/1000,grade+.08,-(f.rect.y+f.rect.h)/1000),new Vector3((f.rect.x+f.rect.w)/1000,grade+.08,-f.rect.y/1000))
   return {id:f.id,box,center:box.getCenter(new Vector3()),size:box.getSize(new Vector3())}
  })
  return anchors.map(anchor=>{
  const car=makeVehicle(asset.scene,Math.min(VEHICLES[choice].length,Math.max(anchor.size.x,anchor.size.z)))
  car.rotation.y=anchor.size.x>anchor.size.z?Math.PI/2:0
  const bounds=new Box3().setFromObject(car).getSize(new Vector3())
  car.scale.multiplyScalar(Math.min(1,anchor.size.x*.9/bounds.x,anchor.size.z*.9/bounds.z))
  car.position.set(anchor.center.x,anchor.box.min.y,anchor.center.z)
  car.userData={source_id:anchor.id,formstead_vehicle:true,asset_id:choice}
  return car
  })
 },[villa.scene,asset.scene,choice,building])
 return <group name="Selected_parked_cars">{cars.map(car=><primitive key={car.uuid} object={car} dispose={null}/>)}</group>
}
