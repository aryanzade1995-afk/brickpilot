import { CurvePath, LineCurve3, QuadraticBezierCurve3, Vector3 } from 'three'
import { planToThreeGlb } from '../solar/coordinates.ts'
import type { AirPath } from './ventilation.ts'
import type { BuildingModel } from '../engine/buildingModel.ts'

/** Rounded wisps stay within the source path's obstacle margin. */
export function airWispRoute(path:AirPath,samples=192){
  const points=path.points.map(p=>{const q=planToThreeGlb(p);return new Vector3(q.x,q.y,q.z)}).filter((p,i,ps)=>!i||p.distanceTo(ps[i-1])>.0001)
  if(points.length<2)return null
  const curve=new CurvePath<Vector3>();let previous=points[0]
  for(let i=1;i<points.length-1;i++){
    const at=points[i],before=points[i-1],after=points[i+1],trim=Math.min(.08,at.distanceTo(before)/4,at.distanceTo(after)/4)
    const a=at.clone().lerp(before,trim/at.distanceTo(before)),b=at.clone().lerp(after,trim/at.distanceTo(after))
    curve.add(new LineCurve3(previous,a));curve.add(new QuadraticBezierCurve3(a,at,b));previous=b
  }
  curve.add(new LineCurve3(previous,points.at(-1)!))
  const length=curve.getLength();if(length<.001)return null
  return {length,points:Array.from({length:samples},(_,i)=>curve.getPointAt(i/(samples-1)).toArray() as [number,number,number])}
}

export function airOverviewPose(building:BuildingModel,fovDeg:number,aspect:number){
 const rs=building.floors.flatMap(f=>f.footprint)
 if(!rs.length)return null
 const minX=Math.min(...rs.map(r=>r.x))/1000-1,maxX=Math.max(...rs.map(r=>r.x+r.w))/1000+1
 const minZ=-Math.max(...rs.map(r=>r.y+r.h))/1000-1,maxZ=-Math.min(...rs.map(r=>r.y))/1000+1
 const high=Math.max(...building.floors.map(f=>f.elevationMm+f.heightMm))/1000+1
 const low=-(building.structuralSizing?.plinthHeightMm??450)/1000
 const center=new Vector3((minX+maxX)/2,(low+high)/2,(minZ+maxZ)/2),direction=new Vector3(1,.8,-1).normalize()
 const right=new Vector3().crossVectors(new Vector3(0,1,0),direction).normalize(),up=new Vector3().crossVectors(direction,right).normalize()
 const tangent=Math.tan(fovDeg*Math.PI/360);let distance=1
 for(const x of[minX,maxX])for(const y of[low,high])for(const z of[minZ,maxZ]){
  const p=new Vector3(x,y,z).sub(center)
  distance=Math.max(distance,p.dot(direction)+Math.max(Math.abs(p.dot(right))/(tangent*aspect),Math.abs(p.dot(up))/tangent))
 }
 return {target:center,position:center.clone().addScaledVector(direction,distance*1.1)}
}
