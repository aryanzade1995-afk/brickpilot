import {useMemo} from 'react'
import {Quaternion,Vector3} from 'three'
import {planToThreeGlb} from '@/lib/solar/coordinates.ts'
import type {ServicePoint,VillaPipe,PipeSegment} from '@/lib/plumbing/villaPlumbing.ts'
import {pipeConnectionParts} from '@/lib/water/pipeConnections.ts'
import {UtilityInstances3D,type UtilityInstance3D} from '@/components/utilities/UtilityInstances3D.tsx'

const ignore=()=>{}
/** Shared instanced sockets, end caps and valve hardware. No new canvas,
 * per-cell meshes, architecture cache changes or per-frame routing. */
export function PipeConnectionHardware({runs,segments=[],valves=[]}:{runs:Pick<VillaPipe,'system'|'diameterMm'|'points'>[];segments?:PipeSegment[];valves?:ServicePoint[]}){
  const items=useMemo(()=>pipeConnectionParts(runs,segments).map(p=>{
    const w=planToThreeGlb(p.point),d=planToThreeGlb(p.direction),q=new Quaternion().setFromUnitVectors(new Vector3(0,1,0),new Vector3(d.x,d.y,d.z).normalize())
    return {position:[w.x,w.y,w.z],quaternion:q.toArray(),scale:[p.diameterMm/2000,p.lengthMm/1000,p.diameterMm/2000],color:p.system==='water'?'#C8C4B4':'#8B9388',selection:'',faded:false} as UtilityInstance3D
  }),[runs,segments])
  const valveBodies=useMemo(()=>valves.map(p=>{const w=planToThreeGlb(p);return {position:[w.x,w.y,w.z],scale:[.023,.07,.023],color:'#AC9D73',selection:'',faded:false} as UtilityInstance3D}),[valves])
  const handles=useMemo(()=>valves.map(p=>{const w=planToThreeGlb(p);return {position:[w.x+.035,w.y,w.z],scale:[.075,.012,.022],color:'#4C6250',selection:'',faded:false} as UtilityInstance3D}),[valves])
  return <group name="Pipe_sockets_caps_and_isolation_valves"><UtilityInstances3D items={items} round physical interactive={false} radialSegments={20} onSelect={ignore}/><UtilityInstances3D items={valveBodies} round physical interactive={false} radialSegments={20} onSelect={ignore}/><UtilityInstances3D items={handles} physical interactive={false} onSelect={ignore}/></group>
}
