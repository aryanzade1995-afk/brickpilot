import {useEffect,type RefObject} from 'react'
import {useThree} from '@react-three/fiber'
import {Box3,PerspectiveCamera,Vector3,type Group} from 'three'

/** Render a still with the existing GPU scene; never mount a second canvas or
 * request a new building. Restore the interactive camera immediately. */
export function StudioSnapshot({root,view,revision,onCapture}:{root:RefObject<Group|null>;view:'hero'|'front'|'aerial';revision:string;onCapture:(image:string)=>void}){
 const {gl,scene,camera,invalidate}=useThree()
 useEffect(()=>{
  const frame=requestAnimationFrame(()=>{
   if(!root.current)return
   const bounds=new Box3().setFromObject(root.current)
   if(bounds.isEmpty())return
   const center=bounds.getCenter(new Vector3()),size=bounds.getSize(new Vector3()),distance=Math.max(size.x,size.y,size.z)*1.65
   const preview=new PerspectiveCamera(35,gl.domElement.width/gl.domElement.height,.05,1000)
   const direction=view==='aerial'?new Vector3(.45,1.3,-.7):view==='front'?new Vector3(0,.3,-1):new Vector3(.85,.65,-1)
   preview.position.copy(center).addScaledVector(direction.normalize(),distance)
   preview.lookAt(center);preview.updateProjectionMatrix()
   try{gl.render(scene,preview);onCapture(gl.domElement.toDataURL('image/png'))}
   finally{gl.render(scene,camera);invalidate()}
  })
  return()=>cancelAnimationFrame(frame)
 },[root,view,revision,onCapture,gl,scene,camera,invalidate])
 return null
}
