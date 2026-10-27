import type {UtilityFloor, StackSymbol} from './plan.ts'
import {withDrainageDesign} from './drainage.ts'
import {drainageInputsSchema,defaultDrainageInputs,type DrainageInputs} from './drainageInputs.ts'
import {applyUtilityPlanning,emptyPlanning,planningSchema,planningGeometryKey,type UtilityPlanning} from './planning.ts'

/** Shared read-only projection. The drawing document remains the editor and
 * persistence authority; the water viewer never writes a second drainage plan. */
const snapshots=new Map<string,{model:UtilityFloor;drainage:DrainageInputs;planning:UtilityPlanning}>()
let revision=0
const listeners=new Set<()=>void>()
export function forgetDrainageSnapshot(key:string|null){
  if(!key)return
  for(const prefix of ['formstead.drainage-inputs.v1:','formstead.utility-points.v1:'])if(key.startsWith(prefix))snapshots.delete(key.slice(prefix.length))
}
export const drainageRevision=()=>revision
export function subscribeDrainage(listener:()=>void){listeners.add(listener);return()=>{listeners.delete(listener)}}
export function publishDrainage(scope:string,model:UtilityFloor,drainage:DrainageInputs,planning:UtilityPlanning){
  snapshots.set(scope,{model,drainage,planning});revision++;listeners.forEach(f=>f())
}
export function readDrainageDrawing(scope:string,source:UtilityFloor,storage?:Pick<Storage,'getItem'>){
  const live=snapshots.get(scope)
  if(live){
    const matching=planningGeometryKey(live.model)===planningGeometryKey(source)&&JSON.stringify(live.model.floor.shafts)===JSON.stringify(source.floor.shafts)
    return {...live,compatible:matching,issues:matching?[]:['The open drawing uses different house geometry. Return to the live plan before showing its routes on this villa.']}
  }
  let drainage=defaultDrainageInputs(),planning=emptyPlanning()
  const issues:string[]=[]
  try{
    const store=storage??(typeof localStorage!=='undefined'?localStorage:undefined)
    const d=store?.getItem(`formstead.drainage-inputs.v1:${scope}`),p=store?.getItem(`formstead.utility-points.v1:${scope}`)
    if(d){const parsed=drainageInputsSchema.safeParse(JSON.parse(d));if(parsed.success)drainage=parsed.data;else issues.push('Saved drainage inputs need review.')}
    if(p){const parsed=planningSchema.safeParse(JSON.parse(p));if(parsed.success)planning=parsed.data;else issues.push('Saved utility edits need review.')}
  }catch{issues.push('Saved utility inputs could not be read; displaying the source proposal.')}
  return {model:source,drainage,planning,compatible:true,issues}
}

/** Default stack proposals use the represented shaft of each room. Explicit
 * user stack-base positions stay untouched. This changes utilities only. */
export function resolveDrainageFloor(source:UtilityFloor,input:DrainageInputs,planning:UtilityPlanning){
  const projected=applyUtilityPlanning(source,planning),model=projected.model
  const stacks:StackSymbol[]=[]
  for(const original of model.symbols.filter((s):s is StackSymbol=>s.layer==='drainage')){
    if(input.stackBases[original.id]){stacks.push(original);continue}
    for(const [i,roomId] of original.roomIds.entries()){
      const shaft=model.floor.shafts?.find(s=>s.roomId===roomId)
      stacks.push({...original,id:i?`${original.id}:${roomId}`:original.id,roomIds:[roomId],position:shaft?{x:shaft.rect.x+shaft.rect.w*.6,y:shaft.rect.y+shaft.rect.h/2}:original.position})
    }
  }
  model.symbols=[...model.symbols.filter(s=>s.layer!=='drainage'),...stacks]
  return {model:withDrainageDesign(model,input),reviews:projected.reviews}
}
