import {useMemo,useState} from 'react'
import {Canvas} from '@react-three/fiber'
import {OrbitControls} from '@react-three/drei'
import {curtainOption} from '@/lib/curtains/catalogue.ts'
import {CurtainMotion} from '@/lib/curtains/motion.ts'
import {WindowCurtains} from './WindowCurtains.tsx'

export function CurtainChoicePreview({optionId}:{optionId:string}){
 const [revision,setRevision]=useState(0),[open,setOpen]=useState(true)
 const motion=useMemo(()=>new CurtainMotion([{id:'preview-window',roomId:'preview',roomKey:'preview',roomName:'Preview',floor:0,
  option:curtainOption(optionId)!,position:[0,1.2,.12],rotation:0,width:2.2,drop:2.35,area:2.2*2.35,
  roomBounds:{x:-2000,y:-2000,w:4000,h:4000},floorY:-1.2}],window.matchMedia('(prefers-reduced-motion: reduce)').matches),[optionId])
 return <figure className="overflow-hidden rounded-lg border border-line">
  <div className="h-64 bg-bg-inset"><Canvas frameloop="demand" camera={{position:[2,1.1,5],fov:40}} gl={{antialias:true}} dpr={[1,1.5]}>
   <color attach="background" args={['#eeece7']}/><ambientLight intensity={1.2}/><directionalLight position={[3,4,5]} intensity={2}/>
   <mesh position={[0,.1,-.02]}><boxGeometry args={[2,1.9,.04]}/><meshStandardMaterial color="#bacdd2" roughness={.35}/></mesh>
   {[-1,1].map(sign=><mesh key={sign} position={[sign*1.03,.1,.01]}><boxGeometry args={[.06,2.05,.08]}/><meshStandardMaterial color="#f9f7f0"/></mesh>)}
   <mesh position={[0,.1,.02]}><boxGeometry args={[.04,1.9,.06]}/><meshStandardMaterial color="#f9f7f0"/></mesh>
   <WindowCurtains motion={motion} revision={revision}/><OrbitControls enablePan={false} minDistance={3.2} maxDistance={7}/>
  </Canvas></div>
  <figcaption className="flex flex-wrap items-center justify-between gap-2 border-t border-line p-3 text-xs"><span>{curtainOption(optionId)?.name} · 3D illustration</span>{optionId!=='curtain-none'&&<button type="button" className="min-h-11 border border-line px-3" onClick={()=>{motion.toggle('preview-window');setOpen(!open);setRevision(v=>v+1)}}>{open?'Close preview curtains':'Open preview curtains'}</button>}</figcaption>
 </figure>
}
