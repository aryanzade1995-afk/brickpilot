import type { PlacedRoom } from '../types.ts'
import type { Column } from './types.ts'
import type { Rect } from '../../geometry.ts'

export type DoubleHeightVoid = {rect:Rect;sourceRoomId:string;roomId:string}
export const DOUBLE_HEIGHT_LIMITS={minimumMm:2400,maximumSpanMm:6000,minimumGalleryMm:1800,guardHeightMm:1100} as const

/** Only cut an unrequired circulation gallery above living space. Never remove
 * an occupied room, a stair, an ensuite or a structural column. A rectangular
 * remainder keeps the existing room and door placers authoritative. */
export function createDoubleHeightGallery(rooms:PlacedRoom[],below:PlacedRoom[],columns:Column[],prefix:string):DoubleHeightVoid|null{
 const living=below.find(r=>r.id==='living'||r.id==='livingDining')
 if(!living)return null
 for(const gallery of rooms.filter(r=>r.id.startsWith('wingGallery')&&r.rect.y===living.rect.y&&r.rect.h===living.rect.h)){
  const a=gallery.rect,b=living.rect
  const left=Math.max(a.x,b.x),right=Math.min(a.x+a.w,b.x+b.w),width=right-left
  if(width<DOUBLE_HEIGHT_LIMITS.minimumMm||width>DOUBLE_HEIGHT_LIMITS.maximumSpanMm||a.h>DOUBLE_HEIGHT_LIMITS.maximumSpanMm)continue
  const onLeft=left===a.x,onRight=right===a.x+a.w
  if((!onLeft&&!onRight)||a.w-width<DOUBLE_HEIGHT_LIMITS.minimumGalleryMm)continue
  const rect={x:left,y:a.y,w:width,h:a.h}
  if(columns.some(c=>c.at.x>left&&c.at.x<right&&c.at.y>a.y&&c.at.y<a.y+a.h))continue
  gallery.rect={...a,x:onLeft?right:a.x,w:a.w-width};gallery.area=gallery.rect.w*gallery.rect.h/1e6
  const roomId='doubleHeightLiving'
  rooms.push({id:roomId,semanticId:`${prefix}_DOUBLE_HEIGHT_VOID`,name:'Open to living below',zone:'outdoor',
   rect,area:rect.w*rect.h/1e6,outdoor:true,wantsWindow:false})
  return {rect,roomId,sourceRoomId:living.semanticId}
 }
 return null
}
