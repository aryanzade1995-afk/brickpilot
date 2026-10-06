import { useEffect, useMemo, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { buildBriefRoom } from '@/lib/three/buildRoom.ts'
import { RoomModelMesh } from '@/lib/three/RoomScene.tsx'
import { THEMES, type Character } from '@/lib/model/themes.ts'
import { FURNITURE_LIMITS as L } from '@/lib/furniture/catalogue.ts'
import type { BriefRoom } from '@/lib/furniture/rooms.ts'
export function FurniturePreview({room,character,furnished}:{room:BriefRoom;character:Character;furnished:boolean}){
 const [view,setView]=useState<'3d'|'top'>('3d'),[shown,setShown]=useState(room)
 useEffect(()=>{const timer=setTimeout(()=>setShown(room),L.debounceMs);return()=>clearTimeout(timer)},[room])
 const model=useMemo(()=>buildBriefRoom(shown.id,shown.name,shown.width,shown.depth,L.height,L.doorWidth,L.windowWidth),[shown.id,shown.name,shown.width,shown.depth])
 const camera=useMemo(()=>({position:[6,6,7] as [number,number,number],fov:45}),[])
 const target=useMemo(()=>[0,0.6,0] as [number,number,number],[])
 const tint=THEMES[character].materials.clad.color
 return <div><div className="mb-2 flex gap-2">{(['top','3d'] as const).map(v=><button key={v} type="button" aria-pressed={view===v} className="border border-line px-3 py-1 text-xs" onClick={()=>setView(v)}>{v==='top'?'Top view':'3D view'}</button>)}</div>
  <div className="relative h-[220px] border border-line bg-bg-inset sm:h-[290px]">
   <div className={view==='3d'?'absolute inset-0':'hidden'}><Canvas frameloop="demand" camera={camera} shadows dpr={[1,1.5]} aria-label={`${shown.name} furnished 3D preview`}>
    <ambientLight intensity={1.1}/><hemisphereLight intensity={0.7}/><directionalLight position={[4,7,5]} intensity={2} castShadow/>
    <RoomModelMesh model={model} character={character}/>
    {furnished&&shown.fit.placed.map(p=><mesh key={p.id} position={[p.x+p.width/2-shown.width/2,p.height/2,p.y+p.depth/2-shown.depth/2]} castShadow receiveShadow><boxGeometry args={[p.width,p.height,p.depth]}/><meshStandardMaterial color={tint} roughness={0.7}/></mesh>)}
    <OrbitControls makeDefault target={target} minDistance={2} maxDistance={35} maxPolarAngle={Math.PI/2.05}/>
   </Canvas></div>
   <svg role="img" aria-label={`${shown.name} top view with door swing`} className={view==='top'?'h-full w-full p-4':'hidden'} viewBox={`-0.2 -0.2 ${shown.width+0.4} ${shown.depth+0.4}`}>
    <rect width={shown.width} height={shown.depth} fill="var(--color-bg)" stroke="currentColor" strokeWidth="0.04"/>
    <path d={`M 0 ${shown.depth-L.doorWidth} V ${shown.depth}`} stroke="var(--color-bg)" strokeWidth="0.1"/>
    <path d={`M 0 ${shown.depth} H ${L.doorWidth} M 0 ${shown.depth-L.doorWidth} A ${L.doorWidth} ${L.doorWidth} 0 0 1 ${L.doorWidth} ${shown.depth}`} fill="none" stroke="currentColor" strokeWidth="0.025"/>
    <path d={`M ${(shown.width-L.windowWidth)/2} 0 h ${L.windowWidth}`} stroke="#8fa7b8" strokeWidth="0.07"/>
    {furnished&&shown.fit.placed.map(p=><g key={p.id}><rect x={p.x} y={p.y} width={p.width} height={p.depth} fill={tint} fillOpacity="0.55" stroke="currentColor" strokeWidth="0.02"/><text x={p.x+p.width/2} y={p.y+p.depth/2} textAnchor="middle" fontSize="0.12" fill="currentColor">{p.name}</text></g>)}
   </svg>
  </div>
 </div>
}
