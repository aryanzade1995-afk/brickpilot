/* eslint-disable react/immutability -- R3F camera, scene and control resources use Three's imperative API. */
import {useEffect,useLayoutEffect,useMemo,useRef,type RefObject} from 'react'
import {useFrame,useThree} from '@react-three/fiber'
import {Environment,useGLTF,useTexture,useProgress} from '@react-three/drei'
import {Box3,Group,Mesh,MeshStandardMaterial,MeshPhysicalMaterial,Vector3,PerspectiveCamera} from 'three'
import type {OrbitControls as Orbit} from 'three-stdlib'
import type {BuildingModel} from '@/lib/engine/buildingModel.ts'
import {siteContext} from '@/lib/three/siteContext.ts'
import {trafficPose} from '@/lib/three/vehicleGeometry.ts'
import {PHOTO_ENVIRONMENTS,PHOTO_MAP_URLS,photoCameraPose,photoMaps,repeatPhotoMaps} from '@/lib/three/photoExterior.ts'

const BASE='/exterior-assets/site-context/'
function prepared(source:Group,length:number,car=false){
 const root=source.clone(true),box=new Box3().setFromObject(root),size=box.getSize(new Vector3()),center=box.getCenter(new Vector3())
 const wrapper=new Group(),scale=length/(car?Math.max(size.x,size.z):size.y)
 root.position.sub(new Vector3(center.x,box.min.y,center.z));wrapper.add(root);wrapper.scale.setScalar(scale)
 // Source Ferrari's long axis is Z. Point the vehicle along the road (X).
 if(car&&size.z>size.x)wrapper.rotation.y=Math.PI/2
 root.traverse(o=>{if(o instanceof Mesh){o.castShadow=car;o.receiveShadow=true}})
 return wrapper
}

export default function RealisticSiteEnvironment({building,traffic,golden,onReady,house}:{building:BuildingModel;traffic:boolean;golden:boolean;onReady:()=>void;house:RefObject<Group|null>}){
 const fleet=useGLTF(BASE+'ferrari-458.glb'),tree=useGLTF('/exterior-assets/photo/garden-tree.glb'),shrub=useGLTF('/exterior-assets/photo/garden-shrub.glb'),sourceMaps=useTexture(PHOTO_MAP_URLS)
 const site=useMemo(()=>siteContext(building),[building]),{camera,controls,invalidate,gl,scene,size}=useThree()
 const cars=useMemo(()=>['#9a1720','#243c55','#5b5146'].map(color=>{
  const root=prepared(fleet.scene,4.5,true)
  // The pose function expects a +Z-forward model, then turns it along the road.
  root.rotation.y=0
  const colors=new Map<MeshStandardMaterial,MeshStandardMaterial>()
  root.traverse(o=>{if(!(o instanceof Mesh))return
   const apply=(m:import('three').Material)=>{if(!(m instanceof MeshStandardMaterial)||!/body.color|body.paint|car.paint/i.test(m.name))return m
    let copy=colors.get(m);if(!copy){copy=new MeshPhysicalMaterial({name:m.name,color,map:m.map,metalness:m.metalness,roughness:.2,normalMap:m.normalMap,metalnessMap:m.metalnessMap,clearcoat:1,clearcoatRoughness:.12});colors.set(m,copy)}return copy}
   o.material=Array.isArray(o.material)?o.material.map(apply):apply(o.material)
  })
  return {root,dispose:()=>colors.forEach(m=>m.dispose())}
 }),[fleet.scene])
 useEffect(()=>()=>cars.forEach(car=>car.dispose()),[cars])
 const trees=useMemo(()=>site.trees.map((_,i)=>prepared(tree.scene,5.8+(i%3)*.65)),[tree.scene,site])
 // A layered planting backdrop replaces an empty lawn-to-sky horizon. All
 // trunks sit outside the plot and reuse the same bounded, shared tree mesh.
 const backdrop=useMemo(()=>Array.from({length:12},(_,i)=>({root:prepared(tree.scene,9+(i%4)*.6),x:site.centerX-44+i*8,z:8+(i%2)*4})),[tree.scene,site])
 const time=useRef(0),visible=useRef(true),ready=useRef(false)
 const loading=useProgress(s=>s.active)
 const shrubs=useMemo(()=>Array.from({length:8},(_,i)=>prepared(shrub.scene,.6+(i%3)*.05)),[shrub.scene])
 const textures=useMemo(()=>{const result=photoMaps(sourceMaps,gl.capabilities.getMaxAnisotropy());repeatPhotoMaps(result.maps,'asphalt',site.roadLength/2,3.5);repeatPhotoMaps(result.maps,'lawn',1500,1500);repeatPhotoMaps(result.maps,'concrete_floor',4,1);repeatPhotoMaps(result.maps,'painted_plaster',4,4);return result},[sourceMaps,gl,site])
 useEffect(()=>()=>textures.dispose(),[textures])
 const maps=textures.maps
 useLayoutEffect(()=>{const previous=scene.userData.photographicExterior;scene.userData.photographicExterior=true;return()=>{scene.userData.photographicExterior=previous}},[scene])
 useLayoutEffect(()=>{
  if(loading)return
  const orbit=controls as Orbit|undefined
  const bounds=house.current?new Box3().setFromObject(house.current):undefined
  const pose=photoCameraPose(building,size.width/Math.max(1,size.height),bounds)
  camera.up.set(0,1,0);camera.position.copy(pose.position)
  const target=pose.target
  if(camera instanceof PerspectiveCamera)camera.fov=pose.fov
  camera.lookAt(target);camera.near=.1;camera.far=400;camera.updateProjectionMatrix()
  if(orbit){orbit.target.copy(target);orbit.update()}
  invalidate()
 },[site,building,camera,controls,invalidate,size.width,size.height,loading,house])
 useEffect(()=>{
  const observer=new IntersectionObserver(([entry])=>{visible.current=entry.isIntersecting},{threshold:.01})
  observer.observe(gl.domElement)
  const timer=traffic?window.setInterval(()=>{if(visible.current&&!document.hidden)invalidate()},1000/30):undefined
  return()=>{observer.disconnect();if(timer)window.clearInterval(timer)}
 },[traffic,invalidate,gl])
 useFrame((_,delta)=>{
  if(!ready.current){ready.current=true;requestAnimationFrame(onReady)}
  if(traffic&&visible.current&&!document.hidden)time.current+=Math.min(delta,.08)
  cars.forEach(({root},i)=>{
   const pose=trafficPose(time.current,i,site.roadLength,site.centerX,site.roadZ,cars.length)
   root.position.set(pose.x,site.grade+.025,pose.z)
   root.rotation.y=pose.yaw
  })
 })
 return <>
  <fog attach="fog" args={[golden?'#d6c5ab':'#c9dce8',75,180]}/>
  <Environment files={golden?PHOTO_ENVIRONMENTS.dusk:PHOTO_ENVIRONMENTS.day} background backgroundBlurriness={.015} environmentIntensity={golden?.45:.85} backgroundIntensity={golden?.8:.85} environmentRotation={[0,.6,0]} backgroundRotation={[0,.6,0]}/>
  <group name="Illustrative_neighbourhood" userData={{presentation_only:true}}>
  <mesh name="Site_terrain" rotation={[-Math.PI/2,0,0]} position={[site.centerX,site.grade-.04,-site.depth/2]} receiveShadow><planeGeometry args={[3000,3000]}/><meshStandardMaterial color="#b3bea0" map={maps['lawn-Diffuse']} normalMap={maps['lawn-nor_gl']} normalScale={[.35,.35]} roughnessMap={maps['lawn-Rough']} roughness={1}/></mesh>
  <mesh rotation={[-Math.PI/2,0,0]} position={[site.centerX,site.grade,site.roadZ]} receiveShadow><planeGeometry args={[site.roadLength,7]}/><meshStandardMaterial color="#aaaaaa" map={maps['asphalt_01-Diffuse']} normalMap={maps['asphalt_01-nor_gl']} normalScale={[.45,.45]} roughnessMap={maps['asphalt_01-Rough']} roughness={.95}/></mesh>
  {[-1,1].map(side=><group key={side}>
   <mesh position={[site.centerX,site.grade+.035,site.roadZ+side*4.35]} receiveShadow><boxGeometry args={[site.roadLength,.07,1.7]}/><meshStandardMaterial color="#d8d3c9" map={maps['concrete_floor_02-Diffuse']} normalMap={maps['concrete_floor_02-nor_gl']} normalScale={[.3,.3]} roughnessMap={maps['concrete_floor_02-Rough']} roughness={.95}/></mesh>
   <mesh position={[site.centerX,site.grade+.075,site.roadZ+side*3.55]}><boxGeometry args={[site.roadLength,.15,.16]}/><meshStandardMaterial color="#d1cbbd" roughness={.9}/></mesh>
  </group>)}
  {Array.from({length:Math.ceil(site.roadLength/7)},(_,i)=><mesh key={i} position={[site.centerX-site.roadLength/2+i*7,site.grade+.008,site.roadZ]} rotation={[-Math.PI/2,0,0]}><planeGeometry args={[3,.12]}/><meshStandardMaterial color="#e4dfc9" roughness={.9}/></mesh>)}
  {site.homes.map((home,i)=><group key={i} position={[home.x,site.grade,home.z]}>
   <mesh position={[0,home.h/2,0]} castShadow receiveShadow><boxGeometry args={[home.w,home.h,home.d]}/><meshStandardMaterial color={['#d5c8b8','#d9d6c8','#b8b5a7','#d4c3ae'][i]} normalMap={maps['painted_plaster_wall-nor_gl']} normalScale={[.2,.2]} roughnessMap={maps['painted_plaster_wall-Rough']} roughness={.9}/></mesh>
   <mesh position={[0,home.h+.08,0]} castShadow><boxGeometry args={[home.w+.35,.16,home.d+.35]}/><meshStandardMaterial color="#b2aba1" roughness={.85}/></mesh>
   {[1.4,4.1].flatMap((y,level)=>[-home.w*.28,home.w*.28].map((x,j)=><group key={`${level}-${j}`} position={[x,y,-home.d/2-.03]}><mesh><boxGeometry args={[1.65,1.25,.06]}/><meshStandardMaterial color="#34494c" roughness={.22} metalness={.25}/></mesh><mesh position={[0,.72,-.12]} castShadow><boxGeometry args={[1.9,.1,.5]}/><meshStandardMaterial color="#e3dbce" roughness={.85}/></mesh></group>))}
  </group>)}
  {trees.map((root,i)=><group key={i} position={[site.trees[i][0],site.grade,site.trees[i][1]]} rotation={[0,i*1.7,0]}><primitive object={root} dispose={null}/></group>)}
  {backdrop.map(({root,x,z},i)=><group key={'backdrop'+i} position={[x,site.grade,z]} rotation={[0,i*2.1,0]}><primitive object={root} dispose={null}/></group>)}
  {shrubs.map((root,i)=><group key={'shrub'+i} position={[i<4?-.6:site.width+.6,site.grade,-2-(i%4)*(site.depth-4)/3]} rotation={[0,i*1.7,0]}><primitive object={root} dispose={null}/></group>)}
  {cars.map(({root},i)=><primitive key={i} object={root} dispose={null}/>)}
 </group></>
}
