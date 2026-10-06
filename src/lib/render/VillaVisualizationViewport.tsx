import { Component, Suspense, forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useCallback, type ReactNode } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls, useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import type { Design } from '../engine/types.ts'
import { buildingEdgeMap } from './edgeMap.ts'
import type { VillaReferenceView } from './villaVisualizations.ts'

const CAMERA={fov:40,near:.1,far:2000}
const GL={preserveDrawingBuffer:true,antialias:true}
const TARGET:[number,number,number]=[0,3,0]
export type VillaViewportHandle={capture:()=>Promise<VillaReferenceView[]>}
type Driver={capture:()=>Promise<VillaReferenceView[]>}
class ModelBoundary extends Component<{children:ReactNode},{failed:boolean}> {
  state={failed:false}
  static getDerivedStateFromError(){return {failed:true}}
  render(){return this.state.failed?<p role="status" className="p-8 text-sm text-ink-dim">This model could not load. Reopen 3D Massing to prepare it.</p>:this.props.children}
}

/** Both source tabs use the actual editable model, not a generic villa or image substitute. */
export const VillaVisualizationViewport=forwardRef<VillaViewportHandle,{design:Design;url:string;onReady:(ready:boolean)=>void}>(
  function VillaVisualizationViewport({design,url,onReady},ref) {
    const driver=useRef<Driver|null>(null)
    const setDriver=useCallback((value:Driver|null)=>{driver.current=value;onReady(Boolean(value))},[onReady])
    useImperativeHandle(ref,()=>({capture:()=>{
      if(!driver.current)throw new Error('Model not ready')
      return driver.current.capture()
    }}),[])
    return <div data-villa-visualization-model className="aspect-[4/3] max-h-[680px] w-full overflow-hidden border border-line bg-bg-inset">
      <ModelBoundary key={url??design.id}><Canvas frameloop="demand" shadows dpr={[1,2]} camera={CAMERA}
        gl={GL} onCreated={({gl})=>{gl.toneMapping=THREE.NeutralToneMapping;gl.toneMappingExposure=1.2}}>
        <Suspense fallback={null}><BlenderSource url={url} setDriver={setDriver}/></Suspense>
        <OrbitControls makeDefault target={TARGET} minDistance={2} maxDistance={150} maxPolarAngle={Math.PI/2.02}/>
      </Canvas></ModelBoundary>
    </div>
  })
type SourceProps={setDriver:(value:Driver|null)=>void}
function BlenderSource({url,setDriver}:SourceProps&{url:string}) {
  const gltf=useGLTF(url)
  const scene=useMemo(()=>{
    const clone=gltf.scene.clone(true),remove:THREE.Object3D[]=[]
    clone.traverse(o=>{if(o.userData.presentation_only||o.name.startsWith('Ground_Context')||'isLight' in o||'isCamera' in o)remove.push(o)})
    remove.forEach(o=>o.removeFromParent());return clone
  },[gltf.scene])
  const box=useMemo(()=>new THREE.Box3().setFromObject(scene),[scene])
  return <><color attach="background" args={['#e8e7e4']}/><ambientLight intensity={.8}/><directionalLight position={[-20,35,-25]} intensity={2.4} castShadow shadow-mapSize={[2048,2048]}/>
    <primitive object={scene}/><SourceCamera box={box} setDriver={setDriver}/></>
}
function SourceCamera({box,setDriver}:SourceProps&{box:THREE.Box3}) {
  const {gl,scene,camera,controls}=useThree()
  useEffect(()=>{
    if(box.isEmpty())return
    const size=box.getSize(new THREE.Vector3()),center=box.getCenter(new THREE.Vector3())
    const pose=(c:THREE.PerspectiveCamera,view:'front'|'iso')=>{
      // Blender exports its plan-south +Y as Three.js -Z.
      // front: straight onto the entrance side, a little above eye level. iso: the classic
      // three-quarter bird's-eye view from the front-left corner.
      const frontSign=-1
      const direction=view==='front'?new THREE.Vector3(0,.07,frontSign).normalize():new THREE.Vector3(-1,.82,frontSign).normalize()
      const points=Array.from({length:8},(_,i)=>new THREE.Vector3(i&1?box.max.x:box.min.x,i&2?box.max.y:box.min.y,i&4?box.max.z:box.min.z))
      const aim=center.clone();aim.y=box.min.y+size.y*.44
      let distance=Math.max(size.x,size.y,size.z)*1.2
      for(let i=0;i<35;i++) {
        c.position.copy(aim).addScaledVector(direction,distance);c.lookAt(aim);c.updateMatrixWorld();c.updateProjectionMatrix()
        if(points.every(p=>{const v=p.clone().project(c);return Math.abs(v.x)<.94&&Math.abs(v.y)<.9&&v.z>-1&&v.z<1}))break
        distance*=1.075
      }
    }
    const initial=new THREE.PerspectiveCamera(40,gl.domElement.width/gl.domElement.height,.1,2000)
    pose(initial,'iso');camera.position.copy(initial.position);camera.quaternion.copy(initial.quaternion)
    if(controls&&'target' in controls){(controls.target as THREE.Vector3).copy(center);(controls as OrbitControlsImpl).update()}
    let alive=true
    // A plain grey backdrop stays grey in the AI image. A sky gradient reads as sky, so the AI paints a real one.
    const sky=(()=>{const c=document.createElement('canvas');c.width=4;c.height=256;const g=c.getContext('2d')!.createLinearGradient(0,0,0,256)
      g.addColorStop(0,'#5f9bd8');g.addColorStop(.55,'#b9d8f0');g.addColorStop(1,'#eef4f8');const x=c.getContext('2d')!;x.fillStyle=g;x.fillRect(0,0,4,256)
      const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;return t})()
    setDriver({capture:async()=>{
      const pair:VillaReferenceView[]=[],old=gl.getSize(new THREE.Vector2()),dpr=gl.getPixelRatio(),previousBackground=scene.background
      // the capture stands the villa on real ground under a sun, so the AI reads it as a photograph to finish, not a floating model
      const stage=new THREE.Group()
      const ground=new THREE.Mesh(new THREE.PlaneGeometry(4000,4000),new THREE.MeshStandardMaterial({color:'#6d8a4a',roughness:1}))
      ground.rotation.x=-Math.PI/2;ground.position.set(center.x,box.min.y-.02,center.z);ground.receiveShadow=true
      const sun=new THREE.DirectionalLight('#fff4e0',2.6),r=Math.max(size.x,size.z)
      sun.position.set(center.x-r*.9,box.max.y+r*1.2,center.z-r*1.1);sun.target.position.copy(center);sun.castShadow=true
      sun.shadow.mapSize.set(4096,4096);Object.assign(sun.shadow.camera,{left:-r,right:r,top:r,bottom:-r,near:.1,far:r*6});sun.shadow.bias=-.0004;sun.shadow.normalBias=.02
      stage.add(ground,sun,sun.target,new THREE.HemisphereLight('#cfe3ff','#5d6b45',.9))
      const shadows=gl.shadowMap.enabled,cast=new Map<THREE.Object3D,[boolean,boolean]>()
      scene.traverse(o=>{if((o as THREE.Mesh).isMesh){cast.set(o,[o.castShadow,o.receiveShadow]);o.castShadow=true;o.receiveShadow=true}})
      const lights:THREE.Light[]=[];scene.traverse(o=>{if((o as THREE.Light).isLight){lights.push(o as THREE.Light)}})
      const dim=lights.map(l=>l.intensity)
      try {
        scene.background=sky
        lights.forEach(l=>{l.intensity*=.35})
        scene.add(stage);gl.shadowMap.enabled=true;gl.shadowMap.type=THREE.PCFSoftShadowMap;gl.shadowMap.needsUpdate=true
        gl.setPixelRatio(1);gl.setSize(1024,768,false)
        const captureCamera=new THREE.PerspectiveCamera(40,4/3,.1,2000)
        for(const view of ['front'] as const) {
          if(!alive)throw new Error('The source model changed')
          pose(captureCamera,view);gl.render(scene,captureCamera)
          const beauty=gl.domElement.toDataURL('image/png').split(',')[1]
          // the same camera's depth, near white: the villa's exact volumes for the AI to hold to
          // linear depth stretched over the villa itself (its nearest to its farthest point), so every step in the facade reads
          const view0=captureCamera.matrixWorldInverse,zs=Array.from({length:8},(_,i)=>-new THREE.Vector3(i&1?box.max.x:box.min.x,i&2?box.max.y:box.min.y,i&4?box.max.z:box.min.z).applyMatrix4(view0).z)
          const near=Math.max(.1,Math.min(...zs)),far=Math.max(...zs)+size.length()*.15
          const depthMat=new THREE.ShaderMaterial({uniforms:{near:{value:near},far:{value:far}},
            vertexShader:`varying float vz;
void main(){
#include <begin_vertex>
#include <project_vertex>
vz=-mvPosition.z;
}`,
            fragmentShader:'uniform float near;uniform float far;varying float vz;void main(){float d=clamp((vz-near)/(far-near),0.,1.);gl_FragColor=vec4(vec3(pow(1.-d,.8)),1.);}'})
          const bg:THREE.Scene['background']=scene.background
          scene.overrideMaterial=depthMat;scene.background=new THREE.Color('#000');gl.render(scene,captureCamera)
          const depth=gl.domElement.toDataURL('image/png').split(',')[1]
          scene.overrideMaterial=null;scene.background=bg;depthMat.dispose()
          const edge=await buildingEdgeMap(beauty)
          pair.push({view,beauty,edge,depth})
        }
        if(!alive)throw new Error('The source model changed')
        return pair
      } finally {
        scene.remove(stage);ground.geometry.dispose();(ground.material as THREE.Material).dispose();sun.dispose()
        lights.forEach((l,i)=>{l.intensity=dim[i]});cast.forEach(([c,rcv],o)=>{o.castShadow=c;o.receiveShadow=rcv});gl.shadowMap.enabled=shadows;gl.shadowMap.needsUpdate=true
        scene.background=previousBackground;gl.setPixelRatio(dpr);gl.setSize(old.x,old.y,false);gl.render(scene,camera)}
    }})
    return ()=>{alive=false;sky.dispose();setDriver(null)}
  },[gl,scene,camera,controls,box,setDriver])
  return null
}
