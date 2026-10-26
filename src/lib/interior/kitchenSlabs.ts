import type {DressBox} from '../three/dressRoom.ts'
type Rect={x0:number;x1:number;z0:number;z1:number}
const rectangle=(b:DressBox):Rect=>({x0:b.pos[0]-b.size[0]/2,x1:b.pos[0]+b.size[0]/2,z0:b.pos[2]-b.size[2]/2,z1:b.pos[2]+b.size[2]/2})
function subtract(a:Rect,b:Rect):Rect[]{
 const x0=Math.max(a.x0,b.x0),x1=Math.min(a.x1,b.x1),z0=Math.max(a.z0,b.z0),z1=Math.min(a.z1,b.z1)
 if(x1-x0<1e-7||z1-z0<1e-7)return [a]
 return [{...a,x1:x0},{...a,x0:x1},{x0,x1,z0:a.z0,z1:z0},{x0,x1,z0:z1,z1:a.z1}].filter(r=>r.x1-r.x0>1e-6&&r.z1-r.z0>1e-6)
}
/** Finish the already-placed slabs; never add a new run or move a fixture.
 * Sink strips are preserved. Corner overlaps are removed once, with world UVs
 * keeping the same selected stone texture across all resulting pieces. */
export function refineKitchenSlabs(boxes:DressBox[],topIds:string[]):DressBox[]{
 const occupied:{rect:Rect;y:number}[]=[],result:DressBox[]=[]
 for(const box of boxes){
  if(!topIds.some(id=>box.id===id||box.id.startsWith(id+'-'))){result.push(box);continue}
  let regions=[rectangle(box)]
  for(const previous of occupied)if(Math.abs(previous.y-box.pos[1])<.001)regions=regions.flatMap(r=>subtract(r,previous.rect))
  regions.forEach((r,i)=>{
   occupied.push({rect:r,y:box.pos[1]})
   result.push({...box,id:regions.length===1?box.id:`${box.id}-slab-${i}`,pos:[(r.x0+r.x1)/2,box.pos[1],(r.z0+r.z1)/2],size:[r.x1-r.x0,box.size[1],r.z1-r.z0],bevel:.0015,look:{...box.look,finish:'worktop'}})
  })
 }
 return result
}
