import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { DoubleSide, ShaderMaterial, TubeGeometry } from 'three'
import { waterPipeCurve } from '@/lib/water/pipeCurve.ts'
import type { ServicePoint } from '@/lib/plumbing/villaPlumbing.ts'

/** Illustrative cutaway water, using the recorded pipe centreline and diameter.
 * Texture motion indicates direction, not a hydraulic speed or purity reading.
 * Normal views respect opaque architecture; X-ray reveals concealed sections. */
export function PipeWater({points,diameterMm,delay=0,stopAfter,xray=false,waste=false}:{waste?:boolean;xray?:boolean;points:ServicePoint[];diameterMm:number;delay?:number;stopAfter?:number}) {
  const materialRef=useRef<ShaderMaterial>(null)
  const started=useRef<number|null>(null),invalidate=useThree(s=>s.invalidate)
  const resources=useMemo(()=>{
    const path=waterPipeCurve(points,diameterMm)
    const length=path.getLength()
    if(!length||!Number.isFinite(diameterMm)||diameterMm<=0)return null
    const geometry=new TubeGeometry(path,Math.min(768,Math.max(16,Math.ceil(length*24))),diameterMm/2000*.78,10,false)
    const material=new ShaderMaterial({transparent:true,depthWrite:false,depthTest:true,side:DoubleSide,toneMapped:false,
      uniforms:{waste:{value:waste?1:0},time:{value:0},lengthM:{value:length},front:{value:0}},
      vertexShader:`varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
      fragmentShader:`
        uniform float waste; uniform float time; uniform float lengthM; uniform float front; varying vec2 vUv;
        void main(){
          float distanceM=vUv.x*lengthM;
          float wet=1.0-smoothstep(front-.12,front,distanceM);
          // Continuous liquid with stretched, irregular reflections; no moving beads.
          float travel=distanceM-time*.85;
          float ripple=sin(travel*19.0+sin(vUv.y*18.85+time*1.3)*1.6);
          float fine=sin(travel*43.0-vUv.y*12.57+sin(travel*7.0));
          float sheen=pow(max(0.0,sin(vUv.y*6.283+sin(travel*6.0)*.28)),8.0);
          vec3 water=mix(vec3(.04,.18,.22),vec3(.24,.46,.49),.5+.2*ripple+.1*fine);
          water=mix(water,vec3(.9,.98,1.0),sheen*.45);
          water=mix(water,vec3(.22,.25,.14)+ripple*.045,waste);
          float outletFade=1.0-smoothstep(lengthM-.08,lengthM,distanceM);
          gl_FragColor=vec4(water,wet*outletFade*(.65+.22*sheen));
          #include <colorspace_fragment>
        }`})
    return {geometry,material,length}
  },[points,diameterMm,waste])
  useEffect(()=>{started.current=null;return()=>{resources?.geometry.dispose();resources?.material.dispose()}},[resources])
  useEffect(()=>{const resume=()=>{if(!document.hidden)invalidate()};document.addEventListener('visibilitychange',resume);return()=>document.removeEventListener('visibilitychange',resume)},[invalidate])
  useFrame(({clock})=>{
    const material=materialRef.current
    if(!resources||!material||document.hidden)return
    if(started.current===null)started.current=clock.elapsedTime
    const elapsed=clock.elapsedTime-started.current
    material.uniforms.time.value=Math.max(0,elapsed-delay)
    material.uniforms.front.value=elapsed<delay||stopAfter!==undefined&&elapsed>=stopAfter?-1:Math.min(resources.length+.2,(elapsed-delay)*1.8)
    if(stopAfter===undefined||elapsed<stopAfter)invalidate()
  })
  return resources?<mesh name="Illustrative_water_inside_pipe" geometry={resources.geometry} renderOrder={xray?40:3} dispose={null} raycast={()=>null}><primitive object={resources.material} ref={materialRef} attach="material"/></mesh>:null
}
