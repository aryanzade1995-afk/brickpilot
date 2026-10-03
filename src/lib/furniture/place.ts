import { fnv, makeRng } from '../engine/massing/rng.ts'
import { FURNITURE_LIMITS as L, type FurnitureItem } from './catalogue.ts'
export type Rectangle = { x:number; y:number; width:number; depth:number }
export type PlacedItem = FurnitureItem & Rectangle & { rotation:number; access:Rectangle }
export type FurnitureFit = { placed:PlacedItem[]; dropped:FurnitureItem[]; verdict:'Comfortable'|'Tight'|'Too small'; reason:string; reducedClearance:boolean; door:Rectangle; window:Rectangle }
export const overlaps = (a:Rectangle,b:Rectangle)=>a.x<b.x+b.width-1e-6&&a.x+a.width>b.x+1e-6&&a.y<b.y+b.depth-1e-6&&a.y+a.depth>b.y+1e-6
export function placeFurniture(roomId:string,width:number,depth:number,items:readonly FurnitureItem[]):FurnitureFit {
 const door={x:0,y:depth-L.doorWidth,width:L.doorWidth,depth:L.doorWidth},window={x:(width-L.windowWidth)/2,y:0,width:L.windowWidth,depth:L.windowApproach}
 const inside=(r:Rectangle)=>r.x>=-1e-6&&r.y>=-1e-6&&r.x+r.width<=width+1e-6&&r.y+r.depth<=depth+1e-6
 const sorted=[...items].sort((a,b)=>Number(b.essential)-Number(a.essential)||b.width*b.depth-a.width*a.depth||a.id.localeCompare(b.id))
 function run(tight:boolean){
  const rng=makeRng(fnv(roomId),'furniture'),side=tight?L.tightSide:L.bedSide,front=tight?L.tightFront:L.walkway
  let attempts=0
  const candidates=(item:FurnitureItem)=>{
   const result:PlacedItem[]=[]
   for(const rotation of (item.headboard?[90,180]:[0,90,180,270])){
    const w=rotation%180?item.depth:item.width,d=rotation%180?item.width:item.depth
    for(let xi=0;xi<=Math.floor((width-w)/L.grid+1e-6);xi++)for(let yi=0;yi<=Math.floor((depth-d)/L.grid+1e-6);yi++){
     const x=xi*L.grid,y=yi*L.grid
     if(item.headboard&&((rotation===90&&Math.abs(x+w-width)>L.grid)||(rotation===180&&Math.abs(y+d-depth)>L.grid)))continue
     let access:Rectangle={x,y,width:w,depth:d}
     if(item.clearance==='bed')access=rotation%180?{x,y:y-side,width:w,depth:d+side*2}:{x:x-side,y,width:w+side*2,depth:d}
     else if(item.clearance!=='none'){
      const gap=item.clearance==='wardrobe'&&!tight?L.wardrobeFront:front
      access=rotation===0?{x,y,width:w,depth:d+gap}:rotation===180?{x,y:y-gap,width:w,depth:d+gap}:rotation===90?{x:x-gap,y,width:w+gap,depth:d}:{x,y,width:w+gap,depth:d}
     }
     const p={...item,x,y,width:w,depth:d,rotation,access}
     if(inside(access)&&!overlaps(p,door)&&!overlaps(p,window))result.push(p)
    }
   }
   // Wall placements first, seeded tie ordering. No random calls outside this stream.
   return result.map(p=>({p,rank:Math.min(p.x,p.y,width-p.x-p.width,depth-p.y-p.depth)+rng.next()*0.01})).sort((a,b)=>a.rank-b.rank).map(v=>v.p)
  }
  const all=sorted.map(item=>({item,positions:candidates(item)})),essential=all.filter(v=>v.item.essential)
  const compatible=(p:PlacedItem,list:PlacedItem[])=>list.every(q=>!overlaps(p,q.access)&&!overlaps(p.access,q))
  const solve=(i:number,placed:PlacedItem[]):PlacedItem[]|null=>{
   if(i===essential.length)return placed
   for(const p of essential[i].positions){if(++attempts>L.maxSearch)return null;if(compatible(p,placed)){const found=solve(i+1,[...placed,p]);if(found)return found}}
   return null
  }
  let placed=solve(0,[])
  if(!placed)return null
  const dropped:FurnitureItem[]=[]
  for(const {item,positions} of all.filter(v=>!v.item.essential)){const p=positions.find(p=>compatible(p,placed!));if(p)placed.push(p);else dropped.push(item)}
  return {placed,dropped}
 }
 const full=run(false),tight=full?null:run(true),layout=full??tight
 const placed=layout?.placed??[],dropped=layout?.dropped??sorted
 const optional=sorted.filter(i=>!i.essential).length,ratio=optional?(optional-dropped.filter(i=>!i.essential).length)/optional:1
 const verdict=!layout?'Too small':!full||ratio<L.comfortableOptionalRatio?'Tight':'Comfortable'
 const reason=!layout?'Essential furniture and safe door access cannot fit.':dropped.length?`${placed.filter(i=>i.essential).map(i=>i.name).join(', ')} fit. No space for ${dropped.map(i=>i.name.toLowerCase()).join(', ')}.`:!full?'Essential furniture fits with reduced clearances.':'All selected furniture fits with comfortable clearances.'
 return {placed,dropped,verdict,reason,reducedClearance:!!tight,door,window}
}
