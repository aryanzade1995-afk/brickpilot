import { useLayoutEffect } from 'react'
import { useThree } from '@react-three/fiber'
import { Box3, PerspectiveCamera, Vector3 } from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import type { Dollhouse } from '@/lib/three/buildDollhouse.ts'

/** Frame the occupied house rather than the large site/context backdrop.
 * Changing wind direction never moves a camera the user has adjusted. */
export function VentilationCamera({doll}:{doll:Dollhouse}){
 const camera=useThree(s=>s.camera),controls=useThree(s=>s.controls),invalidate=useThree(s=>s.invalidate),size=useThree(s=>s.size),gl=useThree(s=>s.gl)
 useLayoutEffect(()=>{
  if(!(camera instanceof PerspectiveCamera))return
  const box=new Box3()
  for(const b of doll.boxes){const center=new Vector3(...b.pos),half=new Vector3(...b.size).multiplyScalar(.5);box.expandByPoint(center.clone().sub(half));box.expandByPoint(center.add(half))}
  if(box.isEmpty())return
  box.expandByScalar(2.4)
  const target=box.getCenter(new Vector3()),tan=Math.tan(camera.fov*Math.PI/360),direction=new Vector3(1,.8,1).normalize()
  const right=new Vector3().crossVectors(new Vector3(0,1,0),direction).normalize(),up=new Vector3().crossVectors(direction,right).normalize()
  let distance=1
  for(const x of[box.min.x,box.max.x])for(const y of[box.min.y,box.max.y])for(const z of[box.min.z,box.max.z]){
    const p=new Vector3(x,y,z).sub(target)
    distance=Math.max(distance,p.dot(direction)+Math.max(Math.abs(p.dot(right))/(tan*size.width/size.height),Math.abs(p.dot(up))/tan))
  }
  camera.position.copy(target).addScaledVector(direction,distance*1.04);camera.lookAt(target)
  if(controls){(controls as OrbitControlsImpl).target.copy(target);(controls as OrbitControlsImpl).update()}
  camera.updateProjectionMatrix();Object.assign(gl.shadowMap,{needsUpdate:true});invalidate()
 },[doll,camera,controls,gl,invalidate,size.width,size.height])
 return null
}
