import { useEffect, useMemo } from 'react'
import { CylinderGeometry } from 'three'
import { planToThreeGlb } from '@/lib/solar/coordinates.ts'
import type { RainCollection } from '@/lib/water/simpleSystem.ts'

/** Visible concept housings, not a certified product or water-quality result. */
export function RainFilters({rain,xray,selected,onSelect}:{rain:RainCollection;xray:boolean;selected:boolean;onSelect:()=>void}) {
  const cartridge=useMemo(()=>{
    const geometry=new CylinderGeometry(.08,.08,.19,48,1),p=geometry.attributes.position
    for(let i=0;i<p.count;i++){const x=p.getX(i),z=p.getZ(i);if(Math.hypot(x,z)<.01)continue;const factor=Math.round(Math.atan2(z,x)/(Math.PI*2)*48)%2===0?1:.86;p.setXYZ(i,x*factor,p.getY(i),z*factor)}
    geometry.computeVertexNormals();return geometry
  },[])
  useEffect(()=>()=>cartridge.dispose(),[cartridge])
  if(!rain.treatment)return null
  return <group name="Rainwater_Filters_Before_Storage" onClick={e=>{e.stopPropagation();onSelect()}}>
    {rain.treatment.stages.filter(s=>s.kind==='coarse-filter'||s.kind==='sediment-cartridge').map(stage=>{const p=planToThreeGlb(stage.position);return <group key={stage.id} position={[p.x,p.y,p.z]} name={stage.kind}>
      <mesh renderOrder={xray?30:0}><cylinderGeometry args={[.13,.12,.24,24]}/><meshPhysicalMaterial color={selected?'#C8A96C':'#B8CBBD'} transparent opacity={.42} roughness={.25} metalness={0} depthWrite={false} depthTest={!xray}/></mesh>
      <mesh geometry={cartridge} renderOrder={xray?29:0}><meshStandardMaterial color={stage.kind==='coarse-filter'?'#AA9F7B':'#EFE6CB'} roughness={.85} depthTest={!xray}/></mesh>
      {[-.13,.13].map(y=><mesh key={y} position={[0,y,0]} renderOrder={xray?31:0}><cylinderGeometry args={[.14,.14,.035,24]}/><meshStandardMaterial color={selected?'#A68143':'#526B58'} roughness={.4} depthTest={!xray}/></mesh>)}
      <mesh position={[.138,.01,0]} rotation={[0,0,Math.PI/2]}><cylinderGeometry args={[.016,.016,.022,8]}/><meshStandardMaterial color="#9C9581" metalness={.6} roughness={.35}/></mesh>
    </group>})}
  </group>
}
