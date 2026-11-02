import {useEffect,useLayoutEffect,useMemo,useRef} from 'react'
import {useFrame,useThree} from '@react-three/fiber'
import {Sky,useGLTF} from '@react-three/drei'
import {Box3,Group,Mesh,Vector3,DataTexture,RepeatWrapping,SRGBColorSpace} from 'three'
import type {OrbitControls as Orbit} from 'three-stdlib'
import type {BuildingModel} from '@/lib/engine/buildingModel.ts'
import {siteContext} from '@/lib/three/siteContext.ts'
import {makeVehicle,trafficPose,VEHICLES,ROAD_FLEET} from '@/lib/three/vehicleGeometry.ts'

const BASE='/exterior-assets/site-context/'
function groundTexture(){
 const size=128,data=new Uint8Array(size*size*4)
 let seed=731
 for(let i=0;i<size*size;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;const n=155+(seed%85);data.set([n,n,n,255],i*4)}
 const texture=new DataTexture(data,size,size);texture.colorSpace=SRGBColorSpace;texture.wrapS=texture.wrapT=RepeatWrapping;texture.repeat.set(45,4);texture.generateMipmaps=true;texture.needsUpdate=true
 return texture
}
function prepared(source:Group,length:number,car=false){
 const root=source.clone(true),box=new Box3().setFromObject(root),size=box.getSize(new Vector3()),center=box.getCenter(new Vector3())
 const wrapper=new Group(),scale=length/(car?Math.max(size.x,size.z):size.y)
 root.position.sub(new Vector3(center.x,box.min.y,center.z));wrapper.add(root);wrapper.scale.setScalar(scale)
 // Source Ferrari's long axis is Z. Point the vehicle along the road (X).
 if(car&&size.z>size.x)wrapper.rotation.y=Math.PI/2
 root.traverse(o=>{if(o instanceof Mesh){o.castShadow=car;o.receiveShadow=true}})
 return wrapper
}

export default function RealisticSiteEnvironment({building,traffic,golden,onReady}:{building:BuildingModel;traffic:boolean;golden:boolean;onReady:()=>void}){
 const fleet=useGLTF(ROAD_FLEET.map(id=>VEHICLES[id].url)),tree=useGLTF(BASE+'island-tree.glb')
 const site=useMemo(()=>siteContext(building),[building]),{camera,controls,invalidate,gl}=useThree()
 const cars=useMemo(()=>fleet.map((asset,i)=>makeVehicle(asset.scene,VEHICLES[ROAD_FLEET[i]].length)),[fleet])
 const trees=useMemo(()=>site.trees.map((_,i)=>prepared(tree.scene,5.8+(i%3)*.65)),[tree.scene,site])
 const time=useRef(0),visible=useRef(true),ready=useRef(false)
 const asphalt=useMemo(groundTexture,[])
 useEffect(()=>()=>asphalt.dispose(),[asphalt])
 useLayoutEffect(()=>{
  const orbit=controls as Orbit|undefined
  camera.position.set(site.centerX+site.width*.95,9,-site.depth-24)
  const target=new Vector3(site.centerX,3,-site.depth*.6)
  camera.lookAt(target);camera.near=.1;camera.far=400;camera.updateProjectionMatrix()
  if(orbit){orbit.target.copy(target);orbit.update()}
  invalidate()
 },[site,camera,controls,invalidate])
 useEffect(()=>{
  const observer=new IntersectionObserver(([entry])=>{visible.current=entry.isIntersecting},{threshold:.01})
  observer.observe(gl.domElement)
  const timer=traffic?window.setInterval(()=>{if(visible.current&&!document.hidden)invalidate()},1000/30):undefined
  return()=>{observer.disconnect();if(timer)window.clearInterval(timer)}
 },[traffic,invalidate,gl])
 useFrame((_,delta)=>{
  if(!ready.current){ready.current=true;requestAnimationFrame(onReady)}
  if(traffic&&visible.current&&!document.hidden)time.current+=Math.min(delta,.08)
  cars.forEach((root,i)=>{
   const pose=trafficPose(time.current,i,site.roadLength,site.centerX,site.roadZ,cars.length)
   root.position.set(pose.x,site.grade+.025,pose.z)
   root.rotation.y=pose.yaw
  })
 })
 return <>
  <color attach="background" args={[golden?'#d6c5ab':'#c9dce8']}/>
  <fog attach="fog" args={[golden?'#d6c5ab':'#c9dce8',75,180]}/>
  <Sky distance={450000} sunPosition={golden?[45,9,-30]:[35,55,-20]} turbidity={golden?5:2.5} rayleigh={.7}/>
  <group name="Illustrative_neighbourhood" userData={{presentation_only:true}}>
  <mesh rotation={[-Math.PI/2,0,0]} position={[site.centerX,site.grade-.04,-site.depth/2]} receiveShadow><planeGeometry args={[350,350]}/><meshStandardMaterial color="#677750" roughness={1}/></mesh>
  <mesh rotation={[-Math.PI/2,0,0]} position={[site.centerX,site.grade,site.roadZ]} receiveShadow><planeGeometry args={[site.roadLength,7]}/><meshStandardMaterial color="#45494b" map={asphalt} roughness={.97}/></mesh>
  {[-1,1].map(side=><group key={side}>
   <mesh position={[site.centerX,site.grade+.035,site.roadZ+side*4.35]} receiveShadow><boxGeometry args={[site.roadLength,.07,1.7]}/><meshStandardMaterial color="#ada79a" roughness={.95}/></mesh>
   <mesh position={[site.centerX,site.grade+.075,site.roadZ+side*3.55]}><boxGeometry args={[site.roadLength,.15,.16]}/><meshStandardMaterial color="#d1cbbd" roughness={.9}/></mesh>
  </group>)}
  {Array.from({length:Math.ceil(site.roadLength/7)},(_,i)=><mesh key={i} position={[site.centerX-site.roadLength/2+i*7,site.grade+.008,site.roadZ]} rotation={[-Math.PI/2,0,0]}><planeGeometry args={[3,.12]}/><meshStandardMaterial color="#e4dfc9" roughness={.9}/></mesh>)}
  {site.homes.map((home,i)=><group key={i} position={[home.x,site.grade,home.z]}>
   <mesh position={[0,home.h/2,0]} castShadow receiveShadow><boxGeometry args={[home.w,home.h,home.d]}/><meshStandardMaterial color={['#d5c8b8','#d9d6c8','#b8b5a7','#d4c3ae'][i]} roughness={.9}/></mesh>
   <mesh position={[0,home.h+.08,0]} castShadow><boxGeometry args={[home.w+.35,.16,home.d+.35]}/><meshStandardMaterial color="#b2aba1" roughness={.85}/></mesh>
   {[1.4,4.1].flatMap((y,level)=>[-home.w*.28,home.w*.28].map((x,j)=><group key={`${level}-${j}`} position={[x,y,-home.d/2-.03]}><mesh><boxGeometry args={[1.65,1.25,.06]}/><meshStandardMaterial color="#34494c" roughness={.22} metalness={.25}/></mesh><mesh position={[0,.72,-.12]} castShadow><boxGeometry args={[1.9,.1,.5]}/><meshStandardMaterial color="#e3dbce" roughness={.85}/></mesh></group>))}
  </group>)}
  {trees.map((root,i)=><group key={i} position={[site.trees[i][0],site.grade,site.trees[i][1]]} rotation={[0,i*1.7,0]}><primitive object={root} dispose={null}/></group>)}
  {cars.map((root,i)=><primitive key={i} object={root} dispose={null}/>)}
 </group></>
}
