/** Animation timing only. Never a storage calculation, measured level or flow rate. */
export function tankFillPreview(activeSeconds:number,arrivalSeconds:number) {
  if(!Number.isFinite(activeSeconds)||activeSeconds<0||!Number.isFinite(arrivalSeconds)||arrivalSeconds<0)throw new RangeError('Preview times must be finite and non-negative.')
  return Math.min(.9,Math.max(0,activeSeconds-arrivalSeconds)/24*.9)
}

/** Same illustrative travel speed and first-flush delay as the pipe-water layer. */
export function tankArrivalSeconds(points:readonly {x:number;y:number;z:number}[]) {
  let length=0
  for(let i=0;i<points.length;i++){
    if(![points[i].x,points[i].y,points[i].z].every(Number.isFinite))throw new RangeError('Pipe positions must be finite millimetres.')
    if(i)length+=Math.hypot(points[i].x-points[i-1].x,points[i].y-points[i-1].y,points[i].z-points[i-1].z)/1000
  }
  return 4+length/1.8
}
