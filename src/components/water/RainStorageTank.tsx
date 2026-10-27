import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import { DoubleSide, Group, Mesh, ShaderMaterial, Vector2 } from 'three'
import type { RainCollection } from '@/lib/water/simpleSystem.ts'
import { tankArrivalSeconds, tankFillPreview } from '@/lib/water/tankFillPreview.ts'
import { waterSurfaceDetail } from '@/lib/water/surfaceDetail.ts'
import { planToThreeGlb } from '@/lib/solar/coordinates.ts'

/** A presentation cutaway, not a manufactured tank window or sensor reading.
 * The opaque green shell, ribs and lid keep their original materials. */
export function RainStorageTank({rain,selected,onSelect,filling}:{rain:RainCollection;selected:boolean;onSelect:()=>void;filling:boolean}) {
  const tank=rain.tank!,r=tank.radiusMm/1000,h=tank.heightMm/1000,p=planToThreeGlb(tank.center)
  const levelLabel=useRef<HTMLDivElement>(null)
  const shell=useRef<Group>(null),volume=useRef<Mesh>(null),surface=useRef<Mesh>(null),wave=useRef<ShaderMaterial>(null)
  const elapsed=useRef(0),lastLabel=useRef(0),[percent,setPercent]=useState(0),invalidate=useThree(s=>s.invalidate)
  const arrival=useMemo(()=>tankArrivalSeconds(rain.downpipes.pipes.find(p=>p.id==='rain:downpipe')?.points??[]),[rain])
  const texture=useMemo(()=>waterSurfaceDetail(),[])
  useEffect(()=>()=>texture.dispose(),[texture])
  const profiles=useMemo(()=>({
    top:[[r*.99,h*.37],[r*.995,h*.43],[r*.985,h*.47],[r*.94,h*.49],[r*.83,h*.5],[0,h*.5]].map(([x,y])=>new Vector2(x,y)),
    bottom:[[0,-h*.5+.008],[r*.86,-h*.5+.008],[r*.97,-h*.48],[r,-h*.43],[r,-h*.37]].map(([x,y])=>new Vector2(x,y)),
    rib:[[r*.985,-.023],[r*1.012,-.016],[r*1.017,0],[r*1.012,.016],[r*.985,.023]].map(([x,y])=>new Vector2(x,y)),
  }),[r,h])
  const inlet=planToThreeGlb(tank.inlet),inletSign=Math.sign(inlet.x-p.x)||1
  const material=useMemo(()=>new ShaderMaterial({transparent:true,depthWrite:false,toneMapped:false,uniforms:{time:{value:0}},
    vertexShader:`uniform float time; varying float vWave; void main(){vec3 p=position;vWave=sin(p.x*20.0+time*2.0)*sin(p.y*17.0-time*1.4);p.z+=vWave*.003;gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.0);}`,
    fragmentShader:`varying float vWave; void main(){vec3 c=mix(vec3(.12,.35,.39),vec3(.52,.75,.76),.5+vWave*.3);gl_FragColor=vec4(c,.9);#include <colorspace_fragment>
}`.replace(';#include',';\n#include')
  }),[])
  useEffect(()=>()=>material.dispose(),[material])
  useEffect(()=>{const resume=()=>{if(!document.hidden)invalidate()};document.addEventListener('visibilitychange',resume);return()=>document.removeEventListener('visibilitychange',resume)},[invalidate])
  useFrame(({camera},delta)=>{
    if(document.hidden)return
    if(levelLabel.current)levelLabel.current.style.visibility=Math.hypot(camera.position.x-p.x,camera.position.y-p.y,camera.position.z-p.z)<Math.max(6,h*5)?'visible':'hidden'
    if(shell.current)shell.current.rotation.y=Math.atan2(camera.position.x-p.x,camera.position.z-p.z)
    if(filling)elapsed.current+=Math.min(delta,.1)
    const level=tankFillPreview(elapsed.current,arrival),depth=Math.max(.001,(h-.1)*level),bottom=-h/2+.045
    if(volume.current){volume.current.visible=level>0;volume.current.scale.y=depth;volume.current.position.y=bottom+depth/2}
    if(surface.current){surface.current.visible=level>0;surface.current.position.y=bottom+depth}
    if(wave.current)wave.current.uniforms.time.value=elapsed.current
    const next=Math.round(level*100)
    if(next!==lastLabel.current){lastLabel.current=next;setPercent(next)}
    if(filling&&level<.9)invalidate()
  })
  const shellColor='#617561',half=.48
  return <group position={[p.x,p.y,p.z]} name="Rainwater_storage_level_cutaway" onClick={e=>{e.stopPropagation();onSelect()}}>
    <group ref={shell}>
      {/* Narrow camera-facing section only; the rest stays opaque and coloured. */}
      <mesh castShadow receiveShadow><cylinderGeometry args={[r*.98,r,h*.74,48,1,true,half,Math.PI*2-half*2]}/><meshStandardMaterial color={shellColor} roughness={.38} side={DoubleSide} roughnessMap={texture} bumpMap={texture} bumpScale={.00022}/></mesh>
      {[profiles.top,profiles.bottom].map((profile,i)=><mesh key={`end${i}`} castShadow receiveShadow><latheGeometry args={[profile,64]}/><meshPhysicalMaterial color={shellColor} roughness={.36} clearcoat={.25} clearcoatRoughness={.3} roughnessMap={texture} bumpMap={texture} bumpScale={.00022} side={DoubleSide}/></mesh>)}
      <mesh renderOrder={5}><cylinderGeometry args={[r*.985,r*.995,h*.74,16,1,true,-half,half*2]}/><meshPhysicalMaterial color="#C5D9D2" transparent opacity={.09} roughness={.12} depthWrite={false}/></mesh>
      {[-half,half].map(angle=><mesh key={angle} position={[Math.sin(angle)*r,0,Math.cos(angle)*r]}><boxGeometry args={[.018,h*.74,.018]}/><meshStandardMaterial color="#455A46" roughness={.4}/></mesh>)}
      {Array.from({length:7},(_,i)=><mesh key={i} position={[0,-h*.4+i*h*.8/6,0]}><latheGeometry args={[profiles.rib,56,half,Math.PI*2-half*2]}/><meshPhysicalMaterial color="#526B54" roughness={.36} clearcoat={.2} roughnessMap={texture}/></mesh>)}
      <Html ref={levelLabel} style={{visibility:'hidden'}} position={[0,-h*.3,r*1.05]} center zIndexRange={[8,0]}><span className={`pointer-events-none block whitespace-nowrap rounded-lg border ${selected?'border-accent':'border-line'} bg-bg/95 px-3 py-2 text-[10px] text-ink shadow-sm`}>Demo water level · {percent}%</span></Html>
    </group>
    <mesh ref={volume} visible={false}><cylinderGeometry args={[r*.93,r*.93,1,40,1,true]}/><meshPhysicalMaterial color="#6FA3A5" transparent opacity={.65} roughness={.16} clearcoat={1} depthWrite={false}/></mesh>
    <mesh ref={surface} rotation={[-Math.PI/2,0,0]} visible={false}><circleGeometry args={[r*.93,48]}/><primitive ref={wave} object={material} attach="material"/></mesh>
    {/* Compression bulkhead closes the pipe end and seats it through the tank wall. */}
    <group name="Tank_inlet_bulkhead" position={[inlet.x-p.x,inlet.y-p.y,inlet.z-p.z]} rotation={[0,0,Math.PI/2]}>
      <mesh position={[0,-inletSign*.018,0]}><cylinderGeometry args={[.049,.049,.14,40]}/><meshPhysicalMaterial color="#CDCBC0" roughness={.28} clearcoat={.35}/></mesh>
      <mesh position={[0,-inletSign*.046,0]}><cylinderGeometry args={[.074,.074,.018,40]}/><meshStandardMaterial color="#373F38" roughness={.7}/></mesh>
      <mesh position={[0,-inletSign*.06,0]}><cylinderGeometry args={[.082,.082,.025,40]}/><meshPhysicalMaterial color="#B7BAAE" roughness={.3} metalness={.15}/></mesh>
      <mesh position={[0,inletSign*.035,0]}><cylinderGeometry args={[.069,.069,.032,8]}/><meshStandardMaterial color="#AEB3A7" roughness={.33} metalness={.12}/></mesh>
    </group>
    <mesh position={[0,h/2+.025,0]}><cylinderGeometry args={[r*.42,r*.45,.06,48]}/><meshStandardMaterial color="#455A46" roughness={.4}/></mesh>
    <mesh position={[0,h/2+.005,0]} rotation={[Math.PI/2,0,0]}><torusGeometry args={[r*.45,.009,8,48]}/><meshStandardMaterial color="#27382C" roughness={.6}/></mesh>
    {Array.from({length:12},(_,i)=>{const a=i*Math.PI/6;return <mesh key={`lidgrip${i}`} position={[Math.sin(a)*r*.425,h/2+.025,Math.cos(a)*r*.425]} rotation={[0,a,0]}><boxGeometry args={[.022,.038,.022]}/><meshStandardMaterial color="#3F5542" roughness={.5}/></mesh>})}
    <mesh position={[0,h/2+.065,0]}><boxGeometry args={[.17,.035,.035]}/><meshStandardMaterial color="#263B2D" roughness={.5}/></mesh>
    <mesh position={[0,-h/2-.04,0]} receiveShadow><cylinderGeometry args={[r+.08,r+.08,.08,32]}/><meshStandardMaterial color="#ACAA9F" roughness={.9}/></mesh>
  </group>
}
