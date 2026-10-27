import { PipeConnectionHardware } from './PipeConnectionHardware.tsx'
import type { SupplyNetwork } from '@/lib/water/supplyContinuity.ts'
import { useEffect, useMemo } from 'react'
import { useThree } from '@react-three/fiber'
import { Html, Line } from '@react-three/drei'
import { Mesh, MeshPhysicalMaterial, Vector2, Vector3 } from 'three'
import { createPlumbingGroup, disposePlumbingGroup } from '@/lib/plumbing/pipeGeometry.ts'
import { planToThreeGlb } from '@/lib/solar/coordinates.ts'
import type { ServicePoint, VillaPlumbing, VillaPipe } from '@/lib/plumbing/villaPlumbing.ts'
import type { RainCollection } from '@/lib/water/simpleSystem.ts'
import { RainStorageTank } from './RainStorageTank.tsx'
import { PipeWater } from './PipeWater.tsx'
import { RainFilters } from './RainFilters.tsx'
import { useWaterPbr } from './useWaterPbr.ts'
import { TankOutletConnections } from './TankOutletConnections.tsx'
import { DrainageTank, DrainReducers } from './DrainageTank.tsx'
import type { ConnectedDrainage } from '@/lib/water/drainageNetwork.ts'
import type { DrainStorage } from '@/lib/water/drainageStorage.ts'
import { filterDisplayPipes } from '@/lib/water/filterDisplay.ts'

const world=(p:ServicePoint)=>{const w=planToThreeGlb(p);return [w.x,w.y,w.z] as [number,number,number]}
function PipeRun({layout,xray,role,selected,onSelect,color,flowing=false}:{layout:VillaPlumbing;xray:boolean;role:string;selected:string;onSelect:(s:string)=>void;color:string;flowing?:boolean}) {
  const invalidate=useThree(s=>s.invalidate)
  const maps=useWaterPbr('plastic')
  const group=useMemo(()=>{const group=createPlumbingGroup(layout,xray)
    group.traverse(o=>{if(o instanceof Mesh){for(const m of Array.isArray(o.material)?o.material:[o.material])m.dispose();o.material=new MeshPhysicalMaterial({color,roughness:.3,metalness:.035,clearcoat:.3,clearcoatRoughness:.24,...maps,normalScale:new Vector2(.18,.18),depthTest:true,depthWrite:true});if(xray)o.renderOrder=35}})
    return group},[layout,xray,maps,color])
  useEffect(()=>()=>disposePlumbingGroup(group),[group])
  useEffect(()=>{
    group.traverse(o=>{if(o instanceof Mesh){
      for(const m of Array.isArray(o.material)?o.material:[o.material]){
        if('color' in m)(m as import('three').MeshStandardMaterial).color.set(selected===role?'#B87922':role==='pending'?'#766E61':color)
        const dimmed=(role==='drain-network'||role==='supply')&&selected.startsWith('fixture:');m.transparent=flowing||dimmed;m.opacity=dimmed?.3:flowing?.48:1;m.depthWrite=!flowing&&!dimmed;m.needsUpdate=true
      }
    }})
    invalidate()
  },[group,selected,role,color,xray,flowing,invalidate])
  return <group onClick={e=>{e.stopPropagation();onSelect(role)}}><primitive object={group} dispose={null}/>{xray&&!flowing&&role!=='drain-network'&&role!=='supply'&&layout.pipes.map(pipe=><Line key={pipe.id} points={pipe.points.map(world)} color={selected===role?'#A1661C':role==='pending'?'#746B5C':'#245C43'} lineWidth={role==='pending'?1.2:1} dashed={role==='pending'} dashSize={.12} gapSize={.08} depthTest toneMapped={false} renderOrder={36}/>)}</group>
}
function Gutter({a,b,xray,selected,onSelect}:{a:ServicePoint;b:ServicePoint;xray:boolean;selected:boolean;onSelect:()=>void}) {
  const start=new Vector3(...world(a)),end=new Vector3(...world(b)),center=start.clone().add(end).multiplyScalar(.5),length=Math.max(.01,start.distanceTo(end)-.18),angle=-Math.atan2(end.z-start.z,end.x-start.x)
  return <group position={center} rotation={[0,angle,0]} onClick={e=>{e.stopPropagation();onSelect()}}>
    {[[0,-.005,0,length,.014,.18],[0,.04,-.084,length,.09,.012],[0,.04,.084,length,.09,.012]].map(([x,y,z,w,h,d],i)=><mesh key={i} position={[x,y,z]} renderOrder={xray?30:0} castShadow><boxGeometry args={[w,h,d]}/><meshStandardMaterial color={selected?'#C18A40':'#70675B'} roughness={.34} metalness={.45} depthTest={!xray}/></mesh>)}
    {Array.from({length:Math.max(1,Math.floor(length/1.5))},(_,i)=><mesh key={`bracket${i}`} position={[-length/2+(i+.5)*length/Math.max(1,Math.floor(length/1.5)),-.045,0]}><boxGeometry args={[.025,.025,.34]}/><meshStandardMaterial color="#605C52" metalness={.4} roughness={.5}/></mesh>)}
  </group>
}
function GutterCorner({point,previous,next,xray}:{point:ServicePoint;previous:ServicePoint;next:ServicePoint;xray:boolean}) {
  const origin=world(point),before=new Vector3(...world(previous)).sub(new Vector3(...origin)),after=new Vector3(...world(next)).sub(new Vector3(...origin))
  const closed=[[1,0],[-1,0],[0,1],[0,-1]].filter(([x,z])=>before.x*x+before.z*z<.001&&after.x*x+after.z*z<.001)
  return <group position={origin}><mesh renderOrder={xray?30:0}><boxGeometry args={[.18,.014,.18]}/><meshStandardMaterial color="#70675B" metalness={.45} roughness={.34} depthTest={!xray}/></mesh>{closed.map(([x,z],i)=><mesh key={i} position={[x*.084,.04,z*.084]} renderOrder={xray?30:0}><boxGeometry args={x?[.012,.09,.18]:[.18,.09,.012]}/><meshStandardMaterial color="#70675B" metalness={.45} roughness={.34} depthTest={!xray}/></mesh>)}</group>
}
function Equipment({rain,selected,onSelect,xray,filling,fillReplay}:{fillReplay:number;filling:boolean;rain:RainCollection;selected:string;onSelect:(s:string)=>void;xray:boolean}) {
  if(!rain.tank||!rain.collector||!rain.firstFlush||!rain.filter)return null
  const tank=rain.tank
  const away={x:Math.sign(tank.center.x-rain.collector.x),y:Math.sign(tank.center.y-rain.collector.y)}
  const clipCount=Math.max(1,Math.floor((rain.collector.z-rain.firstFlush.z)/1400))
  return <>
    {Array.from({length:clipCount},(_,i)=>{const p={...rain.collector!,z:rain.firstFlush!.z+400+i*1400},at=new Vector3(...world(p)),end=new Vector3(...world({...p,x:p.x-away.x*150,y:p.y-away.y*150})),center=at.clone().add(end).multiplyScalar(.5),angle=-Math.atan2(end.z-at.z,end.x-at.x)
      return <group key={`clamp${i}`}><mesh position={at} rotation={[Math.PI/2,0,0]}><torusGeometry args={[.049,.008,6,16]}/><meshStandardMaterial color="#6D6A5D" metalness={.55} roughness={.4}/></mesh><mesh position={center} rotation={[0,angle,0]}><boxGeometry args={[at.distanceTo(end),.025,.02]}/><meshStandardMaterial color="#6D6A5D" metalness={.55} roughness={.4}/></mesh><mesh position={end} rotation={[0,angle,0]}><boxGeometry args={[.02,.09,.07]}/><meshStandardMaterial color="#6D6A5D" metalness={.55} roughness={.4}/></mesh></group>
    })}
    <group position={world(rain.collector)} onClick={e=>{e.stopPropagation();onSelect('filter')}} name="Roof_Leaf_Screen">
      <mesh position={[0,-.035,0]}><boxGeometry args={[.23,.025,.23]}/><meshStandardMaterial color="#70695B" metalness={.5} roughness={.4}/></mesh>
      {Array.from({length:9},(_,i)=>(i-4)*.024).map(at=><group key={at}><mesh position={[at,.004,0]}><boxGeometry args={[.004,.004,.22]}/><meshStandardMaterial color="#3D4942" metalness={.6} roughness={.35}/></mesh><mesh position={[0,.006,at]}><boxGeometry args={[.22,.004,.004]}/><meshStandardMaterial color="#3D4942" metalness={.6} roughness={.35}/></mesh></group>)}
    </group>
    <group position={world(rain.firstFlush)} onClick={e=>{e.stopPropagation();onSelect('filter')}}>
      <mesh position={[0,-.28,0]} renderOrder={xray?30:0}><cylinderGeometry args={[.085,.085,.52,20]}/><meshStandardMaterial color="#D4C7AE" roughness={.35} depthTest={!xray}/></mesh>
      <mesh position={[0,-.55,0]}><cylinderGeometry args={[.095,.095,.04,20]}/><meshStandardMaterial color="#676D58" roughness={.4}/></mesh>
    </group>
    <RainFilters rain={rain} xray={xray} selected={selected==='filter'} onSelect={()=>onSelect('filter')}/>
    <RainStorageTank key={`${rain.downpipes.signature}:${fillReplay}`} rain={rain} filling={filling} selected={selected==='rain-tank'} onSelect={()=>onSelect('rain-tank')}/>

  </>
}
export function SimpleWaterLayer({home,rain,mode,xray,animate,labels,selected,onSelect,roofHeightScale=1,raining=false,fillReplay=0,drainage,drainNetwork,supplyNetwork,drainFixtureRuns=[]}:{drainFixtureRuns?:Pick<VillaPipe,'system'|'diameterMm'|'points'>[];supplyNetwork?:SupplyNetwork;drainNetwork?:ConnectedDrainage;drainage?:DrainStorage;fillReplay?:number;raining?:boolean;roofHeightScale?:number;home:VillaPlumbing;rain:RainCollection;mode:'home'|'rain'|'drain';xray:boolean;animate:boolean;labels:boolean;selected:string;onSelect:(s:string)=>void}) {
  const drainHardwareRuns=useMemo(()=>[...(drainNetwork?.layout.pipes??[]),...drainFixtureRuns],[drainNetwork,drainFixtureRuns])
  const filteredDisplay=useMemo(()=>filterDisplayPipes(rain),[rain])
  const connected=useMemo(()=>supplyNetwork?.layout??({...home,pipes:home.pipes.filter(p=>p.system==='water'&&!p.id.startsWith('water-stub:')),segments:[],assembly:undefined}),[home,supplyNetwork])
  const stubs=useMemo(()=>supplyNetwork?.pendingLayout??({...home,pipes:home.pipes.filter(p=>p.id.startsWith('water-stub:')),segments:[],assembly:undefined}),[home,supplyNetwork])
  const flow=mode==='home'?connected.pipes:mode==='drain'?(drainNetwork?.layout.pipes??[]).filter(p=>p.system==='drain').map(p=>({...p,points:p.id.startsWith('soil:')||p.id.startsWith('stack-link:')?[...p.points].reverse():p.points})):rain.downpipes.pipes.filter(p=>p.id==='rain:downpipe')
  const targets=mode==='drain'?(drainage?.tank?[{point:{...drainage.tank.center,z:drainage.tank.topMm+450},name:'Tank',role:'drain-tank'}]:[]):mode==='home'?home.tankPorts.map((t,i)=>({point:t.center,name:`Roof tank ${i+1}`,role:`roof-tank:${i}`})):[...(rain.collector?[{point:rain.collector,name:'Roof collection',role:'gutters'}]:[]),...(rain.tank?[{point:{...rain.tank.center,z:rain.tank.center.z+rain.tank.heightMm/2+150},name:'Rainwater tank',role:'rain-tank'}]:[])]
  return <group name="Simple_Water_System">
    {mode==='drain'?<>{drainNetwork&&<><PipeRun layout={drainNetwork.layout} xray={xray} flowing={animate} role="drain-network" selected={selected} onSelect={onSelect} color="#59665D"/>{drainNetwork.pending.map(pipe=><group key={pipe.id} onClick={e=>{e.stopPropagation();onSelect('drain-pending')}}><Line points={pipe.points.map(world)} color="#8D897D" lineWidth={1.6} dashed dashSize={.14} gapSize={.1} depthTest={false} renderOrder={38}/></group>)}</>}{drainage&&<><DrainReducers storage={drainage}/><DrainageTank storage={drainage} xray={xray} onSelect={()=>onSelect('drain-tank')}/></>}</>:mode==='home'?<><PipeRun layout={connected} flowing={animate} xray={xray} role="supply" selected={selected} onSelect={onSelect} color="#C8C5B9"/>{<PipeRun layout={stubs} xray={xray} role="pending" selected={selected} onSelect={onSelect} color="#9A958B"/>}<TankOutletConnections home={home} xray={xray} onSelect={()=>onSelect('supply')}/>{(selected==='roof-tank'||selected.startsWith('roof-tank:'))&&home.tankPorts.map(t=><group key={t.id} position={world(t.center)} onClick={e=>{e.stopPropagation();onSelect('roof-tank')}}>{[-.2,roofHeightScale-.2].map(y=><mesh key={y} position={[0,y,0]} rotation={[Math.PI/2,0,0]} renderOrder={35}><torusGeometry args={[t.radiusMm/1000+.015,.015,6,40]}/><meshBasicMaterial color={selected==='roof-tank'?'#CE9C4E':'#80996D'} depthTest={!xray}/></mesh>)}</group>)}</>:<><PipeRun layout={filteredDisplay} flowing={animate} xray={xray} role="rain-pipes" selected={selected} onSelect={onSelect} color="#CAC7BD"/>{rain.gutters.map(([a,b],i)=><Gutter key={i} a={a} b={b} xray={xray} selected={selected==='gutters'} onSelect={()=>onSelect('gutters')}/>)}{rain.gutters.map(([a,b],i)=><GutterCorner key={`corner${i}`} point={a} previous={rain.gutters[(i+rain.gutters.length-1)%rain.gutters.length][0]} next={b} xray={xray}/>)}<Equipment rain={rain} fillReplay={fillReplay} filling={animate&&raining&&rain.ready} selected={selected} onSelect={onSelect} xray={xray}/></>}
    {mode==='home'&&<PipeConnectionHardware runs={connected.pipes} segments={connected.segments} valves={supplyNetwork?.valves}/>}
    {mode==='drain'&&drainNetwork&&<PipeConnectionHardware runs={drainHardwareRuns} segments={drainNetwork.layout.segments}/>}
    {animate&&flow.map(p=><PipeWater key={`${p.id}:${fillReplay}`} points={p.points} waste={mode==='drain'} xray={xray} diameterMm={p.diameterMm} delay={mode==='rain'?4:0}/>)}
    {animate&&mode==='rain'&&rain.collector&&rain.firstFlush&&<PipeWater key={`first-runoff-diversion:${fillReplay}`} points={[rain.collector,rain.firstFlush,{...rain.firstFlush,z:300}]} diameterMm={90} xray={xray} stopAfter={4}/>}
    {labels&&mode==='drain'&&drainNetwork?.labels.map((t,i)=><Html key={t.id} position={world(t.point)} center zIndexRange={[10,0]}><button aria-label={t.name} className="grid min-h-11 min-w-11 place-items-center text-[10px] text-ink" onClick={()=>onSelect(t.pending?'drain-pending':'drain-network')}><span className={`grid h-6 w-6 place-items-center rounded-full border bg-bg/95 shadow-sm ${t.pending?'border-dashed border-ink-faint':'border-accent'}`}>{i+1}</span></button></Html>)}
    {labels&&targets.map(t=><Html key={t.role} position={world(t.point)} center zIndexRange={[10,0]}><button className="min-h-11 whitespace-nowrap rounded-lg border border-line bg-bg/95 px-3 text-xs text-ink shadow-sm" onClick={()=>onSelect(t.role)}>{t.name}</button></Html>)}
  </group>
}
