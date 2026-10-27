import {RoundedBox} from '@react-three/drei'
import {Vector2} from 'three'
import {drainTankLocalPorts,type DrainStorage} from '@/lib/water/drainageStorage.ts'
import {subtractRegions} from '@/lib/solar/regions.ts'
import {useWaterPbr} from './useWaterPbr.ts'

/** RCC two-chamber concept, shown sectioned in the underground inspection view.
 * Deliberately has no inferred capacity, approved sizing or final soakaway. */
export function DrainageTank({storage,xray,onSelect}:{storage:DrainStorage;xray:boolean;onSelect:()=>void}) {
  const maps=useWaterPbr('concrete'),tank=storage.tank
  if(!tank)return null
  const ports=drainTankLocalPorts(tank)
  const L=tank.lengthMm/1000,W=tank.widthMm/1000,D=tank.depthMm/1000,t=.15
  const concrete=<meshStandardMaterial {...maps} normalScale={new Vector2(.45,.45)} color="#B5B4A8" roughness={.92} depthTest/>
  const box=(id:string,position:[number,number,number],size:[number,number,number])=><RoundedBox key={id} name={id} position={position} args={size} radius={.022} smoothness={3} renderOrder={xray?32:0} castShadow={!xray} receiveShadow={!xray}>{concrete}</RoundedBox>
  return <group name="Proposed_RCC_two_chamber_septic_tank" position={[tank.center.x/1000,tank.topMm/1000,-tank.center.y/1000]} rotation={[0,tank.alongX?0:Math.PI/2,0]} onClick={e=>{e.stopPropagation();onSelect()}}>
    {box('RCC_base',[0,-D+t/2,0],[L,t,W])}
    {box('RCC_back_wall',[0,-D/2,-W/2+t/2],[L,D,t])}
    {box('RCC_inlet_wall',[-L/2+t/2,-D/2,0],[t,D,W])}
    {box('RCC_outlet_wall',[L/2-t/2,-D/2,0],[t,D,W])}
    {box('Sectioned_front_curb',[0,-D+.15,W/2-t/2],[L,.3,t])}
    {box('Partition_left_cheek',[L/6,-.9,-.37],[t,1.65,.56])}
    {box('Partition_right_cheek',[L/6,-.9,.37],[t,1.65,.56])}
    {box('Partition_over_link',[L/6,-.51,0],[t,.78,.18])}
    {box('Partition_under_link',[L/6,-1.425,0],[t,.65,.18])}
    {subtractRegions([{x:-L/2,y:-W/2,w:L,h:W}],[-.6,.93].map(x=>({x:x-.3,y:-.4,w:.6,h:.6}))).map((r,i)=>box(`Access_slab_${i}`,[r.x+r.w/2,-.06,r.y+r.h/2],[r.w,.12,r.h]))}
    {[-.6,.93].map((x,i)=><group key={i} position={[x,0,-.1]}>
      {box(`Access_neck_left_${i}`,[-.34,.06,0],[.08,.24,.76])}
      {box(`Access_neck_right_${i}`,[.34,.06,0],[.08,.24,.76])}
      {box(`Access_neck_front_${i}`,[0,.06,.34],[.6,.24,.08])}
      {box(`Access_neck_back_${i}`,[0,.06,-.34],[.6,.24,.08])}
      <RoundedBox position={[0,.182,0]} args={[.76,.025,.76]} radius={.015} smoothness={3} renderOrder={xray?34:0}><meshStandardMaterial color="#464E48" metalness={.6} roughness={.6}/></RoundedBox>
      <RoundedBox position={[0,.21,0]} args={[.7,.03,.7]} radius={.018} smoothness={3} renderOrder={xray?35:0}><meshStandardMaterial color="#303B36" metalness={.65} roughness={.58}/></RoundedBox>
      {Array.from({length:7},(_,j)=><mesh key={j} position={[(j-3)*.07,.225,0]} renderOrder={xray?35:0}><boxGeometry args={[.012,.008,.56]}/><meshStandardMaterial color="#56605A" metalness={.55} roughness={.55} depthTest/></mesh>)}
      {[-.14,.14].map(z=><mesh key={z} position={[0,.235,z]} renderOrder={xray?36:0}><boxGeometry args={[.11,.012,.02]}/><meshStandardMaterial color="#747B72" metalness={.7} roughness={.45} depthTest/></mesh>)}
    </group>)}
    {/* Baffled tee inlet/outlet and a submerged inter-chamber link. */}
    {[-1,1].map(sign=><group key={`tee${sign}`} position={[sign*(L/2-.24),sign<0?ports.inlet.y:ports.outlet.y,0]}>
      <mesh position={[0,-.15,0]} renderOrder={xray?35:0}><cylinderGeometry args={[.06,.06,.8,32]}/><meshPhysicalMaterial color="#A9ABA2" roughness={.32} clearcoat={.2} depthTest/></mesh>
      <mesh position={[sign*.15,0,0]} rotation={[0,0,Math.PI/2]} renderOrder={xray?35:0}><cylinderGeometry args={[.06,.06,.36,32]}/><meshPhysicalMaterial color="#A9ABA2" roughness={.32} depthTest/></mesh>
      <mesh position={[sign*.24,0,0]} rotation={[0,0,Math.PI/2]} renderOrder={xray?36:0}><cylinderGeometry args={[.085,.085,.035,32]}/><meshStandardMaterial color="#414A43" roughness={.65} depthTest/></mesh>
    </group>)}
    <mesh position={[L/6,-1,-.0]} rotation={[0,0,Math.PI/2]} renderOrder={xray?35:0}><cylinderGeometry args={[.075,.075,.27,32]}/><meshStandardMaterial color="#777F74" roughness={.45} depthTest/></mesh>
    <group name="Vent_connection_stub_pending_roof_route" position={[-1.14,0,-.57]}><mesh position={[0,.14,0]} renderOrder={xray?35:0}><cylinderGeometry args={[.04,.04,.24,24]}/><meshStandardMaterial color="#92998D" roughness={.5} depthTest/></mesh><mesh position={[0,.27,0]} renderOrder={xray?36:0}><cylinderGeometry args={[.065,.065,.025,32]}/><meshStandardMaterial color="#4B554C" metalness={.25} roughness={.5} depthTest/></mesh></group>
  </group>
}

export function DrainReducers({storage}:{storage:DrainStorage}) {
  const maps=useWaterPbr('plastic')
  return <group name="Stack_to_common_collector_reducers">{storage.reducers.map((r,i)=><group key={i} position={[r.at.x/1000,r.at.z/1000-.025,-r.at.y/1000]}>
    <mesh><cylinderGeometry args={[r.fromMm/2000+.004,r.toMm/2000+.004,.14,32]}/><meshPhysicalMaterial {...maps} color="#8A9187" roughness={.36} normalScale={new Vector2(.18,.18)}/></mesh>
    {[-1,1].map(sign=><mesh key={sign} position={[0,sign*.07,0]}><cylinderGeometry args={[(sign>0?r.fromMm:r.toMm)/2000+.009,(sign>0?r.fromMm:r.toMm)/2000+.009,.025,32]}/><meshPhysicalMaterial {...maps} color="#92988D" roughness={.35} normalScale={new Vector2(.18,.18)}/></mesh>)}
  </group>)}</group>
}
