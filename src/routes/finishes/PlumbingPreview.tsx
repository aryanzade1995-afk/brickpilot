import {Canvas} from '@react-three/fiber'
import {Bounds,OrbitControls} from '@react-three/drei'
import {Component,type ReactNode,useMemo,useRef} from 'react'
import {Vector3,CatmullRomCurve3} from 'three'
import type {PlumbingSchedule,ServiceTank} from '@/lib/cost/plumbing.ts'
import {translate as t,useLanguage} from '@/lib/i18n/index.ts'
import { ExportDropdown } from '@/components/export/ExportDropdown.tsx'
import { captureCanvasPng } from '@/lib/export/index.ts'

function Pipe({points,color,radius}:{points:[number,number,number][];color:string;radius:number}){
  const path=useMemo(()=>new CatmullRomCurve3(points.map(p=>new Vector3(...p)),false,'catmullrom',0),[points])
  return <mesh><tubeGeometry args={[path,32,radius,10,false]}/><meshStandardMaterial color={color} roughness={.4}/></mesh>
}
function Box({at,size,color,opacity=1}:{at:[number,number,number];size:[number,number,number];color:string;opacity?:number}){
  return <mesh position={at}><boxGeometry args={size}/><meshStandardMaterial color={color} transparent={opacity<1} opacity={opacity} roughness={.75}/></mesh>
}
function Tank({tank,x}:{tank:ServiceTank;x:number}){
  const {lengthM:l,widthM:w,depthM:d}=tank,th=.10
  const z=w/2
  return <group position={[x,0,0]}>
    <Box at={[0,-d-th/2,0]} size={[l+2*th,th,w+2*th]} color="#979a96"/>
    <Box at={[-l/2-th/2,-d/2,0]} size={[th,d,w+2*th]} color="#b6b9b3"/>
    <Box at={[l/2+th/2,-d/2,0]} size={[th,d,w+2*th]} color="#b6b9b3"/>
    <Box at={[0,-d/2,-z-th/2]} size={[l,d,th]} color="#b6b9b3"/>
    <Box at={[0,-d/2,z+th/2]} size={[l,d,th]} color="#b6b9b3" opacity={.14}/>
    {tank.kind!=='chamber'&&<Box at={[0,-d*.64,0]} size={[l,d*.7,w]} color={tank.kind==='water'?'#57bbd4':'#9a8367'} opacity={.65}/>}
    {tank.kind==='septic'&&<Box at={[l*.12,-d/2,0]} size={[.08,d*.85,w]} color="#9a9e97"/>}
    <Box at={[0,.25,-z*.7]} size={[Math.min(.65,l),.12,Math.min(.65,w)]} color="#5e665e"/>
    <Box at={[0,-.04,0]} size={[l+.55,.06,w+.55]} color="#af9b7d" opacity={.20}/>
  </group>
}
class Boundary extends Component<{children:ReactNode},{failed:boolean}>{
  state={failed:false}
  static getDerivedStateFromError(){return {failed:true}}
  render(){return this.state.failed?<p className="p-6 text-sm">{t('3D preview unavailable on this device. Your finish selection still works.')}</p>:this.props.children}
}
export default function PlumbingPreview({schedule,waterMaterial}:{schedule:PlumbingSchedule;waterMaterial:string}){
  useLanguage(s=>s.language)
  const canvasContainerRef = useRef<HTMLDivElement>(null)
  const water=schedule.underground,drain=schedule.drain
  const left=water?-Math.max(2.5,water.lengthM/2+1.5):-2.5,right=drain?Math.max(2.5,drain.lengthM/2+1.5):2.5
  const span=Math.max(6,Math.abs(left)+(water?.lengthM??0)/2,right+(drain?.lengthM??0)/2)
  const color=waterMaterial==='ppr'?'#328f80':waterMaterial==='pex'?'#4b8cc9':'#d1bf9b'
  const branch=schedule.runs.find(r=>r.purpose==='Water branches')?.diameterMm??20
  const riser=schedule.runs.find(r=>r.purpose==='Water riser')?.diameterMm??32
  const waste=schedule.runs.find(r=>r.purpose==='Waste branches')?.diameterMm??75
  const soil=schedule.runs.find(r=>r.purpose==='Soil / drain stack')?.diameterMm??110
  return <figure className="mt-5 overflow-hidden rounded-lg border border-line bg-bg-inset">
    <div className="flex justify-between items-center gap-3 px-4 py-3 text-xs">
      <p>{t('Plumbing system preview')}</p>
      <div className="flex items-center gap-2">
        <p className="text-ink-dim hidden sm:block">{t('Drag to rotate')}</p>
        <ExportDropdown
          size="sm"
          label="Download 3D"
          title="Download Plumbing Schematic"
          items={[
            {
              id: 'plumbing-png',
              label: '3D Schematic',
              ext: '.png',
              onExport: async () => {
                const canvas = canvasContainerRef.current?.querySelector('canvas')
                if (canvas) {
                  await captureCanvasPng(canvas, 'plumbing-schematic.png')
                }
              },
            },
          ]}
        />
      </div>
    </div>
    <div ref={canvasContainerRef} className="h-72 sm:h-80" role="img" aria-label={t('3D water supply, underground storage and drainage schematic')}>
      <Boundary><Canvas frameloop="demand" dpr={[1,1.5]} gl={{ preserveDrawingBuffer: true }} camera={{position:[span*.65,span*.5,span*.95],fov:42}}>
        <color attach="background" args={['#e8e8e0']}/><ambientLight intensity={1.5}/><directionalLight position={[3,8,4]} intensity={2}/>
        <Bounds fit clip observe margin={1.2}><group>
        {water&&<Tank tank={water} x={left}/>}{drain&&<Tank tank={drain} x={right}/>}
        <Box at={[0,1.1,-.5]} size={[1.7,2.2,.18]} color="#f6f5ed"/>
        <Box at={[0,.55,0]} size={[1.1,.12,.6]} color="#c4c8c5"/>
        <Pipe points={[[water?left:-3,-.7,0],[-1,-.7,0],[-1,1.7,0]]} color={color} radius={riser/2000*3}/>
        <Pipe points={[[-1,1.7,0],[.5,1.7,0],[.5,.8,0]]} color={color} radius={branch/2000*3}/>
        <Pipe points={[[.1,.45,0],[.1,-.7,0]]} color="#9b694a" radius={waste/2000}/>
        <Pipe points={[[.1,-.7,0],[drain?right:3,-.7,0]]} color="#9b694a" radius={soil/2000}/>
        </group></Bounds><OrbitControls makeDefault enablePan={false} minDistance={2} maxDistance={30}/>
      </Canvas></Boundary>
    </div>
    <figcaption className="border-t border-line p-4 text-xs leading-relaxed text-ink-dim">
      <div className="mb-2 flex flex-wrap gap-x-5 gap-y-2"><span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-cyan-600"/>{t('Clean water')}{water?` · ${water.capacityLitres.toLocaleString('en-IN')} L`:''}</span><span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-amber-800"/>{t('Wastewater')}{drain?.capacityLitres?` · ${drain.capacityLitres.toLocaleString('en-IN')} L`:''}</span><span>{t('Cutaway view · covers lifted')}</span></div>
      {t('System schematic. Tank positions are illustrative; pipes are enlarged for clarity. This does not change your building model.')}
    </figcaption>
  </figure>
}
