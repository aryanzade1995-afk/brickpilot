import { plumbingSegments, type VillaPipe } from '../plumbing/villaPlumbing.ts'
import type { RainCollection } from './simpleSystem.ts'

/** Cut only the drawn tube inside filter housings. The canonical connected
 * route remains intact; water traverses the treatment chamber, not a visible
 * continuous bypass pipe running through its cartridge. */
export function filterDisplayPipes(rain:RainCollection) {
  const filters=rain.treatment?.stages.filter(s=>s.kind==='coarse-filter'||s.kind==='sediment-cartridge')??[],pipes:VillaPipe[]=[]
  for(const pipe of rain.downpipes.pipes)for(let i=1;i<pipe.points.length;i++){
    const a=pipe.points[i-1],b=pipe.points[i]
    let spans:[number,number][]=[[Math.min(a.z,b.z),Math.max(a.z,b.z)]]
    if(a.x===b.x&&a.y===b.y&&a.z!==b.z){
      for(const stage of filters.filter(s=>s.position.x===a.x&&s.position.y===a.y)){
        const lo=stage.position.z-140,hi=stage.position.z+140
        spans=spans.flatMap(([start,end])=>hi<=start||lo>=end?[[start,end]]:[...(lo>start?[[start,lo] as [number,number]]:[]),...(hi<end?[[hi,end] as [number,number]]:[])])
      }
      for(const [lo,hi] of spans)if(hi-lo>.01)pipes.push({...pipe,id:`${pipe.id}:${i}:${lo}`,points:a.z>b.z?[{...a,z:hi},{...b,z:lo}]:[{...a,z:lo},{...b,z:hi}]})
    }else pipes.push({...pipe,id:`${pipe.id}:${i}`,points:[a,b]})
  }
  return {...rain.downpipes,pipes,segments:plumbingSegments({pipes}),assembly:undefined}
}
