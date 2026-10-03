export type FurnitureKind = 'master' | 'kids' | 'bedroom' | 'living' | 'dining' | 'kitchen' | 'bathroom' | 'study' | 'other'
export type FurnitureItem = { id: string; name: string; width: number; depth: number; height: number; essential: boolean; clearance: 'bed' | 'wardrobe' | 'front' | 'none'; headboard?: boolean }
const item = (id: string, name: string, width: number, depth: number, height: number, essential: boolean, clearance: FurnitureItem['clearance'] = 'front', headboard = false): FurnitureItem => ({ id, name, width, depth, height, essential, clearance, headboard })
export const FURNITURE = {
 doubleBed: item('double-bed','Double bed',1.6,2,0.55,true,'bed',true), singleBed: item('single-bed','Single bed',0.9,1.9,0.55,true,'bed',true),
 wardrobe: item('wardrobe','Wardrobe',1.8,0.6,2.1,true,'wardrobe'), desk: item('desk','Desk',1.2,0.55,0.75,false), sideTable: item('side-table','Side table',0.4,0.4,0.5,false,'none'),
 sofa: item('sofa','Sofa',2.1,0.9,0.85,true), tv: item('tv','TV unit',0.4,1.6,0.6,false,'none'), coffee: item('coffee','Coffee table',0.6,1.1,0.45,false,'none'),
 table: item('dining-table','Dining table',1.2,0.8,0.75,true), chair: item('chair','Dining chair',0.45,0.45,0.85,true,'none'),
 counter: item('counter','Kitchen counter',1.8,0.6,0.9,true), fridge: item('fridge','Fridge',0.65,0.7,1.8,true),
 wc: item('wc','WC',0.4,0.7,0.75,true), basin: item('basin','Basin',0.55,0.45,0.85,true), shower: item('shower','Shower',0.8,0.8,0.05,true,'none'),
} satisfies Record<string,FurnitureItem>
export function furnitureFor(kind: FurnitureKind, occupants = 1, starred = false): FurnitureItem[] {
 const f=FURNITURE
 const duplicate=(v:FurnitureItem,n:number)=>Array.from({length:n},(_,i)=>({...v,id:`${v.id}-${i+1}`,name:n>1?`${v.name} ${i+1}`:v.name}))
 switch(kind){
  case 'master': case 'bedroom': return [...duplicate(occupants>1?f.doubleBed:f.singleBed,Math.ceil(occupants/2)),f.wardrobe,{...f.desk,essential:starred},f.sideTable]
  case 'kids': return [...duplicate(f.singleBed,occupants),f.wardrobe,{...f.desk,essential:starred}]
  case 'living': return [f.sofa,f.tv,f.coffee,...(starred?[{...f.desk,essential:false}]:[])]
  case 'dining': return [{...f.table,width:Math.max(f.table.width,Math.ceil(occupants/2)*0.6)},...duplicate(f.chair,occupants)]
  case 'kitchen': return [f.counter,f.fridge,...(starred?[{...f.counter,id:'extra-counter',name:'Extra counter',essential:false}]:[])]
  case 'bathroom': return [f.wc,f.basin,f.shower]
  case 'study': return [{...f.desk,essential:true}]
  default: return []
 }
}
export const FURNITURE_LIMITS = { grid:0.1, height:2.8, bedSide:0.6, wardrobeFront:0.9, walkway:0.9, tightSide:0.45, tightFront:0.6,
 doorWidth:0.9, windowWidth:1.2, windowApproach:0.35, comfortableOptionalRatio:0.75, debounceMs:200, maxSearch:12000 } as const
