import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Html, Line } from '@react-three/drei'
import { Mesh, MeshBasicMaterial, Vector3 } from 'three'
import { createPlumbingGroup, disposePlumbingGroup } from '@/lib/plumbing/pipeGeometry.ts'
import { planToThreeGlb } from '@/lib/solar/coordinates.ts'
import type { ServicePoint, VillaPlumbing } from '@/lib/plumbing/villaPlumbing.ts'
import type { RainCollection } from '@/lib/water/simpleSystem.ts'

const world=(p:ServicePoint)=>{const w=planToThreeGlb(p);return [w.x,w.y,w.z] as [number,number,number]}
function PipeRun({layout,xray,role,selected,onSelect,color}:{layout:VillaPlumbing;xray:boolean;role:string;selected:string;onSelect:(s:string)=>void;color:string}) {
  const invalidate=useThree(s=>s.invalidate)
  const group=useMemo(()=>{const group=createPlumbingGroup(layout,xray)
    if(xray)group.traverse(o=>{if(o instanceof Mesh){for(const material of Array.isArray(o.material)?o.material:[o.material])material.dispose();o.material=new MeshBasicMaterial({color:'#285D45',depthTest:false,depthWrite:false,toneMapped:false});o.renderOrder=35}})
    return group},[layout,xray])
  useEffect(()=>()=>disposePlumbingGroup(group),[group])
  useEffect(()=>{group.traverse(o=>{if(o instanceof Mesh){for(const m of Array.isArray(o.material)?o.material:[o.material])if('color' in m){(m as import('three').MeshStandardMaterial).color.set(selected===role?'#B87922':xray?role==='pending'?'#766E61':'#285D45':color)}}});invalidate()},[group,selected,role,color,xray,invalidate])
  return <group onClick={e=>{e.stopPropagation();onSelect(role)}}><primitive object={group} dispose={null}/>{xray&&layout.pipes.map(pipe=><Line key={pipe.id} points={pipe.points.map(world)} color={selected===role?'#A1661C':role==='pending'?'#746B5C':'#245C43'} lineWidth={role==='pending'?1.5:3} dashed={role==='pending'} dashSize={.12} gapSize={.08} depthTest={false} toneMapped={false} renderOrder={36}/>)}</group>
}
function Flow({points}:{points:ServicePoint[]}) {
  const ref=useRef<Mesh>(null),invalidate=useThree(s=>s.invalidate)
  const path=useMemo(()=>{const p=points.map(p=>new Vector3(...world(p))),lengths=p.slice(1).map((b,i)=>b.distanceTo(p[i]));return {p,lengths,length:lengths.reduce((s,n)=>s+n,0)}},[points])
  useFrame(({clock})=>{if(!ref.current||!path.length)return;let d=clock.elapsedTime*.7%path.length;for(let i=0;i<path.lengths.length;i++){if(d<=path.lengths[i]){ref.current.position.lerpVectors(path.p[i],path.p[i+1],d/Math.max(.0001,path.lengths[i]));break}d-=path.lengths[i]}invalidate()})
  return <mesh ref={ref} renderOrder={40}><sphereGeometry args={[.045,10,6]}/><meshBasicMaterial color="#E8C983" depthTest={false}/></mesh>
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
function Equipment({rain,selected,onSelect,xray}:{rain:RainCollection;selected:string;onSelect:(s:string)=>void;xray:boolean}) {
  if(!rain.tank||!rain.collector||!rain.firstFlush||!rain.filter)return null
  const tank=rain.tank,r=tank.radiusMm/1000,h=tank.heightMm/1000
  const away={x:Math.sign(tank.center.x-rain.collector.x),y:Math.sign(tank.center.y-rain.collector.y)}
  const clipCount=Math.max(1,Math.floor((rain.collector.z-rain.firstFlush.z)/1400))
  return <>
    {Array.from({length:clipCount},(_,i)=>{const p={...rain.collector!,z:rain.firstFlush!.z+400+i*1400},at=new Vector3(...world(p)),end=new Vector3(...world({...p,x:p.x-away.x*150,y:p.y-away.y*150})),center=at.clone().add(end).multiplyScalar(.5),angle=-Math.atan2(end.z-at.z,end.x-at.x)
      return <group key={`clamp${i}`}><mesh position={at} rotation={[Math.PI/2,0,0]}><torusGeometry args={[.049,.008,6,16]}/><meshStandardMaterial color="#6D6A5D" metalness={.55} roughness={.4}/></mesh><mesh position={center} rotation={[0,angle,0]}><boxGeometry args={[at.distanceTo(end),.025,.02]}/><meshStandardMaterial color="#6D6A5D" metalness={.55} roughness={.4}/></mesh><mesh position={end} rotation={[0,angle,0]}><boxGeometry args={[.02,.09,.07]}/><meshStandardMaterial color="#6D6A5D" metalness={.55} roughness={.4}/></mesh></group>
    })}
    <group position={world(rain.collector)} onClick={e=>{e.stopPropagation();onSelect('gutters')}}><mesh position={[0,.035,0]}><boxGeometry args={[.22,.17,.22]}/><meshStandardMaterial color={selected==='gutters'?'#C18A40':'#817665'} metalness={.35} roughness={.4}/></mesh></group>
    <group position={world(rain.firstFlush)} onClick={e=>{e.stopPropagation();onSelect('filter')}}>
      <mesh position={[0,-.28,0]} renderOrder={xray?30:0}><cylinderGeometry args={[.085,.085,.52,20]}/><meshStandardMaterial color="#D4C7AE" roughness={.35} depthTest={!xray}/></mesh>
      <mesh position={[0,-.55,0]}><cylinderGeometry args={[.095,.095,.04,20]}/><meshStandardMaterial color="#676D58" roughness={.4}/></mesh>
    </group>
    <group position={world(rain.filter)} onClick={e=>{e.stopPropagation();onSelect('filter')}}><mesh renderOrder={xray?30:0}><cylinderGeometry args={[.14,.12,.3,24]}/><meshStandardMaterial color={selected==='filter'?'#C18A40':'#D5C5A7'} roughness={.3} depthTest={!xray}/></mesh>{[-.16,.16].map(y=><mesh key={y} position={[0,y,0]}><cylinderGeometry args={[.15,.15,.035,24]}/><meshStandardMaterial color="#626F5F" roughness={.4}/></mesh>)}</group>
    <group position={world(tank.center)} onClick={e=>{e.stopPropagation();onSelect('rain-tank')}}>
      <mesh castShadow receiveShadow renderOrder={xray?30:0}><cylinderGeometry args={[r*.98,r,h,48]}/><meshStandardMaterial color={selected==='rain-tank'?'#AC8A50':'#617561'} roughness={.46} depthTest={!xray}/></mesh>
      {Array.from({length:7},(_,i)=><mesh key={i} position={[0,-h*.4+i*h*.8/6,0]} rotation={[Math.PI/2,0,0]}><torusGeometry args={[r*.995,.018,6,48]}/><meshStandardMaterial color="#4E624F" roughness={.5}/></mesh>)}
      <mesh position={[0,h/2+.025,0]}><cylinderGeometry args={[r*.42,r*.45,.06,32]}/><meshStandardMaterial color="#455A46" roughness={.4}/></mesh>
      <mesh position={[0,h/2+.065,0]}><boxGeometry args={[.17,.035,.035]}/><meshStandardMaterial color="#263B2D" roughness={.5}/></mesh>
      <mesh position={[0,-h/2-.04,0]} receiveShadow><cylinderGeometry args={[r+.08,r+.08,.08,32]}/><meshStandardMaterial color="#ACAA9F" roughness={.9}/></mesh>
    </group>
  </>
}
export function SimpleWaterLayer({home,rain,mode,xray,animate,labels,selected,onSelect,roofHeightScale=1}:{roofHeightScale?:number;home:VillaPlumbing;rain:RainCollection;mode:'home'|'rain';xray:boolean;animate:boolean;labels:boolean;selected:string;onSelect:(s:string)=>void}) {
  const connected=useMemo(()=>({...home,pipes:home.pipes.filter(p=>p.system==='water'&&!p.id.startsWith('water-stub:')),segments:[],assembly:undefined}),[home])
  const stubs=useMemo(()=>({...home,pipes:home.pipes.filter(p=>p.id.startsWith('water-stub:')),segments:[],assembly:undefined}),[home])
  const flow=mode==='home'?connected.pipes:rain.downpipes.pipes.filter(p=>p.id==='rain:downpipe')
  const targets=mode==='home'?home.tankPorts.slice(0,1).map(t=>({point:t.center,name:'Roof tank',role:'roof-tank'})):[...(rain.collector?[{point:rain.collector,name:'Roof collection',role:'gutters'}]:[]),...(rain.tank?[{point:{...rain.tank.center,z:rain.tank.center.z+rain.tank.heightMm/2+150},name:'Rainwater tank',role:'rain-tank'}]:[])]
  return <group name="Simple_Water_System">
    {mode==='home'?<><PipeRun layout={connected} xray={xray} role="supply" selected={selected} onSelect={onSelect} color="#A39372"/>{xray&&<PipeRun layout={stubs} xray role="pending" selected={selected} onSelect={onSelect} color="#9A958B"/>}{home.tankPorts.map(t=><group key={t.id} position={world(t.center)} onClick={e=>{e.stopPropagation();onSelect('roof-tank')}}>{[-.2,roofHeightScale-.2].map(y=><mesh key={y} position={[0,y,0]} rotation={[Math.PI/2,0,0]} renderOrder={35}><torusGeometry args={[t.radiusMm/1000+.015,.015,6,40]}/><meshBasicMaterial color={selected==='roof-tank'?'#CE9C4E':'#80996D'} depthTest={!xray}/></mesh>)}</group>)}</>:<><PipeRun layout={rain.downpipes} xray={xray} role="rain-pipes" selected={selected} onSelect={onSelect} color="#887B61"/>{rain.gutters.map(([a,b],i)=><Gutter key={i} a={a} b={b} xray={xray} selected={selected==='gutters'} onSelect={()=>onSelect('gutters')}/>)}{rain.gutters.map(([a,b],i)=><GutterCorner key={`corner${i}`} point={a} previous={rain.gutters[(i+rain.gutters.length-1)%rain.gutters.length][0]} next={b} xray={xray}/>)}<Equipment rain={rain} selected={selected} onSelect={onSelect} xray={xray}/></>}
    {animate&&flow.map(p=><Flow key={p.id} points={p.points}/>)}
    {labels&&targets.map(t=><Html key={t.role} position={world(t.point)} center zIndexRange={[10,0]}><button className="min-h-11 whitespace-nowrap rounded-lg border border-line bg-bg/95 px-3 text-xs text-ink shadow-sm" onClick={()=>onSelect(t.role)}>{t.name}</button></Html>)}
  </group>
}
