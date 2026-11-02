import {Box3,Group,Mesh,Vector3,type Object3D} from 'three'

export const VEHICLES={
 'sedan':{url:'/exterior-assets/free-cars/sedan.glb',label:'Ruby sedan',length:4.3},
 'sedan-sports':{url:'/exterior-assets/free-cars/sedan-sports.glb',label:'Blue sports sedan',length:4.5},
 'hatchback-sports':{url:'/exterior-assets/free-cars/hatchback-sports.glb',label:'Teal hatchback',length:4.0},
 'suv':{url:'/exterior-assets/free-cars/suv.glb',label:'Copper SUV',length:4.55},
 'suv-luxury':{url:'/exterior-assets/free-cars/suv-luxury.glb',label:'Plum luxury SUV',length:4.65},
 'taxi':{url:'/exterior-assets/free-cars/taxi.glb',label:'Yellow taxi',length:4.4},
 'compact-hatch':{url:'/exterior-assets/user-cars/compact-hatch.glb',label:'Compact hatchback',length:4.3},
 'mclaren-senna':{url:'/exterior-assets/user-cars/mclaren-senna.glb',label:'McLaren Senna',length:4.65},
} as const
export type VehicleId=keyof typeof VEHICLES
export const ROAD_FLEET:VehicleId[]=['sedan','sedan-sports','hatchback-sports','suv','suv-luxury','taxi']
export function parkedVehicleChoice(value:unknown):VehicleId{return typeof value==='string'&&value!=='compact-hatch'&&Object.hasOwn(VEHICLES,value)?value as VehicleId:'sedan'}
/** All new exports have an explicitly verified +Z nose. Never infer front from bounds. */
export function vehicleYaw(direction:1|-1){return direction===1?Math.PI/2:-Math.PI/2}
export function trafficPose(time:number,index:number,length:number,centerX:number,roadZ:number,count=4){
 const direction:1|-1=index%2===0?1:-1
 const progress=(time*6+Math.floor(index/2)*length/Math.ceil(count/2)+(index%2)*length*.24)%length
 return {x:centerX+direction*(progress-length/2),z:roadZ+(direction===1?-1.6:1.6),yaw:vehicleYaw(direction),direction}
}
export function makeVehicle(source:Object3D,length:number){
 const model=source.clone(true),bounds=new Box3().setFromObject(model),size=bounds.getSize(new Vector3()),center=bounds.getCenter(new Vector3())
 const root=new Group();model.position.sub(new Vector3(center.x,bounds.min.y,center.z));root.add(model);root.scale.setScalar(length/size.z)
 model.traverse(o=>{if(o instanceof Mesh){o.castShadow=true;o.receiveShadow=true}})
 return root
}
export function parkedVehicleAnchors(source:Object3D){
 source.updateMatrixWorld(true)
 const groups=new Map<string,Box3>()
 source.traverse(o=>{
  if(o.userData.formstead_vehicle){const id=String(o.userData.source_id??'parking');groups.set(id,new Box3().setFromObject(o));return}
  if(!(o instanceof Mesh)||o.userData.asset_id!=='ferrari-458')return
  const id=String(o.userData.source_id??'parking'),box=groups.get(id)??new Box3();box.expandByObject(o);groups.set(id,box)
 })
 return [...groups].map(([id,box])=>({id,box,center:box.getCenter(new Vector3()),size:box.getSize(new Vector3())}))
}
