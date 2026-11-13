import type {RaytraceQuality} from './raytraceScene.ts'

/** Adaptive modes budget physical pixels; Photo retains the native buffer. */
export function raytraceRenderScale(quality:RaytraceQuality,width:number,height:number,dpr:number,gpu:string){
 if(quality==='photo'||![width,height,dpr].every(v=>Number.isFinite(v)&&v>0))return 1
 const discrete=/nvidia|radeon|\bamd\b/i.test(gpu)
 const pixels=quality==='balanced'?(discrete?1_600_000:900_000):(discrete?2_400_000:1_600_000)
 return Math.min(1,Math.sqrt(pixels/(width*height*dpr*dpr)))
}

/** Trace every tile, but only denoise/display at 6 Hz and on the final sample. */
export function presentRaytrace(now:number,last:number,samples:number,target:number){
 return samples>=target||now-last>=160
}
