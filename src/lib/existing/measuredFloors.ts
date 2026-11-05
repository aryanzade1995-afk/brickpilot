import {measuredStructure,type Survey} from './survey.ts'
import type {Answers} from './types.ts'

/** Convert all reviewed floors through the existing measured-plan validator. */
export function measuredHouseFloors(surveys:Survey[],answers:Answers,confirmed:boolean){
 if(!surveys.length||surveys.length!==answers.storeysWanted||surveys.length>3)throw Error('Upload and review one drawing for each selected floor.')
 if(surveys.some(s=>!s.rooms.length))throw Error('Trace at least one room on every floor before continuing.')
 const floors=surveys.map((survey,level)=>{
  const built=measuredStructure(survey,{...answers,storeysWanted:1,storeysBuilt:1},confirmed,{layoutOnly:true,upperFloor:level>0})
  return {level,plan:built.structure.measuredPlan!,position:built.structure.position!,columns:built.structure.columns,beams:built.structure.beams,built}
 })
 if(floors.length>1){
  const height=floors[0].plan.heightM
  if(floors.some(f=>f.plan.heightM!==height))throw Error('Use the same confirmed floor height on each drawing for this import.')
  for(let i=1;i<floors.length;i++){
   const lower=floors[i-1],upper=floors[i],a=lower.plan.rooms.find(r=>r.id==='stair'),b=upper.plan.rooms.find(r=>r.id==='stair')
   if(!a||!b)throw Error(`Ground and upper floor drawings need aligned stair rooms. Check floor ${i}.`)
   if(Math.abs(a.rect.x+lower.position.x-b.rect.x-upper.position.x)>20||Math.abs(a.rect.y+lower.position.y-b.rect.y-upper.position.y)>20||Math.abs(a.rect.w-b.rect.w)>20||Math.abs(a.rect.h-b.rect.h)>20)
    throw Error(`The staircase on floor ${i} is not aligned with the floor below. Correct the drawing positions.`)
  }
 }
 const ground=floors[0].built
 return {...ground,structure:{...ground.structure,storeysBuilt:answers.storeysBuilt,
  measuredFloors:floors.map(({built:_built,...floor})=>floor)}}
}
