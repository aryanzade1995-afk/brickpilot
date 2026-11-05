import type { Rect } from '../../geometry.ts'

/** Exact disjoint uncovered rectangles; used for both planning and validation. */
export function uncoveredRects(source: Rect[], cover: Rect[]): Rect[] {
  return cover.reduce((pieces, c) => pieces.flatMap(r => {
    const x=Math.max(r.x,c.x), y=Math.max(r.y,c.y), right=Math.min(r.x+r.w,c.x+c.w), bottom=Math.min(r.y+r.h,c.y+c.h)
    if(right<=x||bottom<=y)return [r]
    return [{x:r.x,y:r.y,w:r.w,h:y-r.y},{x:r.x,y:bottom,w:r.w,h:r.y+r.h-bottom},
      {x:r.x,y,w:x-r.x,h:bottom-y},{x:right,y,w:r.x+r.w-right,h:bottom-y}].filter(p=>p.w>0&&p.h>0)
  }),source)
}
