import { CurvePath, LineCurve3, QuadraticBezierCurve3, Vector3 } from 'three'
import { planToThreeGlb } from '../solar/coordinates.ts'
import type { ServicePoint } from '../plumbing/villaPlumbing.ts'

/** Presentation bends stay inside the original corner envelope and retain ports. */
export function waterPipeCurve(points:readonly ServicePoint[],diameterMm:number) {
  const ps=points.map(p=>{const w=planToThreeGlb(p);return new Vector3(w.x,w.y,w.z)}).filter((p,i,all)=>!i||p.distanceTo(all[i-1])>.00001)
  const path=new CurvePath<Vector3>();if(ps.length<2)return path
  let from=ps[0]
  for(let i=1;i<ps.length-1;i++){
    const before=ps[i-1],corner=ps[i],after=ps[i+1],a=before.clone().sub(corner).normalize(),b=after.clone().sub(corner).normalize()
    if(Math.abs(a.dot(b))>.999)continue
    const radius=Math.min(diameterMm/1000,before.distanceTo(corner)*.35,after.distanceTo(corner)*.35)
    const entry=corner.clone().addScaledVector(a,radius),exit=corner.clone().addScaledVector(b,radius)
    if(from.distanceTo(entry)>.00001)path.add(new LineCurve3(from,entry))
    path.add(new QuadraticBezierCurve3(entry,corner,exit));from=exit
  }
  if(from.distanceTo(ps.at(-1)!)>.00001)path.add(new LineCurve3(from,ps.at(-1)!))
  return path
}
