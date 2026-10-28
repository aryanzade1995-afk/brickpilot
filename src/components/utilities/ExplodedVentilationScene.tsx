import { useMemo, type RefObject } from 'react'
import { Canvas } from '@react-three/fiber'
import { Html, OrbitControls } from '@react-three/drei'
import { NeutralToneMapping, type Group } from 'three'
import type { BuildingModel } from '@/lib/engine/buildingModel.ts'
import type { Dollhouse } from '@/lib/three/buildDollhouse.ts'
import type { AirPath } from '@/lib/utilities/ventilation.ts'
import { explodedAirPaths, explodedAirPoint } from '@/lib/utilities/explodedAir.ts'
import { DollhouseModel, DollhouseEnv } from '@/lib/three/DollhouseScene.tsx'
import { AirflowLayer } from './AirflowLayer.tsx'
import { VentilationCamera } from './VentilationCamera.tsx'

/** The furnished-view renderer is reused directly, not reconstructed from GLB
 * bounds or replaced with another house. Only the airflow is a new overlay. */
export function ExplodedVentilationScene({building,doll,paths,running,speed,modelRef}:{building:BuildingModel;doll:Dollhouse;paths:AirPath[];running:boolean;speed:number;modelRef:RefObject<Group|null>}){
  const display=useMemo(()=>explodedAirPaths(building,doll,paths),[building,doll,paths])
  const project=useMemo(()=>(p:AirPath['points'][number],path:AirPath)=>explodedAirPoint(building,doll,p,path),[building,doll])
  return <Canvas frameloop="demand" shadows="soft" dpr={[1,1.5]} gl={{antialias:true,powerPreference:'high-performance'}} camera={{fov:37,near:.1,far:500,position:[25,30,25]}} onCreated={({gl})=>{gl.toneMapping=NeutralToneMapping;gl.toneMappingExposure=1.5;gl.shadowMap.autoUpdate=false;gl.shadowMap.needsUpdate=true}}>
    <DollhouseEnv doll={doll} contactShadows={false}/>
    <group ref={modelRef} name="Furnished_exploded_house"><DollhouseModel doll={doll}/></group>
    <AirflowLayer paths={display.paths} running={running} speed={speed} xray={false} projectPoint={project}/>
    {display.ports.map((port,index)=><group key={port.id} position={port.position}>
      <mesh rotation={[-Math.PI/2,0,0]}><ringGeometry args={[.16,.23,24]}/><meshBasicMaterial color={port.kind==='inlet'?'#168DD0':'#E66E32'} depthWrite={false}/></mesh>
      <Html center position={[0,.28,0]} zIndexRange={[20,0]}><span title={port.label} aria-label={port.label} className="block whitespace-nowrap rounded-md border bg-bg/95 px-1.5 py-1 text-[10px] font-medium shadow-sm" style={{borderColor:port.kind==='inlet'?'#168DD0':'#E66E32',color:port.kind==='inlet'?'#106893':'#a6481b'}}>{display.paths.length>1?`${port.kind==='inlet'?'IN':'OUT'} ${index+1}`:port.label}</span></Html>
    </group>)}
    <OrbitControls makeDefault enableDamping maxPolarAngle={Math.PI/2.05}/>
    <VentilationCamera doll={doll}/>
  </Canvas>
}
