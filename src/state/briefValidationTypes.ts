import type {Brief} from '../lib/model/brief.ts'
import type {BriefFit,ShapeCheck,ShapeChoice} from '../lib/engine/planner/fit.ts'
export type FitAction={id:string;label:string;detail:string;brief:Brief}
export type BriefValidation={fit?:BriefFit;source?:Brief;suggestions?:FitAction[];suggestionsChecking?:boolean;suggestionsError?:string;shapes?:Record<ShapeChoice,ShapeCheck>}
export type ValidationRequest={key:string;kind:'fit'|'shapes';brief:Brief}
export type ValidationMessage={key:string;result?:BriefValidation;error?:string;complete:boolean}
