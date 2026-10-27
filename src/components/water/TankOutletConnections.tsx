import {Quaternion,Vector3} from 'three'
import {planToThreeGlb} from '@/lib/solar/coordinates.ts'
import type {VillaPlumbing} from '@/lib/plumbing/villaPlumbing.ts'

/** Visible union/isolating-valve assemblies on existing connected tank ports. */
export function TankOutletConnections({home,xray,onSelect}:{home:VillaPlumbing;xray:boolean;onSelect:()=>void}) {
  return <group name="Roof_tank_outlet_unions_and_valves" onClick={e=>{e.stopPropagation();onSelect()}}>
    {home.pipes.filter(p=>p.id.startsWith('tank-port:')).map(pipe=>{
      const a=planToThreeGlb(pipe.points[0]),b=planToThreeGlb(pipe.points[1]),start=new Vector3(a.x,a.y,a.z),end=new Vector3(b.x,b.y,b.z),direction=end.clone().sub(start).normalize(),r=pipe.diameterMm/2000
      const at=start.clone().addScaledVector(direction,Math.min(.11,start.distanceTo(end)*.35)),q=new Quaternion().setFromUnitVectors(new Vector3(0,1,0),direction)
      return <group key={pipe.id} position={at} quaternion={q}>
        <mesh renderOrder={xray?36:0}><cylinderGeometry args={[r*1.45,r*1.45,.09,32]}/><meshPhysicalMaterial color="#B7AA81" metalness={.58} roughness={.32} depthTest={!xray}/></mesh>
        {[-.055,.055].map(y=><mesh key={y} position={[0,y,0]} renderOrder={xray?36:0}><cylinderGeometry args={[r*1.7,r*1.7,.035,8]}/><meshPhysicalMaterial color="#C5C5B9" roughness={.3} depthTest={!xray}/></mesh>)}
        <mesh position={[r*1.5,0,0]} rotation={[0,0,Math.PI/2]} renderOrder={xray?37:0}><cylinderGeometry args={[.008,.008,.045,12]}/><meshStandardMaterial color="#747C72" metalness={.65} roughness={.3} depthTest={!xray}/></mesh>
        <mesh position={[r*1.5+.025,.04,0]} renderOrder={xray?37:0}><boxGeometry args={[.012,.12,.025]}/><meshPhysicalMaterial color="#455D4A" roughness={.4} depthTest={!xray}/></mesh>
      </group>
    })}
  </group>
}
