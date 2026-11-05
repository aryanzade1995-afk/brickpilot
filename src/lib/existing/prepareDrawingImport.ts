import {rawSurveyToSurvey} from './digitizer.ts'
import {measuredHouseFloors} from './measuredFloors.ts'
import type {PlanDraft} from './planDraft.ts'
import {briefFromAnswers} from './plan.ts'
import {compile} from '../model/canonical.ts'
import {generateExisting} from '../engine/generateExisting.ts'
import {validate} from '../rules/index.ts'
import {validateExisting} from './validate.ts'
import {createBuildingModel} from '../engine/buildingModel.ts'


export function prepareDrawingImport(draft:PlanDraft){
  const surveys=draft.floors.slice(0,draft.count).map(f=>{
   if(!f.raw||!f.calibrated)throw Error(`Calibrate and confirm the drawing for floor ${f.level} before continuing.`)
   const survey=rawSurveyToSurvey(f.raw,f.scale)
   return {...survey,plotOffsetXM:f.offsetX,plotOffsetYM:f.offsetY,heightM:draft.answers.floorHeightM??3,
    rooms:survey.rooms.map(r=>r.type==='stair'?{...r,stairStartSide:f.stairSide}:r)}
  })
  const answers={...draft.answers,storeysWanted:draft.count,storeysBuilt:draft.count}
  const built=measuredHouseFloors(surveys,answers,true)
  const brief=briefFromAnswers(answers,{name:draft.name,buildingType:draft.buildingType,character:draft.character,plinthHeight:draft.plinth})
  const result=generateExisting(compile(brief),built.structure,1)
  if(!result.design)throw Error(result.reason)
  const report=validate(result.design,{checkFacade:false}),existing=validateExisting(result.design)
  const errors=[...report.findings,...existing.findings].filter(f=>f.severity==='error')
  if(errors.length)throw Error(errors.slice(0,3).map(e=>e.message).join(' '))
  createBuildingModel(result.design)
  return {brief,structure:built.structure,design:result.design}
}
