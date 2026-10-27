import { fixtureWasteConnection } from '@/lib/water/fixtureDrainage.ts'
import type { DrainageOpening } from '@/lib/water/drainageContinuity.ts'
import {useEffect,useMemo,useState} from 'react'
import {Html,Line} from '@react-three/drei'
import {useThree} from '@react-three/fiber'
import {Group,Mesh,TubeGeometry,Vector2} from 'three'
import {instantiateInteriorModel} from '@/lib/three/interiorModelAssets.ts'
import {FIXTURE_NAMES,type DrainFixture3D,type FixtureDrainageScene} from '@/lib/water/fixtureDrainage.ts'
import {planToThreeGlb} from '@/lib/solar/coordinates.ts'
import {waterPipeCurve} from '@/lib/water/pipeCurve.ts'
import type {ServicePoint} from '@/lib/plumbing/villaPlumbing.ts'
import {useWaterPbr} from './useWaterPbr.ts'
import {PipeWater} from './PipeWater.tsx'

const world=(p:ServicePoint)=>{const w=planToThreeGlb(p);return [w.x,w.y,w.z] as [number,number,number]}
const ownedMaterials=(group:Group)=>{group.traverse(o=>{if(o instanceof Mesh)for(const m of Array.isArray(o.material)?o.material:[o.material])m.dispose()})}
function FixtureModel({fixture}:{fixture:DrainFixture3D}){
  const [object,setObject]=useState<Group|null>(null),invalidate=useThree(s=>s.invalidate)
  useEffect(()=>{
    let disposed=false,loaded:Group|undefined
    if(fixture.model)instantiateInteriorModel(fixture.model).then(group=>{if(disposed){ownedMaterials(group);return}loaded=group;setObject(group);invalidate()}).catch(()=>{if(!disposed){setObject(null);invalidate()}})
    return()=>{disposed=true;if(loaded)ownedMaterials(loaded)}
  },[fixture.model,invalidate])
  if(object)return <primitive object={object} dispose={null}/>
  const w=fixture.widthMm/1000,d=fixture.depthMm/1000
  return <group position={world(fixture.point)} rotation={[0,fixture.rotation,0]}>
    {fixture.kind==='floor_drain'||fixture.kind==='shower'?<>
      <mesh position={[0,.012,0]}><boxGeometry args={[w,.024,d]}/><meshStandardMaterial color={fixture.kind==='shower'?'#DEDAD0':'#757D78'} metalness={fixture.kind==='shower'?.05:.65} roughness={.3}/></mesh>
      {Array.from({length:7},(_,i)=><mesh key={i} position={[(i-3)*.014,.027,0]}><boxGeometry args={[.006,.004,.11]}/><meshStandardMaterial color="#242F2B" roughness={.5}/></mesh>)}
      {fixture.kind==='shower'&&<><mesh position={[0,1.1,-d/2+.03]}><cylinderGeometry args={[.012,.012,1.9,10]}/><meshStandardMaterial color="#A7B1AC" metalness={.85} roughness={.2}/></mesh><mesh position={[0,2.02,-d/2+.16]}><cylinderGeometry args={[.1,.1,.018,20]}/><meshStandardMaterial color="#B4BDB8" metalness={.85} roughness={.2}/></mesh></>}
    </>:<>
      <mesh position={[0,fixture.kind==='toilet'?.25:.72,0]} scale={[w/2,fixture.kind==='toilet'?.28:.12,d/2]}><sphereGeometry args={[1,20,12]}/><meshStandardMaterial color="#E8E4D9" roughness={.24}/></mesh>
      <mesh position={[0,.3,0]}><cylinderGeometry args={[.09,.13,.5,16]}/><meshStandardMaterial color="#DDD8CE" roughness={.28}/></mesh>
    </>}
  </group>
}
function BranchPipe({points,diameter,selected,animate}:{points:ServicePoint[];diameter:number;selected:boolean;animate:boolean}){
  const maps=useWaterPbr('plastic')
  const geometry=useMemo(()=>{const path=waterPipeCurve(points,diameter);return path.getLength()>0?new TubeGeometry(path,Math.min(180,Math.max(12,points.length*14)),diameter/2000,10,false):null},[points,diameter])
  useEffect(()=>()=>geometry?.dispose(),[geometry])
  return geometry?<><mesh geometry={geometry} dispose={null}><meshPhysicalMaterial {...maps} color={selected?'#B58E43':'#B9B7A8'} normalScale={new Vector2(.15,.15)} metalness={.06} roughness={.33} clearcoat={.25} transparent={animate} opacity={animate?.48:1} depthWrite={!animate}/></mesh>{animate&&<PipeWater points={points} diameterMm={diameter} waste/>}</>:null
}
/** Fixture and branch positions are projections of the 2D design. No routing,
 * architectural holes or hydraulic assumptions are created in this renderer. */
export function FixtureDrainageLayer({scene,room,selected,onSelect,labels,animate,trace,openings=[],system='drain',xray=false,showFixtures=true}:{showFixtures?:boolean;xray?:boolean;system?:'drain'|'water';openings?:DrainageOpening[];scene:FixtureDrainageScene;room:string;selected:string;onSelect:(id:string)=>void;labels:boolean;animate:boolean;trace:ServicePoint[][]}){
  const fixtures=scene.fixtures.filter(f=>(system==='drain'||f.kind!=='floor_drain')&&(room==='all'||`${f.floorId}:${f.roomId}`===room))
  return <group name="Shared_2D_Drainage_Fixtures">
    {fixtures.map(f=>{
      const active=selected===`fixture:${f.key}`,branch=f.branch
      // Traps are illustrative symbols. WCs retain their integrated trap;
      // no second external U trap is ever added to a toilet.
      const start=branch?.points[0],trap=fixtureWasteConnection(f)
      return <group key={f.key} onClick={e=>{e.stopPropagation();onSelect(`fixture:${f.key}`)}}>
        {showFixtures&&<FixtureModel fixture={f}/>}
        {system==='drain'&&branch&&(branch.blocked?<Line points={branch.points.map(world)} color={active?'#AA763A':'#9B8A72'} dashed dashSize={.12} gapSize={.08} lineWidth={active?2.5:1.5}/>:<BranchPipe points={branch.points} diameter={branch.diameterMm} selected={active} animate={animate&&branch.connected&&(!selected||active)}/>)}
        {system==='drain'&&start&&<BranchPipe points={trap} diameter={f.kind==='toilet'?branch!.diameterMm:Math.min(branch!.diameterMm,50)} selected={active} animate={false}/>}
        {(labels&&room!=='all'||active)&&<Html position={world({...f.point,z:f.point.z+1050})} center zIndexRange={[8,0]}><button aria-label={`${FIXTURE_NAMES[f.kind]}, ${f.roomName}, ${f.floorName}`} onClick={()=>onSelect(`fixture:${f.key}`)} className={`min-h-11 rounded-lg border bg-bg/95 px-2 text-[10px] text-ink shadow-sm ${active?'border-accent':'border-line'}`}>{FIXTURE_NAMES[f.kind]}</button></Html>}
        {active&&<mesh position={world({...f.point,z:f.point.z+30})} rotation={[-Math.PI/2,0,0]}><ringGeometry args={[.36,.39,40]}/><meshBasicMaterial color="#BD9651" transparent opacity={.8} depthWrite={false}/></mesh>}
      </group>
    })}
    {openings.map(o=><group key={o.id} position={world(o.point)} rotation={o.axis==='z'?[-Math.PI/2,0,0]:o.axis==='x'?[0,Math.PI/2,0]:[0,0,0]}><mesh><torusGeometry args={[.09,.009,6,20]}/><meshStandardMaterial color="#A17C43" metalness={.35} roughness={.4}/></mesh>{labels&&<Html center zIndexRange={[5,0]}><span className="whitespace-nowrap rounded border border-line bg-bg/95 px-2 py-1 text-[9px] text-ink">{o.kind==='fixture-drop'?'Proposed drop':'Proposed sleeve'}</span></Html>}</group>)}
    {system==='drain'&&scene.collectors.map(pipe=>pipe.blocked?<Line key={pipe.id} points={pipe.points.map(world)} color="#9B8A72" dashed dashSize={.14} gapSize={.1} lineWidth={1.5}/>:<BranchPipe key={pipe.id} points={pipe.points} diameter={pipe.diameterMm} selected={false} animate={false}/>)}
    {system==='drain'&&scene.destinations.map(node=><group key={node.id} position={world(node.point)}><mesh><boxGeometry args={[.4,.3,.4]}/><meshStandardMaterial color="#8B8B7C" roughness={.85}/></mesh>{labels&&<Html center><span className="whitespace-nowrap rounded border border-line bg-bg/95 px-2 py-1 text-[10px] text-ink">{node.name}</span></Html>}</group>)}
    {trace.map((points,i)=><group key={i}><Line points={points.map(world)} color="#B88C40" lineWidth={2.5} depthTest={!xray} renderOrder={xray?44:3}/>{animate&&<PipeWater points={points} diameterMm={system==='water'?15:32} xray={xray} waste={system==='drain'}/>}</group>)}
  </group>
}
