import {validateRawSurvey,type RawSurvey} from './digitizer.ts'
import type {Survey} from './survey.ts'

export function rotateDrawing90(raw:RawSurvey):RawSurvey{
 const point=(p:{x:number;y:number})=>({x:raw.imageHeight-p.y,y:p.x})
 return validateRawSurvey({...raw,imageWidth:raw.imageHeight,imageHeight:raw.imageWidth,
  columns:raw.columns?.map(c=>({...c,...point(c)})),elements:{
   rooms:raw.elements.rooms.map(r=>({...r,box:{x:raw.imageHeight-r.box.y-r.box.h,y:r.box.x,w:r.box.h,h:r.box.w}})),
   walls:raw.elements.walls.map(w=>({...w,a:point(w.a),b:point(w.b)})),
   openings:raw.elements.openings.map(o=>({...o,at:point(o.at),orient:o.orient==='h'?'v':'h',swing:o.orient==='h'?-(o.swing??1):o.swing})),
   dimensions:raw.elements.dimensions.map(d=>({...d,a:point(d.a),b:point(d.b)}))}})
}
/** Put an explicitly accepted snapping result back into the same image frame. */
export function surveyBackToDrawing(survey:Survey,raw:RawSurvey,scale:number):RawSurvey{
 const xs=raw.elements.rooms.map(r=>r.box.x).concat(raw.elements.walls.flatMap(w=>[w.a.x,w.b.x]),raw.elements.openings.map(o=>o.at.x))
 const ys=raw.elements.rooms.map(r=>r.box.y).concat(raw.elements.walls.flatMap(w=>[w.a.y,w.b.y]),raw.elements.openings.map(o=>o.at.y))
 const x=xs.length?Math.min(...xs):0,y=ys.length?Math.min(...ys):0,point=(p:{x:number;y:number})=>({x:p.x/scale+x,y:p.y/scale+y})
 return validateRawSurvey({...raw,elements:{...raw.elements,
  rooms:survey.rooms.map((r,i)=>({...raw.elements.rooms[i],id:raw.elements.rooms[i]?.id??`room-${i}`,name:r.name,type:r.type,box:{...point(r),w:r.w/scale,h:r.h/scale},stairStartSide:r.stairStartSide,confidence:1})),
  walls:survey.walls.map((w,i)=>({id:raw.elements.walls[i]?.id??`wall-${i}`,a:point(w.a),b:point(w.b),kind:w.kind,thicknessPx:(w.thicknessMm??115)/1000/scale,confidence:1})),
  openings:survey.openings.map((o,i)=>({id:raw.elements.openings[i]?.id??`opening-${i}`,kind:o.kind,orient:o.orient,at:point(o),widthPx:(o.widthM??.9)/scale,swing:o.swing,leaf:o.leaf,headM:o.headM??undefined,sillM:o.sillM??undefined,confidence:1}))}})
}
