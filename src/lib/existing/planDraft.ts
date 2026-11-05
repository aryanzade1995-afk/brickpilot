import {z} from 'zod'
import {defaultAnswers,type Answers} from './types.ts'
import {validateRawSurvey,type RawSurvey} from './digitizer.ts'
import {SURVEY_SETBACKS} from './survey.ts'
import {SELECTABLE_CHARACTERS,type BuildingType,type Character} from '../model/brief.ts'

export const PLAN_DRAFT_KEY='brickpilot_drawing_review_v3'
export type PlanStep='project'|'upload'|'review'|'remediation'|'style'
export type DrawingFloor={level:number;imageUrl:string|null;raw:RawSurvey|null;scale:number;calibrated:boolean;offsetX:number;offsetY:number;stairSide:'N'|'E'|'S'|'W'}
export type PlanDraft={version:3;step:PlanStep;name:string;count:number;active:number;buildingType:BuildingType;character:Character;plinth:'standard'|'raised'|'flood';answers:Answers;floors:DrawingFloor[]}
export const emptyDrawingFloor=(level:number):DrawingFloor=>({level,imageUrl:null,raw:null,scale:.01,calibrated:false,offsetX:SURVEY_SETBACKS.left,offsetY:SURVEY_SETBACKS.rear,stairSide:'S'})
export const newPlanDraft=():PlanDraft=>({version:3,step:'project',name:'My villa',count:1,active:0,buildingType:'villa',character:'modern-box',plinth:'standard',answers:{...defaultAnswers(),storeysBuilt:1,storeysWanted:1},floors:[0,1,2].map(emptyDrawingFloor)})
const positive=z.number().finite().positive()
const answerSchema=z.object({plotWidthM:positive.max(80),plotDepthM:positive.max(80),floorHeightM:positive.optional(),columnSizeMm:positive,beamWidthMm:positive,roadSide:z.enum(['N','E','S','W']),storeysBuilt:z.number().int().min(1).max(3),storeysWanted:z.number().int().min(1).max(3),bedroomsWithBath:z.number().min(0),bedroomsNoBath:z.number().min(0),sharedBaths:z.number().min(0),studies:z.number().min(0),pooja:z.boolean(),utility:z.boolean(),parking:z.boolean()})
const draftSchema=z.object({version:z.literal(3),step:z.enum(['project','upload','review','remediation','style']),name:z.string().max(100),count:z.number().int().min(1).max(3),active:z.number().int().min(0).max(2),buildingType:z.enum(['villa','large-villa']),character:z.string(),plinth:z.enum(['standard','raised','flood']),answers:answerSchema,
 floors:z.array(z.object({level:z.number().int().min(0).max(2),imageUrl:z.string().startsWith('data:image/').nullable(),raw:z.unknown().nullable(),scale:positive,calibrated:z.boolean(),offsetX:z.number().finite().min(0).max(80),offsetY:z.number().finite().min(0).max(80),stairSide:z.enum(['N','E','S','W'])})).length(3)})
export function restorePlanDraft(value:unknown):PlanDraft{
 const parsed=draftSchema.parse(value)
 if(!SELECTABLE_CHARACTERS.some(character=>character===parsed.character))throw Error('Unknown house style')
 if(parsed.active>=parsed.count||parsed.floors.some((floor,i)=>floor.level!==i))throw Error('Invalid drawing floors')
 const result={...parsed,character:parsed.character as Character,floors:parsed.floors.map(f=>({...f,raw:f.raw?validateRawSurvey(f.raw):null}))} as PlanDraft
 if(['review','remediation','style'].includes(result.step)&&!result.floors[result.active].raw)result.step='upload'
 return result
}
