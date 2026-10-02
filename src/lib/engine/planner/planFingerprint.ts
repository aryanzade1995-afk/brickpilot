import type { Design } from '../types.ts'
import type { Rect } from '../../geometry.ts'
import { fnv } from '../massing/rng.ts'

export type PlanFingerprint={version:1;key:string;wingCount:number;plateFamily:string;
 livingPosition:number[];stairPosition:number[];masterPosition:number[];
 adjacencyHash:string;footprintSignature:string;vector:number[]}
const hash=(s:string)=>fnv(s).toString(16).padStart(8,'0')
const rounded=(n:number)=>Math.round(n*100000)/100000
/** Pure plan identity. No material, colour, facade, seed or decoration input. */
export function planFingerprint(design:Design):PlanFingerprint{
 const {plot}=design.model
 const normalize=(r:Rect)=>[r.x/plot.width,r.y/plot.depth,r.w/plot.width,r.h/plot.depth].map(rounded)
 const position=(id:string,semantic=false)=>{
  const floor=design.floors.find(f=>f.rooms.some(r=>semantic?r.semanticId===id:r.id===id))
  const room=floor?.rooms.find(r=>semantic?r.semanticId===id:r.id===id)
  return room?[rounded((room.rect.x+room.rect.w/2)/plot.width),rounded((room.rect.y+room.rect.h/2)/plot.depth),
   rounded(floor!.level/Math.max(1,design.floors.length-1))]:[0,0,0]
 }
 const master=design.floors.flatMap(f=>f.rooms).find(r=>r.semanticId.endsWith('_MASTER_BED'))
 const livingPosition=position(design.floors[0].rooms.some(r=>r.id==='living')?'living':'livingDining'),
  stairPosition=position('stair'),masterPosition=position(master?.semanticId??'',true)
 const graph=design.floors.map(f=>f.openings.filter(o=>o.kind!=='window'&&o.rooms).map(o=>o.rooms!.map(id=>id??'outside').sort().join('~')).sort())
 const footprint=design.floors.map(f=>({level:f.level,blocks:f.footprint.map(normalize).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))),
  voids:(f.doubleHeightVoids??[]).map(v=>normalize(v.rect)),verandahs:f.rooms.filter(r=>r.id.startsWith('verandah')).map(r=>normalize(r.rect))}))
 const footprintSignature=hash(JSON.stringify(footprint)),adjacencyHash=hash(JSON.stringify(graph))
 const wingCount=design.massingType==='twin-wing'?2:design.massingType==='courtyard-ring'?4:
  ['u-wing','pavilion'].includes(design.massingType)?3:['l-shape','courtyard'].includes(design.massingType)?2:1
 const fields={version:1 as const,wingCount,plateFamily:design.massingType,livingPosition,stairPosition,masterPosition,adjacencyHash,footprintSignature}
 // A fixed-size normalized vector supports comparisons as well as exact deduplication.
 const vector=[wingCount/4,...livingPosition,...stairPosition,...masterPosition,
  ...design.floors.slice(0,4).map(f=>rounded(f.footprint.reduce((n,r)=>n+r.w*r.h,0)/(plot.width*plot.depth)))]
 while(vector.length<14)vector.push(0)
 return {...fields,key:hash(JSON.stringify(fields)),vector}
}
