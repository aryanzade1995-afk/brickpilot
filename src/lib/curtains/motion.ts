import type {CurtainWindow} from './layout.ts'
export type CurtainTarget={id:string;open:boolean;label:string}
export class CurtainMotion{
 readonly states=new Map<string,{window:CurtainWindow;progress:number;open:boolean}>()
 readonly reducedMotion:boolean
 constructor(windows:CurtainWindow[],reducedMotion=false){this.reducedMotion=reducedMotion;for(const window of windows)if(window.option.kind!=='none')this.states.set(window.id,{window,progress:1,open:true})}
 toggle(id:string){const state=this.states.get(id);if(state){state.open=!state.open;if(this.reducedMotion)state.progress=state.open?1:0}return !!state}
 advance(delta:number){let moving=false
  for(const state of this.states.values()){
   const target=state.open?1:0,difference=target-state.progress
   if(Math.abs(difference)<.001){state.progress=target;continue}
   state.progress=this.reducedMotion?target:state.progress+difference*(1-Math.exp(-8*Math.max(0,Math.min(delta,.1))));moving=true
  }
  return moving
 }
 target(eye:{x:number;y:number;z:number},direction:{x:number;y:number;z:number}):CurtainTarget|null{
  let target:CurtainTarget|null=null,best=Infinity
  for(const [id,state] of this.states){const w=state.window,r=w.roomBounds
   if(eye.x<r.x/1000-.05||eye.x>(r.x+r.w)/1000+.05||-eye.z<r.y/1000-.05||-eye.z>(r.y+r.h)/1000+.05||eye.y<w.floorY+.3||eye.y>w.floorY+3.3)continue
   const x=w.position[0]-eye.x,y=w.position[1]-w.drop*.45-eye.y,z=w.position[2]-eye.z,d=Math.hypot(x,y,z)
   if(d>2.8||d<.01||(x*direction.x+y*direction.y+z*direction.z)/d<.65||d>=best)continue
   best=d;target={id,open:state.open,label:w.option.name}
  }
  return target
 }
}
